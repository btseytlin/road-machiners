// One line per recorded turn: the player truck's state after the turn, the hostiles it sees, the money the turn moved
// and every event that touches the player. A batch writes these beside its traces, so one run answers every later
// question about it without a replay.

import { inCombat } from '../combat';
import { playerVehicle } from '../damage';
import { goodsCount, mountedParts } from '../grid';
import { fightOddsAgainst } from '../npc-decisions';
import { getResources } from '../resources';
import { isStranded, vehicleStats } from '../stats';
import { isTowed } from '../tow';
import type { GameEvent, Vehicle, World } from '../types';
import { dist } from '../vec';
import { playerSees } from '../vision';
import { maxHp } from '../wear';
import { hostileToPlayer } from '../world';
import type { Ledger } from './orders';
import { netWorth } from './record';

// A hostile in sight: id, driver template, chassis, distance, the player's odds in percent to win a fight against
// its group, and its top speed.
export type SeenFoe = { id: string; who: string; dist: number; odds: number; speed: number };

export type TurnLine = {
  t: number;
  pos: [number, number];
  money: number;
  nw: number;
  fuel: number;
  sup: number;
  heat: number;
  chassis: string;
  speed: number; // top speed now
  state: string;
  goods: Record<string, number>;
  parts: string[]; // defId:hp percent of each mounted part
  contracts: string[];
  order: string | null;
  job: string | null;
  flags: string[]; // combat, stranded, towed, beacon, fire
  call: string | null;
  foes: SeenFoe[];
  ledger: Partial<Ledger>;
  ev: string[];
};

export function turnLine(world: World, events: readonly GameEvent[], ledger: Ledger): TurnLine {
  const me = playerVehicle(world);
  const p = world.player;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    t: world.turn,
    pos: [round(me.pos.x), round(me.pos.y)],
    money: p.money,
    nw: Math.round(netWorth(world)),
    fuel: round(p.fuel),
    sup: round(p.supplies),
    heat: round(p.engineHeat),
    chassis: me.chassisId,
    speed: round(vehicleStats(world, me).maxSpeed),
    state: p.state,
    goods: goodsCount(me),
    parts: mountedParts(me).map((part) => `${part.defId}:${Math.round((100 * part.hp) / maxHp(part))}`),
    contracts: p.contracts.map((c) => `${c.kind}:${'good' in c ? c.good : ''}${'units' in c ? c.units : ''}>${'to' in c ? c.to : c.shop}`),
    order: me.order ? `${me.order.kind}${'dest' in me.order ? `@${Math.round(me.order.dest.x)},${Math.round(me.order.dest.y)}` : ''}` : null,
    job: me.job ? me.job.kind : null,
    flags: flagsOf(world, me),
    call: p.call ? `${p.call.with}:${p.call.topic ?? 'hub'}` : null,
    foes: foesSeen(world, me),
    ledger: Object.fromEntries(Object.entries(ledger).filter(([, v]) => v !== 0)),
    ev: events.filter((e) => touchesPlayer(e, me.id)).map((e) => describe(world, e)),
  };
}

// Every truck is snapshotted every SNAPSHOT_TURNS turns: a truck drives under 10 tiles a turn, so ten turns keeps a
// route followable and the file small enough to read whole.
const SNAPSHOT_TURNS = 10;

// The world log of one turn: every event of the turn raw, whoever it touches, and on a snapshot turn the position,
// order, goal stack, money, fuel and part health of every truck.
export type WorldLine = { t: number; events?: GameEvent[]; trucks?: TruckSnap[] };
export type TruckSnap = { id: string; who: string; faction: string; chassis: string; pos: [number, number]; speed: number; order: string | null; goals: string[]; money: number; fuel: number; hp: number; states: string[] };

export function worldLine(world: World, events: readonly GameEvent[]): WorldLine | null {
  const line: WorldLine = { t: world.turn };
  if (events.length > 0) line.events = [...events];
  if (world.turn % SNAPSHOT_TURNS === 0) line.trucks = world.vehicles.map((v) => snap(world, v));
  return line.events || line.trucks ? line : null;
}

// The mean health of the mounted parts, in percent.
function meanHp(v: Vehicle): number {
  const parts = mountedParts(v);
  return Math.round(parts.reduce((sum, p) => sum + (100 * p.hp) / maxHp(p), 0) / Math.max(1, parts.length));
}

function snap(world: World, v: Vehicle): TruckSnap {
  const hp = meanHp(v);
  return {
    id: v.id,
    who: v.brain?.templateId ?? 'player',
    faction: v.faction,
    chassis: v.chassisId,
    pos: [Math.round(v.pos.x * 10) / 10, Math.round(v.pos.y * 10) / 10],
    speed: Math.round(v.speed * 10) / 10,
    order: v.order ? v.order.kind : null,
    goals: v.brain?.goals.map((g) => `${g.kind}${g.targetId ? `:${g.targetId}` : ''}`) ?? [],
    money: Math.round(getResources(world, v).money),
    fuel: Math.round(getResources(world, v).fuel),
    hp,
    states: world.states.filter((s) => s.holder === v.id).map((s) => `${s.kind}>${s.other}`),
  };
}

function flagsOf(world: World, me: Vehicle): string[] {
  const p = world.player;
  const on: [string, boolean][] = [['combat', inCombat(world, me)], ['stranded', isStranded(world, me)], ['towed', isTowed(world)], ['beacon', p.beacon], ['fire', p.autoFire]];
  return on.filter(([, v]) => v).map(([name]) => name);
}

function foesSeen(world: World, me: Vehicle): SeenFoe[] {
  return world.vehicles
    .filter((v) => v.id !== me.id && hostileToPlayer(world, v) && playerSees(world, v.pos))
    .map((v) => ({ id: v.id, who: `${v.brain?.templateId ?? v.faction}/${v.chassisId}`, dist: Math.round(dist(v.pos, me.pos)), odds: Math.round(100 * fightOddsAgainst(world, me, v).win), speed: Math.round(vehicleStats(world, v).maxSpeed * 10) / 10 }));
}

// Events with no vehicle field are the player's own.
const OWN = new Set(['money', 'contract', 'death', 'knockout', 'wake', 'skillUp', 'supply', 'townPatch', 'scrapPatch', 'searched', 'discover']);
const QUIET = new Set(['practice', 'activity', 'arrived', 'spawn', 'despawn', 'info', 'weather']);

export function touchesPlayer(e: GameEvent, me: string): boolean {
  if (QUIET.has(e.t)) return false;
  if (OWN.has(e.t)) return true;
  return JSON.stringify(e).includes(`"${me}"`);
}

// A truck id with its driver template and chassis, such as v76:raider-gunwagon/gunwagon.
function truck(world: World, id: string): string {
  const v = world.vehicles.find((x) => x.id === id);
  return v ? `${id}:${v.brain?.templateId ?? 'player'}/${v.chassisId}` : id;
}

export function describe(world: World, e: GameEvent): string {
  if (e.t === 'say') return `say ${e.speaker}: ${e.text}`;
  if (e.t === 'shot') return `shot ${truck(world, e.shooter)}>${truck(world, e.target)} ${e.weapon} hits ${e.rounds.filter((r) => r.hit).length}/${e.rounds.length}`;
  if (e.t === 'money') return `money ${e.amount} ${e.reason}`;
  if (e.t === 'contract') return `contract ${e.outcome} ${e.contract.kind}`;
  if (e.t === 'stateEnded') return `stateEnded ${e.state.kind}:${e.state.holder}>${e.state.other} ${e.ending}`;
  const { t, ...rest } = e;
  return `${t} ${JSON.stringify(rest)}`;
}
