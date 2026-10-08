import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from '../data/physics';
import { beforeAll, expect, it } from 'vitest';
import { randRange } from '../sim/rng';
import { deckAt } from '../sim/bridge';
import { heightAt } from '../sim/terrain';
import { dist, type Vec } from '../sim/vec';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive, type TurnResult } from './drive';
import { toMap } from './frames';
import { physicsMove } from './turn';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';
import { PLAIN_KIT } from '../sim/testkit';
import { defaultSetup } from '../sim/settings';

beforeAll(async () => {
  await initPhysics();
});

function driveRoute(start: Vec, target: Vec): { maxTilt: number; remaining: number; minDeckRise: number } {
  let w = newWorld(1337, PLAIN_KIT, TEST_MAP, defaultSetup('roaming'));
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  w.vehicles[0].pos = { ...start };
  w.player.fuel = 999;
  let drive: Drive = buildDrive(w);
  let maxTilt = 0;
  let minDeckRise = Infinity;
  for (let i = 0; i < 30 && dist(w.vehicles[0].pos, target) > 1; i++) {
    w = setMoveOrder(w, { kind: 'stopAt', dest: target });
    let result: TurnResult | null = null;
    w = endTurn(w, physicsMove(drive, (next) => (result = next)));
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    for (const frame of result!.frames[w.vehicles[0].id]) {
      const q = frame.rot;
      maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
      const p = toMap(frame.pos);
      if (deckAt(p.x, p.y) !== null) minDeckRise = Math.min(minDeckRise, frame.pos.y - heightAt(w.terrain, p.x, p.y) * PHYSICS.metersPerTile);
    }
    freeDrive(drive);
    drive = result!.next;
  }
  freeDrive(drive);
  return { maxTilt: maxTilt * 180 / Math.PI, remaining: dist(w.vehicles[0].pos, target), minDeckRise };
}

it('a truck stays under 20 degrees of tilt at both canyon road crossings', () => {
  for (const [start, target] of [
    [{ x: 417, y: 125.33 }, { x: 443, y: 129.67 }],
    [{ x: 490, y: 375 }, { x: 507, y: 358 }],
  ] as [Vec, Vec][]) {
    const result = driveRoute(start, target);
    expect(result.remaining).toBeLessThan(3);
    expect(result.maxTilt).toBeLessThan(20);
  }
}, budget(60_000));

it('a truck crosses Canyon Bridge on the deck, above the canyon', () => {
  const result = driveRoute({ x: 486, y: 379 }, { x: 509, y: 356 });
  expect(result.remaining).toBeLessThan(3);
  expect(result.minDeckRise).toBeGreaterThan(0);
  expect(result.minDeckRise).toBeLessThan(2);
}, budget(60_000));

it('the Bowl crater exit leans the truck without rolling it onto its side', () => {
  const start = newWorld(1337, PLAIN_KIT, TEST_MAP, defaultSetup('roaming')).vehicles[0].pos;
  const result = driveRoute(start, { x: 101, y: 432 });
  expect(result.remaining).toBeLessThan(3);
  expect(result.maxTilt).toBeLessThan(45);
}, budget(60_000));

it('the terrain collider is a heightfield whose surface matches the corner grid', () => {
  const S = PHYSICS.metersPerTile;
  const w = newWorld(1, PLAIN_KIT, TEST_MAP, defaultSetup('roaming'));
  const t = w.terrain;
  const drive = buildDrive(w);
  const ground = drive.world.getCollider(drive.terrain);
  expect(ground.shapeType()).toBe(RAPIER.ShapeType.HeightField);
  const corner = (i: number, j: number) => t.heights[j * (t.size + 1) + i] * S;
  const rng = { rngState: 7 };
  let flat = 0;
  for (let k = 0; k < 200; k++) {
    const x = randRange(rng, 0, t.size);
    const y = randRange(rng, 0, t.size);
    const top = 1000;
    const toi = ground.castRay(new RAPIER.Ray({ x: x * S, y: top, z: y * S }, { x: 0, y: -1, z: 0 }), 2 * top, true);
    expect(toi).toBeGreaterThanOrEqual(0);
    const hit = top - toi;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const [a, b, c, d] = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)];
    const split = fx + fy <= 1 ? a + (b - a) * fx + (c - a) * fy : d + (c - d) * (1 - fx) + (b - d) * (1 - fy);
    expect(Math.abs(hit - split)).toBeLessThan(0.05);
    expect(hit).toBeGreaterThanOrEqual(Math.min(a, b, c, d) - 0.05);
    expect(hit).toBeLessThanOrEqual(Math.max(a, b, c, d) + 0.05);
    if (Math.max(a, b, c, d) - Math.min(a, b, c, d) < 1e-6) {
      flat++;
      expect(Math.abs(hit - heightAt(t, x, y) * S)).toBeLessThan(0.05);
    }
  }
  expect(flat).toBeGreaterThan(0);
  freeDrive(drive);
});
