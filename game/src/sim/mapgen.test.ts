import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { PHYSICS } from '../data/physics';
import { boxDistance, boxSegmentDistance, isBakedObstacle, isBreakable, isDriveObstacle, mapObstacles, propBoxes, propPose, propReach, propShape, segmentCrossesBox } from './mapgen';
import { ROAD_INDEX } from './road-index';
import type { Obstacle } from './types';
import { dist } from './vec';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { PROP_KINDS, type BakedMap, type BakedProp } from './terrain';

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

const prop = (kind: BakedProp['kind'], x: number, extra: Partial<BakedProp> = {}): BakedProp => ({ kind, pos: { x, y: 50 }, r: 1, yaw: 0.5, group: 0, step: 0, ...extra });

function mapWith(props: BakedProp[]): BakedMap {
  return { ...TEST_MAP, props };
}

describe('baked map obstacles', () => {
  it('turns rocks into rock obstacles and other props into landmarks, with ids by prop order', () => {
    const map = mapWith([prop('rock', 10), prop('crag', 20, { yaw: 1.25 }), prop('rock', 30), prop('ruin', 40, { yaw: -2 })]);

    expect(mapObstacles(map)).toEqual([
      { id: 'rock0', pos: { x: 10, y: 50 }, r: 1, kind: 'rock' },
      { id: 'crag-1', pos: { x: 20, y: 50 }, r: 1, kind: 'landmark', look: 'crag', yaw: 1.25 },
      { id: 'rock2', pos: { x: 30, y: 50 }, r: 1, kind: 'rock' },
      { id: 'ruin-3', pos: { x: 40, y: 50 }, r: 1, kind: 'landmark', look: 'ruin', yaw: -2 },
    ]);
  });

  it('names a pole by its power line and its step along it', () => {
    const map = mapWith([prop('rock', 10), prop('pole', 20, { group: 2, step: 0 }), prop('pole', 30, { group: 2, step: 1 })]);

    expect(mapObstacles(map).map((o) => o.id)).toEqual(['rock0', 'pole-2-0', 'pole-2-1']);
  });

  it('refuses two poles with the same line and step', () => {
    const map = mapWith([prop('pole', 20, { group: 2, step: 1 }), prop('pole', 30, { group: 2, step: 1 })]);

    expect(() => mapObstacles(map)).toThrow(/pole-2-1/);
  });

  it('gives the same obstacles for the same map', () => {
    expect(mapObstacles(TEST_MAP)).toEqual(mapObstacles(TEST_MAP));
  });

  it('knows every obstacle it makes as baked, and no other', () => {
    const baked = mapObstacles(mapWith([prop('rock', 10), prop('pole', 20, { group: 4, step: 7 }), prop('tank', 30), prop('bridgeSpan', 40)]));
    const world = newWorld(1337, START_KITS.standard, TEST_MAP);
    const others = world.obstacles.filter((o) => !mapObstacles(TEST_MAP).some((b) => b.id === o.id));
    const runtimeWrecks: Obstacle[] = [{ id: 'wreck-v12', pos: { x: 1, y: 1 }, r: 1, kind: 'wreck' }, { id: 'wreck31', pos: { x: 1, y: 1 }, r: 1, kind: 'wreck' }];

    expect(baked.every(isBakedObstacle)).toBe(true);
    expect(others.length).toBeGreaterThan(0);
    expect([...others, ...runtimeWrecks].some(isBakedObstacle)).toBe(false);
  });

  it('blocks trucks with every landmark', () => {
    const kinds = ['crag', 'ruin', 'house', 'silo', 'waterTower', 'gasStation', 'bridgeSpan', 'pole', 'billboard', 'tank'] as const;
    const blocking = mapObstacles(mapWith(kinds.map((kind, k) => prop(kind, k * 10))));

    for (const o of blocking) expect(isDriveObstacle(o)).toBe(true);
  });
});

describe('breakable props', () => {
  it('only fences and junk piles break', () => {
    const landmarks = mapObstacles(mapWith(PROP_KINDS.filter((k) => k !== 'rock').map((kind, i) => prop(kind, 10 + i * 10))));
    const others: Obstacle[] = [
      { id: 'rock0', pos: { x: 10, y: 50 }, r: 1, kind: 'rock' },
      { id: 'wreck0', pos: { x: 10, y: 50 }, r: 1, kind: 'wreck' },
      { id: 'bld-a-0', pos: { x: 10, y: 50 }, r: 1, kind: 'building' },
      { id: 'pond-a', pos: { x: 10, y: 50 }, r: 1, kind: 'water' },
      { id: 'site-a', pos: { x: 10, y: 50 }, r: 1, kind: 'site' },
    ];

    expect(landmarks.filter(isBreakable).map((o) => (o as Landmark).look).sort()).toEqual(['fence', 'junk']);
    expect(others.filter(isBreakable)).toEqual([]);
  });
});

describe('world from the baked map', () => {
  const world = newWorld(1337, START_KITS.standard, TEST_MAP);
  const baked = world.obstacles.filter(isBakedObstacle);

  it('takes its terrain, hash and baked props from the map', () => {
    expect(world.terrain).toBe(TEST_MAP.terrain);
    expect(world.mapHash).toBe(TEST_MAP.hash);
    expect(baked).toEqual(mapObstacles(TEST_MAP));
    expect(baked.length).toBe(TEST_MAP.props.length);
  });

  it('places the same baked props for every world seed', () => {
    const bakedOf = (seed: number) => newWorld(seed, START_KITS.standard, TEST_MAP).obstacles.filter(isBakedObstacle);
    expect(bakedOf(7)).toEqual(bakedOf(1337));
  });

  it('keeps every baked landmark off every road surface and out of every site', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    const landmarks = baked.filter((o): o is Landmark => o.kind === 'landmark');
    expect(landmarks.length).toBeGreaterThan(0);
    for (const o of landmarks) {
      const reach = REGION.roadWidth / 2 + o.r;
      expect(ROAD_INDEX.nearestWithin(o.pos.x, o.pos.y, reach)).toBe(Infinity);
      expect(sites.every((s) => dist(o.pos, s.pos) > s.radius + o.r)).toBe(true);
    }
  });

  it('overlaps no baked prop with any other obstacle', () => {
    const all = world.obstacles.filter((o) => o.kind !== 'site');
    const ends = (o: Obstacle) => (o.kind === 'landmark' && o.look === 'fence' ? [1, -1].map((k) => ({ x: o.pos.x + k * o.r * Math.cos(o.yaw), y: o.pos.y + k * o.r * Math.sin(o.yaw) })) : []);
    const touching = (a: Obstacle, b: Obstacle) => ends(a).some((p) => ends(b).some((q) => dist(p, q) < 1e-4));
    const overlaps = baked.flatMap((o) => all.filter((other) => other.id !== o.id && dist(o.pos, other.pos) < o.r + other.r - 1e-6 && !touching(o, other)).map((other) => `${o.id} ${other.id}`));
    expect(overlaps).toEqual([]);
  });

  it('rejects a map of another size than the region', () => {
    const small: BakedMap = { ...TEST_MAP, terrain: { size: 10, heights: [], types: [] } };
    expect(() => newWorld(1337, START_KITS.standard, small)).toThrow(/size/);
  });
});

describe('prop poses', () => {
  const S = PHYSICS.metersPerTile;
  const even = (s: number) => ({ x: s, y: s, z: s });
  const landmark = (look: Landmark['look'], r: number, yaw = 0.5): Landmark => ({ id: `${look}-9`, pos: { x: 12, y: 34 }, r, kind: 'landmark', look, yaw });

  it('turns and sizes a rock by its id and radius', () => {
    const pose = propPose({ id: 'rock7', pos: { x: 12, y: 34 }, r: 1.5, kind: 'rock' });

    expect(pose.model).toBe('rock');
    expect(pose.pos).toEqual({ x: 12, y: 34 });
    expect(pose.yaw).toBeCloseTo(-0.8441973181907088 * Math.PI * 2, 12);
    expect(pose.scale).toEqual(even(1.5 * S));
  });

  it('turns a wreck by its id the other way and sizes it from its 0.7-tile reference', () => {
    const pose = propPose({ id: 'wreck3', pos: { x: 12, y: 34 }, r: 0.91, kind: 'wreck' });

    expect(pose.model).toBe('wreck');
    expect(pose.yaw).toBeCloseTo(0.30278265313245356 * Math.PI * 2, 12);
    expect(pose.scale).toEqual(even(0.91 / 0.7));
  });

  it('stretches a building to its footprint, with a height and half turn from its id', () => {
    const seed = 0.4361626429017633;
    const pose = propPose({ id: 'bld-bowl-1', pos: { x: 12, y: 34 }, r: 1, kind: 'building' });

    expect(pose.model).toBe('building');
    expect(pose.yaw).toBeCloseTo(seed * Math.PI, 12);
    expect(pose.scale.x).toBeCloseTo(0.78 * 2 * S, 12);
    expect(pose.scale.y).toBeCloseTo(0.78 * 2 * S, 12);
    expect(pose.scale.z).toBeCloseTo((16 + seed * 20) * (S / 45), 12);
  });

  it('faces a landmark along its baked yaw and scales it evenly to its radius', () => {
    const cases: [Landmark['look'], number, string, number][] = [
      ['crag', 1.2, 'crag', (1.2 * S) / 1],
      ['silo', 2, 'silo', (2 * S) / 2.5],
      ['waterTower', 1, 'water_tower', (1 * S) / 2],
      ['ruin', 1.5, 'ruin_house', (1.5 * S) / 4.8],
      ['gasStation', 2, 'gas_station', (2 * S) / 7.2],
      ['bridgeSpan', 2, 'bridge_broken', (2 * S) / 6],
      ['carWreck', 0.7, 'wreck', (0.7 * S) / (0.7 * S)],
      ['shack', 0.9, 'shack', (0.9 * S) / 3.6],
      ['junk', 0.6, 'junk', (0.6 * S) / 2.4],
      ['fence', 0.5, 'fence', (2 * 0.5 * S) / 4],
      ['billboard', 2, 'billboard', 1],
      ['tank', 1.5, 'tank_hulk', 1],
    ];

    for (const [look, r, model, scale] of cases) expect(propPose(landmark(look, r)), look).toEqual({ model, pos: { x: 12, y: 34 }, yaw: 0.5, scale: even(scale) });
  });

  it('turns a power pole a quarter turn off its line, so its crossbar lies across it', () => {
    expect(propPose(landmark('pole', 0.4))).toEqual({ model: 'power_pole', pos: { x: 12, y: 34 }, yaw: 0.5 + Math.PI / 2, scale: even(1) });
  });

  it('stretches a house like a settlement building', () => {
    const pose = propPose(landmark('house', 1.5));

    expect(pose.model).toBe('building');
    expect(pose.yaw).toBe(0.5);
    expect(pose.scale.x).toBeCloseTo(1.5 * 0.78 * 2 * S, 12);
    expect(pose.scale.z).toBeGreaterThanOrEqual(16 * (S / 45));
    expect(pose.scale.z).toBeLessThan(36 * (S / 45));
  });

  it('refuses obstacles with no model', () => {
    expect(() => propPose({ id: 'site-bowl', pos: { x: 1, y: 1 }, r: 5, kind: 'site' })).toThrow(/site-bowl/);
    expect(() => propPose({ id: 'pond-oasis', pos: { x: 1, y: 1 }, r: 2, kind: 'water' })).toThrow(/pond-oasis/);
  });

  it('reaches the farthest posed box corner of every baked prop', () => {
    const corners = (o: Obstacle) => {
      const pose = propPose(o);
      const c = Math.cos(pose.yaw);
      const s = Math.sin(pose.yaw);
      return propShape(pose.model).flatMap((b) => [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].map((y) => Math.hypot(x * pose.scale.x * c + y * pose.scale.y * s, x * pose.scale.x * s - y * pose.scale.y * c) / S)));
    };
    const misses = mapObstacles(TEST_MAP).flatMap((o) => {
      const farthest = Math.max(...corners(o));
      return Math.abs(propReach(o) - farthest) > 1e-9 ? [`${o.id} reach ${propReach(o)} farthest ${farthest}`] : [];
    });

    expect(misses).toEqual([]);
  });

  it('places a box where the view draws it: model x along yaw, model y toward map -y', () => {
    const station = (yaw: number): Landmark => ({ id: 'gasStation-9', pos: { x: 10, y: 20 }, r: 7.2 / S, kind: 'landmark', look: 'gasStation', yaw });
    const pump = (o: Obstacle) => propBoxes(o)[0];

    expect(pump(station(0)).center.x).toBeCloseTo(10 + 5.955 / S, 9);
    expect(pump(station(0)).center.y).toBeCloseTo(20 + 4.11 / S, 9);
    expect(pump(station(Math.PI / 2)).center.x).toBeCloseTo(10 - 4.11 / S, 9);
    expect(pump(station(Math.PI / 2)).center.y).toBeCloseTo(20 + 5.955 / S, 9);
    expect(pump(station(0)).half.x).toBeCloseTo(1.91 / 2 / S, 9);
    expect(pump(station(0)).z1).toBeCloseTo(0.38, 9);
  });

  it('tells distance to a box outline and whether a segment crosses it', () => {
    const fence = propBoxes({ id: 'fence-9', pos: { x: 10, y: 10 }, r: 0.5, kind: 'landmark', look: 'fence', yaw: 0 })[0];

    expect(boxDistance(fence, { x: 10, y: 10 })).toBe(0);
    expect(boxDistance(fence, { x: 10 + 0.125 + 1, y: fence.center.y })).toBeCloseTo(1, 9);
    expect(segmentCrossesBox(fence, { x: 10, y: 5 }, { x: 10, y: 15 })).toBe(true);
    expect(segmentCrossesBox(fence, { x: 11, y: 5 }, { x: 11, y: 15 })).toBe(false);
    expect(segmentCrossesBox(fence, { x: 10, y: 5 }, { x: 10, y: 9 })).toBe(false);
    expect(boxSegmentDistance(fence, { x: 10, y: 5 }, { x: 10, y: 15 })).toBe(0);
    expect(boxSegmentDistance(fence, { x: 11.125, y: 5 }, { x: 11.125, y: 15 })).toBeCloseTo(1, 9);
    const corner = { x: fence.center.x + fence.half.x, y: fence.center.y + fence.half.y };
    expect(boxSegmentDistance(fence, { x: 10.625, y: 10 }, { x: 10.125, y: 10.5 })).toBeCloseTo((20.625 - corner.x - corner.y) / Math.SQRT2, 9);
  });

  it('refuses a model with no shape', () => {
    expect(() => propShape('nothing')).toThrow(/nothing/);
  });
});
