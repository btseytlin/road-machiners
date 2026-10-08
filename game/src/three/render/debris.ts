// Broken props as physical pieces. A prop model splits into its separate parts, each part flies as a rigid body in
// a small render-only physics world, and a piece freezes where it comes to rest. Nothing here changes game rules:
// the sim already removed the prop, and the pieces block nothing.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { obstacleColliders } from '../../phys/drive';
import type { Quat, V3 } from '../../phys/frames';
import { hashStr } from '../../render/noise';
import { bodyOf } from '../../sim/body';
import { propPose } from '../../sim/mapgen';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import { dist } from '../../sim/vec';
import { model, type ModelName } from './models';

const S = PHYSICS.metersPerTile;
const DT = 1 / PHYSICS.stepsPerSecond;
const MAX_STEPS_PER_FRAME = 4;
export const FLY_REACH = 10;
const PATCH_CELLS = 6;
const DENSITY = 600;
const FRICTION = 0.8;
const BOUNCE = 0.2;
const FLING = [0.5, 1.1];
const LIFT = 0.25;
const SPREAD = 0.3;
const SPIN = 1.2;
const TOPPLE = 1.5;
const REST_SPEED = 0.15;
const REST_SPIN = 0.5;
const REST_STEPS = 0.4 * PHYSICS.stepsPerSecond;
const MAX_FLIGHT = 8 * PHYSICS.stepsPerSecond;
const WELD = 1000;

type PieceSource = { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; center: THREE.Vector3; box: THREE.Box3 };
type Flying = { body: RAPIER.RigidBody; mesh: THREE.Object3D; still: number; age: number };
type Burst = { pieces: Flying[]; fixed: RAPIER.Collider[] };
export type TruckBox = { id: string; chassisId: string; pos: V3; rot: Quat };

const sources = new Map<ModelName, PieceSource[]>();

export class DebrisSim {
  private readonly world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  private readonly bursts: Burst[] = [];
  private readonly trucks = new Map<string, RAPIER.RigidBody>();
  private clock = 0;

  constructor(private readonly terrain: Terrain) {
    this.world.timestep = DT;
  }

  burst(o: Obstacle, push: V3 | null, near: readonly Obstacle[]): THREE.Group {
    const group = new THREE.Group();
    const pose = propPose(o);
    const origin = new THREE.Vector3(pose.pos.x * S, heightAt(this.terrain, pose.pos.x, pose.pos.y) * S, pose.pos.y * S);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -pose.yaw);
    const scale = new THREE.Vector3(pose.scale.x, pose.scale.z, pose.scale.y);
    const kick = push ?? topple(o.id);
    const pieces = piecesOf(pose.model).map((src, i) => {
      const mesh = pieceMesh(src, scale);
      group.add(mesh);
      const at = src.center.clone().multiply(scale).applyQuaternion(turn).add(origin);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setRotation(turn).setCcdEnabled(true));
      this.world.createCollider(hull(src, scale), body);
      launch(body, kick, `${o.id}:${i}`);
      place(mesh, body);
      return { body, mesh, still: 0, age: 0 };
    });
    const fixed = [groundPatch(this.terrain, o.pos), ...near.filter((n) => n.id !== o.id && dist(n.pos, o.pos) * S <= FLY_REACH + 2 * S).flatMap((n) => obstacleColliders(this.terrain, n))];
    this.bursts.push({ pieces, fixed: fixed.map((desc) => this.world.createCollider(desc)) });
    return group;
  }

  moveTrucks(trucks: readonly TruckBox[]): void {
    if (this.bursts.length === 0) return;
    const ids = new Set(trucks.map((t) => t.id));
    for (const [id, body] of this.trucks) {
      if (ids.has(id)) continue;
      this.world.removeRigidBody(body);
      this.trucks.delete(id);
    }
    for (const t of trucks) {
      const body = this.trucks.get(t.id) ?? this.addTruck(t);
      body.setNextKinematicTranslation(t.pos);
      body.setNextKinematicRotation(t.rot);
    }
  }

  step(dt: number): void {
    if (this.bursts.length === 0) return;
    this.clock = Math.min(this.clock + dt, MAX_STEPS_PER_FRAME * DT);
    while (this.clock >= DT) {
      this.clock -= DT;
      this.tick();
    }
  }

  settle(): void {
    for (let i = 0; i < MAX_FLIGHT && this.bursts.length > 0; i++) this.tick();
    if (this.bursts.length > 0) throw new Error('Debris pieces kept moving past their longest flight');
  }

  free(): void {
    this.world.free();
  }

  private tick(): void {
    this.world.step();
    for (const burst of this.bursts) burst.pieces = burst.pieces.filter((p) => this.fly(p));
    for (const burst of this.bursts.filter((b) => b.pieces.length === 0)) {
      for (const c of burst.fixed) this.world.removeCollider(c, false);
    }
    this.bursts.splice(0, this.bursts.length, ...this.bursts.filter((b) => b.pieces.length > 0));
    if (this.bursts.length > 0) return;
    for (const body of this.trucks.values()) this.world.removeRigidBody(body);
    this.trucks.clear();
  }

  private fly(p: Flying): boolean {
    place(p.mesh, p.body);
    const v = p.body.linvel();
    const w = p.body.angvel();
    const still = Math.hypot(v.x, v.y, v.z) < REST_SPEED && Math.hypot(w.x, w.y, w.z) < REST_SPIN;
    p.still = still ? p.still + 1 : 0;
    p.age += 1;
    if (p.still < REST_STEPS && p.age < MAX_FLIGHT) return true;
    this.world.removeRigidBody(p.body);
    return false;
  }

  private addTruck(t: TruckBox): RAPIER.RigidBody {
    const half = bodyOf(t.chassisId).half;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(t.pos.x, t.pos.y, t.pos.z).setRotation(t.rot));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
    this.trucks.set(t.id, body);
    return body;
  }
}

function topple(id: string): V3 {
  const a = hashStr(`${id}:topple`) * Math.PI * 2;
  return { x: Math.cos(a) * TOPPLE, y: 0, z: Math.sin(a) * TOPPLE };
}

function launch(body: RAPIER.RigidBody, push: V3, key: string): void {
  const r = (k: string) => hashStr(`${key}:${k}`);
  const speed = Math.hypot(push.x, push.z);
  const across = speed > 0 ? { x: -push.z / speed, z: push.x / speed } : { x: 0, z: 0 };
  const share = FLING[0] + r('fling') * (FLING[1] - FLING[0]);
  const side = (r('side') * 2 - 1) * SPREAD * speed;
  body.setLinvel({ x: push.x * share + across.x * side, y: push.y * share + r('lift') * LIFT * speed, z: push.z * share + across.z * side }, true);
  const spin = SPIN * speed;
  body.setAngvel({ x: (r('sx') * 2 - 1) * spin, y: (r('sy') * 2 - 1) * spin, z: (r('sz') * 2 - 1) * spin }, true);
}

function place(mesh: THREE.Object3D, body: RAPIER.RigidBody): void {
  const t = body.translation();
  const q = body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
  mesh.updateMatrix();
}

function pieceMesh(src: PieceSource, scale: THREE.Vector3): THREE.Object3D {
  const obj = new THREE.Group();
  obj.matrixAutoUpdate = false;
  for (const part of src.parts) {
    const mesh = new THREE.Mesh(part.geometry.clone().scale(scale.x, scale.y, scale.z), part.material.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    obj.add(mesh);
  }
  return obj;
}

function hull(src: PieceSource, scale: THREE.Vector3): RAPIER.ColliderDesc {
  const points = src.parts.flatMap((part) => Array.from(part.geometry.getAttribute('position').array));
  const scaled = new Float32Array(points.map((p, i) => p * [scale.x, scale.y, scale.z][i % 3]));
  const desc = RAPIER.ColliderDesc.convexHull(scaled);
  if (!desc) throw new Error('A debris piece has a flat hull');
  return desc.setDensity(DENSITY).setFriction(FRICTION).setRestitution(BOUNCE);
}

function groundPatch(t: Terrain, at: { x: number; y: number }): RAPIER.ColliderDesc {
  const n = t.size;
  const k = PATCH_CELLS;
  const x0 = Math.max(0, Math.min(n - k, Math.round(at.x) - k / 2));
  const y0 = Math.max(0, Math.min(n - k, Math.round(at.y) - k / 2));
  const heights = new Float32Array((k + 1) * (k + 1));
  for (let i = 0; i <= k; i++) {
    for (let j = 0; j <= k; j++) heights[i * (k + 1) + j] = t.heights[(y0 + j) * (n + 1) + x0 + i];
  }
  return RAPIER.ColliderDesc.heightfield(k, k, heights, { x: k * S, y: S, z: k * S }).setTranslation((x0 + k / 2) * S, 0, (y0 + k / 2) * S).setFriction(FRICTION);
}

function piecesOf(name: ModelName): PieceSource[] {
  const cached = sources.get(name);
  if (cached) return cached;
  const root = model(name);
  root.updateMatrixWorld(true);
  const tris: { pos: Float32Array; material: THREE.Material }[] = [];
  root.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const geo = (m.geometry as THREE.BufferGeometry).toNonIndexed().applyMatrix4(m.matrixWorld);
    const pos = geo.getAttribute('position').array as Float32Array;
    for (let i = 0; i < pos.length; i += 9) tris.push({ pos: pos.slice(i, i + 9), material: m.material as THREE.Material });
  });
  const groups = mergeInside(connected(tris.map((t) => t.pos)), tris.map((t) => t.pos));
  const out = groups.map((ids) => pieceOf(ids.map((i) => tris[i])));
  sources.set(name, out);
  return out;
}

function connected(tris: Float32Array[]): number[][] {
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  tris.forEach((pos, i) => {
    for (let v = 0; v < 9; v += 3) {
      const key = `${Math.round(pos[v] * WELD)},${Math.round(pos[v + 1] * WELD)},${Math.round(pos[v + 2] * WELD)}`;
      const other = owner.get(key);
      if (other === undefined) owner.set(key, i);
      else parent[find(i)] = find(other);
    }
  });
  const byRoot = new Map<number, number[]>();
  tris.forEach((_, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]));
  return [...byRoot.values()];
}

function mergeInside(groups: number[][], tris: Float32Array[]): number[][] {
  const boxes = groups.map((ids) => boxOf(ids.map((i) => tris[i])));
  const order = groups.map((_, i) => i).sort((a, b) => volume(boxes[a]) - volume(boxes[b]));
  const into = groups.map((_, i) => i);
  for (const [k, a] of order.entries()) {
    const host = order.slice(k + 1).find((b) => volume(boxes[a].clone().intersect(boxes[b])) >= volume(boxes[a]) / 2);
    if (host !== undefined) into[a] = host;
  }
  const top = (i: number): number => (into[i] === i ? i : top(into[i]));
  const merged = new Map<number, number[]>();
  groups.forEach((ids, i) => merged.set(top(i), [...(merged.get(top(i)) ?? []), ...ids]));
  return [...merged.values()];
}

function boxOf(tris: Float32Array[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const t of tris) for (let v = 0; v < 9; v += 3) box.expandByPoint(new THREE.Vector3(t[v], t[v + 1], t[v + 2]));
  return box;
}

function volume(box: THREE.Box3): number {
  if (box.isEmpty()) return 0;
  const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.01, 0.01, 0.01));
  return size.x * size.y * size.z;
}

function pieceOf(tris: { pos: Float32Array; material: THREE.Material }[]): PieceSource {
  const box = boxOf(tris.map((t) => t.pos));
  const center = box.getCenter(new THREE.Vector3());
  const byMaterial = new Map<THREE.Material, number[]>();
  for (const t of tris) {
    const list = byMaterial.get(t.material) ?? [];
    for (let v = 0; v < 9; v += 3) list.push(t.pos[v] - center.x, t.pos[v + 1] - center.y, t.pos[v + 2] - center.z);
    byMaterial.set(t.material, list);
  }
  const parts = [...byMaterial].map(([material, list]) => {
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    geometry.computeVertexNormals();
    return { geometry, material };
  });
  return { parts, center, box };
}
