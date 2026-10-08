import { beforeAll, expect, it } from 'vitest';
import { PERF } from '../data/perf';
import { PHYSICS } from '../data/physics';
import { CRATER } from '../data/rules';
import { TERRAIN } from '../data/terrain';
import { craterRimPoints } from '../sim/craters';
import { editableTerrain, emptyWorld } from '../sim/testkit';
import type { Crater, World } from '../sim/types';
import type { Vec } from '../sim/vec';
import { endTurn, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, syncDrive, type TurnResult } from './drive';
import { noseRise } from './frames';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const S = PHYSICS.metersPerTile;
const me = (w: World) => w.vehicles[0];
const RANGE = TERRAIN.vision.radius + PERF.liveMargin + PHYSICS.propLiveMargin;

function crater(id: string, pos: Vec, radius: number): Crater {
  return { id, pos, radius, turn: 0 };
}

// A careless driver heading +x from `from` through `to`, so it drives straight over whatever lies between.
function straight(from: Vec, to: Vec, craters: Crater[], slope = 0): World {
  const w = emptyWorld(from);
  if (slope > 0) tilt(w, slope);
  me(w).speed = 2;
  me(w).direct = true;
  w.craters = craters;
  return setMoveOrder(w, { kind: 'through', dest: to });
}

// Ground that rises `slope` height units per tile both along x and along y, so the truck climbs and leans at once.
function tilt(w: World, slope: number): void {
  const t = editableTerrain(w);
  const row = t.size + 1;
  for (let j = 0; j <= t.size; j++) {
    for (let i = 0; i <= t.size; i++) t.heights[j * row + i] = slope * (i + j);
  }
}

// Plays turns through the real turn pipeline. bump is the peak |vertical acceleration| in m/s^2 and pitch the swing
// of the nose angle in degrees, both after the first second, so the start from rest does not count.
function play(w: World, turns: number): { bump: number; pitch: number; passed: boolean } {
  let d = buildDrive(w);
  let bump = 0;
  const pitches: number[] = [];
  let passed = false;
  for (let i = 0; i < turns && !passed; i++) {
    let r: TurnResult | null = null;
    w = endTurn(w, physicsMove(d, (x) => (r = x)));
    const frames = r!.frames[me(w).id];
    for (const f of i === 0 ? frames.slice(PHYSICS.stepsPerSecond / 4) : frames) {
      bump = Math.max(bump, Math.abs(f.acc.y));
      pitches.push(Math.asin(noseRise(f.rot)) * 180 / Math.PI);
    }
    passed = r!.results[me(w).id].passed;
    freeDrive(d);
    d = r!.next;
  }
  freeDrive(d);
  return { bump, pitch: Math.max(...pitches) - Math.min(...pitches), passed };
}

it('a truck crossing a crater rim on flat ground is jolted and drives on', () => {
  const plain = play(straight({ x: 30, y: 30 }, { x: 42, y: 30 }, []), 8);
  const rim = play(straight({ x: 30, y: 30 }, { x: 42, y: 30 }, [crater('c1', { x: 35, y: 30 }, 1.5)]), 8);
  expect(plain.passed).toBe(true);
  expect(rim.passed).toBe(true);
  expect(rim.bump).toBeGreaterThan(plain.bump * 2 + 2);
  expect(rim.pitch).toBeGreaterThan(plain.pitch + 1);
}, 60_000);

// 0.15 height units per tile along both x and y: a 21% grade, climbed and leaned on at once (UK1).
it('a truck crossing a crater rim on a slope is jolted and drives on', () => {
  const plain = play(straight({ x: 30, y: 30 }, { x: 42, y: 30 }, [], 0.15), 8);
  const rim = play(straight({ x: 30, y: 30 }, { x: 42, y: 30 }, [crater('c1', { x: 35, y: 30 }, 1.5)], 0.15), 8);
  expect(plain.passed).toBe(true);
  expect(rim.passed).toBe(true);
  expect(rim.bump).toBeGreaterThan(plain.bump * 2 + 2);
  expect(rim.pitch).toBeGreaterThan(plain.pitch + 1);
}, 60_000);

it('a crater under a parked truck gets its rim only once the truck has moved off it', () => {
  const w = emptyWorld({ x: 30, y: 30 });
  w.craters = [crater('c1', { x: 30.2, y: 30 }, 1.5)];
  const d = buildDrive(w);
  expect(d.craters.c1).toBeUndefined();
  me(w).pos = { x: 34, y: 30 };
  syncDrive(d, w);
  expect(d.craters.c1.length).toBe(CRATER.rimSegments);
  freeDrive(d);
});

it('a crater gets rim colliders only within the prop sync range', () => {
  const far = 30 + RANGE + 10;
  const w = emptyWorld({ x: 30, y: 30 });
  w.craters = [crater('c1', { x: far, y: 30 }, 1.5)];
  const d = buildDrive(w);
  expect(d.craters.c1).toBeUndefined();
  me(w).pos = { x: far - 10, y: 30 };
  syncDrive(d, w);
  expect(d.craters.c1.length).toBeGreaterThan(0);
  me(w).pos = { x: 30, y: 30 };
  syncDrive(d, w);
  expect(d.craters.c1).toBeUndefined();
  freeDrive(d);
});

it('a crater gone from the world loses its rim colliders', () => {
  const w = emptyWorld({ x: 30, y: 30 });
  w.craters = [crater('c1', { x: 36, y: 30 }, 1.5)];
  const d = buildDrive(w);
  const colliders = d.world.colliders.len();
  w.craters = [];
  syncDrive(d, w);
  expect(d.craters.c1).toBeUndefined();
  expect(d.world.colliders.len()).toBe(colliders - CRATER.rimSegments);
  freeDrive(d);
});

// The rim sits on the ground and shows rimRatio x radius above it, here 0.225 m.
it('a rim collider tops out rimRatio x radius above the ground', () => {
  const w = emptyWorld({ x: 30, y: 30 });
  w.craters = [crater('c1', { x: 36, y: 30 }, 1.5)];
  const d = buildDrive(w);
  const rim = d.world.getCollider(d.craters.c1[0]);
  const [a, b] = craterRimPoints(w.craters[0]); // the first rim piece runs between these
  const x = ((a.x + b.x) / 2) * S;
  const z = ((a.y + b.y) / 2) * S;
  expect(rim.containsPoint({ x, y: 0.2, z })).toBe(true);
  expect(rim.containsPoint({ x, y: 0.25, z })).toBe(false);
  freeDrive(d);
});
