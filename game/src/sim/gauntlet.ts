import { GAUNTLET } from '../data/gauntlet';
import { NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { inCombat } from './combat';
import { playerVehicle } from './damage';
import { courseLine, pointAt, progressOf, type CourseLine } from './gauntlet-layout';
import { fightCornered, topGoal } from './npc-activities';
import { generateNpcLoadout } from './npc-loadout';
import { modeRules } from './settings';
import { isFree, spawnAt } from './spawn';
import { declareFeud } from './states';
import { isStranded } from './stats';
import { refreshTrack } from './tracks';
import { chassisDef } from '../data/chassis';
import type { GauntletRun, Outpost, RunLossCause, Vehicle, WaveGroup, World } from './types';
import { dist, type Vec } from './vec';
import { playerCommand } from './world';

export type GauntletReadout = { stretch: number; total: number; toOutpost: number; complete: boolean };

export function advanceGauntlet(world: World): void {
  const run = world.gauntlet;
  if (!run || world.player.state !== 'active') return;
  countWrecks(world, run);
  if (run.complete) return;
  const line = courseLine(run.course);
  huntPlayer(world, run);
  spawnDueGroups(world, run, line, progressOf(line, playerVehicle(world).pos));
  if (arrivedAtNext(world, run)) completeStretch(world, run);
}

function countWrecks(world: World, run: GauntletRun): void {
  for (const e of world.events) {
    if (e.t !== 'destroyed') continue;
    const group = run.groups.find((g) => g.vehicles.includes(e.vehicle));
    if (group) group.wrecked++;
  }
}

function liveTrucks(world: World, group: WaveGroup): Vehicle[] {
  return world.vehicles.filter((v) => group.vehicles.includes(v.id));
}

function aliveCount(world: World, run: GauntletRun): number {
  return run.groups.reduce((n, g) => n + liveTrucks(world, g).length, 0);
}

function huntPlayer(world: World, run: GauntletRun): void {
  const me = playerVehicle(world);
  for (const group of run.groups.filter((g) => g.stretch === run.stretch)) {
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

function spawnDueGroups(world: World, run: GauntletRun, line: CourseLine, progress: number): void {
  for (const group of run.groups.filter((g) => g.stretch === run.stretch && !g.spawned && isDue(g, progress))) {
    if (aliveCount(world, run) + group.templates.length > GAUNTLET.maxAlive) return;
    spawnGroup(world, run, line, group, progress);
  }
}

function isDue(group: WaveGroup, progress: number): boolean {
  return progress >= (group.from === 'ahead' ? group.at - GAUNTLET.spawnLead : group.at);
}

function spawnAlong(run: GauntletRun, group: WaveGroup, progress: number): number {
  const along = group.from === 'ahead' ? Math.max(group.at, progress + GAUNTLET.aheadGap) : progress - GAUNTLET.behindGap;
  return Math.min(Math.max(along, run.course.start), run.course.end);
}

export function spawnGroup(world: World, run: GauntletRun, line: CourseLine, group: WaveGroup, progress: number): void {
  const along = spawnAlong(run, group, progress);
  const loadouts = group.templates.map((id) => ({ tpl: NPCS[id], loadout: { ...generateNpcLoadout(world, NPCS[id], null, group.level), cargo: {} } }));
  const spots = groupSpots(world, line, along, loadouts.map((l) => chassisDef(l.loadout.chassisId).radius));
  if (!spots) return retryLater(world, group);
  const me = playerVehicle(world);
  loadouts.forEach(({ tpl, loadout }, i) => {
    const v = spawnAt(world, tpl, loadout, spots[i]);
    v.heading = Math.atan2(me.pos.y - v.pos.y, me.pos.x - v.pos.x);
    group.vehicles.push(v.id);
    declareFeud(world, v, me.id);
    fightCornered(world, v, me);
  });
  group.spawned = true;
  group.retryUntil = null;
}

function groupSpots(world: World, line: CourseLine, along: number, radii: number[]): Vec[] | null {
  const spots: Vec[] = [];
  for (const radius of radii) {
    const spot = laneSpot(world, line, along, radius, spots);
    if (!spot) return null;
    spots.push(spot);
  }
  return spots;
}

function laneSpot(world: World, line: CourseLine, along: number, radius: number, taken: Vec[]): Vec | null {
  for (let step = 0; step < GAUNTLET.maxTries / 10; step++) {
    const lane = GAUNTLET.laneOffsets[step % GAUNTLET.laneOffsets.length];
    const offset = Math.floor(step / GAUNTLET.laneOffsets.length) * GAUNTLET.spawnStagger;
    const pos = pointAt(line, along + (step % 2 === 0 ? offset : -offset), lane);
    if (isFree(world, pos, radius, null) && taken.every((t) => dist(t, pos) > radius * 2 + 0.5)) return pos;
  }
  return null;
}

function retryLater(world: World, group: WaveGroup): void {
  if (group.retryUntil === null) group.retryUntil = world.turn + GAUNTLET.spawnRetryTurns;
  else if (world.turn > group.retryUntil) throw new Error(`Gauntlet group ${group.id} found no free lane spot for ${GAUNTLET.spawnRetryTurns} turns`);
}

function arrivedAtNext(world: World, run: GauntletRun): boolean {
  const post = run.outposts[run.stretch];
  const me = playerVehicle(world);
  return onPad(post, me) && !inCombat(world, me);
}

function onPad(post: Outpost, v: Vehicle): boolean {
  return v.speed <= RULES.parkedSpeed && dist(v.pos, post.pad) <= GAUNTLET.outpost.padRadius;
}

function completeStretch(world: World, run: GauntletRun): void {
  const k = run.stretch;
  const post = run.outposts[k];
  const groups = run.groups.filter((g) => g.stretch === k);
  const wrecks = groups.reduce((n, g) => n + g.wrecked, 0);
  const pay = GAUNTLET.pay.base[k] + GAUNTLET.pay.perWreck[k] * wrecks;
  world.player.money += pay;
  world.events.push({ t: 'money', amount: pay, reason: 'outpostPay' });
  post.paid = true;
  removeSurvivors(world, groups);
  run.stretch++;
  world.events.push({ t: 'outpostReached', outpost: post.id, stretch: k + 1, pay, wrecks });
  if (run.stretch < run.outposts.length) return;
  run.complete = true;
  world.events.push({ t: 'runComplete', stretches: run.outposts.length });
}

function removeSurvivors(world: World, groups: WaveGroup[]): void {
  const gone = new Set(groups.flatMap((g) => g.vehicles));
  world.removed.push(...world.vehicles.filter((v) => gone.has(v.id)));
  world.vehicles = world.vehicles.filter((v) => !gone.has(v.id));
}

export function endRun(world: World, cause: RunLossCause): void {
  const run = world.gauntlet;
  if (!run) throw new Error(`A run ends by ${cause} in a world with no run`);
  if (world.player.state === 'dead') throw new Error('The run has already ended');
  world.player.state = 'dead';
  world.events.push({ t: 'runLost', stretch: Math.min(run.stretch + 1, run.outposts.length), cause });
}

export function canAbandonRun(world: World): boolean {
  return world.gauntlet !== null && !modeRules(world).rescue && world.player.state === 'active' && isStranded(world, playerVehicle(world));
}

export function abandonRun(world: World): World {
  return playerCommand(world, (w) => {
    if (!canAbandonRun(w)) throw new Error('Only a stranded truck on a run with no rescue can end the run');
    endRun(w, 'abandoned');
  });
}

export function nextOutpost(world: World): Outpost | null {
  const run = world.gauntlet;
  return run && !run.complete ? run.outposts[run.stretch] : null;
}

export function reachedOutpostAt(world: World): Outpost | null {
  const me = playerVehicle(world);
  return world.gauntlet?.outposts.find((post) => post.paid && onPad(post, me)) ?? null;
}

export function gauntletReadout(world: World): GauntletReadout | null {
  const run = world.gauntlet;
  if (!run) return null;
  const total = run.outposts.length;
  const next = nextOutpost(world);
  const line = courseLine(run.course);
  const toOutpost = next ? Math.max(0, next.at - progressOf(line, playerVehicle(world).pos)) : 0;
  return { stretch: Math.min(run.stretch + 1, total), total, toOutpost, complete: run.complete };
}
