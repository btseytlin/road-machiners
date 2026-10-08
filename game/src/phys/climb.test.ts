// How far trucks climb a straight ramp through the real physics turn pipeline, and what the climb rule leaves alone.

import { beforeAll, describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import type { TerrainTypeId } from '../data/terrain';
import { makeVehicle } from '../sim/factory';
import { addGoods } from '../sim/inventory';
import { editableTerrain, emptyWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import { endTurn, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const RAMP_FOOT = 28;
const HAULER_LIMIT = 0.45;

type Build = 'scout' | 'loadedHauler';

function ramp(build: Build, grade: number, type: TerrainTypeId): World {
  const w = emptyWorld({ x: 26, y: 30 });
  const t = editableTerrain(w);
  const n = t.size;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) t.heights[j * (n + 1) + i] = Math.max(0, i - RAMP_FOOT) * grade;
  t.types.fill(type);
  if (build === 'loadedHauler') {
    const hauler = makeVehicle(w, { name: 'hauler', faction: 'player', chassisId: 'hauler', parts: ['mg', 'stockEngine', 'plates', 'trailerBox'].map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {}, pos: { x: 26, y: 30 }, heading: 0, brain: null });
    w.vehicles[0] = { ...hauler, id: w.vehicles[0].id };
    addGoods(w, w.vehicles[0], 'scrap', 999);
  }
  w.player.fuel = 999;
  return setMoveOrder(w, { kind: 'through', dest: { x: 120, y: 30 } });
}

function drive(start: World, turns: number): number[] {
  let w = start;
  let d: Drive = buildDrive(w);
  const xs: number[] = [];
  for (let i = 0; i < turns; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
    xs.push(w.vehicles[0].pos.x);
  }
  freeDrive(d);
  return xs;
}

const climbTiles = (build: Build, grade: number, type: TerrainTypeId = 'road') => drive(ramp(build, grade, type), 8)[7] - RAMP_FOOT;

describe('climbing', () => {
  it('a loaded hauler keeps climbing a grade it stalled on before the climb reserve', () => {
    expect(climbTiles('loadedHauler', 0.35)).toBeGreaterThan(3);
  }, 90_000);

  it('a loaded hauler still climbs a grade a tenth gentler in sine than its limit', () => {
    const sine = 0.9 * Math.sin(Math.atan(HAULER_LIMIT));
    expect(climbTiles('loadedHauler', Math.tan(Math.asin(sine)))).toBeGreaterThan(1);
  }, 90_000);

  it('a climb a tenth steeper in sine than its limit still stops the loaded hauler', () => {
    const sine = 1.1 * Math.sin(Math.atan(HAULER_LIMIT));
    expect(climbTiles('loadedHauler', Math.tan(Math.asin(sine)))).toBeLessThan(1);
  }, 90_000);

  it('flat ground launch from rest is pinned', () => {
    const xs = drive(ramp('scout', 0, 'road'), 3);
    expect(xs[0]).toBeCloseTo(26.791767, 5);
    expect(xs[1]).toBeCloseTo(28.830158, 5);
    expect(xs[2]).toBeCloseTo(32.097729, 5);
  }, 90_000);

  it('a launch from rest gains about 85% of the distance it did at the old acceleration scale', () => {
    const rules = RULES as { accelScale: number };
    const scale = rules.accelScale;
    const now = drive(ramp('scout', 0, 'road'), 3);
    let old: number[];
    try {
      rules.accelScale = scale / 0.85;
      old = drive(ramp('scout', 0, 'road'), 3);
    } finally {
      rules.accelScale = scale;
    }
    const ratio = (now[2] - 26) / (old[2] - 26);
    expect(ratio).toBeGreaterThan(0.82);
    expect(ratio).toBeLessThan(0.88);
  }, 90_000);
});
