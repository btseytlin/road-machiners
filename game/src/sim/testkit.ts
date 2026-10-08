import { START_KITS } from '../data/start';

import { RULES } from '../data/rules';
import { makeVehicle } from './factory';
import { nextRandom } from './rng';
import { mountedParts } from './grid';
import { burnFuel } from './resources';
import { vehicleStats } from './stats';
import type { Terrain } from './terrain';
import { TEST_MAP } from '../test/map';
import { onTestFinished } from 'vitest';
import { DECISIONS, STATE_WEIGHTS, TRAITS, type DecisionId, type DecisionOptions, type TraitId } from '../data/npcs';
import { addState } from './states';
import type { Faction, GameEvent, NpcBrain, Vehicle, World, XpSource } from './types';
import { dist, type Vec } from './vec';
import { refreshVision } from './vision';
import { stormDepth } from './weather';
import { cloneWorld, newWorld } from './world';

export function flatTerrain(size: number): Terrain {
  return { size, heights: new Array((size + 1) * (size + 1)).fill(0), types: new Array(size * size).fill('road') };
}

export function editableTerrain(w: World): Terrain {
  w.terrain = { ...w.terrain, heights: [...w.terrain.heights], types: [...w.terrain.types] };
  return w.terrain;
}

let emptyTemplate: World | undefined;

export function emptyWorld(pos: Vec = { x: 30, y: 30 }): World {
  if (!emptyTemplate) {
    emptyTemplate = newWorld(1, START_KITS.standard, TEST_MAP);
    emptyTemplate.obstacles = [];
    emptyTemplate.terrain = flatTerrain(emptyTemplate.size);
    Object.freeze(emptyTemplate.terrain.heights);
    Object.freeze(emptyTemplate.terrain.types);
    Object.freeze(emptyTemplate.terrain);
    emptyTemplate.vehicles = emptyTemplate.vehicles.filter((v) => v.faction === 'player');
    emptyTemplate.states = [];
    emptyTemplate.rngState = -1655809527;
  }
  const w = cloneWorld(emptyTemplate);
  const p = w.vehicles[0];
  p.pos = { ...pos };
  p.heading = 0;
  refreshVision(w);
  return w;
}

export function addVehicle(w: World, faction: Faction, chassisId: string, parts: string[], pos: Vec, heading = 0): Vehicle {
  const v = makeVehicle(w, { name: chassisId, faction, chassisId, parts: parts.map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {}, pos, heading, brain: null });
  w.vehicles.push(v);
  return v;
}

export function practiceOf(w: World, source: XpSource): Extract<GameEvent, { t: 'practice' }>[] {
  return w.events.filter((e): e is Extract<GameEvent, { t: 'practice' }> => e.t === 'practice' && e.source === source);
}

export function npcBrain(templateId: string, home: Vec, traits: TraitId[]): NpcBrain {
  return { templateId, driver: 'Test Driver', traits, goals: [], noticed: {}, tracks: {}, hurt: 0, attackers: {}, goal: null, home: { ...home }, stepIndex: 0, memories: [] };
}

export function forceOption<D extends DecisionId>(decision: D, option: DecisionOptions[D]): void {
  const base = DECISIONS[decision] as Record<string, number>;
  const savedBase = { ...base };
  const tables = [...Object.values(TRAITS).map((t) => t.weights), ...Object.values(STATE_WEIGHTS)] as Record<string, Record<string, unknown> | undefined>[];
  const saved = tables.map((t) => t[decision]);
  for (const key of Object.keys(base)) if (key !== option) base[key] = 0;
  for (const table of tables) {
    const entry = table[decision];
    if (!entry) continue;
    table[decision] = option in entry ? { [option]: entry[option] } : {};
  }
  onTestFinished(() => {
    Object.assign(base, savedBase);
    tables.forEach((table, i) => {
      if (saved[i] === undefined) delete table[decision];
      else table[decision] = saved[i];
    });
  });
}

export function rngStateWhere(test: (roll: number) => boolean): number {
  for (let state = 1; state <= 100_000; state++) if (test(nextRandom({ rngState: state }))) return state;
  throw new Error('No RNG state passes the test');
}

export function rngStateForForcedRolls(count: number): number {
  for (let state = 1; state <= 1_000_000; state++) {
    const rng = { rngState: state };
    let ok = true;
    for (let k = 0; k < count && ok; k++) {
      const roll = nextRandom(rng);
      ok = roll > 0.3 && roll < 0.7;
    }
    if (ok) return state;
  }
  throw new Error(`No RNG state gives ${count} mid-range rolls`);
}

export function settleStorms(w: World): void {
  for (const v of w.vehicles) {
    v.stormExposure = {};
    for (const e of w.weather) {
      if (e.kind !== 'storm') continue;
      const depth = stormDepth(w, e, v.pos);
      if (depth > 0) v.stormExposure[e.id] = depth;
    }
  }
}

export function partHp(v: Vehicle): number {
  return mountedParts(v).reduce((a, p) => a + p.hp, 0);
}

export function testDrive(world: World): void {
  for (const v of world.vehicles) if (v.order) driveOne(world, v);
}

function driveOne(world: World, v: Vehicle): void {
  const s = vehicleStats(world, v);
  if (v.order!.kind === 'brake') {
    v.speed = Math.max(0, v.speed - s.brake);
    if (v.speed === 0) v.order = null;
    return;
  }
  const dest = v.order!.dest;
  const remaining = dist(v.pos, dest);
  if (remaining < RULES.arriveRadius) {
    v.speed = 0;
    v.order = null;
    world.events.push({ t: 'arrived', vehicle: v.id });
    return;
  }
  const target = Math.min(s.maxSpeed, remaining - RULES.arriveRadius / 2);
  const speed = target > v.speed ? Math.min(target, v.speed + s.accel) : Math.max(target, v.speed - s.brake);
  v.heading = Math.atan2(dest.y - v.pos.y, dest.x - v.pos.x);
  const from = { ...v.pos, heading: v.heading };
  v.pos = { x: v.pos.x + Math.cos(v.heading) * speed, y: v.pos.y + Math.sin(v.heading) * speed };
  v.trail = [from, { ...v.pos, heading: v.heading }];
  v.speed = speed;
  burnFuel(world, v, speed);
}

export function startCombat(w: World, aggressor: Vehicle, target: Vehicle): void {
  addState(w, 'combat', aggressor.id, target.id, { kind: 'none' });
}
