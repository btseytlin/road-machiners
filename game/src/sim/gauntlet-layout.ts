import { GAUNTLET, type RowLook } from '../data/gauntlet';
import { GARAGE_STOCK } from '../data/market';
import { REGION } from '../data/region';
import { atlasOf } from './atlas';
import { clearOfDecks, clearOfSites, overlapsAny } from './mapgen';
import { rollPartStock } from './market';
import { nearCliff, terrainNav } from './nav/layer';
import { randInt, randRange, type Rng } from './rng';
import type { GauntletCourse, GauntletRun, Obstacle, Outpost, WaveGroup, World } from './types';
import { dist, type Vec } from './vec';

export type CourseLine = { points: Vec[]; lengths: number[]; total: number };

const GAUNTLET_SALT = 0x67617574;
const LINES = new Map<string, CourseLine>();

export function gauntletStream(seed: number): Rng {
  return { rngState: seed ^ GAUNTLET_SALT };
}

export function pickCourse(rng: Rng): GauntletCourse {
  const road = GAUNTLET.roads[randInt(rng, 0, GAUNTLET.roads.length - 1)];
  const reversed = randInt(rng, 0, 1) === 1;
  const line = courseLine({ road, reversed, start: 0, end: 0 });
  const start = clearOfTown(line, 0, 1);
  const end = clearOfTown(line, line.total, -1);
  if (end - start < GAUNTLET.stretches * GAUNTLET.rowGap * 4) throw new Error(`Gauntlet course on road ${road} is too short: ${start} to ${end}`);
  return { road, reversed, start, end };
}

function clearOfTown(line: CourseLine, from: number, step: 1 | -1): number {
  const town = nearestTown(pointAt(line, from, 0));
  for (let along = from; along >= 0 && along <= line.total; along += step) {
    if (dist(pointAt(line, along, 0), town.pos) > town.radius + GAUNTLET.townMargin) return along;
  }
  throw new Error(`Road never leaves ${town.name}`);
}

function nearestTown(pos: Vec): (typeof REGION.towns)[number] {
  return [...REGION.towns].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}

export function courseLine(course: GauntletCourse): CourseLine {
  const key = `${course.road}:${course.reversed}`;
  const cached = LINES.get(key);
  if (cached) return cached;
  const road = REGION.roads[course.road];
  if (!road) throw new Error(`No road ${course.road} for the Gauntlet course`);
  const points = course.reversed ? [...road].reverse() : [...road];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]));
  const line = { points, lengths, total: lengths[lengths.length - 1] };
  LINES.set(key, line);
  return line;
}

function segmentAt(line: CourseLine, along: number): number {
  let lo = 0;
  let hi = line.points.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.lengths[mid] <= along) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function directionAt(line: CourseLine, along: number): number {
  const i = segmentAt(line, Math.min(Math.max(along, 0), line.total));
  const a = line.points[i];
  const b = line.points[i + 1];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function pointAt(line: CourseLine, along: number, offset: number): Vec {
  const clamped = Math.min(Math.max(along, 0), line.total);
  const i = segmentAt(line, clamped);
  const a = line.points[i];
  const b = line.points[i + 1];
  const length = line.lengths[i + 1] - line.lengths[i];
  const t = length > 0 ? (clamped - line.lengths[i]) / length : 0;
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  return { x: a.x + (b.x - a.x) * t + nx * offset, y: a.y + (b.y - a.y) * t + ny * offset };
}

export function progressOf(line: CourseLine, pos: Vec): number {
  let best = Infinity;
  let along = 0;
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1];
    const b = line.points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / length2)) : 0;
    const d = Math.hypot(a.x + dx * t - pos.x, a.y + dy * t - pos.y);
    if (d < best) {
      best = d;
      along = line.lengths[i - 1] + t * Math.sqrt(length2);
    }
  }
  return along;
}

export function gauntletStart(seed: number): { pos: Vec; heading: number } {
  const course = pickCourse(gauntletStream(seed));
  const line = courseLine(course);
  return { pos: pointAt(line, course.start, GAUNTLET.laneOffsets[GAUNTLET.startLane]), heading: directionAt(line, course.start) };
}

type Span = { from: number; to: number };

export function layGauntlet(world: World): void {
  const rng = gauntletStream(world.seed);
  const course = pickCourse(rng);
  const line = courseLine(course);
  const run: GauntletRun = { rng, course, stretch: 0, outposts: [], groups: [], complete: false };
  world.gauntlet = run;
  stretchEnds(rng, course.start, course.end).forEach((end, k) => run.outposts.push(placeOutpost(world, rng, line, k, end)));
  const spans = run.outposts.map((post, k) => ({ from: k === 0 ? course.start + GAUNTLET.startGap : run.outposts[k - 1].at + GAUNTLET.outpostGap, to: post.at - GAUNTLET.outpostGap }));
  const taken: number[] = [];
  spans.forEach((span, k) => placeRows(world, rng, line, k, span, taken));
  spans.forEach((span, k) => run.groups.push(...planGroups(rng, k, span)));
}

function stretchEnds(rng: Rng, start: number, end: number): number[] {
  const n = GAUNTLET.stretches;
  const length = (end - start) / n;
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? end : start + length * (k + 1) + randRange(rng, -1, 1) * GAUNTLET.stretchJitter * length));
}

function placeOutpost(world: World, rng: Rng, line: CourseLine, k: number, end: number): Outpost {
  const sides: (1 | -1)[] = randInt(rng, 0, 1) === 0 ? [1, -1] : [-1, 1];
  for (let tries = 0; tries < GAUNTLET.maxTries; tries++) {
    const at = end - (tries >> 1);
    const side = sides[tries % 2];
    const props = outpostProps(line, at, side, k);
    const pad = pointAt(line, at, side * GAUNTLET.outpost.padOffset);
    if (!clearSpot(world, pad, GAUNTLET.outpost.padRadius) || !props.every((o) => clearSpot(world, o.pos, o.r))) continue;
    world.obstacles.push(...props);
    const stock = rollPartStock(world, rng, GARAGE_STOCK, GAUNTLET.stockSize[k], `Outpost ${k + 1}`);
    return { id: `outpost-${k}`, name: `Outpost ${k + 1}`, at, side, pad, stock, paid: false };
  }
  throw new Error(`Gauntlet outpost ${k + 1} found no clear spot near ${end.toFixed(0)} tiles along road ${world.gauntlet?.course.road}`);
}

function outpostProps(line: CourseLine, at: number, side: 1 | -1, k: number): Obstacle[] {
  const pad = pointAt(line, at, side * GAUNTLET.outpost.padOffset);
  const heading = directionAt(line, at);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const nx = -uy * side;
  const ny = ux * side;
  return GAUNTLET.outpost.props.map((p, i) => ({
    id: `run-post${k}-${i}`,
    pos: { x: pad.x + ux * p.along + nx * p.across, y: pad.y + uy * p.along + ny * p.across },
    r: p.r,
    kind: 'landmark',
    look: p.look,
    yaw: heading + (side > 0 ? 0 : Math.PI),
  }));
}

function clearSpot(world: World, pos: Vec, r: number): boolean {
  return onMap(world, pos, r) && clearOfSites(atlasOf(world.terrain), pos, r) && !overlapsAny(world.obstacles, pos, r) && clearOfGround(world, pos, r);
}

function onMap(world: World, pos: Vec, r: number): boolean {
  return Math.min(pos.x, pos.y) >= r && Math.max(pos.x, pos.y) <= world.size - r;
}

function clearOfGround(world: World, pos: Vec, r: number): boolean {
  return clearOfDecks(atlasOf(world.terrain), pos, r) && !nearCliff(terrainNav(world.terrain), pos.x, pos.y, r);
}

function placeRows(world: World, rng: Rng, line: CourseLine, k: number, span: Span, taken: number[]): void {
  for (let i = 0; i < GAUNTLET.rowsPerStretch[k]; i++) {
    const row = placeRow(world, rng, line, k, i, span, taken);
    world.obstacles.push(...row.pieces);
    taken.push(row.at);
  }
}

function placeRow(world: World, rng: Rng, line: CourseLine, k: number, i: number, span: Span, taken: number[]): { at: number; pieces: Obstacle[] } {
  const slot = (span.to - span.from) / GAUNTLET.rowsPerStretch[k];
  const own = { from: span.from + slot * i, to: span.from + slot * (i + 1) };
  for (let tries = 0; tries < GAUNTLET.maxTries; tries++) {
    const within = tries < GAUNTLET.maxTries / 2 ? own : span;
    const at = randRange(rng, within.from, within.to);
    if (taken.some((other) => Math.abs(other - at) < GAUNTLET.rowGap)) continue;
    const pieces = rowPieces(rng, line, k, i, at);
    if (pieces.every((o) => clearSpot(world, o.pos, o.r))) return { at, pieces };
  }
  throw new Error(`Gauntlet row ${i + 1} of stretch ${k + 1} found no clear spot`);
}

function rowPieces(rng: Rng, line: CourseLine, k: number, i: number, at: number): Obstacle[] {
  const lanes = GAUNTLET.laneOffsets.map((_, lane) => lane);
  const blocked = randInt(rng, 1, GAUNTLET.maxBlocked[k]);
  const heading = directionAt(line, at);
  return Array.from({ length: blocked }, (_, j) => {
    const lane = lanes.splice(randInt(rng, 0, lanes.length - 1), 1)[0];
    const look = GAUNTLET.rowLooks[randInt(rng, 0, GAUNTLET.rowLooks.length - 1)];
    return rowPiece(`run-row${k}-${i}-${j}`, pointAt(line, at, GAUNTLET.laneOffsets[lane]), randRange(rng, ...GAUNTLET.rowRadius), look, heading);
  });
}

function rowPiece(id: string, pos: Vec, r: number, look: RowLook, heading: number): Obstacle {
  if (look.kind === 'wreck') return { id, pos, r, kind: 'wreck' };
  return { id, pos, r, kind: 'landmark', look: look.look, yaw: heading };
}

function planGroups(rng: Rng, k: number, span: Span): WaveGroup[] {
  const [lo, hi] = GAUNTLET.groupSpread;
  const anchors = GAUNTLET.groups[k].map(() => span.from + (span.to - span.from) * randRange(rng, lo, hi)).sort((a, b) => a - b);
  return GAUNTLET.groups[k].map((plan, i) => ({
    id: `g${k}-${i}`,
    stretch: k,
    at: anchors[i],
    from: plan.from,
    templates: [...plan.templates],
    level: plan.level,
    spawned: false,
    vehicles: [],
    wrecked: 0,
    retryUntil: null,
  }));
}
