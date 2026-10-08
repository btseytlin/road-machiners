// Spatial indexes over world.obstacles for hot queries: sight lines, shade rays and breakable props on a walk. Each
// query reads the buckets near its segment instead of filtering every obstacle.
// update() clones the world every turn, so an index is keyed by each obstacle's id and place in order, never by array

import { TIME } from '../data/time';
import { marksOf, ObstacleBuckets, sameMarks, type Blocker, type ObstacleMark } from './nav/buckets';
import { isBreakable, propReach } from './mapgen';
import type { Obstacle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';

export type PropIndexKind = 'sight' | 'shade' | 'breakable';

type Slot = Blocker & { at: number };

const SIGHT_BLOCKING: Obstacle['kind'][] = ['rock', 'wreck', 'building', 'landmark'];

const MEMBERS: Record<PropIndexKind, { has: (o: Obstacle) => boolean; radius: (o: Obstacle) => number }> = {
  sight: { has: (o) => SIGHT_BLOCKING.includes(o.kind), radius: propReach },
  shade: { has: (o) => TIME.obstacleShade[o.kind] !== undefined, radius: (o) => o.r },
  breakable: { has: isBreakable, radius: propReach },
};

class Entry {
  private readonly marks: ObstacleMark[];
  private readonly built: Partial<Record<PropIndexKind, ObstacleBuckets<Slot>>> = {};

  constructor(obstacles: readonly Obstacle[], private readonly size: number) {
    this.marks = marksOf(obstacles);
  }

  matches(obstacles: readonly Obstacle[], size: number): boolean {
    return this.size === size && sameMarks(this.marks, obstacles);
  }

  buckets(kind: PropIndexKind, obstacles: readonly Obstacle[]): ObstacleBuckets<Slot> {
    const hit = this.built[kind];
    if (hit) return hit;
    const { has, radius } = MEMBERS[kind];
    const slots: Slot[] = [];
    obstacles.forEach((o, at) => {
      if (has(o)) slots.push({ pos: o.pos, r: radius(o), at });
    });
    return (this.built[kind] = new ObstacleBuckets(slots, this.size));
  }
}

const KEPT = 4;
const entries: Entry[] = [];

function entryFor(world: World): Entry {
  const { obstacles } = world;
  const size = world.size;
  const at = entries.findIndex((e) => e.matches(obstacles, size));
  if (at === 0) return entries[0];
  const entry = at > 0 ? entries.splice(at, 1)[0] : new Entry(obstacles, size);
  entries.unshift(entry);
  entries.length = Math.min(entries.length, KEPT);
  return entry;
}

export function propsAlong(world: World, kind: PropIndexKind, a: Vec, b: Vec, reach: number): Obstacle[] {
  return propSlotsAlong(world, kind, a, b, reach).map((at) => world.obstacles[at]);
}

export function propSlotsAlong(world: World, kind: PropIndexKind, a: Vec, b: Vec, reach: number): number[] {
  const slots = entryFor(world).buckets(kind, world.obstacles).alongSegment(a, b, reach);
  return slots.filter((s) => segmentDist(s.pos, a, b) <= s.r + reach).map((s) => s.at);
}

export function propsAround(world: World, kind: PropIndexKind, center: Vec, radius: number): Obstacle[] {
  const slots = entryFor(world).buckets(kind, world.obstacles).alongSegment(center, center, radius);
  return slots.filter((s) => dist(center, s.pos) <= s.r + radius).map((s) => world.obstacles[s.at]);
}

export function shadeCastersAround(world: World, center: Vec, radius: number): Obstacle[] {
  return propsAround(world, 'shade', center, radius + TIME.shadeReach);
}
