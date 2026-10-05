// Road grading. The ground on and beside every road is set so no step across the road surface is
// steeper than TERRAIN.roadGrade per tile, and no step beside it steeper than TERRAIN.bankGrade,
// while staying as close to the ungraded ground as that allows. Ground in the road margin blends
// back to its own height, so hills become cuttings and dips become banks. Crossings and junctions
// share one graded surface. Site ground grades like road surface, so it keeps its height unless
// the road from a neighbor site cannot climb to it.

import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { bridgeCut } from './bridge';
import { flattenFalloff } from './elevation';
import { ROAD_INDEX } from './road-index';
import { siteGap } from './sites';
import type { Terrain } from './terrain';

const SITES = [...REGION.towns, ...REGION.locations];
const HALF_WIDTH = REGION.roadWidth / 2;
// Corners this far from a road get graded ground, then blend back over the margin.
const REACH = HALF_WIDTH + TERRAIN.flattenMargin;
// Corners up to this far from a road are road surface. The extra tile covers every tile a
// point on the road reads its height from.
const SURFACE = HALF_WIDTH + 1;
// Neighbor steps between corners. Knight steps keep grades close to the same in every direction.
const STEPS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
];
const STEP_LENGTHS = STEPS.map(([dx, dy]) => Math.hypot(dx, dy));

// Road surface and site ground hold the road grade and give their ungraded height as a target.
// Margin ground holds the bank grade and gives no target.
type Corners = { size: number; corner: Int32Array; at: Int32Array; roadDist: Float64Array; surface: Uint8Array };

// Graded corner heights for terrain whose ungraded heights are in raw.
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

// Every corner within REACH of a road, numbered.
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

// Under Canyon Bridge the ground is the canyon, so it is margin there.
function isSurface(x: number, y: number, roadDist: number): boolean {
  if (SITES.some((s) => siteGap(s, { x, y }) < 0)) return true;
  return roadDist <= SURFACE && bridgeCut(x, y) === 0;
}

// For side 1, the highest heights within the grades that stay at or under every given height.
// For side -1, the lowest that stay at or over them. Corners with no given height are no sources.
// Where no source reaches, heights are Infinity for side 1 and -Infinity for side -1.
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

// Binary heap of items by key. Stale entries stay in, and the reader skips them.
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

  // Moves the last entry down from the root to its place.
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
