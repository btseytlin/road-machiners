// Traffic speed harness: plays a world of NPCs through the real turn pipeline and samples how fast each truck drives
// on the road, in km/h of the path it drove that turn. Samples fall into classes (healthy ordinary cars, ordinary cars
// on low fuel, worn ordinary cars, armed and heavy roles, towing rigs) so a before-and-after comparison reads per class.
// The class lists below only sort samples. They decide no game rule. The game never imports this module.
// The physics layer drives every NPC in Rapier once the caller widens PERF.liveMargin; see scripts/traffic.mjs.

import { defaultSetup } from '../sim/settings';
import { PHYSICS } from '../data/physics';
import { START_KITS } from '../data/start';
import { TERRAIN_TYPES } from '../data/terrain';
import { buildDrive, freeDrive, initPhysics, type Drive } from '../phys/drive';
import { physicsMove } from '../phys/turn';
import { inCombat } from '../sim/combat';
import { hangUp } from '../sim/dialogue';
import { advanceFar } from '../sim/far';
import { mountedParts, coreParts } from '../sim/grid';
import { loadFactor } from '../sim/mass';
import { getResources } from '../sim/resources';
import { fuelCap, getMobilityCondition, gunDrag, isStranded, vehicleStats } from '../sim/stats';
import { tileAt } from '../sim/terrain';
import { isOnRope, isTowing } from '../sim/tow';
import type { EngineDef } from '../data/parts';
import type { Pose, Vehicle, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { wornDef } from '../sim/wear';
import { weatherAt } from '../sim/weather';
import { endTurn, newWorld } from '../sim/world';
import { RULES } from '../data/rules';
import { TEST_MAP } from './map';

export type TrafficLayer = 'physics' | 'far';
export const TRAFFIC_LAYERS: readonly TrafficLayer[] = ['physics', 'far'];

// Plain road traffic: the roles the issue means by ordinary cars.
export const ORDINARY_TEMPLATES: ReadonlySet<string> = new Set(['trader', 'buggy', 'courier', 'scavenger', 'roamer', 'vulture']);
// Armed patrol and convoy roles, slow by their loadout.
export const HEAVY_TEMPLATES: ReadonlySet<string> = new Set(['noseArmy', 'bowlFarmer', 'gunwagon', 'merc', 'convoy', 'convoyGuard']);
export const HEAVY_CHASSIS: ReadonlySet<string> = new Set(['tractor', 'loader', 'wagon', 'carrier', 'longbed', 'bus']);

export const KPH = (PHYSICS.metersPerTile / PHYSICS.turnSeconds) * 3.6; // km/h per tile a turn
const MOVING_KPH = 5;
const ROAD_SPEED = 0.98; // terrain speed share that counts as open road
const STEADY_SHARE = 0.1; // start and end speeds within this share of each other
const HEALTHY_MOBILITY = 0.75;

export type TrafficClass = 'healthyOrdinary' | 'lowFuelOrdinary' | 'wornOrdinary' | 'heavyRole' | 'towing' | 'other';
export const TRAFFIC_CLASSES: readonly TrafficClass[] = ['healthyOrdinary', 'lowFuelOrdinary', 'wornOrdinary', 'heavyRole', 'towing', 'other'];

export type TrafficSample = {
  seed: number;
  turn: number;
  vehicle: string;
  templateId: string;
  chassisId: string;
  layer: TrafficLayer;
  startKph: number;
  endKph: number;
  drivenKph: number; // length of the path driven this turn
  maxKph: number; // vehicleStats top speed at the turn's start
  fuelShare: number;
  lowFuel: boolean; // under the share of the tank that halves top speed
  mobility: number;
  brokenWheels: number;
  gunDrag: number;
  loadFactor: number;
  weatherSpeed: number;
  onRoad: boolean; // open road at both ends of the turn
  stranded: boolean;
  towing: boolean;
  towed: boolean;
  inCombat: boolean;
  goal: string | null;
};

export type TrafficRun = {
  seed: number;
  layer: TrafficLayer;
  turns: number;
  samples: TrafficSample[]; // only moving samples on the road
  npcTurns: number;
  resupplyStarts: number; // times a driver's top goal turned to resupply
  maxDry: number; // the most NPCs with an empty tank at once
  collisions: number;
};

export function classify(s: TrafficSample): TrafficClass {
  if (s.towing) return 'towing';
  if (HEAVY_TEMPLATES.has(s.templateId) || HEAVY_CHASSIS.has(s.chassisId)) return 'heavyRole';
  if (!ORDINARY_TEMPLATES.has(s.templateId) || s.stranded || s.towed) return 'other';
  if (s.lowFuel) return 'lowFuelOrdinary';
  if (s.mobility < HEALTHY_MOBILITY || s.brokenWheels > 0) return 'wornOrdinary';
  return 'healthyOrdinary';
}

// Moving on the road, the free cruise a player sees: not in a fight, not slowed by a storm and neither speeding up
// nor slowing down much over the turn.
export function isSteadyCruise(s: TrafficSample): boolean {
  if (!isCruising(s) || s.weatherSpeed < 1) return false;
  const top = Math.max(s.startKph, s.endKph);
  return top > 0 && Math.abs(s.startKph - s.endKph) <= STEADY_SHARE * top;
}

// Any moving sample on open road outside a fight. Stranded and towed trucks only crawl or ride a rope.
export function isCruising(s: TrafficSample): boolean {
  return s.onRoad && s.drivenKph > MOVING_KPH && !s.inCombat && !s.stranded && !s.towed;
}

export type SlowCause = 'storm' | 'topSpeed' | 'accelerating' | 'slowing' | 'other';
export const SLOW_CAUSES: readonly SlowCause[] = ['storm', 'topSpeed', 'accelerating', 'slowing', 'other'];

// Why a moving truck drove under the line this turn: weather, a top speed under it (guns, load, chassis), a start or
// a corner it is still speeding up from, or a stop or a truck ahead it is braking for.
export function slowCause(s: TrafficSample): SlowCause {
  if (s.weatherSpeed < 1) return 'storm';
  if (s.maxKph < SLOW_KPH) return 'topSpeed';
  if (s.endKph > s.startKph + 1) return 'accelerating';
  if (s.endKph < s.startKph - 1) return 'slowing';
  return 'other';
}

export const SLOW_KPH = 45;
const FAIR_KPH = 55;

export type Spread = { count: number; p10: number; p25: number; median: number; mean: number; p75: number; p90: number; below45: number; below55: number };

export function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const share = (limit: number) => (sorted.length ? sorted.filter((x) => x < limit).length / sorted.length : NaN);
  return {
    count: sorted.length,
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : NaN,
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    below45: share(SLOW_KPH),
    below55: share(FAIR_KPH),
  };
}

// The nearest-rank quantile of an ascending list.
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
}

export type TrafficSummary = {
  layer: TrafficLayer;
  seeds: number[];
  turns: number;
  steady: Record<TrafficClass, Spread>; // steady cruise km/h per class
  cruising: Record<TrafficClass, Spread>; // every moving road sample per class
  healthyByChassis: [string, Spread][]; // steady cruise of healthy ordinary cars, busiest chassis first
  healthySlowCauses: Record<SlowCause, number>; // share of healthy ordinary cruising samples under 45 km/h by cause
  lowFuelShare: number; // share of ordinary cruising samples under the low-fuel line
  resupplyStarts: number;
  maxDry: number;
  collisionsPer100NpcTurns: number;
};

export function summarize(runs: TrafficRun[]): TrafficSummary {
  if (!runs.length || runs.some((r) => r.layer !== runs[0].layer)) throw new Error('summarize needs runs of one layer');
  const cruising = runs.flatMap((r) => r.samples).filter(isCruising);
  const steady = cruising.filter(isSteadyCruise);
  const healthy = cruising.filter((s) => classify(s) === 'healthyOrdinary');
  const ordinary = cruising.filter((s) => ['healthyOrdinary', 'lowFuelOrdinary', 'wornOrdinary'].includes(classify(s)));
  const npcTurns = runs.reduce((a, r) => a + r.npcTurns, 0);
  return {
    layer: runs[0].layer,
    seeds: runs.map((r) => r.seed),
    turns: runs[0].turns,
    steady: byClass(steady),
    cruising: byClass(cruising),
    healthyByChassis: byChassis(steady.filter((s) => classify(s) === 'healthyOrdinary')),
    healthySlowCauses: causeShares(healthy.filter((s) => s.drivenKph < SLOW_KPH)),
    lowFuelShare: ordinary.length ? ordinary.filter((s) => classify(s) === 'lowFuelOrdinary').length / ordinary.length : NaN,
    resupplyStarts: runs.reduce((a, r) => a + r.resupplyStarts, 0),
    maxDry: Math.max(...runs.map((r) => r.maxDry)),
    collisionsPer100NpcTurns: npcTurns ? (100 * runs.reduce((a, r) => a + r.collisions, 0)) / npcTurns : NaN,
  };
}

function byClass(samples: TrafficSample[]): Record<TrafficClass, Spread> {
  const out = {} as Record<TrafficClass, Spread>;
  for (const c of TRAFFIC_CLASSES) out[c] = spread(samples.filter((s) => classify(s) === c).map((s) => s.drivenKph));
  return out;
}

function byChassis(samples: TrafficSample[]): [string, Spread][] {
  const ids = [...new Set(samples.map((s) => s.chassisId))];
  return ids.map((id): [string, Spread] => [id, spread(samples.filter((s) => s.chassisId === id).map((s) => s.drivenKph))])
    .sort((a, b) => b[1].count - a[1].count);
}

function causeShares(samples: TrafficSample[]): Record<SlowCause, number> {
  const out = {} as Record<SlowCause, number>;
  for (const c of SLOW_CAUSES) out[c] = samples.length ? samples.filter((s) => slowCause(s) === c).length / samples.length : NaN;
  return out;
}

const num = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '-');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '-');
const spreadRow = (name: string, s: Spread) =>
  `| ${name} | ${s.count} | ${num(s.p10)} | ${num(s.p25)} | ${num(s.median)} | ${num(s.mean)} | ${num(s.p75)} | ${num(s.p90)} | ${pct(s.below45)} | ${pct(s.below55)} |`;
const SPREAD_HEAD = ['| | samples | p10 | p25 | median | mean | p75 | p90 | <45 | <55 |', '|---|---|---|---|---|---|---|---|---|---|'];

export function formatTraffic(summaries: TrafficSummary[]): string {
  return summaries.map(formatOne).join('\n\n');
}

function formatOne(s: TrafficSummary): string {
  const how = s.layer === 'physics'
    ? 'every NPC drives in Rapier: the script widens PERF.liveMargin and PHYSICS.propLiveMargin past the map'
    : 'every NPC travels far, without physics, as in the stuck soak';
  return [
    `## ${s.layer} layer, seeds ${s.seeds.join(',')}, ${s.turns} turns each`,
    `${how}. Speeds are km/h of the path driven in one turn.`,
    '', '### Steady cruise per class (open road, outside storms and fights, start and end speeds within 10%)', '', ...SPREAD_HEAD,
    ...TRAFFIC_CLASSES.map((c) => spreadRow(c, s.steady[c])),
    '', '### All moving road samples per class', '', ...SPREAD_HEAD,
    ...TRAFFIC_CLASSES.map((c) => spreadRow(c, s.cruising[c])),
    '', '### Steady cruise of healthy ordinary cars per chassis', '', ...SPREAD_HEAD,
    ...s.healthyByChassis.map(([id, sp]) => spreadRow(id, sp)),
    '', `Healthy ordinary moving samples under ${SLOW_KPH} km/h by cause: ${SLOW_CAUSES.map((c) => `${c} ${pct(s.healthySlowCauses[c])}`).join(', ')}.`,
    `Low-fuel share of ordinary moving samples: ${pct(s.lowFuelShare)}.`,
    `Resupply goal starts: ${s.resupplyStarts}. Most NPCs dry at once: ${s.maxDry}. Collisions per 100 NPC turns: ${s.collisionsPer100NpcTurns.toFixed(2)}.`,
  ].join('\n');
}

// Plays one seed with the player parked at its start town in god mode, like the stuck soak.
export async function recordTraffic(seed: number, turns: number, layer: TrafficLayer): Promise<TrafficRun> {
  if (!TRAFFIC_LAYERS.includes(layer)) throw new Error(`unknown traffic layer "${layer}"`);
  let w = newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  w.player.god = true;
  const run: TrafficRun = { seed, layer, turns, samples: [], npcTurns: 0, resupplyStarts: 0, maxDry: 0, collisions: 0 };
  const play = layer === 'physics' ? await physicsPlayer(w) : farPlayer();
  const goals = new Map<string, string | null>();
  for (let i = 0; i < turns; i++) {
    if (w.player.call) w = hangUp(w);
    const before = new Map(w.vehicles.filter((v) => v.brain).map((v) => [v.id, startOf(w, v, seed, layer)]));
    w = play.turn(w);
    record(w, before, run, goals);
  }
  play.free();
  return run;
}

type Player = { turn: (w: World) => World; free: () => void };

function farPlayer(): Player {
  return { turn: (w) => endTurn(w, (x) => { for (const v of x.vehicles) advanceFar(x, v); }), free: () => {} };
}

async function physicsPlayer(w: World): Promise<Player> {
  await initPhysics();
  let d: Drive = buildDrive(w);
  return {
    turn: (x) => {
      let next: Drive | null = null;
      const out = endTurn(x, physicsMove(d, (r) => { next = r.next; }));
      freeDrive(d);
      d = next!;
      return out;
    },
    free: () => freeDrive(d),
  };
}

// What a sample needs from the turn's start.
function startOf(w: World, v: Vehicle, seed: number, layer: TrafficLayer): TrafficSample {
  const engine = mountedParts(v, 'engine')[0];
  const fuel = getResources(w, v).fuel;
  const cap = fuelCap(v);
  return {
    seed, turn: w.turn + 1, vehicle: v.id, templateId: v.brain!.templateId, chassisId: v.chassisId, layer,
    startKph: v.speed * KPH, endKph: 0, drivenKph: 0, maxKph: vehicleStats(w, v).maxSpeed * KPH,
    fuelShare: cap > 0 ? fuel / cap : 0, lowFuel: fuel > 0 && fuel < cap * RULES.lowFuelThreshold,
    mobility: getMobilityCondition(v), brokenWheels: coreParts(v, 'wheel').filter((p) => p.hp <= 0).length,
    gunDrag: engine ? gunDrag(v, wornDef<EngineDef>(engine).capacity) : 1, loadFactor: loadFactor(v),
    weatherSpeed: weatherAt(w, v.pos).speed, onRoad: isRoad(w, v.pos), stranded: isStranded(w, v),
    towing: isTowing(w, v.id), towed: isOnRope(w, v.id), inCombat: inCombat(w, v), goal: v.brain!.goals.at(-1)?.kind ?? null,
  };
}

function record(w: World, before: Map<string, TrafficSample>, run: TrafficRun, goals: Map<string, string | null>): void {
  run.collisions += w.events.filter((e) => e.t === 'collision').length;
  const drivers = w.vehicles.filter((v) => v.brain);
  run.npcTurns += drivers.length;
  run.maxDry = Math.max(run.maxDry, drivers.filter((v) => getResources(w, v).fuel <= 0).length);
  for (const v of drivers) {
    const goal = v.brain!.goals.at(-1)?.kind ?? null;
    if (goal === 'resupply' && goals.has(v.id) && goals.get(v.id) !== 'resupply') run.resupplyStarts++;
    goals.set(v.id, goal);
    const start = before.get(v.id);
    if (!start) continue;
    const s = { ...start, endKph: v.speed * KPH, drivenKph: pathLength(v.trail) * KPH, onRoad: start.onRoad && isRoad(w, v.pos) };
    if (isCruising(s)) run.samples.push(s);
  }
}

function isRoad(w: World, p: Vec): boolean {
  return TERRAIN_TYPES[w.terrain.types[tileAt(w.terrain, p)]].speed >= ROAD_SPEED;
}

function pathLength(trail: Pose[]): number {
  let d = 0;
  for (let i = 1; i < trail.length; i++) d += dist(trail[i - 1], trail[i]);
  return d;
}
