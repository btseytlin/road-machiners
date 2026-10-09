
import { REGION } from '../../data/region';
import { BREAKABLE } from '../../data/rules';
import { TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from '../../data/terrain';
import { atlasOf, atlasSites } from '../atlas';
import { nearRail, type DeckSet } from '../bridge';
import { blockingBoxes, boxDistance, isBreakable, isDriveObstacle, propKey, propReach, type PosedBox } from '../mapgen';
import { isCliff, tileSlope, type Terrain } from '../terrain';
import { hashRandom } from '../rng';
import type { Obstacle, Vehicle, World } from '../types';
import { isTerritory, siteGap, type Site } from '../sites';
import { dist, type Vec } from '../vec';
import { marksOf, ObstacleBuckets, sameMarks, type Blocker, type ObstacleMark } from './buckets';

export const CELL = 0.5;
export const CLEARANCE = 0.4;

export type TerrainNav = {
  size: number;
  n: number;
  cliffTile: Uint8Array;
  tileCost: Float64Array;
  flatCost: Float64Array;
  roadTile: Uint8Array;
  slow: Float32Array;
  decks: DeckSet;
};

export const COARSE = 8;

export type CoarseGrid = {
  n: number;
  region: Int32Array;
  block: Int32Array;
  x: Float32Array;
  y: Float32Array;
  slow: Float32Array;
  comp: Int32Array;
  edgeStart: Int32Array;
  edges: Int32Array;
};

export type NavLayer = TerrainNav & {
  id: number;
  radius: number;
  blocked: Uint8Array;
  coarse: CoarseGrid;
};

export type StaticSet = { key: string; solidKey: string; solid: Blocker[]; costly: Blocker[]; buckets: ObstacleBuckets };

export function isTransientWreck(o: Obstacle): boolean {
  return o.kind === 'wreck' && o.id.startsWith('wreck');
}

type SolidGrid = { blocked: Uint8Array; coarse: CoarseGrid };
type TerrainEntry = { nav: TerrainNav; cellCliff: Map<number, Uint8Array>; solidGrids: Map<string, SolidGrid>; layers: Map<string, NavLayer> };
const terrains = new WeakMap<Terrain, TerrainEntry>();
const LAYERS_MAX = 16;
let nextLayerId = 1;

function terrainEntry(t: Terrain) {
  let e = terrains.get(t);
  if (!e) {
    const n = Math.ceil(t.size / CELL);
    const tiles = tileLayers(t);
    const slow = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) slow[y * n + x] = tiles.tileCost[tileIndex(t.size, (x + 0.5) * CELL, (y + 0.5) * CELL)];
    e = { nav: { size: t.size, n, ...tiles, slow, decks: atlasOf(t).decks }, cellCliff: new Map(), solidGrids: new Map(), layers: new Map() };
    terrains.set(t, e);
  }
  return e;
}

function tileLayers(t: Terrain): Pick<TerrainNav, 'cliffTile' | 'tileCost' | 'flatCost' | 'roadTile'> {
  const cliffTile = new Uint8Array(t.size * t.size);
  const tileCost = new Float64Array(t.size * t.size);
  const flatCost = new Float64Array(t.size * t.size);
  const roadTile = new Uint8Array(t.size * t.size);
  const sites = atlasSites(atlasOf(t)).filter((s) => !isTerritory(s));
  for (let i = 0; i < t.size * t.size; i++) {
    cliffTile[i] = isCliff(t, i) ? 1 : 0;
    const bySite = nearSite(sites, (i % t.size) + 0.5, Math.floor(i / t.size) + 0.5);
    flatCost[i] = routeCost(t.types[i], bySite);
    tileCost[i] = flatCost[i] * slopeCost(t, i);
    roadTile[i] = t.types[i] === 'road' && !bySite ? 1 : 0;
  }
  return { cliffTile, tileCost, flatCost, roadTile };
}

function routeCost(type: TerrainTypeId, bySite: boolean): number {
  return (type === 'road' || bySite ? 1 : REGION.navigation.offRoadCost) / TERRAIN_TYPES[type].speed;
}

function slopeCost(t: Terrain, tile: number): number {
  const s = tileSlope(t, tile);
  return 1 + REGION.navigation.slopeCost * (Math.hypot(s.x, s.y) / TERRAIN.drive.maxSlope) ** 2;
}

function nearSite(sites: readonly Site[], x: number, y: number): boolean {
  return sites.some((s) => siteGap(s, { x, y }) < REGION.roadWidth);
}

export function terrainNav(t: Terrain): TerrainNav {
  return terrainEntry(t).nav;
}

export function onRouteRoad(nav: TerrainNav, x: number, y: number): boolean {
  return nav.roadTile[tileIndex(nav.size, x, y)] === 1;
}

export function tileIndex(size: number, x: number, y: number): number {
  const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
  return ty * size + tx;
}

export function nearCliff(nav: TerrainNav, x: number, y: number, reach: number): boolean {
  const c = nav.cliffTile;
  const s = nav.size;
  return c[tileIndex(s, x, y)] === 1 || c[tileIndex(s, x + reach, y)] === 1 || c[tileIndex(s, x - reach, y)] === 1 || c[tileIndex(s, x, y + reach)] === 1 || c[tileIndex(s, x, y - reach)] === 1;
}

const STATIC_SETS_KEPT = 4;
const staticSets: { marks: ObstacleMark[]; terrain: Terrain; set: StaticSet }[] = [];

export function staticSet(obstacles: Obstacle[], terrain: Terrain): StaticSet {
  const at = staticSets.findIndex((e) => e.terrain === terrain && sameMarks(e.marks, obstacles));
  if (at === 0) return staticSets[0].set;
  if (at > 0) {
    const [hit] = staticSets.splice(at, 1);
    staticSets.unshift(hit);
    return hit.set;
  }
  const statics = obstacles.filter((o) => isDriveObstacle(o) && !isTransientWreck(o));
  const all = [...statics.map((o) => driveBlocker(o, terrain)), ...atlasOf(terrain).hazards.map((z) => ({ pos: z.pos, r: z.radius }))];
  const breakable = statics.map(isBreakable);
  const solid = all.filter((_, i) => !breakable[i]);
  const set = {
    key: blockerKey(all),
    solidKey: blockerKey(solid),
    solid,
    costly: all.filter((_, i) => breakable[i]),
    buckets: new ObstacleBuckets(all, terrain.size),
  };
  staticSets.unshift({ marks: marksOf(obstacles), terrain, set });
  staticSets.length = Math.min(staticSets.length, STATIC_SETS_KEPT);
  return set;
}

export function dynamicBlockers(obstacles: Obstacle[], terrain: Terrain, extra: Blocker[]): Blocker[] {
  return [...obstacles.filter((o) => isDriveObstacle(o) && isTransientWreck(o)).map((o) => driveBlocker(o, terrain)), ...extra];
}

function driveBlocker(o: Obstacle, terrain: Terrain): Blocker {
  if (o.kind === 'site') return { pos: o.pos, r: o.r };
  return { pos: o.pos, r: propReach(o), prop: { key: propKey(o), boxes: blockingBoxes(o, terrain) } };
}

export function blockerKey(blockers: Blocker[]): string {
  return blockers.map((o) => (o.prop ? o.prop.key : `${o.pos.x},${o.pos.y},${o.r}`)).join('|');
}

export function navLayer(terrain: Terrain, obstacles: Obstacle[], radius: number): NavLayer {
  const e = terrainEntry(terrain);
  const statics = staticSet(obstacles, terrain);
  const key = `${radius}:${statics.key}`;
  const hit = e.layers.get(key);
  if (hit) return hit;
  if (e.layers.size >= LAYERS_MAX) e.layers.clear();
  const nav = e.nav;
  const cliff = cliffCells(e, radius);
  const solid = solidGrid(e, cliff, statics, radius);
  const slow = costlySlow(nav, statics.costly, radius);
  const coarse = statics.costly.length === 0 ? solid.coarse : withRegionSlow(solid.coarse, slow);
  const layer: NavLayer = { ...nav, slow, id: nextLayerId++, radius, blocked: solid.blocked, coarse };
  e.layers.set(key, layer);
  return layer;
}

function cliffCells(e: TerrainEntry, radius: number): Uint8Array {
  const cached = e.cellCliff.get(radius);
  if (cached) return cached;
  if (e.cellCliff.size >= LAYERS_MAX) e.cellCliff.clear();
  const cliff = markCliffCells(e.nav, radius + CLEARANCE);
  e.cellCliff.set(radius, cliff);
  return cliff;
}

function markCliffCells(nav: TerrainNav, reach: number): Uint8Array {
  const n = nav.n;
  const cliff = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const cx = (x + 0.5) * CELL;
    const cy = (y + 0.5) * CELL;
    if (nearCliff(nav, cx, cy, reach) || nearRail(nav.decks, cx, cy, reach)) cliff[y * n + x] = 1;
  }
  return cliff;
}

function solidGrid(e: TerrainEntry, cliff: Uint8Array, statics: StaticSet, radius: number): SolidGrid {
  const key = `${radius}:${statics.solidKey}`;
  let grid = e.solidGrids.get(key);
  if (!grid) {
    if (e.solidGrids.size >= LAYERS_MAX) e.solidGrids.clear();
    const blocked = cliff.slice();
    stampBlockers(e.nav.n, statics.solid, radius, (c) => (blocked[c] = 1));
    grid = { blocked, coarse: coarseGrid(e.nav.n, blocked, e.nav.slow) };
    e.solidGrids.set(key, grid);
  }
  return grid;
}

function withRegionSlow(coarse: CoarseGrid, slow: Float32Array): CoarseGrid {
  const sum = new Float64Array(coarse.slow.length);
  const count = new Uint32Array(coarse.slow.length);
  for (let c = 0; c < coarse.region.length; c++) {
    const r = coarse.region[c];
    sum[r] += slow[c];
    count[r]++;
  }
  const mean = new Float32Array(coarse.slow.length);
  for (let r = 1; r < mean.length; r++) mean[r] = sum[r] / count[r];
  return { ...coarse, slow: mean };
}

function costlySlow(nav: TerrainNav, costly: Blocker[], radius: number): Float32Array {
  if (costly.length === 0) return nav.slow;
  const marked = new Uint8Array(nav.n * nav.n);
  stampBlockers(nav.n, costly, radius, (c) => (marked[c] = 1));
  const slow = nav.slow.slice();
  for (let c = 0; c < slow.length; c++) if (marked[c]) slow[c] *= BREAKABLE.routeCost;
  return slow;
}

export function stampBlockers(n: number, blockers: Blocker[], radius: number, mark: (cell: number) => void): void {
  const grow = radius + CLEARANCE;
  for (const o of blockers) {
    if (!o.prop) {
      const reach = o.r + grow;
      stampWithin(n, o.pos, reach, reach, (p) => dist(p, o.pos) < reach, mark);
      continue;
    }
    for (const box of o.prop.boxes) stampWithin(n, box.center, ...boxExtent(box, grow), (p) => boxDistance(box, p) < grow, mark);
  }
}

function boxExtent(box: PosedBox, grow: number): [number, number] {
  const ax = Math.abs(box.axis.x);
  const ay = Math.abs(box.axis.y);
  return [ax * box.half.x + ay * box.half.y + grow, ay * box.half.x + ax * box.half.y + grow];
}

function stampWithin(n: number, center: Vec, ex: number, ey: number, inside: (p: Vec) => boolean, mark: (cell: number) => void): void {
  const x0 = Math.max(0, Math.floor((center.x - ex) / CELL));
  const y0 = Math.max(0, Math.floor((center.y - ey) / CELL));
  const x1 = Math.min(n - 1, Math.floor((center.x + ex) / CELL));
  const y1 = Math.min(n - 1, Math.floor((center.y + ey) / CELL));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (inside({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL })) mark(y * n + x);
}

export function componentOf(layer: NavLayer, cell: number): number {
  const r = layer.coarse.region[cell];
  return r === 0 ? 0 : layer.coarse.comp[r];
}

function coarseGrid(n: number, blocked: Uint8Array, slow: Float32Array): CoarseGrid {
  const bn = Math.ceil(n / COARSE);
  const region = new Int32Array(n * n);
  const queue = new Int32Array(COARSE * COARSE);
  const blockOf: number[] = [0];
  const sumX: number[] = [0];
  const sumY: number[] = [0];
  const sumSlow: number[] = [0];
  const size: number[] = [0];
  for (let by = 0; by < bn; by++)
    for (let bx = 0; bx < bn; bx++) {
      const x0 = bx * COARSE;
      const y0 = by * COARSE;
      const w = Math.min(n, x0 + COARSE) - x0;
      const h = Math.min(n, y0 + COARSE) - y0;
      if (allFree(blocked, n, x0, y0, w, h)) {
        const id = blockOf.length;
        blockOf.push(by * bn + bx);
        let ts = 0;
        for (let ly = 0; ly < h; ly++)
          for (let lx = 0; lx < w; lx++) {
            const c = (y0 + ly) * n + x0 + lx;
            region[c] = id;
            ts += slow[c];
          }
        sumX.push((x0 + (w - 1) / 2) * w * h);
        sumY.push((y0 + (h - 1) / 2) * w * h);
        sumSlow.push(ts);
        size.push(w * h);
        continue;
      }
      for (let sy = 0; sy < h; sy++)
        for (let sx = 0; sx < w; sx++) {
          const seed = (y0 + sy) * n + x0 + sx;
          if (blocked[seed] || region[seed]) continue;
          const id = blockOf.length;
          blockOf.push(by * bn + bx);
          let tx = 0;
          let ty = 0;
          let ts = 0;
          region[seed] = id;
          let tail = 0;
          queue[tail++] = sy * COARSE + sx;
          for (let i = 0; i < tail; i++) {
            const lx = queue[i] % COARSE;
            const ly = (queue[i] - lx) / COARSE;
            tx += x0 + lx;
            ty += y0 + ly;
            ts += slow[(y0 + ly) * n + x0 + lx];
            const ya = ly > 0 ? ly - 1 : 0;
            const yb = ly < h - 1 ? ly + 1 : ly;
            const xa = lx > 0 ? lx - 1 : 0;
            const xb = lx < w - 1 ? lx + 1 : lx;
            for (let ny = ya; ny <= yb; ny++)
              for (let nx = xa; nx <= xb; nx++) {
                const c = (y0 + ny) * n + x0 + nx;
                if (blocked[c] || region[c]) continue;
                region[c] = id;
                queue[tail++] = ny * COARSE + nx;
              }
          }
          sumX.push(tx);
          sumY.push(ty);
          sumSlow.push(ts);
          size.push(tail);
        }
    }
  const count = blockOf.length;
  const links: number[][] = Array.from({ length: count }, () => []);
  let lastA = 0;
  let lastB = 0;
  const link = (a: number, b: number) => {
    if (a === 0 || b === 0 || a === b || (a === lastA && b === lastB)) return;
    lastA = a;
    lastB = b;
    if (links[a].includes(b)) return;
    links[a].push(b);
    links[b].push(a);
  };
  for (let k = COARSE; k < n; k += COARSE) {
    for (let i = 0; i < n; i++) {
      const left = region[i * n + k - 1];
      if (left === 0) continue;
      if (i > 0) link(left, region[(i - 1) * n + k]);
      link(left, region[i * n + k]);
      if (i < n - 1) link(left, region[(i + 1) * n + k]);
    }
    for (let i = 0; i < n; i++) {
      const top = region[(k - 1) * n + i];
      if (top === 0) continue;
      if (i > 0) link(top, region[k * n + i - 1]);
      link(top, region[k * n + i]);
      if (i < n - 1) link(top, region[k * n + i + 1]);
    }
  }
  const edgeStart = new Int32Array(count + 1);
  for (let r = 0; r < count; r++) edgeStart[r + 1] = edgeStart[r] + links[r].length;
  const edges = new Int32Array(edgeStart[count]);
  for (let r = 0; r < count; r++) edges.set(links[r], edgeStart[r]);
  const cx = new Float32Array(count);
  const cy = new Float32Array(count);
  const mean = new Float32Array(count);
  for (let r = 1; r < count; r++) {
    cx[r] = sumX[r] / size[r];
    cy[r] = sumY[r] / size[r];
    mean[r] = sumSlow[r] / size[r];
  }
  return { n: bn, region, block: Int32Array.from(blockOf), x: cx, y: cy, slow: mean, comp: components(count, edgeStart, edges), edgeStart, edges };
}

function allFree(blocked: Uint8Array, n: number, x0: number, y0: number, w: number, h: number): boolean {
  for (let ly = 0; ly < h; ly++)
    for (let lx = 0; lx < w; lx++) if (blocked[(y0 + ly) * n + x0 + lx]) return false;
  return true;
}

function components(count: number, edgeStart: Int32Array, edges: Int32Array): Int32Array {
  const comp = new Int32Array(count);
  const queue = new Int32Array(count);
  let next = 0;
  for (let seed = 1; seed < count; seed++) {
    if (comp[seed]) continue;
    const id = ++next;
    comp[seed] = id;
    let tail = 0;
    queue[tail++] = seed;
    for (let i = 0; i < tail; i++) {
      const cur = queue[i];
      for (let e = edgeStart[cur]; e < edgeStart[cur + 1]; e++) {
        const r = edges[e];
        if (comp[r]) continue;
        comp[r] = id;
        queue[tail++] = r;
      }
    }
  }
  return comp;
}

export type Taste = { seed: number; side: number; values: Float32Array; roads: Uint8Array | null; size: number };

const TASTES_MAX = 256;
const tastes = new Map<string, Taste>();

export function tasteOf(world: World, v: Pick<Vehicle, "id" | "brain"> | undefined): Taste | null {
  if (!v?.brain) return null;
  const chars = Array.from(v.id, (ch) => ch.charCodeAt(0));
  const seed = Math.floor(hashRandom(world.seed, ...chars) * 0x100000000) | 0;
  const key = `${seed}:${world.size}`;
  let taste = tastes.get(key);
  if (!taste) {
    if (tastes.size >= TASTES_MAX) tastes.clear();
    taste = makeTaste(seed, world.size);
    tastes.set(key, taste);
  }
  return taste;
}

export function makeTaste(seed: number, size: number): Taste {
  const { scale, strength } = REGION.navigation.taste;
  const side = Math.ceil(size / scale) + 2;
  const values = new Float32Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) values[y * side + x] = 1 + strength * (hashRandom(seed, x, y) - 0.5);
  return { seed, side, values, roads: null, size };
}

export function offRoadTaste(taste: Taste, nav: TerrainNav): Taste {
  return { ...taste, roads: nav.roadTile, size: nav.size };
}

export function tasteAt(t: Taste, x: number, y: number): number {
  const scale = REGION.navigation.taste.scale;
  const gx = Math.max(0, x / scale);
  const gy = Math.max(0, y / scale);
  const ix = Math.min(t.side - 2, Math.floor(gx));
  const iy = Math.min(t.side - 2, Math.floor(gy));
  const fx = smooth(Math.min(1, gx - ix));
  const fy = smooth(Math.min(1, gy - iy));
  const i = iy * t.side + ix;
  const v = t.values;
  const top = v[i] + (v[i + 1] - v[i]) * fx;
  const bottom = v[i + t.side] + (v[i + t.side + 1] - v[i + t.side]) * fx;
  return top + (bottom - top) * fy;
}

export function tasted(t: Taste | null, cost: number, x: number, y: number): number {
  if (!t) return cost;
  const c = cost * tasteAt(t, x, y);
  return t.roads && t.roads[tileIndex(t.size, x, y)] === 1 ? c * REGION.navigation.roadShyCost : c;
}

export function tasteKey(t: Taste | null): string {
  if (!t) return 'plain';
  return t.roads ? `${t.seed}:off` : String(t.seed);
}

function smooth(f: number): number {
  return f * f * (3 - 2 * f);
}
