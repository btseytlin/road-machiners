import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { HIGHWAY } from '../data/fury-road';
import { TERRAIN } from '../data/terrain';
import { atlasOf } from './atlas';
import { centerX, highwayMap, highwayStart, maxBlockedOf, milestoneAt, outpostSite, roadHeight, STRIDE, stretchRows, toLocal } from './highway';
import { isBakedObstacle, mapObstacles } from './mapgen';
import { CELL, componentOf, navLayer } from './nav/layer';
import { groundAt, heightAt, type BakedMap, type BakedProp } from './terrain';

const SIZE = HIGHWAY.size;
const OVERLAP = 2 * HIGHWAY.margin;
const ROW_KINDS = new Set(HIGHWAY.rowKinds);

function propKey(p: BakedProp, shift: number): string {
  return [p.kind, p.pos.x.toFixed(4), (p.pos.y + shift).toFixed(4), p.yaw.toFixed(4), p.r.toFixed(4)].join(':');
}

function closingPieces(map: BakedMap, n: number): BakedProp[] {
  return map.props.filter((p) => (p.kind === 'barrier' || p.kind === 'tankTrap') && Math.abs(p.pos.y - n) < 4 && Math.abs(p.pos.x - SIZE / 2) < SIZE / 4);
}

function inOverlap(p: BakedProp, from: number, to: number): boolean {
  return p.pos.y >= from + 2 && p.pos.y <= to - 2;
}

describe('a highway window', () => {
  it('builds the same land every time, in any order', () => {
    const later = [3, 1, 2].map((w) => highwayMap(5, w));
    const first = [1, 2, 3].map((w) => highwayMap(5, w));

    expect(later).toEqual([first[2], first[0], first[1]]);
    expect(highwayMap(5, 0)).toEqual(highwayMap(5, 0));
  });

  it('agrees with the next window where they overlap, but for the gate and the road end', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const k of [0, 1, 2, 3, 4]) {
        const a = highwayMap(seed, k);
        const b = highwayMap(seed, k + 1);
        const row = SIZE + 1;
        for (let y = 0; y <= OVERLAP; y++) {
          const ra = a.terrain.heights.slice(y * row, (y + 1) * row);
          const rb = b.terrain.heights.slice((y + STRIDE) * row, (y + STRIDE + 1) * row);
          expect(ra, `seed ${seed} window ${k} row ${y}`).toEqual(rb);
        }
        expect(a.terrain.types.slice(0, OVERLAP * SIZE)).toEqual(b.terrain.types.slice(STRIDE * SIZE, (STRIDE + OVERLAP) * SIZE));
        const gate = toLocal(k, milestoneAt(k + 1) + HIGHWAY.gateGap);
        const roadEnd = toLocal(k + 1, (k + 1) * STRIDE + HIGHWAY.endGap) - STRIDE;
        const open = (y: number) => Math.abs(y - gate) >= 4 && Math.abs(y - roadEnd) >= 4;
        const fromA = a.props.filter((p) => inOverlap(p, 0, OVERLAP) && open(p.pos.y));
        const fromB = b.props.filter((p) => inOverlap(p, STRIDE, STRIDE + OVERLAP) && open(p.pos.y - STRIDE));
        expect(fromB.map((p) => propKey(p, -STRIDE)).sort(), `seed ${seed} window ${k}`).toEqual(fromA.map((p) => propKey(p, 0)).sort());
      }
    }
  });

  it('puts the gate only north of the unreached outpost', () => {
    const map = highwayMap(9, 2);
    const north = toLocal(2, milestoneAt(3) + HIGHWAY.gateGap);
    const south = toLocal(2, milestoneAt(2) + HIGHWAY.gateGap);

    expect(closingPieces(map, north).filter((p) => p.kind === 'barrier').length).toBeGreaterThan(10);
    expect(closingPieces(map, south)).toEqual([]);
  });

  it('closes the south end of every window across the road', () => {
    for (const k of [0, 1, 4]) {
      const y = toLocal(k, k * STRIDE + HIGHWAY.endGap);
      const pieces = closingPieces(highwayMap(9, k), y);
      expect(pieces.length).toBeGreaterThan(8);
      expect(Math.min(...pieces.map((p) => p.pos.x))).toBeLessThan(centerX(9, k * STRIDE + HIGHWAY.endGap) - HIGHWAY.road.halfWidth);
      expect(Math.max(...pieces.map((p) => p.pos.x))).toBeGreaterThan(centerX(9, k * STRIDE + HIGHWAY.endGap) + HIGHWAY.road.halfWidth);
    }
  });

  it('keeps every prop off the asphalt but the lane rows, the gate and the road end', () => {
    for (const seed of [1, 2, 3]) {
      for (const k of [0, 1, 2]) {
        const map = highwayMap(seed, k);
        const onRoad = map.props.filter((p) => map.terrain.types[Math.floor(p.pos.y) * SIZE + Math.floor(p.pos.x)] === 'asphalt');
        const gate = toLocal(k, milestoneAt(k + 1) + HIGHWAY.gateGap);
        const roadEnd = toLocal(k, k * STRIDE + HIGHWAY.endGap);
        const stray = onRoad.filter((p) => !ROW_KINDS.has(p.kind) && Math.abs(p.pos.y - gate) >= 4 && Math.abs(p.pos.y - roadEnd) >= 4);
        expect(stray, `seed ${seed} window ${k}`).toEqual([]);
      }
    }
  });

  it('makes every prop a baked obstacle with its own id, inside the window', () => {
    const map = highwayMap(4, 3);
    const obstacles = mapObstacles(map);

    expect(obstacles.every(isBakedObstacle)).toBe(true);
    expect(obstacles.every((o) => o.pos.x >= o.r && o.pos.y >= o.r && o.pos.x <= SIZE - o.r && o.pos.y <= SIZE - o.r)).toBe(true);
  });

  it('shows no Icarus feature', () => {
    const map = highwayMap(3, 1);
    const atlas = atlasOf(map.terrain);

    expect([atlas.towns, atlas.locations, atlas.hazards, atlas.decks.decks]).toEqual([[], [], [], []]);
    expect(atlas.oldSpots || atlas.landforms).toBe(false);
    expect(atlas.roads).toHaveLength(1);
    expect(atlas.roads[0].lanes).toBe(4);
    for (let y = 0; y < SIZE; y += 7) for (let x = 0; x < SIZE; x += 7) expect(heightAt(map.terrain, x + 0.3, y + 0.6)).toBe(groundAt(map.terrain, x + 0.3, y + 0.6));
  });

  it('builds a window in well under the boot budget', () => {
    const started = performance.now();
    highwayMap(11, 7);
    const ms = performance.now() - started;
    console.info(`highway window built in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe('the highway road', () => {
  it('keeps its grade under the road limit and its bends wide', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (let n = 0; n < 6 * STRIDE + SIZE; n += 1) {
        expect(Math.abs(roadHeight(seed, n + 1) - roadHeight(seed, n))).toBeLessThan(TERRAIN.roadGrade);
        const bend = Math.abs(centerX(seed, n + 1) - 2 * centerX(seed, n) + centerX(seed, n - 1));
        expect(1 / Math.max(bend, 1e-9), `seed ${seed} n ${n}`).toBeGreaterThanOrEqual(HIGHWAY.road.minBendRadius);
      }
    }
  });

  it('blocks at most two of the four lanes in any row', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (let j = 1; j <= 8; j++) {
        for (const row of stretchRows(seed, j)) {
          expect(row.length).toBeGreaterThanOrEqual(1);
          expect(row.length).toBeLessThanOrEqual(Math.min(2, maxBlockedOf(j)));
        }
      }
    }
  });

  it('lets the Fury Road truck drive from the south milestone to the north outpost pad', () => {
    const radius = CHASSIS.hauler.radius;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const k of [0, 1, 2, 3]) {
        const map = highwayMap(seed, k);
        const layer = navLayer(map.terrain, mapObstacles(map), radius);
        const from = k === 0 ? highwayStart(seed).pos : padOf(seed, k, k);
        const to = padOf(seed, k, k + 1);
        const start = componentOf(layer, cellOf(from));
        expect(start, `seed ${seed} window ${k} start`).not.toBe(0);
        expect(componentOf(layer, cellOf(to)), `seed ${seed} window ${k}`).toBe(start);
      }
    }
  });
});

function padOf(seed: number, window: number, j: number) {
  const pad = outpostSite(seed, j).pad;
  return { x: pad.x, y: toLocal(window, pad.n) };
}

function cellOf(p: { x: number; y: number }): number {
  const n = Math.ceil(SIZE / CELL);
  return Math.floor(p.y / CELL) * n + Math.floor(p.x / CELL);
}
