// Static navigation layers: per-tile cliff flags and route costs, and per-cell blocked flags and step
// costs for one vehicle radius. Road and kill wrecks and parked vehicles are not in here; the A* overlay
// stamps them per query. Breakable props make their cells costly instead of blocked. Per-driver route taste
// scales these costs.

import { hazardZones } from '../territory';
import { REGION } from '../../data/region';
import { BREAKABLE } from '../../data/rules';
import { TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from '../../data/terrain';
import { nearRail } from '../bridge';
import { blockingBoxes, boxDistance, isBreakable, isDriveObstacle, propKey, propReach, type PosedBox } from '../mapgen';
import { isCliff, tileSlope, type Terrain } from '../terrain';
import { hashRandom } from '../rng';
import type { Obstacle, Vehicle, World } from '../types';
import { siteGap } from '../sites';
import { dist, type Vec } from '../vec';
import { marksOf, ObstacleBuckets, sameMarks, type Blocker, type ObstacleMark } from './buckets';

export const CELL = 0.5; // tiles per grid cell
export const CLEARANCE = 0.4; // extra gap from obstacles on top of the vehicle radius; covers RULES.maxBulge

// Per-terrain data every radius shares.
export type TerrainNav = {
  size: number;
  n: number; // grid cells per side
  cliffTile: Uint8Array; // 1 where the tile is too steep to drive
  tileCost: Float64Array; // route cost per tile driven: flatCost times the slope multiplier
  flatCost: Float64Array; // route cost per tile before the slope multiplier: 1 / terrain speed, times offRoadCost off the road
  slow: Float32Array; // step cost multiplier per cell, the tileCost under its center
};

export const COARSE = 8; // cells per coarse block side

// Coarse graph for the corridor search of long routes. A region is a connected piece of free cells
// inside one COARSE x COARSE block. Two regions are linked when a cell of one touches a cell of the
// other, so a chain of linked regions always holds a fine path.
export type CoarseGrid = {
  n: number; // blocks per side
  region: Int32Array; // per cell: its region, from 1; 0 on blocked cells
  block: Int32Array; // per region: its block, row-major over n x n blocks
  x: Float32Array; // per region: centroid in cells
  y: Float32Array;
  slow: Float32Array; // per region: mean slow of its cells
  comp: Int32Array; // per region: its connected component over 8-neighbour steps, from 1
  edgeStart: Int32Array; // per region: first index into edges; edgeStart[r + 1] ends the list
  edges: Int32Array; // linked regions
};

// Its slow also holds the costly cells of breakable props.
export type NavLayer = TerrainNav & {
  id: number; // identity for route cache keys
  radius: number;
  blocked: Uint8Array; // cliffs and bridge rails within reach and static drive obstacles, per cell
  coarse: CoarseGrid;
};

// The static drive obstacles of one obstacles array as blockers, and a bucket index over all of them. Solid
// blockers block cells. Breakable ones make cells costly, and straight line checks treat them as solid, so only
// the grid search decides to drive through one.
export type StaticSet = { key: string; solidKey: string; solid: Blocker[]; costly: Blocker[]; buckets: ObstacleBuckets };

// Road and kill wrecks come and go in play. Every other drive obstacle is fixed at map generation.
export function isTransientWreck(o: Obstacle): boolean {
  return o.kind === 'wreck' && o.id.startsWith('wreck');
}

// Terrains are frozen and shared by world clones, so identity is the key. Dropped terrains free their layers.
// solidGrids: cliff cells plus solid props, and the coarse grid over them, per radius and solid set. Layers share
// them and never write to them.
type SolidGrid = { blocked: Uint8Array; coarse: CoarseGrid };
type TerrainEntry = { nav: TerrainNav; cellCliff: Map<number, Uint8Array>; solidGrids: Map<string, SolidGrid>; layers: Map<string, NavLayer> };
const terrains = new WeakMap<Terrain, TerrainEntry>();
// Per terrain: a few chassis radii times the current static obstacle set. Tests build more sets, so clear when full.
const LAYERS_MAX = 16;
let nextLayerId = 1;

function terrainEntry(t: Terrain) {
  let e = terrains.get(t);
  if (!e) {
    const n = Math.ceil(t.size / CELL);
    const cliffTile = new Uint8Array(t.size * t.size);
    const tileCost = new Float64Array(t.size * t.size);
    const flatCost = new Float64Array(t.size * t.size);
    for (let i = 0; i < t.size * t.size; i++) {
      cliffTile[i] = isCliff(t, i) ? 1 : 0;
      flatCost[i] = routeCost(t.types[i], nearSite((i % t.size) + 0.5, Math.floor(i / t.size) + 0.5));
      tileCost[i] = flatCost[i] * slopeCost(t, i);
    }
    const slow = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) slow[y * n + x] = tileCost[tileIndex(t.size, (x + 0.5) * CELL, (y + 0.5) * CELL)];
    e = { nav: { size: t.size, n, cliffTile, tileCost, flatCost, slow }, cellCliff: new Map(), solidGrids: new Map(), layers: new Map() };
    terrains.set(t, e);
  }
  return e;
}

// Road tiles and the ground next to sites are on the road. Roads meet at site centers, but sites
// block driving, so traffic crosses from one road to the next around the site. Pricing that ground as
// road lets routes leave the road early and round the site, instead of driving head-on at its edge.
// Asphalt patches are loose pieces that lead nowhere, so they count as open ground.
function routeCost(type: TerrainTypeId, bySite: boolean): number {
  return (type === 'road' || bySite ? 1 : REGION.navigation.offRoadCost) / TERRAIN_TYPES[type].speed;
}

// Steeper ground is slower to climb and harder to hold, so routes prefer gentler ground.
function slopeCost(t: Terrain, tile: number): number {
  const s = tileSlope(t, tile);
  return 1 + REGION.navigation.slopeCost * (Math.hypot(s.x, s.y) / TERRAIN.drive.maxSlope) ** 2;
}

// A territory has no edge to keep near.
const SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];

// Within one road width of a site's edge.
function nearSite(x: number, y: number): boolean {
  return SITES.some((s) => siteGap(s, { x, y }) < REGION.roadWidth);
}

export function terrainNav(t: Terrain): TerrainNav {
  return terrainEntry(t).nav;
}

// Same clamping as tileAt.
export function tileIndex(size: number, x: number, y: number): number {
  const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
  return ty * size + tx;
}

// A cliff tile within reach of the point, checked at the point and four compass offsets.
export function nearCliff(nav: TerrainNav, x: number, y: number, reach: number): boolean {
  const c = nav.cliffTile;
  const s = nav.size;
  return c[tileIndex(s, x, y)] === 1 || c[tileIndex(s, x + reach, y)] === 1 || c[tileIndex(s, x - reach, y)] === 1 || c[tileIndex(s, x, y + reach)] === 1 || c[tileIndex(s, x, y - reach)] === 1;
}

// Built once per obstacle list and terrain. The world is cloned every turn, so the list is keyed by each obstacle's
// id and place in order, not by identity. Props break and grow back during play, which changes the list and rebuilds
// the set. A live world and a preview world can alternate, so a few sets stay.
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
  // A hazard zone blocks routes like a rock, but not driving: the player may still go in by hand.
  const all = [...statics.map((o) => driveBlocker(o, terrain)), ...hazardZones().map((z) => ({ pos: z.pos, r: z.radius }))];
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

// Blockers that change during play: road and kill wrecks and the caller's extra circles.
export function dynamicBlockers(obstacles: Obstacle[], terrain: Terrain, extra: Blocker[]): Blocker[] {
  return [...obstacles.filter((o) => isDriveObstacle(o) && isTransientWreck(o)).map((o) => driveBlocker(o, terrain)), ...extra];
}

// A site's edge blocks as a circle. A prop blocks with its blocking boxes, so trucks pass under canopies and over
// whatever lies under a deck.
function driveBlocker(o: Obstacle, terrain: Terrain): Blocker {
  if (o.kind === 'site') return { pos: o.pos, r: o.r };
  return { pos: o.pos, r: propReach(o), prop: { key: propKey(o), boxes: blockingBoxes(o, terrain) } };
}

// Exact content key: number-to-string round-trips, so equal keys mean equal circles, and a prop key names its pose.
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

// Cells too close to a cliff or a bridge rail for a truck of this radius, per radius.
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
    if (nearCliff(nav, cx, cy, reach) || nearRail(cx, cy, reach)) cliff[y * n + x] = 1;
  }
  return cliff;
}

// Blocked cells and the coarse grid over them, per radius and solid set, with the terrain's step costs. Breakable
// props never block, so a prop breaking or growing back keeps this grid and only changes region costs.
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

// The same coarse grid with each region's mean step cost taken from slow.
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

// The terrain's step costs, times BREAKABLE.routeCost on cells a breakable prop would block. A cell near two
// breakable props costs the same as near one.
function costlySlow(nav: TerrainNav, costly: Blocker[], radius: number): Float32Array {
  if (costly.length === 0) return nav.slow;
  const marked = new Uint8Array(nav.n * nav.n);
  stampBlockers(nav.n, costly, radius, (c) => (marked[c] = 1));
  const slow = nav.slow.slice();
  for (let c = 0; c < slow.length; c++) if (marked[c]) slow[c] *= BREAKABLE.routeCost;
  return slow;
}

// Calls mark for every cell whose center lies closer than the vehicle radius plus clearance to a blocker: to a
// circle's edge, or to the ground outline of a prop's box.
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

// Half the width and height of the map-aligned square around a box's outline grown by grow.
function boxExtent(box: PosedBox, grow: number): [number, number] {
  const ax = Math.abs(box.axis.x);
  const ay = Math.abs(box.axis.y);
  return [ax * box.half.x + ay * box.half.y + grow, ay * box.half.x + ax * box.half.y + grow];
}

// Marks the cells within ex and ey tiles of center whose centers pass the test.
function stampWithin(n: number, center: Vec, ex: number, ey: number, inside: (p: Vec) => boolean, mark: (cell: number) => void): void {
  const x0 = Math.max(0, Math.floor((center.x - ex) / CELL));
  const y0 = Math.max(0, Math.floor((center.y - ey) / CELL));
  const x1 = Math.min(n - 1, Math.floor((center.x + ex) / CELL));
  const y1 = Math.min(n - 1, Math.floor((center.y + ey) / CELL));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (inside({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL })) mark(y * n + x);
}

// The connected component of a cell over the 8-neighbour steps A* takes, from 1; 0 on blocked cells.
export function componentOf(layer: NavLayer, cell: number): number {
  const r = layer.coarse.region[cell];
  return r === 0 ? 0 : layer.coarse.comp[r];
}

function coarseGrid(n: number, blocked: Uint8Array, slow: Float32Array): CoarseGrid {
  const bn = Math.ceil(n / COARSE);
  const region = new Int32Array(n * n);
  // Queue entries are block-local: ly * COARSE + lx.
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
      // Most blocks are open ground: one region of all cells, no flood fill needed.
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
  // Touching cells in different regions sit on either side of a block edge, so only those rows and
  // columns are scanned. Each pair of lines is checked straight across and along both diagonals.
  // Along one edge the same pair repeats cell after cell, so a repeat of the last pair is skipped.
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

// Flood fills the region graph. Regions are internally connected, so this equals a flood fill of the cells.
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

// A driver's route taste: a smooth cost field over the map that differs per driver, so drivers
// between the same points take different ways. Value noise on a lattice of points
// REGION.navigation.taste.scale tiles apart, smoothly blended between them. It multiplies route cost
// by 1 - taste.strength / 2 to 1 + taste.strength / 2. Centering it on 1 keeps the A* estimate as tight
// as for a plain route, so a tasted search visits about as many cells.
export type Taste = { seed: number; side: number; values: Float32Array };

// Tastes are pure functions of seed and map size, and every route of a driver asks for its taste. 256 is many
// times the NPC drivers alive at once.
const TASTES_MAX = 256;
const tastes = new Map<string, Taste>();

// The taste of an NPC driver, fixed for its life by the world seed and its id. No driver, the player
// and vehicles without a brain plan plain routes.
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
  return { seed, side, values };
}

// Cost multiplier at map point (x, y) in tiles.
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

// A step cost scaled by the taste at map point (x, y), or unchanged without a taste.
export function tasted(t: Taste | null, cost: number, x: number, y: number): number {
  return t ? cost * tasteAt(t, x, y) : cost;
}

// The part of a route cache key that tells tastes apart.
export function tasteKey(t: Taste | null): string {
  return t ? String(t.seed) : 'plain';
}

function smooth(f: number): number {
  return f * f * (3 - 2 * f);
}
