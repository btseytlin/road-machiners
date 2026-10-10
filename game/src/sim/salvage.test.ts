import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES } from '../data/territory';
import { GOODS } from '../data/goods';
import { TIME } from '../data/time';
import { addVehicle, emptyWorld, npcBrain, spotWorld, testDrive } from './testkit';
import { resolveDestroyed, wreckVehicle } from './combat';
import { addGoods, dumpItem, removeGoods } from './inventory';
import { corePart, findSpot, goodsCount, gridOf, mountedParts } from './grid';
import { partDef } from '../data/parts';
import { chassisDef } from '../data/chassis';
import { BREAKABLE, RULES } from '../data/rules';
import { takeAllLoot, takeLoot, takeStores, canScavenge, scavenge } from './locations';
import {
  breakProp, canTakeAny, claimPile, claimantOf, clearPiles, collectSalvage, createCargoSalvage, hasSalvage, initializeSalvage, isLootTarget, isRoadWreck, lootBlockedError, lootBlocker,
  lootClaimedBy, looterOf, removeStocks, renewSalvage, rollStock, salvageInRange, salvagePlace, salvageUnits, stockOldSpots, oldSpotOf, oldSpotPicks, oldStockId,
  emptyHidden,
} from './salvage';
import { FIELD_SPARE_WEAR, OLD_TABLES } from '../data/salvage';
import { chance, randInt } from './rng';
import { sampleWeighted } from './npc-loadout';
import { makePart } from './factory';
import { knockOutNpc } from './defeat';
import type { NpcActivity, Obstacle, RefitPickup, SalvageStock, Vehicle, World } from './types';
import { propReach } from './mapgen';
import { dist, type Vec } from './vec';
import { maxHp } from './wear';
import { canVehicleSee, grayRadius } from './vision';
import { siteGap } from './sites';
import { isLootSpot, spotTable, territoryAt, territoryOfStock } from './territory';
import { freeCells } from './grid';
import { endTurn } from './world';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';
import { defaultSetup } from './settings';

describe('player piles', () => {
  it('goods the player dumps and takes back keep their cost basis', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    addGoods(w, me, 'scrap', 2);
    const held = goodsCount(me).scrap;
    w.player.costBasis.scrap = 400;
    let next = w;
    for (const item of me.items.filter((it) => it.kind === 'good' && it.good === 'scrap')) next = dumpItem(next, item.id);
    const pile = next.salvage.find((s) => s.pile)!;
    collectSalvage(next, next.vehicles[0], pile.id, 100);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(held);
    expect(next.player.costBasis.scrap).toBe(400);
  });

  it('goods from a pile another truck dropped count at their base value', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', [], { x: 31, y: 30 });
    addGoods(w, npc, 'scrap', 2);
    const pile = createCargoSalvage(w, npc, 1);
    const held = goodsCount(w.vehicles[0]).scrap ?? 0;
    w.player.costBasis.scrap = 400;
    collectSalvage(w, w.vehicles[0], pile.id, 100);
    expect(w.player.costBasis.scrap).toBeCloseTo((400 * held + GOODS.scrap.value * 2) / (held + 2));
    expect(w.player.scavenged).not.toContain(pile.id);
  });

  it('a looted unit taken first does not wipe the paid basis of goods taken back from the player pile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    addGoods(w, me, 'tools', 6);
    w.player.costBasis.tools = 6000;
    let next = w;
    for (const item of me.items.filter((it) => it.kind === 'good')) next = dumpItem(next, item.id);
    next.salvage.push({ id: 'free', pos: { x: 30, y: 30 }, radius: 1, goods: { tools: 1 }, parts: [], hidden: emptyHidden() });
    next.player.scavenged.push('free');
    collectSalvage(next, next.vehicles[0], 'free', 100);
    expect(next.player.costBasis.tools).toBe(GOODS.tools.value);
    collectSalvage(next, next.vehicles[0], next.salvage.find((s) => s.pile?.fromPlayer)!.id, 100);
    expect(goodsCount(next.vehicles[0]).tools).toBe(7);
    expect(next.player.costBasis.tools).toBeCloseTo((6000 * 6 + GOODS.tools.value) / 7);
  });

  it('one looted good taken by hand moves the basis like taking all', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    addGoods(w, me, 'scrap', 2);
    w.player.costBasis.scrap = 400;
    w.salvage.push({ id: 'free', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() });
    w.player.scavenged.push('free');
    const spot = findSpot(gridOf(me), me.items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    expect(takeLoot(w, 'free', { kind: 'good', good: 'scrap' }, spot).player.costBasis.scrap).toBeCloseTo((400 * 2 + GOODS.scrap.value) / 3);
  });

  it('the player dumping beside another truck pile starts its own pile and leaves that one unsearched', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', [], { x: 30.5, y: 30 });
    addGoods(w, npc, 'scrap', 2);
    const theirs = createCargoSalvage(w, npc, 1);
    expect(salvageInRange(w.vehicles[0], theirs)).toBe(true);
    const good = w.vehicles[0].items.find((it) => it.kind === 'good')!;
    const next = dumpItem(w, good.id);
    const mine = next.salvage.find((s) => s.pile?.fromPlayer)!;
    expect(mine.id).not.toBe(theirs.id);
    expect(next.player.scavenged).not.toContain(theirs.id);
    expect(next.salvage.find((s) => s.id === theirs.id)!.goods.scrap).toBe(2);
  });

  it('a pile the player dumped counts as searched, so it pays no search XP', () => {
    const w = emptyWorld();
    const good = w.vehicles[0].items.find((it) => it.kind === 'good')!;
    const next = dumpItem(w, good.id);
    const pile = next.salvage.find((s) => s.pile?.fromPlayer)!;
    expect(next.player.scavenged).toContain(pile.id);
  });
});

describe('finite salvage', () => {
  it('leaves overflow for another collector and never duplicates it', () => {
    const w = emptyWorld();
    const a = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    const b = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    addGoods(w, a, 'salt', freeCells(a) - 1);
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    expect(collectSalvage(w, a, 'test-stock', 100)).toBe(1);
    expect(goodsCount(a).scrap).toBe(1);
    expect(collectSalvage(w, b, 'test-stock', 100)).toBe(2);
    expect(goodsCount(b).scrap).toBe(2);
    expect(collectSalvage(w, b, 'test-stock', 100)).toBe(0);
  });

  it('pours fuel and supplies up to the caps and leaves the rest', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const cap = chassisDef(me.chassisId).fuelCap;
    w.player.fuel = cap - 3;
    w.player.supplies = RULES.baseSupplies - 1;
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: {}, parts: [], fuel: 5, supplies: 4, hidden: emptyHidden() });
    expect(() => takeStores(w, 'test-stock')).toThrow(/Search/);
    w.player.scavenged.push('test-stock');
    const next = takeStores(w, 'test-stock');
    const stock = next.salvage.find((s) => s.id === 'test-stock')!;
    expect(next.player.fuel).toBe(cap);
    expect(next.player.supplies).toBe(RULES.baseSupplies);
    expect(stock.fuel).toBe(2);
    expect(stock.supplies).toBe(3);
    expect(hasSalvage(stock)).toBe(true);
  });

  it('does not count a nearly full store as room for the stock left', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', [], { x: 10, y: 10 });
    const stock: SalvageStock = { id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: {}, parts: [], supplies: 2, hidden: emptyHidden() };
    npc.resources!.supplies = RULES.baseSupplies - 0.015;
    expect(canTakeAny(w, npc, stock)).toBe(false);
    npc.resources!.supplies = RULES.baseSupplies - 1;
    expect(canTakeAny(w, npc, stock)).toBe(true);
  });

  it('pours stores in whole units, so no crumb under a unit stays in the stock', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.supplies = RULES.baseSupplies - 1.6;
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: {}, parts: [], supplies: 2, hidden: emptyHidden() });

    collectSalvage(w, npc, 'test-stock', 100);

    expect(npc.resources!.supplies).toBeCloseTo(RULES.baseSupplies - 0.6);
    expect(w.salvage.find((s) => s.id === 'test-stock')!.supplies).toBe(1);
    expect(canTakeAny(w, npc, w.salvage.find((s) => s.id === 'test-stock')!)).toBe(false);
  });

  it('lets an NPC collector take fuel and supplies', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: {}, parts: [], fuel: 5, supplies: 2, hidden: emptyHidden() });
    collectSalvage(w, npc, 'test-stock', 100);
    expect(npc.resources).toEqual(expect.objectContaining({ fuel: 5, supplies: 2 }));
    expect(hasSalvage(w.salvage.find((s) => s.id === 'test-stock')!)).toBe(false);
  });

  it('never moves more than a stock holds, even asked for more', () => {
    const w = emptyWorld();
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    expect(collectSalvage(w, w.vehicles[0], 'test-stock', 100)).toBe(3);
    expect(w.salvage.find((s) => s.id === 'test-stock')!.goods.scrap).toBe(0);
    expect(collectSalvage(w, w.vehicles[0], 'test-stock', 100)).toBe(0);
  });

  describe('pile claims', () => {
  function claimed() {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    const victim = addVehicle(w, 'scavengers', 'scout', [], { x: 30, y: 32 });
    addGoods(w, victim, 'scrap', 2);
    const claimant = addVehicle(w, 'raiders', 'scout', [], { x: 34, y: 30 });
    claimant.brain = npcBrain('buggy', claimant.pos, []);
    const pile = createCargoSalvage(w, victim, 1);
    claimant.brain.goals.push({ kind: 'loot', targetId: pile.id, destination: { ...pile.pos }, phase: 'travel', reason: 'tripToSite' });
    claimPile(w, pile, claimant);
    return { w, pile, claimant };
  }

  it('holds while the claimant keeps its loot goal', () => {
    const { w, pile, claimant } = claimed();
    clearPiles(w);
    expect(claimantOf(w, pile)).toBe(claimant);
  });

  it('lapses when the loot goal goes', () => {
    const { w, pile, claimant } = claimed();
    claimant.brain!.goals = [];
    clearPiles(w);
    expect(pile.pile!.claim).toBeUndefined();
  });

  it('lapses when the claimant is knocked out', () => {
    const { w, pile, claimant } = claimed();
    claimant.defeat = { phase: 'out' } as typeof claimant.defeat;
    clearPiles(w);
    expect(pile.pile!.claim).toBeUndefined();
  });

  it('lapses when the claimant leaves the world', () => {
    const { w, pile, claimant } = claimed();
    w.vehicles = w.vehicles.filter((v) => v !== claimant);
    clearPiles(w);
    expect(pile.pile!.claim).toBeUndefined();
  });

  it('lapses at its time limit', () => {
    const { w, pile } = claimed();
    w.turn += SALVAGE.claimTurns - 1;
    clearPiles(w);
    expect(pile.pile!.claim).toBeDefined();
    w.turn += 1;
    clearPiles(w);
    expect(pile.pile!.claim).toBeUndefined();
  });
});

  it('cannot recreate spot loot by clearing player discovery state', () => {
    const { w, spot } = spotWorld();
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part' && partDef(item.part.defId).kind === 'core');
    w.player.fuel = 0;
    w.player.supplies = 0;
    const totalScrap = stockOf(w, spot.id).hidden.goods.scrap;
    let next = w;
    let turns = 0;
    while (canScavenge(next, spot.id)) {
      next = scavenge(next, spot.id);
      while (next.vehicles[0].job) {
        next = endTurn(next, testDrive);
        if (++turns > 200) throw new Error('search never finished');
      }
      next = takeAllLoot(next, spot.id);
    }
    next.player.scavenged = [];
    expect(canScavenge(next, spot.id)).toBe(false);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(totalScrap);
  });

  it('fills a loot spot with loot at world creation', () => {
    const { stock } = spotWorld();
    expect(hasSalvage(stock)).toBe(true);
    expect(stock.hidden.goods.parts).toBeGreaterThan(0);
    expect(stock.hidden.fuel).toBeGreaterThanOrEqual(SALVAGE.landmark.fuel[0]);
    expect(stock.hidden.supplies).toBeGreaterThanOrEqual(SALVAGE.landmark.supplies[0]);
  });

  it('gives a wreck its mounted parts at their hp, and turns built-in parts into the parts good', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    addGoods(w, npc, 'scrap', 3);
    const engine = mountedParts(npc, 'engine')[0];
    corePart(npc, 'cab').hp = 0;
    const core = mountedParts(npc, 'core');
    const hpShare = core.reduce((sum, p) => sum + p.hp / maxHp(p), 0) / core.length;
    const coreScrap = Math.round((chassisDef(npc.chassisId).value * SALVAGE.coreValueShare * hpShare) / GOODS.parts.value);
    wreckVehicle(w, npc);
    const stock = w.salvage.find((s) => s.id === `wreck-${npc.id}`)!;
    expect(stock.goods.scrap).toBe(3);
    expect(stock.parts).toEqual([engine]);
    expect(stock.goods.parts).toBe(coreScrap);
    resolveDestroyed(w);
    expect(w.salvage.filter((s) => s.id === stock.id)).toHaveLength(1);
  });

  it('leaves a wreck worth well under the chassis it came from', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 10, y: 10 });
    corePart(npc, 'cab').hp = 0;
    wreckVehicle(w, npc);
    const stock = w.salvage.find((s) => s.id === `wreck-${npc.id}`)!;
    const lootValue = (stock.goods.parts ?? 0) * GOODS.parts.value;
    expect(lootValue).toBeLessThan(chassisDef('buggy').value * 0.5);
  });

  it('enters a salvaged good into the cost basis at its base value, not free', () => {
    const w = emptyWorld();
    const held = goodsCount(w.vehicles[0]).scrap ?? 0;
    if (held > 0) removeGoods(w.vehicles[0], 'scrap', held);
    delete w.player.costBasis.scrap;
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    collectSalvage(w, w.vehicles[0], 'test-stock', 100);
    expect(w.player.costBasis.scrap).toBe(GOODS.scrap.value);
  });
});

describe('field spare parts', () => {
  it('are mostly worn, so a pristine find is rare', () => {
    const wears: number[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const w = emptyWorld();
      w.rngState = seed;
      w.marketRng.rngState = seed * 7919;
      wears.push(...rollStock(w, SALVAGE.landmark, 'spot', { x: 1, y: 1 }, 1).hidden.parts.map((p) => p.wear));
    }
    const pristine = wears.filter((wear) => wear === 0).length;
    expect(wears.length).toBeGreaterThan(50);
    expect(pristine / wears.length).toBeLessThan(0.2);
  });
});

describe('road wreck salvage', () => {
  it('gives every wreck placed on a road its own stock to search', async () => {
    const { newWorld } = await import('./world');
    const { startKit } = await import('../data/start');
    const w = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const wrecks = w.obstacles.filter((o) => /^wreck\d+$/.test(o.id));
    expect(wrecks.length).toBeGreaterThan(0);
    for (const o of wrecks) {
      const stock = w.salvage.find((s) => s.id === o.id);
      expect(stock).toBeDefined();
      expect(hasSalvage(stock!)).toBe(true);
    }
  }, budget(30_000));
});

describe('loot piles', () => {
  const goodItem = (w: ReturnType<typeof emptyWorld>) => w.vehicles[0].items.find((it) => it.kind === 'good')!;
  const piles = (w: ReturnType<typeof emptyWorld>) => w.salvage.filter((stock) => stock.pile);

  it('merges drops in reach into one pile and starts a new one out of reach', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    w.turn += 5;
    w = dumpItem(w, goodItem(w).id);
    expect(piles(w)).toHaveLength(1);
    expect(salvageUnits(piles(w)[0])).toBe(2);
    expect(piles(w)[0].pile!.until).toBe(w.turn + SALVAGE.pileTurns);
    expect(w.player.scavenged).toContain(piles(w)[0].id);
    w.vehicles[0].pos = { x: 60, y: 30 };
    w = dumpItem(w, goodItem(w).id);
    expect(piles(w)).toHaveLength(2);
  });

  it('clears a pile when it expires and stops searches of it', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 30, y: 31 });
    const id = piles(w)[0].id;
    npc.job = { kind: 'search', stockId: id, turnsLeft: 3, total: 3 };
    w.turn = piles(w)[0].pile!.until - 1;
    clearPiles(w);
    expect(piles(w)).toHaveLength(1);
    w.turn += 1;
    clearPiles(w);
    expect(piles(w)).toHaveLength(0);
    expect(npc.job).toBeNull();
    expect(w.player.scavenged).not.toContain(id);
  });

  it('clears a pile once it is empty', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    const pile = piles(w)[0];
    pile.goods = {};
    clearPiles(w);
    expect(piles(w)).toHaveLength(0);
  });
});

function stockOf(w: World, id: string): SalvageStock {
  return w.salvage.find((stock) => stock.id === id)!;
}

function emptyStock(stock: SalvageStock): void {
  for (const good of Object.keys(stock.goods)) stock.goods[good] = 0;
  stock.parts = [];
  stock.fuel = 0;
  stock.supplies = 0;
  stock.hidden = emptyHidden();
}

function worldWithLootedWreck(playerPos: Vec, pos: Vec): World {
  const w = emptyWorld(playerPos);
  w.salvage = w.salvage.filter((stock) => !isRoadWreck(stock));
  w.obstacles = [{ id: 'wreck0', pos, r: 0.6, kind: 'wreck' }];
  w.salvage.push({ id: 'wreck0', pos, radius: 0.6, goods: { scrap: 0 }, parts: [], hidden: emptyHidden() });
  return w;
}

function runDays(w: World, days: number): void {
  for (let day = 0; day < days; day++) {
    w.turn = (Math.floor(w.turn / TIME.turnsPerDay) + 1) * TIME.turnsPerDay;
    renewSalvage(w);
  }
}

describe('spot restock', () => {
  it('refills an emptied spot a share at a time, up to the table highs', () => {
    const { w, stock } = spotWorld();
    emptyStock(stock);
    runDays(w, 1);
    const firstDay = stock.hidden.goods.scrap;
    runDays(w, 365);
    expect(firstDay).toBeLessThan(SALVAGE.landmark.goods.scrap[1]);
    expect(stock.hidden.goods.scrap).toBe(SALVAGE.landmark.goods.scrap[1]);
    expect(stock.hidden.goods.parts).toBe(SALVAGE.landmark.parts[1]);
    expect(stock.hidden.fuel).toBe(SALVAGE.landmark.fuel[1]);
  });

  it('refills an emptied spare part slot with one part at a small daily chance', () => {
    const { w, stock } = spotWorld();
    emptyStock(stock);
    let days = 0;
    while (stock.hidden.parts.length === 0 && days < 1000) {
      runDays(w, 1);
      days++;
    }
    runDays(w, 30);
    expect(stock.hidden.parts).toHaveLength(1);
  });

  it('restocks only on the last turn of a day', () => {
    const { w, stock } = spotWorld();
    emptyStock(stock);
    for (let turn = 1; turn < TIME.turnsPerDay; turn++) {
      w.turn = turn;
      renewSalvage(w);
    }
    expect(stock.goods.scrap ?? 0).toBe(0);
    expect(stock.hidden).toEqual(emptyHidden());
  });

  it('keeps a count above the table high', () => {
    const { w, stock } = spotWorld();
    stock.goods.parts = SALVAGE.landmark.parts[1] + 5;
    runDays(w, 1);
    expect(stock.goods.parts).toBe(SALVAGE.landmark.parts[1] + 5);
  });
});

describe('road wreck turnover', () => {
  const near = { x: 30, y: 30 };
  const far = { x: REGION.size - 20, y: REGION.size - 20 };

  it('replaces a looted wreck beyond gray vision after its days run out', () => {
    const w = worldWithLootedWreck(near, far);
    runDays(w, SALVAGE.wreckClearDays);
    expect(stockOf(w, 'wreck0')).toBeDefined();
    runDays(w, 1);
    const wrecks = w.obstacles.filter(isRoadWreck);
    expect(wrecks).toHaveLength(1);
    expect(wrecks[0].id).not.toBe('wreck0');
    expect(dist(wrecks[0].pos, near)).toBeGreaterThan(grayRadius(w));
    expect(stockOf(w, wrecks[0].id).hidden.goods.scrap).toBeGreaterThan(0);
  });

  it('keeps a looted wreck the player can see', () => {
    const w = worldWithLootedWreck(near, { x: 40, y: 30 });
    runDays(w, SALVAGE.wreckClearDays + 2);
    expect(w.obstacles.map((o) => o.id)).toEqual(['wreck0']);
  });

  it('keeps a wreck that still holds loot', () => {
    const w = worldWithLootedWreck(near, far);
    stockOf(w, 'wreck0').goods.scrap = 1;
    runDays(w, SALVAGE.wreckClearDays + 2);
    expect(w.obstacles.map((o) => o.id)).toEqual(['wreck0']);
  });

  it('stops a search of the wreck it removes', () => {
    const w = worldWithLootedWreck(near, far);
    const npc = addVehicle(w, 'scavengers', 'scout', [], far);
    npc.job = { kind: 'search', stockId: 'wreck0', turnsLeft: 3, total: 3 };
    runDays(w, SALVAGE.wreckClearDays + 1);
    expect(npc.job).toBeNull();
  });
});

describe('breakable props', () => {
  const near = { x: 30, y: 30 };
  const far = { x: REGION.size - 20, y: REGION.size - 20 };
  const fenceAt = (pos: Vec): Obstacle => ({ id: 'fence-7', pos, r: 0.5, kind: 'landmark', look: 'fence', yaw: Math.PI / 2 });

  function worldWithFence(pos: Vec): World {
    const w = emptyWorld(near);
    w.obstacles = [fenceAt(pos)];
    return w;
  }

  it('moves a broken prop from the obstacles to the broken props', () => {
    const w = worldWithFence({ x: 30.6, y: 30 });
    w.turn = 42;

    breakProp(w, 'fence-7', w.vehicles[0].id);

    expect(w.obstacles).toEqual([]);
    expect(w.broken).toEqual([{ obstacle: fenceAt({ x: 30.6, y: 30 }), turn: 42 }]);
  });

  it('slows the truck and scrapes the part that hit', () => {
    const w = worldWithFence({ x: 30.6, y: 30 });
    const me = w.vehicles[0];
    me.speed = 3;

    breakProp(w, 'fence-7', me.id);

    const crash = w.events.find((e) => e.t === 'collision');
    if (crash?.t !== 'collision') throw new Error('Expected a collision event');
    const dealt = crash.hitsA.reduce((sum, hit) => sum + hit.damage, 0);
    const hardest = Math.max(...crash.hitsA.map((hit) => hit.damage));
    expect(me.speed).toBeCloseTo(3 * (1 - BREAKABLE.slowdown));
    expect(crash).toMatchObject({ a: me.id, b: 'fence-7', hitsB: [] });
    expect(dealt).toBeGreaterThan(0);
    expect(hardest).toBeLessThanOrEqual(BREAKABLE.damage);
  });

  it('refuses a prop that does not break, or one not standing', () => {
    const w = worldWithFence({ x: 30.6, y: 30 });
    w.obstacles.push({ id: 'rock3', pos: { x: 32, y: 30 }, r: 0.5, kind: 'rock' });
    const before = structuredClone(w.obstacles);

    expect(() => breakProp(w, 'rock3', w.vehicles[0].id)).toThrow(/rock3/);
    expect(() => breakProp(w, 'fence-9', w.vehicles[0].id)).toThrow(/fence-9/);
    expect(w.obstacles).toEqual(before);
    expect(w.broken).toEqual([]);
  });

  it('grows back beyond gray vision once its days have passed', () => {
    const w = worldWithFence(far);
    w.turn = TIME.turnsPerDay;
    breakProp(w, 'fence-7', w.vehicles[0].id);

    runDays(w, BREAKABLE.regrowDays - 1);
    expect(w.obstacles).toEqual([]);
    runDays(w, 1);
    expect(w.obstacles).toEqual([fenceAt(far)]);
    expect(w.broken).toEqual([]);
  });

  it('stays broken while its spot lies in gray vision', () => {
    const w = worldWithFence({ x: 40, y: 30 });
    breakProp(w, 'fence-7', w.vehicles[0].id);

    runDays(w, BREAKABLE.regrowDays + 2);

    expect(w.obstacles).toEqual([]);
    expect(w.broken.map((b) => b.obstacle.id)).toEqual(['fence-7']);
  });

  it('stays broken while any part of the prop reaches into gray vision', () => {
    const w = emptyWorld(near);
    const pos = { x: near.x + grayRadius(w) + propReach(fenceAt(near)) / 2, y: near.y };
    w.obstacles = [fenceAt(pos)];
    breakProp(w, 'fence-7', w.vehicles[0].id);

    runDays(w, BREAKABLE.regrowDays + 2);

    expect(w.obstacles).toEqual([]);
  });

  it('hides a truck behind a standing dead tree until a truck breaks it', () => {
    const w = emptyWorld(near);
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 20, y: 30 });
    const target = { x: 26, y: 30 };
    w.obstacles = [{ id: 'deadTree-3', pos: { x: 23, y: 30 }, r: 0.35, kind: 'landmark', look: 'deadTree', yaw: 0 }];
    expect(canVehicleSee(w, npc, target)).toBe(false);

    breakProp(w, 'deadTree-3', npc.id);

    expect(canVehicleSee(w, npc, target)).toBe(true);
  });

  it('waits while a truck stands on its spot', () => {
    const w = worldWithFence(far);
    breakProp(w, 'fence-7', w.vehicles[0].id);
    addVehicle(w, 'scavengers', 'scout', [], far);

    runDays(w, BREAKABLE.regrowDays + 2);

    expect(w.obstacles).toEqual([]);
  });
});

describe('who loots a target', () => {
  const at = { x: 30, y: 30 };
  const beside = { x: 30.5, y: 30 };

  function wreckWorld(): { w: World; me: Vehicle; stock: SalvageStock } {
    const w = emptyWorld(at);
    const stock: SalvageStock = { id: 'wreck-test', pos: { ...at }, radius: 0.6, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() };
    w.salvage.push(stock);
    return { w, me: w.vehicles[0], stock };
  }

  function scavenger(w: World, pos: Vec = beside): Vehicle {
    const npc = addVehicle(w, 'scavengers', 'scout', [], pos);
    npc.brain = npcBrain('scavenger', pos, []);
    return npc;
  }

  function downedWorld(): { w: World; me: Vehicle; buggy: Vehicle } {
    const w = emptyWorld(at);
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 30 + gap, y: 30 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    return { w, me: w.vehicles[0], buggy };
  }

  const pickupJob = (pickup: RefitPickup): Vehicle['job'] => ({ kind: 'refit', moves: [], pickup, turnsLeft: 2, total: 2 });
  const lootGoal = (targetId: string, phase: NpcActivity['phase']): NpcActivity => ({ kind: 'loot', targetId, destination: null, phase, reason: 'tripToSite' });

  it('counts wrecks, piles and knocked-out trucks as loot targets, and never a running truck', () => {
    const { w, stock } = wreckWorld();
    const running = scavenger(w);
    expect(isLootTarget(w, stock.id)).toBe(true);
    expect(isLootTarget(w, running.id)).toBe(false);
    const { w: dw, buggy } = downedWorld();
    expect(isLootTarget(dw, buggy.id)).toBe(true);
  });

  it('gives a stock to the truck searching it, over a parked player', () => {
    const { w, me, stock } = wreckWorld();
    const npc = scavenger(w);
    npc.job = { kind: 'search', stockId: stock.id, turnsLeft: 3, total: 3 };
    expect(looterOf(w, stock.id)).toBe(npc);
    expect(lootBlocker(w, me, stock.id)).toBe(npc);
    expect(lootBlocker(w, npc, stock.id)).toBeNull();
  });

  it('gives a stock to the truck refitting a part out of it', () => {
    const { w, stock } = wreckWorld();
    const npc = scavenger(w);
    npc.job = pickupJob({ from: 'stock', stockId: stock.id, partId: 'p', itemId: 'i', to: { x: 0, y: 0, rot: 0 } });
    expect(looterOf(w, stock.id)).toBe(npc);
  });

  it('gives a knocked-out truck to the truck refitting a part off it, over a parked player', () => {
    const { w, me, buggy } = downedWorld();
    const npc = scavenger(w, { x: 40, y: 40 });
    npc.job = pickupJob({ from: 'truck', vehicleId: buggy.id, partId: 'p', itemId: 'i', to: { x: 0, y: 0, rot: 0 } });
    expect(looterOf(w, buggy.id)).toBe(npc);
    expect(lootBlocker(w, me, buggy.id)).toBe(npc);
  });

  it('gives a knocked-out truck to an NPC between two refits, parked beside it in the act phase', () => {
    const { w, me, buggy } = downedWorld();
    const npc = scavenger(w, { x: buggy.pos.x + (buggy.pos.x - 30), y: 30 });
    npc.brain!.goals.push(lootGoal(buggy.id, 'act'));
    expect(looterOf(w, buggy.id)).toBe(npc);
    npc.brain!.goals[0].phase = 'travel';
    expect(looterOf(w, buggy.id)).toBe(me);
  });

  it('does not count an act-phase goal of a driver out of reach', () => {
    const { w, stock } = wreckWorld();
    w.vehicles[0].speed = 5;
    const npc = scavenger(w, { x: 50, y: 50 });
    npc.brain!.goals.push({ ...lootGoal(stock.id, 'act'), kind: 'scavenge' });
    expect(looterOf(w, stock.id)).toBeNull();
    npc.pos = { ...beside };
    expect(looterOf(w, stock.id)).toBe(npc);
  });

  it('gives an unworked target to the parked player, and never to a moving one', () => {
    const { w, me, stock } = wreckWorld();
    const npc = scavenger(w, { x: 50, y: 50 });
    expect(looterOf(w, stock.id)).toBe(me);
    expect(lootBlocker(w, npc, stock.id)).toBe(me);
    expect(lootBlocker(w, me, stock.id)).toBeNull();
    me.speed = 5;
    expect(looterOf(w, stock.id)).toBeNull();
    expect(lootBlocker(w, npc, stock.id)).toBeNull();
  });

  it('names the looter and what it loots in the error', () => {
    const { w, stock } = wreckWorld();
    const npc = scavenger(w);
    expect(lootBlockedError(w, npc, stock.id)).toEqual({ id: 'looting', by: npc.id, place: 'wreck' });
    const { w: dw, buggy } = downedWorld();
    expect(lootBlockedError(dw, npc, buggy.id)).toEqual({ id: 'looting', by: npc.id, place: 'truck' });
    expect(() => lootBlockedError(w, npc, 'nothing')).toThrow(/nothing/);
  });

  it('finds the target an NPC loots, only while it holds the claim', () => {
    const { w, stock } = wreckWorld();
    const first = scavenger(w);
    const second = scavenger(w, { x: 29.5, y: 30 });
    expect(lootClaimedBy(w, first)).toBeNull();
    second.brain!.goals.push(lootGoal(stock.id, 'act'));
    expect(lootClaimedBy(w, second)).toBe(stock.id);
    first.job = { kind: 'search', stockId: stock.id, turnsLeft: 3, total: 3 };
    expect(lootClaimedBy(w, first)).toBe(stock.id);
    expect(lootClaimedBy(w, second)).toBeNull();
  });
});

describe('territory loot spots', () => {
  async function realWorld(): Promise<World> {
    const { newWorld } = await import('./world');
    const { startKit } = await import('../data/start');
    return newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
  }
  const spotsOf = (w: World) => w.obstacles.filter(isLootSpot);

  it('gives each spot exactly one stock with its id, and no stock without a spot', async () => {
    const w = await realWorld();
    const spots = spotsOf(w);
    expect(spots.length).toBeGreaterThan(0);
    for (const o of spots) expect(w.salvage.filter((s) => s.id === o.id), o.id).toHaveLength(1);
    const ids = new Set(w.obstacles.map((o) => o.id));
    for (const s of w.salvage.filter((entry) => territoryOfStock(entry))) expect(ids.has(s.id), s.id).toBe(true);
    expect(w.salvage.some((s) => s.id === 'fallen-sun')).toBe(false);
  }, budget(30_000));

  it('gives every orchard spot its own stock from the table of its look, and the orchard no stock of its own', async () => {
    const w = await realWorld();
    const orchard = REGION.locations.find((site) => site.id === 'orchard')!;
    const spots = spotsOf(w).filter((o) => siteGap(orchard, o.pos) < 0);
    const farm = TERRITORIES.orchard.farm!;
    expect(spots).toHaveLength(farm.buildings.reduce((n, b) => n + b.poses.length, 0));
    for (const o of spots) {
      const stocks = w.salvage.filter((s) => s.id === o.id);
      expect(stocks, o.id).toHaveLength(1);
      expect(territoryOfStock(stocks[0])?.id, o.id).toBe('orchard');
      const table = spotTable(o);
      expect(stocks[0].hidden.goods.parts ?? 0, o.id).toBeGreaterThanOrEqual(table.parts[0]);
      expect(stocks[0].hidden.goods.parts ?? 0, o.id).toBeLessThanOrEqual(table.parts[1]);
    }
    expect(w.salvage.some((s) => s.id === 'orchard')).toBe(false);
  }, budget(30_000));

  it('rolls caches from the landmark table and field spots from the hull scrap table', async () => {
    const w = await realWorld();
    for (const o of spotsOf(w).filter((spot) => territoryAt(spot.pos)?.id === 'fallen-sun')) {
      const table = spotTable(o);
      const stock = stockOf(w, o.id);
      expect(table).toBe(o.kind === 'landmark' && o.look === 'hullCache' ? SALVAGE.landmark : SALVAGE.hullScrap);
      expect(stock.hidden.goods.parts).toBeGreaterThanOrEqual(table.parts[0]);
      expect(stock.hidden.goods.parts).toBeLessThanOrEqual(table.parts[1]);
      expect(stock.hidden.fuel).toBeLessThanOrEqual(table.fuel[1]);
      expect(stock.radius).toBeCloseTo(propReach(o), 6);
    }
  }, budget(30_000));

  it('gives every Glass Flats spot its own stock from the table of its look, and Glass Flats no stock of its own (IV5)', async () => {
    const w = await realWorld();
    const flats = REGION.locations.find((site) => site.id === 'glass-flats')!;
    const spots = spotsOf(w).filter((o) => siteGap(flats, o.pos) < 0);
    const tables: Record<string, LootTable> = { hullCache: SALVAGE.engineScrap, ruinCompound: SALVAGE.cityStores, deadTruck: SALVAGE.roadWreck };
    expect(spots).toHaveLength(21);
    for (const o of spots) {
      const stocks = w.salvage.filter((s) => s.id === o.id);
      expect(stocks, o.id).toHaveLength(1);
      expect(territoryOfStock(stocks[0])?.id, o.id).toBe('glass-flats');
      expect(o.kind === 'landmark' && spotTable(o), o.id).toBe(tables[o.kind === 'landmark' ? o.look : o.kind]);
    }
    expect(w.salvage.some((s) => s.id === 'glass-flats')).toBe(false);
  }, budget(30_000));

  it('keeps no stock under a location id, and renews a day without a throw (IV2)', async () => {
    const w = await realWorld();
    const ids = new Set(REGION.locations.map((site) => site.id));
    expect(w.salvage.filter((s) => ids.has(s.id))).toEqual([]);
    expect(() => runDays(w, 1)).not.toThrow();
  }, budget(30_000));

  it('refills an emptied Glass Flats compound over days and never past its table', async () => {
    const w = await realWorld();
    const compounds = spotsOf(w).filter((spot) => spot.kind === 'landmark' && spot.look === 'ruinCompound');
    const stocks = compounds.map((o) => stockOf(w, o.id));
    for (const stock of stocks) emptyStock(stock);
    runDays(w, 365);
    for (const [k, stock] of stocks.entries()) {
      for (const [good, [, hi]] of Object.entries(SALVAGE.cityStores.goods)) expect((stock.goods[good] ?? 0) + (stock.hidden.goods[good] ?? 0), `${compounds[k].id} ${good}`).toBe(hi);
      expect((stock.supplies ?? 0) + stock.hidden.supplies, compounds[k].id).toBe(SALVAGE.cityStores.supplies[1]);
    }
  }, budget(30_000));

  it('refills an emptied spot over days and never past its table', async () => {
    const w = await realWorld();
    const caches = spotsOf(w).filter((spot) => spot.kind === 'landmark' && spot.look === 'hullCache' && territoryAt(spot.pos)?.id === 'fallen-sun');
    const stocks = caches.map((o) => stockOf(w, o.id));
    for (const stock of stocks) emptyStock(stock);
    runDays(w, 1);
    const scrap = () => stocks.reduce((n, stock) => n + (stock.hidden.goods.scrap ?? 0), 0);
    expect(scrap()).toBeLessThan(stocks.length * SALVAGE.landmark.goods.scrap[1]);
    runDays(w, 365);
    for (const [k, stock] of stocks.entries()) {
      expect(stock.hidden.goods.scrap, caches[k].id).toBe(SALVAGE.landmark.goods.scrap[1]);
      expect(stock.hidden.goods.parts, caches[k].id).toBe(SALVAGE.landmark.parts[1]);
      expect(stock.hidden.fuel, caches[k].id).toBe(SALVAGE.landmark.fuel[1]);
      expect(stockOf(w, caches[k].id).hidden.parts.length, caches[k].id).toBeLessThanOrEqual(1);
    }
  }, budget(30_000));

  it('lets a parked player beside a spot search it, and not a moving one', async () => {
    const w = await realWorld();
    const o = spotsOf(w)[0];
    const me = w.vehicles[0];
    me.pos = { x: o.pos.x + propReach(o) + 1, y: o.pos.y };
    me.speed = 0;
    expect(canScavenge(w, o.id)).toBe(true);
    me.speed = RULES.parkedSpeed + 1;
    expect(canScavenge(w, o.id)).toBe(false);
  }, budget(30_000));

  it('leaves road wreck stock alone', async () => {
    const w = await realWorld();
    for (const o of spotsOf(w)) expect(isRoadWreck(stockOf(w, o.id))).toBe(false);
  }, budget(30_000));
});

describe('salvage place', () => {
  async function realWorld(): Promise<World> {
    const { newWorld } = await import('./world');
    const { startKit } = await import('../data/start');
    return newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
  }

  function spotStock(w: World, territory: string, look: string): SalvageStock {
    const o = w.obstacles.find((p) => isLootSpot(p) && p.kind === 'landmark' && p.look === look && territoryAt(p.pos)?.id === territory);
    if (!o) throw new Error(`No ${look} spot in ${territory}`);
    return stockOf(w, o.id);
  }

  it('calls a dropped heap a pile', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    addGoods(w, npc, 'scrap', 3);
    expect(salvagePlace(createCargoSalvage(w, npc, 1))).toBe('pile');
  });

  it('calls road wrecks and destroyed trucks wrecks', async () => {
    const w = await realWorld();
    const road = w.salvage.find((s) => isRoadWreck(s));
    if (!road) throw new Error('No road wreck');
    expect(salvagePlace(road)).toBe('wreck');
    const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 10, y: 10 });
    wreckVehicle(w, npc);
    expect(salvagePlace(stockOf(w, `wreck-${npc.id}`))).toBe('wreck');
  }, 30_000);

  it('calls army trucks, ship caches and hull caches wrecks, and other loot spots spots', async () => {
    const w = await realWorld();
    expect(salvagePlace(spotStock(w, 'orchard', 'armyTruck'))).toBe('wreck');
    expect(salvagePlace(spotStock(w, 'fallen-sun', 'shipCache'))).toBe('wreck');
    expect(salvagePlace(spotStock(w, 'fallen-sun', 'hullCache'))).toBe('wreck');
    expect(salvagePlace(spotStock(w, 'orchard', 'farmhouse'))).toBe('spot');
    expect(salvagePlace(spotStock(w, 'orchard', 'quonset'))).toBe('spot');
  }, 30_000);

  it('throws on a stock it cannot place', async () => {
    const w = await realWorld();
    const farmhouse = spotStock(w, 'orchard', 'farmhouse');
    expect(() => salvagePlace({ ...farmhouse, id: 'mystery-0' })).toThrow();
    expect(() => salvagePlace({ ...farmhouse, id: 'farmhouse-0', pos: { x: -100, y: -100 } })).toThrow();
  }, 30_000);

  it('says a looter is looting here at a spot that is no wreck', async () => {
    const w = await realWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    expect(lootBlockedError(w, npc, spotStock(w, 'orchard', 'farmhouse').id)).toEqual({ id: 'looting', by: npc.id, place: 'here' });
    expect(lootBlockedError(w, npc, spotStock(w, 'orchard', 'armyTruck').id)).toEqual({ id: 'looting', by: npc.id, place: 'wreck' });
  }, 30_000);
});

describe('old-world loot spots', () => {
  const picks = oldSpotPicks(TEST_MAP);
  const oldStocks = (w: World): SalvageStock[] => w.salvage.filter((stock) => oldSpotOf(stock));

  it('gives every pick of the map one stock from its place type table', () => {
    const w = emptyWorld();
    expect(oldStocks(w).map((stock) => stock.id)).toEqual(picks.map(oldStockId));
    for (const p of picks) {
      const stock = stockOf(w, oldStockId(p));
      expect(stock.pos).toEqual(p.pos);
      expect(stock.radius).toBe(p.reach);
      for (const [good, [, hi]] of Object.entries(OLD_TABLES[p.type].goods)) expect(stock.hidden.goods[good], `${stock.id} ${good}`).toBeLessThanOrEqual(hi);
    }
  });

  it('reads a building as a loot spot and a tank hulk as a wreck', () => {
    const stock = (id: string): SalvageStock => ({ id, pos: { x: 0, y: 0 }, radius: 1, goods: {}, parts: [], hidden: emptyHidden() });
    expect(salvagePlace(stock('old-hamlet-ruin-12'))).toBe('spot');
    expect(salvagePlace(stock('old-homestead-silo-3'))).toBe('spot');
    expect(salvagePlace(stock('old-hulks-tank-40'))).toBe('wreck');
  });

  it('rolls a rare low-wear car part at the table odds', () => {
    const table = OLD_TABLES.hulks;
    const rare = table.rare!;
    const w = emptyWorld();
    let rares = 0;
    const rolls = 2000;
    for (let k = 0; k < rolls; k++) {
      const parts = rollStock(w, table, `t${k}`, { x: 0, y: 0 }, 1).hidden.parts.filter((part) => rare.parts.includes(part.defId));
      rares += parts.length;
      for (const part of parts) expect(part.wear).toBeLessThanOrEqual(1);
    }
    expect(table.spareParts.some((id) => rare.parts.includes(id))).toBe(false);
    expect(Math.abs(rares / rolls - table.sparePartChance * rare.share)).toBeLessThan(0.015);
  });

  it('makes the same draws as before for a table with no rare pool', () => {
    const table: LootTable = { ...SALVAGE.landmark, sparePartChance: 0.5 };
    for (let k = 0; k < 20; k++) {
      const a = emptyWorld();
      a.rngState = 1000 + k;
      const b = cloneSeeds(a);
      const rolled = rollStock(a, table, 's', { x: 0, y: 0 }, 1);
      expect(rolled.hidden).toEqual(rollWithoutRare(b, table).hidden);
      expect(a.rngState).toBe(b.rngState);
      expect(a.marketRng.rngState).toBe(b.marketRng.rngState);
    }
  });

  it('refills an emptied old spot daily, up to its table highs', () => {
    const w = emptyWorld();
    const p = picks.find((pick) => pick.type === 'hulks')!;
    const stock = stockOf(w, oldStockId(p));
    emptyStock(stock);
    runDays(w, 1);
    const firstDay = stock.hidden.goods.scrap;
    runDays(w, 365);
    expect(firstDay).toBeLessThan(OLD_TABLES.hulks.goods.scrap[1]);
    expect(stock.hidden.goods.scrap).toBe(OLD_TABLES.hulks.goods.scrap[1]);
    expect(stock.hidden.parts.length).toBeLessThanOrEqual(1);
    for (const [good, [, hi]] of Object.entries(OLD_TABLES.hulks.goods)) expect(stock.hidden.goods[good]).toBeLessThanOrEqual(hi);
    expect(stock.hidden.fuel).toBeLessThanOrEqual(OLD_TABLES.hulks.fuel[1]);
  });

  it('never removes an old spot stock', () => {
    const w = emptyWorld();
    expect(() => removeStocks(w, new Set([oldStockId(picks[0])]))).toThrow(/never leaves/);
    expect(oldStocks(w)).toHaveLength(picks.length);
  });

  it('stocks a world with none once, and refuses a partial or stray set', () => {
    const w = emptyWorld();
    const held = oldStocks(w).map((stock) => structuredClone(stock));
    stockOldSpots(w, TEST_MAP);
    expect(oldStocks(w)).toEqual(held);
    w.salvage = w.salvage.filter((stock) => !oldSpotOf(stock));
    stockOldSpots(w, TEST_MAP);
    expect(oldStocks(w).map((stock) => stock.id)).toEqual(picks.map(oldStockId));
    w.salvage = w.salvage.filter((stock) => stock.id !== oldStockId(picks[0]));
    expect(() => stockOldSpots(w, TEST_MAP)).toThrow(/partial/);
    const stray = emptyWorld();
    stray.salvage.push({ id: 'old-hamlet-ruin-999999', pos: { x: 0, y: 0 }, radius: 1, goods: {}, parts: [], hidden: emptyHidden() });
    expect(() => stockOldSpots(stray, TEST_MAP)).toThrow(/no old spot/);
  });
});

// A world with the same rng streams, for replaying draws.
function cloneSeeds(w: World): World {
  const copy = emptyWorld();
  copy.rngState = w.rngState;
  copy.marketRng = { ...w.marketRng };
  copy.nextId = w.nextId;
  return copy;
}

// A stock roll as it was before rare pools: goods, the parts good, then one spare part with field wear.
function rollWithoutRare(w: World, table: LootTable): SalvageStock {
  const goods: Record<string, number> = {};
  for (const [good, [lo, hi]] of Object.entries(table.goods)) goods[good] = randInt(w, lo, hi);
  goods.parts = randInt(w, table.parts[0], table.parts[1]);
  const parts = [];
  if (chance(w, table.sparePartChance)) {
    const defId = table.spareParts[randInt(w, 0, table.spareParts.length - 1)];
    parts.push(makePart(w, defId, sampleWeighted(w.marketRng, FIELD_SPARE_WEAR)));
  }
  const hidden = { goods, parts, fuel: randInt(w, ...table.fuel), supplies: randInt(w, ...table.supplies) };
  return { id: 's', pos: { x: 0, y: 0 }, radius: 1, goods: {}, parts: [], fuel: 0, supplies: 0, hidden };
}
