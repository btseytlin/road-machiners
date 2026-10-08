import { describe, expect, it } from 'vitest';
import { ECONOMY, GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { DISTANCE_PREMIUM, EFFORT, GOOD_SOURCES, PRICE_FACTOR, PRESSURE_MAX, SHOPS } from '../data/market';
import { dist } from './vec';
import { emptyWorld, addVehicle, npcBrain } from './testkit';
import type { Vehicle, World } from './types';
import { freeCells } from './grid';
import {
  addStockPart,
  creditBounty,
  advanceShop,
  estimateTurns,
  goodBasePrice,
  goodPrice,
  initShop,
  lotPrice,
  recordTrade,
  siteOf,
  takeStockPart,
  type Contract,
  type ShopState,
} from './market';

describe('market', () => {
  it('raises pressure on buying and lowers it on selling', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    expect(state.pressure.scrap).toBe(0);
    recordTrade('bowl', state, 'scrap', 10, 'buy');
    expect(state.pressure.scrap).toBeGreaterThan(0);
    const afterBuy = state.pressure.scrap;
    recordTrade('bowl', state, 'scrap', 10, 'sell');
    expect(state.pressure.scrap).toBeLessThan(afterBuy);
  });

  it('absorbs a full hauler load at a garage before the price moves halfway to its floor or ceiling', () => {
    const w = emptyWorld();
    const load = freeCells(addVehicle(w, 'raiders', 'hauler', [], { x: 0, y: 0 }));
    const state = initShop(w, 'bowl');
    const before = goodPrice('bowl', state, 'scrap', 'sell', ECONOMY.spread);
    recordTrade('bowl', state, 'scrap', load, 'sell');
    const after = goodPrice('bowl', state, 'scrap', 'sell', ECONOMY.spread);
    expect(before - after).toBeLessThan(before * (PRESSURE_MAX / 2));
  });

  it('saturates a stall on a far smaller lot than a garage', () => {
    const w = emptyWorld();
    const units = 6; // near a stall's own restocked shelf size
    const stall = initShop(w, 'salvage-yard');
    const garage = initShop(w, 'bowl');
    recordTrade('salvage-yard', stall, 'scrap', units, 'sell');
    recordTrade('bowl', garage, 'scrap', units, 'sell');
    expect(Math.abs(stall.pressure.scrap)).toBeGreaterThan(Math.abs(garage.pressure.scrap));
  });

  it('clamps pressure to PRESSURE_MAX', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    recordTrade('bowl', state, 'scrap', 100000, 'buy');
    expect(state.pressure.scrap).toBe(PRESSURE_MAX);
    recordTrade('bowl', state, 'scrap', 100000, 'sell');
    expect(state.pressure.scrap).toBe(-PRESSURE_MAX);
  });

  it('drifts pressure back toward 0 over turns without crossing it', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    recordTrade('bowl', state, 'scrap', 10, 'buy');
    let last = state.pressure.scrap;
    expect(last).toBeGreaterThan(0);
    for (let i = 0; i < 500; i++) {
      w.turn++;
      // Stay well before the next restock so only drift, not a fresh roll, moves pressure.
      state.restockAt = w.turn + SHOPS.bowl.restockTurns;
      advanceShop(w, 'bowl', state);
      expect(state.pressure.scrap).toBeLessThanOrEqual(last);
      expect(state.pressure.scrap).toBeGreaterThanOrEqual(0);
      last = state.pressure.scrap;
    }
    expect(state.pressure.scrap).toBeLessThan(0.05);
  });

  it('rolls a finite stock that restocking replaces deterministically for a given rng state', () => {
    const w1 = emptyWorld();
    const w2 = emptyWorld();
    const s1 = initShop(w1, 'salvage-yard');
    const s2 = initShop(w2, 'salvage-yard');
    expect(s1.stock.map((p) => [p.defId, p.wear])).toEqual(s2.stock.map((p) => [p.defId, p.wear]));
    expect(s1.stock.length).toBeGreaterThanOrEqual(SHOPS['salvage-yard'].stockSize[0]);
    expect(s1.stock.length).toBeLessThanOrEqual(SHOPS['salvage-yard'].stockSize[1]);

    // Force a restock and check the same rng state gives the same fresh stock again.
    s1.restockAt = w1.turn;
    s2.restockAt = w2.turn;
    advanceShop(w1, 'salvage-yard', s1);
    advanceShop(w2, 'salvage-yard', s2);
    expect(s1.stock.map((p) => [p.defId, p.wear])).toEqual(s2.stock.map((p) => [p.defId, p.wear]));
  });

  it.each(Object.values(SHOPS).filter((shop) => shop.kind === 'garage').map((shop) => shop.id))('shows a utility on at least 80%% of %s shelves across 50 restocks', (shopId) => {
    const w = emptyWorld();
    const state = initShop(w, shopId);
    let withUtility = 0;
    for (let restock = 0; restock < 50; restock++) {
      state.restockAt = w.turn;
      advanceShop(w, shopId, state);
      if (state.stock.some((p) => partDef(p.defId).kind === 'utility')) withUtility++;
    }

    expect(withUtility / 50).toBeGreaterThanOrEqual(0.8);
  });

  it('takeStockPart removes a part and addStockPart inserts one', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    const before = state.stock.length;
    const target = state.stock[0];
    const taken = takeStockPart(state, target.id);
    expect(taken).toBe(target);
    expect(state.stock.length).toBe(before - 1);
    expect(state.stock.find((p) => p.id === target.id)).toBeUndefined();
    addStockPart(state, taken);
    expect(state.stock.length).toBe(before);
    expect(state.stock.find((p) => p.id === target.id)).toBe(taken);
  });

  it('throws taking a part id that is not in stock', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    expect(() => takeStockPart(state, 'no-such-part')).toThrow();
  });

  it('throws pricing a good a shop does not trade', () => {
    const w = emptyWorld();
    const state = initShop(w, 'granary');
    expect(() => goodBasePrice('granary', 'electronics')).toThrow();
    expect(() => goodPrice('granary', state, 'electronics', 'buy', 0.2)).toThrow();
    expect(() => recordTrade('granary', state, 'electronics', 1, 'buy')).toThrow();
  });

  it('throws for an unknown shop', () => {
    expect(() => goodBasePrice('no-such-shop', 'scrap')).toThrow();
  });

  it('always prices a sell strictly below the buy at the same shop', () => {
    const w = emptyWorld();
    const state: ShopState = initShop(w, 'nose');
    for (const good of SHOPS.nose.goods) {
      const buy = goodPrice('nose', state, good, 'buy', 0.2);
      const sell = goodPrice('nose', state, good, 'sell', 0.2);
      expect(sell).toBeLessThan(buy);
    }
  });

  it('prices a good made locally below the same good sold farther from any maker', () => {
    // Bowl makes scrap, so it prices lowest; Nose, farther from any scrap maker, prices dearer.
    expect(goodBasePrice('bowl', 'scrap')).toBeLessThan(goodBasePrice('nose', 'scrap'));
    // Nose makes salt; Bowl sits far from Nose, the only salt maker, so it prices dearer still.
    expect(goodBasePrice('nose', 'salt')).toBeLessThan(goodBasePrice('bowl', 'salt'));
  });

  it('prices a good higher the farther a shop sits from its nearest maker', () => {
    // Salt has one maker, Nose. Granary sits about half the Bowl-Nose distance from Nose, so it
    // should price salt between Nose's own make price and Bowl's, the farthest point that trades it.
    const nose = goodBasePrice('nose', 'salt');
    const granary = goodBasePrice('granary', 'salt');
    const bowl = goodBasePrice('bowl', 'salt');
    expect(nose).toBeLessThan(granary);
    expect(granary).toBeLessThan(bowl);
  });

  it('prices a good no shop makes by the distance to its nearest source site', () => {
    const toPump = dist(siteOf('bowl').pos, siteOf('pump-station').pos);
    const expected = GOODS.fuelDrums.value * (PRICE_FACTOR.make + DISTANCE_PREMIUM.perTile * toPump);
    expect(goodBasePrice('bowl', 'fuelDrums')).toBeCloseTo(expected, 9);
  });

  it('prices water by the nearer of its two oases', () => {
    const toOasis = Math.min(...['dustwell', 'green-pit'].map((id) => dist(siteOf('nose').pos, siteOf(id).pos)));
    const expected = GOODS.water.value * (PRICE_FACTOR.make + DISTANCE_PREMIUM.perTile * toOasis);
    expect(goodBasePrice('nose', 'water')).toBeCloseTo(expected, 9);
  });

  it('throws pricing a good with neither a maker nor a source site', () => {
    const sources = GOOD_SOURCES.water;
    delete GOOD_SOURCES.water;
    try {
      expect(() => goodBasePrice('bowl', 'water')).toThrow('No shop or source site makes water');
    } finally {
      GOOD_SOURCES.water = sources;
    }
  });

  it('pays a full truck load of a haul about haulWages tier wages times the trip turns, lot pressure included', () => {
    // Salt is made only at Nose. A full scout load bought there and sold at Bowl, the farthest point
    // that trades it, is the design's own worked example for what distance should pay.
    const w = emptyWorld();
    const units = freeCells(addVehicle(w, 'raiders', 'scout', [], { x: 0, y: 0 }));
    const buy = lotPrice('nose', initShop(w, 'nose'), 'salt', 'buy', ECONOMY.spread, units);
    const sell = lotPrice('bowl', initShop(w, 'bowl'), 'salt', 'sell', ECONOMY.spread, units);
    const turns = estimateTurns(siteOf('nose').pos, siteOf('bowl').pos);
    const target = turns * EFFORT.wage[1] * EFFORT.haulWages; // salt is tier 1
    expect(sell - buy).toBeGreaterThan(target * 0.7);
    expect(sell - buy).toBeLessThan(target * 1.3);
  });

  it('pays a shorter haul less in total, but not less per turn, than a longer one', () => {
    // Granary sits well short of Bowl on the road out from Nose, salt's only maker. A modest lot,
    // sized like an actual haul contract rather than a full truck dump, keeps a small stall's thin
    // stock from swamping the comparison.
    const w = emptyWorld();
    const units = 5;
    const routeProfit = (sellShop: string) => {
      const buy = lotPrice('nose', initShop(w, 'nose'), 'salt', 'buy', ECONOMY.spread, units);
      const sell = lotPrice(sellShop, initShop(w, sellShop), 'salt', 'sell', ECONOMY.spread, units);
      const turns = estimateTurns(siteOf('nose').pos, siteOf(sellShop).pos);
      return { profit: sell - buy, turns };
    };
    const long = routeProfit('bowl');
    const short = routeProfit('granary');
    expect(long.turns).toBeGreaterThan(short.turns);
    expect(long.profit).toBeGreaterThan(short.profit);
    expect(long.profit / long.turns).toBeGreaterThanOrEqual(short.profit / short.turns);
  });
});

describe('creditBounty', () => {
  const bounty = (id: string, template: string): Contract => ({ id, shop: 'bowl', kind: 'bounty', template, targetName: 'Target', reward: 10000, deadline: 900, window: 900, tier: 2 });

  function withTarget(): { w: World; npc: Vehicle } {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'scout', [], { x: 36, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    w.player.money = 0;
    return { w, npc };
  }

  it('finishes one held bounty on the template, as a knockout does', () => {
    const { w, npc } = withTarget();
    w.player.contracts = [bounty('a', 'buggy'), bounty('b', 'buggy'), bounty('c', 'truck')];
    creditBounty(w, npc);
    expect(w.player.contracts.map((c) => c.id)).toEqual(['b', 'c']);
    expect(w.player.money).toBe(10000);
  });

  it('does nothing without a bounty on the template', () => {
    const { w, npc } = withTarget();
    w.player.contracts = [bounty('c', 'truck')];
    creditBounty(w, npc);
    expect(w.player.contracts.map((c) => c.id)).toEqual(['c']);
    expect(w.player.money).toBe(0);
  });
});
