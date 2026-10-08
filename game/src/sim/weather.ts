// Weather events that change the rules. weatherAt is the settled weather at a place; weatherOn is what a truck feels,
// and every truck effect reads it. A storm builds over its first stormFadeTurns and clears over its last; stormStrength
// owns that ramp. A truck's stormExposure lags the storm's depth where it stands by stormExposeTurns; advanceExposure owns that.

import { WEATHER } from '../data/weather';
import { newId } from './factory';
import { chance, randInt, randRange } from './rng';
import type { Vehicle, World, WeatherEvent } from './types';
import { dist, type Vec } from './vec';

export type WeatherEffects = { sight: number; spread: number; speed: number; wear: number; heat: number };

const SIM = WEATHER.sim;

if (SIM.stormExposeTurns > SIM.stormFadeTurns) {
  throw new Error(`stormExposeTurns ${SIM.stormExposeTurns} exceeds stormFadeTurns ${SIM.stormFadeTurns}`);
}

type Storm = Extract<WeatherEvent, { kind: 'storm' }>;

export function advanceWeather(world: World): void {
  for (const e of world.weather) {
    e.turnsLeft--;
    if (e.kind === 'storm') moveStorm(world, e);
  }
  const ended = world.weather.filter((e) => e.turnsLeft <= 0);
  for (const e of ended) world.events.push({ t: 'weather', event: e, outcome: 'ended' });
  world.weather = world.weather.filter((e) => e.turnsLeft > 0);
  spawnIfClear(world, 'storm');
  spawnIfClear(world, 'heatwave');
  spawnIfClear(world, 'overcast');
  advanceExposure(world);
}

function moveStorm(world: World, e: Storm): void {
  let nx = e.pos.x + e.vel.x;
  let ny = e.pos.y + e.vel.y;
  if (nx < 0 || nx > world.size) { e.vel.x = -e.vel.x; nx = e.pos.x + e.vel.x; }
  if (ny < 0 || ny > world.size) { e.vel.y = -e.vel.y; ny = e.pos.y + e.vel.y; }
  e.pos = { x: nx, y: ny };
}

const EXCLUDES: Partial<Record<WeatherEvent['kind'], WeatherEvent['kind']>> = { heatwave: 'overcast', overcast: 'heatwave' };

function spawnIfClear(world: World, kind: WeatherEvent['kind']): void {
  if (world.weather.some((e) => e.kind === EXCLUDES[kind])) return;
  if (world.weather.filter((e) => e.kind === kind).length >= SIM.maxActive[kind]) return;
  if (!chance(world, SIM.spawnChance[kind])) return;
  const event = makeWeather(world, kind);
  world.weather.push(event);
  world.events.push({ t: 'weather', event, outcome: 'started' });
}

export function makeWeather(world: World, kind: WeatherEvent['kind']): WeatherEvent {
  const [lo, hi] = SIM.duration[kind];
  const turnsLeft = randInt(world, lo, hi);
  const id = newId(world, 'wx');
  return kind === 'storm'
    ? {
        id,
        kind: 'storm',
        pos: { x: randRange(world, 0, world.size), y: randRange(world, 0, world.size) },
        radius: randRange(world, SIM.stormRadius[0], SIM.stormRadius[1]),
        vel: angledVel(world, randRange(world, SIM.stormSpeed[0], SIM.stormSpeed[1])),
        turnsLeft,
        born: world.turn,
      }
    : { id, kind, turnsLeft };
}

function angledVel(world: World, speed: number): Vec {
  const a = randRange(world, -Math.PI, Math.PI);
  return { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
}

export function stormStrength(world: World, storm: Storm): number {
  const age = world.turn - storm.born;
  if (age < 0) throw new Error(`Storm ${storm.id} born on turn ${storm.born}, after turn ${world.turn}`);
  if (storm.turnsLeft <= 0) throw new Error(`Storm ${storm.id} has ended but is still active`);
  const fade = SIM.stormFadeTurns;
  return Math.min(1, (age + 1) / fade, storm.turnsLeft / fade);
}

export function stormDepth(world: World, storm: Storm, pos: Vec): number {
  const edge = Math.min(1, (storm.radius - dist(pos, storm.pos)) / SIM.stormEdge);
  if (edge <= 0) return 0;
  return edge * stormStrength(world, storm);
}

const SNAP = 1e-9;

export function advanceExposure(world: World): void {
  const storms = world.weather.filter((e): e is Storm => e.kind === 'storm');
  for (const v of world.vehicles) {
    if (storms.length > 0 || !isExposureEmpty(v)) v.stormExposure = steppedExposure(world, storms, v);
  }
}

function steppedExposure(world: World, storms: Storm[], v: Vehicle): Record<string, number> {
  const next: Record<string, number> = {};
  for (const e of storms) {
    const moved = stepToward(v.stormExposure[e.id] ?? 0, stormDepth(world, e, v.pos));
    if (moved > 0) next[e.id] = moved;
  }
  return next;
}

function isExposureEmpty(v: Vehicle): boolean {
  for (const _id in v.stormExposure) return false;
  return true;
}

function stepToward(share: number, target: number): number {
  const step = 1 / SIM.stormExposeTurns;
  return Math.abs(target - share) <= step + SNAP ? target : share + Math.sign(target - share) * step;
}

export function weatherOn(world: World, v: Vehicle): WeatherEffects {
  const fx = { sight: 1, spread: 0, speed: 1, wear: 1, heat: regionHeat(world) };
  for (const id in v.stormExposure) {
    const share = v.stormExposure[id];
    if (!Number.isFinite(share) || share <= 0 || share > 1) throw new Error(`Truck ${v.id} has storm ${id} share ${share}`);
    addStorm(fx, share);
  }
  return fx;
}

export function stormShare(v: Vehicle): number {
  let most = 0;
  for (const id in v.stormExposure) most = Math.max(most, v.stormExposure[id]);
  return most;
}

function addStorm(fx: WeatherEffects, k: number): void {
  const storm = SIM.effects.storm;
  fx.sight *= 1 + (storm.sight - 1) * k;
  fx.spread += storm.spread * k;
  fx.speed *= 1 + (storm.speed - 1) * k;
  fx.wear *= 1 + (storm.wear - 1) * k;
}

function regionHeat(world: World): number {
  let heat = 1;
  for (const e of world.weather) {
    if (e.kind === 'heatwave') heat *= SIM.effects.heatwave;
    else if (e.kind === 'overcast') heat *= SIM.effects.overcast;
  }
  return heat;
}

export function weatherAt(world: World, pos: Vec): WeatherEffects {
  const fx = { sight: 1, spread: 0, speed: 1, wear: 1, heat: regionHeat(world) };
  for (const e of world.weather) {
    if (e.kind !== 'storm') continue;
    const depth = stormDepth(world, e, pos);
    if (depth > 0) addStorm(fx, depth);
  }
  return fx;
}
