// Weather events that change the rules. weatherAt is the single query every effect reads.
// A storm builds over its first stormFadeTurns and clears over its last; stormStrength owns that ramp.

import { WEATHER } from '../data/weather';
import { newId } from './factory';
import { chance, randInt, randRange } from './rng';
import type { World, WeatherEvent } from './types';
import { dist, type Vec } from './vec';

// Multipliers on sight radius, top speed, wear and heat, and extra scatter in radians.
export type WeatherEffects = { sight: number; spread: number; speed: number; wear: number; heat: number };

const SIM = WEATHER.sim;

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
}

function moveStorm(world: World, e: Storm): void {
  let nx = e.pos.x + e.vel.x;
  let ny = e.pos.y + e.vel.y;
  if (nx < 0 || nx > world.size) { e.vel.x = -e.vel.x; nx = e.pos.x + e.vel.x; }
  if (ny < 0 || ny > world.size) { e.vel.y = -e.vel.y; ny = e.pos.y + e.vel.y; }
  e.pos = { x: nx, y: ny };
}

// A heat wave and overcast cancel each other's heat, so neither starts while the other lasts.
const EXCLUDES: Partial<Record<WeatherEvent['kind'], WeatherEvent['kind']>> = { heatwave: 'overcast', overcast: 'heatwave' };

function spawnIfClear(world: World, kind: WeatherEvent['kind']): void {
  if (world.weather.some((e) => e.kind === EXCLUDES[kind])) return;
  if (world.weather.filter((e) => e.kind === kind).length >= SIM.maxActive[kind]) return;
  if (!chance(world, SIM.spawnChance[kind])) return;
  const event = makeWeather(world, kind);
  world.weather.push(event);
  world.events.push({ t: 'weather', event, outcome: 'started' });
}

// A new event with a random duration. A storm gets a random position, radius and drift.
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

// A live storm's strength in (0, 1] from its age: 1/F on its spawn turn, rising 1/F a turn to 1,
// and falling back to 1/F on its last turn. A storm shorter than 2F turns peaks below 1.
export function stormStrength(world: World, storm: Storm): number {
  const age = world.turn - storm.born;
  if (age < 0) throw new Error(`Storm ${storm.id} born on turn ${storm.born}, after turn ${world.turn}`);
  if (storm.turnsLeft <= 0) throw new Error(`Storm ${storm.id} has ended but is still active`);
  const fade = SIM.stormFadeTurns;
  return Math.min(1, (age + 1) / fade, storm.turnsLeft / fade);
}

export function weatherAt(world: World, pos: Vec): WeatherEffects {
  let sight = 1;
  let spread = 0;
  let speed = 1;
  let wear = 1;
  let heat = 1;
  for (const e of world.weather) {
    if (e.kind === 'storm') {
      const edge = Math.min(1, (e.radius - dist(pos, e.pos)) / SIM.stormEdge);
      if (edge <= 0) continue;
      const depth = edge * stormStrength(world, e);
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
