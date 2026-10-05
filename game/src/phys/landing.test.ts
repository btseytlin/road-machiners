// Trucks dropped onto flat ground and onto slopes through the real physics turn pipeline.

import { beforeAll, describe, expect, it } from 'vitest';
import { coreParts, mountedParts } from '../sim/grid';
import { editableTerrain, emptyWorld } from '../sim/testkit';
import { bodyOf } from '../sim/body';
import { PHYSICS } from '../data/physics';
import type { Quat } from './frames';
import type { World } from '../sim/types';
import type { Vec } from '../sim/vec';
import { endTurn, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const UPRIGHT: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ROOF_DOWN: Quat = { x: 1, y: 0, z: 0, w: 0 };

// Lifts the player truck by rise meters in the given pose, plays two turns and returns the HP each part lost.
function drop(rise: number, pose: Quat): { lost: Map<string, number>; wheels: string[] } {
  const w = emptyWorld();
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const d = buildDrive(w);
  const body = d.world.getRigidBody(d.bodies[me.id]);
  const at = body.translation();
  body.setTranslation({ x: at.x, y: at.y + rise, z: at.z }, true);
  body.setRotation(pose, true);
  return play(w, d);
}

// Puts the player truck on ground that falls along +x by grade height per tile up to x 60, or rises for a negative
// grade, parallel to the slope and rise meters above its ride height, moving at velocity m/s (x along +x, y up) with
// a drive-through order along +x. Plays two turns and returns the HP each part lost.
function slide(grade: number, rise: number, velocity: Vec): { lost: Map<string, number>; wheels: string[] } {
  let w = emptyWorld();
  const t = editableTerrain(w);
  const n = t.size;
  const heightOf = (x: number) => Math.max(0, 60 - x) * grade + Math.max(0, -60 * grade);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) t.heights[j * (n + 1) + i] = heightOf(i);
  w = setMoveOrder(w, { kind: 'through', dest: { x: 59, y: 30 } });
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const b = bodyOf(me.chassisId);
  const d = buildDrive(w);
  const body = d.world.getRigidBody(d.bodies[me.id]);
  // Height is in tiles like x, so grade is also the drop per meter.
  const angle = Math.atan(grade);
  const normal = { x: Math.sin(angle), y: Math.cos(angle) };
  const lift = b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY + rise;
  const S = PHYSICS.metersPerTile;
  body.setTranslation({ x: me.pos.x * S + normal.x * lift, y: heightOf(me.pos.x) * S + normal.y * lift, z: me.pos.y * S }, true);
  // Nose down by the slope angle: a turn about z, where a positive angle raises the nose.
  body.setRotation({ x: 0, y: 0, z: Math.sin(-angle / 2), w: Math.cos(angle / 2) }, true);
  body.setLinvel({ x: velocity.x, y: velocity.y, z: 0 }, true);
  return play(w, d);
}

// Plays two turns from the drive and returns the HP each part of the player truck lost.
function play(start: World, drive: Drive): { lost: Map<string, number>; wheels: string[] } {
  let w = start;
  let d = drive;
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const before = new Map(mountedParts(me).map((p) => [p.id, p.hp]));
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

  it('a truck touching down while it drives along a downslope takes no damage', () => {
    // Coming off a crest: the truck moves at 20 m/s down the slope, so its downward speed alone is past a hard landing.
    const angle = Math.atan(0.45);
    expect(total(slide(0.45, 0.6, { x: Math.cos(angle) * 20, y: -Math.sin(angle) * 20 }).lost)).toBe(0);
  });

  it('a truck whose wheels meet a rising slope while it drives level takes no damage', () => {
    // Off a small hop onto the face of the next bump: 20 m/s against the slope, though the truck hardly falls.
    expect(total(slide(-0.45, 0.6, { x: 20, y: 0 }).lost)).toBe(0);
  });

  it('a truck dropped 3 m onto a slope still hurts its wheels', () => {
    const { lost, wheels } = slide(0.45, 3, { x: 0, y: 0 });
    for (const id of wheels) expect(lost.get(id)).toBeGreaterThan(0);
  });
});
