
import { TERRAIN, type Basin } from '../data/terrain';
import { REGION } from '../data/region';
import { bridgeCut, ICARUS_DECKS } from './bridge';
import { INDEX_CELL, ROAD_INDEX, RoadIndex } from './road-index';
import { heightFromElevation } from './terrain';
import { clamp, lerp, pointInPolygon, type Vec } from './vec';

const SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
const SITE_SKIP2 = SITES.map((site) => (site.radius + TERRAIN.flattenMargin + 1) ** 2);
const FEATURES = [TERRAIN.features.canyon, TERRAIN.features.dryRiver, TERRAIN.features.trench, TERRAIN.features.furrow].map((feature) => ({
  feature,
  index: new RoadIndex([feature.path], INDEX_CELL),
  reach: feature.width + feature.bank,
}));
const FLATTEN_REACH = REGION.roadWidth / 2 + TERRAIN.flattenMargin;

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let total = 0;
  for (const o of TERRAIN.octaves) {
    sum += noise2(x * o.freq, y * o.freq, seed + o.seedOffset) * o.amp;
    total += o.amp;
  }
  return sum / total;
}

export function noiseAt(seed: number, x: number, y: number): number {
  return noise2(x, y, seed + NOISE_SEED_OFFSET);
}

const NOISE_SEED_OFFSET = 7919;

function rawElevation(seed: number, x: number, y: number): number {
  return fbm(x, y, seed) * 2 - 1;
}

export function flattenFactor(x: number, y: number): number {
  let best = ROAD_INDEX.nearestWithin(x, y, FLATTEN_REACH) - REGION.roadWidth / 2;
  for (let k = 0; k < SITES.length; k++) {
    const site = SITES[k];
    const dx = site.pos.x - x;
    const dy = site.pos.y - y;
    if (dx * dx + dy * dy > SITE_SKIP2[k]) continue;
    best = Math.min(best, Math.hypot(dx, dy) - site.radius);
  }
  return flattenFalloff(best);
}

export function flattenFalloff(gap: number, margin: number = TERRAIN.flattenMargin): number {
  if (gap <= 0) return 1;
  if (gap >= margin) return 0;
  return 1 - smooth(gap / margin);
}

let levels: { seed: number; values: number[] } | undefined;

function siteLevels(seed: number): number[] {
  if (levels?.seed !== seed) {
    const relief = TERRAIN.relief;
    const values = SITES.map((site) => (noise2(site.pos.x * relief.broadFrequency, site.pos.y * relief.broadFrequency, seed + 4000) - 0.5) * relief.broadAmplitude);
    levels = { seed, values };
  }
  return levels.values;
}

export function elevationAt(seed: number, x: number, y: number): number {
  const height = reliefAt(seed, x, y) * (1 - flattenFactor(x, y) * (1 - bridgeCut(ICARUS_DECKS, x, y)));
  return bowls(height + rollingAt(seed, x, y), x, y);
}

export function reliefAt(seed: number, x: number, y: number): number {
  let height = noiseRelief(seed, x, y) * (1 - floorOwned(x, y));
  for (const { feature, index, reach } of FEATURES) {
    const gap = index.nearestWithin(x, y, reach) - feature.width;
    if (gap < feature.bank) height -= feature.depth * (gap <= 0 ? 1 : 1 - smooth(gap / feature.bank));
  }
  return height;
}

export function broadAt(seed: number, x: number, y: number): number {
  return bowls(rollingAt(seed, x, y), x, y);
}

function noiseRelief(seed: number, x: number, y: number): number {
  const relief = TERRAIN.relief;
  const ridges = Math.abs(noise2(x * relief.ridgeFrequency, y * relief.ridgeFrequency, seed + 5000) - 0.5) * relief.ridgeAmplitude;
  return rawElevation(seed, x, y) + ridges;
}

function rollingAt(seed: number, x: number, y: number): number {
  const rolling = siteRolling(seed, x, y);
  let owned = 0;
  let level = 0;
  for (const b of TERRAIN.features.basins) {
    const share = basinShare(b, x, y);
    if (share === 0) continue;
    owned += share;
    level += share * floorLevel(seed, b);
  }
  return owned === 0 ? rolling : rolling * (1 - owned) + level;
}

function siteRolling(seed: number, x: number, y: number): number {
  const relief = TERRAIN.relief;
  let rolling = (noise2(x * relief.broadFrequency, y * relief.broadFrequency, seed + 4000) - 0.5) * relief.broadAmplitude;
  for (let k = 0; k < SITES.length; k++) {
    const site = SITES[k];
    const dx = site.pos.x - x;
    const dy = site.pos.y - y;
    if (dx * dx + dy * dy > SITE_SKIP2[k]) continue;
    const gap = Math.hypot(dx, dy) - site.radius;
    if (gap >= TERRAIN.flattenMargin) continue;
    const level = siteLevels(seed)[k];
    const blend = gap <= 0 ? 1 : 1 - smooth(gap / TERRAIN.flattenMargin);
    rolling += (level - rolling) * blend;
  }
  return rolling;
}

function bowls(elevation: number, x: number, y: number): number {
  let out = elevation;
  for (const crater of TERRAIN.features.craters) out -= bowl(crater.center, crater.radius, crater.bank, crater.depth, x, y);
  let rise = 0;
  for (const b of TERRAIN.features.basins) {
    const shape = basin(b, x, y);
    out -= shape.cut;
    rise += shape.rise;
  }
  for (const mound of TERRAIN.features.mounds) rise += bowl(mound.center, mound.radius, mound.bank, mound.height, x, y);
  return rise > 0 ? raised(out, rise) : out;
}

function floorOwned(x: number, y: number): number {
  let owned = 0;
  for (const b of TERRAIN.features.basins) owned += basinShare(b, x, y);
  return owned;
}

function basinShare(b: Basin, x: number, y: number): number {
  const floor = basinFloor(b);
  if (!inBox(floor, x, y)) return 0;
  const { gap, edge, along } = nearestEdge(floor.poly, { x, y });
  return floorShare(gap, lerp(b.bank[edge], b.bank[(edge + 1) % floor.poly.length], along));
}

const FLOOR_LEVELS = new WeakMap<Basin, { seed: number; level: number }>();
function floorLevel(seed: number, b: Basin): number {
  let held = FLOOR_LEVELS.get(b);
  if (held?.seed !== seed) {
    held = { seed, level: noiseRelief(seed, b.center.x, b.center.y) + siteRolling(seed, b.center.x, b.center.y) };
    FLOOR_LEVELS.set(b, held);
  }
  return held.level;
}

const BASIN_RELIEF_SEED = 6000;

type BasinFloor = { poly: Vec[]; min: Vec; max: Vec };
const BASIN_FLOORS = new WeakMap<Basin, BasinFloor>();
function basinFloor(b: Basin): BasinFloor {
  let floor = BASIN_FLOORS.get(b);
  if (!floor) {
    floor = floorOnMap(b);
    BASIN_FLOORS.set(b, floor);
  }
  return floor;
}

function floorOnMap(b: Basin): BasinFloor {
  const n = b.floor.length;
  if (n < 3 || b.bank.length !== n || b.rim.length !== n) {
    throw new Error(`A basin needs a bank and a rim for each of its 3 or more floor points, got ${n}, ${b.bank.length} and ${b.rim.length}`);
  }
  const poly = b.floor.map((p) => ({ x: b.center.x + p.x, y: b.center.y + p.y }));
  const reach = 2 * Math.max(...b.bank) + 1;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { poly, min: { x: Math.min(...xs) - reach, y: Math.min(...ys) - reach }, max: { x: Math.max(...xs) + reach, y: Math.max(...ys) + reach } };
}

function inBox(f: BasinFloor, x: number, y: number): boolean {
  return x >= f.min.x && y >= f.min.y && x <= f.max.x && y <= f.max.y;
}

export function basin(b: Basin, x: number, y: number): { cut: number; rise: number } {
  const floor = basinFloor(b);
  if (!inBox(floor, x, y)) return { cut: 0, rise: 0 };
  const { gap, edge, along } = nearestEdge(floor.poly, { x, y });
  const next = (edge + 1) % floor.poly.length;
  const bank = lerp(b.bank[edge], b.bank[next], along);
  if (gap >= 2 * bank) return { cut: 0, rise: 0 };
  const deep = floorShare(gap, bank);
  return { cut: b.depth * deep, rise: lerp(b.rim[edge], b.rim[next], along) * lipShare(gap, bank) + swell(b, x, y) * deep };
}

function nearestEdge(poly: readonly Vec[], p: Vec): { gap: number; edge: number; along: number } {
  let best = { d: Infinity, edge: 0, along: 0 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const along = clamp(((p.x - a.x) * (c.x - a.x) + (p.y - a.y) * (c.y - a.y)) / ((c.x - a.x) ** 2 + (c.y - a.y) ** 2), 0, 1);
    const d = Math.hypot(p.x - lerp(a.x, c.x, along), p.y - lerp(a.y, c.y, along));
    if (d < best.d) best = { d, edge: i, along };
  }
  return { gap: pointInPolygon(p, poly) ? -best.d : best.d, edge: best.edge, along: best.along };
}

function floorShare(gap: number, bank: number): number {
  if (gap <= 0) return 1;
  if (gap >= bank) return 0;
  return 1 - smooth(gap / bank);
}

function lipShare(gap: number, bank: number): number {
  if (gap <= 0 || gap >= 2 * bank) return 0;
  if (gap <= bank) return smooth(gap / bank);
  return 1 - smooth((gap - bank) / bank);
}

function swell(b: Basin, x: number, y: number): number {
  const { frequency, amplitude } = b.floorRelief;
  return noise2(x * frequency, y * frequency, BASIN_RELIEF_SEED + Math.round(b.center.x) * 1009 + Math.round(b.center.y)) * amplitude;
}

function bowl(center: Vec, radius: number, bank: number, size: number, x: number, y: number): number {
  const dx = center.x - x;
  const dy = center.y - y;
  if (dx * dx + dy * dy > (radius + bank + 1) ** 2) return 0;
  const gap = Math.hypot(dx, dy) - radius;
  if (gap >= bank) return 0;
  return size * (gap <= 0 ? 1 : 1 - smooth(gap / bank));
}

function raised(elevation: number, rise: number): number {
  const target = heightFromElevation(elevation) + rise;
  let low = elevation;
  let high = elevation + rise / TERRAIN.height.hill;
  for (let k = 0; k < 40; k++) {
    const mid = (low + high) / 2;
    if (heightFromElevation(mid) < target) low = mid;
    else high = mid;
  }
  return high;
}
