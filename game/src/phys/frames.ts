// What a played turn hands to the renderer: one pose per physics step for every vehicle.
// Physics space is meters: map x is physics x, map y is physics z, height is physics y.

import { PHYSICS } from "../data/physics";
import { heightAt, type Terrain } from "../sim/terrain";
import type { Vec } from "../sim/vec";

export type V3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
// steer and spin in radians, suspension in meters. ground: the tire touches the ground this step.
export type WheelFrame = { steer: number; spin: number; suspension: number; ground: boolean };
// acc: world-space acceleration over the last physics step, m/s^2. The view sways the body with it.
export type VehicleFrame = { pos: V3; rot: Quat; acc: V3; wheels: WheelFrame[] }; // wheels follow wheelMounts order
export type TurnFrames = Record<string, VehicleFrame[]>; // by vehicle id

// Offsets a round across the line of fire in meters, positive to the shooter's right.
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

// A circle on the ground in physics space: center x and z and radius, in meters.
export type Circle = { x: number; z: number; r: number };

// A map circle of radius r tiles, in physics space.
export function toPhysCircle(p: Vec, r: number): Circle {
  return { x: p.x * S, z: p.y * S, r: r * S };
}

// Ground point under a map point, in physics space.
export function groundPoint(t: Terrain, p: Vec): V3 {
  return toPhys(p, heightAt(t, p.x, p.y));
}

// Map heading grows from +x toward +z. A rotation about y by -heading turns +x onto it.
export function headingQuat(heading: number): Quat {
  return { x: 0, y: Math.sin(-heading / 2), z: 0, w: Math.cos(-heading / 2) };
}

// v turned by the unit quaternion q.
export function rotateBy(q: Quat, v: V3): V3 {
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

// Sine of the nose pitch: positive when the nose points uphill.
export function noseRise(q: Quat): number {
  return 2 * (q.x * q.y + q.w * q.z);
}

// Vertical part of the body's up axis: 1 when level, 0 on its side, -1 upside down.
export function upOf(q: Quat): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

export function headingOf(q: Quat): number {
  const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const fz = 2 * (q.x * q.z - q.w * q.y);
  return Math.atan2(fz, fx);
}
