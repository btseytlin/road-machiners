import { defaultSetup } from './settings';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { REPAIR } from '../data/wear';
import { startKit } from '../data/start';
import { budget } from '../test/budget';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { findSpot, goodsCount, gridOf, isMounted, MOUNT_CELLS, mountedParts, type Spot } from './grid';
import { moveItem } from './inventory';
import { startRepair } from './jobs';
import { takeAllLoot } from './locations';
import { OPENING_WRECK_ID, openingStockOf } from './opening';
import { repairPlan } from './repair';
import { isRoadWreck, salvagePlace } from './salvage';
import { startSearch } from './search';
import { openingStopPoint, testDrive } from './testkit';
import type { GridItem, PartInstance, World } from './types';
import { dist } from './vec';
import { playerSees } from './vision';
import { maxHp } from './wear';
import { carriedWorld, endTurn, newWorld, startPose } from './world';

const KIT = startKit('standard');

let opened: World | undefined;
const openingWorld = (): World => (opened ??= newWorld(1, KIT, TEST_MAP, defaultSetup('roaming')));

const part = (w: World, defId: string): PartInstance => {
  const found = mountedParts(playerVehicle(w)).find((p) => p.defId === defId);
  if (!found) throw new Error(`No ${defId} mounted`);
  return found;
};

const cageItem = (w: World): Extract<GridItem, { kind: 'part' }> | undefined =>
  playerVehicle(w).items.find((it): it is Extract<GridItem, { kind: 'part' }> => it.kind === 'part' && it.part.defId === 'cage');

const turns = (w: World, n: number): World => {
  let next = w;
  for (let i = 0; i < n; i++) next = endTurn(next, testDrive);
  return next;
};

function parkedBy(w: World): World {
  const next = structuredClone(w);
  const me = playerVehicle(next);
  me.pos = openingStopPoint(next);
  me.speed = 0;
  me.order = null;
  return next;
}

function searched(w: World): World {
  let next = startSearch(parkedBy(w), OPENING_WRECK_ID);
  for (let i = 0; i < 6 && playerVehicle(next).job; i++) next = turns(next, 1);
  return next;
}

describe('new-game opening', () => {
  it('places one fixed opening wreck with 3 parts and an unworn Rebar cage on every seed', () => {
    for (const seed of [1, 2, 3, 1337]) {
      const w = newWorld(seed, KIT, TEST_MAP, defaultSetup('roaming'));
      expect(w.obstacles.filter((o) => o.id === OPENING_WRECK_ID)).toHaveLength(1);
      const stocks = w.salvage.filter((s) => s.id === OPENING_WRECK_ID);
      expect(stocks).toHaveLength(1);
      const [stock] = stocks;
      expect(stock.goods).toEqual({ scrap: 0, parts: 3 });
      expect(stock.parts.map((p) => [p.defId, p.wear, p.hp === maxHp(p)])).toEqual([['cage', 0, true]]);
      expect([stock.fuel, stock.supplies]).toEqual([0, 0]);
      expect(salvagePlace(stock)).toBe('wreck');
      expect(isRoadWreck(stock)).toBe(false);
      const o = w.obstacles.find((x) => x.id === OPENING_WRECK_ID)!;
      const touching = w.obstacles.filter((x) => x !== o && x.kind !== 'site' && dist(x.pos, o.pos) < x.r + o.r + REGION.obstacles.gap);
      expect(touching.map((x) => x.id)).toEqual([]);
    }
  }, budget(60_000));

  it('leaves a kit without an opening and a carried save with no opening wreck', () => {
    expect(openingStockOf(newWorld(1, startKit('combat'), TEST_MAP, defaultSetup('roaming'), false))).toBeNull();
    const { world } = carriedWorld({
      seed: 5, money: null, xp: null, ranks: {}, xpBySource: {}, perks: [], discovered: [], knockouts: null,
      autoFire: null, autoRepair: null, fuel: null, supplies: null, costBasis: {}, truck: null, storage: [], setup: defaultSetup('roaming'), quests: { world: {}, local: {} },
    }, KIT, () => TEST_MAP, () => 7);
    expect(openingStockOf(world)).toBeNull();
    expect(world.obstacles.some((o) => o.id === OPENING_WRECK_ID)).toBe(false);
    expect(world.player.autoRepair).toBe(true);
    expect(mountedParts(playerVehicle(world)).every((p) => p.hp === maxHp(p))).toBe(true);
  }, budget(30_000));

  it('throws when the opening wreck would land on a prop', () => {
    const rock = TEST_MAP.props.find((p) => p.kind === 'rock')!;
    const heading = 0;
    const { ahead, side } = REGION.playerStart.wreck;
    const start = { pos: { x: rock.pos.x - ahead, y: rock.pos.y - side }, heading };
    expect(() => newWorld(1, KIT, TEST_MAP, defaultSetup('roaming'), false, start)).toThrow(/opening-wreck .* overlaps/);
  });

  it('starts the wreck in clear sight of the truck', () => {
    const w = openingWorld();
    expect(playerSees(w, openingStockOf(w)!.pos)).toBe(true);
  });

  it('starts with auto patch off, a nearly broken engine that still drives, a worn cab and no cage', () => {
    const w = openingWorld();
    expect(w.player.autoRepair).toBe(false);
    const engine = part(w, 'stockEngine');
    expect(engine.hp).toBe(8);
    expect(engine.wear).toBe(2);
    expect(part(w, 'cabPickup').hp).toBe(34);
    expect(mountedParts(playerVehicle(w)).some((p) => p.defId === 'cage')).toBe(false);
  });

  it('lets the player search the wreck, take its loot, patch the engine to the field cap with a part to spare and mount the cage', () => {
    let w = searched(openingWorld());
    expect(w.player.scavenged).toContain(OPENING_WRECK_ID);
    expect(w.player.xpBySource.search).toBeGreaterThan(0);
    expect(goodsCount(playerVehicle(w)).parts).toBe(2);

    w = takeAllLoot(w, OPENING_WRECK_ID);
    const stock = openingStockOf(w)!;
    expect(stock.goods.parts).toBe(0);
    expect(stock.parts).toEqual([]);
    expect(goodsCount(playerVehicle(w)).parts).toBe(5);
    const cage = cageItem(w)!;
    expect(cage).toBeDefined();
    expect(isMounted(playerVehicle(w).chassisId, cage)).toBe(false);

    const idle = turns(w, 2);
    expect(part(idle, 'stockEngine').hp).toBe(8);
    expect(playerVehicle(idle).job).toBeNull();

    const engine = part(w, 'stockEngine');
    const plan = repairPlan(w, playerVehicle(w), engine.id);
    expect(plan.needed).toBeLessThanOrEqual(goodsCount(playerVehicle(w)).parts - 1);
    w = startRepair(w, engine.id);
    for (let i = 0; i < 10 && playerVehicle(w).job; i++) w = turns(w, 1);
    expect(part(w, 'stockEngine').hp).toBeCloseTo(maxHp(engine) * REPAIR.fieldCapShare);
    expect(goodsCount(playerVehicle(w)).parts).toBe(5 - plan.needed);

    w = moveItem(w, cageItem(w)!.id, armorSpot(w));
    for (let i = 0; i < 10 && playerVehicle(w).job; i++) w = turns(w, 1);
    expect(isMounted(playerVehicle(w).chassisId, cageItem(w)!)).toBe(true);
    expect(mountedParts(playerVehicle(w)).some((p) => p.defId === 'cage')).toBe(true);
  }, budget(60_000));
});

function armorSpot(w: World): Spot {
  const me = playerVehicle(w);
  const cage = cageItem(w)!;
  const spot = findSpot(gridOf(me), me.items.filter((it) => it !== cage), cage, MOUNT_CELLS.armor, null);
  if (!spot) throw new Error('No armor spot fits the cage');
  return spot;
}

it('keeps the start pose clear of the opening wreck', () => {
  const w = openingWorld();
  expect(dist(startPose().pos, openingStockOf(w)!.pos)).toBeGreaterThan(5);
});
