// Harpoon lines: a rope from the harpoon on one truck to the part it holds on the other, between the two vehicle
// views' part points each frame, so it follows the trucks as they move. A line shows while it holds and both trucks
// are drawn. A line shot this turn stays hidden while its turn plays: the shot's own rope flies with the bolt (see
// Projectiles). A line that lets go, ages out or tears, reels its far end back into the harpoon over
// ROPE_LOOK.reelMs.
// Every rope hangs: a line closer than its length sags toward the ground and rests on it, and a stretched one runs
// straight. Render only: it reads the holding lines and never changes them.

import * as THREE from 'three';
import { groundPoint, toMap, type V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { lineAnchors } from '../../sim/harpoon';
import type { Terrain } from '../../sim/terrain';
import type { World } from '../../sim/types';
import type { VehicleView } from './vehicle';

// radius: meters across half the rope. sides: the faces around it. segments: straight pieces along one rope.
// minSlack: the share of its span a taut rope still has spare, so it never reads as a rod. reelMs: how long a loose
// rope takes to reel in. restMs: how long a missed shot's rope lies on the ground before it reels in. missSlack: the
// spare share of a missed shot's rope as it falls. reelSlack: the spare share of a rope while it reels in, so it drags.
export const ROPE_LOOK = { radius: 0.03, sides: 5, segments: 16, minSlack: 0.004, reelMs: 500, restMs: 400, missSlack: 0.15, reelSlack: 0.06 };
const UP = new THREE.Vector3(0, 1, 0);

// The ground height under a point, in meters.
export type GroundAt = (p: V3) => number;

export function groundOf(terrain: Terrain): GroundAt {
  return (p) => groundPoint(terrain, toMap(p)).y;
}

// One rope of short straight pieces, laid as a rope of a given length hanging between two points.
export class Rope {
  readonly root = new THREE.Group();
  private readonly pieces = Array.from({ length: ROPE_LOOK.segments }, () => new THREE.Mesh(ROPE_GEOMETRY, ROPE_MATERIAL));

  constructor() {
    this.root.add(...this.pieces);
  }

  // Lays the rope from a to b, `length` meters long, never below the ground. A rope no longer than its span runs
  // straight with ROPE_LOOK.minSlack to spare.
  set(a: V3, b: V3, length: number, ground: GroundAt): void {
    const points = hangingPoints(a, b, length, ground);
    this.pieces.forEach((piece, i) => stretch(piece, points[i], points[i + 1]));
  }
}

// The points of a rope hanging from a to b: a parabola whose sag spends the rope's spare length, the arc of a span d
// with sag s being about d + 8s²/(3d). Points under the ground rest on it.
function hangingPoints(a: V3, b: V3, length: number, ground: GroundAt): V3[] {
  const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const spare = Math.max(length - span, span * ROPE_LOOK.minSlack);
  const sag = Math.sqrt((3 * span * spare) / 8);
  return Array.from({ length: ROPE_LOOK.segments + 1 }, (_, i) => {
    const t = i / ROPE_LOOK.segments;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t), z: a.z + (b.z - a.z) * t };
    return { ...p, y: Math.max(p.y, ground(p) + ROPE_LOOK.radius) };
  });
}

// The lines shot in the turn now playing, and whether that turn is still playing.
export type LineShots = { fresh: ReadonlySet<string>; playing: boolean };

type Held = { rope: Rope; from: string; fromPart: string; b: V3 };
// A rope whose far end slides back to its near end, and when it started, in ms.
type Reel = { rope: Rope; startMs: number; a: () => V3 | null; b: V3 };

export class HarpoonLinesView {
  readonly root = new THREE.Group();
  private readonly ropes = new Map<string, Held>();
  private readonly reels: Reel[] = [];

  update(world: World, views: ReadonlyMap<string, VehicleView>, nowMs: number, shots: LineShots): void {
    const ground = groundOf(world.terrain);
    const shown = ropeEnds(world, views);
    if (shots.playing) for (const id of shots.fresh) shown.delete(id);
    this.letGo(world, shown, views, nowMs);
    for (const [id, ends] of shown) {
      const held = this.ropeOf(id, world);
      held.rope.set(ends.a, ends.b, ends.length, ground);
      held.b = ends.b;
    }
    this.reel(nowMs, ground);
  }

  // A rope whose line is gone reels in toward the harpoon while the harpoon is drawn. A line that still holds but
  // does not show, as when a truck leaves the drawn world, just goes.
  private letGo(world: World, shown: ReadonlyMap<string, unknown>, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    for (const [id, held] of this.ropes) {
      if (shown.has(id)) continue;
      this.ropes.delete(id);
      if (world.lines.some((l) => l.id === id)) this.root.remove(held.rope.root);
      else this.reels.push({ rope: held.rope, startMs: nowMs, a: () => harpoonPoint(views, held.from, held.fromPart), b: held.b });
    }
  }

  private reel(nowMs: number, ground: GroundAt): void {
    for (let i = this.reels.length - 1; i >= 0; i--) {
      const r = this.reels[i];
      const left = 1 - (nowMs - r.startMs) / ROPE_LOOK.reelMs;
      const a = r.a();
      if (left <= 0 || !a) {
        this.root.remove(r.rope.root);
        this.reels.splice(i, 1);
        continue;
      }
      reelRope(r.rope, a, r.b, left, ground);
    }
  }

  private ropeOf(id: string, world: World): Held {
    const known = this.ropes.get(id);
    if (known) return known;
    const line = world.lines.find((l) => l.id === id);
    if (!line) throw new Error(`No harpoon line ${id} to draw`);
    const held = { rope: new Rope(), from: line.from, fromPart: line.fromPart, b: { x: 0, y: 0, z: 0 } };
    this.root.add(held.rope.root);
    this.ropes.set(id, held);
    return held;
  }
}

// Lays a reeling rope from a toward b, its far end `left` of the way out, dragging slack.
export function reelRope(rope: Rope, a: V3, b: V3, left: number, ground: GroundAt): void {
  const end = { x: a.x + (b.x - a.x) * left, y: a.y + (b.y - a.y) * left, z: a.z + (b.z - a.z) * left };
  rope.set(a, end, Math.hypot(end.x - a.x, end.y - a.y, end.z - a.z) * (1 + ROPE_LOOK.reelSlack), ground);
}

// Where the harpoon on a drawn truck is, or null when the truck or the harpoon is no longer drawn.
function harpoonPoint(views: ReadonlyMap<string, VehicleView>, vehicleId: string, partId: string): V3 | null {
  const view = views.get(vehicleId);
  return view && view.hasPart(partId) ? view.partPoint(partId) : null;
}

// One meter of rope along y, stretched and turned onto each piece of a rope.
const ROPE_GEOMETRY = new THREE.CylinderGeometry(ROPE_LOOK.radius, ROPE_LOOK.radius, 1, ROPE_LOOK.sides, 1, true);
const ROPE_MATERIAL = new THREE.MeshLambertMaterial({ color: PAL.rope });

// The two anchor points of each holding line whose trucks are both drawn, and its length, by line id.
function ropeEnds(world: World, views: ReadonlyMap<string, VehicleView>): Map<string, { a: V3; b: V3; length: number }> {
  const holding = new Set(lineAnchors(world).map((l) => l.id));
  const ends = new Map<string, { a: V3; b: V3; length: number }>();
  for (const line of world.lines) {
    const from = views.get(line.from);
    const to = views.get(line.to);
    if (holding.has(line.id) && from && to) ends.set(line.id, { a: from.partPoint(line.fromPart), b: to.partPoint(line.toPart), length: line.length });
  }
  return ends;
}

// Lays one piece straight from a to b.
function stretch(piece: THREE.Mesh, a: V3, b: V3): void {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const length = dir.length();
  piece.visible = length > 0;
  if (length === 0) return;
  piece.position.set(a.x + dir.x / 2, a.y + dir.y / 2, a.z + dir.z / 2);
  piece.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  piece.scale.set(1, length, 1);
}
