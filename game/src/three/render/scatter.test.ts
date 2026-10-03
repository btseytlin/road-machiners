import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { START_KITS } from '../../data/start';
import { desertWeight } from '../../render/groundPaint';
import { ROAD_INDEX } from '../../sim/road-index';
import type { Vec } from '../../sim/vec';
import { newWorld } from '../../sim/world';
import { TEST_MAP } from '../../test/map';
import { CACTUS_NEAR_ROCK, OBSTACLE_GAP, ROAD_GAP, SHOULDER_TILES, scatterPlacements, type ScatterChunk } from './scatter';

const world = newWorld(1337, START_KITS.standard, TEST_MAP);
const t = world.terrain;
const chunks = scatterPlacements(t, world.obstacles);
const all = (c: ScatterChunk) => [...c.pebbles, ...c.scrub, ...c.desert_stones, ...c.desert_scrub, ...c.cactus];
const placed = chunks.flatMap(all);
const scrub = chunks.flatMap((c) => [...c.scrub, ...c.desert_scrub]);
const cacti = chunks.flatMap((c) => c.cactus);
const pebbles = chunks.flatMap((c) => [...c.pebbles, ...c.desert_stones]);
const roadDist = (x: number, y: number) => ROAD_INDEX.nearestWithin(x, y, ROAD_GAP + SHOULDER_TILES);
const typeAt = (at: Vec) => t.types[Math.floor(at.y) * t.size + Math.floor(at.x)];
const onShoulder = (at: Vec) => roadDist(at.x, at.y) < ROAD_GAP + SHOULDER_TILES;
const tileKey = (at: Vec) => Math.floor(at.y) * t.size + Math.floor(at.x);
// Tiles whose center lies within CACTUS_NEAR_ROCK of a rock or a crag.
const nearRock = new Set<number>();
for (const o of world.obstacles) {
  if (o.kind !== 'rock' && !(o.kind === 'landmark' && o.look === 'crag')) continue;
  const r = o.r + CACTUS_NEAR_ROCK;
  for (let y = Math.floor(o.pos.y - r); y <= o.pos.y + r; y++) for (let x = Math.floor(o.pos.x - r); x <= o.pos.x + r; x++)
    if (Math.hypot(x + 0.5 - o.pos.x, y + 0.5 - o.pos.y) <= r) nearRock.add(y * t.size + x);
}

describe('scatterPlacements', () => {
  it('keeps scatter off roads and away from obstacles', () => {
    expect(placed.length).toBeGreaterThan(1000);
    for (const p of placed) expect(roadDist(p.at.x, p.at.y)).toBeGreaterThanOrEqual(ROAD_GAP);
    const byTile = new Map<number, Vec[]>();
    for (const p of placed) {
      const key = Math.floor(p.at.y) * t.size + Math.floor(p.at.x);
      byTile.set(key, [...(byTile.get(key) ?? []), p.at]);
    }
    for (const o of world.obstacles) {
      // Tiles are blocked by their center, and a placement lies within half a tile diagonal of its tile's center.
      const r = o.r + OBSTACLE_GAP - Math.SQRT1_2;
      for (let y = Math.floor(o.pos.y - r); y <= o.pos.y + r; y++) for (let x = Math.floor(o.pos.x - r); x <= o.pos.x + r; x++)
        for (const at of byTile.get(y * t.size + x) ?? []) expect(Math.hypot(at.x - o.pos.x, at.y - o.pos.y)).toBeGreaterThan(r);
    }
  });

  it('lines road shoulders with stones and keeps brush off them on desert ground', () => {
    let shoulderTiles = 0;
    let openTiles = 0;
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const d = roadDist(x + 0.5, y + 0.5);
      if (d < ROAD_GAP) continue;
      if (d < ROAD_GAP + SHOULDER_TILES) shoulderTiles++;
      else openTiles++;
    }
    const shoulderPebbles = pebbles.filter((p) => onShoulder(p.at)).length;
    expect(shoulderPebbles / shoulderTiles).toBeGreaterThan((pebbles.length - shoulderPebbles) / openTiles);
    for (const p of [...scrub, ...cacti]) if (desertWeight(typeAt(p.at)) > 0) expect(onShoulder(p.at)).toBe(false);
  });

  it('grows reference-dense scrub on open hardpan', () => {
    let tiles = 0;
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++)
      if (t.types[y * t.size + x] === 'hardpan' && roadDist(x + 0.5, y + 0.5) >= ROAD_GAP + SHOULDER_TILES) tiles++;
    const grown = scrub.filter((p) => typeAt(p.at) === 'hardpan' && !onShoulder(p.at)).length;
    expect(tiles).toBeGreaterThan(1000);
    expect(grown / tiles).toBeGreaterThan(0.2);
  });

  it('grows cacti only on desert ground, gathered by rocks and crags', () => {
    expect(cacti.length).toBeGreaterThan(20);
    for (const p of cacti) expect(desertWeight(typeAt(p.at))).toBeGreaterThan(0);
    let rockTiles = 0;
    let openTiles = 0;
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      if (desertWeight(t.types[y * t.size + x]) === 0) continue;
      if (nearRock.has(y * t.size + x)) rockTiles++;
      else openTiles++;
    }
    const byRock = cacti.filter((p) => nearRock.has(tileKey(p.at))).length;
    expect(rockTiles).toBeGreaterThan(100);
    expect(byRock / rockTiles).toBeGreaterThan(2 * ((cacti.length - byRock) / openTiles));
  });

  it('gives ground without a desert look only small pebbles and dry scrub, as sparse on road shoulders as elsewhere', () => {
    for (const type of ['field', 'saltCrust'] as const) {
      const types = t.types.map(() => type);
      const kept = scatterPlacements({ ...t, types }, []);
      expect(kept.flatMap((c) => [...c.desert_stones, ...c.desert_scrub, ...c.cactus]), type).toEqual([]);
      const small = kept.flatMap((c) => c.pebbles);
      const dry = kept.flatMap((c) => c.scrub);
      const radius = (p: { matrix: THREE.Matrix4 }) => new THREE.Vector3().setFromMatrixScale(p.matrix).x / PHYSICS.metersPerTile;
      for (const p of small) expect(radius(p)).toBeLessThanOrEqual(0.045 + 1e-9);
      for (const p of dry) expect(radius(p)).toBeLessThanOrEqual(0.12 + 1e-9);
      let shoulderTiles = 0;
      let openTiles = 0;
      for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
        const d = roadDist(x + 0.5, y + 0.5);
        if (d >= ROAD_GAP + SHOULDER_TILES) openTiles++;
        else if (d >= ROAD_GAP) shoulderTiles++;
      }
      expect(shoulderTiles).toBeGreaterThan(500);
      const share = (list: { at: Vec }[], shoulder: boolean) =>
        list.filter((p) => onShoulder(p.at) === shoulder).length / (shoulder ? shoulderTiles : openTiles);
      for (const [list, chance] of [[small, 0.3], [dry, 0.04]] as const) {
        expect(share(list, true), type).toBeCloseTo(chance, 1);
        expect(share(list, false), type).toBeCloseTo(chance, 1);
      }
    }
  });

  it('keeps hull plating bare, even on a road shoulder', () => {
    const types = t.types.map(() => 'hull' as const);
    const bare = scatterPlacements({ ...t, types }, []).flatMap(all);
    expect(bare).toEqual([]);
  });

  it('places the same scatter on every load', () => {
    const again = scatterPlacements(t, world.obstacles).flatMap(all);
    expect(again.map((p) => p.matrix.elements)).toEqual(placed.map((p) => p.matrix.elements));
    expect(again.map((p) => p.tint)).toEqual(placed.map((p) => p.tint));
  });
});
