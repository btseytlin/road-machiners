import { FURY_ROAD, HIGHWAY, type SceneryRule } from '../data/fury-road';
import type { TerrainTypeId } from '../data/terrain';
import type { Atlas } from './atlas';
import { NO_DECKS } from './bridge';
import { INDEX_CELL, RoadIndex } from './road-index';
import { hashRandom, nextRandom, randInt, randRange, type Rng } from './rng';
import type { BakedMap, BakedProp, PropKind, Terrain } from './terrain';
import type { WorldSetup } from './types';
import { dist, type Vec } from './vec';

const SIZE = HIGHWAY.size;
const ROAD = HIGHWAY.road;
export const STRIDE = SIZE - 2 * HIGHWAY.margin;

const STRETCH_SALT = 0x68777374;
const CHUNK_SALT = 0x6877636b;
const STREAM_PARTS = { post: 1, rows: 2, groups: 3, stock: 4 } as const;
export type StretchPart = keyof typeof STREAM_PARTS;

export function stretchStream(seed: number, j: number, part: StretchPart): Rng {
  return { rngState: Math.floor(hashRandom(seed, STRETCH_SALT, j, STREAM_PARTS[part]) * 0x100000000) | 0 };
}

export function chunkStream(seed: number, c: number): Rng {
  return { rngState: Math.floor(hashRandom(seed, CHUNK_SALT, c) * 0x100000000) | 0 };
}

export function toLocal(window: number, n: number): number {
  return window * STRIDE + SIZE - n;
}

export function toAbsolute(window: number, y: number): number {
  return window * STRIDE + SIZE - y;
}

export function milestoneAt(j: number): number {
  return HIGHWAY.margin + j * STRIDE;
}

export function highwayHash(seed: number, window: number): string {
  return `highway:${HIGHWAY.version}:${seed}:${window}`;
}

function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const a = hashRandom(seed, i);
  return a + (hashRandom(seed, i + 1) - a) * smooth01(t - i);
}

function noise2(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = smooth01(x - i);
  const fy = smooth01(y - j);
  const a = hashRandom(seed, i, j);
  const b = hashRandom(seed, i + 1, j);
  const c = hashRandom(seed, i, j + 1);
  const d = hashRandom(seed, i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function centerX(seed: number, n: number): number {
  let x = SIZE / 2;
  for (const bend of ROAD.bends) x += bend.amplitude * (2 * noise1(n / bend.wavelength, seed + bend.seedOffset) - 1);
  return x;
}

function centerSlope(seed: number, n: number): number {
  return centerX(seed, n + 0.5) - centerX(seed, n - 0.5);
}

export function roadHeight(seed: number, n: number): number {
  const p = ROAD.profile;
  return p.amplitude * (2 * noise1(n / p.wavelength, seed + p.seedOffset) - 1);
}

export function roadHeading(seed: number, n: number): number {
  return Math.atan2(-1, centerSlope(seed, n));
}

type Abs = { x: number; n: number };

function roadAbs(seed: number, n: number, offset: number): Abs {
  const slope = centerSlope(seed, n);
  const length = Math.hypot(1, slope);
  return { x: centerX(seed, n) + offset / length, n: n - (offset * slope) / length };
}

export function roadPoint(seed: number, window: number, n: number, offset: number): Vec {
  const p = roadAbs(seed, n, offset);
  return { x: p.x, y: toLocal(window, p.n) };
}

function across(seed: number, x: number, n: number): number {
  return (x - centerX(seed, n)) / Math.hypot(1, centerSlope(seed, n));
}

export type OutpostSite = { milestone: number; n: number; side: 1 | -1; pad: Abs };

const SITES = new Map<string, OutpostSite>();

export function outpostSite(seed: number, j: number): OutpostSite {
  if (!Number.isInteger(j) || j < 1) throw new Error(`Milestone ${j} has no outpost`);
  const key = `${seed}:${j}`;
  let site = SITES.get(key);
  if (!site) {
    const n = milestoneAt(j);
    const side: 1 | -1 = randInt(stretchStream(seed, j, 'post'), 0, 1) === 0 ? 1 : -1;
    site = { milestone: j, n, side, pad: roadAbs(seed, n, side * HIGHWAY.pad.offset) };
    SITES.set(key, site);
  }
  return site;
}

export function highwayStart(seed: number): { pos: Vec; heading: number } {
  const n = milestoneAt(0);
  return { pos: roadPoint(seed, 0, n, FURY_ROAD.laneOffsets[HIGHWAY.startLane]), heading: roadHeading(seed, n) };
}

export function rowsOf(j: number): number {
  const r = HIGHWAY.rows;
  return Math.min(r.max, r.first + Math.floor((j - 1) / r.every));
}

export function maxBlockedOf(j: number): number {
  const b = HIGHWAY.maxBlocked;
  return j <= b.upTo ? b.early : b.late;
}

function nearestMilestone(n: number): number {
  return Math.round((n - HIGHWAY.margin) / STRIDE);
}

function edgeRise(x: number): number {
  const e = Math.min(x, SIZE - x);
  const u = smooth01(1 - e / HIGHWAY.edge.band);
  return HIGHWAY.edge.height * u * u;
}

function relief(seed: number, x: number, n: number): number {
  const { amplitude, octaves } = HIGHWAY.relief;
  let sum = 0;
  let total = 0;
  for (const o of octaves) {
    sum += noise2(x * o.freq, n * o.freq, seed + o.seedOffset) * o.amp;
    total += o.amp;
  }
  return amplitude * ((sum / total) * 2 - 1);
}

function padGap(seed: number, x: number, n: number): number {
  const j = nearestMilestone(n);
  if (j < 1) return Infinity;
  const pad = outpostSite(seed, j).pad;
  return Math.hypot(x - pad.x, n - pad.n) - HIGHWAY.pad.radius;
}

function cornerHeight(seed: number, x: number, n: number, d: number, road: number): number {
  const lift = smooth01((d - ROAD.halfWidth - ROAD.flat) / ROAD.blend) * relief(seed, x, n);
  const pad = smooth01(padGap(seed, x, n) / HIGHWAY.pad.flatten);
  return road + lift * pad + edgeRise(x);
}

function tileType(seed: number, x: number, n: number, d: number): TerrainTypeId {
  if (d <= ROAD.halfWidth) return 'asphalt';
  if (padGap(seed, x, n) <= 0.5) return 'concrete';
  if (d <= ROAD.halfWidth + ROAD.hardShoulder) return 'hardpan';
  const g = HIGHWAY.ground;
  if (edgeRise(x) > g.ridgeRise) return 'scree';
  const v = noise2(x * g.scale, n * g.scale, seed + g.seedOffset);
  const band = g.bands.find((b) => v < b.below);
  if (!band) throw new Error(`Ground noise ${v} falls in no band`);
  return band.type;
}

function landOf(seed: number, window: number): Pick<Terrain, 'heights' | 'types'> {
  const row = SIZE + 1;
  const heights = new Array<number>(row * row);
  const types = new Array<TerrainTypeId>(SIZE * SIZE);
  for (let y = 0; y <= SIZE; y++) {
    const n = toAbsolute(window, y);
    const xc = centerX(seed, n);
    const stretch = Math.hypot(1, centerSlope(seed, n));
    const road = roadHeight(seed, n);
    for (let x = 0; x <= SIZE; x++) heights[y * row + x] = cornerHeight(seed, x, n, Math.abs(x - xc) / stretch, road);
  }
  for (let y = 0; y < SIZE; y++) {
    const n = toAbsolute(window, y + 0.5);
    const xc = centerX(seed, n);
    const stretch = Math.hypot(1, centerSlope(seed, n));
    for (let x = 0; x < SIZE; x++) types[y * SIZE + x] = tileType(seed, x + 0.5, n, Math.abs(x + 0.5 - xc) / stretch);
  }
  return { heights, types };
}

type AbsProp = { kind: PropKind; at: Abs; r: number; yaw: number; group: number; step: number };

function piece(kind: PropKind, at: Abs, r: number, yaw: number): AbsProp {
  return { kind, at, r, yaw, group: 0, step: 0 };
}

function outpostProps(seed: number, j: number): AbsProp[] {
  const site = outpostSite(seed, j);
  const heading = roadHeading(seed, site.n);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const nx = -uy * site.side;
  const ny = ux * site.side;
  return FURY_ROAD.outpost.props.map((p) => piece(
    p.look as PropKind,
    { x: site.pad.x + ux * p.along + nx * p.across, n: site.pad.n - (uy * p.along + ny * p.across) },
    p.r,
    heading + (site.side > 0 ? 0 : Math.PI),
  ));
}

function lineAcross(seed: number, n: number, reach: number, step: number, kinds: PropKind[], r: number): AbsProp[] {
  const heading = roadHeading(seed, n);
  const count = Math.floor((2 * reach) / step) + 1;
  return Array.from({ length: count }, (_, i) => piece(kinds[i % kinds.length], roadAbs(seed, n, -reach + i * step), r, heading));
}

function gateN(j: number): number {
  return milestoneAt(j) + HIGHWAY.gateGap;
}

function roadEndN(window: number): number {
  return window * STRIDE + HIGHWAY.endGap;
}

function gateProps(seed: number, j: number): AbsProp[] {
  return lineAcross(seed, gateN(j), HIGHWAY.gateReach, HIGHWAY.gateStep, ['barrier'], 0.5);
}

function roadEndProps(seed: number, window: number): AbsProp[] {
  return lineAcross(seed, roadEndN(window), ROAD.halfWidth + HIGHWAY.endReach, HIGHWAY.endStep, ['tankTrap', 'barrier'], 0.5);
}

const ROWS = new Map<string, AbsProp[][]>();

export function stretchRows(seed: number, j: number): AbsProp[][] {
  const key = `${seed}:${j}`;
  let rows = ROWS.get(key);
  if (!rows) {
    rows = layRows(seed, j);
    ROWS.set(key, rows);
  }
  return rows;
}

function layRows(seed: number, j: number): AbsProp[][] {
  const rng = stretchStream(seed, j, 'rows');
  const from = milestoneAt(j - 1) + HIGHWAY.outpostGap;
  const to = milestoneAt(j) - HIGHWAY.outpostGap;
  const count = rowsOf(j);
  const slot = (to - from) / count;
  const taken: number[] = [];
  const rows: AbsProp[][] = [];
  for (let i = 0; i < count; i++) {
    const n = rowSpot(rng, j, i, { from: from + slot * i, to: from + slot * (i + 1) }, { from, to }, taken);
    taken.push(n);
    rows.push(rowPieces(rng, seed, j, n));
  }
  return rows;
}

function rowSpot(rng: Rng, j: number, i: number, own: { from: number; to: number }, all: { from: number; to: number }, taken: number[]): number {
  const roadEnd = roadEndN(j);
  for (let tries = 0; tries < HIGHWAY.maxTries; tries++) {
    const within = tries < HIGHWAY.maxTries / 2 ? own : all;
    const n = randRange(rng, within.from, within.to);
    if (Math.abs(n - roadEnd) >= HIGHWAY.rowGap && taken.every((other) => Math.abs(other - n) >= HIGHWAY.rowGap)) return n;
  }
  throw new Error(`Highway row ${i + 1} of stretch ${j} found no clear spot`);
}

function rowPieces(rng: Rng, seed: number, j: number, n: number): AbsProp[] {
  const lanes = FURY_ROAD.laneOffsets.map((_, lane) => lane);
  const blocked = randInt(rng, 1, maxBlockedOf(j));
  const heading = roadHeading(seed, n);
  return Array.from({ length: blocked }, () => {
    const lane = lanes.splice(randInt(rng, 0, lanes.length - 1), 1)[0];
    const kind = HIGHWAY.rowKinds[randInt(rng, 0, HIGHWAY.rowKinds.length - 1)];
    return piece(kind, roadAbs(seed, n, FURY_ROAD.laneOffsets[lane]), randRange(rng, ...FURY_ROAD.rowRadius), heading);
  });
}

function sceneryChunk(seed: number, c: number): AbsProp[] {
  const rng = chunkStream(seed, c);
  const out: AbsProp[] = [];
  for (const rule of HIGHWAY.scenery) {
    const count = randInt(rng, ...rule.count);
    for (let i = 0; i < count; i++) placeApart(out, sceneryProp(rng, seed, c, rule), c);
  }
  placeApart(out, billboard(rng, seed, c), c);
  return out;
}

function placeApart(out: AbsProp[], prop: AbsProp | null, c: number): void {
  if (prop && out.every((o) => dist(toVec(o.at), toVec(prop.at)) >= o.r + prop.r + HIGHWAY.propGap)) out.push({ ...prop, group: c, step: out.length });
}

function toVec(a: Abs): Vec {
  return { x: a.x, y: a.n };
}

function chunkN(rng: Rng, c: number): number {
  return randRange(rng, c * HIGHWAY.chunkRows + HIGHWAY.chunkEdge, (c + 1) * HIGHWAY.chunkRows - HIGHWAY.chunkEdge);
}

function sceneryProp(rng: Rng, seed: number, c: number, rule: SceneryRule): AbsProp | null {
  const n = chunkN(rng, c);
  const r = randRange(rng, ...rule.r);
  const yaw = randRange(rng, 0, Math.PI * 2);
  const at = rule.band === 'shoulder' ? shoulderSpot(rng, seed, n) : openSpot(rng, seed, n);
  return clearOfMilestones(seed, at, r) && inBounds(at.x, r) ? piece(rule.kind, at, r, yaw) : null;
}

function shoulderSpot(rng: Rng, seed: number, n: number): Abs {
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  return roadAbs(seed, n, side * (ROAD.halfWidth + randRange(rng, ...HIGHWAY.shoulderBand)));
}

function openSpot(rng: Rng, seed: number, n: number): Abs {
  const x = randRange(rng, HIGHWAY.edgeKeep, SIZE - HIGHWAY.edgeKeep);
  const d = Math.abs(across(seed, x, n));
  return d >= ROAD.halfWidth + HIGHWAY.openFrom ? { x, n } : { x: NaN, n };
}

function billboard(rng: Rng, seed: number, c: number): AbsProp | null {
  const b = HIGHWAY.billboard;
  const n = chunkN(rng, c);
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  const at = roadAbs(seed, n, side * randRange(rng, ...b.across));
  const lucky = nextRandom(rng) < b.chance;
  return lucky && clearOfMilestones(seed, at, b.r) ? piece('billboard', at, b.r, roadHeading(seed, n) + (side > 0 ? Math.PI / 2 : -Math.PI / 2)) : null;
}

function inBounds(x: number, r: number): boolean {
  return x >= r && x <= SIZE - r;
}

function clearOfMilestones(seed: number, at: Abs, r: number): boolean {
  if (!Number.isFinite(at.x)) return false;
  const j = nearestMilestone(at.n);
  const d = Math.abs(across(seed, at.x, at.n));
  const band = (n: number, reach: number) => Math.abs(at.n - n) < r + HIGHWAY.bandGap && d < reach + r + HIGHWAY.bandGap;
  if (band(roadEndN(j), ROAD.halfWidth + HIGHWAY.endReach)) return false;
  if (j < 1) return true;
  if (band(gateN(j), HIGHWAY.gateReach)) return false;
  const site = outpostSite(seed, j);
  return Math.hypot(at.x - centerX(seed, site.n), at.n - site.n) >= HIGHWAY.outpostZone + r;
}

function windowProps(seed: number, window: number): AbsProp[] {
  const out: AbsProp[] = [];
  for (const j of [window, window + 1]) if (j >= 1) out.push(...outpostProps(seed, j));
  out.push(...gateProps(seed, window + 1), ...roadEndProps(seed, window));
  for (let j = Math.max(1, window); j <= window + 2; j++) out.push(...stretchRows(seed, j).flat());
  const first = Math.floor((window * STRIDE) / HIGHWAY.chunkRows);
  const last = Math.ceil((window * STRIDE + SIZE) / HIGHWAY.chunkRows);
  for (let c = first; c <= last; c++) out.push(...sceneryChunk(seed, c));
  return out;
}

function bakedProps(seed: number, window: number): BakedProp[] {
  return windowProps(seed, window).flatMap((p) => {
    const pos = { x: p.at.x, y: toLocal(window, p.at.n) };
    const inside = pos.x >= p.r && pos.x <= SIZE - p.r && pos.y >= p.r && pos.y <= SIZE - p.r;
    return inside ? [{ kind: p.kind, pos, r: p.r, yaw: p.yaw, group: p.group, step: p.step }] : [];
  });
}

export function highwayMap(seed: number, window: number): BakedMap {
  if (!Number.isInteger(window) || window < 0) throw new Error(`Highway window ${window} is not a whole number from 0`);
  const land = landOf(seed, window);
  Object.freeze(land.heights);
  Object.freeze(land.types);
  const terrain: Terrain = Object.freeze({ size: SIZE, ...land, atlas: Object.freeze({ kind: 'highway', seed, window }) });
  return { hash: highwayHash(seed, window), seed, terrain, props: bakedProps(seed, window) };
}

export function newMapFor(setup: WorldSetup, seed: number, icarus: BakedMap): BakedMap {
  return setup.mode === 'furyRoad' ? highwayMap(seed, 0) : icarus;
}

export function highwayLine(seed: number, window: number): Vec[] {
  const points: Vec[] = [];
  for (let n = window * STRIDE; n <= window * STRIDE + SIZE; n += ROAD.sample) points.push({ x: centerX(seed, n), y: toLocal(window, n) });
  return points;
}

export function highwayAtlas(seed: number, window: number): Atlas {
  const line = highwayLine(seed, window);
  return {
    roads: [{ points: line, width: ROAD.halfWidth * 2, lanes: FURY_ROAD.laneOffsets.length }],
    roadWidth: ROAD.halfWidth * 2,
    roadIndex: new RoadIndex([line], INDEX_CELL),
    towns: [],
    locations: [],
    decks: NO_DECKS,
    hazards: [],
    oldSpots: false,
    landforms: false,
  };
}
