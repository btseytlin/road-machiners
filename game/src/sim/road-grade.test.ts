import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { elevationAt } from './elevation';
import { ROAD_INDEX } from './road-index';
import { bridgeCut, deckById } from './bridge';
import { deckSegments, heightFromElevation } from './terrain';
import { gradePaths, gradeRoads } from './road-grade';
import { TEST_MAP } from '../test/map';
import { dist, type Vec } from './vec';
import { insideCurtain } from './fortress';
import { isFortress } from './sites';

const STORED_STEP = 1 / MAPGEN.heightScale;

function walk(road: readonly Vec[]): Vec[] {
  const points: Vec[] = [];
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1];
    const b = road[i];
    const d = dist(a, b);
    for (let k = 0; k < d; k += 0.25) points.push({ x: a.x + ((b.x - a.x) * k) / d, y: a.y + ((b.y - a.y) * k) / d });
  }
  return points;
}

const FORTRESSES = [...REGION.towns, ...REGION.locations].filter(isFortress);

function behindCurtain(p: Vec): boolean {
  return FORTRESSES.some((site) => insideCurtain(site, p, 0));
}

function steepest(road: readonly Vec[]): number {
  const t = TEST_MAP.terrain;
  const n = t.size + 1;
  let max = 0;
  for (const p of walk(road)) {
    if (behindCurtain(p)) continue;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const corners = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (corners.some(([cx, cy]) => bridgeCut(cx, cy) > 0)) continue;
    for (const [ax, ay] of corners) for (const [bx, by] of corners) {
      if (ax === bx && ay === by) continue;
      max = Math.max(max, Math.abs(t.heights[by * n + bx] - t.heights[ay * n + ax]) / Math.hypot(bx - ax, by - ay));
    }
  }
  return max;
}

describe('road grades', () => {
  it('keeps every road of the baked map within the road grade', () => {
    const grades = REGION.roads.map((road) => steepest(road));
    for (const grade of grades) expect(grade).toBeLessThanOrEqual(TERRAIN.roadGrade + STORED_STEP);
  });

  it('skips only road behind fortress curtains, which includes the road into the Bowl pit', () => {
    const skipped = REGION.roads.flatMap((road) => walk(road).filter(behindCurtain));
    const bowl = FORTRESSES.find((site) => site.id === 'bowl');
    if (bowl === undefined) throw new Error('Bowl is no fortress');
    expect(skipped.some((p) => insideCurtain(bowl, p, 0))).toBe(true);
    const outside = REGION.roads.flatMap((road) => walk(road).filter((p) => !behindCurtain(p)));
    expect(outside.length).toBeGreaterThan(skipped.length);
  });

  it('keeps the Canyon Bridge deck of the baked map within the road grade', () => {
    const deck = deckById('canyon-bridge');
    const [{ h0, h1, length }] = deckSegments(TEST_MAP.terrain, deck);
    expect(Math.abs(h1 - h0) / length).toBeLessThanOrEqual(TERRAIN.roadGrade + STORED_STEP);
  });

  it('leaves ground beyond the road margin untouched', () => {
    const size = REGION.size;
    const heights: number[] = [];
    for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) heights.push(heightFromElevation(elevationAt(1337, i, j)));
    const graded = gradeRoads({ size, heights, types: [] });
    const reach = REGION.roadWidth / 2 + TERRAIN.flattenMargin;
    let checked = 0;
    for (let j = 0; j <= size; j += 7) for (let i = 0; i <= size; i += 7) {
      if (ROAD_INDEX.nearestWithin(i, j, reach) < reach) continue;
      expect(graded[j * (size + 1) + i]).toBe(heights[j * (size + 1) + i]);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('path grades', () => {
  const SIZE = 40;
  const ROW = SIZE + 1;
  const hump = (x: number) => 2 * Math.exp(-((x - 20) ** 2) / (2 * 5 ** 2));
  const raw = { size: SIZE, heights: Array.from({ length: ROW * ROW }, (_, k) => hump(k % ROW)), types: [] };
  const path = { points: [{ x: 2, y: 20 }, { x: 38, y: 20 }], width: 2, grade: TERRAIN.roadGrade };
  const [GRADE, MARGIN] = [TERRAIN.roadGrade, 4];
  const graded = gradePaths(raw, [path], MARGIN);
  const at = (h: readonly number[], x: number, y: number) => h[y * ROW + x];

  it('holds the grade along the path where the ground is steeper', () => {
    const rawSteepest = Math.max(...Array.from({ length: 36 }, (_, i) => Math.abs(at(raw.heights, i + 3, 20) - at(raw.heights, i + 2, 20))));
    expect(rawSteepest).toBeGreaterThan(GRADE);
    for (let x = 2; x < 38; x++) expect(Math.abs(at(graded, x + 1, 20) - at(graded, x, 20)), `${x}`).toBeLessThanOrEqual(GRADE + 1e-9);
  });

  it('holds the bank grade beside the path', () => {
    for (let x = 2; x <= 38; x++) for (let y = 21; y <= 25; y++) {
      for (const side of [1, -1]) {
        const [inner, outer] = [20 + side * (y - 21), 20 + side * (y - 20)];
        expect(Math.abs(at(graded, x, outer) - at(graded, x, inner)), `${x},${outer}`).toBeLessThanOrEqual(TERRAIN.bankGrade + 1e-9);
      }
    }
  });

  it('leaves corners past the margin untouched', () => {
    let checked = 0;
    for (let y = 0; y <= SIZE; y++) for (let x = 0; x <= SIZE; x++) {
      const gap = Math.hypot(Math.max(0, 2 - x, x - 38), y - 20) - path.width / 2;
      if (gap < MARGIN) continue;
      expect(at(graded, x, y), `${x},${y}`).toBe(at(raw.heights, x, y));
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(at(graded, 20, 20)).not.toBe(at(raw.heights, 20, 20));
  });
});
