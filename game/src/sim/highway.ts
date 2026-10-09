import { FURY_ROAD, HIGHWAY, type BandRule, type GroundBand } from '../data/fury-road';
import { REGION, type SiteLocationDef } from '../data/region';
import type { TerrainTypeId } from '../data/terrain';
import type { Atlas } from './atlas';
import { NO_DECKS } from './bridge';
import { fortressProps } from './fortress';
import { INDEX_CELL, RoadIndex } from './road-index';
import { hashRandom, nextRandom, randInt, randRange, type Rng } from './rng';
import type { BakedMap, BakedProp, PropKind, Terrain } from './terrain';
import type { WorldSetup } from './types';
import { DEG, type Vec } from './vec';

const SIZE = HIGHWAY.size;
const ROAD = HIGHWAY.road;
const ROOT2 = Math.SQRT2;
export const STRIDE = HIGHWAY.stride;

const STRETCH_SALT = 0x68777374;
const CHUNK_SALT = 0x6877636b;
const LINE_SALT = 0x68776c6e;
const STREAM_PARTS = { post: 1, scenes: 2, groups: 3, stock: 4 } as const;
export type StretchPart = keyof typeof STREAM_PARTS;

export type RoadPos = { n: number; u: number };

export function stretchStream(seed: number, j: number, part: StretchPart): Rng {
  return { rngState: Math.floor(hashRandom(seed, STRETCH_SALT, j, STREAM_PARTS[part]) * 0x100000000) | 0 };
}

export function chunkStream(seed: number, c: number): Rng {
  return { rngState: Math.floor(hashRandom(seed, CHUNK_SALT, c) * 0x100000000) | 0 };
}

export function toRoad(window: number, p: Vec): RoadPos {
  return { n: (2 * SIZE - p.x - p.y + 2 * window * STRIDE) / ROOT2, u: (p.x - p.y) / ROOT2 };
}

export function fromRoad(window: number, n: number, u: number): Vec {
  const base = SIZE + window * STRIDE;
  return { x: base + (u - n) / ROOT2, y: base - (u + n) / ROOT2 };
}

export function windowSpan(window: number): { from: number; to: number } {
  return { from: window * STRIDE * ROOT2, to: (window * STRIDE + SIZE) * ROOT2 };
}

export function milestoneAt(j: number): number {
  return (HIGHWAY.milestoneInset + j * STRIDE) * ROOT2;
}

export function stretchOf(n: number): number {
  return Math.floor((n / ROOT2 - HIGHWAY.milestoneInset) / STRIDE) + 1;
}

export function nearestMilestone(n: number): number {
  return Math.round((n / ROOT2 - HIGHWAY.milestoneInset) / STRIDE);
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

export function centerU(seed: number, n: number): number {
  const b = ROAD.bend;
  return b.amplitude * (2 * noise1(n / b.wavelength, seed + b.seedOffset) - 1);
}

function centerSlope(seed: number, n: number): number {
  return centerU(seed, n + 0.5) - centerU(seed, n - 0.5);
}

export function roadHeight(seed: number, n: number): number {
  const p = ROAD.profile;
  return p.amplitude * (2 * noise1(n / p.wavelength, seed + p.seedOffset) - 1);
}

export function roadHeading(seed: number, n: number): number {
  const slope = centerSlope(seed, n);
  return Math.atan2(-(slope + 1), slope - 1);
}

export function roadAt(seed: number, n: number, offset: number): RoadPos {
  const slope = centerSlope(seed, n);
  const length = Math.hypot(1, slope);
  return { n: n - (offset * slope) / length, u: centerU(seed, n) + offset / length };
}

export function roadPoint(seed: number, window: number, n: number, offset: number): Vec {
  const at = roadAt(seed, n, offset);
  return fromRoad(window, at.n, at.u);
}

export function acrossOf(seed: number, at: RoadPos): number {
  return (at.u - centerU(seed, at.n)) / Math.hypot(1, centerSlope(seed, at.n));
}

export type OutpostSite = { milestone: number; n: number; side: 1 | -1; center: RoadPos; out: number };

const SITES = new Map<string, OutpostSite>();
const FORTS = new Map<string, SiteLocationDef>();
const POST = FURY_ROAD.outpost;
const PAD = REGION.sites.pad;

export function outpostName(milestone: number): string {
  return `Outpost ${milestone}`;
}

export function outpostSite(seed: number, j: number): OutpostSite {
  if (!Number.isInteger(j) || j < 1) throw new Error(`Milestone ${j} has no outpost`);
  const key = `${seed}:${j}`;
  let site = SITES.get(key);
  if (!site) {
    const n = milestoneAt(j);
    const side: 1 | -1 = randInt(stretchStream(seed, j, 'post'), 0, 1) === 0 ? 1 : -1;
    const out = roadHeading(seed, n) + Math.PI / 2 + (side > 0 ? Math.PI : 0);
    site = { milestone: j, n, side, center: roadAt(seed, n, side * POST.across), out };
    SITES.set(key, site);
  }
  return site;
}

export function outpostFort(seed: number, window: number, j: number): SiteLocationDef {
  const key = `${seed}:${window}:${j}`;
  let fort = FORTS.get(key);
  if (!fort) {
    const site = outpostSite(seed, j);
    const pos = fromRoad(window, site.center.n, site.center.u);
    const gate = { x: pos.x + Math.cos(site.out) * POST.radius, y: pos.y + Math.sin(site.out) * POST.radius };
    fort = { id: `outpost-${j}`, name: outpostName(j), kind: 'convoy', pos, radius: POST.radius, look: POST.look, turn: site.out / DEG - 45, gates: [gate] };
    FORTS.set(key, fort);
  }
  return fort;
}

function windowForts(seed: number, window: number): SiteLocationDef[] {
  return [window, window + 1].filter((j) => j >= 1).map((j) => outpostFort(seed, window, j));
}

type FortFrame = { out: number; lat: number };

function fortFrame(seed: number, at: RoadPos): FortFrame | null {
  const j = nearestMilestone(at.n);
  if (j < 1) return null;
  const site = outpostSite(seed, j);
  const dn = at.n - site.center.n;
  const du = at.u - site.center.u;
  const dx = (du - dn) / ROOT2;
  const dy = -(du + dn) / ROOT2;
  const cos = Math.cos(site.out);
  const sin = Math.sin(site.out);
  return { out: dx * cos + dy * sin, lat: dy * cos - dx * sin };
}

function fortFlat(f: FortFrame | null): number {
  if (!f) return 0;
  const front = POST.across - ROAD.asphalt;
  const past = Math.hypot(Math.max(0, -POST.flat.back - f.out, f.out - front), Math.max(0, Math.abs(f.lat) - POST.flat.half));
  return 1 - smooth01(past / POST.flat.blend);
}

function inStrip(f: FortFrame, from: number, to: number, half: number): boolean {
  return f.out >= from && f.out <= to && Math.abs(f.lat) <= half;
}

function onFortConcrete(f: FortFrame | null): boolean {
  if (!f) return false;
  const front = POST.across - ROAD.asphalt + 0.5;
  return inStrip(f, POST.radius, POST.radius + PAD.length, PAD.width / 2) || inStrip(f, POST.spur.from, front, POST.spur.half);
}

export function highwayStart(seed: number): { pos: Vec; heading: number } {
  const n = milestoneAt(0);
  return { pos: roadPoint(seed, 0, n, ROAD.lanes[HIGHWAY.startLane]), heading: roadHeading(seed, n) };
}

function relief(seed: number, at: RoadPos): number {
  const { amplitude, octaves } = HIGHWAY.relief;
  let sum = 0;
  let total = 0;
  for (const o of octaves) {
    sum += noise2(at.u * o.freq, at.n * o.freq, seed + o.seedOffset) * o.amp;
    total += o.amp;
  }
  return amplitude * ((sum / total) * 2 - 1);
}

export function ridgeRise(d: number): number {
  return ROAD.ridge.rise * smooth01((d - ROAD.badlands) / ROAD.ridge.run);
}

function cornerHeight(seed: number, at: RoadPos, d: number, flat: number): number {
  const lift = smooth01((d - ROAD.flatTo) / ROAD.blend) * relief(seed, at);
  return roadHeight(seed, at.n) + (1 - flat) * (lift + ridgeRise(d));
}

function bandOf(bands: GroundBand[], v: number): TerrainTypeId {
  const band = bands.find((b) => v < b.below);
  if (!band) throw new Error(`Ground noise ${v} falls in no band`);
  return band.type;
}

function tileType(seed: number, at: RoadPos, d: number, concrete: boolean): TerrainTypeId {
  if (d <= ROAD.asphalt) return 'asphalt';
  if (concrete) return 'concrete';
  const g = HIGHWAY.ground;
  if (d > ROAD.badlands) return g.ridge;
  const v = noise2(at.u * g.scale, at.n * g.scale, seed + g.seedOffset);
  return bandOf(d <= ROAD.verge ? g.verge : g.badlands, v);
}

function landOf(seed: number, window: number): Pick<Terrain, 'heights' | 'types'> {
  const row = SIZE + 1;
  const heights = new Array<number>(row * row);
  const types = new Array<TerrainTypeId>(SIZE * SIZE);
  for (let y = 0; y <= SIZE; y++) {
    for (let x = 0; x <= SIZE; x++) {
      const at = toRoad(window, { x, y });
      heights[y * row + x] = cornerHeight(seed, at, Math.abs(acrossOf(seed, at)), fortFlat(fortFrame(seed, at)));
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const at = toRoad(window, { x: x + 0.5, y: y + 0.5 });
      types[y * SIZE + x] = tileType(seed, at, Math.abs(acrossOf(seed, at)), onFortConcrete(fortFrame(seed, at)));
    }
  }
  return { heights, types };
}

export type RoadPiece = { kind: PropKind; at: RoadPos; r: number; yaw: number; group: number; step: number };

export function roadPiece(kind: PropKind, at: RoadPos, r: number, yaw: number): RoadPiece {
  return { kind, at, r, yaw, group: 0, step: 0 };
}

function chunkN(rng: Rng, c: number): number {
  return randRange(rng, c * HIGHWAY.chunk + HIGHWAY.chunkEdge, (c + 1) * HIGHWAY.chunk - HIGHWAY.chunkEdge);
}

function sideOf(rng: Rng): 1 | -1 {
  return nextRandom(rng) < 0.5 ? -1 : 1;
}

function clearOfMilestones(seed: number, at: RoadPos, r: number): boolean {
  const clear = HIGHWAY.milestoneClear;
  const along = at.n - milestoneAt(nearestMilestone(at.n));
  const near = along > -clear.south - r && along < clear.north + r;
  return !near || Math.abs(acrossOf(seed, at)) >= clear.across + r;
}

function apart(out: RoadPiece[], p: RoadPiece): boolean {
  return out.every((o) => Math.hypot(o.at.n - p.at.n, o.at.u - p.at.u) >= o.r + p.r + HIGHWAY.propGap);
}

function bandPiece(rng: Rng, seed: number, c: number, rule: BandRule): RoadPiece {
  const n = chunkN(rng, c);
  const r = randRange(rng, ...rule.r);
  const offset = sideOf(rng) * randRange(rng, rule.across[0] + r, rule.across[1]);
  return roadPiece(rule.kind, roadAt(seed, n, offset), r, randRange(rng, 0, Math.PI * 2));
}

function billboard(rng: Rng, seed: number, c: number): RoadPiece | null {
  const b = HIGHWAY.billboard;
  const n = chunkN(rng, c);
  const side = sideOf(rng);
  const at = roadAt(seed, n, side * randRange(rng, ...b.across));
  const lucky = nextRandom(rng) < b.chance;
  return lucky ? roadPiece('billboard', at, b.r, roadHeading(seed, n) + (side > 0 ? Math.PI / 2 : -Math.PI / 2)) : null;
}

function ditchedCar(rng: Rng, seed: number, c: number): RoadPiece | null {
  const d = HIGHWAY.ditched;
  const n = chunkN(rng, c);
  const kind = d.kinds[randInt(rng, 0, d.kinds.length - 1)];
  const r = randRange(rng, ...d.r);
  const at = roadAt(seed, n, sideOf(rng) * randRange(rng, ...d.across));
  const yaw = roadHeading(seed, n) + (randRange(rng, -d.yaw, d.yaw) * Math.PI) / 180;
  return nextRandom(rng) < d.chance ? roadPiece(kind, at, r, yaw) : null;
}

export type Keep = (p: RoadPiece) => boolean;

function sceneryChunk(seed: number, c: number, keep: Keep): RoadPiece[] {
  const rng = chunkStream(seed, c);
  const out: RoadPiece[] = [];
  const place = (p: RoadPiece | null) => {
    if (p && clearOfMilestones(seed, p.at, p.r) && keep(p) && apart(out, p)) out.push({ ...p, group: c, step: out.length });
  };
  for (const rule of HIGHWAY.badlands) {
    const count = randInt(rng, ...rule.count);
    for (let i = 0; i < count; i++) place(bandPiece(rng, seed, c, rule));
  }
  place(billboard(rng, seed, c));
  place(ditchedCar(rng, seed, c));
  return out;
}

export function powerLineSide(seed: number, j: number): 1 | -1 {
  return hashRandom(seed, LINE_SALT, j) < 0.5 ? -1 : 1;
}

function powerLine(seed: number, from: number, to: number, keep: Keep): RoadPiece[] {
  const line = HIGHWAY.powerLine;
  const out: RoadPiece[] = [];
  for (let i = Math.ceil(from / line.spacing); i * line.spacing <= to; i++) {
    const n = i * line.spacing;
    const side = powerLineSide(seed, stretchOf(n));
    const pole = { ...roadPiece('pole', roadAt(seed, n, side * line.across), line.r, roadHeading(seed, n)), group: i, step: side > 0 ? 1 : 0 };
    if (clearOfMilestones(seed, pole.at, pole.r) && keep(pole)) out.push(pole);
  }
  return out;
}

export function sceneryPieces(seed: number, from: number, to: number, keep: Keep): RoadPiece[] {
  const out = powerLine(seed, from, to, keep);
  for (let c = Math.floor(from / HIGHWAY.chunk); c <= Math.ceil(to / HIGHWAY.chunk); c++) out.push(...sceneryChunk(seed, c, keep));
  return out;
}

function windowPieces(seed: number, window: number): RoadPiece[] {
  const span = windowSpan(window);
  return sceneryPieces(seed, span.from, span.to, () => true);
}

function bakedProps(seed: number, window: number): BakedProp[] {
  const pieces = windowPieces(seed, window).map((p) => ({ kind: p.kind, pos: fromRoad(window, p.at.n, p.at.u), r: p.r, yaw: p.yaw, group: p.group, step: p.step }));
  const forts = windowForts(seed, window).flatMap(fortressProps);
  return [...pieces, ...forts].filter((p) => p.pos.x >= p.r && p.pos.x <= SIZE - p.r && p.pos.y >= p.r && p.pos.y <= SIZE - p.r);
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
  const span = windowSpan(window);
  const points: Vec[] = [];
  for (let n = span.from; n <= span.to; n += ROAD.sample) points.push(fromRoad(window, n, centerU(seed, n)));
  return points;
}

export function highwayAtlas(seed: number, window: number): Atlas {
  const line = highwayLine(seed, window);
  const width = ROAD.asphalt * 2;
  return {
    roads: [{ points: line, width, lanes: ROAD.lanes.length }],
    roadWidth: width,
    roadIndex: new RoadIndex([line], INDEX_CELL),
    towns: [],
    locations: windowForts(seed, window),
    decks: NO_DECKS,
    hazards: [],
    oldSpots: false,
    landforms: false,
  };
}
