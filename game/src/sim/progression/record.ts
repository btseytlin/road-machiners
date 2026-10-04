// The progression recorder. It plays a bot in the player truck through the real turn pipeline, with every truck on
// far travel, so no physics runs and nothing crashes. Each practice event becomes a trace line, and each in-game day
// an economy row. The player starts with no XP, so the trace holds every XP the run gives. The bot buys the cheapest
// affordable rank at the start of each turn, so it plays with the skill effects its XP pays for, like a player does.
// A stall event from any truck fails the run.

import { startKit } from '../../data/start';
import { partDef } from '../../data/parts';
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
import type { GameEvent, NpcActivity, Vehicle, World, XpSource } from '../types';
import { dist, type Vec } from '../vec';
import { canVehicleSee } from '../vision';
import { maxHp, partValue } from '../wear';
import { endTurn, newWorld, update } from '../world';
import { botOrders, parkedOnPurpose, type Archetype, type BotOptions } from './bot';
import { emptyLedger, LEDGER_KEYS, type BotTurn, type Ledger } from './orders';
import { TEST_MAP } from '../../test/map';

// One practice event. turn is the world turn it happened on; a run of N turns ends on world turn N + 1.
export type TraceLine = { turn: number; source: XpSource; amount: number; difficulty: number | null; target: string };
// The last entry of a run the player did not survive. turn is the world turn the player died on.
export type RunEnd = { end: 'death'; turn: number };
// The last entry of a run an error stopped. turn is the last world turn that finished, and message the error.
export type RunFailure = { end: 'error'; turn: number; message: string };
// rows holds the economy row of a day that ended on this step. death is set on the last step of a run the player did
// not survive. events holds everything the bot's commands and the turn raised, and ledger the money they moved.
export type RecordStep = { world: World; lines: TraceLine[]; rows: DayRow[]; death: RunEnd | null; events: GameEvent[]; ledger: Ledger };
export type Recording = { lines: TraceLine[]; rows: DayRow[]; death: RunEnd | null };

// A truck that moves less than this many tiles in a whole in-game day, while not parked on purpose, has stalled.
const STALL_TILES = 1;

export function record(seed: number, archetype: Archetype, turns: number, options: BotOptions = {}): Recording {
  return recordFrom(startWorld(seed, kitOf(archetype, options)), `seed ${seed} ${archetype}`, archetype, turns, options);
}

// Records from a given world. label names the run in errors.
export function recordFrom(start: World, label: string, archetype: Archetype, turns: number, options: BotOptions = {}): Recording {
  const recording: Recording = { lines: [], rows: [], death: null };
  for (const step of stepsFrom(start, label, archetype, turns, options)) {
    recording.lines.push(...step.lines);
    recording.rows.push(...step.rows);
    recording.death = step.death;
  }
  return recording;
}

// Plays the turns one at a time and yields each turn's world and trace lines, so a caller can write as it goes.
export function recordTurns(seed: number, archetype: Archetype, turns: number, options: BotOptions = {}): Generator<RecordStep> {
  return stepsFrom(startWorld(seed, kitOf(archetype, options)), `seed ${seed} ${archetype}`, archetype, turns, options);
}

// Plays the turns one at a time from a given world. The player's death ends the run early, since no turn runs after
// it. A stall or any other error fails loud.
export function* stepsFrom(start: World, label: string, archetype: Archetype, turns: number, options: BotOptions = {}): Generator<RecordStep> {
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`A recording needs a positive whole number of turns, got ${turns}`);
  setHeadless(true);
  clearFarRoutes();
  try {
    yield* playSteps(start, label, archetype, turns, options);
  } finally {
    setHeadless(false);
    clearFarRoutes();
  }
}

function* playSteps(start: World, label: string, archetype: Archetype, turns: number, options: BotOptions): Generator<RecordStep> {
  let world = start;
  const watch = new StallWatch(label, world.turn, playerVehicle(world).pos);
  const tally = new DayTally();
  let carried: DayRow[] = [tally.close(0, world)]; // the starting state rides on the first step
  for (let i = 0; i < turns; i++) {
    const before = world;
    const played = inContext(label, before, () => playTurn(before, archetype, options));
    world = played.next;
    tally.note(before, world, played.events, played.ledger);
    const dead = world.player.state === 'dead';
    const closed = dayEnds(before, world, i === turns - 1 || dead) ? [tally.close(clockOf(before.turn).day, world)] : [];
    const rows = [...carried, ...closed];
    carried = [];
    if (dead) {
      yield { world, lines: played.lines, rows, death: { end: 'death', turn: world.turn }, events: played.events, ledger: played.ledger };
      return;
    }
    watch.note(world.turn, playerVehicle(world).pos, parkedOnPurpose(world));
    yield { world, lines: played.lines, rows, death: null, events: played.events, ledger: played.ledger };
  }
}

// A day ends on the turn the clock moves to the next day. The last turn of a run closes its day as well.
function dayEnds(before: World, after: World, last: boolean): boolean {
  return last || clockOf(after.turn).day > clockOf(before.turn).day;
}

// Combat is not for a starter truck: a sensible hunter on the standard kit fights nothing. So the hunter starts geared,
// and the climber plays the way from the standard kit up to hunting.
const ARCHETYPE_KITS: Partial<Record<Archetype, string>> = { hunter: 'snowball' };

function kitOf(archetype: Archetype, options: BotOptions): string {
  return options.kit ?? ARCHETYPE_KITS[archetype] ?? 'standard';
}

function startWorld(seed: number, kit: string): World {
  return update(newWorld(seed, startKit(kit), TEST_MAP), (w) => {
    const p = w.player;
    p.xp = 0;
    for (const skill of Object.keys(p.ranks) as (keyof typeof p.ranks)[]) {
      p.ranks[skill] = 0;
      p.xpToday[skill] = 0;
    }
    for (const source of Object.keys(p.xpBySource) as XpSource[]) p.xpBySource[source] = 0;
    p.xpDay = 1;
  });
}

// events is everything the bot's commands and the turn raised on the way to next.
type PlayedTurn = { next: World; lines: TraceLine[]; events: GameEvent[]; ledger: Ledger };

// The money the turn moved by itself, after the bot's commands: contract pay, else tow, patch and escort fees.
function turnLedger(orders: BotTurn, next: World): Ledger {
  const ledger = { ...orders.ledger };
  const moved = next.player.money - orders.world.player.money;
  ledger[next.events.some((e) => e.t === 'contract') ? 'contracts' : 'fees'] += moved;
  return ledger;
}

function playTurn(world: World, archetype: Archetype, options: BotOptions): PlayedTurn {
  const orders = botOrders(buyCheapestRanks(world), archetype, options);
  const goals = topGoals(orders.world);
  const next = endTurn(orders.world, moveAllFar);
  failOnStall(next, goals, options.tolerateStalls === true);
  failOnDryMajority(next);
  const events = [...orders.events, ...next.events];
  const lines = [...traceOf(orders.events, orders.world.turn), ...traceOf(next.events, next.turn)];
  return { next, lines, events, ledger: turnLedger(orders, next) };
}

// Adds the seed, archetype, turn and truck position to any error of the turn.
function inContext<T>(label: string, world: World, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const pos = playerVehicle(world).pos;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} at turn ${world.turn} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}): ${message}`, { cause: error });
  }
}

// The movement step: every truck travels far. A towed player follows its tower in the pipeline instead.
function moveAllFar(w: World): void {
  const towed = isTowed(w);
  for (const v of w.vehicles) if (!(towed && v.id === w.player.vehicleId)) advanceFar(w, v);
}

function traceOf(events: GameEvent[], turn: number): TraceLine[] {
  return events.flatMap((e) => (e.t === 'practice' ? [{ turn, source: e.source, amount: e.amount, difficulty: e.difficulty, target: e.target }] : []));
}

// Fails loud when the player truck stays within STALL_TILES of one point for a whole in-game day. A turn parked on
// purpose starts the day over.
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

// ---- NPC stalls. A stall event means some rule left a driver with no way forward, so a run has none.

// Each driver's top goal before the turn, so a stall report can say where the given-up goal pointed.
function topGoals(w: World): Map<string, NpcActivity> {
  const tops = new Map<string, NpcActivity>();
  for (const v of w.vehicles) {
    const top = v.brain?.goals.at(-1);
    if (top) tops.set(v.id, structuredClone(top));
  }
  return tops;
}

// A run that tolerates stalls only counts them in its rows, for runs that must reach the end whatever NPCs do.
function failOnStall(w: World, goals: Map<string, NpcActivity>, tolerate: boolean): void {
  const stalls = w.events.flatMap((e) => (e.t === 'stall' ? [describeStall(w, e, goals.get(e.vehicle))] : []));
  if (stalls.length > 0 && !tolerate) throw new Error(`${stalls.length} stall${stalls.length > 1 ? 's' : ''}:\n${stalls.join('\n')}`);
}

// Fails when more than half the NPCs hold an empty tank at once, which means fuel supply or fuel buying is broken.
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

// The order and route the driver holds, the trucks close by and the hostiles it sees.
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

// ---- What the player holds, in money.

// Every part on the truck that is not built in, mounted or loose in the grid.
function nonCoreTruckValue(v: Vehicle): number {
  return v.items.reduce((sum, it) => (it.kind === 'part' && partDef(it.part.defId).kind !== 'core' ? sum + partValue(it.part) : sum), 0);
}

function storageValue(world: World): number {
  return world.player.storage.reduce((sum, p) => sum + partValue(p), 0);
}

function cargoValue(v: Vehicle): number {
  return Object.entries(goodsCount(v)).reduce((sum, [good, n]) => sum + goodValue(good) * n, 0);
}

// What the player holds, split by kind. The chassis is its trade-in once repaired, less the whole repair bill, gear
// damage included. The game's own trade-in scales with core HP, so a dented cab would swing net worth by most of the
// chassis value while a repair of a tenth of that fixes it.
export type Worth = { money: number; cargo: number; gear: number; storage: number; chassis: number };

export function worthOf(world: World): Worth {
  const v = playerVehicle(world);
  return { money: world.player.money, cargo: cargoValue(v), gear: nonCoreTruckValue(v), storage: storageValue(world), chassis: repairedTradeIn(world) - repairCost(world) };
}

function repairedTradeIn(world: World): number {
  return chassisTradeIn(update(world, (w) => {
    for (const p of mountedParts(playerVehicle(w), 'core')) p.hp = maxHp(p);
  }));
}

// Cash plus every part, good and truck the player holds, in the truck or in garage storage.
export function netWorth(world: World): number {
  return worthTotal(worthOf(world));
}

export function worthTotal(w: Worth): number {
  return w.money + w.cargo + w.gear + w.storage + w.chassis;
}

// The best tier among the mounted parts that are not built in, or 1 with none.
export function gearTier(v: Vehicle): Tier {
  const tiers = mountedParts(v)
    .filter((p) => partDef(p.defId).kind !== 'core')
    .map((p) => partDef(p.defId).tier);
  return (tiers.length > 0 ? Math.max(...tiers) : 1) as Tier;
}

// ---- The economy rows: one per in-game day, written beside the trace.

// day is the in-game day the row closes, 0 for the starting state. turns is how many turns the row covers, one day
// except for the start and a last partial day. Counts are for those turns alone. tier is the best gear tier mounted.
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
  stalls: number; // NPC stall events, only nonzero in a run that tolerates them
  ledger: Ledger; // money moved that day by key: negative is spent, positive earned
  worth: Worth; // net worth by kind at the end of the row
};

type Counts = Pick<DayRow, 'fightsWon' | 'knockouts' | 'gearLost' | 'deaths' | 'stalls' | 'ledger'>;

const noCounts = (): Counts => ({ fightsWon: 0, knockouts: 0, gearLost: 0, deaths: 0, stalls: 0, ledger: emptyLedger() });

// Mounted parts the player does not carry from the factory: the gear a robber strips.
function gearIds(world: World): Set<string> {
  return new Set(mountedParts(playerVehicle(world)).filter((p) => partDef(p.defId).kind !== 'core').map((p) => p.id));
}

// Parts lying in loot piles and stocks or held by other trucks.
function takenIds(world: World): Set<string> {
  const others = world.vehicles.filter((v) => v.id !== world.player.vehicleId).flatMap((v) => v.items);
  const held = others.flatMap((it) => (it.kind === 'part' ? [it.part.id] : []));
  return new Set([...held, ...world.salvage.flatMap((s) => s.parts.map((p) => p.id))]);
}

export class DayTally {
  private counts = noCounts();
  private turns = 0;

  // Counts one turn. `before` is the world the turn started on and `next` the one it ended on. Lost gear is mounted
  // gear that ended in a loot pile or on another truck: a robbery, whether a knockout or a surrender handed it over.
  // The bot's own sales and refits never land there.
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

  // The row for the day that just ended, and a fresh count for the next day.
  close(day: number, world: World): DayRow {
    const me = playerVehicle(world);
    const worth = worthOf(world);
    const row = { day, turns: this.turns, money: world.player.money, netWorth: worthTotal(worth), worth, tier: gearTier(me), chassis: me.chassisId, ...this.counts };
    this.counts = noCounts();
    this.turns = 0;
    return row;
  }
}

// ---- What the rows say.

export const TIERS: readonly Tier[] = [1, 2, 3];

// Net worth gained per turn while the best mounted gear was each tier. A period counts for the tier held at its start.
// A tier the run never held has no wage.
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

// The first day the player held gear of each tier or better, or null when it never did.
export function tierDays(rows: readonly DayRow[]): Record<Tier, number | null> {
  const first = (tier: Tier) => rows.find((r) => r.tier >= tier)?.day ?? null;
  return { 1: first(1), 2: first(2), 3: first(3) };
}

export type FightTotals = Pick<Counts, 'fightsWon' | 'knockouts' | 'gearLost' | 'deaths' | 'stalls'>;

// The money each ledger key moved over the whole run: negative is spent, positive earned.
export function ledgerTotals(rows: readonly DayRow[]): Ledger {
  const total = emptyLedger();
  for (const row of rows) for (const key of LEDGER_KEYS) total[key] += row.ledger[key];
  return total;
}

export function fightTotals(rows: readonly DayRow[]): FightTotals {
  const sum = (pick: (r: DayRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  return { fightsWon: sum((r) => r.fightsWon), knockouts: sum((r) => r.knockouts), gearLost: sum((r) => r.gearLost), deaths: sum((r) => r.deaths), stalls: sum((r) => r.stalls) };
}
