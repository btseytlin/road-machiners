// Ground scatter: loose stones, scrub and short cacti on open ground. Open desert takes grey stones, olive scrub
// and cacti, with cacti gathered by rocks and crags and road shoulders keeping stones only. Ground that takes no
// desert look keeps its small pebbles and dry scrub, as sparse as before. Road tiles scatter as the ground beside
// the road, see lookTypes(). Decoration only, no collision. Placement comes from render noise per tile, so it is
// the same on every load. Each terrain chunk draws its scatter as one instanced model per kind.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES } from '../../data/terrain';
import { REGION } from '../../data/region';
import { desertWeight, lookTypes, type LookType } from '../../render/groundPaint';
import { hash2 } from '../../render/noise';
import { ROAD_INDEX } from '../../sim/road-index';
import { groundAt, type Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import type { Vec } from '../../sim/vec';
import { instancedModel } from './models';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
export const ROAD_GAP = REGION.roadWidth / 2 + 0.3; // tiles from a road center line kept free of scatter
export const SHOULDER_TILES = 2; // tiles past ROAD_GAP where stones gather along a road
export const OBSTACLE_GAP = 0.5; // tiles past an obstacle's radius kept free of scatter
export const CACTUS_NEAR_ROCK = 2; // tiles past a rock's or crag's radius where cacti gather
const PEBBLE_CHANCE = 0.3; // share of tiles with a pebble cluster
const PEBBLE_ON_DESERT = 0.45; // share of open desert tiles with a pebble cluster, at full desert weight
const PEBBLE_ON_SHOULDER = 0.6; // share of desert road shoulder tiles with a stone cluster
// Share of scrub tiles with a scrub tuft. Dense, so scrub ground reads as brush at the default zoom.
const SCRUB_ON_SCRUB = 0.45;
// Share of other open tiles with a scrub tuft. Sparse, so bare ground still shows a stray bush.
const SCRUB_ELSEWHERE = 0.04;
const SCRUB_ON_DESERT = 0.14; // share of open desert tiles with a scrub clump, at full desert weight
const CACTUS_ON_DESERT = 0.01; // share of open desert tiles with a cactus, at full desert weight. Sparse, as trucks pass through.
const CACTUS_BY_ROCK = 0.06; // share of desert tiles by a rock or crag with a cactus, at full desert weight
const PEBBLE_RADIUS = { min: 0.025, max: 0.045 }; // tiles
const SCRUB_RADIUS = { min: 0.07, max: 0.12 }; // tiles
// Desert sizes: big enough to read at the default zoom, small enough that a truck driving over them does not look
// like a crash.
const DESERT_STONES_RADIUS = { min: 0.07, max: 0.14 }; // tiles, so the main stone is 0.2-0.4 m across as in the reference
const DESERT_SCRUB_RADIUS = { min: 0.11, max: 0.17 }; // tiles, a clump 0.9-1.4 m across, small so it recedes
const CACTUS_HEIGHT = { min: 0.8, max: 1.3 }; // meters, under the truck clearance so driving through does not look like a crash
const TINT = { min: 0.85, max: 1.15 };

// The models scatter draws. Desert ground takes desert stones and desert scrub in place of pebbles and scrub.
const MODELS = ['pebbles', 'scrub', 'desert_stones', 'desert_scrub', 'cactus'] as const;
type ScatterModel = (typeof MODELS)[number];
// Scrub and cacti on desert cast shadows so they stand on the ground. Pebbles are too small to need it, and many,
// and the small dry scrub off the desert stays as it was. Every model receives shadows, so scrub in the shadow of a
// crag or a truck goes dark with the ground under it.
const CASTS_SHADOW: ReadonlySet<ScatterModel> = new Set(['desert_scrub', 'cactus']);

type Placed = { matrix: THREE.Matrix4; tint: number };
export type ScatterChunk = { center: Vec } & Record<ScatterModel, Placed[]>;

export function addScatter(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const reach = (TERRAIN_CHUNK / 2) * Math.SQRT2 + 1;
  for (const chunk of scatterPlacements(t, obstacles)) {
    for (const name of MODELS) {
      const list = chunk[name];
      if (list.length === 0) continue;
      const group = instancedModel(name, list.map((p) => p.matrix), list.map((p) => p.tint));
      for (const mesh of group.children) {
        mesh.castShadow = CASTS_SHADOW.has(name);
        mesh.receiveShadow = true;
      }
      scope.add(group, chunk.center, reach);
    }
  }
}

// Scatter per terrain chunk, a pure function of the terrain and obstacles.
export function scatterPlacements(t: Terrain, obstacles: Obstacle[]): ScatterChunk[] {
  const blocked = blockedTiles(t.size, obstacles);
  const rocky = rockyTiles(t.size, obstacles);
  const look = lookTypes(t);
  const chunks: ScatterChunk[] = [];
  for (let cy = 0; cy < t.size; cy += TERRAIN_CHUNK) for (let cx = 0; cx < t.size; cx += TERRAIN_CHUNK) chunks.push(chunkScatter(t, look, blocked, rocky, cx, cy));
  return chunks;
}

function chunkScatter(t: Terrain, look: readonly LookType[], blocked: Uint8Array, rocky: Uint8Array, cx: number, cy: number): ScatterChunk {
  const chunk: ScatterChunk = { center: { x: cx + TERRAIN_CHUNK / 2, y: cy + TERRAIN_CHUNK / 2 }, pebbles: [], scrub: [], desert_stones: [], desert_scrub: [], cactus: [] };
  for (let y = cy; y < Math.min(cy + TERRAIN_CHUNK, t.size); y++) for (let x = cx; x < Math.min(cx + TERRAIN_CHUNK, t.size); x++) {
    const i = y * t.size + x;
    const kind = blocked[i] ? null : tileScatter(look[i], x, y, rocky[i] === 1);
    if (kind === null) continue;
    const model = modelOf(kind, desertWeight(look[i]) > 0);
    chunk[model].push(placed(t, x, y, model));
  }
  return chunk;
}

type ScatterKind = 'pebbles' | 'scrub' | 'cactus';

function modelOf(kind: ScatterKind, desert: boolean): ScatterModel {
  if (!desert || kind === 'cactus') return kind;
  return kind === 'pebbles' ? 'desert_stones' : 'desert_scrub';
}

// What tile x, y, which takes the look of ground type look, holds. Road shoulders take their own chances.
function tileScatter(look: LookType, x: number, y: number, byRock: boolean): ScatterKind | null {
  const h = hash2(x * 7 + 3, y * 13 + 5);
  const odds = CHANCES[look];
  const open = byRock ? odds.byRock : odds.open;
  // Nothing can land here whatever the road distance, so skip the road lookup.
  if (pick(h, open) === null && pick(h, odds.shoulder) === null) return null;
  const p = tilePoint(x, y);
  const road = ROAD_INDEX.nearestWithin(p.x, p.y, ROAD_GAP + SHOULDER_TILES);
  return road < ROAD_GAP ? null : pick(h, road < ROAD_GAP + SHOULDER_TILES ? odds.shoulder : open);
}

type Chances = { pebbles: number; scrub: number; cactus: number };

// Shares of tiles of a ground type with a stone cluster, a scrub clump and a cactus. Ground that takes no desert
// look keeps the sparse base chances, shoulders included. Open desert moves from them toward the desert chances by
// its desert weight, and its shoulders hold stones only.
function chances(type: LookType, shoulder: boolean, byRock: boolean): Chances {
  const w = desertWeight(type);
  if (w === 0) return { pebbles: PEBBLE_CHANCE, scrub: SCRUB_ELSEWHERE, cactus: 0 };
  if (shoulder) return { pebbles: PEBBLE_ON_SHOULDER, scrub: 0, cactus: 0 };
  const scrub = type === 'scrub' ? SCRUB_ON_SCRUB : SCRUB_ELSEWHERE + (SCRUB_ON_DESERT - SCRUB_ELSEWHERE) * w;
  const pebbles = PEBBLE_CHANCE + (PEBBLE_ON_DESERT - PEBBLE_CHANCE) * w;
  return { pebbles, scrub, cactus: (byRock ? CACTUS_BY_ROCK : CACTUS_ON_DESERT) * w };
}

// The chances of each look type, worked out once rather than per tile.
const CHANCES = Object.fromEntries(
  (Object.keys(TERRAIN_TYPES) as (keyof typeof TERRAIN_TYPES)[]).filter((type) => type !== 'road').map((type) => [
    type,
    { open: chances(type, false, false), byRock: chances(type, false, true), shoulder: chances(type, true, false) },
  ]),
) as Record<LookType, { open: Chances; byRock: Chances; shoulder: Chances }>;

// Pebbles take the low end of the tile hash, cacti the range above them and scrub the high end.
function pick(h: number, c: Chances): ScatterKind | null {
  if (h < c.pebbles) return 'pebbles';
  if (h < c.pebbles + c.cactus) return 'cactus';
  return h > 1 - c.scrub ? 'scrub' : null;
}

function tilePoint(x: number, y: number): Vec {
  return { x: x + hash2(x, y * 3), y: y + hash2(x * 5, y) };
}

const place = new THREE.Object3D();

function placed(t: Terrain, x: number, y: number, kind: ScatterModel): Placed {
  const p = tilePoint(x, y);
  place.position.set(p.x * S, groundAt(t, p.x, p.y) * S, p.y * S);
  place.rotation.y = hash2(x * 19, y * 23 + 1) * Math.PI * 2;
  place.scale.setScalar(size(kind, hash2(x * 11 + 1, y * 17 + 9)));
  place.updateMatrix();
  return { matrix: place.matrix.clone(), tint: lerp(TINT, hash2(x * 29 + 4, y * 31)) };
}

const RADIUS: Record<Exclude<ScatterModel, 'cactus'>, { min: number; max: number }> = {
  pebbles: PEBBLE_RADIUS,
  scrub: SCRUB_RADIUS,
  desert_stones: DESERT_STONES_RADIUS,
  desert_scrub: DESERT_SCRUB_RADIUS,
};

// The model scale in meters. Stones and scrub are modeled at a unit footprint radius, cacti at 1 m tall.
function size(kind: ScatterModel, s: number): number {
  if (kind === 'cactus') return lerp(CACTUS_HEIGHT, s);
  return lerp(RADIUS[kind], s) * S;
}

function lerp(r: { min: number; max: number }, s: number): number {
  return r.min + (r.max - r.min) * s;
}

// Tiles whose center lies within an obstacle's radius plus the gap.
function blockedTiles(size: number, obstacles: Obstacle[]): Uint8Array {
  const out = new Uint8Array(size * size);
  for (const o of obstacles) markDisc(out, size, o.pos, o.r + OBSTACLE_GAP);
  return out;
}

// Tiles whose center lies within CACTUS_NEAR_ROCK of a rock or a crag, where cacti gather.
function rockyTiles(size: number, obstacles: Obstacle[]): Uint8Array {
  const out = new Uint8Array(size * size);
  for (const o of obstacles) if (o.kind === 'rock' || (o.kind === 'landmark' && o.look === 'crag')) markDisc(out, size, o.pos, o.r + CACTUS_NEAR_ROCK);
  return out;
}

function markDisc(out: Uint8Array, size: number, at: Vec, r: number): void {
  for (let y = Math.max(0, Math.floor(at.y - r)); y <= Math.min(size - 1, Math.ceil(at.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(at.x - r)); x <= Math.min(size - 1, Math.ceil(at.x + r)); x++) {
      if (Math.hypot(x + 0.5 - at.x, y + 0.5 - at.y) <= r) out[y * size + x] = 1;
    }
  }
}
