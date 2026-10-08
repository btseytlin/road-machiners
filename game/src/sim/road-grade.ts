// Road grading. The ground on and beside every road is set so no step across the road surface is
// steeper than TERRAIN.roadGrade per tile, and no step beside it steeper than TERRAIN.bankGrade,
// while staying as close to the ungraded ground as that allows. Ground in the road margin blends

import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { bridgeCut } from './bridge';
import { flattenFalloff } from './elevation';
import { ROAD_INDEX } from './road-index';
import { siteGap } from './sites';
import type { Terrain } from './terrain';
import { dist, segmentDist, type Vec } from './vec';

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

type Corners = { size: number; corner: Int32Array; at: Int32Array; target: (number | null)[]; pad: Int32Array; falloff: Float64Array; surface: Uint8Array; slope: Float64Array };

export type GradedPad = { pos: Vec; r: number; height: number; margin: number; group: number };
type GradedPath = { points: Vec[]; width: number; grade: number };

export function gradeRoads(raw: Terrain): number[] {
  return gradeCorners(raw, roadCorners(raw), bridgeCut);
}

export function gradePaths(raw: Terrain, paths: readonly GradedPath[], margin: number, pads: readonly GradedPad[] = []): number[] {
  return gradeCorners(raw, pathCorners(raw, paths, margin, pads), () => 0);
}

function gradeCorners(raw: Terrain, c: Corners, cut: (x: number, y: number) => number): number[] {
  const under = envelope(c, c.target, 1);
  const over = envelope(c, c.target, -1);
  const heights = [...raw.heights];
  c.at.forEach((k, n) => {
    const h = raw.heights[k];
    const graded = (under[n] + over[n]) / 2;
    if (!Number.isFinite(graded)) throw new Error(`Road grading reaches no road surface from corner ${k}`);
    const x = k % (c.size + 1);
    const y = Math.floor(k / (c.size + 1));
    heights[k] = h + (graded - h) * c.falloff[n] * (1 - cut(x, y));
  });
  return heights;
}

function roadCorners(raw: Terrain): Corners {
  const size = raw.size;
  const corner = new Int32Array((size + 1) * (size + 1)).fill(-1);
  const at: number[] = [];
  const target: (number | null)[] = [];
  const falloff: number[] = [];
  const surface: number[] = [];
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
    const d = ROAD_INDEX.nearestWithin(x, y, REACH);
    if (d === Infinity) continue;
    const k = y * (size + 1) + x;
    const onSurface = isSurface(x, y, d);
    corner[k] = at.length;
    at.push(k);
    target.push(onSurface ? raw.heights[k] : null);
    falloff.push(flattenFalloff(d - HALF_WIDTH));
    surface.push(onSurface ? 1 : 0);
  }
  return { size, corner, at: Int32Array.from(at), target, pad: new Int32Array(at.length).fill(-1), falloff: Float64Array.from(falloff), surface: Uint8Array.from(surface), slope: new Float64Array(at.length).fill(TERRAIN.roadGrade) };
}

function pathCorners(raw: Terrain, paths: readonly GradedPath[], margin: number, pads: readonly GradedPad[]): Corners {
  const box = reachBox(raw.size, paths, margin, pads);
  const found: { k: number; info: CornerInfo }[] = [];
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    const info = pathCorner(raw, paths, margin, pads, { x, y });
    if (info) found.push({ k: y * (raw.size + 1) + x, info });
  }
  return toCorners(raw.size, found);
}

type CornerInfo = { target: number | null; falloff: number; surface: boolean; pad: number; slope: number };

function pathCorner(raw: Terrain, paths: readonly GradedPath[], margin: number, pads: readonly GradedPad[], p: Vec): CornerInfo | null {
  const path = nearestPath(paths, p);
  const pad = padAt(pads, p);
  if (path.gap >= margin && pad.gap >= pad.margin) return null;
  const surface = path.gap <= 1 || pad.gap <= 0;
  const h = raw.heights[p.y * (raw.size + 1) + p.x];
  return {
    target: surface ? h + (pad.height - h) * pad.share : null,
    falloff: Math.max(flattenFalloff(path.gap, margin), pad.share),
    surface,
    pad: pad.gap <= 0 ? pad.group : -1,
    slope: path.grade,
  };
}

function reachBox(size: number, paths: readonly GradedPath[], margin: number, pads: readonly GradedPad[]): { x0: number; x1: number; y0: number; y1: number } {
  const reaches = [...paths.flatMap((p) => p.points.map((q) => ({ q, reach: p.width / 2 + margin }))), ...pads.map((p) => ({ q: p.pos, reach: p.r + p.margin }))];
  const lo = (v: number) => Math.max(0, Math.floor(v));
  const hi = (v: number) => Math.min(size, Math.ceil(v));
  return {
    x0: lo(Math.min(...reaches.map((e) => e.q.x - e.reach))),
    x1: hi(Math.max(...reaches.map((e) => e.q.x + e.reach))),
    y0: lo(Math.min(...reaches.map((e) => e.q.y - e.reach))),
    y1: hi(Math.max(...reaches.map((e) => e.q.y + e.reach))),
  };
}

function toCorners(size: number, found: readonly { k: number; info: CornerInfo }[]): Corners {
  const corner = new Int32Array((size + 1) * (size + 1)).fill(-1);
  found.forEach(({ k }, n) => {
    corner[k] = n;
  });
  return {
    size,
    corner,
    at: Int32Array.from(found, (f) => f.k),
    target: found.map((f) => f.info.target),
    pad: Int32Array.from(found, (f) => f.info.pad),
    falloff: Float64Array.from(found, (f) => f.info.falloff),
    surface: Uint8Array.from(found, (f) => (f.info.surface ? 1 : 0)),
    slope: Float64Array.from(found, (f) => f.info.slope),
  };
}

function nearestPath(paths: readonly GradedPath[], p: Vec): { gap: number; grade: number } {
  let best = { gap: Infinity, grade: 0 };
  for (const path of paths) {
    for (let k = 1; k < path.points.length; k++) {
      const gap = segmentDist(p, path.points[k - 1], path.points[k]) - path.width / 2;
      if (gap < best.gap) best = { gap, grade: path.grade };
    }
  }
  return best;
}

function nearestPad(pads: readonly GradedPad[], p: Vec): GradedPad | null {
  let best: GradedPad | null = null;
  for (const pad of pads) if (best === null || dist(pad.pos, p) - pad.r < dist(best.pos, p) - best.r) best = pad;
  return best;
}

type PadAt = { gap: number; share: number; height: number; group: number; margin: number };
const NO_PAD: PadAt = { gap: Infinity, share: 0, height: 0, group: -1, margin: 0 };

function padAt(pads: readonly GradedPad[], p: Vec): PadAt {
  const pad = nearestPad(pads, p);
  if (pad === null) return NO_PAD;
  const gap = dist(pad.pos, p) - pad.r;
  return { gap, share: flattenFalloff(gap, pad.margin), height: pad.height, group: pad.group, margin: pad.margin };
}

function isSurface(x: number, y: number, roadDist: number): boolean {
  if (SITES.some((s) => siteGap(s, { x, y }) < 0)) return true;
  return roadDist <= SURFACE && bridgeCut(x, y) === 0;
}

function envelope(c: Corners, given: readonly (number | null)[], side: 1 | -1): Float64Array {
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
    const key = best[n] + stepCost(c, n, m) * STEP_LENGTHS[k];
    if (key < best[m]) {
      best[m] = key;
      queue.push(m, key);
    }
  }
}

function stepCost(c: Corners, n: number, m: number): number {
  if (c.pad[n] >= 0 && c.pad[n] === c.pad[m]) return 0;
  return c.surface[n] & c.surface[m] ? Math.max(c.slope[n], c.slope[m]) : TERRAIN.bankGrade;
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
