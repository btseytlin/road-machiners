// Fog of war greys out the ground itself: the ground shader drains the color from tiles out of sight, and
// darkens tiles never seen. Grey, not a dark or pale layer on top, so shade stays the only dark ground and
// hidden ground does not read as smoke. Per corner, the attribute holds how grey and how bright the ground is.

import * as THREE from 'three';
import { TERRAIN } from '../../data/terrain';
import type { World } from '../../sim/types';
import type { SightLimit } from './scope';
import { TERRAIN_CHUNK, type TerrainChunk } from './terrain';

const VISIBLE = 0;
const EXPLORED = 1;
const DARK = 2;
const UNSET = 255;

type Look = { grey: number; bright: number };
type FogChunk = { x: number; y: number; width: number; depth: number; look: THREE.BufferAttribute };

export class FogView {
  private readonly chunks: FogChunk[] = [];
  private readonly perSide: number;
  private readonly state: Uint8Array;
  private readonly dirty: Uint8Array;
  private readonly lookOf: Look[] = [{ grey: 0, bright: 1 }, TERRAIN.fog.seen, TERRAIN.fog.unseen];

  constructor(world: World, ground: TerrainChunk[], private readonly limit: SightLimit) {
    const n = world.size;
    this.perSide = Math.ceil(n / TERRAIN_CHUNK);
    this.state = new Uint8Array(n * n).fill(UNSET);
    this.dirty = new Uint8Array(this.perSide * this.perSide);
    const materials = new Set<THREE.MeshLambertMaterial>();
    for (const g of ground) {
      const look = new THREE.BufferAttribute(new Float32Array((g.width + 1) * (g.depth + 1) * 2), 2);
      g.mesh.geometry.setAttribute('fogLook', look);
      materials.add(g.mesh.material as THREE.MeshLambertMaterial);
      this.chunks[(g.y / TERRAIN_CHUNK) * this.perSide + g.x / TERRAIN_CHUNK] = { x: g.x, y: g.y, width: g.width, depth: g.depth, look };
    }
    for (const mat of materials) greyOut(mat);
    this.update(world);
  }

  update(world: World): void {
    const n = world.size;
    const visible = new Uint8Array(n * n);
    for (const t of world.player.visible) visible[t] = 1;
    this.limit.showVisible(world.player.visible);
    const explored = world.player.explored;
    const C = TERRAIN_CHUNK;
    for (let t = 0; t < n * n; t++) {
      const s = visible[t] ? VISIBLE : explored[t] ? EXPLORED : DARK;
      if (s === this.state[t]) continue;
      this.state[t] = s;
      const x = t % n;
      const y = (t - x) / n;
      const cx0 = x % C === 0 && x > 0 ? x / C - 1 : Math.floor(x / C);
      const cx1 = Math.min(Math.floor((x + 1) / C), this.perSide - 1);
      const cy0 = y % C === 0 && y > 0 ? y / C - 1 : Math.floor(y / C);
      const cy1 = Math.min(Math.floor((y + 1) / C), this.perSide - 1);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.dirty[cy * this.perSide + cx] = 1;
    }
    for (let k = 0; k < this.chunks.length; k++) {
      if (!this.dirty[k]) continue;
      this.dirty[k] = 0;
      this.writeChunk(this.chunks[k], n);
    }
  }

  private writeChunk(chunk: FogChunk, n: number): void {
    const array = chunk.look.array as Float32Array;
    for (let j = 0; j <= chunk.depth; j++) for (let i = 0; i <= chunk.width; i++) {
      let grey = 0;
      let bright = 0;
      let count = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const x = chunk.x + i + dx;
        const y = chunk.y + j + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const look = this.lookOf[this.state[y * n + x]];
        grey += look.grey;
        bright += look.bright;
        count++;
      }
      const k = (j * (chunk.width + 1) + i) * 2;
      array[k] = grey / count;
      array[k + 1] = bright / count;
    }
    chunk.look.needsUpdate = true;
  }
}

function greyOut(mat: THREE.MeshLambertMaterial): void {
  const before = mat.onBeforeCompile.bind(mat);
  const key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fogLook;\nvarying vec2 vFogLook;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogLook = fogLook;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogLook;')
      .replace(
        '#include <opaque_fragment>',
        `float fogLuma = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
        outgoingLight = mix(outgoingLight, vec3(fogLuma), vFogLook.x) * vFogLook.y;
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `${key()}|fog`;
  mat.needsUpdate = true;
}
