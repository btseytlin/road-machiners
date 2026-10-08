// Deterministic elevation noise derived from a seed, not the seeded rng. It only seeds the
// terrain grid in sim/terrain.ts and the map bake in mapgen/; everything else reads that grid.
// Flattened near roads, towns and locations so they stay drivable, except in the gap under Canyon Bridge.

import { TERRAIN } from '../data/terrain';
import { REGION } from '../data/region';
import { bridgeCut } from './bridge';
import { INDEX_CELL, ROAD_INDEX, RoadIndex } from './road-index';

const SITES = [...REGION.towns, ...REGION.locations];
const SITE_SKIP2 = SITES.map((site) => (site.radius + TERRAIN.flattenMargin + 1) ** 2);
const FEATURES = [TERRAIN.features.canyon, TERRAIN.features.dryRiver].map((feature) => ({
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

export function flattenFalloff(gap: number): number {
  if (gap <= 0) return 1;
  if (gap >= TERRAIN.flattenMargin) return 0;
  return 1 - smooth(gap / TERRAIN.flattenMargin);
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
  const height = reliefAt(seed, x, y) * (1 - flattenFactor(x, y) * (1 - bridgeCut(x, y)));
  return cratered(height + rollingAt(seed, x, y), x, y);
}

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

export function broadAt(seed: number, x: number, y: number): number {
  return cratered(rollingAt(seed, x, y), x, y);
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

function cratered(height: number, x: number, y: number): number {
  let out = height;
  for (const crater of TERRAIN.features.craters) {
    const dx = crater.center.x - x;
    const dy = crater.center.y - y;
    if (dx * dx + dy * dy > (crater.radius + crater.bank + 1) ** 2) continue;
    const gap = Math.hypot(dx, dy) - crater.radius;
    if (gap < crater.bank) out -= crater.depth * (gap <= 0 ? 1 : 1 - smooth(gap / crater.bank));
  }
  return out;
}
