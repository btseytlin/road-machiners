import { describe, expect, it } from 'vitest';
import { GAUNTLET } from '../data/gauntlet';
import { REGION } from '../data/region';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { courseLine, progressOf } from './gauntlet-layout';
import { isBakedObstacle } from './mapgen';
import { route } from './path';
import { defaultSetup } from './settings';
import { vehicleStats } from './stats';
import type { GauntletRun, Obstacle, World } from './types';
import { dist, type Vec } from './vec';
import { newWorld } from './world';

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

function gauntletWorld(seed: number): World {
  return newWorld(seed, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
}

function runOf(world: World): GauntletRun {
  if (!world.gauntlet) throw new Error('No Gauntlet run');
  return world.gauntlet;
}

function rows(world: World): Map<string, Obstacle[]> {
  const out = new Map<string, Obstacle[]>();
  for (const o of world.obstacles) {
    const row = /^run-row(\d+-\d+)-\d+$/.exec(o.id)?.[1];
    if (row) out.set(row, [...(out.get(row) ?? []), o]);
  }
  return out;
}

function townGap(pos: Vec): number {
  return Math.min(...REGION.towns.map((t) => dist(pos, t.pos) - t.radius));
}

describe('a Gauntlet course', () => {
  it('blocks at most two of the four lanes in every row, as the stretch allows', () => {
    for (const seed of SEEDS) {
      const world = gauntletWorld(seed);
      for (const [row, pieces] of rows(world)) {
        const stretch = Number(row.split('-')[0]);
        expect(pieces.length, `seed ${seed} row ${row}`).toBeLessThanOrEqual(GAUNTLET.maxBlocked[stretch]);
        expect(pieces.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps rows apart and lays every stretch its rows', () => {
    for (const seed of SEEDS) {
      const world = gauntletWorld(seed);
      const line = courseLine(runOf(world).course);
      const spots = [...rows(world).values()].map((pieces) => progressOf(line, pieces[0].pos)).sort((a, b) => a - b);
      expect(spots).toHaveLength(GAUNTLET.rowsPerStretch.reduce((a, b) => a + b, 0));
      for (let i = 1; i < spots.length; i++) expect(spots[i] - spots[i - 1], `seed ${seed}`).toBeGreaterThan(GAUNTLET.rowGap - 1);
    }
  });

  it('keeps rows, pads and group anchors out of the towns', () => {
    for (const seed of SEEDS) {
      const world = gauntletWorld(seed);
      const run = runOf(world);
      const line = courseLine(run.course);
      for (const pieces of rows(world).values()) for (const o of pieces) expect(townGap(o.pos)).toBeGreaterThan(GAUNTLET.townMargin - 3);
      for (const post of run.outposts) expect(townGap(post.pad)).toBeGreaterThan(GAUNTLET.townMargin - GAUNTLET.outpost.padOffset);
      for (const group of run.groups) expect(group.at).toBeGreaterThan(run.course.start);
      for (const group of run.groups) expect(group.at).toBeLessThan(run.course.end);
      expect(townGap(playerVehicle(world).pos)).toBeGreaterThan(GAUNTLET.townMargin - 3);
      expect(progressOf(line, playerVehicle(world).pos)).toBeCloseTo(run.course.start, 0);
    }
  });

  it('places an outpost at the end of each stretch, in order along the course', () => {
    const run = runOf(gauntletWorld(3));

    expect(run.outposts.map((o) => o.name)).toEqual(['Outpost 1', 'Outpost 2', 'Outpost 3', 'Outpost 4']);
    expect(run.outposts.map((o) => o.at)).toEqual([...run.outposts.map((o) => o.at)].sort((a, b) => a - b));
    expect(run.outposts.map((o) => o.stock.length)).toEqual(GAUNTLET.stockSize);
    expect(run.outposts.every((o) => !o.paid)).toBe(true);
  });

  it('plans more and better armed groups in later stretches', () => {
    const run = runOf(gauntletWorld(3));
    const trucks = (k: number) => run.groups.filter((g) => g.stretch === k).reduce((n, g) => n + g.templates.length, 0);

    expect(trucks(0)).toBe(1);
    expect(trucks(3)).toBe(9);
    for (let k = 1; k < 4; k++) expect(trucks(k)).toBeGreaterThanOrEqual(trucks(k - 1));
    expect(run.groups.filter((g) => g.stretch === 0).map((g) => g.level)).toEqual(['light']);
    expect(run.groups.filter((g) => g.stretch === 3).every((g) => g.level === 'heavy')).toBe(true);
  });

  it('gives the same seed the same course, rows, outposts, stock and groups', () => {
    const a = gauntletWorld(11);
    const b = gauntletWorld(11);

    expect(b.gauntlet).toEqual(a.gauntlet);
    expect(b.obstacles).toEqual(a.obstacles);
  });

  it('marks its rows and outpost props as world facts, not baked props', () => {
    const world = gauntletWorld(5);
    const run = world.obstacles.filter((o) => o.id.startsWith('run-'));

    expect(run.length).toBeGreaterThan(0);
    expect(run.some(isBakedObstacle)).toBe(false);
  });

  it('leaves a route from the start through every outpost pad', () => {
    for (const seed of SEEDS.filter((s) => s % 5 === 0 || s < 4)) {
      const world = gauntletWorld(seed);
      const me = playerVehicle(world);
      const radius = vehicleStats(world, me).radius;
      let from = me.pos;
      for (const post of runOf(world).outposts) {
        const points = route(world, from, post.pad, radius, []);
        expect(dist(points[points.length - 1], post.pad), `seed ${seed} ${post.name}`).toBeLessThan(GAUNTLET.outpost.padRadius);
        from = post.pad;
      }
    }
  });
});
