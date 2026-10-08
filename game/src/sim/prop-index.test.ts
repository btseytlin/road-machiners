import { describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { TIME } from '../data/time';
import { TEST_MAP } from '../test/map';
import { isBreakable, propReach } from './mapgen';
import { propsAlong, propsAround, propSlotsAlong, shadeCastersAround } from './prop-index';
import type { Obstacle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';
import { newWorld } from './world';
import { defaultSetup } from './settings';

const SIGHT_KINDS: Obstacle['kind'][] = ['rock', 'wreck', 'building', 'landmark'];

// The full scans the index replaced, kept as the reference answers.
const scanSight = (w: World, a: Vec, b: Vec) => w.obstacles.filter((o) => SIGHT_KINDS.includes(o.kind) && dist(a, o.pos) < dist(a, b) + propReach(o));
const scanSightAround = (w: World, c: Vec, r: number) => w.obstacles.filter((o) => SIGHT_KINDS.includes(o.kind) && dist(c, o.pos) < r + propReach(o));
const scanShade = (w: World, c: Vec, r: number) => w.obstacles.filter((o) => TIME.obstacleShade[o.kind] !== undefined && dist(c, o.pos) <= r + TIME.shadeReach + o.r);
const scanBreakable = (w: World, a: Vec, b: Vec, reach: number) => w.obstacles.filter((o) => isBreakable(o) && segmentDist(o.pos, a, b) < propReach(o) + reach);

function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function worldAndSamples(): { w: World; points: Vec[] } {
  const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  const next = lcg(7);
  const points = Array.from({ length: 80 }, () => ({ x: next() * w.size, y: next() * w.size }));
  return { w, points };
}

describe('prop index', () => {
  it('leaves out only props a sight line cannot touch', () => {
    const { w, points } = worldAndSamples();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = { x: a.x + (points[i].x - a.x) * 0.3, y: a.y + (points[i].y - a.y) * 0.3 };
      const indexed = new Set(propsAlong(w, 'sight', a, b, 0));
      const scanned = scanSight(w, a, b);
      for (const o of scanned) if (!indexed.has(o)) expect(segmentDist(o.pos, a, b)).toBeGreaterThanOrEqual(propReach(o));
      for (const o of indexed) expect(scanned).toContain(o);
    }
  });

  it('finds every sight blocker around a point', () => {
    const { w, points } = worldAndSamples();
    for (const c of points) {
      const indexed = new Set(propsAround(w, 'sight', c, 25));
      for (const o of scanSightAround(w, c, 25)) expect(indexed.has(o)).toBe(true);
    }
  });

  it('gives the same shade casters as a full scan', () => {
    const { w, points } = worldAndSamples();
    for (const c of points) {
      expect(new Set(shadeCastersAround(w, c, 3))).toEqual(new Set(scanShade(w, c, 3)));
    }
  });

  it('finds every breakable prop a walk can touch, in world order', () => {
    const { w, points } = worldAndSamples();
    let found = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = { x: a.x + (points[i].x - a.x) * 0.2, y: a.y + (points[i].y - a.y) * 0.2 };
      const slots = propSlotsAlong(w, 'breakable', a, b, 1);
      const indexed = new Set(slots.map((at) => w.obstacles[at]));
      for (const o of scanBreakable(w, a, b, 1)) {
        expect(indexed.has(o)).toBe(true);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('serves a cloned world from the same index and returns the clone own objects', () => {
    const { w, points } = worldAndSamples();
    const clone = structuredClone(w);
    const c = points[0];
    const before = propsAround(w, 'sight', c, 30);
    const after = propsAround(clone, 'sight', c, 30);
    expect(after.map((o) => o.id).sort()).toEqual(before.map((o) => o.id).sort());
    for (const o of after) expect(clone.obstacles).toContain(o);
  });

  it('rebuilds when an obstacle leaves or joins the world', () => {
    const { w } = worldAndSamples();
    const rock = w.obstacles.find((o) => o.kind === 'rock');
    if (!rock) throw new Error('The test map has no rock');
    expect(propsAround(w, 'sight', rock.pos, 1).map((o) => o.id)).toContain(rock.id);

    w.obstacles = w.obstacles.filter((o) => o !== rock);
    expect(propsAround(w, 'sight', rock.pos, 1).map((o) => o.id)).not.toContain(rock.id);

    w.obstacles.push(rock);
    expect(propsAround(w, 'sight', rock.pos, 1).map((o) => o.id)).toContain(rock.id);
  });
});
