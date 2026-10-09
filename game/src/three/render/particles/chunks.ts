import * as THREE from 'three';
import { groundPoint, toMap, type V3 } from '../../../phys/frames';
import { count } from '../../../perf';
import type { Terrain } from '../../../sim/terrain';
import type { Nearby } from './particles';

export const CHUNK_OVERWRITE_COUNTER = 'fx.chunks.overwritten';
export const CHUNK_FAR_COUNTER = 'fx.chunks.far';

export const CHUNK = {
  shapes: 3,
  gravity: 9.8,
  bounce: 0.3,
  slide: 0.5,
  shrinkShare: 0.35,
  spin: 14,
  jag: 0.35,
} as const;

type Chunk = {
  alive: boolean;
  shape: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  roll: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  bounced: boolean;
  color: THREE.Color;
};

export class ChunkBatch {
  readonly meshes: THREE.InstancedMesh[];
  private readonly chunks: Chunk[];
  private head = 0;
  private readonly material = new THREE.MeshLambertMaterial({ flatShading: true });
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  constructor(private readonly capacity: number, random: () => number, private readonly nearby: Nearby) {
    this.meshes = Array.from({ length: CHUNK.shapes }, () => {
      const mesh = new THREE.InstancedMesh(rockGeometry(random), this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      return mesh;
    });
    this.chunks = Array.from({ length: capacity }, () => ({
      alive: false,
      shape: 0,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      axis: new THREE.Vector3(1, 0, 0),
      roll: 0,
      spin: 0,
      size: 0,
      age: 0,
      life: 1,
      bounced: false,
      color: new THREE.Color(),
    }));
  }

  spawn(p: V3, vel: V3, size: number, life: number, color: THREE.Color): void {
    if (!this.nearby(p)) {
      count(CHUNK_FAR_COUNTER);
      return;
    }
    const c = this.chunks[this.head];
    if (c.alive) count(CHUNK_OVERWRITE_COUNTER);
    this.head = (this.head + 1) % this.capacity;
    c.alive = true;
    c.shape = Math.floor(Math.random() * CHUNK.shapes);
    c.pos.set(p.x, p.y, p.z);
    c.vel.set(vel.x, vel.y, vel.z);
    c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    c.roll = Math.random() * Math.PI * 2;
    c.spin = CHUNK.spin * (0.5 + Math.random());
    c.size = size;
    c.age = 0;
    c.life = life;
    c.bounced = false;
    c.color.copy(color);
  }

  tick(dt: number, terrain: Terrain): void {
    for (const c of this.chunks) {
      if (!c.alive) continue;
      c.age += dt;
      if (c.age >= c.life) {
        c.alive = false;
        continue;
      }
      this.fly(c, dt, terrain);
    }
    this.draw();
  }

  private fly(c: Chunk, dt: number, terrain: Terrain): void {
    c.vel.y -= CHUNK.gravity * dt;
    c.pos.addScaledVector(c.vel, dt);
    c.roll += c.spin * dt;
    const rest = groundPoint(terrain, toMap(c.pos)).y + c.size * 0.5;
    if (c.pos.y > rest) return;
    c.pos.y = rest;
    if (c.bounced) {
      c.vel.set(0, 0, 0);
      c.spin = 0;
      return;
    }
    c.bounced = true;
    c.vel.set(c.vel.x * CHUNK.slide, -c.vel.y * CHUNK.bounce, c.vel.z * CHUNK.slide);
    c.spin *= CHUNK.slide;
  }

  private draw(): void {
    const counts = this.meshes.map(() => 0);
    for (const c of this.chunks) {
      if (!c.alive) continue;
      const mesh = this.meshes[c.shape];
      const i = counts[c.shape]++;
      this.quat.setFromAxisAngle(c.axis, c.roll);
      this.scale.setScalar(c.size * shrinkOf(c.age / c.life));
      this.matrix.compose(c.pos, this.quat, this.scale);
      mesh.setMatrixAt(i, this.matrix);
      mesh.setColorAt(i, c.color);
    }
    this.meshes.forEach((mesh, s) => {
      mesh.count = counts[s];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
}

export function shrinkOf(t: number): number {
  const from = 1 - CHUNK.shrinkShare;
  return t <= from ? 1 : 1 - (t - from) / CHUNK.shrinkShare;
}

function rockGeometry(random: () => number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = geo.getAttribute('position');
  const pushed = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = pushed.get(key);
    if (k === undefined) {
      k = 1 + (random() - 0.5) * 2 * CHUNK.jag;
      pushed.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}
