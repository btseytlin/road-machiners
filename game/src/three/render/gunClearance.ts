// How high a gun must stand for its head to clear everything it can turn over. The head's shape, the yaws it turns through
// and the boxes around it come in, and the lowest height of its post comes out. Pure THREE math, so tests can call it.

import * as THREE from 'three';
import type { FireSpan } from '../../sim/armor';

// The head in its own space: +x along the barrel, y up, origin at the receiver.
// core: the largest top view radius of the receiver and extra, which the head sweeps all the way round.
// reach: the barrel tip's top view radius. halfWidth: the barrel's largest |z|. bottom: the head's lowest y.
export type HeadShape = { core: number; reach: number; halfWidth: number; bottom: number };

// An upright box in body space.
export type Obstacle = { x0: number; x1: number; z0: number; z1: number; top: number };

type Flat = { x: number; z: number };

// Reads the shape from the head's meshes. muzzleX is where the barrel joins: vertices before it are receiver and extra.
// Throws when the head has no barrel past the muzzle.
export function headShape(head: THREE.Object3D, muzzleX: number): HeadShape {
  head.updateMatrixWorld(true);
  const shape: HeadShape = { core: 0, reach: 0, halfWidth: 0, bottom: Infinity };
  let barrel = 0;
  const v = new THREE.Vector3();
  head.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      shape.bottom = Math.min(shape.bottom, v.y);
      if (v.x < muzzleX) {
        shape.core = Math.max(shape.core, Math.hypot(v.x, v.z));
        continue;
      }
      barrel++;
      shape.reach = Math.max(shape.reach, Math.hypot(v.x, v.z));
      shape.halfWidth = Math.max(shape.halfWidth, Math.abs(v.z));
    }
  });
  if (barrel === 0) throw new Error(`The gun head has no barrel past its muzzle at x ${muzzleX}`);
  return shape;
}

const AHEAD: readonly FireSpan[] = [{ from: 0, to: 0 }];

// The yaws a head turns through: its fire spans if it turns and has any, else straight ahead.
export function sweepOf(spans: readonly FireSpan[], turns: boolean): readonly FireSpan[] {
  return turns && spans.length > 0 ? spans : AHEAD;
}

// True when a point can be inside the head at some yaw of the sweep.
export function swept(p: Flat, pivot: Flat, shape: HeadShape, sweep: readonly FireSpan[]): boolean {
  const dx = p.x - pivot.x;
  const dz = p.z - pivot.z;
  const r = Math.hypot(dx, dz);
  if (r <= shape.core) return true;
  if (r > shape.reach) return false;
  const widen = (Math.asin(Math.min(1, shape.halfWidth / r)) * 180) / Math.PI;
  const bearing = (Math.atan2(dz, dx) * 180) / Math.PI;
  return sweep.some((s) => [bearing - 360, bearing, bearing + 360].some((b) => b >= s.from - widen && b <= s.to + widen));
}

const GRID = 0.05; // meters between the points tried inside a box

// The highest top plus gap of the obstacles that have a point the head sweeps over, or -Infinity.
export function clearTop(pivot: Flat, shape: HeadShape, sweep: readonly FireSpan[], obstacles: readonly Obstacle[], gap: number): number {
  let best = -Infinity;
  for (const o of obstacles) {
    if (o.top + gap <= best) continue;
    if (touches(o, pivot, shape, sweep)) best = o.top + gap;
  }
  return best;
}

function touches(o: Obstacle, pivot: Flat, shape: HeadShape, sweep: readonly FireSpan[]): boolean {
  const near = { x: Math.min(Math.max(pivot.x, o.x0), o.x1), z: Math.min(Math.max(pivot.z, o.z0), o.z1) };
  if (Math.hypot(near.x - pivot.x, near.z - pivot.z) > shape.reach) return false;
  if (swept(near, pivot, shape, sweep)) return true;
  const nx = Math.max(1, Math.ceil((o.x1 - o.x0) / GRID));
  const nz = Math.max(1, Math.ceil((o.z1 - o.z0) / GRID));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      if (swept({ x: o.x0 + ((o.x1 - o.x0) * i) / nx, z: o.z0 + ((o.z1 - o.z0) * j) / nz }, pivot, shape, sweep)) return true;
    }
  }
  return false;
}
