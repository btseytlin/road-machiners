
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES } from '../../data/terrain';
import { wheelMounts } from '../../phys/body';
import { TIME } from '../../data/time';
import { groundPoint, headingOf, toMap, type V3, type VehicleFrame } from '../../phys/frames';
import { bodyOf } from '../../sim/body';
import { atlasOf } from '../../sim/atlas';
import { deckAt } from '../../sim/bridge';
import { tileAt, type Terrain } from '../../sim/terrain';
import type { Vehicle, World } from '../../sim/types';

export const RUT = {
  max: 8000,
  wheels: [2, 3],
  step: 0.5,
  gap: 4,
  width: 0.3,
  lift: 0.04,
  lifeTurns: TIME.turnsPerDay,
  color: 0x5a4632,
} as const;

const WHITE = new THREE.Color(1, 1, 1);
const DARK = new THREE.Color(RUT.color);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Ruts {
  readonly mesh: THREE.InstancedMesh;
  private readonly last = new Map<string, (V3 | null)[]>();
  private readonly turns = new Float64Array(RUT.max);
  private readonly darkness = new Float32Array(RUT.max);
  private next = 0;
  private drawnTurn = Number.NaN;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly mid = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly material = new THREE.MeshBasicMaterial({
    blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });

  constructor(private readonly scene: THREE.Scene) {
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(quad, this.material, RUT.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, WHITE);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  layTracks(world: World, v: Vehicle, f: VehicleFrame, tires: V3[]): void {
    if (tires.length !== f.wheels.length) throw new Error(`Vehicle ${v.id} has ${f.wheels.length} wheel frames for ${tires.length} wheels`);
    const ends = this.endsOf(v.id, tires.length);
    for (const i of RUT.wheels) this.extend(ends, i, tires[i], f.wheels[i].ground ? rutAt(world.terrain, tires[i]) : 0, world.turn);
  }

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

function rutAt(t: Terrain, p: V3): number {
  const at = toMap(p);
  if (deckAt(atlasOf(t).decks, at.x, at.y) !== null) return 0;
  return TERRAIN_TYPES[t.types[tileAt(t, at)]].rut;
}

function fadeOf(age: number): number {
  return Math.max(0, 1 - age / RUT.lifeTurns);
}

export function tirePoints(terrain: Terrain, chassisId: string, f: VehicleFrame): V3[] {
  const h = headingOf(f.rot);
  const at = toMap(f.pos);
  return wheelMounts(bodyOf(chassisId)).map((m) => {
    const off = { x: m.x * Math.cos(h) - m.z * Math.sin(h), z: m.x * Math.sin(h) + m.z * Math.cos(h) };
    return groundPoint(terrain, { x: at.x + off.x / PHYSICS.metersPerTile, y: at.y + off.z / PHYSICS.metersPerTile });
  });
}
