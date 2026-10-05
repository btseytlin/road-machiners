// Deterministic elevation noise derived from a seed, not the seeded rng. It only seeds the
// terrain grid in sim/terrain.ts and the map bake in mapgen/; everything else reads that grid.
// Flattened near roads, towns and locations so they stay drivable, except in the gap under Canyon Bridge.
// Crater bowls and mounds come after flattening, so roads keep them.

import { TERRAIN } from '../data/terrain';
import { REGION } from '../data/region';
import { bridgeCut } from './bridge';
import { INDEX_CELL, ROAD_INDEX, RoadIndex } from './road-index';
import { heightFromElevation } from './terrain';
import type { Vec } from './vec';

// Territories keep their own ground: nothing flattens them.
const SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
// Squared distance past which a site is sure to lie beyond flattenMargin. The extra tile keeps
// the cheap test clear of rounding, so the exact test decides every near case.
const SITE_SKIP2 = SITES.map((site) => (site.radius + TERRAIN.flattenMargin + 1) ** 2);
const FEATURES = [TERRAIN.features.canyon, TERRAIN.features.dryRiver, TERRAIN.features.trench].map((feature) => ({
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

// 1 on a road or site, falling smoothly to 0 at margin, flattenMargin unless the caller has its own. gap is the
// distance past its edge.
export function flattenFalloff(gap: number, margin: number = TERRAIN.flattenMargin): number {
  if (gap <= 0) return 1;
  if (gap >= margin) return 0;
  return 1 - smooth(gap / margin);
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

// Unflattened elevation noise, ridges and the channels: the canyon, the dry river and Broken Wing's trench.
export function reliefAt(seed: number, x: number, y: number): number {
  const relief = TERRAIN.relief;
  const ridges = Math.abs(noise2(x * relief.ridgeFrequency, y * relief.ridgeFrequency, seed + 5000) - 0.5) * relief.ridgeAmplitude;
  let height = rawElevation(seed, x, y) + ridges;
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

function rollingAt(seed: number, x: number, y: number): number {
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

// The elevation with every crater bowl cut into it and every mound raised on it. A mound is a crater turned up,
// but its height is in height units, so it stands as tall over a hill as over a plain.
function bowls(elevation: number, x: number, y: number): number {
  let out = elevation;
  for (const crater of TERRAIN.features.craters) out -= bowl(crater.center, crater.radius, crater.bank, crater.depth, x, y);
  let rise = 0;
  for (const mound of TERRAIN.features.mounds) rise += bowl(mound.center, mound.radius, mound.bank, mound.height, x, y);
  return rise > 0 ? raised(out, rise) : out;
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
