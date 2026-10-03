import { describe, expect, it } from 'vitest';
import { BROKEN_WING, BROKEN_WING_POINT, REGION } from '../data/region';
import { TERRITORIES } from '../data/territory';
import { START_KITS } from '../data/start';
import { PHYSICS } from '../data/physics';
import { blockingBoxes, boxDistance, boxSegmentDistance, isBakedObstacle, isBreakable, isDriveObstacle, mapObstacles, propBoxes, propKey, propPose, propReach, propShape, segmentCrossesBox } from './mapgen';
import { hulkBoxes } from './body';
import { ROAD_INDEX } from './road-index';
import type { Obstacle } from './types';
import { dist, segmentDist, type Vec } from './vec';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { groundAt, PROP_KINDS, type BakedMap, type BakedProp } from './terrain';
import { budget } from '../test/budget';

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

const prop = (kind: BakedProp['kind'], x: number, extra: Partial<BakedProp> = {}): BakedProp => ({ kind, pos: { x, y: 50 }, r: 1, yaw: 0.5, group: 0, step: 0, ...extra });

// A map with the test terrain and a short list of props of several kinds.
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
  it('only fences, junk piles and dead trees break', () => {
    const landmarks = mapObstacles(mapWith(PROP_KINDS.filter((k) => k !== 'rock').map((kind, i) => prop(kind, 10 + i * 10))));
    const others: Obstacle[] = [
      { id: 'rock0', pos: { x: 10, y: 50 }, r: 1, kind: 'rock' },
      { id: 'wreck0', pos: { x: 10, y: 50 }, r: 1, kind: 'wreck' },
      { id: 'bld-a-0', pos: { x: 10, y: 50 }, r: 1, kind: 'building' },
      { id: 'pond-a', pos: { x: 10, y: 50 }, r: 1, kind: 'water' },
      { id: 'site-a', pos: { x: 10, y: 50 }, r: 1, kind: 'site' },
    ];

    expect(landmarks.filter(isBreakable).map((o) => (o as Landmark).look).sort()).toEqual(['deadTree', 'fence', 'junk']);
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
    // A territory's own props stand inside it.
    const sites = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
    // The ship wing is the exception: it hangs over its road and reaches the Broken Wing hull by design.
    const landmarks = baked.filter((o): o is Landmark => o.kind === 'landmark' && o.look !== 'shipWing');
    expect(landmarks.length).toBeGreaterThan(0);
    for (const o of landmarks) {
      const reach = REGION.roadWidth / 2 + o.r;
      expect(ROAD_INDEX.nearestWithin(o.pos.x, o.pos.y, reach)).toBe(Infinity);
      expect(sites.every((s) => dist(o.pos, s.pos) > s.radius + o.r)).toBe(true);
    }
  });

  it('overlaps no baked prop with any other obstacle', () => {
    const all = world.obstacles.filter((o) => o.kind !== 'site');
    // Fence segments of a line, and the segments of a territory farm's runs, meet end to end. On a camp ring they
    // meet at an angle, so their circles overlap a little, but the segments only touch. The map stores positions as
    // float32, off by up to 6e-5 tiles at x = 600.
    const segmentLooks = new Set<string>(['fence', ...Object.values(TERRITORIES).flatMap((t) => t.farm?.runs.map((run) => run.look) ?? [])]);
    const ends = (o: Obstacle) => (o.kind === 'landmark' && segmentLooks.has(o.look) ? [1, -1].map((k) => ({ x: o.pos.x + k * o.r * Math.cos(o.yaw), y: o.pos.y + k * o.r * Math.sin(o.yaw) })) : []);
    const touching = (a: Obstacle, b: Obstacle) => ends(a).some((p) => ends(b).some((q) => dist(p, q) < 1e-4));
    // A hull rib is an arch: only its two legs stand on the ground, r to each side along its yaw, and the model's leg
    // reaches under a sixth of r each way. Other props stand under the arch between them.
    const ground = (o: Obstacle): { pos: Vec; r: number }[] =>
      o.kind === 'landmark' && o.look === 'hullRib' ? [1, -1].map((k) => ({ pos: { x: o.pos.x + k * o.r * Math.cos(o.yaw), y: o.pos.y + k * o.r * Math.sin(o.yaw) }, r: o.r / 6 })) : [{ pos: o.pos, r: o.r }];
    // A segment prop is a line r to each side of its centre, not a disc: it overlaps a disc that reaches its line, and
    // another segment that its line crosses.
    const line = (o: Obstacle): [Vec, Vec] | null => (ends(o).length === 2 ? (ends(o) as [Vec, Vec]) : null);
    const crosses = ([a, b]: [Vec, Vec], [c, e]: [Vec, Vec]) => {
      const side = (p: Vec, q: Vec, r: Vec) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      return side(a, b, c) * side(a, b, e) < 0 && side(c, e, a) * side(c, e, b) < 0;
    };
    const overlap = (a: Obstacle, b: Obstacle) => {
      const [la, lb] = [line(a), line(b)];
      if (la && lb) return crosses(la, lb);
      if (la) return ground(b).some((q) => segmentDist(q.pos, la[0], la[1]) < q.r - 1e-6);
      if (lb) return ground(a).some((p) => segmentDist(p.pos, lb[0], lb[1]) < p.r - 1e-6);
      return ground(a).some((p) => ground(b).some((q) => dist(p.pos, q.pos) < p.r + q.r - 1e-6));
    };
    const overlaps = baked.flatMap((o) => all.filter((other) => other.id !== o.id && overlap(o, other) && !touching(o, other)).map((other) => `${o.id} ${other.id}`));
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

  it('poses a kill wreck with a hulk as its chassis, at full size along the dead truck heading', () => {
    const hulk = (chassisId: string, yaw: number, id = 'wreck-npc7'): Obstacle => ({ id, pos: { x: 12, y: 34 }, r: 0.9, kind: 'wreck', hulk: { chassisId, yaw } });
    const flat = propBoxes(hulk('bus', 0));
    const turned = propBoxes(hulk('bus', Math.PI / 2));

    expect(propPose(hulk('bus', 0.4))).toEqual({ model: 'hulk', chassisId: 'bus', pos: { x: 12, y: 34 }, yaw: 0.4, scale: even(1) });
    expect(flat.map((b) => b.z0)).toEqual(hulkBoxes('bus').map((b) => b.z0));
    flat.forEach((b, i) => {
      // A quarter turn carries map offset (x, y) to (-y, x).
      expect(turned[i].center.x - 12).toBeCloseTo(-(b.center.y - 34), 9);
      expect(turned[i].center.y - 34).toBeCloseTo(b.center.x - 12, 9);
    });
    expect(propKey(hulk('bus', 0))).not.toBe(propKey(hulk('buggy', 0)));
    expect(propReach(hulk('bus', 0))).toBeGreaterThan(propReach(hulk('buggy', 0)));
    expect(blockingBoxes(hulk('buggy', 0)).length).toBeGreaterThan(0);
  });

  it('keeps the generic wreck pose and shape for a kill wreck without a hulk', () => {
    const plain: Obstacle = { id: 'wreck-npc7', pos: { x: 12, y: 34 }, r: 0.9, kind: 'wreck' };

    expect(propPose(plain).model).toBe('wreck');
    expect(propKey(plain).startsWith('wreck|')).toBe(true);
    expect(propBoxes(plain).length).toBe(propShape('wreck').length);
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

  it('draws each orchard look with its own model, at full size at the radius it is built to', () => {
    // Footprint radii in meters, from each model's tools/blender script.
    const cases: [Landmark['look'], number, string][] = [
      ['farmhouse', 16, 'farmhouse'],
      ['barn', 14.7, 'barn'],
      ['quonset', 12.9, 'quonset'],
      ['bunker', 15.6, 'bunker'],
      ['guardPost', 3.2, 'guard_post'],
      ['armyTruck', 4.4, 'army_truck'],
      ['barrier', 2, 'barrier'],
      ['fence', 2, 'fence'],
      ['drums', 1.75, 'drums'],
      ['woodpile', 2.6, 'woodpile'],
    ];

    for (const [look, meters, model] of cases) {
      const pose = propPose(landmark(look, meters / PHYSICS.metersPerTile));
      expect({ ...pose, scale: undefined }, look).toEqual({ model, pos: { x: 12, y: 34 }, yaw: 0.5, scale: undefined });
      for (const axis of ['x', 'y', 'z'] as const) expect(pose.scale[axis], `${look} ${axis}`).toBeCloseTo(1, 9);
    }
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
      // The view's turn: model x runs along yaw, model y along (sin, -cos).
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
    const pump = (o: Obstacle) => propBoxes(o)[0]; // model box x 5 to 6.91, y -4.72 to -3.5, at scale 1

    expect(pump(station(0)).center.x).toBeCloseTo(10 + 5.955 / S, 9);
    expect(pump(station(0)).center.y).toBeCloseTo(20 + 4.11 / S, 9);
    expect(pump(station(Math.PI / 2)).center.x).toBeCloseTo(10 - 4.11 / S, 9);
    expect(pump(station(Math.PI / 2)).center.y).toBeCloseTo(20 + 5.955 / S, 9);
    expect(pump(station(0)).half.x).toBeCloseTo(1.91 / 2 / S, 9);
    expect(pump(station(0)).z1).toBeCloseTo(0.38, 9);
  });

  it('tells distance to a box outline and whether a segment crosses it', () => {
    const fence = propBoxes({ id: 'fence-9', pos: { x: 10, y: 10 }, r: 0.5, kind: 'landmark', look: 'fence', yaw: 0 })[0]; // model x -0.5 to 0.5: the middle post

    expect(boxDistance(fence, { x: 10, y: 10 })).toBe(0);
    expect(boxDistance(fence, { x: 10 + 0.125 + 1, y: fence.center.y })).toBeCloseTo(1, 9);
    expect(segmentCrossesBox(fence, { x: 10, y: 5 }, { x: 10, y: 15 })).toBe(true);
    expect(segmentCrossesBox(fence, { x: 11, y: 5 }, { x: 11, y: 15 })).toBe(false);
    expect(segmentCrossesBox(fence, { x: 10, y: 5 }, { x: 10, y: 9 })).toBe(false);
    expect(boxSegmentDistance(fence, { x: 10, y: 5 }, { x: 10, y: 15 })).toBe(0);
    expect(boxSegmentDistance(fence, { x: 11.125, y: 5 }, { x: 11.125, y: 15 })).toBeCloseTo(1, 9);
    // Nearest to the corner at +x, +y, closer than either end of the segment.
    const corner = { x: fence.center.x + fence.half.x, y: fence.center.y + fence.half.y };
    expect(boxSegmentDistance(fence, { x: 10.625, y: 10 }, { x: 10.125, y: 10.5 })).toBeCloseTo((20.625 - corner.x - corner.y) / Math.SQRT2, 9);
  });

  it('refuses a model with no shape', () => {
    expect(() => propShape('nothing')).toThrow(/nothing/);
  });
});

describe('Broken Wing on the baked map', () => {
  const M = PHYSICS.metersPerTile;
  const HALF = REGION.roadWidth / 2;
  const hoop = mapObstacles(TEST_MAP).find((o) => o.kind === 'landmark' && o.look === 'shipWing');
  if (hoop === undefined) throw new Error('The baked map has no hoop');
  const boxes = propBoxes(hoop);
  const hoopGround = groundAt(TEST_MAP.terrain, hoop.pos.x, hoop.pos.y) * M;
  const W = BROKEN_WING;
  // Road points across the full road, every half tile along it.
  const road = (from: number, to: number): Vec[] => {
    const out: Vec[] = [];
    for (let a = from; a <= to; a += 0.5) for (let s = -HALF; s <= HALF; s += 0.5) out.push(BROKEN_WING_POINT(a, s));
    return out;
  };
  // Under the hoop: its band along the road, 23 m long in the model, with a tile to spare each way.
  const under = road(W.hoopAt - 4, W.hoopAt + 4);
  // The ramps and the deck, from the root ramp's foot to the tip ramp's foot.
  const reach = W.deckHalf + W.mound.gap + W.mound.flat + W.mound.bank;
  const stretch = road(-reach, reach);

  it('places the hoop on the Broken Wing road and draws it at its authored size, so its boxes keep their pass-under heights', () => {
    expect(hoop.pos).toEqual(BROKEN_WING_POINT(W.hoopAt, 0));
    expect(propPose(hoop).scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('keeps the hoop off the deck and its ramps', () => {
    for (const b of boxes) for (const p of stretch) expect(boxDistance(b, p)).toBeGreaterThan(0);
  });

  it('arches over the road: the hoop covers road points under it', () => {
    expect(under.filter((p) => boxes.some((b) => boxDistance(b, p) === 0)).length).toBeGreaterThan(under.length / 4);
  });

  it('leaves every road point under the hoop a truck height and a metre clear of the road', () => {
    for (const p of under) {
      const ground = groundAt(TEST_MAP.terrain, p.x, p.y) * M;
      for (const b of boxes.filter((box) => boxDistance(box, p) === 0)) {
        expect(hoopGround + b.z0 - ground).toBeGreaterThanOrEqual(PHYSICS.truckClearance + 1);
      }
    }
  });

  it('stands the low boxes of the hoop, its feet, off the road surface', () => {
    for (const b of boxes.filter((box) => box.z0 < PHYSICS.truckClearance)) {
      for (const p of under) expect(boxDistance(b, p)).toBeGreaterThan(0);
    }
  });

  it('keeps every other prop, road wreck and site off the road under the hoop, on the ramps and on the deck', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const points = [...under, ...stretch];
    const on = w.obstacles.filter((o) => o.id !== hoop.id && o.kind !== 'water' && points.some((p) => dist(o.pos, p) <= o.r));
    expect(on.map((o) => o.id)).toEqual([]);
  }, budget(60_000));
});
