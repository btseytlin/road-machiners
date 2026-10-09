import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { World } from '../../sim/types';
import { FogView } from './fog';
import { SightLimit } from './scope';
import { TERRAIN_CHUNK, type TerrainChunk } from './terrain';

const SIZE = 70;

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function fogWorld(visible: number[], explored: boolean[]): World {
  const heights = Array.from({ length: (SIZE + 1) ** 2 }, (_, i) => (i % 7) * 0.1);
  return { size: SIZE, terrain: { size: SIZE, heights, types: [] }, player: { visible, explored } } as unknown as World;
}

function groundChunks(): TerrainChunk[] {
  const material = new THREE.MeshLambertMaterial();
  const out: TerrainChunk[] = [];
  for (let y = 0; y < SIZE; y += TERRAIN_CHUNK) for (let x = 0; x < SIZE; x += TERRAIN_CHUNK) {
    const width = Math.min(TERRAIN_CHUNK, SIZE - x);
    const depth = Math.min(TERRAIN_CHUNK, SIZE - y);
    out.push({ x, y, width, depth, mesh: new THREE.Mesh(new THREE.PlaneGeometry(1, 1, width, depth), material) });
  }
  if (out.length !== 9) throw new Error(`Expected 9 ground chunks, found ${out.length}`);
  return out;
}

function lookAttributes(ground: TerrainChunk[]): THREE.BufferAttribute[] {
  return ground.map((g) => g.mesh.geometry.getAttribute('fogLook') as THREE.BufferAttribute);
}

function looks(ground: TerrainChunk[]): number[][] {
  return lookAttributes(ground).map((a) => Array.from(a.array as Float32Array));
}

function fresh(world: World): number[][] {
  const ground = groundChunks();
  new FogView(world, ground, new SightLimit(SIZE));
  return looks(ground);
}

function disk(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (Math.hypot(x - cx, y - cy) <= r) out.push(y * SIZE + x);
  return out;
}

describe('fog diff update', () => {
  it('matches a full recompute after random vision changes', () => {
    const rnd = random(3);
    const explored = new Array<boolean>(SIZE * SIZE).fill(false);
    const ground = groundChunks();
    const view = new FogView(fogWorld([], explored), ground, new SightLimit(SIZE));
    for (let step = 0; step < 40; step++) {
      const visible = disk(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 12);
      for (const t of visible) explored[t] = true;
      if (step % 5 === 4) for (let i = 0; i < 50; i++) explored[Math.floor(rnd() * SIZE * SIZE)] = false;
      const world = fogWorld(visible, [...explored]);
      view.update(world);
      expect(looks(ground)).toEqual(fresh(world));
    }
  });

  it('dirties neighbouring chunks when a tile on a chunk border changes', () => {
    const explored = new Array<boolean>(SIZE * SIZE).fill(false);
    const ground = groundChunks();
    const view = new FogView(fogWorld([], explored), ground, new SightLimit(SIZE));
    for (const [x, y] of [[31, 31], [32, 32], [31, 32], [63, 0], [64, 69], [0, 31]]) {
      const world = fogWorld([y * SIZE + x], explored);
      view.update(world);
      expect(looks(ground)).toEqual(fresh(world));
    }
  });

  it('leaves chunks without changed tiles untouched', () => {
    const explored = new Array<boolean>(SIZE * SIZE).fill(false);
    const ground = groundChunks();
    const view = new FogView(fogWorld([], explored), ground, new SightLimit(SIZE));
    const before = lookAttributes(ground).map((a) => a.version);
    view.update(fogWorld(disk(5, 5, 3), explored));
    const changed = lookAttributes(ground).map((a, i) => a.version !== before[i]);
    expect(changed.filter(Boolean).length).toBe(1);
  });
});
