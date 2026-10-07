// How far trucks climb a straight ramp through the real physics turn pipeline, and what the climb rule leaves alone.

import { beforeAll, describe, expect, it } from 'vitest';
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

const RAMP_FOOT = 28; // tile x where the ramp starts to rise
// Grade where the loaded hauler gains nothing in eight turns from rest with the climb reserve, measured on this ramp.
const HAULER_LIMIT = 0.45;

// The standard player truck, or the hauler with a full load of scrap from the hill test in drive.test.ts.
type Build = 'scout' | 'loadedHauler';

// A world with the build at rest at x 26, facing a ramp of grade height per tile that rises from x 28, under a drive-through order up it.
function ramp(build: Build, grade: number, type: TerrainTypeId): World {
  const w = emptyWorld({ x: 26, y: 30 });
  const t = editableTerrain(w);
  const n = t.size;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) t.heights[j * (n + 1) + i] = Math.max(0, i - RAMP_FOOT) * grade;
  t.types.fill(type);
  if (build === 'loadedHauler') {
    const hauler = makeVehicle(w, { faction: 'player', chassisId: 'hauler', parts: ['mg', 'stockEngine', 'plates', 'trailerBox'].map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {}, pos: { x: 26, y: 30 }, heading: 0, brain: null });
    w.vehicles[0] = { ...hauler, id: w.vehicles[0].id };
    addGoods(w, w.vehicles[0], 'scrap', 999);
  }
  w.player.fuel = 999;
  return setMoveOrder(w, { kind: 'through', dest: { x: 120, y: 30 } });
}

// The truck's x after each of the given number of turns.
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

// Tiles gained up the ramp after eight turns from rest.
const climbTiles = (build: Build, grade: number, type: TerrainTypeId = 'road') => drive(ramp(build, grade, type), 8)[7] - RAMP_FOOT;

describe('climbing', () => {
  it('a loaded hauler keeps climbing a grade it stalled on before the climb reserve', () => {
    // Before the reserve it gained 0.8 tiles here.
    expect(climbTiles('loadedHauler', 0.35)).toBeGreaterThan(3);
  }, 90_000);

  it('a climb a tenth steeper in sine than its limit still stops the loaded hauler', () => {
    const sine = 1.1 * Math.sin(Math.atan(HAULER_LIMIT));
    expect(climbTiles('loadedHauler', Math.tan(Math.asin(sine)))).toBeLessThan(1);
  }, 90_000);

  it('flat ground acceleration from rest is unchanged', () => {
    // Measured before the climb reserve: the scout's x after each of its first three turns from rest at x 26.
    const xs = drive(ramp('scout', 0, 'road'), 3);
    expect(xs[0]).toBeCloseTo(26.945196, 5);
    expect(xs[1]).toBeCloseTo(29.37628, 5);
    expect(xs[2]).toBeCloseTo(33.271481, 5);
  }, 90_000);
});
