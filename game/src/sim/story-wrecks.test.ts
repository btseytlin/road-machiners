import { describe, expect, it } from 'vitest';
import { STORY_WRECKS } from '../data/salvage';
import { START_KITS } from '../data/start';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { TIME } from '../data/time';
import { TEST_MAP } from '../test/map';
import { addVehicle, emptyWorld } from './testkit';
import { resolveDestroyed, wreckVehicle } from './combat';
import { isRoadWreck, isStoryWreck, renewSalvage, salvagePlace } from './salvage';
import { isCliff, tileAt } from './terrain';
import { dist, segmentDist } from './vec';
import { newWorld } from './world';
import { defaultSetup } from './settings';
import type { World } from './types';

const WAGON = STORY_WRECKS[0];

function wagonStock(w: World) {
  return w.salvage.filter((s) => s.id === WAGON.id);
}

describe('story wrecks', () => {
  it('lies once on every seed, as a wagon hulk with its authored contents', () => {
    for (const seed of [1, 1337, 4242]) {
      const w = newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));

      expect(w.obstacles.filter((o) => o.id === WAGON.id)).toEqual([
        { id: WAGON.id, pos: WAGON.pos, r: WAGON.r, kind: 'wreck', hulk: { chassisId: 'wagon', yaw: WAGON.yaw } },
      ]);
      expect(wagonStock(w)).toEqual([
        {
          id: WAGON.id, pos: WAGON.pos, radius: WAGON.r * RULES.wreckRadiusScale,
          goods: { scrap: 3, meds: 1, parts: 1 }, fuel: 10, supplies: 4, hidden: { goods: {}, parts: [], fuel: 0, supplies: 0 },
          parts: [{ id: 'story-wagon-seven-cannon', defId: 'cannon', hp: expect.any(Number), wear: 2, gun: expect.any(Object) }],
        },
      ]);
    }
  });

  it('leaves the random streams and ids of world creation as they were', () => {
    const before = [
      { seed: 1, rng: -1597684593, market: -1121344836, nextId: 1133, wreck0: { x: 219.61, y: 262.481 } },
      { seed: 1337, rng: 1543926402, market: 14445366, nextId: 1133, wreck0: { x: 405.805, y: 156.146 } },
    ];
    for (const b of before) {
      const w = newWorld(b.seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
      const wreck0 = w.obstacles.find((o) => o.id === 'wreck0')!;

      expect({ rng: w.rngState, market: w.marketRng.rngState, nextId: w.nextId }).toEqual({ rng: b.rng, market: b.market, nextId: b.nextId });
      expect(wreck0.pos.x).toBeCloseTo(b.wreck0.x, 3);
      expect(wreck0.pos.y).toBeCloseTo(b.wreck0.y, 3);
    }
  });

  it('is searched with wreck words and counts as neither a road wreck nor a kill wreck', () => {
    const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const stock = wagonStock(w)[0];

    expect(isStoryWreck(stock)).toBe(true);
    expect(isRoadWreck(stock)).toBe(false);
    expect(salvagePlace(stock)).toBe('wreck');
  });

  it('stays empty once looted, through days of renewal', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const stock = wagonStock(w)[0];
    stock.goods = { scrap: 0, meds: 0, parts: 0 };
    stock.parts = [];
    stock.fuel = 0;
    stock.supplies = 0;
    w.obstacles.push({ id: WAGON.id, pos: WAGON.pos, r: WAGON.r, kind: 'wreck', hulk: { chassisId: 'wagon', yaw: WAGON.yaw } });

    for (let day = 1; day <= 10; day++) {
      w.turn = day * TIME.turnsPerDay;
      renewSalvage(w);
    }

    expect(wagonStock(w)[0]).toEqual(stock);
    expect(w.obstacles.filter((o) => o.id === WAGON.id)).toHaveLength(1);
  });

  it('is never cleared by many kill wrecks', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles.push({ id: WAGON.id, pos: WAGON.pos, r: WAGON.r, kind: 'wreck', hulk: { chassisId: 'wagon', yaw: WAGON.yaw } });
    for (let k = 0; k < RULES.maxKillWrecks + 3; k++) wreckVehicle(w, addVehicle(w, 'raiders', 'scout', [], { x: 60 + k * 3, y: 60 }));

    resolveDestroyed(w);

    expect(w.obstacles.filter((o) => o.id.startsWith('wreck-'))).toHaveLength(RULES.maxKillWrecks);
    expect(w.obstacles.filter((o) => o.id === WAGON.id)).toHaveLength(1);
    expect(wagonStock(w)).toHaveLength(1);
  });

  it('lies on drivable ground, clear of props, far from roads and from Bowl, on the real map', () => {
    const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const roadGap = Math.min(...REGION.roads.flatMap((road) => road.slice(1).map((b, i) => segmentDist(WAGON.pos, road[i], b))));
    const clearance = Math.min(...w.obstacles.filter((o) => o.id !== WAGON.id).map((o) => dist(o.pos, WAGON.pos) - o.r - WAGON.r));
    const cliffs = [-3, -2, -1, 0, 1, 2, 3].flatMap((dy) => [-3, -2, -1, 0, 1, 2, 3].map((dx) => isCliff(w.terrain, tileAt(w.terrain, { x: WAGON.pos.x + dx, y: WAGON.pos.y + dy })))).filter(Boolean);

    expect(roadGap).toBeGreaterThanOrEqual(30);
    expect(dist(WAGON.pos, bowl.pos)).toBeGreaterThanOrEqual(100);
    expect(clearance).toBeGreaterThan(REGION.obstacles.gap);
    expect(cliffs).toEqual([]);
  });
});
