// New-world layer: what squatters and weather made of the old world since, placed by rules from terrain,
// water, today's sites and roads and the old world's props and marks. It reads the draft after the old
// world. It marks pool and scrub tiles in d.built and appends shacks, fence segments, junk piles and car

import { REGION } from '../data/region';
import {
  GEOLOGY,
  NEW_WORLD,
  TERRAIN,
  type CampRules,
  type CarWreckRules,
  type FieldFenceRules,
  type PoolRules,
  type ScrubRules,
} from '../data/terrain';
import { chance, randInt, randRange, type Rng } from '../sim/rng';
import { isTerritory, territoryRoads } from '../sim/territory';
import type { BakedProp, PropKind } from '../sim/terrain';
import { DEG, dist, polylineDist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';
import { pondDepths } from './geology';
import {
  BUILT_FIELD,
  BUILT_NONE,
  BUILT_OLD_ROAD,
  builtGround,
  clearGround,
  facing,
  isCutTile,
  offset,
  place,
  prop,
  range,
  RoadLine,
  roadJunctions,
  ruleRng,
  sideOf,
  stations,
  tileCenter,
  tileOf,
  tilesWithin,
} from './oldworld';

export const BUILT_SCRUB = 3;
export const BUILT_DIRTY_WATER = 4;
export const BUILT_TOXIC = 5;
export const BUILT_TRACK = 6;
export const BUILT_CANAL = 7;
export const BUILT_PAD = 8;
export const BUILT_GLASS = 9;

export type Camp = { pos: Vec; radius: number };

export function newWorldLayer(seed: number, d: MapDraft): MapDraft {
  const W = NEW_WORLD;
  pools(d, W.pools);
  scrubGrowth(seed, d, W.scrub);
  const settled = camps(seed, d, W.camps);
  fieldFences(seed, d, W.fieldFences);
  carWrecks(seed, d, settled, W.carWrecks);
  return d;
}

const HALF = REGION.roadWidth / 2;
const O = REGION.obstacles;
const TURN = Math.PI * 2;
const FENCE_R = NEW_WORLD.fenceLength / 2;
const CHANNELS = [TERRAIN.features.canyon, TERRAIN.features.dryRiver];
const INDUSTRY: ReadonlySet<PropKind> = new Set(['gasStation', 'tank', 'silo']);

function isPool(code: number): boolean {
  return code === BUILT_DIRTY_WATER || code === BUILT_TOXIC;
}

const SPURS = REGION.locations.filter(isTerritory).flatMap((t) => territoryRoads(t).spurs);

function onSpur(p: BakedProp): boolean {
  return SPURS.some((s) => polylineDist(p.pos, s.points) < s.width / 2 + p.r + O.gap);
}

function settle(d: MapDraft, p: BakedProp, roadGap: number): boolean {
  if (isPool(d.built[tileOf(d.size, p.pos)]) || onSpur(p)) return false;
  return place(d, p, roadGap);
}

function settleFence(d: MapDraft, p: BakedProp, roadGap: number): boolean {
  if (!clearGround(d.size, p.pos, p.r, roadGap) || isPool(d.built[tileOf(d.size, p.pos)])) return false;
  if (tileSteepness(d.heights, d.size, tileOf(d.size, p.pos)) > TERRAIN.drive.maxSlope) return false;
  if (d.props.some((o) => !sameLine(o, p) && dist(o.pos, p.pos) < o.r + p.r + O.gap)) return false;
  d.props.push(p);
  return true;
}

function sameLine(a: BakedProp, b: BakedProp): boolean {
  return a.kind === 'fence' && b.kind === 'fence' && a.group === b.group;
}

function nextFenceGroup(d: MapDraft): number {
  return d.props.reduce((top, p) => (p.kind === 'fence' ? Math.max(top, p.group) : top), 0) + 1;
}

function scatter(d: MapDraft, rng: Rng, center: Vec, [near, far]: readonly [number, number], make: (pos: Vec) => BakedProp, tries: number): void {
  for (let t = 0; t < tries; t++) {
    const a = randRange(rng, 0, TURN);
    const at = near + (far - near) * Math.sqrt(randRange(rng, 0, 1));
    if (settle(d, make({ x: center.x + Math.cos(a) * at, y: center.y + Math.sin(a) * at }), 0)) return;
  }
}

function cornerMax(a: ArrayLike<number>, size: number, tile: number): number {
  const w = size + 1;
  const k = Math.floor(tile / size) * w + (tile % size);
  return Math.max(a[k], a[k + 1], a[k + w], a[k + w + 1]);
}

function cornerMean(a: ArrayLike<number>, size: number, tile: number): number {
  const w = size + 1;
  const k = Math.floor(tile / size) * w + (tile % size);
  return (a[k] + a[k + 1] + a[k + w] + a[k + w + 1]) / 4;
}

function patches(size: number, mask: Uint8Array): number[][] {
  const seen = new Uint8Array(size * size);
  const out: number[][] = [];
  for (let tile = 0; tile < mask.length; tile++) {
    if (mask[tile] && !seen[tile]) out.push(floodPatch(size, mask, seen, tile));
  }
  return out;
}

function floodPatch(size: number, mask: Uint8Array, seen: Uint8Array, from: number): number[] {
  const patch = [from];
  seen[from] = 1;
  for (let k = 0; k < patch.length; k++) {
    for (const next of edgeNeighbors(size, patch[k])) {
      if (!mask[next] || seen[next]) continue;
      seen[next] = 1;
      patch.push(next);
    }
  }
  return patch;
}

function edgeNeighbors(size: number, tile: number): number[] {
  const x = tile % size;
  const out: number[] = [];
  if (x > 0) out.push(tile - 1);
  if (x < size - 1) out.push(tile + 1);
  if (tile >= size) out.push(tile - size);
  if (tile < size * (size - 1)) out.push(tile + size);
  return out;
}

export function pools(d: MapDraft, rules: PoolRules): void {
  const industry = d.props.filter((p) => INDUSTRY.has(p.kind));
  for (const basin of patches(d.size, standingWater(d, rules))) {
    if (basin.length > rules.maxTiles || !basin.every((tile) => poolable(d, tile))) continue;
    const code = nearIndustry(d, basin, industry, rules) ? BUILT_TOXIC : BUILT_DIRTY_WATER;
    for (const tile of basin) d.built[tile] = code;
  }
}

function standingWater(d: MapDraft, rules: PoolRules): Uint8Array {
  const pond = pondDepths(d.heights, d.size, GEOLOGY.ground.lakeDepth);
  const wet = new Uint8Array(d.size * d.size);
  for (let tile = 0; tile < wet.length; tile++) wet[tile] = cornerMax(pond, d.size, tile) >= rules.minDepth ? 1 : 0;
  return wet;
}

function poolable(d: MapDraft, tile: number): boolean {
  const c = tileCenter(d.size, tile);
  if (d.built[tile] !== BUILT_NONE || builtGround(c)) return false;
  return CHANNELS.every((ch) => polylineDist(c, ch.path) > ch.width + ch.bank / 2);
}

function nearIndustry(d: MapDraft, basin: number[], industry: BakedProp[], rules: PoolRules): boolean {
  return basin.some((tile) => industry.some((p) => dist(tileCenter(d.size, tile), p.pos) <= p.r + rules.toxicReach));
}

export function scrubGrowth(seed: number, d: MapDraft, rules: ScrubRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  const grow = growChances(d, rules);
  const scrub = scrubSeeds(d, rng, rules, grow);
  for (const tile of scrub) d.built[tile] = BUILT_SCRUB;
  for (let step = 0; step < rules.steps; step++) spreadScrub(d, rng, grow, scrub);
}

function growChances(d: MapDraft, rules: ScrubRules): Float32Array {
  const grow = new Float32Array(d.size * d.size);
  for (let tile = 0; tile < grow.length; tile++) grow[tile] = growable(d, tile) ? growChance(d, rules, tile) : 0;
  return grow;
}

function growable(d: MapDraft, tile: number): boolean {
  if (d.built[tile] !== BUILT_NONE || isCutTile(d, tile) || builtGround(tileCenter(d.size, tile))) return false;
  if (tileSteepness(d.heights, d.size, tile) >= TERRAIN.types.screeSlope || cornerMax(d.slumped, d.size, tile) > 0) return false;
  return cornerMean(d.sand, d.size, tile) < GEOLOGY.ground.looseSand;
}

function growChance(d: MapDraft, rules: ScrubRules, tile: number): number {
  const flat = 1 - tileSteepness(d.heights, d.size, tile) / TERRAIN.types.screeSlope;
  const wet = Math.min(1, wetness(d, rules, tile));
  return rules.spread * flat * (rules.dryShare + (1 - rules.dryShare) * wet);
}

function wetness(d: MapDraft, rules: ScrubRules, tile: number): number {
  return cornerMax(d.flow, d.size, tile) / (GEOLOGY.ground.washFlow * rules.seedFlow);
}

function scrubSeeds(d: MapDraft, rng: Rng, rules: ScrubRules, grow: Float32Array): number[] {
  const moist = moistNearWater(d, rules);
  const out: number[] = [];
  for (let tile = 0; tile < grow.length; tile++) {
    const wet = moist[tile] === 1 || wetness(d, rules, tile) >= 1;
    if (grow[tile] > 0 && wet && chance(rng, rules.seedChance)) out.push(tile);
  }
  return out;
}

function moistNearWater(d: MapDraft, rules: ScrubRules): Uint8Array {
  const moist = new Uint8Array(d.size * d.size);
  d.built.forEach((code, tile) => {
    if (isPool(code)) for (const t of tilesWithin(d.size, tileCenter(d.size, tile), rules.poolReach)) moist[t] = 1;
  });
  for (const oasis of REGION.locations.filter((l) => l.kind === 'oasis')) {
    for (const t of tilesWithin(d.size, oasis.pos, oasis.radius + O.siteClearance + rules.oasisReach)) moist[t] = 1;
  }
  return moist;
}

function spreadScrub(d: MapDraft, rng: Rng, grow: Float32Array, scrub: number[]): void {
  const taken: number[] = [];
  for (const tile of scrub) {
    for (const next of edgeNeighbors(d.size, tile)) {
      if (d.built[next] === BUILT_NONE && grow[next] > 0 && chance(rng, grow[next])) {
        d.built[next] = BUILT_SCRUB;
        taken.push(next);
      }
    }
  }
  scrub.push(...taken);
}

export function camps(seed: number, d: MapDraft, rules: CampRules): Camp[] {
  const rng = ruleRng(seed, rules.seedOffset);
  const spots = [...siteCampSpots(d, rng, rules), ...ruinCampSpots(d, rng, rules), ...junctionCampSpots(d, rng, rules)];
  const out: Camp[] = [];
  for (const pos of spots) {
    if (out.some((c) => dist(c.pos, pos) < rules.spacing)) continue;
    const camp = { pos, radius: rules.radius };
    buildCamp(d, rng, rules, camp);
    out.push(camp);
  }
  return out;
}

function siteCampSpots(d: MapDraft, rng: Rng, rules: CampRules): Vec[] {
  const sites = [...REGION.towns, ...REGION.locations.filter((l) => l.kind === 'oasis')];
  return sites
    .filter(() => chance(rng, rules.siteChance))
    .map((s) => {
      const ring = s.radius + O.siteClearance + rules.siteGap + rules.radius;
      return spotAround(d, rng, rules, s.pos, [ring, ring]);
    })
    .filter((p): p is Vec => p !== null);
}

function ruinCampSpots(d: MapDraft, rng: Rng, rules: CampRules): Vec[] {
  return houseClusters(d, rules)
    .filter(() => chance(rng, rules.ruinChance))
    .map((cluster) => ({ x: mean(cluster.map((p) => p.pos.x)), y: mean(cluster.map((p) => p.pos.y)) }))
    .filter((pos) => campGround(d, rules, pos));
}

function junctionCampSpots(d: MapDraft, rng: Rng, rules: CampRules): Vec[] {
  const near = HALF + rules.roadGap + rules.radius;
  return roadJunctions()
    .filter(() => chance(rng, rules.junctionChance))
    .map((j) => spotAround(d, rng, rules, j, [near, near + rules.junctionReach]))
    .filter((p): p is Vec => p !== null);
}

function spotAround(d: MapDraft, rng: Rng, rules: CampRules, center: Vec, [near, far]: readonly [number, number]): Vec | null {
  for (let t = 0; t < rules.tries; t++) {
    const a = randRange(rng, 0, TURN);
    const at = randRange(rng, near, far);
    const pos = { x: center.x + Math.cos(a) * at, y: center.y + Math.sin(a) * at };
    if (campGround(d, rules, pos)) return pos;
  }
  return null;
}

function campGround(d: MapDraft, rules: CampRules, pos: Vec): boolean {
  if (!clearGround(d.size, pos, rules.radius, rules.roadGap)) return false;
  const tile = tileOf(d.size, pos);
  return tileSteepness(d.heights, d.size, tile) <= rules.flatSlope && !isPool(d.built[tile]);
}

function houseClusters(d: MapDraft, rules: CampRules): BakedProp[][] {
  const houses = d.props.filter((p) => p.kind === 'house' || p.kind === 'ruin');
  const seen = new Set<BakedProp>();
  const out: BakedProp[][] = [];
  for (const house of houses) {
    if (seen.has(house)) continue;
    const cluster = gatherCluster(houses, seen, house, rules.clusterReach);
    if (cluster.length >= rules.clusterMin) out.push(cluster);
  }
  return out;
}

function gatherCluster(houses: BakedProp[], seen: Set<BakedProp>, from: BakedProp, reach: number): BakedProp[] {
  const cluster = [from];
  seen.add(from);
  for (let k = 0; k < cluster.length; k++) {
    for (const other of houses.filter((h) => !seen.has(h) && dist(h.pos, cluster[k].pos) <= reach)) {
      seen.add(other);
      cluster.push(other);
    }
  }
  return cluster;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function buildCamp(d: MapDraft, rng: Rng, rules: CampRules, camp: Camp): void {
  const inner = camp.radius - rules.innerGap;
  const shacks = randInt(rng, rules.shacks[0], rules.shacks[1]);
  for (let k = 0; k < shacks; k++) campProp(d, rng, rules, camp.pos, 'shack', range(rng, rules.shackRadius), inner);
  const junk = randInt(rng, rules.junk[0], rules.junk[1]);
  for (let k = 0; k < junk; k++) campProp(d, rng, rules, camp.pos, 'junk', range(rng, rules.junkRadius), inner);
  campFence(d, rng, rules, camp);
}

function campProp(d: MapDraft, rng: Rng, rules: CampRules, center: Vec, kind: PropKind, r: number, inner: number): void {
  scatter(d, rng, center, [0, inner - r], (pos) => prop(kind, pos, r, randRange(rng, 0, TURN)), rules.placeTries);
}

function campFence(d: MapDraft, rng: Rng, rules: CampRules, camp: Camp): void {
  const turn = 2 * Math.asin(NEW_WORLD.fenceLength / 2 / camp.radius);
  const count = Math.floor((range(rng, rules.fenceArc) * TURN) / turn);
  const start = randRange(rng, 0, TURN);
  const group = nextFenceGroup(d);
  for (let step = 0; step < count; step++) {
    if (chance(rng, rules.fenceMissing)) continue;
    const a = start + (step + 0.5) * turn;
    const pos = offset(camp.pos, { x: Math.cos(a), y: Math.sin(a) }, camp.radius * Math.cos(turn / 2));
    settleFence(d, prop('fence', pos, FENCE_R, a + Math.PI / 2, group, step), rules.fenceRoadGap);
  }
}

type Rect = { center: Vec; u: Vec; v: Vec; halfU: number; halfV: number };

export function fieldFences(seed: number, d: MapDraft, rules: FieldFenceRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  const field = Uint8Array.from(d.built, (code) => (code === BUILT_FIELD ? 1 : 0));
  for (const patch of patches(d.size, field).filter((p) => p.length >= rules.minTiles)) {
    const open = randInt(rng, 0, 3);
    rectEdges(tightRect(d.size, patch, rules)).forEach(([a, b], k) => {
      if (k !== open && chance(rng, rules.edgeChance)) fenceEdge(d, rng, rules, field, a, b);
    });
  }
}

function tightRect(size: number, patch: number[], rules: FieldFenceRules): Rect {
  const centers = patch.map((tile) => tileCenter(size, tile));
  let best: Rect | null = null;
  for (let a = 0; a < 90; a += rules.angleStep) {
    const rect = rectAt(centers, a * DEG);
    if (!best || rect.halfU * rect.halfV < best.halfU * best.halfV) best = rect;
  }
  if (!best) throw new Error(`Field fence angle step ${rules.angleStep} leaves no angle below 90 degrees`);
  return best;
}

function rectAt(centers: Vec[], a: number): Rect {
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -u.y, y: u.x };
  const us = centers.map((c) => c.x * u.x + c.y * u.y);
  const vs = centers.map((c) => c.x * v.x + c.y * v.y);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const [mu, mv] = [(u0 + u1) / 2, (v0 + v1) / 2];
  return { center: { x: u.x * mu + v.x * mv, y: u.y * mu + v.y * mv }, u, v, halfU: (u1 - u0) / 2 + 0.5, halfV: (v1 - v0) / 2 + 0.5 };
}

function rectEdges(r: Rect): [Vec, Vec][] {
  const corner = (su: number, sv: number) => offset(offset(r.center, r.u, su * r.halfU), r.v, sv * r.halfV);
  const [a, b, c, e] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  return [[a, b], [b, c], [c, e], [e, a]];
}

function fenceEdge(d: MapDraft, rng: Rng, rules: FieldFenceRules, field: Uint8Array, a: Vec, b: Vec): void {
  const line = new RoadLine([a, b]);
  const count = Math.floor(line.length / NEW_WORLD.fenceLength);
  const lead = (line.length - count * NEW_WORLD.fenceLength) / 2;
  const dir = line.dirAt(0);
  const inward = sideOf(dir, 1);
  const group = nextFenceGroup(d);
  for (let step = 0; step < count; step++) {
    const pos = line.pointAt(lead + (step + 0.5) * NEW_WORLD.fenceLength);
    if (chance(rng, rules.missingShare) || !field[tileOf(d.size, offset(pos, inward, 0.75))]) continue;
    settleFence(d, prop('fence', pos, FENCE_R, facing(dir), group, step), rules.roadGap);
  }
}

export function carWrecks(seed: number, d: MapDraft, settled: Camp[], rules: CarWreckRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  roadsideWrecks(d, rng, rules);
  oldRoadWrecks(d, rng, rules);
  for (const camp of settled) if (chance(rng, rules.campChance)) campWrecks(d, rng, rules, camp);
  washWrecks(d, rng, rules);
}

function roadsideWrecks(d: MapDraft, rng: Rng, rules: CarWreckRules): void {
  for (const road of REGION.roads) {
    const line = new RoadLine(road);
    for (const s of stations(line.length, rules.roadStep).filter(() => chance(rng, rules.roadChance))) {
      const dir = line.dirAt(s);
      const pos = offset(line.pointAt(s), sideOf(dir, chance(rng, 0.5) ? 1 : -1), HALF + range(rng, rules.shoulder) + rules.radius);
      const yaw = facing(dir) + randRange(rng, -rules.skew, rules.skew) * DEG + (chance(rng, 0.5) ? Math.PI : 0);
      settle(d, prop('carWreck', pos, rules.radius, yaw), 0);
    }
  }
}

function oldRoadWrecks(d: MapDraft, rng: Rng, rules: CarWreckRules): void {
  for (let tile = 0; tile < d.built.length; tile++) {
    if (d.built[tile] !== BUILT_OLD_ROAD || !chance(rng, rules.oldRoadChance)) continue;
    settle(d, prop('carWreck', tileCenter(d.size, tile), rules.radius, randRange(rng, 0, TURN)), rules.oldRoadGap);
  }
}

function campWrecks(d: MapDraft, rng: Rng, rules: CarWreckRules, camp: Camp): void {
  const count = randInt(rng, rules.campGroup[0], rules.campGroup[1]);
  const reach: [number, number] = [camp.radius + rules.radius, camp.radius + rules.campSpread + rules.radius];
  for (let k = 0; k < count; k++) scatter(d, rng, camp.pos, reach, (pos) => prop('carWreck', pos, rules.radius, randRange(rng, 0, TURN)), rules.placeTries);
}

function washWrecks(d: MapDraft, rng: Rng, rules: CarWreckRules): void {
  for (let tile = 0; tile < d.built.length; tile++) {
    if (!isCutTile(d, tile) || !chance(rng, rules.washChance)) continue;
    settle(d, prop('carWreck', tileCenter(d.size, tile), rules.radius, downhill(d, tile, rng)), 0);
  }
}

function downhill(d: MapDraft, tile: number, rng: Rng): number {
  const w = d.size + 1;
  const k = Math.floor(tile / d.size) * w + (tile % d.size);
  const h = d.heights;
  const fall = { x: (h[k] + h[k + w] - h[k + 1] - h[k + w + 1]) / 2, y: (h[k] + h[k + 1] - h[k + w] - h[k + w + 1]) / 2 };
  return Math.hypot(fall.x, fall.y) > 0 ? facing(fall) : randRange(rng, 0, TURN);
}
