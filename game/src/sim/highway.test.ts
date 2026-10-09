import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { HIGHWAY } from '../data/fury-road';
import { TERRAIN } from '../data/terrain';
import { atlasOf } from './atlas';
import { acrossOf, centerU, fromRoad, highwayMap, highwayStart, milestoneAt, outpostSite, roadHeading, roadHeight, roadPoint, STRIDE, toRoad, windowSpan } from './highway';
import { isBakedObstacle, mapObstacles } from './mapgen';
import { CELL, componentOf, navLayer } from './nav/layer';
import { groundAt, heightAt, isCliff, type BakedMap, type BakedProp } from './terrain';

const SIZE = HIGHWAY.size;
const OVERLAP = SIZE - STRIDE;
const ROAD = HIGHWAY.road;
const SCREEN_UP = -3 * Math.PI / 4;

function propKey(p: BakedProp, shift: number): string {
  return [p.kind, (p.pos.x + shift).toFixed(4), (p.pos.y + shift).toFixed(4), p.yaw.toFixed(4), p.r.toFixed(4)].join(':');
}

function inSquare(p: BakedProp, from: number, to: number): boolean {
  return [p.pos.x, p.pos.y].every((v) => v >= from + 2 && v <= to - 2);
}

function propsAcross(map: BakedMap, seed: number, window: number): { p: BakedProp; d: number }[] {
  return map.props.map((p) => ({ p, d: Math.abs(acrossOf(seed, toRoad(window, p.pos))) }));
}

function typeAt(map: BakedMap, p: { x: number; y: number }): string {
  return map.terrain.types[Math.floor(p.y) * SIZE + Math.floor(p.x)];
}

describe('the road frame', () => {
  it('turns a map spot into along and across distances and back', () => {
    for (const window of [0, 3]) {
      const p = { x: 123.5, y: 77.25 };
      const at = toRoad(window, p);
      const back = fromRoad(window, at.n, at.u);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('runs along the diagonal that is screen-up, with each milestone at the same spot of its window', () => {
    for (const k of [0, 1, 4]) {
      const south = fromRoad(k, milestoneAt(k), 0);
      const north = fromRoad(k, milestoneAt(k + 1), 0);
      expect([south.x, south.y].map((v) => +v.toFixed(6))).toEqual([270, 270]);
      expect([north.x, north.y].map((v) => +v.toFixed(6))).toEqual([50, 50]);
      expect(toRoad(k + 1, { x: north.x + STRIDE, y: north.y + STRIDE }).n).toBeCloseTo(milestoneAt(k + 1), 9);
    }
  });
});

describe('a highway window', () => {
  it('builds the same land every time, in any order', () => {
    const later = [3, 1, 2].map((w) => highwayMap(5, w));
    const first = [1, 2, 3].map((w) => highwayMap(5, w));

    expect(later).toEqual([first[2], first[0], first[1]]);
    expect(highwayMap(5, 0)).toEqual(highwayMap(5, 0));
  });

  it('agrees with the next window in their overlap square', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const k of [0, 1, 2, 3, 4]) {
        const a = highwayMap(seed, k);
        const b = highwayMap(seed, k + 1);
        const row = SIZE + 1;
        for (let y = 0; y <= OVERLAP; y++) {
          const ra = a.terrain.heights.slice(y * row, y * row + OVERLAP + 1);
          const rb = b.terrain.heights.slice((y + STRIDE) * row + STRIDE, (y + STRIDE) * row + SIZE + 1);
          expect(ra, `seed ${seed} window ${k} row ${y}`).toEqual(rb);
          const ta = a.terrain.types.slice(y * SIZE, y * SIZE + OVERLAP);
          if (y < OVERLAP) expect(ta).toEqual(b.terrain.types.slice((y + STRIDE) * SIZE + STRIDE, (y + STRIDE) * SIZE + SIZE));
        }
        const fromA = a.props.filter((p) => inSquare(p, 0, OVERLAP));
        const fromB = b.props.filter((p) => inSquare(p, STRIDE, SIZE));
        expect(fromB.map((p) => propKey(p, -STRIDE)).sort(), `seed ${seed} window ${k}`).toEqual(fromA.map((p) => propKey(p, 0)).sort());
      }
    }
  });

  it('lays four lanes of asphalt, a flat verge, badlands and ridges by the distance from the centerline', () => {
    for (const seed of [1, 2, 3]) {
      const map = highwayMap(seed, 1);
      const span = windowSpan(1);
      for (let n = span.from + 60; n < span.to - 60; n += 9) {
        const at = (d: number) => roadPoint(seed, 1, n, d);
        for (const side of [-1, 1]) {
          expect(typeAt(map, at(side * 4.2))).toBe('asphalt');
          for (const d of [5.8, 9, 13, 17.2]) expect(['hardpan', 'sand']).toContain(typeAt(map, at(side * d)));
          for (const d of [18.8, 22, 25.2]) expect(['gravel', 'scrub', 'scree']).toContain(typeAt(map, at(side * d)));
          expect(typeAt(map, at(side * 30))).toBe('scree');
          const road = roadHeight(seed, n);
          for (const d of [3, 8, 14]) expect(heightAt(map.terrain, at(side * d).x, at(side * d).y)).toBeCloseTo(road, 1);
          const ridge = at(side * 37);
          expect(heightAt(map.terrain, ridge.x, ridge.y) - road).toBeGreaterThan(ROAD.ridge.rise - 3);
          for (let d = 0; d <= ROAD.verge; d += 1.5) {
            const p = at(side * d);
            expect(isCliff(map.terrain, Math.floor(p.y) * SIZE + Math.floor(p.x)), `seed ${seed} n ${n} d ${d}`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps blocking scenery out of the lanes and the near verge', () => {
    for (const seed of [1, 2, 3]) {
      for (const k of [0, 1, 2]) {
        const near = propsAcross(highwayMap(seed, k), seed, k).filter(({ p, d }) => d - p.r < 12);
        expect(near.map(({ p }) => p.kind), `seed ${seed} window ${k}`).toEqual([]);
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

    expect([atlas.towns, atlas.hazards, atlas.decks.decks]).toEqual([[], [], []]);
    expect(atlas.oldSpots || atlas.landforms).toBe(false);
    expect(atlas.roads).toHaveLength(1);
    expect(atlas.roads[0].lanes).toBe(4);
    expect(atlas.roads[0].width).toBe(10);
    for (let y = 0; y < SIZE; y += 7) for (let x = 0; x < SIZE; x += 7) expect(heightAt(map.terrain, x + 0.3, y + 0.6)).toBe(groundAt(map.terrain, x + 0.3, y + 0.6));
  });

  it('starts the truck on a lane at the first milestone, facing up the screen', () => {
    const start = highwayStart(7);
    const map = highwayMap(7, 0);

    expect(typeAt(map, start.pos)).toBe('asphalt');
    expect(Math.abs(start.heading - SCREEN_UP)).toBeLessThan((6 * Math.PI) / 180);
    expect(toRoad(0, start.pos).n).toBeCloseTo(milestoneAt(0), 0);
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
  it('keeps within six degrees of screen-up, its bends wide and its grade under the road limit', () => {
    const bendRadius = 900;
    for (let seed = 1; seed <= 30; seed++) {
      for (let n = 0; n < windowSpan(5).to; n += 1) {
        expect(Math.abs(roadHeight(seed, n + 1) - roadHeight(seed, n))).toBeLessThan(TERRAIN.roadGrade);
        expect(Math.abs(roadHeading(seed, n) - SCREEN_UP), `seed ${seed} n ${n}`).toBeLessThanOrEqual((6 * Math.PI) / 180);
        const bend = Math.abs(centerU(seed, n + 1) - 2 * centerU(seed, n) + centerU(seed, n - 1));
        expect(1 / Math.max(bend, 1e-9), `seed ${seed} n ${n}`).toBeGreaterThanOrEqual(bendRadius);
      }
    }
  });

  it('lets the widest truck drive from the south milestone to the north outpost pad', () => {
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
  return fromRoad(window, pad.n, pad.u);
}

function cellOf(p: { x: number; y: number }): number {
  const n = Math.ceil(SIZE / CELL);
  return Math.floor(p.y / CELL) * n + Math.floor(p.x / CELL);
}
