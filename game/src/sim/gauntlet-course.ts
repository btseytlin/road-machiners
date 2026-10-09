import { GAUNTLET } from '../data/gauntlet';
import { REGION } from '../data/region';
import { randInt, type Rng } from './rng';
import type { GauntletCourse } from './types';
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
