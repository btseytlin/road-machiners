// Deterministic elevation noise derived from a seed, not the seeded rng. It only seeds the
// terrain grid in sim/terrain.ts and the map bake in mapgen/; everything else reads that grid.
// Flattened near roads, towns and locations so they stay drivable, except in the gap under Canyon Bridge.
// Crater bowls, basins and mounds come after flattening, so roads keep them.

import { TERRAIN, type Basin } from '../data/terrain';
import { REGION } from '../data/region';
import { bridgeCut } from './bridge';
import { INDEX_CELL, ROAD_INDEX, RoadIndex } from './road-index';
import { heightFromElevation } from './terrain';
import { clamp, lerp, pointInPolygon, type Vec } from './vec';

// Territories keep their own ground: nothing flattens them.
const SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
// Squared distance past which a site is sure to lie beyond flattenMargin. The extra tile keeps
// the cheap test clear of rounding, so the exact test decides every near case.
const SITE_SKIP2 = SITES.map((site) => (site.radius + TERRAIN.flattenMargin + 1) ** 2);
const FEATURES = [TERRAIN.features.canyon, TERRAIN.features.dryRiver, TERRAIN.features.trench, TERRAIN.features.furrow].map((feature) => ({
  feature,
  index: new RoadIndex([feature.path], INDEX_CELL),
  reach: feature.width + feature.bank,
}));
// Road distances beyond this flatten nothing.
const FLATTEN_REACH = REGION.roadWidth / 2 + TERRAIN.flattenMargin;

// Own hash, independent of render/noise.ts (render-only) and sim/rng.ts (consumes world.rngState).
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

// Fractal sum of a few octaves, in [0, 1].
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let total = 0;
  for (const o of TERRAIN.octaves) {
    sum += noise2(x * o.freq, y * o.freq, seed + o.seedOffset) * o.amp;
    total += o.amp;
  }
  return sum / total;
}

// Plain value noise in [0, 1] for secondary patterns like scrub patches.
export function noiseAt(seed: number, x: number, y: number): number {
  return noise2(x, y, seed + NOISE_SEED_OFFSET);
}

const NOISE_SEED_OFFSET = 7919; // keeps secondary noise independent of the elevation octaves

function rawElevation(seed: number, x: number, y: number): number {
  return fbm(x, y, seed) * 2 - 1;
}

// 0 = untouched terrain, 1 = fully flattened, based on distance to the nearest road, town or location.
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

// 1 on a road or site, falling smoothly to 0 at flattenMargin. gap is the distance past its edge.
export function flattenFalloff(gap: number): number {
  if (gap <= 0) return 1;
  if (gap >= TERRAIN.flattenMargin) return 0;
  return 1 - smooth(gap / TERRAIN.flattenMargin);
}

// Broad rolling height at each site center. Holds one seed, the one terrain generation is using.
let levels: { seed: number; values: number[] } | undefined;

function siteLevels(seed: number): number[] {
  if (levels?.seed !== seed) {
    const relief = TERRAIN.relief;
    const values = SITES.map((site) => (noise2(site.pos.x * relief.broadFrequency, site.pos.y * relief.broadFrequency, seed + 4000) - 0.5) * relief.broadAmplitude);
    levels = { seed, values };
  }
  return levels.values;
}

// Terrain elevation as the game builds it today: relief flattened near roads and sites, plus the broad
// rolling height with its craters.
export function elevationAt(seed: number, x: number, y: number): number {
  const height = reliefAt(seed, x, y) * (1 - flattenFactor(x, y) * (1 - bridgeCut(x, y)));
  // Roads retain broad grades; only their small bumps and channel crossings are smoothed.
  return bowls(height + rollingAt(seed, x, y), x, y);
}

// Unflattened elevation noise, ridges and the channels: the canyon, the dry river, Broken Wing's trench and the Fallen
// Sun's furrow. A basin owns its floor, so the noise and ridges fade out across its bank and the floor takes its level
// from the rolling height instead (see floorLevel()).
export function reliefAt(seed: number, x: number, y: number): number {
  let height = noiseRelief(seed, x, y) * (1 - floorOwned(x, y));
  for (const { feature, index, reach } of FEATURES) {
    const gap = index.nearestWithin(x, y, reach) - feature.width;
    if (gap < feature.bank) height -= feature.depth * (gap <= 0 ? 1 : 1 - smooth(gap / feature.bank));
  }
  return height;
}

// Broad rolling elevation, held at each site's own level near the site, with the craters cut in and the mounds raised.
// Flattening never touches it.
export function broadAt(seed: number, x: number, y: number): number {
  return bowls(rollingAt(seed, x, y), x, y);
}

// The elevation noise and ridges, before any channel.
function noiseRelief(seed: number, x: number, y: number): number {
  const relief = TERRAIN.relief;
  const ridges = Math.abs(noise2(x * relief.ridgeFrequency, y * relief.ridgeFrequency, seed + 5000) - 0.5) * relief.ridgeAmplitude;
  return rawElevation(seed, x, y) + ridges;
}

// The broad rolling height, held at each site's level near a site, and at a basin's floor level across its floor.
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

// The elevation with every crater bowl and basin cut into it and every mound, basin rim and floor swell raised on it.
// A mound is a crater turned up, but its height is in height units, so it stands as tall over a hill as over a plain.
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

// The share of the land a basin owns at a point: 1 on its floor, fading to 0 at the top of its bank. Basins never
// overlap, so the shares of all basins add up to 1 at most.
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

// The level a basin's floor is blended to, in elevation units before its cut: the land at its centre, noise, ridges
// and rolling height together, so the floor is one level plus its own swells, whatever hills the land held there.
// Held per seed, the one terrain generation is using.
const FLOOR_LEVELS = new WeakMap<Basin, { seed: number; level: number }>();
function floorLevel(seed: number, b: Basin): number {
  let held = FLOOR_LEVELS.get(b);
  if (held?.seed !== seed) {
    held = { seed, level: noiseRelief(seed, b.center.x, b.center.y) + siteRolling(seed, b.center.x, b.center.y) };
    FLOOR_LEVELS.set(b, held);
  }
  return held.level;
}

// Keeps each basin's floor swells on their own part of the hash space.
const BASIN_RELIEF_SEED = 6000;

// Each basin's floor on the map, and the box past which it changes nothing: the lip falls back to the land over a
// second bank, so the box reaches two of its largest banks past the floor, plus a tile for rounding.
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

// What a basin does to the land at a point: cut is elevation units taken away, rise is height units raised on top.
// Inside the floor the cut is the full depth, plus the floor swells. Out from the floor edge the cut falls away over
// the bank while the lip climbs to the rim, so the inner face climbs depth and rim together, and the lip then falls
// back to the land over another bank. Bank and rim blend along the nearest floor edge between its two vertices.
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

// Tiles from a closed polygon's nearest edge, negative inside, with that edge's index and the share of the way along
// it to the nearest point.
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

// 1 on the floor, falling smoothly to 0 at the top of the bank.
function floorShare(gap: number, bank: number): number {
  if (gap <= 0) return 1;
  if (gap >= bank) return 0;
  return 1 - smooth(gap / bank);
}

// 0 at the floor edge, rising to 1 at the top of the bank and falling back to 0 a bank further out.
function lipShare(gap: number, bank: number): number {
  if (gap <= 0 || gap >= 2 * bank) return 0;
  if (gap <= bank) return smooth(gap / bank);
  return 1 - smooth((gap - bank) / bank);
}

// The floor swells, from 0 to the basin's amplitude in height units. Each basin samples its own part of the hash space.
function swell(b: Basin, x: number, y: number): number {
  const { frequency, amplitude } = b.floorRelief;
  return noise2(x * frequency, y * frequency, BASIN_RELIEF_SEED + Math.round(b.center.x) * 1009 + Math.round(b.center.y)) * amplitude;
}

// A bowl's full size inside its radius, falling smoothly to 0 over its bank.
function bowl(center: Vec, radius: number, bank: number, size: number, x: number, y: number): number {
  const dx = center.x - x;
  const dy = center.y - y;
  // One tile past the bank keeps this cheap skip clear of rounding.
  if (dx * dx + dy * dy > (radius + bank + 1) ** 2) return 0;
  const gap = Math.hypot(dx, dy) - radius;
  if (gap >= bank) return 0;
  return size * (gap <= 0 ? 1 : 1 - smooth(gap / bank));
}

// The elevation whose height stands `rise` height units over the height of `elevation`. heightFromElevation()
// climbs at least TERRAIN.height.hill per elevation unit, so the answer lies within rise / hill above, and
// halving finds it to far below a millimetre.
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
