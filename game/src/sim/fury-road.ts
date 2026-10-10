import { FURY_ROAD, type Curve } from '../data/modes';
import { GARAGE_STOCK } from '../data/market';
import { NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { chassisDef } from '../data/chassis';
import { inCombatWith } from './combat';
import { isDefeated } from './defeat';
import { playerVehicle } from './damage';
import { alongOf, highwayMap, milestoneAt, outpostFort, outpostId, outpostSite, roadPoint, stretchStream, toRoad, WINDOW_SHIFT } from './highway';
import { canUseSite, sitePads } from './sites';
import { mapObstacles } from './mapgen';
import { rollPartStockPerKind } from './market';
import { fightCornered, topGoal } from './npc-activities';
import { generateNpcLoadout } from './npc-loadout';
import { nextRandom, randInt, type Rng } from './rng';
import { modeRules } from './settings';
import { isFree, spawnAt } from './spawn';
import { declareFeud, settleStates } from './states';
import { getResources } from './resources';
import { fuelCap, isStranded } from './stats';
import { refreshTrack } from './tracks';
import type { FuryRoadRun, GroupSide, OutpostFacts, PartInstance, RunLossCause, Vehicle, WaveGroup, World } from './types';
import { refreshVision } from './vision';
import { dist, type Vec } from './vec';
import { playerCommand } from './world';


export type Outpost = OutpostFacts & { id: string; pad: Vec };
export type FuryRoadReadout = { stretch: number; toOutpost: number; outpostId: string };

export { outpostId };

function curveAt(c: Curve, j: number): number {
  return Math.min(c.max, c.first + c.step * (j - 1));
}

export function payOf(j: number, wrecks: number): number {
  return curveAt(FURY_ROAD.pay.base, j) + curveAt(FURY_ROAD.pay.perWreck, j) * wrecks;
}

export function waveOf(j: number): (typeof FURY_ROAD.waves)[number] {
  if (!Number.isInteger(j) || j < 1) throw new Error(`Stretch ${j} has no wave`);
  return FURY_ROAD.waves[Math.min(j, FURY_ROAD.waves.length) - 1];
}

const SIDES: readonly GroupSide[] = ['ahead', 'behind', 'left', 'right'];

export function planStretch(seed: number, j: number): WaveGroup[] {
  const rng = stretchStream(seed, j, 'groups');
  const sides = stretchStream(seed, j, 'sides');
  const wave = waveOf(j);
  const weights = poolOf(j);
  let last: GroupSide | null = null;
  return wave.sizes.map((size, i) => {
    const from = drawSide(sides, last);
    last = from;
    return {
      id: `g${j}-${i}`,
      stretch: j,
      from,
      templates: Array.from({ length: size }, () => drawTemplate(rng, weights)),
      level: wave.level,
      spawned: false,
      vehicles: [],
      engaged: [],
      wrecked: 0,
      counted: [],
      retryUntil: null,
    };
  });
}

function poolOf(j: number): Record<string, number> {
  const tier = FURY_ROAD.pool.find((t) => j <= t.upTo);
  if (!tier || Object.values(tier.weights).every((w) => w <= 0)) throw new Error(`Stretch ${j} has no NPC templates in its pool tier`);
  return tier.weights;
}

function drawTemplate(rng: Rng, weights: Record<string, number>): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let roll = nextRandom(rng) * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[entries.length - 1][0];
}

function drawSide(rng: Rng, last: GroupSide | null): GroupSide {
  const open = SIDES.filter((side) => side !== last);
  return open[randInt(rng, 0, open.length - 1)];
}

function outpostFacts(world: World, j: number): OutpostFacts {
  const stock: PartInstance[] = rollPartStockPerKind(world, stretchStream(world.seed, j, 'stock'), GARAGE_STOCK, FURY_ROAD.stockPerKind, outpostId(j));
  return { milestone: j, stock, paid: false, trucksSold: [] };
}

export function truckOffers(seed: number, j: number): string[] {
  const { offers, pool } = FURY_ROAD.trucks;
  if (pool.length < offers) throw new Error(`The Fury Road truck pool holds ${pool.length} chassis, fewer than ${offers} offers`);
  const rng = stretchStream(seed, j, 'trucks');
  const left = [...pool];
  return Array.from({ length: offers }, () => left.splice(randInt(rng, 0, left.length - 1), 1)[0]);
}

export function outpostTrucks(world: World, post: OutpostFacts): string[] {
  return truckOffers(world.seed, post.milestone).filter((id) => !post.trucksSold.includes(id));
}

export function startRun(world: World): void {
  if (world.terrain.atlas.kind !== 'highway' || world.terrain.atlas.window !== 0) throw new Error(`A Fury Road run starts on highway window 0, not map ${world.mapHash}`);
  world.furyRoad = { window: 0, outposts: [outpostFacts(world, 1)], groups: planStretch(world.seed, 1), earned: 0, wrecks: 0, quietFrom: world.turn };
}

function runOf(world: World): FuryRoadRun {
  if (!world.furyRoad) throw new Error('No Fury Road run in this world');
  return world.furyRoad;
}

export function outpostPad(world: World, milestone: number): Vec {
  return sitePads(outpostFort(world.seed, runOf(world).window, milestone))[0];
}

function outpostOf(world: World, facts: OutpostFacts): Outpost {
  return { ...facts, id: outpostId(facts.milestone), pad: outpostPad(world, facts.milestone) };
}

export function outpostFactsAt(world: World, milestone: number): OutpostFacts {
  return factsOf(runOf(world), milestone);
}

function factsOf(run: FuryRoadRun, milestone: number): OutpostFacts {
  const facts = run.outposts.find((o) => o.milestone === milestone);
  if (!facts) throw new Error(`The run holds no outpost ${milestone} in window ${run.window}`);
  return facts;
}

export function advanceFuryRoad(world: World): void {
  const run = world.furyRoad;
  if (!run || world.player.state !== 'active' || betweenLevels(world)) return;
  countBeaten(world, run);
  retireWoken(world, run);
  huntPlayer(world, run);
  noteEngaged(world, run);
  if (arrivedAtNext(world, run)) return completeStretch(world, run);
  pace(world, run);
  spawnNext(world, run, playerProgress(world, run));
}

function playerProgress(world: World, run: FuryRoadRun): number {
  return alongOf(world.seed, toRoad(run.window, playerVehicle(world).pos));
}

function countBeaten(world: World, run: FuryRoadRun): void {
  for (const e of world.events) {
    if (e.t !== 'destroyed' && e.t !== 'npcKnockout') continue;
    const group = run.groups.find((g) => g.vehicles.includes(e.vehicle));
    if (!group || group.counted.includes(e.vehicle)) continue;
    group.counted.push(e.vehicle);
    group.wrecked++;
  }
}

function retireWoken(world: World, run: FuryRoadRun): void {
  const ids = new Set(run.groups.flatMap((g) => g.vehicles));
  const woken = world.vehicles.filter((v) => ids.has(v.id) && v.defeat?.phase === 'retreat');
  if (woken.length > 0) removeVehicles(world, woken.map((v) => v.id));
}

function fighting(world: World, group: WaveGroup): Vehicle[] {
  return world.vehicles.filter((v) => group.vehicles.includes(v.id) && !isDefeated(v));
}

function aliveCount(world: World, run: FuryRoadRun): number {
  return run.groups.reduce((n, g) => n + fighting(world, g).length, 0);
}

function huntPlayer(world: World, run: FuryRoadRun): void {
  const me = playerVehicle(world);
  for (const group of run.groups) {
    for (const v of fighting(world, group)) {
      declareFeud(world, v, me.id);
      if (huntsPlayer(world, v)) refreshTrack(world, v, me.id, me.pos);
      else fightCornered(world, v, me);
    }
  }
}

function huntsPlayer(world: World, v: Vehicle): boolean {
  const top = topGoal(v);
  return top?.kind === 'fight' && top.targetId === world.player.vehicleId;
}

function noteEngaged(world: World, run: FuryRoadRun): void {
  const me = playerVehicle(world);
  for (const group of run.groups) {
    for (const v of fighting(world, group)) {
      if (group.engaged.includes(v.id)) continue;
      if (dist(v.pos, me.pos) <= FURY_ROAD.catchUp.engageAt || inCombatWith(world, v, me)) group.engaged.push(v.id);
    }
  }
}

function encounterOn(world: World, run: FuryRoadRun): boolean {
  const me = playerVehicle(world);
  return run.groups.some((g) => fighting(world, g).some((v) => dist(v.pos, me.pos) <= FURY_ROAD.pacing.near));
}

function pace(world: World, run: FuryRoadRun): void {
  if (encounterOn(world, run)) run.quietFrom = world.turn;
}

function spawnNext(world: World, run: FuryRoadRun, progress: number): void {
  if (world.turn - run.quietFrom < FURY_ROAD.pacing.quiet) return;
  const group = run.groups.find((g) => !g.spawned);
  if (!group || aliveCount(world, run) + group.templates.length > FURY_ROAD.maxAlive) return;
  spawnGroup(world, run, group, progress);
}

export function spawnGroup(world: World, run: FuryRoadRun, group: WaveGroup, progress: number): void {
  const loadouts = group.templates.map((id) => ({ tpl: NPCS[id], loadout: { ...generateNpcLoadout(world, NPCS[id], null, group.level), cargo: {} } }));
  const spots = groupSpots(world, run, group.from, progress, loadouts.map((l) => chassisDef(l.loadout.chassisId).radius));
  if (!spots) return retryLater(world, group);
  const me = playerVehicle(world);
  loadouts.forEach(({ tpl, loadout }, i) => {
    const v = spawnAt(world, tpl, loadout, spots[i]);
    getResources(world, v).fuel = fuelCap(v);
    v.heading = Math.atan2(me.pos.y - v.pos.y, me.pos.x - v.pos.x);
    group.vehicles.push(v.id);
    declareFeud(world, v, me.id);
    fightCornered(world, v, me);
  });
  group.spawned = true;
  group.retryUntil = null;
}

type Candidate = { along: number; across: number };

function groupSpots(world: World, run: FuryRoadRun, from: GroupSide, progress: number, radii: number[]): Vec[] | null {
  const candidates = spotCandidates(from, progress);
  const spots: Vec[] = [];
  for (const radius of radii) {
    const spot = freeSpot(world, run, candidates, radius, spots);
    if (!spot) return null;
    spots.push(spot);
  }
  return spots;
}

function spotCandidates(from: GroupSide, progress: number): Candidate[] {
  const make = from === 'left' || from === 'right' ? flankCandidate(from, progress) : roadCandidate(from, progress);
  return Array.from({ length: FURY_ROAD.maxTries / 10 }, (_, step) => make(step));
}

function flankCandidate(from: 'left' | 'right', progress: number): (step: number) => Candidate {
  const flank = FURY_ROAD.sides.flank;
  const across = (from === 'left' ? -1 : 1) * flank.across;
  return (step) => ({ along: progress + flank.along + Math.ceil(step / 2) * (step % 2 === 0 ? 1 : -1) * flank.step, across });
}

function roadCandidate(from: 'ahead' | 'behind', progress: number): (step: number) => Candidate {
  const offsets = FURY_ROAD.spawnOffsets;
  const along = from === 'ahead' ? progress + FURY_ROAD.sides.ahead : progress - FURY_ROAD.sides.behind;
  return (step) => {
    const offset = Math.floor(step / offsets.length) * FURY_ROAD.spawnStagger;
    return { along: along + (step % 2 === 0 ? offset : -offset), across: offsets[step % offsets.length] };
  };
}

function freeSpot(world: World, run: FuryRoadRun, candidates: Candidate[], radius: number, taken: Vec[]): Vec | null {
  const from = milestoneAt(run.window);
  const to = milestoneAt(run.window + 1);
  for (const c of candidates) {
    const pos = roadPoint(world.seed, run.window, Math.min(Math.max(c.along, from), to), c.across);
    if (!insideWindow(world, pos, radius)) continue;
    if (isFree(world, pos, radius, null) && taken.every((t) => dist(t, pos) > radius * 2 + 0.5)) return pos;
  }
  return null;
}

function insideWindow(world: World, pos: Vec, radius: number): boolean {
  return pos.x >= radius && pos.y >= radius && pos.x <= world.size - radius && pos.y <= world.size - radius;
}

function retryLater(world: World, group: WaveGroup): void {
  if (group.retryUntil === null) group.retryUntil = world.turn + FURY_ROAD.spawnRetryTurns;
  else if (world.turn > group.retryUntil) throw new Error(`Fury Road group ${group.id} found no free lane spot for ${FURY_ROAD.spawnRetryTurns} turns`);
}

function parkedOnPad(world: World, milestone: number): boolean {
  const me = playerVehicle(world);
  return me.speed <= RULES.parkedSpeed && onOutpostPad(world, me.pos, milestone);
}

function onOutpostPad(world: World, pos: Vec, milestone: number): boolean {
  return canUseSite(pos, outpostFort(world.seed, runOf(world).window, milestone));
}

function arrivedAtNext(world: World, run: FuryRoadRun): boolean {
  return parkedOnPad(world, run.window + 1);
}

export function betweenLevels(world: World): boolean {
  const run = world.furyRoad;
  return run !== null && factsOf(run, run.window + 1).paid;
}

export function canWaitForRoad(world: World): boolean {
  const run = world.furyRoad;
  return run !== null && world.player.state === 'active' && betweenLevels(world) && parkedOnPad(world, run.window + 1);
}

export function waitForRoad(world: World): World {
  return playerCommand(world, (w) => {
    if (!canWaitForRoad(w)) throw new Error('Only a player parked on the pad of a paid outpost can wait for the road');
    moveWindow(w);
    w.events.push({ t: 'roadOpened', stretch: runOf(w).window + 1 });
  });
}

function completeStretch(world: World, run: FuryRoadRun): void {
  const j = run.window + 1;
  const post = factsOf(run, j);
  const wrecks = run.groups.reduce((n, g) => n + g.wrecked, 0);
  const pay = payOf(j, wrecks);
  world.player.money += pay;
  world.events.push({ t: 'money', amount: pay, reason: { kind: 'outpost' } });
  post.paid = true;
  run.earned += pay;
  run.wrecks += wrecks;
  removeVehicles(world, run.groups.flatMap((g) => g.vehicles));
  run.groups = [];
  world.events.push({ t: 'outpostReached', milestone: j, pay, wrecks });
}

function removeVehicles(world: World, ids: string[]): void {
  const gone = new Set(ids);
  world.removed.push(...world.vehicles.filter((v) => gone.has(v.id)));
  world.vehicles = world.vehicles.filter((v) => !gone.has(v.id));
  settleStates(world);
}

type Move = 'shift' | 'rebuild' | 'drop' | 'keep';

export const WINDOW_MOVE = {
  seed: 'keep',
  rngState: 'keep',
  marketRng: 'keep',
  nameRng: 'keep',
  searchRng: 'keep',
  turn: 'keep',
  size: 'keep',
  nextId: 'keep',
  setup: 'keep',
  events: 'keep',
  removed: 'keep',
  spawnTimer: 'keep',
  shops: 'keep',
  salvage: 'keep',
  player: 'shift',
  vehicles: 'shift',
  weather: 'shift',
  terrain: 'rebuild',
  mapHash: 'rebuild',
  obstacles: 'rebuild',
  furyRoad: 'rebuild',
  broken: 'drop',
  craters: 'drop',
  dustClouds: 'drop',
  states: 'drop',
  smoke: 'drop',
  fields: 'drop',
  flares: 'drop',
  lines: 'drop',
} as const satisfies { [K in keyof World]-?: Move };

const DROPPED: { [K in keyof World as (typeof WINDOW_MOVE)[K] extends 'drop' ? K : never]: () => World[K] } = {
  broken: () => [],
  craters: () => [],
  dustClouds: () => [],
  states: () => [],
  smoke: () => [],
  fields: () => [],
  flares: () => [],
  lines: () => [],
};

function requireMovable(world: World, run: FuryRoadRun): void {
  if (!factsOf(run, run.window + 1).paid) throw new Error(`The window moves only once outpost ${run.window + 1} is paid`);
  if (aliveCount(world, run) > 0) throw new Error('The window cannot move while a group truck is alive');
  if (!parkedOnPad(world, run.window + 1)) throw new Error(`The window moves only with the player parked at outpost ${run.window + 1}`);
  if (world.salvage.length > 0 || Object.keys(world.shops).length > 0) throw new Error('A Fury Road window holds no salvage and no shops');
}

export function moveWindow(world: World): void {
  const run = runOf(world);
  requireMovable(world, run);
  const next = run.window + 1;
  const map = highwayMap(world.seed, next);
  for (const key of Object.keys(DROPPED) as (keyof typeof DROPPED)[]) (world as Record<string, unknown>)[key] = DROPPED[key]();
  shiftVehicles(world);
  shiftPlayer(world);
  shiftStorms(world);
  world.terrain = map.terrain;
  world.mapHash = map.hash;
  world.obstacles = mapObstacles(map);
  run.window = next;
  run.outposts = [...run.outposts.filter((o) => o.milestone === next), outpostFacts(world, next + 1)];
  run.groups = planStretch(world.seed, next + 1);
  run.quietFrom = world.turn;
  refreshVision(world);
}

function shifted(p: Vec): Vec {
  return { x: p.x + WINDOW_SHIFT.x, y: p.y + WINDOW_SHIFT.y };
}

function shiftStorms(world: World): void {
  for (const storm of world.weather) if (storm.kind === 'storm') storm.pos = shifted(storm.pos);
}

function shiftVehicles(world: World): void {
  const me = playerVehicle(world);
  world.removed.push(...world.vehicles.filter((v) => v !== me));
  world.vehicles = [me];
  me.pos = shifted(me.pos);
  me.order = null;
  me.trail = [];
  me.weaponOrders = {};
  me.utilityOrders = {};
}

function shiftPlayer(world: World): void {
  const p = world.player;
  const size = world.size;
  const explored = new Uint8Array(size * size);
  const { x: sx, y: sy } = WINDOW_SHIFT;
  const fromX = Math.max(0, -sx);
  const toX = Math.min(size, size - sx);
  for (let y = Math.max(0, -sy); y < Math.min(size, size - sy); y++) explored.set(p.explored.subarray(y * size + fromX, y * size + toX), (y + sy) * size + fromX + sx);
  p.explored = explored;
  p.marked = [];
  p.hostilesSeen = [];
}

export function endRun(world: World, cause: RunLossCause): void {
  const run = runOf(world);
  if (world.player.state === 'dead') throw new Error('The run has already ended');
  world.player.state = 'dead';
  world.events.push({ t: 'runLost', stretch: run.window + 1, cause });
}

export function canAbandonRun(world: World): boolean {
  return world.furyRoad !== null && !modeRules(world).rescue && world.player.state === 'active' && isStranded(world, playerVehicle(world));
}

export function abandonRun(world: World): World {
  return playerCommand(world, (w) => {
    if (!canAbandonRun(w)) throw new Error('Only a stranded truck on a run with no rescue can end the run');
    endRun(w, 'abandoned');
  });
}

export function runEarnings(world: World): { pay: number; wrecks: number; reached: number; north: number } {
  const run = runOf(world);
  return {
    pay: run.earned,
    wrecks: run.wrecks + run.groups.reduce((n, g) => n + g.wrecked, 0),
    reached: run.window + (betweenLevels(world) ? 1 : 0),
    north: Math.max(0, playerProgress(world, run) - milestoneAt(0)),
  };
}

export function nextOutpost(world: World): Outpost | null {
  const run = world.furyRoad;
  return run ? outpostOf(world, factsOf(run, run.window + 1)) : null;
}

export function reachedOutpostAt(world: World): Outpost | null {
  const near = outpostNear(world);
  return near && playerVehicle(world).speed <= RULES.parkedSpeed ? near : null;
}

export function outpostNear(world: World): Outpost | null {
  const run = world.furyRoad;
  if (!run) return null;
  const me = playerVehicle(world);
  const facts = run.outposts.find((post) => post.paid && onOutpostPad(world, me.pos, post.milestone));
  return facts ? outpostOf(world, facts) : null;
}

export function furyRoadReadout(world: World): FuryRoadReadout | null {
  const run = world.furyRoad;
  if (!run) return null;
  if (betweenLevels(world)) return fullStretch(world, run.window + 2);
  const j = run.window + 1;
  return { stretch: j, toOutpost: Math.max(0, outpostSite(world.seed, j).n - playerProgress(world, run)), outpostId: outpostId(j) };
}

function fullStretch(world: World, j: number): FuryRoadReadout {
  return { stretch: j, toOutpost: outpostSite(world.seed, j).n - outpostSite(world.seed, j - 1).n, outpostId: outpostId(j) };
}
