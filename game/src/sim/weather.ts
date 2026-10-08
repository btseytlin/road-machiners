// Weather events that change the rules. weatherAt is the single query every effect reads.

import { WEATHER } from '../data/weather';
import { newId } from './factory';
import { chance, randInt, randRange } from './rng';
import type { World, WeatherEvent } from './types';
import { dist, type Vec } from './vec';

export type WeatherEffects = { sight: number; spread: number; speed: number; wear: number; heat: number };

const SIM = WEATHER.sim;

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
}

function moveStorm(world: World, e: Extract<WeatherEvent, { kind: 'storm' }>): void {
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
      }
    : { id, kind, turnsLeft };
}

function angledVel(world: World, speed: number): Vec {
  const a = randRange(world, -Math.PI, Math.PI);
  return { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
}

export function weatherAt(world: World, pos: Vec): WeatherEffects {
  let sight = 1;
  let spread = 0;
  let speed = 1;
  let wear = 1;
  let heat = 1;
  for (const e of world.weather) {
    if (e.kind === 'storm') {
      const depth = Math.min(1, (e.radius - dist(pos, e.pos)) / SIM.stormEdge);
      if (depth <= 0) continue;
      const fx = SIM.effects.storm;
      sight *= 1 + (fx.sight - 1) * depth;
      spread += fx.spread * depth;
      speed *= 1 + (fx.speed - 1) * depth;
      wear *= 1 + (fx.wear - 1) * depth;
    } else if (e.kind === 'heatwave') {
      heat *= SIM.effects.heatwave;
    } else if (e.kind === 'overcast') {
      heat *= SIM.effects.overcast;
    }
  }
  return { sight, spread, speed, wear, heat };
}
