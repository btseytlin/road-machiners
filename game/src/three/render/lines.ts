// Harpoon lines: a rope from the harpoon on one truck to the part it holds on the other, between the two vehicle
// views' part points each frame, so it follows the trucks as they move. A line shows while it holds and both trucks
// are drawn. A line shot this turn stays hidden while its turn plays: the shot's own rope flies with the bolt (see
// Projectiles). A line that lets go, ages out or tears, reels its far end back into the harpoon over
// ROPE_LOOK.reelMs.
// Render only: it reads the holding lines and never changes them.

import * as THREE from 'three';
import type { V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { lineAnchors } from '../../sim/harpoon';
import type { World } from '../../sim/types';
import type { VehicleView } from './vehicle';

// radius: meters across half the rope. sides: the faces around it. reelMs: how long a loose rope takes to reel in.
// restMs: how long a missed shot's rope lies on the ground before it reels in.
export const ROPE_LOOK = { radius: 0.08, sides: 6, reelMs: 600, restMs: 400 };
const UP = new THREE.Vector3(0, 1, 0);

// The lines shot in the turn now playing, and whether that turn is still playing.
export type LineShots = { fresh: ReadonlySet<string>; playing: boolean };

// A rope whose far end slides back to its near end, and when it started, in ms.
type Reel = { rope: THREE.Mesh; startMs: number; a: () => V3 | null; b: V3 };

export class HarpoonLinesView {
  readonly root = new THREE.Group();
  private readonly ropes = new Map<string, { mesh: THREE.Mesh; from: string; fromPart: string; b: V3 }>();
  private readonly reels: Reel[] = [];

  update(world: World, views: ReadonlyMap<string, VehicleView>, nowMs: number, shots: LineShots): void {
    const shown = ropeEnds(world, views);
    if (shots.playing) for (const id of shots.fresh) shown.delete(id);
    this.letGo(world, shown, views, nowMs);
    for (const [id, ends] of shown) {
      const rope = this.ropeOf(id, world);
      stretchRope(rope.mesh, ends.a, ends.b, 1);
      rope.b = ends.b;
    }
    this.reel(nowMs);
  }

  // A rope whose line is gone reels in toward the harpoon while the harpoon is drawn. A line that still holds but
  // does not show, as when a truck leaves the drawn world, just goes.
  private letGo(world: World, shown: ReadonlyMap<string, unknown>, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    for (const [id, rope] of this.ropes) {
      if (shown.has(id)) continue;
      this.ropes.delete(id);
      if (world.lines.some((l) => l.id === id)) this.root.remove(rope.mesh);
      else this.reels.push({ rope: rope.mesh, startMs: nowMs, a: () => harpoonPoint(views, rope.from, rope.fromPart), b: rope.b });
    }
  }

  private reel(nowMs: number): void {
    for (let i = this.reels.length - 1; i >= 0; i--) {
      const r = this.reels[i];
      const left = 1 - (nowMs - r.startMs) / ROPE_LOOK.reelMs;
      const a = r.a();
      if (left <= 0 || !a) {
        this.root.remove(r.rope);
        this.reels.splice(i, 1);
        continue;
      }
      stretchRope(r.rope, a, r.b, left);
    }
  }

  private ropeOf(id: string, world: World): { mesh: THREE.Mesh; from: string; fromPart: string; b: V3 } {
    const known = this.ropes.get(id);
    if (known) return known;
    const line = world.lines.find((l) => l.id === id);
    if (!line) throw new Error(`No harpoon line ${id} to draw`);
    const rope = { mesh: ropeMesh(), from: line.from, fromPart: line.fromPart, b: { x: 0, y: 0, z: 0 } };
    this.root.add(rope.mesh);
    this.ropes.set(id, rope);
    return rope;
  }
}

// Where the harpoon on a drawn truck is, or null when the truck or the harpoon is no longer drawn.
function harpoonPoint(views: ReadonlyMap<string, VehicleView>, vehicleId: string, partId: string): V3 | null {
  const view = views.get(vehicleId);
  return view && view.hasPart(partId) ? view.partPoint(partId) : null;
}

// One meter of rope along y, stretched and turned onto each line by stretchRope.
const ROPE_GEOMETRY = new THREE.CylinderGeometry(ROPE_LOOK.radius, ROPE_LOOK.radius, 1, ROPE_LOOK.sides, 1, true);
const ROPE_MATERIAL = new THREE.MeshLambertMaterial({ color: PAL.rope });

export function ropeMesh(): THREE.Mesh {
  return new THREE.Mesh(ROPE_GEOMETRY, ROPE_MATERIAL);
}

// The two anchor points of each holding line whose trucks are both drawn, by line id.
function ropeEnds(world: World, views: ReadonlyMap<string, VehicleView>): Map<string, { a: V3; b: V3 }> {
  const holding = new Set(lineAnchors(world).map((l) => l.id));
  const ends = new Map<string, { a: V3; b: V3 }>();
  for (const line of world.lines) {
    const from = views.get(line.from);
    const to = views.get(line.to);
    if (holding.has(line.id) && from && to) ends.set(line.id, { a: from.partPoint(line.fromPart), b: to.partPoint(line.toPart) });
  }
  return ends;
}

// Lays the rope straight from a toward b, `reach` of the way.
export function stretchRope(rope: THREE.Mesh, a: V3, b: V3, reach: number): void {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).multiplyScalar(reach);
  const length = dir.length();
  rope.visible = length > 0;
  if (length === 0) return;
  rope.position.set(a.x + dir.x / 2, a.y + dir.y / 2, a.z + dir.z / 2);
  rope.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  rope.scale.set(1, length, 1);
}
