import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { FURY_ROAD, HIGHWAY } from '../data/modes';
import { TERRAIN } from '../data/terrain';
import { atlasOf } from './atlas';
import { REGION } from '../data/region';
import { fortressProps } from './fortress';
import { deckAt } from './bridge';
import { acrossOf, centerU, fromRoad, highwayMap, highwayStart, milestoneAt, outpostFort, roadAt, roadHeading, roadHeight, roadPoint, roadVector, stretchOf, toRoad, WINDOW_SHIFT, windowSpan } from './highway';
import { isBakedObstacle, mapObstacles } from './mapgen';
import { northClosureAt, sceneAt, southClosureAt } from './road-hazards';
import { canUseSite, sitePads } from './sites';
import { CELL, componentOf, navLayer } from './nav/layer';
import { groundAt, heightAt, isCliff, type BakedMap, type BakedProp } from './terrain';

const SIZE = HIGHWAY.size;
const STRIDE = HIGHWAY.stride;
const OVERLAP = SIZE - STRIDE;
const ROAD = HIGHWAY.road;
const NORTH = -Math.PI / 2;
const DEGREE = Math.PI / 180;

function propKey(p: BakedProp, shift: number): string {
  return [p.kind, (p.pos.x + shift * WINDOW_SHIFT.x / STRIDE).toFixed(4), (p.pos.y + shift * WINDOW_SHIFT.y / STRIDE).toFixed(4), p.yaw.toFixed(4), p.r.toFixed(4)].join(':');
}

function inBand(p: BakedProp, from: number, to: number): boolean {
  return p.pos.y >= from + 3 && p.pos.y <= to - 3 && p.pos.x >= 3 && p.pos.x <= SIZE - 3;
}

function typeAt(map: BakedMap, p: { x: number; y: number }): string {
  return map.terrain.types[Math.floor(p.y) * SIZE + Math.floor(p.x)];
}

describe('the road frame', () => {
  it('turns a map spot into along and across distances and back', () => {
    for (const window of [0, 3]) {
      const p = { x: 123.5, y: 77.25 };
      const at = toRoad(window, p);
      const back = fromRoad(window, at.n, at.u);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('runs map north, toward the top right of the screen, with each milestone at the same spot of its window', () => {
    expect(roadVector(1, 0)).toEqual({ x: 0, y: -1 });
    expect(WINDOW_SHIFT).toEqual({ x: 0, y: STRIDE });
    for (const k of [0, 1, 4]) {
      const south = fromRoad(k, milestoneAt(k), 0);
      const north = fromRoad(k, milestoneAt(k + 1), 0);
      expect([south.x, south.y].map((v) => +v.toFixed(6))).toEqual([SIZE / 2, SIZE - HIGHWAY.milestoneInset]);
      expect([north.x, north.y].map((v) => +v.toFixed(6))).toEqual([SIZE / 2, HIGHWAY.milestoneInset]);
      expect(toRoad(k + 1, { x: north.x + WINDOW_SHIFT.x, y: north.y + WINDOW_SHIFT.y }).n).toBeCloseTo(milestoneAt(k + 1), 9);
      expect(windowSpan(k)).toEqual({ from: k * STRIDE, to: k * STRIDE + SIZE });
    }
  });
});

describe('a highway window', () => {
  it('builds the same land every time, in any order', () => {
    const later = [3, 1, 2].map((w) => highwayMap(5, w));
    const first = [1, 2, 3].map((w) => highwayMap(5, w));

    expect(later).toEqual([first[2], first[0], first[1]]);
    expect(highwayMap(5, 0)).toEqual(highwayMap(5, 0));
  });

  it('agrees with the next window in their overlap square, but for the two closures', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const k of [0, 1, 2, 3, 4]) {
        const a = highwayMap(seed, k);
        const b = highwayMap(seed, k + 1);
        const row = SIZE + 1;
        expect(a.terrain.heights.slice(0, (OVERLAP + 1) * row), `seed ${seed} window ${k}`).toEqual(b.terrain.heights.slice(STRIDE * row));
        expect(a.terrain.types.slice(0, OVERLAP * SIZE), `seed ${seed} window ${k}`).toEqual(b.terrain.types.slice(STRIDE * SIZE));
        const open = (window: number) => (p: BakedProp) => [northClosureAt(k), southClosureAt(k + 1)].every((n) => Math.abs(toRoad(window, p.pos).n - n) > 5);
        const fromA = a.props.filter((p) => inBand(p, 0, OVERLAP)).filter(open(k));
        const fromB = b.props.filter((p) => inBand(p, STRIDE, SIZE)).filter(open(k + 1));
        expect(fromB.map((p) => propKey(p, -STRIDE)).sort(), `seed ${seed} window ${k}`).toEqual(fromA.map((p) => propKey(p, 0)).sort());
      }
    }
  });

  it('lays four lanes of asphalt, a flat verge, badlands and ridges by the distance from the centerline', () => {
    for (const seed of [1, 2, 3]) {
      const map = highwayMap(seed, 1);
      const span = windowSpan(1);
      for (let n = span.from + 60; n < span.to - 60; n += 9) {
        if ([1, 2].some((j) => Math.abs(n - milestoneAt(j)) < 14) || sceneAt(seed, n, 4) !== null) continue;
        const at = (d: number) => roadPoint(seed, 1, n, d);
        for (const side of [-1, 1]) {
          expect(typeAt(map, at(side * 4.2))).toBe('asphalt');
          for (const d of [5.8, 9, 13, 17.2]) expect(['hardpan', 'sand']).toContain(typeAt(map, at(side * d)));
          for (const d of [18.8, 22, 25.2]) expect(['gravel', 'scrub', 'scree']).toContain(typeAt(map, at(side * d)));
          expect(typeAt(map, at(side * 30))).toBe('scree');
          for (const d of [3, 8, 14]) expect(heightAt(map.terrain, at(side * d).x, at(side * d).y)).toBeCloseTo(roadHeight(seed, roadAt(seed, n, side * d).n), 1);
          const ridge = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => at(side * (ROAD.badlands + 0.5 * k)));
          expect(ridge.some((p) => isCliff(map.terrain, Math.floor(p.y) * SIZE + Math.floor(p.x))), `seed ${seed} n ${n} side ${side}`).toBe(true);
          for (let d = 0; d <= ROAD.verge; d += 1.5) {
            const p = at(side * d);
            expect(isCliff(map.terrain, Math.floor(p.y) * SIZE + Math.floor(p.x)), `seed ${seed} n ${n} d ${d}`).toBe(false);
          }
        }
      }
    }
  });

  it('makes every prop a baked obstacle with its own id, inside the window', () => {
    const map = highwayMap(4, 3);
    const obstacles = mapObstacles(map);

    expect(obstacles.every(isBakedObstacle)).toBe(true);
    expect(obstacles.every((o) => o.pos.x >= o.r && o.pos.y >= o.r && o.pos.x <= SIZE - o.r && o.pos.y <= SIZE - o.r)).toBe(true);
  });

  it('shows no Icarus feature', () => {
    const map = highwayMap(3, 1);
    const atlas = atlasOf(map.terrain);

    expect([atlas.towns, atlas.hazards]).toEqual([[], []]);
    expect(atlas.decks.decks.every((d) => d.id.startsWith('ramp-') && d.look === 'ship_flap')).toBe(true);
    expect(atlas.locations.map((l) => l.id)).toEqual(['outpost-1', 'outpost-2']);
    expect(atlas.oldSpots || atlas.landforms).toBe(false);
    expect(atlas.roads).toHaveLength(1);
    expect(atlas.roads[0].lanes).toBe(4);
    expect(atlas.roads[0].width).toBe(10);
    const offRamps = (x: number, y: number) => deckAt(atlas.decks, x, y) === null;
    for (let y = 0; y < SIZE; y += 7) for (let x = 0; x < SIZE; x += 7) if (offRamps(x + 0.3, y + 0.6)) expect(heightAt(map.terrain, x + 0.3, y + 0.6)).toBe(groundAt(map.terrain, x + 0.3, y + 0.6));
  });

  it('starts the truck on a lane at the first milestone, facing north', () => {
    const start = highwayStart(7);
    const map = highwayMap(7, 0);

    expect(typeAt(map, start.pos)).toBe('asphalt');
    expect(start.heading).toBeCloseTo(NORTH, 9);
    expect(toRoad(0, start.pos).n).toBeCloseTo(milestoneAt(0), 0);
  });

  it('builds a window in well under the boot budget', () => {
    const started = performance.now();
    highwayMap(11, 7);
    const ms = performance.now() - started;
    console.info(`highway window built in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe('the highway road', () => {
  it('keeps within 35 degrees of north, its bends wide and its grade under the road limit', () => {
    const bendRadius = 40;
    for (let seed = 1; seed <= 30; seed++) {
      for (let n = milestoneAt(0); n < milestoneAt(8); n += 1) {
        expect(Math.abs(roadHeight(seed, n + 1) - roadHeight(seed, n))).toBeLessThan(TERRAIN.roadGrade);
        expect(Math.abs(roadHeading(seed, n) - NORTH), `seed ${seed} n ${n}`).toBeLessThanOrEqual(35 * DEGREE);
        const bend = Math.abs(centerU(seed, n + 1) - 2 * centerU(seed, n) + centerU(seed, n - 1));
        expect(1 / Math.max(bend, 1e-9), `seed ${seed} n ${n}`).toBeGreaterThanOrEqual(bendRadius);
      }
    }
  });

  it('runs straight in the middle of the window near every milestone', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (let j = 0; j <= 8; j++) {
        for (let d = -ROAD.bend.ends; d <= ROAD.bend.ends; d += 2) expect(centerU(seed, milestoneAt(j) + d), `seed ${seed} milestone ${j} d ${d}`).toBe(0);
      }
    }
  });

  it('bends in many stretches, now to one side and now to the other', () => {
    const swings: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      for (let j = 1; j <= 8; j++) {
        const mid = (milestoneAt(j - 1) + milestoneAt(j)) / 2;
        expect(stretchOf(mid)).toBe(j);
        swings.push(centerU(seed, mid));
      }
    }
    const bent = swings.filter((w) => Math.abs(w) >= ROAD.bend.shift[0]);

    expect(bent.length).toBeGreaterThanOrEqual(swings.length / 5);
    expect(bent.some((w) => w > 0) && bent.some((w) => w < 0)).toBe(true);
    expect(swings.every((w) => Math.abs(w) <= ROAD.bend.shift[1])).toBe(true);
  });

  it('keeps the lanes on asphalt and the verge off it on bends', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const k of [0, 1, 2]) {
        const map = highwayMap(seed, k);
        for (let n = milestoneAt(k) + ROAD.bend.ends; n < milestoneAt(k + 1) - ROAD.bend.ends; n += 2) {
          if (sceneAt(seed, n, 4) !== null) continue;
          for (const side of [-1, 1]) {
            expect(typeAt(map, roadPoint(seed, k, n, side * 4.2)), `seed ${seed} n ${n} side ${side}`).toBe('asphalt');
            expect(typeAt(map, roadPoint(seed, k, n, side * 5.8)), `seed ${seed} n ${n} side ${side}`).not.toBe('asphalt');
          }
        }
      }
    }
  });

  it('lets the widest truck drive from the south milestone to the north outpost pad', () => {
    const radius = CHASSIS.hauler.radius;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const k of [0, 1, 2, 3]) {
        const map = highwayMap(seed, k);
        const layer = navLayer(map.terrain, mapObstacles(map), radius);
        const from = k === 0 ? highwayStart(seed).pos : padOf(seed, k, k);
        const to = padOf(seed, k, k + 1);
        const start = componentOf(layer, cellOf(from));
        expect(start, `seed ${seed} window ${k} start`).not.toBe(0);
        expect(componentOf(layer, cellOf(to)), `seed ${seed} window ${k}`).toBe(start);
      }
    }
  });
});

function padOf(seed: number, window: number, j: number) {
  return sitePads(outpostFort(seed, window, j))[0];
}

function cellOf(p: { x: number; y: number }): number {
  const n = Math.ceil(SIZE / CELL);
  return Math.floor(p.y / CELL) * n + Math.floor(p.x / CELL);
}

describe('an outpost fort', () => {
  const SALVAGE_YARD = REGION.locations.find((l) => l.id === 'salvage-yard')!;
  const kinds = (props: { kind: string }[]) => props.map((p) => p.kind).sort();

  it('is a Salvage Yard fort of baked props beside the road, with its gate facing the road', () => {
    for (const seed of [1, 2, 3, 4]) {
      for (const k of [0, 1]) {
        const map = highwayMap(seed, k);
        const fort = outpostFort(seed, k, k + 1);
        const pieces = fortressProps(fort);
        const keys = new Set(map.props.map((p) => propKey(p, 0)));

        expect(kinds(pieces)).toEqual(kinds(fortressProps(SALVAGE_YARD)));
        expect(pieces.every((p) => keys.has(propKey(p, 0)))).toBe(true);
        const d = Math.abs(acrossOf(seed, toRoad(k, fort.pos)));
        expect(d).toBeCloseTo(FURY_ROAD.outpost.across, 0);
        const gate = fort.gates![0];
        expect(Math.abs(acrossOf(seed, toRoad(k, gate)))).toBeLessThan(d);
      }
    }
  });

  it('has a flat concrete pad between its gate and the road, where the town rule lets a truck use it', () => {
    for (const seed of [1, 2, 3, 4]) {
      const map = highwayMap(seed, 0);
      const fort = outpostFort(seed, 0, 1);
      const pad = sitePads(fort)[0];
      const d = Math.abs(acrossOf(seed, toRoad(0, pad)));

      expect(canUseSite(pad, fort)).toBe(true);
      expect(typeAt(map, pad)).toBe('concrete');
      expect(d).toBeGreaterThan(ROAD.asphalt + 2);
      expect(d).toBeLessThan(FURY_ROAD.outpost.across);
      const ground = heightAt(map.terrain, pad.x, pad.y);
      for (const p of [fort.pos, fort.gates![0]]) expect(heightAt(map.terrain, p.x, p.y)).toBeCloseTo(ground, 0);
      const between = { x: (pad.x + fort.gates![0].x) / 2, y: (pad.y + fort.gates![0].y) / 2 };
      expect(typeAt(map, between)).toBe('concrete');
    }
  });

  it('can be reached from the asphalt by the widest truck', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const map = highwayMap(seed, 0);
      const layer = navLayer(map.terrain, mapObstacles(map), CHASSIS.hauler.radius);
      const road = roadPoint(seed, 0, milestoneAt(1) - 20, ROAD.lanes[0]);
      expect(componentOf(layer, cellOf(padOf(seed, 0, 1))), `seed ${seed}`).toBe(componentOf(layer, cellOf(road)));
    }
  });
});
