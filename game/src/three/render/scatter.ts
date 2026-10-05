// Ground scatter: loose pebbles and dry scrub on open ground, with scrub dense on scrub ground. Decoration only, no collision.
// Placement comes from render noise per tile, so it is the same on every load. Each terrain chunk
// draws its scatter as one instanced model per kind.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { TerrainTypeId } from '../../data/terrain';
import { REGION } from '../../data/region';
import { hash2 } from '../../render/noise';
import { ROAD_INDEX } from '../../sim/road-index';
import { groundAt, type Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import { instancedModel } from './models';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
const ROAD_GAP = REGION.roadWidth / 2 + 0.3; // tiles from a road center line kept free of scatter
const OBSTACLE_GAP = 0.5; // tiles past an obstacle's radius kept free of scatter
const PEBBLE_CHANCE = 0.3; // share of tiles with a pebble cluster
// Share of scrub tiles with a scrub tuft. Dense, so scrub ground reads as brush at the default zoom.
const SCRUB_ON_SCRUB = 0.45;
// Share of other open tiles with a scrub tuft. Sparse, so bare ground still shows a stray bush.
const SCRUB_ELSEWHERE = 0.04;
const PEBBLE_RADIUS = { min: 0.025, max: 0.045 }; // tiles
const SCRUB_RADIUS = { min: 0.07, max: 0.12 }; // tiles
const TINT = { min: 0.85, max: 1.15 };

type Placed = { matrix: THREE.Matrix4; tint: number };

export function addScatter(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const blocked = blockedTiles(t.size, obstacles);
  const place = new THREE.Object3D();
  const lerp = (r: { min: number; max: number }, s: number) => r.min + (r.max - r.min) * s;
  for (let cy = 0; cy < t.size; cy += TERRAIN_CHUNK) for (let cx = 0; cx < t.size; cx += TERRAIN_CHUNK) {
    const pebbles: Placed[] = [];
    const scrub: Placed[] = [];
    for (let y = cy; y < Math.min(cy + TERRAIN_CHUNK, t.size); y++) for (let x = cx; x < Math.min(cx + TERRAIN_CHUNK, t.size); x++) {
      if (blocked[y * t.size + x]) continue;
      const h = hash2(x * 7 + 3, y * 13 + 5);
      const isPebble = h < PEBBLE_CHANCE;
      const isScrub = h > 1 - scrubChance(t.types[y * t.size + x]);
      if (!isPebble && !isScrub) continue;
      const p = { x: x + hash2(x, y * 3), y: y + hash2(x * 5, y) };
      if (ROAD_INDEX.nearestWithin(p.x, p.y, ROAD_GAP) < ROAD_GAP) continue;
      const size = hash2(x * 11 + 1, y * 17 + 9);
      place.position.set(p.x * S, groundAt(t, p.x, p.y) * S, p.y * S);
      place.rotation.y = hash2(x * 19, y * 23 + 1) * Math.PI * 2;
      place.scale.setScalar(lerp(isPebble ? PEBBLE_RADIUS : SCRUB_RADIUS, size) * S);
      place.updateMatrix();
      (isPebble ? pebbles : scrub).push({ matrix: place.matrix.clone(), tint: lerp(TINT, hash2(x * 29 + 4, y * 31)) });
    }
    const center = { x: cx + TERRAIN_CHUNK / 2, y: cy + TERRAIN_CHUNK / 2 };
    const reach = (TERRAIN_CHUNK / 2) * Math.SQRT2 + 1;
    for (const [name, list] of [['pebbles', pebbles], ['scrub', scrub]] as const) {
      if (list.length === 0) continue;
      const group = instancedModel(name, list.map((p) => p.matrix), list.map((p) => p.tint));
      for (const mesh of group.children) mesh.castShadow = false;
      scope.add(group, center, reach);
    }
  }
}

// Share of tiles of a ground type with a scrub tuft.
function scrubChance(type: TerrainTypeId): number {
  return type === 'scrub' ? SCRUB_ON_SCRUB : SCRUB_ELSEWHERE;
}

// Tiles whose center lies within an obstacle's radius plus the gap.
function blockedTiles(size: number, obstacles: Obstacle[]): Uint8Array {
  const out = new Uint8Array(size * size);
  for (const o of obstacles) {
    const r = o.r + OBSTACLE_GAP;
    for (let y = Math.max(0, Math.floor(o.pos.y - r)); y <= Math.min(size - 1, Math.ceil(o.pos.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(o.pos.x - r)); x <= Math.min(size - 1, Math.ceil(o.pos.x + r)); x++) {
        if (Math.hypot(x + 0.5 - o.pos.x, y + 0.5 - o.pos.y) <= r) out[y * size + x] = 1;
      }
    }
  }
  return out;
}
