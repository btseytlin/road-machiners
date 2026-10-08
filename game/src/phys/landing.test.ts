// Trucks dropped onto flat ground through the real physics turn pipeline.

import { beforeAll, describe, expect, it } from 'vitest';
import { coreParts, mountedParts } from '../sim/grid';
import { emptyWorld } from '../sim/testkit';
import type { Quat } from './frames';
import type { World } from '../sim/types';
import { endTurn } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const UPRIGHT: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ROOF_DOWN: Quat = { x: 1, y: 0, z: 0, w: 0 };

function drop(rise: number, pose: Quat): { lost: Map<string, number>; wheels: string[] } {
  let w: World = emptyWorld();
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const before = new Map(mountedParts(me).map((p) => [p.id, p.hp]));
  let d: Drive = buildDrive(w);
  const body = d.world.getRigidBody(d.bodies[me.id]);
  const at = body.translation();
  body.setTranslation({ x: at.x, y: at.y + rise, z: at.z }, true);
  body.setRotation(pose, true);
  for (let i = 0; i < 2; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  const after = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const lost = new Map(mountedParts(after).map((p) => [p.id, before.get(p.id)! - p.hp]));
  return { lost, wheels: coreParts(after, 'wheel').map((p) => p.id) };
}

const total = (lost: Map<string, number>) => [...lost.values()].reduce((sum, hp) => sum + hp, 0);

describe('ground impacts', () => {
  it('a truck landing on its wheels from 3 m hurts only its wheels, and only a bit', () => {
    const { lost, wheels } = drop(3, UPRIGHT);
    for (const id of wheels) expect(lost.get(id)).toBeGreaterThan(0);
    for (const [id, hp] of lost) if (!wheels.includes(id)) expect(hp).toBe(0);
    expect(total(lost)).toBeLessThan(40);
  });

  it('a truck settling from rest takes no damage', () => {
    expect(total(drop(0, UPRIGHT).lost)).toBe(0);
  });

  it('a truck landing on its roof from 3 m takes far more damage than one landing on its wheels', () => {
    const roof = total(drop(3, ROOF_DOWN).lost);
    expect(roof).toBeGreaterThan(2.5 * total(drop(3, UPRIGHT).lost));
  });
});
