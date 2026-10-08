// Road grading. The ground on and beside every road is set so no step across the road surface is
// steeper than TERRAIN.roadGrade per tile, and no step beside it steeper than TERRAIN.bankGrade,
// while staying as close to the ungraded ground as that allows. Ground in the road margin blends

import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { bridgeCut } from './bridge';
import { flattenFalloff } from './elevation';
import { ROAD_INDEX } from './road-index';
import type { Terrain } from './terrain';

const SITES = [...REGION.towns, ...REGION.locations];
const HALF_WIDTH = REGION.roadWidth / 2;
const REACH = HALF_WIDTH + TERRAIN.flattenMargin;
const SURFACE = HALF_WIDTH + 1;
const STEPS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
];
const STEP_LENGTHS = STEPS.map(([dx, dy]) => Math.hypot(dx, dy));

type Corners = { size: number; corner: Int32Array; at: Int32Array; roadDist: Float64Array; surface: Uint8Array };

export function gradeRoads(raw: Terrain): number[] {
  const c = corners(raw.size);
  const ground = Array.from(c.at, (k) => raw.heights[k]);
  const given = ground.map((h, n) => (c.surface[n] ? h : null));
  const under = envelope(c, given, 1);
  const over = envelope(c, given, -1);
  const heights = [...raw.heights];
  ground.forEach((h, n) => {
    const graded = (under[n] + over[n]) / 2;
    if (!Number.isFinite(graded)) throw new Error(`Road grading reaches no road surface from corner ${c.at[n]}`);
    const x = c.at[n] % (c.size + 1);
    const y = Math.floor(c.at[n] / (c.size + 1));
    heights[c.at[n]] = h + (graded - h) * flattenFalloff(c.roadDist[n] - HALF_WIDTH) * (1 - bridgeCut(x, y));
  });
  return heights;
}

function corners(size: number): Corners {
  const corner = new Int32Array((size + 1) * (size + 1)).fill(-1);
  const at: number[] = [];
  const roadDist: number[] = [];
  const surface: number[] = [];
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
    const d = ROAD_INDEX.nearestWithin(x, y, REACH);
    if (d === Infinity) continue;
    corner[y * (size + 1) + x] = at.length;
    at.push(y * (size + 1) + x);
    roadDist.push(d);
    surface.push(isSurface(x, y, d) ? 1 : 0);
  }
  return { size, corner, at: Int32Array.from(at), roadDist: Float64Array.from(roadDist), surface: Uint8Array.from(surface) };
}

function isSurface(x: number, y: number, roadDist: number): boolean {
  if (SITES.some((s) => Math.hypot(s.pos.x - x, s.pos.y - y) < s.radius)) return true;
  return roadDist <= SURFACE && bridgeCut(x, y) === 0;
}

function envelope(c: Corners, given: (number | null)[], side: 1 | -1): Float64Array {
  const best = Float64Array.from(given, (h) => (h === null ? Infinity : side * h));
  const queue = new MinQueue();
  best.forEach((h, n) => {
    if (h !== Infinity) queue.push(n, h);
  });
  while (queue.size > 0) {
    const key = queue.topKey();
    const n = queue.pop();
    if (key === best[n]) spread(c, best, queue, n);
  }
  return best.map((h) => side * h);
}

function spread(c: Corners, best: Float64Array, queue: MinQueue, n: number): void {
  const w = c.size + 1;
  const x = c.at[n] % w;
  const y = (c.at[n] - x) / w;
  for (let k = 0; k < STEPS.length; k++) {
    const m = neighbor(c, x + STEPS[k][0], y + STEPS[k][1]);
    if (m < 0) continue;
    const key = best[n] + (c.surface[n] & c.surface[m] ? TERRAIN.roadGrade : TERRAIN.bankGrade) * STEP_LENGTHS[k];
    if (key < best[m]) {
      best[m] = key;
      queue.push(m, key);
    }
  }
}

function neighbor(c: Corners, x: number, y: number): number {
  if (x < 0 || y < 0 || x > c.size || y > c.size) return -1;
  return c.corner[y * (c.size + 1) + x];
}

class MinQueue {
  private items = new Int32Array(1024);
  private keys = new Float64Array(1024);
  size = 0;

  topKey(): number {
    return this.keys[0];
  }

  push(item: number, key: number): void {
    if (this.size === this.items.length) this.grow();
    let i = this.size++;
    while (i > 0 && this.keys[(i - 1) >> 1] > key) {
      const up = (i - 1) >> 1;
      this.items[i] = this.items[up];
      this.keys[i] = this.keys[up];
      i = up;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }

  pop(): number {
    const top = this.items[0];
    this.size--;
    if (this.size > 0) this.sink(this.items[this.size], this.keys[this.size]);
    return top;
  }

  private sink(item: number, key: number): void {
    const n = this.size;
    let i = 0;
    for (let l = 1; l < n; l = 2 * i + 1) {
      const low = l + 1 < n && this.keys[l + 1] < this.keys[l] ? l + 1 : l;
      if (this.keys[low] >= key) break;
      this.items[i] = this.items[low];
      this.keys[i] = this.keys[low];
      i = low;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }

  private grow(): void {
    const items = new Int32Array(this.items.length * 2);
    items.set(this.items);
    this.items = items;
    const keys = new Float64Array(this.keys.length * 2);
    keys.set(this.keys);
    this.keys = keys;
  }
}
