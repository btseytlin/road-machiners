// What a played turn hands to the renderer: one pose per physics step for every vehicle.
// Physics space is meters: map x is physics x, map y is physics z, height is physics y.

import { PHYSICS } from "../data/physics";
import { heightAt, type Terrain } from "../sim/terrain";
import type { Vec } from "../sim/vec";

export type V3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
export type WheelFrame = { steer: number; spin: number; suspension: number; ground: boolean };
export type VehicleFrame = { pos: V3; rot: Quat; acc: V3; wheels: WheelFrame[] };
export type TurnFrames = Record<string, VehicleFrame[]>;

export function computeRoundPoint(a: V3, b: V3, offset: number): V3 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 0)) throw new Error("Shot from its own target point");
  return { x: b.x - (dz / len) * offset, y: b.y, z: b.z + (dx / len) * offset };
}

const S = PHYSICS.metersPerTile;

export function toPhys(p: Vec, height: number): V3 {
  return { x: p.x * S, y: height * S, z: p.y * S };
}

export function toMap(p: V3): Vec {
  return { x: p.x / S, y: p.z / S };
}

export function groundPoint(t: Terrain, p: Vec): V3 {
  return toPhys(p, heightAt(t, p.x, p.y));
}

export function headingQuat(heading: number): Quat {
  return { x: 0, y: Math.sin(-heading / 2), z: 0, w: Math.cos(-heading / 2) };
}

export function noseRise(q: Quat): number {
  return 2 * (q.x * q.y + q.w * q.z);
}

export function upOf(q: Quat): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

export function headingOf(q: Quat): number {
  const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const fz = 2 * (q.x * q.z - q.w * q.y);
  return Math.atan2(fz, fx);
}
