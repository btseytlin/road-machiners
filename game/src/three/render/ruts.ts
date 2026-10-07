// Tire marks a seen truck leaves on soft ground. Each rear wheel on the ground, the pair that follows the truck's
// path, extends its own strip by one quad each RUT.step meters of travel, draped on the ground and as wide as the tire, and darker on ground with a higher
// rut in TERRAIN_TYPES. Marks fade over a day of turns. All strips share one instanced ring buffer: past RUT.max
// segments the oldest is overwritten. Render-only: never saved and never read by sim or physics.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES } from '../../data/terrain';
import { wheelMounts } from '../../phys/body';
import { TIME } from '../../data/time';
import { groundPoint, headingOf, toMap, type V3, type VehicleFrame } from '../../phys/frames';
import { bodyOf } from '../../sim/body';
import { deckAt } from '../../sim/bridge';
import { tileAt, type Terrain } from '../../sim/terrain';
import type { Vehicle, World } from '../../sim/types';

export const RUT = {
  max: 8000, // segments alive at once; a new one past it overwrites the oldest
  wheels: [2, 3], // the wheelMounts indices that mark: the rear pair, so a turning truck leaves one left and one right track
  step: 0.5, // meters a wheel travels per segment
  gap: 4, // meters a wheel may move between frames and still join its strip, so fast trucks at low fps leave no holes
  width: 0.3, // meters across, the tire's width
  lift: 0.04, // meters above the ground, against z-fighting with polygonOffset
  lifeTurns: TIME.turnsPerDay,
  color: 0x5a4632, // what a full-darkness rut multiplies the ground by
} as const;

const WHITE = new THREE.Color(1, 1, 1);
const DARK = new THREE.Color(RUT.color);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Ruts {
  readonly mesh: THREE.InstancedMesh;
  private readonly last = new Map<string, (V3 | null)[]>(); // per vehicle, each wheel's strip end; null starts a new strip
  private readonly turns = new Float64Array(RUT.max); // per slot, the turn its segment was laid
  private readonly darkness = new Float32Array(RUT.max); // per slot, the ground's rut
  private next = 0; // the slot the next segment takes
  private drawnTurn = Number.NaN; // the turn the fade was last drawn for
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly mid = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  // Multiply blending darkens the ground under a rut by its colour; a white instance leaves it unchanged, so each
  // instance fades by its colour alone. MultiplyBlending needs premultiplied alpha. No stencil writes.
  private readonly material = new THREE.MeshBasicMaterial({
    blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });

  constructor(private readonly scene: THREE.Scene) {
    // A unit quad on the ground: length along x, width along z, facing up.
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(quad, this.material, RUT.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, WHITE); // creates the per-instance colours
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // ruts lie all over the map; the bounds of one quad mean nothing
    scene.add(this.mesh);
  }

  // Extends the strips of a truck the caller knows is seen and driving: ruts never give away a truck the player cannot
  // see. tires are the frame's tirePoints().
  layTracks(world: World, v: Vehicle, f: VehicleFrame, tires: V3[]): void {
    if (tires.length !== f.wheels.length) throw new Error(`Vehicle ${v.id} has ${f.wheels.length} wheel frames for ${tires.length} wheels`);
    const ends = this.endsOf(v.id, tires.length);
    for (const i of RUT.wheels) this.extend(ends, i, tires[i], f.wheels[i].ground ? rutAt(world.terrain, tires[i]) : 0, world.turn);
  }

  // Fades the segments to the turn's age, once per turn, and hides the expired ones.
  tick(turn: number): void {
    if (turn === this.drawnTurn) return;
    this.drawnTurn = turn;
    for (let k = 0; k < this.mesh.count; k++) {
      const share = fadeOf(turn - this.turns[k]);
      if (share === 0) this.mesh.setMatrixAt(k, HIDDEN);
      this.mesh.setColorAt(k, this.tint.lerpColors(WHITE, DARK, this.darkness[k] * share));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.markColors();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }

  // Lays a segment once wheel i has moved a step from its strip end. A wheel in the air, on ground that takes no ruts
  // or on a deck (rut 0) ends its strip, and one that jumped over RUT.gap starts a new strip where it is.
  private extend(ends: (V3 | null)[], i: number, p: V3, rut: number, turn: number): void {
    if (rut === 0) {
      ends[i] = null;
      return;
    }
    const end = ends[i];
    if (end !== null) {
      const moved = Math.hypot(p.x - end.x, p.z - end.z);
      if (moved < RUT.step) return;
      if (moved <= RUT.gap) this.lay(end, p, rut, turn);
    }
    ends[i] = p;
  }

  private endsOf(id: string, wheels: number): (V3 | null)[] {
    let ends = this.last.get(id);
    if (!ends) {
      ends = new Array<V3 | null>(wheels).fill(null);
      this.last.set(id, ends);
    }
    return ends;
  }

  // One quad from a to b, lifted off the ground, its width kept level across the travel.
  private lay(a: V3, b: V3, rut: number, turn: number): void {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const flat = Math.hypot(dx, dz);
    this.euler.set(0, -Math.atan2(dz, dx), Math.atan2(dy, flat));
    this.quat.setFromEuler(this.euler);
    this.mid.set((a.x + b.x) / 2, (a.y + b.y) / 2 + RUT.lift, (a.z + b.z) / 2);
    this.scale.set(Math.hypot(flat, dy), 1, RUT.width);
    const k = this.next;
    this.mesh.setMatrixAt(k, this.matrix.compose(this.mid, this.quat, this.scale));
    this.mesh.setColorAt(k, this.tint.lerpColors(WHITE, DARK, rut));
    this.turns[k] = turn;
    this.darkness[k] = rut;
    this.next = (k + 1) % RUT.max;
    this.mesh.count = Math.max(this.mesh.count, k + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.markColors();
  }

  private markColors(): void {
    const colors = this.mesh.instanceColor;
    if (!colors) throw new Error('Ruts lost their instance colours');
    colors.needsUpdate = true;
  }
}

// The rut darkness at a tire's ground point: the ground type's rut, or 0 on a deck.
function rutAt(t: Terrain, p: V3): number {
  const at = toMap(p);
  if (deckAt(at.x, at.y) !== null) return 0;
  return TERRAIN_TYPES[t.types[tileAt(t, at)]].rut;
}

// The share of a segment's darkness left at an age in turns: 1 when new, down to 0 at the end of its life.
function fadeOf(age: number): number {
  return Math.max(0, 1 - age / RUT.lifeTurns);
}

// Each tire's ground contact under a frame's pose, in physics meters and wheelMounts order. Wheel dust and ruts start here.
export function tirePoints(terrain: Terrain, chassisId: string, f: VehicleFrame): V3[] {
  const h = headingOf(f.rot);
  const at = toMap(f.pos);
  return wheelMounts(bodyOf(chassisId)).map((m) => {
    const off = { x: m.x * Math.cos(h) - m.z * Math.sin(h), z: m.x * Math.sin(h) + m.z * Math.cos(h) };
    return groundPoint(terrain, { x: at.x + off.x / PHYSICS.metersPerTile, y: at.y + off.z / PHYSICS.metersPerTile });
  });
}
