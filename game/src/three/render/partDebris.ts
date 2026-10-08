// Scrap thrown by a truck part that breaks in a fight. A burst is the pieces of the good_scrap model, flung outward
// from the truck. They fall and bounce through the shared debris flight, freeze at rest, linger, then shrink away.
// Nothing here changes game rules.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { partDef } from '../../data/parts';
import { toMap, type V3 } from '../../phys/frames';
import { hashStr } from '../../render/noise';
import { breakSignature, type BreakSignature } from '../../render/partLooks';
import type { Terrain } from '../../sim/terrain';
import { dist } from '../../sim/vec';
import type { Obstacle, PartInstance, World } from '../../sim/types';
import { DebrisSim, disposeTree, FLY_REACH, piecesOf, type TruckBox } from './debris';
import type { PartBreak } from '../breakCues';
import type { Fx3D } from './fx';
import type { RenderScope } from './scope';
import type { VehicleView } from './vehicle';

const S = PHYSICS.metersPerTile;
const PART_DEBRIS_SCALE = 0.35;
const PART_LIFT = 0.4;
const PART_FLING = 4;
const PART_KICK_UP = 3;
const PART_DEBRIS_LINGER = 20;
const PART_DEBRIS_FADE = 1.5;
export const PART_DEBRIS_MAX = 60;

type Live = { group: THREE.Group; age: number };

export function overCap(sizes: readonly number[], adding: number, max: number): number {
  let live = sizes.reduce((sum, n) => sum + n, 0);
  let freed = 0;
  while (freed < sizes.length && live + adding > max) live -= sizes[freed++];
  return freed;
}

export class PartDebris {
  private readonly flying: DebrisSim;
  private bursts: Live[] = [];

  constructor(private readonly scope: RenderScope, terrain: Terrain) {
    this.flying = new DebrisSim(terrain);
  }

  burst(key: string, at: V3, center: V3, near: readonly Obstacle[]): void {
    const srcs = piecesOf('good_scrap');
    this.freeOldest(overCap(this.bursts.map((b) => b.group.children.length), srcs.length, PART_DEBRIS_MAX));
    const map = toMap(at);
    const out = new THREE.Vector3(at.x - center.x, 0, at.z - center.z);
    if (out.lengthSq() < 1e-6) out.set(Math.cos(hashStr(key) * Math.PI * 2), 0, Math.sin(hashStr(key) * Math.PI * 2));
    out.normalize();
    const pose = { origin: new THREE.Vector3(at.x, at.y + PART_LIFT, at.z), turn: new THREE.Quaternion(), scale: new THREE.Vector3().setScalar(PART_DEBRIS_SCALE) };
    const reachable = near.filter((n) => dist(n.pos, map) * S <= FLY_REACH + 2 * S);
    const group = this.flying.fling(srcs, pose, { x: out.x * PART_FLING, y: PART_KICK_UP, z: out.z * PART_FLING }, key, map, reachable);
    group.matrixAutoUpdate = false;
    this.scope.add(group, map, FLY_REACH / S);
    this.bursts.push({ group, age: 0 });
  }

  play(trucks: readonly TruckBox[], dt: number): void {
    this.flying.moveTrucks(trucks);
    this.flying.step(dt);
    for (const b of this.bursts) {
      b.age += dt;
      if (b.age > PART_DEBRIS_LINGER) shrink(b.group, 1 - (b.age - PART_DEBRIS_LINGER) / PART_DEBRIS_FADE);
    }
    this.freeOldest(this.bursts.filter((b) => b.age >= PART_DEBRIS_LINGER + PART_DEBRIS_FADE).length);
  }

  free(): void {
    this.freeOldest(this.bursts.length);
    this.flying.free();
  }

  private freeOldest(n: number): void {
    for (const b of this.bursts.splice(0, n)) {
      this.flying.drop(b.group);
      this.scope.remove(b.group);
      disposeTree(b.group);
    }
  }
}

function shrink(group: THREE.Group, share: number): void {
  for (const piece of group.children) {
    piece.scale.setScalar(Math.max(0, share));
    piece.updateMatrix();
  }
}

const SIGNATURE_FX: Record<BreakSignature, (fx: Fx3D, at: V3) => void> = {
  ammo: (fx, at) => fx.ammoBlast(at),
  air: (fx, at) => fx.airBurst(at),
  fire: (fx, at) => fx.fireBurst(at),
};

export function playBreak(world: World, debris: PartDebris, fx: Fx3D, view: VehicleView | undefined, brk: PartBreak): V3 | null {
  if (!view) return null;
  const at = view.partPoint(brk.part);
  debris.burst(`${brk.vehicle}:${brk.part}:${world.turn}`, at, view.center(), world.obstacles);
  const sig = breakSignature(partDef(partOf(world, brk.vehicle, brk.part).defId));
  if (sig) SIGNATURE_FX[sig](fx, at);
  return at;
}

function partOf(world: World, vehicleId: string, partId: string): PartInstance {
  const v = [...world.vehicles, ...world.removed].find((x) => x.id === vehicleId);
  const item = v?.items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item || item.kind !== 'part') throw new Error(`Part ${partId} of ${vehicleId} was disabled but is not on the vehicle`);
  return item.part;
}
