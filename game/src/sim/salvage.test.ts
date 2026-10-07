import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { TERRITORIES } from '../data/territory';
import { GOODS } from '../data/goods';
import { TIME } from '../data/time';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import { resolveDestroyed, wreckVehicle } from './combat';
import { addGoods, dumpItem, removeGoods } from './inventory';
import { corePart, findSpot, goodsCount, gridOf, mountedParts } from './grid';
import { partDef } from '../data/parts';
import { chassisDef } from '../data/chassis';
import { BREAKABLE, RULES } from '../data/rules';
import { takeAllLoot, takeLoot, takeStores, canScavenge, scavenge } from './locations';
import {
  breakProp, canTakeAny, claimPile, claimantOf, clearPiles, collectSalvage, createCargoSalvage, hasSalvage, initializeSalvage, isLootTarget, isRoadWreck, lootBlockedError, lootBlocker,
  isSiteStock, lootClaimedBy, looterOf, renewSalvage, salvageInRange, salvagePlace, salvageUnits, siteLootTable,
} from './salvage';
import { knockOutNpc } from './defeat';
import { SHOPS } from '../data/market';
import type { NpcActivity, Obstacle, RefitPickup, SalvageStock, Vehicle, World } from './types';
import { propReach } from './mapgen';
import { dist, type Vec } from './vec';
import { maxHp } from './wear';
import { canVehicleSee, grayRadius } from './vision';
import { siteGap, sitePads } from './sites';
import { isLootSpot, spotTable, territoryAt, territoryOfStock } from './territory';
import { freeCells } from './grid';
import { endTurn } from './world';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';

describe('player piles', () => {
  it('goods the player dumps and takes back keep their cost basis', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    addGoods(w, me, 'scrap', 2);
    const held = goodsCount(me).scrap;
    w.player.costBasis.scrap = 12;
    let next = w;
    for (const item of me.items.filter((it) => it.kind === 'good' && it.good === 'scrap')) next = dumpItem(next, item.id);
    const pile = next.salvage.find((s) => s.pile)!;
    collectSalvage(next, next.vehicles[0], pile.id, 100);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(held);
    expect(next.player.costBasis.scrap).toBe(12);
  });

  it('goods from a pile another truck dropped count at their base value', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', [], { x: 31, y: 30 });
    addGoods(w, npc, 'scrap', 2);
    const pile = createCargoSalvage(w, npc, 1);
    const held = goodsCount(w.vehicles[0]).scrap ?? 0;
    w.player.costBasis.scrap = 12;
    collectSalvage(w, w.vehicles[0], pile.id, 100);
    expect(w.player.costBasis.scrap).toBeCloseTo((12 * held + GOODS.scrap.value * 2) / (held + 2));
    expect(w.player.scavenged).not.toContain(pile.id);
  });

  it('a looted unit taken first does not wipe the paid basis of goods taken back from the player pile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    addGoods(w, me, 'tools', 6);
    w.player.costBasis.tools = 180;
    let next = w;
    for (const item of me.items.filter((it) => it.kind === 'good')) next = dumpItem(next, item.id);
    next.salvage.push({ id: 'free', pos: { x: 30, y: 30 }, radius: 1, goods: { tools: 1 }, parts: [] });
    next.player.scavenged.push('free');
    collectSalvage(next, next.vehicles[0], 'free', 100);
    expect(next.player.costBasis.tools).toBe(GOODS.tools.value);
    collectSalvage(next, next.vehicles[0], next.salvage.find((s) => s.pile?.fromPlayer)!.id, 100);
    expect(goodsCount(next.vehicles[0]).tools).toBe(7);
    expect(next.player.costBasis.tools).toBeCloseTo((180 * 6 + GOODS.tools.value) / 7);
  });

  it('one looted good taken by hand moves the basis like taking all', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    addGoods(w, me, 'scrap', 2);
    w.player.costBasis.scrap = 12;
    w.salvage.push({ id: 'free', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.scavenged.push('free');
    const spot = findSpot(gridOf(me), me.items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    expect(takeLoot(w, 'free', { kind: 'good', good: 'scrap' }, spot).player.costBasis.scrap).toBeCloseTo((12 * 2 + GOODS.scrap.value) / 3);
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
  it('gives a site with a shop no salvage stock', () => {
    const shopSites = REGION.locations.filter((site) => site.id in SHOPS);
    expect(shopSites.length).toBeGreaterThan(0);
    for (const site of shopSites) expect(siteLootTable(site), site.id).toBeNull();
    expect(REGION.locations.some((site) => siteLootTable(site) !== null)).toBe(true);
  });

  it('leaves overflow for another collector and never duplicates it', () => {
    const w = emptyWorld();
    const a = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    const b = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    addGoods(w, a, 'salt', freeCells(a) - 1);
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: 3 }, parts: [] });
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
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: {}, parts: [], fuel: 5, supplies: 4 });
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
    const stock: SalvageStock = { id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: {}, parts: [], supplies: 2 };
    npc.resources!.supplies = RULES.baseSupplies - 0.015;
    expect(canTakeAny(w, npc, stock)).toBe(false);
    npc.resources!.supplies = RULES.baseSupplies - 1;
    expect(canTakeAny(w, npc, stock)).toBe(true);
  });

  it('lets an NPC collector take fuel and supplies', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: {}, parts: [], fuel: 5, supplies: 2 });
    collectSalvage(w, npc, 'test-stock', 100);
    expect(npc.resources).toEqual(expect.objectContaining({ fuel: 5, supplies: 2 }));
    expect(hasSalvage(w.salvage.find((s) => s.id === 'test-stock')!)).toBe(false);
  });

  it('never moves more than a stock holds, even asked for more', () => {
    const w = emptyWorld();
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [] });
    expect(collectSalvage(w, w.vehicles[0], 'test-stock', 100)).toBe(3);
    expect(w.salvage.find((s) => s.id === 'test-stock')!.goods.scrap).toBe(0);
    expect(collectSalvage(w, w.vehicles[0], 'test-stock', 100)).toBe(0);
  });

  it('cannot recreate convoy loot by clearing player discovery state', () => {
    describe('pile claims', () => {
  function claimed() {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    const victim = addVehicle(w, 'scavengers', 'scout', [], { x: 30, y: 32 });
    addGoods(w, victim, 'scrap', 2);
    const claimant = addVehicle(w, 'raiders', 'scout', [], { x: 34, y: 30 });
    claimant.brain = npcBrain('raider', claimant.pos, []);
    const pile = createCargoSalvage(w, victim, 1);
    claimant.brain.goals.push({ kind: 'loot', targetId: pile.id, destination: { ...pile.pos }, phase: 'travel', reason: 'test' });
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

const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    const w = emptyWorld({ ...sitePads(convoy)[0] });
    // Keep the built-ins so the truck still runs, but clear cargo so the search has room to fill.
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part' && partDef(item.part.defId).kind === 'core');
    // Empty the tank and stores so the convoy's fuel and supplies fit.
    w.player.fuel = 0;
    w.player.supplies = 0;
    const totalScrap = w.salvage.find((s) => s.id === convoy.id)!.goods.scrap;
    let next = scavenge(w, convoy.id);
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next, testDrive);
      if (++turns > 50) throw new Error('search never finished');
    }
    next = takeAllLoot(next, convoy.id);
    next.player.scavenged = [];
    expect(canScavenge(next, convoy.id)).toBe(false);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(totalScrap);
  });

  it('fills a landmark site with loot at world creation', () => {
    // A landmark with a shop trades instead, so the site is the first that rolls from the landmark table.
    const landmark = REGION.locations.find((site) => siteLootTable(site) === SALVAGE.landmark)!;
    expect(landmark.kind).toBe('landmark');
    const w = emptyWorld();
    const stock = w.salvage.find((s) => s.id === landmark.id)!;
    expect(hasSalvage(stock)).toBe(true);
    expect(stock.goods.parts).toBeGreaterThan(0);
    expect(stock.fuel).toBeGreaterThanOrEqual(SALVAGE.landmark.fuel[0]);
    expect(stock.supplies).toBeGreaterThanOrEqual(SALVAGE.landmark.supplies[0]);
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
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [] });
    collectSalvage(w, w.vehicles[0], 'test-stock', 100);
    expect(w.player.costBasis.scrap).toBe(GOODS.scrap.value);
  });
});

describe('field spare parts', () => {
  it('are mostly worn, so a pristine find is rare', () => {
    const wears: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const w = emptyWorld();
      w.rngState = seed;
      w.marketRng.rngState = seed * 7919;
      initializeSalvage(w);
      for (const stock of w.salvage) wears.push(...stock.parts.map((p) => p.wear));
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
    const w = newWorld(1337, startKit('standard'), TEST_MAP);
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

const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;

function stockOf(w: World, id: string): SalvageStock {
  return w.salvage.find((stock) => stock.id === id)!;
}

function emptyStock(stock: SalvageStock): void {
  for (const good of Object.keys(stock.goods)) stock.goods[good] = 0;
  stock.parts = [];
  stock.fuel = 0;
  stock.supplies = 0;
}

// A world whose only road wreck is a looted one at `pos`, with the player at `playerPos`.
function worldWithLootedWreck(playerPos: Vec, pos: Vec): World {
  const w = emptyWorld(playerPos);
  w.salvage = w.salvage.filter((stock) => !isRoadWreck(stock));
  w.obstacles = [{ id: 'wreck0', pos, r: 0.6, kind: 'wreck' }];
  w.salvage.push({ id: 'wreck0', pos, radius: 0.6, goods: { scrap: 0 }, parts: [] });
  return w;
}

// Jumps to the last turn of each of the next `days` days and renews there.
function runDays(w: World, days: number): void {
  for (let day = 0; day < days; day++) {
    w.turn = (Math.floor(w.turn / TIME.turnsPerDay) + 1) * TIME.turnsPerDay;
    renewSalvage(w);
  }
}

describe('site restock', () => {
  it('refills an emptied site a share at a time, up to the table highs', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    emptyStock(stock);
    runDays(w, 1);
    const firstDay = stock.goods.scrap;
    // A unit comes back at SALVAGE.restockShare a day, so a year of days fills every range but for
    // odds far below one in a million.
    runDays(w, 365);
    expect(firstDay).toBeLessThan(SALVAGE.convoy.goods.scrap[1]);
    expect(stock.goods.scrap).toBe(SALVAGE.convoy.goods.scrap[1]);
    expect(stock.goods.parts).toBe(SALVAGE.convoy.parts[1]);
    expect(stock.fuel).toBe(SALVAGE.convoy.fuel[1]);
  });

  it('refills an emptied spare part slot with one part at a small daily chance', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    emptyStock(stock);
    // The daily chance is sparePartChance * restockShare, a few percent, so 1000 days refill it
    // except with odds far below one in a million.
    let days = 0;
    while (stock.parts.length === 0 && days < 1000) {
      runDays(w, 1);
      days++;
    }
    runDays(w, 30);
    expect(stock.parts).toHaveLength(1);
  });

  it('restocks only on the last turn of a day', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    emptyStock(stock);
    for (let turn = 1; turn < TIME.turnsPerDay; turn++) {
      w.turn = turn;
      renewSalvage(w);
    }
    expect(stock.goods.scrap).toBe(0);
  });

  it('keeps a count above the table high', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    stock.goods.parts = SALVAGE.convoy.parts[1] + 5;
    runDays(w, 1);
    expect(stock.goods.parts).toBe(SALVAGE.convoy.parts[1] + 5);
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
    expect(stockOf(w, wrecks[0].id).goods.scrap).toBeGreaterThan(0);
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

  // The player parked at 30,30 on top of a wreck stock that nobody works yet.
  function wreckWorld(): { w: World; me: Vehicle; stock: SalvageStock } {
    const w = emptyWorld(at);
    const stock: SalvageStock = { id: 'wreck-test', pos: { ...at }, radius: 0.6, goods: { scrap: 3 }, parts: [] };
    w.salvage.push(stock);
    return { w, me: w.vehicles[0], stock };
  }

  // A scavenger parked beside the player, with a brain and no goals.
  function scavenger(w: World, pos: Vec = beside): Vehicle {
    const npc = addVehicle(w, 'scavengers', 'scout', [], pos);
    npc.brain = npcBrain('scav', pos, []);
    return npc;
  }

  // The player parked beside a knocked-out raider buggy.
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
  const lootGoal = (targetId: string, phase: NpcActivity['phase']): NpcActivity => ({ kind: 'loot', targetId, destination: null, phase, reason: 'test' });

  it('counts wrecks, piles and knocked-out trucks as loot targets, and never a site or a running truck', () => {
    const { w, stock } = wreckWorld();
    const running = scavenger(w);
    expect(isLootTarget(w, stock.id)).toBe(true);
    expect(isLootTarget(w, convoy.id)).toBe(false);
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

  it('never gives a site stock a looter', () => {
    const w = emptyWorld({ ...sitePads(convoy)[0] });
    const npc = scavenger(w, { ...sitePads(convoy)[0] });
    npc.job = { kind: 'search', stockId: convoy.id, turnsLeft: 3, total: 3 };
    expect(looterOf(w, convoy.id)).toBeNull();
    expect(lootBlocker(w, w.vehicles[0], convoy.id)).toBeNull();
  });

  it('names the looter and what it loots in the error', () => {
    const { w, stock } = wreckWorld();
    const npc = scavenger(w);
    expect(lootBlockedError(w, npc, stock.id)).toBe(`${npc.name} is looting this wreck`);
    const { w: dw, buggy } = downedWorld();
    expect(lootBlockedError(dw, npc, buggy.id)).toBe(`${npc.name} is looting this truck`);
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
    return newWorld(1337, startKit('standard'), TEST_MAP);
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
      expect(stocks[0].goods.parts ?? 0, o.id).toBeGreaterThanOrEqual(table.parts[0]);
      expect(stocks[0].goods.parts ?? 0, o.id).toBeLessThanOrEqual(table.parts[1]);
    }
    expect(w.salvage.some((s) => s.id === 'orchard')).toBe(false);
  }, budget(30_000));

  it('rolls caches from the landmark table and field spots from the hull scrap table', async () => {
    const w = await realWorld();
    for (const o of spotsOf(w).filter((spot) => territoryAt(spot.pos)?.id === 'fallen-sun')) {
      const table = spotTable(o);
      const stock = stockOf(w, o.id);
      expect(table).toBe(o.kind === 'landmark' && o.look === 'hullCache' ? SALVAGE.landmark : SALVAGE.hullScrap);
      expect(stock.goods.parts).toBeGreaterThanOrEqual(table.parts[0]);
      expect(stock.goods.parts).toBeLessThanOrEqual(table.parts[1]);
      expect(stock.fuel).toBeLessThanOrEqual(table.fuel[1]);
      expect(stock.radius).toBeCloseTo(propReach(o), 6);
    }
  }, budget(30_000));

  it('refills an emptied spot over days and never past its table', async () => {
    const w = await realWorld();
    // Every cache at once, since one cache may draw a lucky full day: a day refills a share, not the table highs.
    const caches = spotsOf(w).filter((spot) => spot.kind === 'landmark' && spot.look === 'hullCache');
    const stocks = caches.map((o) => stockOf(w, o.id));
    for (const stock of stocks) emptyStock(stock);
    runDays(w, 1);
    const scrap = () => stocks.reduce((n, stock) => n + (stock.goods.scrap ?? 0), 0);
    expect(scrap()).toBeLessThan(stocks.length * SALVAGE.landmark.goods.scrap[1]);
    runDays(w, 365);
    for (const [k, stock] of stocks.entries()) {
      expect(stock.goods.scrap, caches[k].id).toBe(SALVAGE.landmark.goods.scrap[1]);
      expect(stock.goods.parts, caches[k].id).toBe(SALVAGE.landmark.parts[1]);
      expect(stock.fuel, caches[k].id).toBe(SALVAGE.landmark.fuel[1]);
      expect(stockOf(w, caches[k].id).parts.length, caches[k].id).toBeLessThanOrEqual(1);
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

  it('leaves road wreck and site stock alone', async () => {
    const w = await realWorld();
    expect(w.salvage.filter((s) => isSiteStock(s)).length).toBeGreaterThan(0);
    for (const o of spotsOf(w)) expect(isSiteStock(stockOf(w, o.id))).toBe(false);
  }, budget(30_000));
});

describe('salvage place', () => {
  async function realWorld(): Promise<World> {
    const { newWorld } = await import('./world');
    const { startKit } = await import('../data/start');
    return newWorld(1337, startKit('standard'), TEST_MAP);
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

  it('calls a site stock a site', () => {
    const site = REGION.locations.find((l) => l.id === 'podfield')!;
    expect(salvagePlace({ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: {}, parts: [] })).toBe('site');
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
    expect(lootBlockedError(w, npc, spotStock(w, 'orchard', 'farmhouse').id)).toBe(`${npc.name} is looting here`);
    expect(lootBlockedError(w, npc, spotStock(w, 'orchard', 'armyTruck').id)).toBe(`${npc.name} is looting this wreck`);
  }, 30_000);
});
