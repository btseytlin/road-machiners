// The geology layer of the map bake: rain, slump and wind over the draft's corner grid. Each rule is its
// own function over typed arrays, so a test can run it alone on a small grid. Rules never read roads or
// sites; the finish layer grades roads over the result.

import { GEOLOGY } from "../data/terrain";
import type { DuneRules, RainRules, SandStart, SlumpRules, WindRules } from "../data/terrain";
import { noiseAt } from "../sim/elevation";
import { chance, nextRandom } from "../sim/rng";
import type { Rng } from "../sim/rng";
import type { MapDraft } from "./bake";

export function geologyLayer(seed: number, d: MapDraft): MapDraft {
  seedSand(d, GEOLOGY.sandStart);
  let t = performance.now();
  const rainOut = rain(d, GEOLOGY.rain);
  t = logRule("rain", t, `${rainOut.toFixed(1)} units of soil off the edge`);
  slump(d, GEOLOGY.slump);
  t = logRule("slump", t, "");
  const windOut = wind(d, GEOLOGY.wind, { rngState: seed });
  t = logRule("wind", t, `${windOut.toFixed(1)} units of sand off the edge`);
  dunes(d, GEOLOGY.dunes, GEOLOGY.wind.direction, seed);
  logRule("dunes", t, "");
  return d;
}

function seedSand(d: MapDraft, start: SandStart): void {
  for (let k = 0; k < d.heights.length; k++) {
    const share = Math.min(1, Math.max(0, (start.below - d.heights[k]) / start.fade));
    d.sand[k] = start.depth * share;
  }
}

function logRule(name: string, since: number, note: string): number {
  const now = performance.now();
  console.log(`geology ${name}: ${((now - since) / 1000).toFixed(2)} s ${note}`.trimEnd());
  return now;
}

export type Neighbors = { offsets: Int32Array; invDist: Float64Array };

export function cornerNeighbors(n: number): Neighbors {
  const d = Math.SQRT1_2;
  return {
    offsets: Int32Array.of(-1, 1, -n, n, -n - 1, -n + 1, n - 1, n + 1),
    invDist: Float64Array.of(1, 1, 1, 1, d, d, d, d),
  };
}

function isInterior(k: number, n: number): boolean {
  const i = k % n;
  const j = (k - i) / n;
  return i > 0 && j > 0 && i < n - 1 && j < n - 1;
}


type RainGrid = {
  n: number;
  nb: Neighbors;
  height: Float64Array;
  water: Float64Array;
  soil: Float64Array;
  order: Uint32Array;
  weights: Float64Array;
  steepest: number;
  before: Float64Array;
  spread: Float64Array;
  flow: Float32Array;
  outflow: number;
};

export function rain(d: MapDraft, rules: RainRules): number {
  const g = newRainGrid(d);
  for (let s = 0; s < rules.steps; s++) {
    sortByHeight(g);
    g.water.fill(rules.rainPerStep);
    g.soil.fill(0);
    g.before.set(g.height);
    for (const k of g.order) route(g, k, rules);
    settleLateSoil(g);
    spreadCuts(g, rules);
  }
  for (let k = 0; k < g.height.length; k++) d.heights[k] = g.height[k];
  return g.outflow;
}

function spreadCuts(g: RainGrid, rules: RainRules): void {
  const { n, height, before, spread } = g;
  for (let k = 0; k < height.length; k++) spread[k] = height[k] - before[k];
  for (let pass = 0; pass < rules.spreadPasses; pass++) {
    height.set(spread);
    spreadPass(spread, height, n, rules.spreadRate);
  }
  for (let k = 0; k < height.length; k++) height[k] = before[k] + spread[k];
}

function spreadPass(out: Float64Array, start: Float64Array, n: number, rate: number): void {
  for (let j = 0; j < n; j++) for (let i = 0; i + 1 < n; i++) trade(out, start, j * n + i, j * n + i + 1, rate);
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i < n; i++) trade(out, start, j * n + i, (j + 1) * n + i, rate);
}

function trade(out: Float64Array, start: Float64Array, a: number, b: number, rate: number): void {
  const t = (start[b] - start[a]) * rate;
  out[a] += t;
  out[b] -= t;
}

function newRainGrid(d: MapDraft): RainGrid {
  const n = d.size + 1;
  const count = n * n;
  const order = new Uint32Array(count);
  for (let k = 0; k < count; k++) order[k] = k;
  return {
    n,
    nb: cornerNeighbors(n),
    height: Float64Array.from(d.heights),
    water: new Float64Array(count),
    soil: new Float64Array(count),
    order,
    weights: new Float64Array(8),
    steepest: 0,
    before: new Float64Array(count),
    spread: new Float64Array(count),
    flow: d.flow,
    outflow: 0,
  };
}

function sortByHeight(g: RainGrid): void {
  const h = g.height;
  g.order.sort((a, b) => h[b] - h[a] || a - b);
}

function route(g: RainGrid, k: number, rules: RainRules): void {
  g.flow[k] += g.water[k];
  const carried = g.soil[k];
  g.soil[k] = 0;
  if (!isInterior(k, g.n)) {
    g.outflow += carried;
    return;
  }
  const total = weighLowerNeighbors(g, k, rules.focusSquarings);
  if (total === 0) {
    g.height[k] += carried;
    return;
  }
  const water = g.water[k] * (1 - rules.evaporation);
  const soil = erode(g, k, water, rules, carried);
  const { offsets } = g.nb;
  for (let q = 0; q < 8; q++) {
    const share = g.weights[q] / total;
    g.water[k + offsets[q]] += water * share;
    g.soil[k + offsets[q]] += soil * share;
  }
}

function weighLowerNeighbors(g: RainGrid, k: number, squarings: number): number {
  const { offsets, invDist } = g.nb;
  const h = g.height[k];
  let total = 0;
  let steepest = 0;
  for (let q = 0; q < 8; q++) {
    const slope = Math.max(0, (h - g.height[k + offsets[q]]) * invDist[q]);
    let weight = slope;
    for (let s = 0; s < squarings; s++) weight *= weight;
    g.weights[q] = weight;
    total += g.weights[q];
    steepest = Math.max(steepest, slope);
  }
  g.steepest = steepest;
  return total;
}

function erode(g: RainGrid, k: number, water: number, rules: RainRules, carried: number): number {
  const slope = g.steepest;
  const free = rules.capacity * Math.max(slope, rules.minSlope) * water - carried;
  const moved = free > 0 ? Math.min(rules.pickupRate * free, rules.maxDig * slope) : rules.dropRate * free;
  g.height[k] -= moved;
  return carried + moved;
}

function settleLateSoil(g: RainGrid): void {
  for (let k = 0; k < g.height.length; k++) {
    if (g.soil[k] === 0) continue;
    if (isInterior(k, g.n)) g.height[k] += g.soil[k];
    else g.outflow += g.soil[k];
  }
}


export function slump(d: MapDraft, rules: SlumpRules): void {
  const n = d.size + 1;
  const nb = cornerNeighbors(n);
  const height = Float64Array.from(d.heights);
  for (let s = 0; s < rules.steps; s++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) slide(height, d.slumped, nb, j * n + i, rules);
    }
  }
  for (let k = 0; k < height.length; k++) d.heights[k] = height[k];
}

function slide(height: Float64Array, slumped: Uint8Array, nb: Neighbors, k: number, rules: SlumpRules): void {
  const { offsets, invDist } = nb;
  let steepest = rules.restSlope;
  let target = -1;
  for (let q = 0; q < 8; q++) {
    const slope = (height[k] - height[k + offsets[q]]) * invDist[q];
    if (slope > steepest) {
      steepest = slope;
      target = q;
    }
  }
  if (target < 0) return;
  const m = k + offsets[target];
  const moved = (rules.slideShare * (steepest - rules.restSlope)) / invDist[target] / 2;
  height[k] -= moved;
  height[m] += moved;
  slumped[k] = 1;
  slumped[m] = 1;
}


type WindGrid = {
  n: number;
  nb: Neighbors;
  ground: Float32Array;
  sand: Float64Array;
  sandy: Int32Array;
  sandyCount: number;
  listed: Uint8Array;
  hopX: number;
  hopY: number;
  upwind: Int32Array;
  upwindDrop: Float64Array;
  outflow: number;
};

export function wind(d: MapDraft, rules: WindRules, rng: Rng): number {
  const g = newWindGrid(d, rules);
  const events = rules.stepsPerCell * g.sandyCount;
  for (let e = 0; e < events; e++) {
    const k = g.sandy[Math.floor(nextRandom(rng) * g.sandyCount)];
    if (g.sand[k] > 0 && !inShadow(g, k)) lift(g, k, rules, rng);
  }
  for (let k = 0; k < g.sand.length; k++) {
    d.sand[k] = g.sand[k];
    d.heights[k] += d.sand[k];
  }
  return g.outflow;
}

function newWindGrid(d: MapDraft, rules: WindRules): WindGrid {
  if (!(rules.hop >= 1)) throw new Error(`Wind hop must be at least 1 tile, got ${rules.hop}`);
  const n = d.size + 1;
  const angle = (rules.direction * Math.PI) / 180;
  const g: WindGrid = {
    n,
    nb: cornerNeighbors(n),
    ground: d.heights,
    sand: Float64Array.from(d.sand),
    sandy: new Int32Array(n * n),
    sandyCount: 0,
    listed: new Uint8Array(n * n),
    hopX: rules.hop * Math.cos(angle),
    hopY: rules.hop * Math.sin(angle),
    upwind: new Int32Array(rules.shadowReach * 2),
    upwindDrop: new Float64Array(rules.shadowReach),
    outflow: 0,
  };
  for (let s = 0; s < rules.shadowReach; s++) {
    const x = Math.round(-(s + 1) * Math.cos(angle));
    const y = Math.round(-(s + 1) * Math.sin(angle));
    g.upwind[2 * s] = x;
    g.upwind[2 * s + 1] = y;
    g.upwindDrop[s] = rules.shadowSlope * Math.hypot(x, y);
  }
  for (let k = 0; k < g.sand.length; k++) {
    if (g.sand[k] > 0) markSandy(g, k);
  }
  return g;
}

function markSandy(g: WindGrid, k: number): void {
  if (g.listed[k]) return;
  g.listed[k] = 1;
  g.sandy[g.sandyCount++] = k;
}

function surface(g: WindGrid, k: number): number {
  return g.ground[k] + g.sand[k];
}

function onMap(g: WindGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.n && y < g.n;
}

function inShadow(g: WindGrid, k: number): boolean {
  const x = k % g.n;
  const y = (k - x) / g.n;
  const here = surface(g, k);
  for (let s = 0; s < g.upwindDrop.length; s++) {
    const ux = x + g.upwind[2 * s];
    const uy = y + g.upwind[2 * s + 1];
    if (!onMap(g, ux, uy)) return false;
    if (surface(g, uy * g.n + ux) - here > g.upwindDrop[s]) return true;
  }
  return false;
}

function lift(g: WindGrid, k: number, rules: WindRules, rng: Rng): void {
  const slab = Math.min(rules.slab, g.sand[k]);
  g.sand[k] -= slab;
  if (isInterior(k, g.n)) {
    for (const offset of g.nb.offsets) avalanche(g, k + offset, rules.sandSlope);
  }
  carry(g, k, slab, rules, rng);
}

function carry(g: WindGrid, k: number, slab: number, rules: WindRules, rng: Rng): void {
  const x0 = k % g.n;
  const y0 = (k - x0) / g.n;
  for (let hop = 1; ; hop++) {
    const x = Math.round(x0 + hop * g.hopX);
    const y = Math.round(y0 + hop * g.hopY);
    if (!onMap(g, x, y)) {
      g.outflow += slab;
      return;
    }
    const at = y * g.n + x;
    if (lands(g, at, rules, rng)) {
      g.sand[at] += slab;
      markSandy(g, at);
      avalanche(g, at, rules.sandSlope);
      return;
    }
  }
}

function lands(g: WindGrid, k: number, rules: WindRules, rng: Rng): boolean {
  if (inShadow(g, k)) return true;
  return chance(rng, g.sand[k] > 0 ? rules.depositOnSand : rules.depositOnBare);
}

function avalanche(g: WindGrid, k: number, sandSlope: number): void {
  let at = k;
  while (isInterior(at, g.n) && g.sand[at] > 0) {
    const q = steepestFace(g, at, sandSlope);
    if (q < 0) return;
    const to = at + g.nb.offsets[q];
    const excess = (surface(g, at) - surface(g, to)) * g.nb.invDist[q] - sandSlope;
    const moved = Math.min(g.sand[at], excess / g.nb.invDist[q] / 2);
    g.sand[at] -= moved;
    g.sand[to] += moved;
    markSandy(g, to);
    at = to;
  }
}

function steepestFace(g: WindGrid, k: number, sandSlope: number): number {
  const { offsets, invDist } = g.nb;
  const here = surface(g, k);
  let steepest = sandSlope;
  let best = -1;
  for (let q = 0; q < 8; q++) {
    const slope = (here - surface(g, k + offsets[q])) * invDist[q];
    if (slope > steepest) {
      steepest = slope;
      best = q;
    }
  }
  return best;
}

export function pondDepths(heights: ArrayLike<number>, size: number, lakeDepth: number): Float32Array {
  const n = size + 1;
  const level = spillLevels(heights, n);
  capLakes(heights, level, n, lakeDepth);
  const depth = new Float32Array(n * n);
  for (let k = 0; k < depth.length; k++) depth[k] = level[k] - heights[k];
  return depth;
}

function spillLevels(heights: ArrayLike<number>, n: number): Float64Array {
  const level = Float64Array.from(heights);
  const reached = new Uint8Array(n * n);
  const heap = newHeap(n * n, level);
  for (let k = 0; k < n * n; k++) {
    if (isInterior(k, n)) continue;
    reached[k] = 1;
    pushHeap(heap, k);
  }
  const { offsets } = cornerNeighbors(n);
  while (heap.count > 0) floodFrom(heap, popHeap(heap), offsets, n, reached);
  return level;
}

function floodFrom(heap: Heap, k: number, offsets: Int32Array, n: number, reached: Uint8Array): void {
  const level = heap.key;
  for (const offset of offsets) {
    const m = k + offset;
    if (!isGridNeighbor(k, m, n) || reached[m]) continue;
    reached[m] = 1;
    level[m] = Math.max(level[m], level[k]);
    pushHeap(heap, m);
  }
}

function capLakes(heights: ArrayLike<number>, level: Float64Array, n: number, lakeDepth: number): void {
  const seen = new Uint8Array(n * n);
  const basin = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (seen[k] || level[k] <= heights[k]) continue;
    const count = collectBasin(heights, level, n, k, seen, basin);
    let bottom = Infinity;
    for (let b = 0; b < count; b++) bottom = Math.min(bottom, heights[basin[b]]);
    for (let b = 0; b < count; b++) level[basin[b]] = Math.min(level[basin[b]], bottom + lakeDepth);
  }
}

function collectBasin(heights: ArrayLike<number>, level: Float64Array, n: number, start: number, seen: Uint8Array, basin: Int32Array): number {
  const { offsets } = cornerNeighbors(n);
  seen[start] = 1;
  basin[0] = start;
  let count = 1;
  for (let b = 0; b < count; b++) {
    const k = basin[b];
    for (const offset of offsets) {
      const m = k + offset;
      if (!isGridNeighbor(k, m, n) || seen[m] || level[m] <= heights[m]) continue;
      seen[m] = 1;
      basin[count++] = m;
    }
  }
  return count;
}

function isGridNeighbor(k: number, m: number, n: number): boolean {
  return m >= 0 && m < n * n && Math.abs((m % n) - (k % n)) <= 1;
}

type Heap = { items: Int32Array; count: number; key: Float64Array };

function newHeap(capacity: number, key: Float64Array): Heap {
  return { items: new Int32Array(capacity), count: 0, key };
}

function below(h: Heap, a: number, b: number): boolean {
  const ka = h.key[h.items[a]];
  const kb = h.key[h.items[b]];
  return ka < kb || (ka === kb && h.items[a] < h.items[b]);
}

function swap(h: Heap, a: number, b: number): void {
  const t = h.items[a];
  h.items[a] = h.items[b];
  h.items[b] = t;
}

function pushHeap(h: Heap, k: number): void {
  let at = h.count++;
  h.items[at] = k;
  while (at > 0) {
    const parent = (at - 1) >> 1;
    if (!below(h, at, parent)) return;
    swap(h, at, parent);
    at = parent;
  }
}

function popHeap(h: Heap): number {
  const top = h.items[0];
  h.items[0] = h.items[--h.count];
  let at = 0;
  for (;;) {
    const least = leastOfFamily(h, at);
    if (least === at) return top;
    swap(h, at, least);
    at = least;
  }
}

function leastOfFamily(h: Heap, at: number): number {
  const left = 2 * at + 1;
  let least = at;
  if (left < h.count && below(h, left, least)) least = left;
  if (left + 1 < h.count && below(h, left + 1, least)) least = left + 1;
  return least;
}

export function dunes(d: MapDraft, rules: DuneRules, windDirection: number, seed: number): void {
  const n = d.size + 1;
  const angle = (windDirection * Math.PI) / 180;
  const ground = Float32Array.from(d.heights);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = j * n + i;
    const share = duneShare(d.sand[k], cornerSlope(ground, n, k), rules);
    if (share === 0) continue;
    const bend = (noiseAt(seed + rules.bendSeedOffset, i * rules.bendFrequency, j * rules.bendFrequency) - 0.5) * 2 * rules.bend;
    const phase = fract((i * Math.cos(angle) + j * Math.sin(angle) + bend) / rules.wavelength);
    const lift = rules.height * share * ridgeProfile(phase, rules.leeShare);
    d.heights[k] += lift;
    d.sand[k] += lift;
  }
}

function duneShare(sand: number, slope: number, rules: DuneRules): number {
  if (sand <= rules.minSand || slope > rules.maxSlope) return 0;
  return Math.min(1, (sand - rules.minSand) / (rules.fullSand - rules.minSand));
}

function ridgeProfile(phase: number, leeShare: number): number {
  const rise = 1 - leeShare;
  return phase < rise ? phase / rise : (1 - phase) / leeShare;
}

function cornerSlope(h: Float32Array, n: number, k: number): number {
  return Math.max(Math.abs(h[k + 1] - h[k - 1]), Math.abs(h[k + n] - h[k - n])) / 2;
}

function fract(x: number): number {
  return x - Math.floor(x);
}
