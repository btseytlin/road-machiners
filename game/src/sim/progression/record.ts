// The progression recorder. It plays a bot in the player truck through the real turn pipeline, with every truck on
// far travel, so no physics runs and nothing crashes. Each practice event becomes a trace line, and each in-game day
// an economy row. The player starts with no XP, so the trace holds every XP the run gives. The bot buys the cheapest

import { startKit } from '../../data/start';
import { partDef } from '../../data/parts';
import { MAX_RANK } from '../../data/skills';
import { TIME } from '../../data/time';
import type { Tier } from '../../data/market';
import { isHostile } from '../combat';
import { playerVehicle } from '../damage';
import { chassisTradeIn, repairCost } from '../economy';
import { advanceFar, clearFarRoutes } from '../far';
import { setHeadless } from '../fidelity';
import { freeCells, goodsCount, mountedParts } from '../grid';
import { goodValue } from '../market';
import { getResources } from '../resources';
import { isStranded } from '../stats';
import { buyCheapestRanks } from '../progress';
import { clockOf } from '../sun';
import { isTowed } from '../tow';
import type { GameEvent, GameModeId, NpcActivity, Vehicle, World, WorldSetup, XpSource } from '../types';
import { OUTPOST_PAY } from '../gauntlet';
import { dist, type Vec } from '../vec';
import { canVehicleSee } from '../vision';
import { maxHp, partValue, restorePart } from '../wear';
import { endTurn, newWorld, update } from '../world';
import { botOrders, parkedOnPurpose, type Archetype, type BotOptions, type Policy } from './bot';
import { emptyLedger, LEDGER_KEYS, type BotTurn, type Ledger } from './orders';
import { TEST_MAP } from '../../test/map';
import { defaultSetup, parseSetup } from '../settings';

export type TraceLine = { turn: number; source: XpSource; amount: number; difficulty: number | null; target: string };
export type RunEnd = { end: 'death'; turn: number };
export type RunFailure = { end: 'error'; turn: number; message: string };
export type RecordStep = { world: World; lines: TraceLine[]; rows: DayRow[]; death: RunEnd | null; events: GameEvent[]; ledger: Ledger };
export type Recording = { lines: TraceLine[]; rows: DayRow[]; death: RunEnd | null };

const STALL_TILES = 1;

export function record(seed: number, archetype: Archetype, turns: number, options: BotOptions = {}): Recording {
  return recordFrom(startWorld(seed, kitOf(archetype, options), 0, options.settings, modeOf(archetype)), `seed ${seed} ${archetype}`, archetype, turns, options);
}

export function recordFrom(start: World, label: string, archetype: Archetype, turns: number, options: BotOptions = {}): Recording {
  const recording: Recording = { lines: [], rows: [], death: null };
  for (const step of stepsFrom(start, label, archetype, turns, options)) {
    recording.lines.push(...step.lines);
    recording.rows.push(...step.rows);
    recording.death = step.death;
  }
  return recording;
}

export function recordTurns(seed: number, archetype: Archetype, turns: number, options: BotOptions = {}): Generator<RecordStep> {
  return stepsFrom(startWorld(seed, kitOf(archetype, options), 0, options.settings, modeOf(archetype)), `seed ${seed} ${archetype}`, archetype, turns, options);
}

export function* stepsFrom(start: World, label: string, archetype: Policy, turns: number, options: BotOptions = {}): Generator<RecordStep> {
  const tally = new DayTally();
  let carried: DayRow[] = [tally.close(0, start)];
  let i = 0;
  for (const played of playTurns(start, label, archetype, turns, options)) {
    const { before, next: world } = played;
    tally.note(before, world, played.events, played.ledger);
    const dead = world.player.state === 'dead';
    const closed = dayEnds(before, world, ++i === turns || dead) ? [tally.close(clockOf(before.turn).day, world)] : [];
    const rows = [...carried, ...closed];
    carried = [];
    yield { world, lines: played.lines, rows, death: dead ? { end: 'death', turn: world.turn } : null, events: played.events, ledger: played.ledger };
  }
}

export function* playTurns(start: World, label: string, policy: Policy, turns: number, options: BotOptions = {}): Generator<PlayedTurn> {
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`A recording needs a positive whole number of turns, got ${turns}`);
  setHeadless(true);
  clearFarRoutes();
  try {
    let world = start;
    const watch = new StallWatch(label, world.turn, playerVehicle(world).pos);
    for (let i = 0; i < turns; i++) {
      const before = world;
      const played = inContext(label, before, () => playTurn(before, policy, options));
      world = played.next;
      if (runOver(world)) {
        yield played;
        return;
      }
      watch.note(world.turn, playerVehicle(world).pos, parkedOnPurpose(world));
      yield played;
    }
  } finally {
    setHeadless(false);
    clearFarRoutes();
  }
}

function runOver(world: World): boolean {
  return world.player.state === 'dead' || world.gauntlet?.complete === true;
}

function dayEnds(before: World, after: World, last: boolean): boolean {
  return last || clockOf(after.turn).day > clockOf(before.turn).day;
}

const ARCHETYPE_KITS: Partial<Record<Archetype, string>> = { hunter: 'snowball', runner: 'gauntlet' };
const ARCHETYPE_MODES: Partial<Record<Archetype, GameModeId>> = { runner: 'gauntlet' };

function modeOf(archetype: Archetype): GameModeId {
  return ARCHETYPE_MODES[archetype] ?? 'roaming';
}

function kitOf(archetype: Archetype, options: BotOptions): string {
  return options.kit ?? ARCHETYPE_KITS[archetype] ?? 'standard';
}

function modeSetup(picked: GameModeId | undefined, settings: Record<string, number> = {}): WorldSetup {
  const mode = picked ?? 'roaming';
  return parseSetup({ mode, settings: { ...defaultSetup(mode).settings, ...settings } });
}

export function startWorld(seed: number, kit = 'standard', rank = 0, settings?: Record<string, number>, mode?: GameModeId): World {
  if (!Number.isInteger(rank) || rank < 0 || rank > MAX_RANK) throw new Error(`No skill rank ${rank}; ranks run 0 to ${MAX_RANK}`);
  return update(newWorld(seed, startKit(kit), TEST_MAP, modeSetup(mode, settings)), (w) => {
    const p = w.player;
    p.xp = 0;
    for (const skill of Object.keys(p.ranks) as (keyof typeof p.ranks)[]) {
      p.ranks[skill] = rank;
      p.xpToday[skill] = 0;
    }
    for (const source of Object.keys(p.xpBySource) as XpSource[]) p.xpBySource[source] = 0;
    p.xpDay = 1;
  });
}

export type PlayedTurn = { before: World; orders: BotTurn; next: World; lines: TraceLine[]; events: GameEvent[]; ledger: Ledger };

const MONEY_EPSILON = 1e-6;

export function turnLedger(orders: BotTurn, next: World): Ledger {
  const ledger = { ...orders.ledger };
  let explained = 0;
  for (const e of next.events) {
    const move = playerMove(e, next.player.vehicleId);
    if (!move) continue;
    ledger[move.key] += move.amount;
    explained += move.amount;
  }
  const moved = next.player.money - orders.world.player.money;
  if (Math.abs(moved - explained) > MONEY_EPSILON) throw new Error(`turn ${next.turn}: the turn moved ${moved} money but its events explain ${explained}, so some money source raises no event`);
  return ledger;
}

type Move = { key: 'contracts' | 'fees' | 'payouts'; amount: number };

function playerMove(e: GameEvent, me: string): Move | null {
  if (e.t === 'money') return { key: moneyEventKey(e.reason), amount: e.amount };
  return feeMove(e, me);
}

function feeMove(e: GameEvent, me: string): Move | null {
  if (e.t === 'towDone') return e.client === me ? { key: 'fees', amount: -e.fee } : null;
  if (e.t === 'escortPaid') return paidBetween(e.by, e.client, me, e.fee);
  if (e.t === 'patch' && e.outcome === 'done') return paidBetween(e.patcher, e.client, me, e.price);
  return null;
}

function paidBetween(payee: string, payer: string, me: string, fee: number): Move | null {
  if (payee === me) return { key: 'fees', amount: fee };
  return payer === me ? { key: 'fees', amount: -fee } : null;
}

function moneyEventKey(reason: string): Move['key'] {
  if (reason === OUTPOST_PAY) return 'payouts';
  if (reason === 'contract' || reason === 'failed haul contract') return 'contracts';
  if (reason.startsWith('towing ')) return 'fees';
  throw new Error(`Money event with an unknown reason "${reason}"`);
}

function playTurn(world: World, archetype: Policy, options: BotOptions): PlayedTurn {
  const orders = botOrders(buyCheapestRanks(world), archetype, options);
  const goals = topGoals(orders.world);
  const next = orders.world.player.state === 'dead' ? orders.world : endTurn(orders.world, moveAllFar);
  failOnStall(next, goals, options.tolerateStalls === true);
  failOnDryMajority(next);
  const events = [...orders.events, ...next.events];
  const lines = [...traceOf(orders.events, orders.world.turn), ...traceOf(next.events, next.turn)];
  return { before: world, orders, next, lines, events, ledger: turnLedger(orders, next) };
}

function inContext<T>(label: string, world: World, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const pos = playerVehicle(world).pos;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} at turn ${world.turn} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}): ${message}`, { cause: error });
  }
}

function moveAllFar(w: World): void {
  const towed = isTowed(w);
  for (const v of w.vehicles) if (!(towed && v.id === w.player.vehicleId)) advanceFar(w, v);
}

function traceOf(events: GameEvent[], turn: number): TraceLine[] {
  return events.flatMap((e) => (e.t === 'practice' ? [{ turn, source: e.source, amount: e.amount, difficulty: e.difficulty, target: e.target }] : []));
}

export class StallWatch {
  private anchor: { turn: number; pos: Vec };

  constructor(private readonly label: string, turn: number, pos: Vec) {
    this.anchor = { turn, pos: { ...pos } };
  }

  note(turn: number, pos: Vec, onPurpose: boolean): void {
    if (onPurpose || dist(pos, this.anchor.pos) >= STALL_TILES) {
      this.anchor = { turn, pos: { ...pos } };
      return;
    }
    if (turn - this.anchor.turn < TIME.turnsPerDay) return;
    const at = `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`;
    throw new Error(`${this.label}: the player truck stalled at turn ${turn} at ${at}; it moved under ${STALL_TILES} tile since turn ${this.anchor.turn}`);
  }
}

function topGoals(w: World): Map<string, NpcActivity> {
  const tops = new Map<string, NpcActivity>();
  for (const v of w.vehicles) {
    const top = v.brain?.goals.at(-1);
    if (top) tops.set(v.id, structuredClone(top));
  }
  return tops;
}

function failOnStall(w: World, goals: Map<string, NpcActivity>, tolerate: boolean): void {
  const stalls = w.events.flatMap((e) => (e.t === 'stall' ? [describeStall(w, e, goals.get(e.vehicle))] : []));
  if (stalls.length > 0 && !tolerate) throw new Error(`${stalls.length} stall${stalls.length > 1 ? 's' : ''}:\n${stalls.join('\n')}`);
}

function failOnDryMajority(w: World): void {
  const drivers = w.vehicles.filter((v) => v.brain);
  const dry = drivers.filter((v) => getResources(w, v).fuel <= 0).length;
  if (dry * 2 > drivers.length) throw new Error(`turn ${w.turn}: ${dry} of ${drivers.length} NPCs are dry at once, a majority`);
}

function describeStall(w: World, e: Extract<GameEvent, { t: 'stall' }>, goal: NpcActivity | undefined): string {
  const v = w.vehicles.find((x) => x.id === e.vehicle);
  const at = `turn ${w.turn}: ${e.vehicle} gave up ${e.goal ?? 'idle'} (${e.reason})`;
  if (!v) return at;
  const dest = goal?.destination ? ` toward ${Math.round(goal.destination.x)},${Math.round(goal.destination.y)}, ${Math.round(dist(v.pos, goal.destination))} tiles off, target ${goal.targetId}, phase ${goal.phase}` : '';
  return `${at}${dest}\n  ${vehicleLine(w, v)} free cells ${freeCells(v)}\n  ${surroundings(w, v)}`;
}

function surroundings(w: World, v: Vehicle): string {
  const near = w.vehicles.filter((o) => o.id !== v.id && dist(o.pos, v.pos) < 6)
    .map((o) => `${o.id}:${o.brain?.templateId ?? 'player'}@${Math.round(dist(o.pos, v.pos))} top ${o.brain?.goals.at(-1)?.kind ?? '-'}`);
  const hostiles = w.vehicles.filter((o) => isHostile(w, v, o) && canVehicleSee(w, v, o.pos)).map((o) => `${o.id}@${Math.round(dist(o.pos, v.pos))}`);
  return `order ${JSON.stringify(v.order)} far route ${v.brain?.farRoute?.points.length ?? '-'} near ${near.join(', ') || 'none'} hostiles ${hostiles.join(', ') || 'none'}`;
}

function vehicleLine(w: World, v: Vehicle): string {
  if (!v.brain) throw new Error(`${v.id} stalled without a driver`);
  const r = getResources(w, v);
  const goals = v.brain.goals.map((g) => `${g.kind}:${g.reason}`).join(' > ') || 'none';
  const states = w.states.filter((s) => s.holder === v.id || s.other === v.id).map((s) => `${s.kind}${s.holder === v.id ? '>' : '<'}`).join(',') || 'none';
  return `${v.brain.templateId} ${v.chassisId} at ${Math.round(v.pos.x)},${Math.round(v.pos.y)} speed ${v.speed.toFixed(2)} stranded ${isStranded(w, v)} `
    + `money ${r.money} fuel ${r.fuel.toFixed(0)} engines ${mountedParts(v, 'engine').length} job ${v.job?.kind ?? '-'} `
    + `goals now ${goals} states ${states} goods ${JSON.stringify(goodsCount(v))}`;
}

function nonCoreTruckValue(v: Vehicle): number {
  return v.items.reduce((sum, it) => (it.kind === 'part' && partDef(it.part.defId).kind !== 'core' ? sum + partValue(it.part) : sum), 0);
}

function storageValue(world: World): number {
  return world.player.storage.reduce((sum, p) => sum + partValue(p), 0);
}

function cargoValue(world: World, v: Vehicle): number {
  const hauled = new Map<string, number>();
  for (const c of world.player.contracts) if (c.kind === 'haul') hauled.set(c.good, (hauled.get(c.good) ?? 0) + c.units);
  return Object.entries(goodsCount(v)).reduce((sum, [good, n]) => sum + goodValue(good) * Math.max(0, n - (hauled.get(good) ?? 0)), 0);
}

export type Worth = { money: number; cargo: number; gear: number; storage: number; chassis: number };

export function worthOf(world: World): Worth {
  const v = playerVehicle(world);
  return { money: world.player.money, cargo: cargoValue(world, v), gear: nonCoreTruckValue(v), storage: storageValue(world), chassis: repairedTradeIn(world) - repairCost(world) };
}

function repairedTradeIn(world: World): number {
  return chassisTradeIn(update(world, (w) => {
    for (const p of mountedParts(playerVehicle(w), 'core')) restorePart(p, maxHp(p));
  }));
}

export function netWorth(world: World): number {
  return worthTotal(worthOf(world));
}

export function worthTotal(w: Worth): number {
  return w.money + w.cargo + w.gear + w.storage + w.chassis;
}

export function gearTier(v: Vehicle): Tier {
  const tiers = mountedParts(v)
    .filter((p) => partDef(p.defId).kind !== 'core')
    .map((p) => partDef(p.defId).tier);
  return (tiers.length > 0 ? Math.max(...tiers) : 1) as Tier;
}

export type DayRow = {
  day: number;
  turns: number;
  money: number;
  netWorth: number;
  tier: Tier;
  chassis: string;
  fightsWon: number;
  knockouts: number;
  gearLost: number;
  deaths: number;
  stalls: number;
  ledger: Ledger;
  worth: Worth;
};

type Counts = Pick<DayRow, 'fightsWon' | 'knockouts' | 'gearLost' | 'deaths' | 'stalls' | 'ledger'>;

const noCounts = (): Counts => ({ fightsWon: 0, knockouts: 0, gearLost: 0, deaths: 0, stalls: 0, ledger: emptyLedger() });

function gearIds(world: World): Set<string> {
  return new Set(mountedParts(playerVehicle(world)).filter((p) => partDef(p.defId).kind !== 'core').map((p) => p.id));
}

function takenIds(world: World): Set<string> {
  const others = world.vehicles.filter((v) => v.id !== world.player.vehicleId).flatMap((v) => v.items);
  const held = others.flatMap((it) => (it.kind === 'part' ? [it.part.id] : []));
  return new Set([...held, ...world.salvage.flatMap((s) => s.parts.map((p) => p.id))]);
}

export class DayTally {
  private counts = noCounts();
  private turns = 0;

  note(before: World, next: World, events: readonly GameEvent[], ledger: Ledger): void {
    const me = before.player.vehicleId;
    this.turns++;
    for (const key of LEDGER_KEYS) this.counts.ledger[key] += ledger[key];
    for (const e of events) this.countEvent(e, me);
    const taken = takenIds(next);
    for (const id of gearIds(before)) if (taken.has(id)) this.counts.gearLost++;
  }

  private countEvent(e: GameEvent, me: string): void {
    if (e.t === 'npcKnockout' && e.by === me) this.counts.fightsWon++;
    if (e.t === 'knockout') this.counts.knockouts++;
    if (e.t === 'death') this.counts.deaths++;
    if (e.t === 'stall') this.counts.stalls++;
  }

  close(day: number, world: World): DayRow {
    const me = playerVehicle(world);
    const worth = worthOf(world);
    const row = { day, turns: this.turns, money: world.player.money, netWorth: worthTotal(worth), worth, tier: gearTier(me), chassis: me.chassisId, ...this.counts };
    this.counts = noCounts();
    this.turns = 0;
    return row;
  }
}

export const TIERS: readonly Tier[] = [1, 2, 3];

export function wageByTier(rows: readonly DayRow[]): Record<Tier, number | null> {
  const gained: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 };
  const turns: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 };
  for (let i = 1; i < rows.length; i++) {
    const tier = rows[i - 1].tier;
    gained[tier] += rows[i].netWorth - rows[i - 1].netWorth;
    turns[tier] += rows[i].turns;
  }
  return { 1: ratio(gained[1], turns[1]), 2: ratio(gained[2], turns[2]), 3: ratio(gained[3], turns[3]) };
}

function ratio(gained: number, turns: number): number | null {
  return turns > 0 ? gained / turns : null;
}

export function tierDays(rows: readonly DayRow[]): Record<Tier, number | null> {
  const first = (tier: Tier) => rows.find((r) => r.tier >= tier)?.day ?? null;
  return { 1: first(1), 2: first(2), 3: first(3) };
}

export type FightTotals = Pick<Counts, 'fightsWon' | 'knockouts' | 'gearLost' | 'deaths' | 'stalls'>;

export function ledgerTotals(rows: readonly DayRow[]): Ledger {
  const total = emptyLedger();
  for (const row of rows) for (const key of LEDGER_KEYS) total[key] += row.ledger[key];
  return total;
}

export function fightTotals(rows: readonly DayRow[]): FightTotals {
  const sum = (pick: (r: DayRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  return { fightsWon: sum((r) => r.fightsWon), knockouts: sum((r) => r.knockouts), gearLost: sum((r) => r.gearLost), deaths: sum((r) => r.deaths), stalls: sum((r) => r.stalls) };
}
