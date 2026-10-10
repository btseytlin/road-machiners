import { FURY_ROAD, type Curve } from '../data/modes';
import { GARAGE_STOCK } from '../data/market';
import { NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { chassisDef } from '../data/chassis';
import { inCombat } from './combat';
import { playerVehicle } from './damage';
import { highwayMap, milestoneAt, outpostFort, outpostId, outpostSite, roadPoint, STRIDE, stretchStream, toRoad } from './highway';
import { canUseSite, sitePads } from './sites';
import { mapObstacles } from './mapgen';
import { rollPartStock } from './market';
import { fightCornered, topGoal } from './npc-activities';
import { generateNpcLoadout } from './npc-loadout';
import { randInt } from './rng';
import { stretchLayout } from './road-hazards';
import { modeRules } from './settings';
import { isFree, spawnAt } from './spawn';
import { declareFeud } from './states';
import { getResources } from './resources';
import { fuelCap, isStranded } from './stats';
import { refreshTrack } from './tracks';
import type { FuryRoadRun, OutpostFacts, PartInstance, RunLossCause, Vehicle, WaveGroup, World } from './types';
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

export function stockSizeOf(j: number): number {
  const s = FURY_ROAD.stock;
  return Math.min(s.max, s.base + Math.floor(j / s.every));
}

export function waveOf(j: number): (typeof FURY_ROAD.waves)[number] {
  if (!Number.isInteger(j) || j < 1) throw new Error(`Stretch ${j} has no wave`);
  return FURY_ROAD.waves[Math.min(j, FURY_ROAD.waves.length) - 1];
}

export function planStretch(seed: number, j: number): WaveGroup[] {
  const rng = stretchStream(seed, j, 'groups');
  const all = stretchLayout(seed, j).arenas;
  const arenas = all.length > 1 ? all.slice(1) : all;
  const wave = waveOf(j);
  const anchors = wave.map(() => arenas[randInt(rng, 0, arenas.length - 1)]).map((a) => (a.from + a.to) / 2).sort((a, b) => a - b);
  return wave.map((plan, i) => ({
    id: `g${j}-${i}`,
    stretch: j,
    at: anchors[i],
    from: plan.from,
    templates: [...plan.templates],
    level: plan.level,
    spawned: false,
    vehicles: [],
    wrecked: 0,
    retryUntil: null,
  }));
}

function outpostFacts(world: World, j: number): OutpostFacts {
  const stock: PartInstance[] = rollPartStock(world, stretchStream(world.seed, j, 'stock'), GARAGE_STOCK, stockSizeOf(j), outpostId(j));
  return { milestone: j, stock, paid: false };
}

export function startRun(world: World): void {
  if (world.terrain.atlas.kind !== 'highway' || world.terrain.atlas.window !== 0) throw new Error(`A Fury Road run starts on highway window 0, not map ${world.mapHash}`);
  world.furyRoad = { window: 0, outposts: [outpostFacts(world, 1)], groups: planStretch(world.seed, 1), earned: 0, wrecks: 0 };
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
  if (!run || world.player.state !== 'active') return;
  countWrecks(world, run);
  huntPlayer(world, run);
  if (arrivedAtNext(world, run)) completeStretch(world, run);
  else spawnDueGroups(world, run, playerProgress(world, run));
}

function playerProgress(world: World, run: FuryRoadRun): number {
  return toRoad(run.window, playerVehicle(world).pos).n;
}

function countWrecks(world: World, run: FuryRoadRun): void {
  for (const e of world.events) {
    if (e.t !== 'destroyed') continue;
    const group = run.groups.find((g) => g.vehicles.includes(e.vehicle));
    if (group) group.wrecked++;
  }
}

function liveTrucks(world: World, group: WaveGroup): Vehicle[] {
  return world.vehicles.filter((v) => group.vehicles.includes(v.id));
}

function aliveCount(world: World, run: FuryRoadRun): number {
  return run.groups.reduce((n, g) => n + liveTrucks(world, g).length, 0);
}

function huntPlayer(world: World, run: FuryRoadRun): void {
  const me = playerVehicle(world);
  for (const group of run.groups) {
    for (const v of liveTrucks(world, group)) {
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

function spawnDueGroups(world: World, run: FuryRoadRun, progress: number): void {
  for (const group of run.groups.filter((g) => !g.spawned && isDue(g, progress))) {
    if (aliveCount(world, run) + group.templates.length > FURY_ROAD.maxAlive) return;
    spawnGroup(world, run, group, progress);
  }
}

function isDue(group: WaveGroup, progress: number): boolean {
  return progress >= (group.from === 'ahead' ? group.at - FURY_ROAD.spawnLead : group.at);
}

function spawnAlong(run: FuryRoadRun, group: WaveGroup, progress: number): number {
  const along = group.from === 'ahead' ? Math.max(group.at, progress + FURY_ROAD.aheadGap) : progress - FURY_ROAD.behindGap;
  return Math.min(Math.max(along, milestoneAt(run.window)), milestoneAt(run.window + 1));
}

export function spawnGroup(world: World, run: FuryRoadRun, group: WaveGroup, progress: number): void {
  const along = spawnAlong(run, group, progress);
  const loadouts = group.templates.map((id) => ({ tpl: NPCS[id], loadout: { ...generateNpcLoadout(world, NPCS[id], null, group.level), cargo: {} } }));
  const spots = groupSpots(world, run, along, loadouts.map((l) => chassisDef(l.loadout.chassisId).radius));
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

function groupSpots(world: World, run: FuryRoadRun, along: number, radii: number[]): Vec[] | null {
  const spots: Vec[] = [];
  for (const radius of radii) {
    const spot = laneSpot(world, run, along, radius, spots);
    if (!spot) return null;
    spots.push(spot);
  }
  return spots;
}

function laneSpot(world: World, run: FuryRoadRun, along: number, radius: number, taken: Vec[]): Vec | null {
  for (let step = 0; step < FURY_ROAD.maxTries / 10; step++) {
    const offsets = FURY_ROAD.spawnOffsets;
    const lane = offsets[step % offsets.length];
    const offset = Math.floor(step / offsets.length) * FURY_ROAD.spawnStagger;
    const pos = roadPoint(world.seed, run.window, along + (step % 2 === 0 ? offset : -offset), lane);
    if (isFree(world, pos, radius, null) && taken.every((t) => dist(t, pos) > radius * 2 + 0.5)) return pos;
  }
  return null;
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
  return parkedOnPad(world, run.window + 1) && !inCombat(world, playerVehicle(world));
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
  removeSurvivors(world, run.groups);
  world.events.push({ t: 'outpostReached', milestone: j, pay, wrecks });
  moveWindow(world);
}

function removeSurvivors(world: World, groups: WaveGroup[]): void {
  const gone = new Set(groups.flatMap((g) => g.vehicles));
  world.removed.push(...world.vehicles.filter((v) => gone.has(v.id)));
  world.vehicles = world.vehicles.filter((v) => !gone.has(v.id));
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
  refreshVision(world);
}

function shiftStorms(world: World): void {
  for (const storm of world.weather) if (storm.kind === 'storm') storm.pos = { x: storm.pos.x + STRIDE, y: storm.pos.y + STRIDE };
}

function shiftVehicles(world: World): void {
  const me = playerVehicle(world);
  world.removed.push(...world.vehicles.filter((v) => v !== me));
  world.vehicles = [me];
  me.pos = { x: me.pos.x + STRIDE, y: me.pos.y + STRIDE };
  me.order = null;
  me.trail = [];
  me.weaponOrders = {};
  me.utilityOrders = {};
}

function shiftPlayer(world: World): void {
  const p = world.player;
  const size = world.size;
  const explored = new Uint8Array(size * size);
  const kept = size - STRIDE;
  for (let y = 0; y < kept; y++) explored.set(p.explored.subarray(y * size, y * size + kept), (y + STRIDE) * size + STRIDE);
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
    reached: run.window,
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
  const j = run.window + 1;
  return { stretch: j, toOutpost: Math.max(0, outpostSite(world.seed, j).n - playerProgress(world, run)), outpostId: outpostId(j) };
}
