// Harpoon lines: a rope from the harpoon on one truck to the part it holds on the other, between the two vehicle
// views' part points each frame, so it follows the trucks as they move. A line shows while it holds and both trucks
// are drawn. A line shot this turn stays hidden while movement plays, then grows from the harpoon to its anchor over
// LOOK.shotMs at the volley. Render only: it reads the holding lines and never changes them.

import * as THREE from 'three';
import type { V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { lineAnchors } from '../../sim/harpoon';
import type { World } from '../../sim/types';
import type { VehicleView } from './vehicle';

const LOOK = { radius: 0.05, sides: 6, shotMs: 250 }; // meters across half the rope, the faces around it, and the shot's time to reach its anchor
const UP = new THREE.Vector3(0, 1, 0);

// The lines shot in the turn now playing, and whether its movement has played, so their shot can fly.
export type LineShots = { fresh: ReadonlySet<string>; moved: boolean };

export class HarpoonLinesView {
  readonly root = new THREE.Group();
  private readonly ropes = new Map<string, THREE.Mesh>();
  private readonly shotAt = new Map<string, number>(); // ms when each fresh line's shot started, by line id
  // One meter of rope along y, stretched and turned onto each line.
  private readonly geometry = new THREE.CylinderGeometry(LOOK.radius, LOOK.radius, 1, LOOK.sides, 1, true);
  private readonly material = new THREE.MeshLambertMaterial({ color: PAL.rope });

  update(world: World, views: ReadonlyMap<string, VehicleView>, nowMs: number, shots: LineShots): void {
    const shown = ropeEnds(world, views);
    for (const id of shots.moved ? [] : shots.fresh) shown.delete(id);
    this.prune(shown, shots);
    for (const [id, ends] of shown) stretch(this.ropeOf(id), ends.a, ends.b, this.reach(id, shots, nowMs));
  }

  // Drops the ropes not shown, and the shot starts of lines no longer fresh.
  private prune(shown: ReadonlyMap<string, unknown>, shots: LineShots): void {
    for (const [id, rope] of this.ropes) {
      if (shown.has(id)) continue;
      this.root.remove(rope);
      this.ropes.delete(id);
    }
    for (const id of this.shotAt.keys()) if (!shots.fresh.has(id)) this.shotAt.delete(id);
  }

  // Share of the rope out from the harpoon: a fresh line's grows over the shot, any other is whole.
  private reach(id: string, shots: LineShots, nowMs: number): number {
    if (!shots.fresh.has(id)) return 1;
    const start = this.shotAt.get(id) ?? nowMs;
    this.shotAt.set(id, start);
    return Math.min(1, (nowMs - start) / LOOK.shotMs);
  }

  private ropeOf(id: string): THREE.Mesh {
    const known = this.ropes.get(id);
    if (known) return known;
    const rope = new THREE.Mesh(this.geometry, this.material);
    this.root.add(rope);
    this.ropes.set(id, rope);
    return rope;
  }
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
function stretch(rope: THREE.Mesh, a: V3, b: V3, reach: number): void {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).multiplyScalar(reach);
  const length = dir.length();
  rope.visible = length > 0;
  if (length === 0) return;
  rope.position.set(a.x + dir.x / 2, a.y + dir.y / 2, a.z + dir.z / 2);
  rope.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  rope.scale.set(1, length, 1);
}
