// Weighted A* and nearest-free search over a nav layer plus a dynamic overlay. All scratch memory is
// module-level and reused; generation stamps mark which entries belong to the current search, so
// nothing is cleared between calls.

import { REGION } from '../../data/region';
import { count } from '../../perf';
import type { Blocker } from './buckets';
import { CELL, COARSE, componentOf, stampBlockers, tasted, type NavLayer, type Taste } from './layer';

export type Overlay = { stamp: Uint32Array; gen: number };

const overlay: Overlay = { stamp: new Uint32Array(0), gen: 0 };

export function stampOverlay(layer: NavLayer, blockers: Blocker[], radius: number): Overlay {
  const size = layer.n * layer.n;
  if (overlay.stamp.length !== size || overlay.gen === 0xffffffff) {
    overlay.stamp = new Uint32Array(size);
    overlay.gen = 0;
  }
  const gen = ++overlay.gen;
  const stamp = overlay.stamp;
  stampBlockers(layer.n, blockers, radius, (c) => (stamp[c] = gen));
  return overlay;
}

let cost = new Float64Array(0);
let from = new Int32Array(0);
let seen = new Uint32Array(0);
let closed = new Uint32Array(0);
let queue = new Int32Array(0);
let gen = 0;

function begin(size: number): number {
  if (seen.length !== size || gen === 0xffffffff) {
    cost = new Float64Array(size);
    from = new Int32Array(size);
    seen = new Uint32Array(size);
    closed = new Uint32Array(size);
    queue = new Int32Array(size);
    gen = 0;
  }
  return ++gen;
}

export function nearestFreeCell(layer: NavLayer, ov: Overlay, c: number, component: number | null = null, maxRing = Infinity): number | null {
  const n = layer.n;
  const g = begin(n * n);
  let tail = 0;
  queue[tail++] = c;
  seen[c] = g;
  for (let i = 0; i < tail; i++) {
    const cur = queue[i];
    if (isFree(layer, ov, cur) && (component === null || componentOf(layer, cur) === component)) return cur;
    const count = neighbours(n, cur);
    for (let k = 0; k < count; k++) {
      const next = around[k];
      if (seen[next] === g || ringOf(n, c, next) > maxRing) continue;
      seen[next] = g;
      queue[tail++] = next;
    }
  }
  return null;
}

function isFree(layer: NavLayer, ov: Overlay, c: number): boolean {
  return !layer.blocked[c] && ov.stamp[c] !== ov.gen;
}

function ringOf(n: number, a: number, b: number): number {
  return Math.max(Math.abs((a % n) - (b % n)), Math.abs(Math.floor(a / n) - Math.floor(b / n)));
}

const AROUND_X = [-1, -1, -1, 0, 0, 1, 1, 1];
const AROUND_Y = [-1, 0, 1, -1, 1, -1, 0, 1];
const AROUND_STEP = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
const around = new Int32Array(8);
const aroundStep = new Float64Array(8);

function neighbours(n: number, cell: number): number {
  const x = cell % n;
  const y = Math.floor(cell / n);
  let count = 0;
  for (let i = 0; i < 8; i++) {
    const nx = x + AROUND_X[i];
    const ny = y + AROUND_Y[i];
    if (!inGrid(n, nx, ny)) continue;
    around[count] = ny * n + nx;
    aroundStep[count++] = AROUND_STEP[i];
  }
  return count;
}

function inGrid(n: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < n && y < n;
}

let heapItems = new Int32Array(1 << 16);
let heapKeys = new Float64Array(1 << 16);
let heapSize = 0;

function heapPush(item: number, key: number): void {
  if (heapSize === heapItems.length) {
    const items = new Int32Array(heapSize * 2);
    const keys = new Float64Array(heapSize * 2);
    items.set(heapItems);
    keys.set(heapKeys);
    heapItems = items;
    heapKeys = keys;
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapKeys[p] <= key) break;
    heapItems[i] = heapItems[p];
    heapKeys[i] = heapKeys[p];
    i = p;
  }
  heapItems[i] = item;
  heapKeys[i] = key;
}

function heapPop(): number {
  const top = heapItems[0];
  const lastItem = heapItems[--heapSize];
  const lastKey = heapKeys[heapSize];
  if (heapSize > 0) {
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= heapSize) break;
      const right = left + 1;
      const child = right < heapSize && heapKeys[right] < heapKeys[left] ? right : left;
      if (heapKeys[child] >= lastKey) break;
      heapItems[i] = heapItems[child];
      heapKeys[i] = heapKeys[child];
      i = child;
    }
    heapItems[i] = lastItem;
    heapKeys[i] = lastKey;
  }
  return top;
}

function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

const LONG_CELLS = 32;

export function findCells(layer: NavLayer, ov: Overlay, start: number, goal: number, taste: Taste | null): Int32Array | null {
  const cells = findCellsToward(layer, ov, start, goal, taste);
  return cells && cells[cells.length - 1] === goal ? cells : null;
}

export function findCellsToward(layer: NavLayer, ov: Overlay, start: number, goal: number, taste: Taste | null): Int32Array | null {
  if (start === goal) return Int32Array.of(start);
  if (!connected(layer, start, goal)) return null;
  const n = layer.n;
  if (heuristic(start % n, Math.floor(start / n), goal % n, Math.floor(goal / n)) > LONG_CELLS) {
    if (markCorridor(layer, start, goal, taste)) {
      const cells = fineSearch(layer, ov, start, goal, true, taste);
      if (cells[cells.length - 1] === goal) return cells;
    }
    count('route-corridor-miss');
  }
  return fineSearch(layer, ov, start, goal, false, taste);
}

function connected(layer: NavLayer, start: number, goal: number): boolean {
  const target = componentOf(layer, goal);
  return target !== 0 && target === startComponent(layer, start);
}

export function startComponent(layer: NavLayer, start: number): number {
  const own = componentOf(layer, start);
  if (own !== 0) return own;
  const n = layer.n;
  const x = start % n;
  const y = Math.floor(start / n);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const c = componentOf(layer, ny * n + nx);
      if (c !== 0) return c;
    }
  return 0;
}

export function canStepOut(layer: NavLayer, ov: Overlay, start: number): boolean {
  if (isFree(layer, ov, start)) return true;
  const count = neighbours(layer.n, start);
  for (let k = 0; k < count; k++) if (isFree(layer, ov, around[k])) return true;
  return false;
}

let coarseCost = new Float64Array(0);
let coarseFrom = new Int32Array(0);
let coarseSeen = new Uint32Array(0);
let coarseClosed = new Uint32Array(0);
let coarseGen = 0;
let inCorridor = new Uint32Array(0);
let corridorGen = 0;

function markCorridor(layer: NavLayer, start: number, goal: number, taste: Taste | null): boolean {
  const { n: bn, region, block, x: rx, y: ry, slow, edgeStart, edges } = layer.coarse;
  const regions = block.length;
  if (coarseSeen.length !== regions || coarseGen === 0xffffffff) {
    coarseCost = new Float64Array(regions);
    coarseFrom = new Int32Array(regions);
    coarseSeen = new Uint32Array(regions);
    coarseClosed = new Uint32Array(regions);
    coarseGen = 0;
  }
  if (inCorridor.length !== bn * bn || corridorGen === 0xffffffff) {
    inCorridor = new Uint32Array(bn * bn);
    corridorGen = 0;
  }
  const g = ++coarseGen;
  const from = startRegion(layer, start, goal);
  const to = region[goal];
  const w = REGION.navigation.heuristicWeight;
  const gx = rx[to];
  const gy = ry[to];
  heapSize = 0;
  coarseCost[from] = 0;
  coarseFrom[from] = -1;
  coarseSeen[from] = g;
  heapPush(from, heuristic(rx[from], ry[from], gx, gy) * w);
  while (heapSize > 0) {
    const cur = heapPop();
    if (cur === to) {
      const cg = ++corridorGen;
      for (let r = to; r !== -1; r = coarseFrom[r]) {
        const x = block[r] % bn;
        const y = Math.floor(block[r] / bn);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < bn && ny < bn) inCorridor[ny * bn + nx] = cg;
          }
      }
      return true;
    }
    if (coarseClosed[cur] === g) continue;
    coarseClosed[cur] = g;
    const base = coarseCost[cur];
    for (let e = edgeStart[cur]; e < edgeStart[cur + 1]; e++) {
      const next = edges[e];
      if (coarseClosed[next] === g) continue;
      const step = Math.hypot(rx[next] - rx[cur], ry[next] - ry[cur]) * ((slow[cur] + slow[next]) / 2);
      const c = base + tasted(taste, step, ((rx[cur] + rx[next]) / 2) * CELL, ((ry[cur] + ry[next]) / 2) * CELL);
      if (coarseSeen[next] === g && c >= coarseCost[next]) continue;
      coarseSeen[next] = g;
      coarseCost[next] = c;
      coarseFrom[next] = cur;
      heapPush(next, c + heuristic(rx[next], ry[next], gx, gy) * w);
    }
  }
  return false;
}

function startRegion(layer: NavLayer, start: number, goal: number): number {
  const region = layer.coarse.region;
  if (region[start] !== 0) return region[start];
  const n = layer.n;
  const x = start % n;
  const y = Math.floor(start / n);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const c = ny * n + nx;
      if (componentOf(layer, c) === componentOf(layer, goal)) return region[c];
    }
  throw new Error(`start cell ${start} has no free neighbour joined to goal ${goal}`);
}

function fineSearch(layer: NavLayer, ov: Overlay, start: number, goal: number, corridor: boolean, taste: Taste | null): Int32Array {
  const n = layer.n;
  const g = begin(n * n);
  const w = REGION.navigation.heuristicWeight;
  const gx = goal % n;
  const gy = Math.floor(goal / n);
  heapSize = 0;
  cost[start] = 0;
  from[start] = -1;
  seen[start] = g;
  heapPush(start, heuristic(start % n, Math.floor(start / n), gx, gy) * w);
  let nearest = start;
  let nearestLeft = Infinity;
  while (heapSize > 0) {
    const cur = heapPop();
    if (cur === goal) return unwind(goal);
    if (closed[cur] === g) continue;
    closed[cur] = g;
    const left = heuristic(cur % n, Math.floor(cur / n), gx, gy);
    if (left < nearestLeft) {
      nearest = cur;
      nearestLeft = left;
    }
    const count = neighbours(n, cur);
    for (let k = 0; k < count; k++) {
      const next = around[k];
      if (!canEnter(layer, ov, next, g, corridor)) continue;
      const nx = next % n;
      const ny = Math.floor(next / n);
      const c = cost[cur] + tasted(taste, aroundStep[k] * layer.slow[next], (nx + 0.5) * CELL, (ny + 0.5) * CELL);
      if (seen[next] === g && c >= cost[next]) continue;
      seen[next] = g;
      cost[next] = c;
      from[next] = cur;
      heapPush(next, c + heuristic(nx, ny, gx, gy) * w);
    }
  }
  return unwind(nearest);
}

function canEnter(layer: NavLayer, ov: Overlay, c: number, g: number, corridor: boolean): boolean {
  if (!isFree(layer, ov, c) || closed[c] === g) return false;
  const n = layer.n;
  const bn = layer.coarse.n;
  return !corridor || inCorridor[Math.floor(Math.floor(c / n) / COARSE) * bn + Math.floor((c % n) / COARSE)] === corridorGen;
}

function unwind(goal: number): Int32Array {
  let len = 1;
  for (let c = goal; from[c] !== -1; c = from[c]) len++;
  const out = new Int32Array(len);
  for (let c = goal, i = len - 1; i >= 0; c = from[c], i--) out[i] = c;
  return out;
}
