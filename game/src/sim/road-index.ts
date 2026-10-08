// Bucket index over polyline segments, so a point only measures the segments near it.
// Each segment goes into every cell its bounding box touches.

import { REGION } from '../data/region';
import type { Vec } from './vec';

export const INDEX_CELL = 16;

export class RoadIndex {
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Int32Array[];
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(lines: readonly (readonly Vec[])[], private readonly cell: number) {
    const segs: [Vec, Vec][] = [];
    for (const line of lines) for (let i = 0; i + 1 < line.length; i++) segs.push([line[i], line[i + 1]]);
    if (segs.length === 0) throw new Error('RoadIndex needs at least one segment');
    const n = segs.length;
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    segs.forEach(([a, b], s) => {
      this.ax[s] = a.x; this.ay[s] = a.y; this.bx[s] = b.x; this.by[s] = b.y;
      minX = Math.min(minX, a.x, b.x); minY = Math.min(minY, a.y, b.y);
      maxX = Math.max(maxX, a.x, b.x); maxY = Math.max(maxY, a.y, b.y);
    });
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / cell) + 1;
    this.rows = Math.floor((maxY - minY) / cell) + 1;
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (let s = 0; s < n; s++) {
      const c0 = Math.floor((Math.min(this.ax[s], this.bx[s]) - minX) / cell);
      const c1 = Math.floor((Math.max(this.ax[s], this.bx[s]) - minX) / cell);
      const r0 = Math.floor((Math.min(this.ay[s], this.by[s]) - minY) / cell);
      const r1 = Math.floor((Math.max(this.ay[s], this.by[s]) - minY) / cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.cols + c].push(s);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
    this.seen = new Uint32Array(n);
  }

  nearestWithin(x: number, y: number, reach: number): number {
    const cell = this.cell;
    const c0 = Math.max(0, Math.floor((x - reach - this.minX) / cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + reach - this.minX) / cell));
    const r0 = Math.max(0, Math.floor((y - reach - this.minY) / cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y + reach - this.minY) / cell));
    if (c0 > c1 || r0 > r1) return Infinity;
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 0;
    }
    const stamp = ++this.stamp;
    let best = Infinity;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells[r * this.cols + c];
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          if (this.seen[s] === stamp) continue;
          this.seen[s] = stamp;
          best = Math.min(best, segmentDistXY(x, y, this.ax[s], this.ay[s], this.bx[s], this.by[s]));
        }
      }
    }
    return best < reach ? best : Infinity;
  }
}

function segmentDistXY(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export const ROAD_INDEX = new RoadIndex(REGION.roads, INDEX_CELL);
