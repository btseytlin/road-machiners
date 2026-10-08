import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { elevationAt } from './elevation';
import { ROAD_INDEX } from './road-index';
import { BRIDGE_LENGTH, bridgeCut } from './bridge';
import { deckEnds, heightFromElevation } from './terrain';
import { gradeRoads } from './road-grade';
import { TEST_MAP } from '../test/map';
import { dist, type Vec } from './vec';

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

function steepest(road: readonly Vec[]): number {
  const t = TEST_MAP.terrain;
  const n = t.size + 1;
  let max = 0;
  for (const p of walk(road)) {
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

  it('keeps the Canyon Bridge deck of the baked map within the road grade', () => {
    const [from, to] = deckEnds(TEST_MAP.terrain);
    expect(Math.abs(to - from) / BRIDGE_LENGTH).toBeLessThanOrEqual(TERRAIN.roadGrade + STORED_STEP);
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
