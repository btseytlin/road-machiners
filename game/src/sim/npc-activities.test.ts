import { TERRAIN } from '../data/terrain';
import { describe, expect, it } from 'vitest';
import { contactsOf } from './detect';
import { emptyWorld, addVehicle, editableTerrain, forceOption, npcBrain, testDrive , startCombat } from './testkit';
import { planNpcOrders, turnCornered } from './ai';
import { getResources } from './resources';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { MEMORY, MIN_CHANCE, NPC_BEHAVIOR, NPC_UPKEEP, NPCS, TRAITS, type TraitId } from '../data/npcs';
import { SHOPS } from '../data/market';
import { partDef } from '../data/parts';
import { damagePart } from './wear';
import { getKnownSite, getUpkeepReserve, judgeDanger, noteStripped, optionChances, optionWeights, tradeOffers, tradeSpend, tripFuelCost, visibleDowned, visibleSalvage } from './npc-decisions';
import { affordableBuyCount, getLotTradePrice, getTradePrice } from './economy';
import { cargoRoom } from './inventory';
import { ECONOMY, GOODS } from '../data/goods';
import { endTurn, newWorld } from './world';
import { corePart, freeCells, goodsCount } from './grid';
import { makePart } from './factory';
import { addGoods, hasCargoRoom } from './inventory';
import { backOffLoot, finishGoal, getActivityDestination, patchGoal, resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { chooseOn, trackOf } from './tracks';
import { watchStalls } from './npc-watchdog';
import { CANNOT_HOLD, canTakeAny, STRIPPED } from './salvage';
import { beginSearch } from './search';
import { hiddenUnits, salvageInRange, salvageUnits } from './salvage';
import { knockOutNpc } from './defeat';
import { chassisDef } from '../data/chassis';
import { cloneWorld } from './world';
import { canUseSite, siteGates, sitePads } from './sites';
import { territoryEntries, territoryOfStock, territoryPieces, territorySpots } from './territory';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { fuelCap, vehicleStats } from './stats';
import { heatAt } from './sun';
import { dist, polylineDist, type Vec } from './vec';
import { advanceFar } from './far';
import type { NpcActivity, SalvageStock, Vehicle, World } from './types';
import { addState } from './states';
import { inCombat } from './combat';
import { refreshVision } from './vision';
import { emptyHidden } from './salvage';
import { forgetOld, recall } from './memory';
import { defaultSetup } from './settings';

function overlookSalvage(w: World, npc: Vehicle): void {
  for (const stock of w.salvage) npc.brain!.noticed[`salvageSeen:${stock.id}`] = w.turn;
}

function createScavenger() {
  const w = emptyWorld({ x: 50, y: 50 });
  const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  return { w, npc };
}

function createTrader() {
  const w = emptyWorld({ x: 50, y: 50 });
  const npc = addVehicle(w, 'traders', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  return { w, npc };
}

function reserveOfTrader(): number {
  const { w, npc } = createTrader();
  const pumps = [...TRAITS.trader.towns, ...Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id)].map((id) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!);
  const pump = Math.min(...pumps.map((site) => dist(npc.pos, site.pos)));
  return pump * vehicleStats(w, npc).fuelPerTile * heatAt(w, npc.pos) * NPC_UPKEEP.fuelReserve * TRAITS.trader.fuelMargin;
}

function withFuelSense(sense: number, run: () => void): void {
  const saved = NPC_UPKEEP.fuelSense;
  (NPC_UPKEEP as { fuelSense: number }).fuelSense = sense;
  try {
    run();
  } finally {
    (NPC_UPKEEP as { fuelSense: number }).fuelSense = saved;
  }
}

describe('NPC activities', () => {
  it('uses Icarus sites for every trait destination', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const profile of Object.values(TRAITS)) {
      for (const id of [...profile.towns, ...profile.bases, ...profile.salvageSites, ...profile.supplySites, ...profile.travelSites, ...profile.haulSites]) {
        expect(sites.find((site) => site.id === id), `missing site ${id}`).toBeDefined();
      }
    }
  });

  it('sends no trait to search a site that trades', () => {
    for (const profile of Object.values(TRAITS)) {
      for (const id of profile.salvageSites) expect(id in SHOPS, `${id} is a shop`).toBe(false);
    }
  });

  it('stops at the town gate nearest to it, even from the far side of the wall', () => {
    const { w, npc } = createScavenger();
    const town = REGION.towns[0];
    const gate = siteGates(town)[0];
    npc.pos = { x: town.pos.x - (gate.x - town.pos.x) * 1.3, y: town.pos.y - (gate.y - town.pos.y) * 1.3 };
    const stop = getActivityDestination(w, npc, { kind: 'sell', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'test activity' })!;
    expect(canUseSite(stop, town)).toBe(true);
    expect(Math.hypot(stop.x - town.pos.x, stop.y - town.pos.y)).toBeGreaterThan(town.radius);
  });

  it('gives drivers bound for one town their own usable spots on its pad', () => {
    const { w, npc } = createScavenger();
    const town = REGION.towns[0];
    const gate = siteGates(town)[0];
    npc.pos = { x: gate.x + (gate.x - town.pos.x), y: gate.y + (gate.y - town.pos.y) };
    const stops = ['v101', 'v102', 'v103', 'v104'].map((id) =>
      getActivityDestination(w, { ...npc, id }, { kind: 'sell', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'test activity' })!,
    );
    for (const stop of stops) expect(canUseSite(stop, town)).toBe(true);
    const gaps = stops.flatMap((a, i) => stops.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
    expect(Math.min(...gaps)).toBeGreaterThan(0);
    expect(Math.max(...gaps)).toBeGreaterThan(REGION.sites.pad.width / 4);
  });

  it('gives drivers bound for a location their own usable spots on its pad', () => {
    const { w, npc } = createScavenger();
    const site = REGION.locations.find((l) => l.kind === 'oasis')!;
    const stops = ['v101', 'v102', 'v103', 'v104'].map((id) =>
      getActivityDestination(w, { ...npc, id }, { kind: 'resupply', targetId: site.id, destination: { ...site.pos }, phase: 'travel', reason: 'test activity' })!,
    );
    for (const stop of stops) expect(canUseSite(stop, site)).toBe(true);
    expect(new Set(stops.map((p) => `${p.x},${p.y}`)).size).toBe(stops.length);
  });

  it.each(['sell', 'resupply'] as const)('records completion of %s once', (kind) => {
    const { w, npc } = createScavenger();
    npc.pos = { ...sitePads(REGION.towns[0])[0] };
    npc.brain!.goals = [{ kind, targetId: REGION.towns[0].id, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
    w.events = [];
    resolveNpcActivities(w);
    resolveNpcActivities(w);
    expect(w.events.filter((event) => event.t === 'activity')).toEqual([
      expect.objectContaining({ previous: kind, activity: null }),
    ]);
  });

  it.each(['sell', 'resupply'] as const)('remembers the prices of the town where it finished %s', (kind) => {
    const { w, npc } = createScavenger();
    const town = REGION.towns[1].id;
    npc.pos = { ...sitePads(REGION.towns[1])[0] };
    npc.brain!.goals = [{ kind, targetId: town, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
    resolveNpcActivities(w);
    expect(recall(npc, 'prices')).toEqual([{ turn: w.turn, fact: { kind: 'prices', shop: town, pressure: w.shops[town].pressure } }]);
  });

  it('remembers the prices of a stall where it resupplied', () => {
    const { w, npc } = createScavenger();
    const granary = REGION.locations.find((l) => l.id === 'granary')!;
    npc.pos = { ...sitePads(granary)[0] };
    npc.brain!.goals = [{ kind: 'resupply', targetId: granary.id, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
    resolveNpcActivities(w);
    expect(recall(npc, 'prices').map((m) => m.fact.shop)).toEqual(['granary']);
  });

  it('replaces its memory of a town on a second visit', () => {
    const { w, npc } = createScavenger();
    const town = REGION.towns[1].id;
    const visit = () => {
      npc.pos = { ...sitePads(REGION.towns[1])[0] };
      npc.brain!.goals = [{ kind: 'resupply', targetId: town, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
      resolveNpcActivities(w);
    };
    visit();
    const first = recall(npc, 'prices')[0].fact.pressure;
    w.turn += 5;
    const good = Object.keys(w.shops[town].pressure)[0];
    w.shops[town].pressure[good] = 0.3;
    visit();
    expect(recall(npc, 'prices')).toEqual([{ turn: w.turn, fact: { kind: 'prices', shop: town, pressure: expect.objectContaining({ [good]: 0.3 }) } }]);
    expect(first[good]).not.toBe(0.3);
  });

  it('leaves the goal of a knocked-out NPC with a working cab untouched', () => {
    const { w, npc } = createScavenger();
    npc.pos = { ...sitePads(REGION.towns[0])[0] };
    npc.brain!.goals = [{ kind: 'sell', targetId: REGION.towns[0].id, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
    npc.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };
    resolveNpcActivities(w);
    expect(npc.brain!.goals).toHaveLength(1);
  });

  it('remembers no prices at a site without a shop', () => {
    const { w, npc } = createScavenger();
    const oasis = REGION.locations.find((l) => l.kind === 'oasis')!;
    npc.pos = { ...sitePads(oasis)[0] };
    npc.brain!.goals = [{ kind: 'resupply', targetId: oasis.id, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
    w.events = [];
    resolveNpcActivities(w);
    expect(w.events).toContainEqual(expect.objectContaining({ previous: 'resupply', activity: null }));
    expect(npc.brain!.memories).toEqual([]);
  });

  it('records failure when a salvage target disappears', () => {
    const { w, npc } = createScavenger();
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'retired-wreck', destination: { ...npc.pos }, phase: 'travel', reason: 'collect visible salvage' }];
    w.events = [];
    resolveNpcActivities(w);
    expect(w.events).toEqual([expect.objectContaining({ previous: 'scavenge', activity: null, reason: 'salvage no longer available' })]);
  });

  it('drops a scavenge goal when nothing left in the stock fits its cargo', () => {
    const { w, npc } = createScavenger();
    addGoods(w, npc, 'scrap', freeCells(npc) - 1);
    w.salvage = [{ id: 'wreck-test', pos: { x: 10.5, y: 10 }, radius: 0.6, goods: {}, parts: [makePart(w, 'plates', 0)], hidden: emptyHidden() }];
    npc.speed = 0;
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'wreck-test', destination: { ...npc.pos }, phase: 'travel', reason: 'collect visible salvage' }];
    w.events = [];
    resolveNpcActivities(w);
    expect(npc.job).toBeNull();
    expect(w.events).toEqual([expect.objectContaining({ previous: 'scavenge', activity: null, reason: 'cargo cannot hold the loot' })]);
  });

  it('does not see a reachable stock as salvage when nothing in it fits', () => {
    const { w, npc } = createScavenger();
    addGoods(w, npc, 'scrap', freeCells(npc) - 1);
    w.salvage = [{ id: 'wreck-test', pos: { x: 10.5, y: 10 }, radius: 0.6, goods: {}, parts: [makePart(w, 'plates', 0)], hidden: emptyHidden() }];
    npc.speed = 0;
    expect(visibleSalvage(w, npc)).toEqual([]);
    w.salvage[0].goods.scrap = 1;
    expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck-test']);
  });

  describe('stripped stocks', () => {
    const wreck = (id: string, x: number, full = false): SalvageStock => ({ id, pos: { x, y: 10 }, radius: 0.6, goods: full ? { scrap: 1 } : {}, parts: [], hidden: { goods: {}, parts: [], fuel: 0, supplies: 0 } });
    const scavengeAt = (npc: Vehicle, id: string) => {
      npc.brain!.goals = [{ kind: 'scavenge', targetId: id, destination: { ...npc.pos }, phase: 'travel', reason: 'collect visible salvage' }];
    };

    it('remembers two empty wrecks it reached and then sees no salvage in either', () => {
      const { w, npc } = createScavenger();
      w.salvage = [wreck('wreck-a', 10.5), wreck('wreck-b', 16.5)];
      npc.speed = 0;
      scavengeAt(npc, 'wreck-a');
      w.events = [];
      resolveNpcActivities(w);
      expect(w.events).toEqual([expect.objectContaining({ previous: 'scavenge', activity: null, reason: 'salvage exhausted' })]);
      expect(recall(npc, 'stripped')).toEqual([{ turn: w.turn, fact: { kind: 'stripped', stock: 'wreck-a' } }]);
      expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck-b']);
      npc.pos = { x: 16, y: 10 };
      scavengeAt(npc, 'wreck-b');
      resolveNpcActivities(w);
      expect(recall(npc, 'stripped').map((m) => m.fact.stock).sort()).toEqual(['wreck-a', 'wreck-b']);
      expect(visibleSalvage(w, npc)).toEqual([]);
      npc.pos = { x: 10, y: 10 };
      expect(visibleSalvage(w, npc)).toEqual([]);
    });

    it('still lists a full wreck and an empty one it never reached', () => {
      const { w, npc } = createScavenger();
      w.salvage = [wreck('wreck-a', 10.5), wreck('wreck-full', 14.5, true), wreck('wreck-far', 22.5)];
      npc.speed = 0;
      scavengeAt(npc, 'wreck-a');
      resolveNpcActivities(w);
      expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck-full', 'wreck-far']);
    });

    it('remembers a stock whose loot goal ends because it is empty', () => {
      const { w, npc } = createScavenger();
      w.salvage = [wreck('wreck-a', 10.5)];
      npc.speed = 0;
      npc.brain!.goals = [{ kind: 'loot', targetId: 'wreck-a', destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
      w.events = [];
      resolveNpcActivities(w);
      expect(w.events).toEqual([expect.objectContaining({ previous: 'loot', activity: null, reason: STRIPPED })]);
      expect(recall(npc, 'stripped').map((m) => m.fact.stock)).toEqual(['wreck-a']);
    });

    it('lists the stock again once the memory fades', () => {
      const { w, npc } = createScavenger();
      w.salvage = [wreck('wreck-a', 10.5)];
      npc.speed = 0;
      scavengeAt(npc, 'wreck-a');
      resolveNpcActivities(w);
      npc.pos = { x: 30, y: 10 };
      expect(visibleSalvage(w, npc)).toEqual([]);
      w.turn += MEMORY.turns.stripped;
      forgetOld(w);
      expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck-a']);
    });

    it('refuses to note a stock that still holds salvage', () => {
      const { w, npc } = createScavenger();
      w.salvage = [wreck('wreck-full', 10.5, true)];
      expect(() => noteStripped(w, npc, 'wreck-full')).toThrow();
      expect(() => noteStripped(w, npc, null)).toThrow();
    });
  });

  it('drops a scavenge goal on a cargo pile once the pile is gone, before it drives', () => {
    const { w, npc } = createScavenger();
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'cargo-v9-1', destination: { x: npc.pos.x + 8, y: npc.pos.y }, phase: 'travel', reason: 'collect visible salvage' }];
    expect(() => planNpcOrders(w)).not.toThrow();
    expect(npc.brain!.goals.some((goal) => goal.targetId === 'cargo-v9-1')).toBe(false);
  });

  it('completes a collect-sell-upkeep loop through actual turns', () => {
    let { w, npc } = createScavenger();
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    npc.pos = { x: convoy.pos.x + convoy.radius + 1, y: convoy.pos.y };
    npc.heading = Math.PI;
    for (const key of Object.keys(w.spawnTimer)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    for (const key of Object.keys(NPCS)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const id = npc.id;
    const initialMoney = npc.resources!.money;
    let collected = false;
    let sold = false;
    let serviced = false;
    for (let turn = 0; turn < 800; turn++) {
      w = endTurn(w, testDrive);
      npc = w.vehicles.find((v) => v.id === id)!;
      if ((goodsCount(npc).scrap ?? 0) > 0) collected = true;
      if (collected && npc.resources!.money > initialMoney && !sold) {
        sold = true;
        npc.resources!.fuel = 0;
      } else if (sold && npc.resources!.fuel > 0) { serviced = true; break; }
    }
    expect(collected).toBe(true);
    expect(sold).toBe(true);
    expect(serviced).toBe(true);
  });

  it('cannot inspect distant salvage contents', () => {
    const { w, npc } = createScavenger();
    w.salvage = [{ id: 'wreck-test', pos: { x: 17, y: 10 }, radius: 0.6, goods: { scrap: 0 }, parts: [], hidden: emptyHidden() }];
    const full = cloneWorld(w);
    full.salvage[0].goods.scrap = 5;
    expect(thinkNpc(full, full.vehicles.find((v) => v.id === npc.id)!)).toEqual(thinkNpc(w, npc));
  });

  it('preserves a trip even when another site becomes closer', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    const activity = topGoal(npc);
    npc.pos = { x: 25, y: 20 };
    expect(thinkNpc(w, npc)).toBe(activity);
  });

  it('keeps upkeep money when buying trade cargo', () => {
    const { w, npc } = createScavenger();
    npc.brain!.templateId = 'trader';
    npc.brain!.traits = ['trader'];
    forceOption('idle', 'trade');
    planNpcOrders(w);
    const source = [...REGION.towns, ...REGION.locations].find((s) => s.id === topGoal(npc)?.targetId)!;
    npc.pos = { ...sitePads(source)[0] };
    resolveNpcActivities(w);
    expect(npc.resources!.money).toBeGreaterThan(0);
    expect(Object.values(goodsCount(npc)).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
    expect(topGoal(npc)?.kind).toBe('sell');
  });

  it('spends at most the trade stake on one load', () => {
    const w = emptyWorld({ x: 50, y: 50 });
    const npc = addVehicle(w, 'traders', 'hauler', ['trailerBox', 'stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.resources!.money = 166700;
    forceOption('idle', 'trade');
    planNpcOrders(w);
    const source = [...REGION.towns, ...REGION.locations].find((s) => s.id === topGoal(npc)?.targetId)!;
    npc.pos = { ...sitePads(source)[0] };
    resolveNpcActivities(w);
    expect(topGoal(npc)?.kind).toBe('sell');
    expect(166700 - npc.resources!.money).toBeLessThanOrEqual(TRAITS.trader.tradeStake);
  });

  it('gives a trade the wallet above the upkeep reserve, capped by the stake', () => {
    const { w, npc } = createTrader();
    const reserve = getUpkeepReserve(npc);
    npc.resources!.money = reserve + 200;
    expect(tradeSpend(w, npc)).toBe(200);
    npc.resources!.money = reserve + TRAITS.trader.tradeStake * 2;
    expect(tradeSpend(w, npc)).toBe(TRAITS.trader.tradeStake);
  });

  describe('a trade run pays its trip fuel', () => {
    function hauler(money: number) {
      const w = emptyWorld({ x: 50, y: 50 });
      const npc = addVehicle(w, 'traders', 'hauler', ['trailerBox', 'stockEngine'], { x: 10, y: 10 });
      npc.brain = npcBrain('trader', npc.pos, ['trader']);
      npc.resources!.money = getUpkeepReserve(npc) + money;
      return { w, npc };
    }

    function pairs(w: World, npc: Vehicle) {
      const spend = tradeSpend(w, npc);
      const shops = Object.values(SHOPS);
      return shops.flatMap((source) => shops.filter((b) => b.id !== source.id).flatMap((buyer) =>
        source.goods.filter((good) => buyer.goods.includes(good)).flatMap((good) => {
          const buy = getTradePrice(w, npc, source.id, good, 'buy');
          const profit = getTradePrice(w, npc, buyer.id, good, 'sell') - buy;
          if (spend < buy || profit <= 0) return [];
          const sourcePos = getKnownSite(source.id).pos;
          const trip = dist(npc.pos, sourcePos) + dist(sourcePos, getKnownSite(buyer.id).pos);
          const loadProfit = affordableBuyCount(w, npc, source.id, good, cargoRoom(npc, good), spend) * profit;
          return [{ source: source.id, good, sellShop: buyer.id, trip, loadProfit, fuel: tripFuelCost(w, npc, trip) }];
        })));
    }

    it('drops a run whose load profit does not cover the trip fuel', () => {
      const { w, npc } = hauler(1700);
      const losing = pairs(w, npc).filter((p) => p.loadProfit <= p.fuel);
      expect(losing.length).toBeGreaterThan(0);
      const offers = tradeOffers(w, npc).map((o) => `${o.value.source}:${o.value.good}:${o.value.sellShop}`);
      for (const p of losing) expect(offers).not.toContain(`${p.source}:${p.good}:${p.sellShop}`);
    });

    it('weighs a paying run by its net profit per tile', () => {
      const { w, npc } = hauler(TRAITS.trader.tradeStake);
      const paying = pairs(w, npc).filter((p) => p.loadProfit > p.fuel);
      expect(paying.length).toBeGreaterThan(0);
      const offers = tradeOffers(w, npc);
      expect(offers).toHaveLength(paying.length);
      for (const p of paying) {
        const offer = offers.find((o) => o.value.source === p.source && o.value.good === p.good && o.value.sellShop === p.sellShop)!;
        expect(offer.weight).toBeCloseTo((p.loadProfit - p.fuel) / p.trip, 9);
      }
    });

    it('costs the trip tiles times the fuel per tile at the fuel price, and fails loud on a bad trip', () => {
      const { w, npc } = hauler(0);
      expect(tripFuelCost(w, npc, 100)).toBeCloseTo(100 * vehicleStats(w, npc).fuelPerTile * ECONOMY.supplyPrice.fuel, 9);
      expect(() => tripFuelCost(w, npc, NaN)).toThrow(/trip/);
      expect(() => tripFuelCost(w, npc, -1)).toThrow(/trip/);
    });

    it('sends a driver with no paying run to other idle work without a stall', () => {
      const { w, npc } = hauler(1700);
      expect(tradeOffers(w, npc)).toHaveLength(0);
      expect(optionChances(optionWeights(w, npc, 'idle', null, null)).trade).toBeUndefined();
      let world = w;
      const stalls: string[] = [];
      for (let i = 0; i < 50; i++) {
        world = endTurn(world, testDrive);
        stalls.push(...world.events.filter((e) => e.t === 'stall').map((e) => (e.t === 'stall' ? e.reason : '')));
      }
      expect(stalls).toEqual([]);
      expect(topGoal(world.vehicles.find((v) => v.id === npc.id)!)).not.toBeNull();
    });
  });

  it('fails loud when a driver with no trade stake weighs a trade', () => {
    const { w, npc } = createScavenger();
    const stake = TRAITS.scavenger.tradeStake;
    TRAITS.scavenger.tradeStake = 0;
    try {
      expect(() => tradeSpend(w, npc)).toThrow(/trade stake/);
    } finally {
      TRAITS.scavenger.tradeStake = stake;
    }
  });

  it('a raider can knock out an NPC, strip its cargo and sell it', () => {
    const w0 = emptyWorld({ x: 450, y: 60 });
    const raider = addVehicle(w0, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 14, y: 12 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    forceOption('idle', 'scavenge');
    forceOption('surrenderOffered', 'refuse');
    forceOption('mugging', 'attack');
    const victim = addVehicle(w0, 'scavengers', 'scout', [], { x: 16, y: 12 });
    victim.brain = npcBrain('scavenger', victim.pos, ['scavenger']);
    corePart(victim, 'cab').hp = 1;
    addGoods(w0, victim, 'scrap', 3);
    for (const key of Object.keys(NPCS)) w0.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    let money = raider.resources!.money;
    let w = w0;
    let looted = false;
    let sold = false;
    let knockedOut = false;
    const deathChance = RULES.npcDeathChance;
    (RULES as { npcDeathChance: number }).npcDeathChance = 0;
    try {
      for (let turn = 0; turn < w.size * 5; turn++) {
        w = endTurn(w, testDrive);
        if (w.vehicles.find((v) => v.id === victim.id)?.defeat) knockedOut = true;
        const actor = w.vehicles.find((v) => v.id === raider.id)!;
        const scrap = goodsCount(actor).scrap ?? 0;
        if (scrap > 0) looted = true;
        if (looted && scrap === 0 && actor.resources!.money > money) { sold = true; break; }
        money = actor.resources!.money;
      }
    } finally {
      (RULES as { npcDeathChance: number }).npcDeathChance = deathChance;
    }
    expect(knockedOut).toBe(true);
    expect(looted).toBe(true);
    expect(sold).toBe(true);
  });

  it('selects a known salvage site without needing to see it', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('scavenge');
    const target = topGoal(npc)?.targetId;
    const spotOf = w.salvage.find((stock) => stock.id === target && territoryOfStock(stock));
    expect(spotOf ? 'fallen-sun' : target).toSatisfy((id: string) => TRAITS.scavenger.salvageSites.includes(id));
  });

  describe('in a territory', () => {
    function territoryScavenger(territoryId: string, at: { x: number; y: number }) {
      const { w, npc } = createScavenger();
      npc.pos = { ...at };
      npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
      const traits = TRAITS.scavenger as { salvageSites: string[] };
      const saved = traits.salvageSites;
      traits.salvageSites = [territoryId];
      return { w, npc, restore: () => void (traits.salvageSites = saved) };
    }
    const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    const entry = () => territoryEntries(sun as never)[0];

    it('targets one of its loot spots, and keeps the goal while the spot is out of sight', () => {
      const { w, npc, restore } = territoryScavenger('fallen-sun', { x: 10, y: 10 });
      try {
        planNpcOrders(w);
        const goal = topGoal(npc)!;
        expect(goal.kind).toBe('scavenge');
        const spot = territorySpots(w, 'fallen-sun').find((s) => s.id === goal.targetId)!;
        expect(spot).toBeDefined();
        expect(goal.destination).toEqual(spot.pos);
        planNpcOrders(w);
        expect(topGoal(npc)).toBe(goal);
      } finally {
        restore();
      }
    });

    it('targets a Glass Flats spot and takes its loot on arrival', () => {
      const { w, npc, restore } = territoryScavenger('glass-flats', { x: 10, y: 10 });
      try {
        planNpcOrders(w);
        const goal = topGoal(npc)!;
        expect(goal.kind).toBe('scavenge');
        const spot = territorySpots(w, 'glass-flats').find((s) => s.id === goal.targetId)!;
        expect(spot).toBeDefined();
        npc.pos = { x: spot.pos.x + spot.radius + 4, y: spot.pos.y };
        let next = w;
        let took = false;
        for (let turn = 0; turn < 80 && !took; turn++) {
          next = endTurn(next, testDrive);
          took = (goodsCount(next.vehicles.find((v) => v.id === npc.id)!).scrap ?? 0) > 0;
        }
        expect(took).toBe(true);
      } finally {
        restore();
      }
    });

    it('parks beside the spot, searches it and takes its loot', () => {
      const { w, npc, restore } = territoryScavenger('fallen-sun', { x: 10, y: 10 });
      try {
        planNpcOrders(w);
        const spot = territorySpots(w, 'fallen-sun').find((s) => s.id === topGoal(npc)!.targetId)!;
        npc.pos = { x: spot.pos.x + spot.radius + 4, y: spot.pos.y };
        let next = w;
        let took = false;
        for (let turn = 0; turn < 80 && !took; turn++) {
          next = endTurn(next, testDrive);
          const me = next.vehicles.find((v) => v.id === npc.id)!;
          took = (goodsCount(me).scrap ?? 0) > 0;
        }
        expect(took).toBe(true);
      } finally {
        restore();
      }
    });

    it('drives into the cage by its open end to a cache inside, searches it and takes its loot', () => {
      const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
      const cage = territoryPieces(sun as never).find((p) => p.look === 'shipCage')!;
      const along = { x: Math.cos(cage.yaw), y: Math.sin(cage.yaw) };
      const back = { x: cage.pos.x - along.x * (cage.r + 3), y: cage.pos.y - along.y * (cage.r + 3) };
      const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], back);
      npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
      const alongOf = (p: Vec) => (p.x - cage.pos.x) * along.x + (p.y - cage.pos.y) * along.y;
      const offAxis = (p: Vec) => Math.abs((p.x - cage.pos.x) * along.y - (p.y - cage.pos.y) * along.x);
      const cache = w.salvage.find((s) => s.id.startsWith('hullCache-') && dist(s.pos, cage.pos) < cage.r && alongOf(s.pos) > 0)!;
      expect(cache).toBeDefined();
      npc.brain.goals = [{ kind: 'scavenge', targetId: cache.id, destination: { ...cache.pos }, phase: 'travel', reason: 'search a loot spot' }];
      const moveFar = (next: World) => next.vehicles.forEach((v) => v.brain && advanceFar(next, v));
      forceOption('salvageSeen', 'keep');
      overlookSalvage(w, npc);
      const scrapIn = (world: World) => {
        const stock = world.salvage.find((s) => s.id === cache.id)!;
        return (stock.goods.scrap ?? 0) + (stock.hidden.goods.scrap ?? 0);
      };
      const before = scrapIn(w);

      let next = w;
      const path: Vec[] = [{ ...npc.pos }];
      let took: Vehicle | null = null;
      for (let turn = 0; turn < 40 && !took; turn++) {
        next = endTurn(next, moveFar);
        const me = next.vehicles.find((v) => v.id === npc.id)!;
        path.push(...me.trail.map((p) => ({ x: p.x, y: p.y })));
        if ((goodsCount(me).scrap ?? 0) > 0) took = me;
      }

      expect(took).not.toBeNull();
      expect(scrapIn(next)).toBeLessThan(before);
      const inTube = path.filter((p) => alongOf(p) > -cage.r * 0.8 && alongOf(p) < 0);
      expect(inTube.length).toBeGreaterThan(0);
      for (const p of inTube) expect(offAxis(p)).toBeLessThan(3.5);
      expect(offAxis(took!.pos)).toBeLessThan(3.5);
    });

    it('drives from the west road down into the crash furrow to a spot there, searches it and takes its loot', () => {
      const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
      const furrow = TERRAIN.features.furrow;
      const start = territoryEntries(sun as never)[0];
      const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], start);
      npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
      const inFurrow = territorySpots(w, 'fallen-sun').filter((s) => polylineDist(s.pos, furrow.path) < furrow.width);
      expect(inFurrow.length).toBeGreaterThan(0);
      const spot = inFurrow.reduce((a, b) => (dist(b.pos, start) > dist(a.pos, start) ? b : a));
      npc.brain.goals = [{ kind: 'scavenge', targetId: spot.id, destination: { ...spot.pos }, phase: 'travel', reason: 'search a loot spot' }];
      const moveFar = (next: World) => next.vehicles.forEach((v) => v.brain && advanceFar(next, v));
      forceOption('salvageSeen', 'keep');
      overlookSalvage(w, npc);
      const scrapIn = (world: World) => {
        const stock = world.salvage.find((s) => s.id === spot.id)!;
        return (stock.goods.scrap ?? 0) + (stock.hidden.goods.scrap ?? 0);
      };
      const before = scrapIn(w);

      let next = w;
      let took = false;
      for (let turn = 0; turn < 40 && !took; turn++) {
        next = endTurn(next, moveFar);
        took = (goodsCount(next.vehicles.find((v) => v.id === npc.id)!).scrap ?? 0) > 0;
      }

      expect(took).toBe(true);
      expect(scrapIn(next)).toBeLessThan(before);
      expect(next.events.filter((e) => e.t === 'stall')).toEqual([]);
    }, 60_000);

    it('ends a trip to a territory at its road end, not at its centre', () => {
      const { w, npc } = createScavenger();
      const goal: NpcActivity = { kind: 'travel', targetId: sun.id, destination: { ...entry() }, phase: 'travel', reason: 'make a trip to another site' };
      expect(getActivityDestination(w, npc, goal)).toEqual(entry());
    });

    describe('Old Orchard', () => {
      it('targets one of its loot spots', () => {
        const { w, npc, restore } = territoryScavenger('orchard', { x: 10, y: 10 });
        try {
          planNpcOrders(w);
          const goal = topGoal(npc)!;
          expect(goal.kind).toBe('scavenge');
          const spot = territorySpots(w, 'orchard').find((s) => s.id === goal.targetId);
          expect(spot).toBeDefined();
          expect(goal.destination).toEqual(spot!.pos);
        } finally {
          restore();
        }
      });

      it('keeps its goal on the spot until it searches it from the parking ring, then takes its loot', () => {
        const { w, npc, restore } = territoryScavenger('orchard', { x: 10, y: 10 });
        try {
          planNpcOrders(w);
          const spotId = topGoal(npc)!.targetId!;
          const spot = territorySpots(w, 'orchard').find((s) => s.id === spotId)!;
          npc.pos = { x: spot.pos.x + spot.radius + 4, y: spot.pos.y };
          forceOption('salvageSeen', 'keep');
          overlookSalvage(w, npc);
          const unitsBefore = salvageUnits(spot) + hiddenUnits(spot);
          const carriedBefore = npc.items.length;
          let next = w;
          let searching = false;
          let took = false;
          for (let turn = 0; turn < 80 && !took; turn++) {
            next = endTurn(next, testDrive);
            const me = next.vehicles.find((v) => v.id === npc.id)!;
            searching ||= me.job?.kind === 'search' && me.job.stockId === spotId;
            took = me.items.length > carriedBefore;
            if (!searching && !took) expect(topGoal(me)?.targetId, `turn ${turn}`).toBe(spotId);
          }
          expect(searching).toBe(true);
          expect(took).toBe(true);
          const after = next.salvage.find((s) => s.id === spotId);
          expect(after ? salvageUnits(after) + hiddenUnits(after) : 0).toBeLessThan(unitsBefore);
        } finally {
          restore();
        }
      });
    });
  });

  it('interrupts work for low fuel', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    getResources(w, npc).fuel = 0;
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('resupply');
  });

  it('sends a driver with no engine to a town for service, since only a town gives it a fresh loadout', () => {
    const { w, npc } = createTrader();
    const stall = Object.values(SHOPS).find((s) => s.kind === 'stall');
    const site = REGION.locations.find((l) => l.id === stall?.id);
    if (!site) throw new Error('The map has no service stall');
    npc.items = npc.items.filter((it) => !(it.kind === 'part' && partDef(it.part.defId).kind === 'engine'));
    npc.pos = { ...site.pos };

    planNpcOrders(w);

    expect(REGION.towns.map((t) => t.id)).toContain(topGoal(npc)?.targetId);
  });

  it('heads for fuel once the tank holds less than its reserve for the straight way to a pump', () => {
    const tank = (fuel: number) => {
      const { w, npc } = createTrader();
      planNpcOrders(w);
      getResources(w, npc).fuel = fuel;
      planNpcOrders(w);
      return topGoal(npc)?.kind;
    };
    withFuelSense(0, () => {
      const need = reserveOfTrader();
      expect(tank(need * 1.05)).not.toBe('resupply');
      expect(tank(need * 0.95)).toBe('resupply');
    });
  });

  it('heads for a town, not the stall it is parked at, once stranded for good with no engine', () => {
    const yard = REGION.locations.find((l) => l.id === 'salvage-yard')!;
    expect(SHOPS['salvage-yard'].kind).toBe('stall');
    const w = emptyWorld({ x: yard.pos.x + 100, y: yard.pos.y + 100 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg'], { ...sitePads(yard)[0] });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    getResources(w, npc).money = 500;
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('resupply');
    expect(REGION.towns.map((t) => t.id)).toContain(topGoal(npc)?.targetId);
  });

  it('drives on near a town with a tank well below a fifth', () => {
    const { w, npc } = createTrader();
    const pad = sitePads(REGION.towns[0])[0];
    npc.pos = { x: pad.x, y: pad.y + 30 };
    planNpcOrders(w);
    getResources(w, npc).fuel = 0.1 * fuelCap(npc);
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).not.toBe('resupply');
  });

  describe('fuel at a business stop', () => {
    const at = (npc: Vehicle, siteId: string) => {
      const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === siteId)!;
      npc.pos = { ...sitePads(site)[0] };
      npc.speed = 0;
    };
    const goal = (kind: NpcActivity['kind'], siteId: string, over: Partial<NpcActivity> = {}): NpcActivity =>
      ({ kind, targetId: siteId, destination: { x: 0, y: 0 }, phase: 'travel', reason: 'test activity', ...over });
    const tankAt = (w: World, npc: Vehicle, share: number, money: number) => {
      getResources(w, npc).fuel = Math.floor(share * fuelCap(npc));
      getResources(w, npc).money = money;
    };

    it('a trader that sells cargo at a town leaves with a full tank and pays the fuel price', () => {
      const { w, npc } = createTrader();
      at(npc, 'bowl');
      addGoods(w, npc, 'salt', 2);
      tankAt(w, npc, 0.1, 16700);
      npc.brain!.goals = [goal('sell', 'bowl')];
      const fuel = getResources(w, npc).fuel;
      const salt = getLotTradePrice(w, npc, 'bowl', 'salt', 2, 'sell');
      resolveNpcActivities(w);
      expect(goodsCount(npc).salt ?? 0).toBe(0);
      expect(getResources(w, npc).fuel).toBe(Math.floor(fuelCap(npc)));
      expect(getResources(w, npc).money).toBe(16700 + salt - (getResources(w, npc).fuel - fuel) * ECONOMY.supplyPrice.fuel);
    });

    it('a trader that buys trade cargo at a town buys the planned cargo first, then fills the tank from the rest', () => {
      const { w, npc } = createTrader();
      at(npc, 'bowl');
      const unit = getTradePrice(w, npc, 'bowl', 'grain', 'buy');
      tankAt(w, npc, 0.1, getUpkeepReserve(npc) + unit);
      npc.brain!.goals = [goal('trade', 'bowl', { purchase: { good: 'grain', sellShop: 'nose' } })];
      resolveNpcActivities(w);
      expect(goodsCount(npc).grain ?? 0).toBeGreaterThan(0);
      expect(getResources(w, npc).money).toBeGreaterThanOrEqual(0);
    });

    it('a trader with plenty of money buying trade cargo also tops up its tank', () => {
      const { w, npc } = createTrader();
      at(npc, 'bowl');
      tankAt(w, npc, 0.1, getUpkeepReserve(npc) + 166700);
      npc.brain!.goals = [goal('trade', 'bowl', { purchase: { good: 'grain', sellShop: 'nose' } })];
      resolveNpcActivities(w);
      expect(goodsCount(npc).grain ?? 0).toBeGreaterThan(0);
      expect(getResources(w, npc).fuel).toBe(Math.floor(fuelCap(npc)));
    });

    it('a raider selling at the Salvage Yard buys no fuel there, and one selling at its camp tops up', () => {
      const raider = () => {
        const w = emptyWorld({ x: 50, y: 50 });
        const npc = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
        npc.brain = npcBrain('buggy', npc.pos, ['raider']);
        addGoods(w, npc, 'scrap', 2);
        tankAt(w, npc, 0.1, 16700);
        return { w, npc };
      };
      for (const [site, full] of [['salvage-yard', false], ['scrapjaw', true]] as const) {
        const { w, npc } = raider();
        at(npc, site);
        const fuel = getResources(w, npc).fuel;
        npc.brain!.goals = [goal('sell', site)];
        resolveNpcActivities(w);
        expect(goodsCount(npc).scrap ?? 0).toBe(0);
        expect(getResources(w, npc).fuel).toBe(full ? Math.floor(fuelCap(npc)) : fuel);
      }
    });

    it('a driver in debt sells but buys no fuel', () => {
      const { w, npc } = createTrader();
      at(npc, 'bowl');
      addGoods(w, npc, 'salt', 1);
      tankAt(w, npc, 0.1, -10_000);
      const fuel = getResources(w, npc).fuel;
      npc.brain!.goals = [goal('sell', 'bowl')];
      resolveNpcActivities(w);
      expect(goodsCount(npc).salt ?? 0).toBe(0);
      expect(getResources(w, npc).fuel).toBe(fuel);
    });
  });

  it('turns a coward back for fuel with a tank a trader drives on with', () => {
    withFuelSense(0, () => {
      const fuel = reserveOfTrader() * 1.05;
      const { w, npc } = createTrader();
      npc.brain!.traits = ['trader', 'coward'];
      planNpcOrders(w);
      getResources(w, npc).fuel = fuel;
      planNpcOrders(w);
      expect(topGoal(npc)?.kind).toBe('resupply');
    });
  });

  it('lets an idle healthy scavenger fight a nearby raider', () => {
    const { w, npc } = createScavenger();
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 13, y: 10 });
    forceOption('hostileSeen', 'fight');
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('fight');
  });

  it('flees when damaged, and stops tracking a target behind cover', () => {
    const { w, npc } = createScavenger();
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    corePart(npc, 'cab').hp = 1;
    forceOption('hostileSeen', 'flee');
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('flee');
    w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: 12, y: 10 }, r: 1 });
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('flee');
    w.turn += NPC_BEHAVIOR.fleeCalmTurns + 1;
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('resupply');
  });

  it('flees away from an attacker that stands between it and a known town', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const w = emptyWorld({ x: bowl.pos.x + 150, y: bowl.pos.y + 150 });
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 20, y: bowl.pos.y });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: trader.pos.x - 5, y: trader.pos.y });
    forceOption('hostileSeen', 'flee');
    planNpcOrders(w);
    const flee = topGoal(trader)!;
    expect(flee.kind).toBe('flee');
    const away = { x: flee.destination!.x - trader.pos.x, y: flee.destination!.y - trader.pos.y };
    const toThreat = { x: raider.pos.x - trader.pos.x, y: raider.pos.y - trader.pos.y };
    expect(away.x * toThreat.x + away.y * toThreat.y).toBeLessThan(0);
  });

  it('flees to a pad of a safe town, since trucks never enter a site', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const w = emptyWorld({ x: bowl.pos.x + 150, y: bowl.pos.y + 150 });
    const pad = sitePads(bowl)[0];
    const out = { x: pad.x - bowl.pos.x, y: pad.y - bowl.pos.y };
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: pad.x + out.x * 0.3, y: pad.y + out.y * 0.3 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: trader.pos.x + out.x * 0.2, y: trader.pos.y + out.y * 0.2 });
    forceOption('hostileSeen', 'flee');
    planNpcOrders(w);
    const flee = topGoal(trader)!;
    expect(flee.kind).toBe('flee');
    expect(canUseSite(flee.destination!, bowl)).toBe(true);
    expect(trader.order?.kind).toBe('stopAt');
  });

  it('a fleeing driver parked on its flee point stops fleeing', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 30, y: 30 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 });
    raider.speed = 4;
    forceOption('contactHeard', 'flee');
    planNpcOrders(w);
    expect(topGoal(trader)?.kind).toBe('flee');
    resolveNpcActivities(w);
    expect(topGoal(trader)?.kind).toBe('flee');
    trader.pos = { ...topGoal(trader)!.destination! };
    resolveNpcActivities(w);
    expect(topGoal(trader)?.kind).not.toBe('flee');
    planNpcOrders(w);
    expect(topGoal(trader)?.kind).not.toBe('flee');
  });

  it('a raider investigates a nearby heard player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 4;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('investigate');
    expect(topGoal(raider)?.targetId).toBe(player.id);
  });

  describe('an investigation that finds its truck', () => {
    function investigating() {
      const w = emptyWorld({ x: 30, y: 30 });
      const player = w.vehicles[0];
      const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      raider.brain.goals = [
        { kind: 'raid', targetId: null, destination: { x: 100, y: 100 }, phase: 'travel', reason: 'long-term goal' },
        { kind: 'investigate', targetId: player.id, destination: { x: 30, y: 30 }, phase: 'travel', reason: 'heard a hostile beyond sight' },
      ];
      chooseOn(w, raider, player.id, { x: 30, y: 30 }, 'investigate', false);
      return { w, player, raider };
    }
    const closeIn = (w: World, player: Vehicle, raider: Vehicle) => { player.pos = { x: raider.pos.x - 4, y: raider.pos.y }; };

    it('rolls on the sighting of a truck it only heard, however long ago', () => {
      const { w, player, raider } = investigating();
      w.turn += NPC_BEHAVIOR.noticeMemory + 2;
      closeIn(w, player, raider);
      forceOption('hostileSeen', 'fight');
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: player.id });
      expect(raider.brain!.goals.some((g) => g.kind === 'investigate')).toBe(false);
    });

    it('goes back to its own work on keep', () => {
      const { w, player, raider } = investigating();
      closeIn(w, player, raider);
      forceOption('hostileSeen', 'keep');
      thinkNpc(w, raider);
      expect(raider.brain!.goals.some((g) => g.kind === 'investigate')).toBe(false);
      expect(topGoal(raider)?.kind).toBe('raid');
      expect(trackOf(raider, player.id)).toMatchObject({ choice: 'keep', chosenInSight: true });
    });

    it('flees on a flee roll', () => {
      const { w, player, raider } = investigating();
      closeIn(w, player, raider);
      forceOption('hostileSeen', 'flee');
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'flee', targetId: player.id });
    });

    it('keeps investigating behind cover', () => {
      const { w, player, raider } = investigating();
      closeIn(w, player, raider);
      w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: raider.pos.x - 2, y: raider.pos.y }, r: 1.5 });
      forceOption('hostileSeen', 'fight');
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'investigate', destination: { x: 30, y: 30 } });
      expect(trackOf(raider, player.id)).toMatchObject({ choice: 'investigate', chosenInSight: false });
    });

    it('ends the same way on an NPC target', () => {
      const { w, raider } = investigating();
      const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: raider.pos.x - 4, y: raider.pos.y });
      trader.brain = npcBrain('trader', trader.pos, ['trader']);
      w.states.push({ id: 'feud-test', kind: 'feud', holder: raider.id, other: trader.id, turnsLeft: 10, born: w.turn, data: { kind: 'feud', robbery: false } });
      raider.brain!.goals[1].targetId = trader.id;
      forceOption('hostileSeen', 'fight');
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: trader.id });
    });

    it('gains no knowledge of a truck it only hears', () => {
      const { w, player, raider } = investigating();
      player.speed = 4;
      forceOption('contactHeard', 'keep');
      for (let i = 0; i < 5; i++) {
        player.pos = { x: raider.pos.x - TERRAIN.vision.radius - 4, y: raider.pos.y + i };
        thinkNpc(w, raider);
        expect(topGoal(raider)).toMatchObject({ kind: 'investigate', destination: { x: 30, y: 30 } });
        w.turn += 1;
      }
      expect(trackOf(raider, player.id)).toMatchObject({ sighted: false, choice: 'investigate', chosenInSight: false });
    });
  });

  describe('a truck the driver ran from', () => {
    function ranFrom() {
      const w = emptyWorld({ x: 30, y: 30 });
      const player = w.vehicles[0];
      const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      raider.brain.goals = [{ kind: 'raid', targetId: null, destination: { x: 100, y: 100 }, phase: 'travel', reason: 'long-term goal' }];
      chooseOn(w, raider, player.id, player.pos, 'flee', true);
      w.turn += NPC_BEHAVIOR.fleeCalmTurns + 2;
      thinkNpc(w, raider);
      w.turn += 1;
      return { w, player, raider };
    }

    it('is not looked for when heard again', () => {
      const { w, player, raider } = ranFrom();
      player.speed = 4;
      forceOption('contactHeard', 'investigate');
      thinkNpc(w, raider);
      expect(topGoal(raider)?.kind).toBe('raid');
      expect(trackOf(raider, player.id)).toMatchObject({ choice: 'flee', turn: w.turn });
    });

    it('is run from again on sight, with no roll', () => {
      const { w, player, raider } = ranFrom();
      player.pos = { x: raider.pos.x - 4, y: raider.pos.y };
      forceOption('hostileSeen', 'fight');
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'flee', targetId: player.id, reason: 'avoid a truck it ran from' });
    });

    it('is not run from again while it stays in sight after a run that went as far as it could', () => {
      const { w, player, raider } = ranFrom();
      player.pos = { x: raider.pos.x - 4, y: raider.pos.y };
      thinkNpc(w, raider);
      raider.brain!.goals.pop();
      w.turn += 1;
      thinkNpc(w, raider);
      expect(topGoal(raider)?.kind).toBe('raid');
    });

    it('is not run from when the driver stands where the run would end', () => {
      const { w, player, raider } = ranFrom();
      raider.pos = { x: w.size - 1, y: raider.pos.y };
      const nearby = { x: raider.pos.x - 4, y: raider.pos.y };
      const far = { x: raider.pos.x - 4 * TERRAIN.vision.radius, y: raider.pos.y };
      const fled: unknown[] = [];
      for (let i = 0; i < 6; i++) {
        w.turn += 1;
        player.pos = i % 2 === 0 ? nearby : far;
        w.events = [];
        thinkNpc(w, raider);
        fled.push(...w.events.filter((e) => e.t === 'activity' && e.activity === 'flee'));
        expect(topGoal(raider)?.kind).toBe('raid');
      }
      expect(fled).toEqual([]);
    });

    it('is run from again when the driver arrived somewhere else this turn', () => {
      const { w, player, raider } = ranFrom();
      player.pos = { x: raider.pos.x - 4, y: raider.pos.y };
      w.events = [{ t: 'arrived', vehicle: raider.id } as (typeof w.events)[number]];
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'flee', targetId: player.id });
    });

    it('is judged fresh once forgotten', () => {
      const { w, player, raider } = ranFrom();
      w.turn += NPC_BEHAVIOR.fleeMemory;
      thinkNpc(w, raider);
      expect(trackOf(raider, player.id)).toBeUndefined();
      player.pos = { x: raider.pos.x - 4, y: raider.pos.y };
      forceOption('hostileSeen', 'fight');
      thinkNpc(w, raider);
      expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: player.id });
    });
  });

  it('a raider fighting a hostile in sight ignores a heard contact beyond sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 4;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: raider.pos.x + 5, y: 30 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    forceOption('hostileSeen', 'fight');
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('fight');
    expect(topGoal(raider)?.targetId).toBe(trader.id);
  });

  it('a distant contact remains audible without redirecting a raider', () => {
    const w = emptyWorld({ x: 180, y: 300 });
    const player = w.vehicles[0];
    player.speed = 4;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 220, y: 300 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('contactHeard', 'investigate');
    forceOption('idle', 'raid');
    planNpcOrders(w);
    expect(contactsOf(w, raider, Infinity).some((c) => c.vehicleId === player.id)).toBe(true);
    expect(topGoal(raider)?.kind).toBe('raid');
    expect(topGoal(raider)?.targetId).toBeNull();
  });

  it('a trader turns away from a heard raider', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 30, y: 30 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 });
    raider.speed = 4;
    forceOption('contactHeard', 'flee');
    planNpcOrders(w);
    expect(topGoal(trader)?.kind).toBe('flee');
    expect(topGoal(trader)?.targetId).toBe(raider.id);
  });

  it('a parked player behind a hill goes unnoticed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 0;
    editableTerrain(w);
    const size = w.terrain.size;
    for (let i = 33; i <= 37; i++) for (let j = 28; j <= 32; j++) w.terrain.heights[j * (size + 1) + i] = 3;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).not.toBe('investigate');
    expect(topGoal(raider)?.kind).not.toBe('fight');
    expect(topGoal(raider)?.kind).not.toBe('flee');
  });
});

describe('a defeated driver with a deal goal', () => {
  function defeatedClient() {
    const { w, npc } = createScavenger();
    const other = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 14, y: 10 });
    npc.defeat = { phase: 'retreat', turns: 0, unseen: 0, foes: [], gaveUp: false };
    addState(w, 'patch', other.id, npc.id, { kind: 'patch', deal: 'free', parts: 0, partIds: [], price: 0, work: 3, workLeft: 3 });
    patchGoal(w, npc, other, false);
    return { w, npc };
  }

  it('keeps a patch goal on top instead of retreating', () => {
    const { w, npc } = defeatedClient();
    expect(thinkNpc(w, npc).kind).toBe('patch');
    expect(topGoal(npc)?.kind).toBe('patch');
  });

  it('retreats once the deal is gone', () => {
    const { w, npc } = defeatedClient();
    w.states = [];
    expect(thinkNpc(w, npc).kind).toBe('retreat');
    expect(npc.defeat).toBeTruthy();
  });
});

describe('hunting a lost fight target', () => {
  function raiderLosesPlayer() {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 45, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    planNpcOrders(w);
    expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: player.id });
    player.pos = { x: 20, y: 30 };
    player.speed = 0;
    return { w, player, raider };
  }

  it('keeps the fight and drives to the point where it last saw the target', () => {
    const { w, player, raider } = raiderLosesPlayer();
    w.turn++;
    planNpcOrders(w);
    expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: player.id, destination: { x: 30, y: 30 } });
    expect(raider.order).toEqual({ kind: 'stopAt', dest: { x: 30, y: 30 } });
  });

  it('drops the fight once the driver has no gun left', () => {
    const { w, raider } = raiderLosesPlayer();
    raider.items = raider.items.filter((it) => it.kind !== 'part' || it.part.defId !== 'mg');
    w.turn++;
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).not.toBe('fight');
  });

  it('drops the fight once every mounted gun is broken', () => {
    const { w, raider } = raiderLosesPlayer();
    const gun = vehicleStats(w, raider).weapons[0].part;
    damagePart(gun, gun.hp, 0);
    w.turn++;
    planNpcOrders(w);
    expect(vehicleStats(w, raider).weapons).toHaveLength(1);
    expect(topGoal(raider)?.kind).not.toBe('fight');
  });

  it('runs from a hostile in sight once every mounted gun is broken', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const gun = vehicleStats(w, raider).weapons[0].part;
    damagePart(gun, gun.hp, 0);
    const weights = optionWeights(w, raider, 'hostileSeen', player.id, judgeDanger(w, raider, player));
    expect(weights.fight).toBeUndefined();
    const heaviest = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
    expect(heaviest).toBe('flee');
  });

  it('re-aims at the heard engine of the target and restarts the search', () => {
    const { w, player, raider } = raiderLosesPlayer();
    player.speed = 4;
    w.turn += NPC_BEHAVIOR.fightSearchTurns;
    const contact = contactsOf(w, raider, Infinity).find((c) => c.vehicleId === player.id)!;
    expect(contact.sources).toContain('sound');
    planNpcOrders(w);
    expect(topGoal(raider)).toMatchObject({ kind: 'fight', destination: contact.center });
    expect(trackOf(raider, player.id)).toMatchObject({ at: contact.center, turn: w.turn });
  });

  it('gives up once the search turns pass with no sight or contact', () => {
    const { w, raider } = raiderLosesPlayer();
    for (let i = 0; i < NPC_BEHAVIOR.fightSearchTurns; i++) {
      w.turn++;
      planNpcOrders(w);
      expect(topGoal(raider)?.kind).toBe('fight');
    }
    w.turn++;
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).not.toBe('fight');
  });
});

describe('salvage on the way', () => {
  function passingWreck(traits: TraitId[] = ['scavenger']) {
    const { w, npc } = createScavenger();
    npc.brain = npcBrain('scavenger', npc.pos, traits);
    npc.brain.goals = [{ kind: 'scavenge', targetId: 'podfield', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'search a known salvage site' }];
    w.salvage.push({ id: 'wreck900', pos: { x: 14, y: 10 }, radius: 0.6, goods: { scrap: 2 }, parts: [], hidden: emptyHidden() });
    return { w, npc };
  }

  it('a scavenger mostly stops, and a trader rarely does', () => {
    const scavenger = passingWreck(['scavenger']);
    const trader = passingWreck(['trader']);
    const chanceOf = ({ w, npc }: ReturnType<typeof passingWreck>) => optionChances(optionWeights(w, npc, 'salvageSeen', 'wreck900', null)).loot!;
    expect(chanceOf(scavenger)).toBeCloseTo(0.745);
    expect(chanceOf(trader)).toBeCloseTo(MIN_CHANCE);
  });

  it('pushes a loot goal on the long-term goal and goes back to it after', () => {
    forceOption('salvageSeen', 'loot');
    forceOption('resume', 'resume');
    const { w, npc } = passingWreck();
    thinkNpc(w, npc);
    expect(npc.brain!.goals.map((g) => `${g.kind}:${g.targetId}`)).toEqual(['scavenge:podfield', 'loot:wreck900']);
    w.salvage.find((s) => s.id === 'wreck900')!.goods.scrap = 0;
    npc.pos = { x: 14, y: 10 };
    npc.speed = 0;
    thinkNpc(w, npc);
    expect(topGoal(npc)?.targetId).toBe('podfield');
  });

  it('a driver whose hold could not take a loot passes up wrecks until it sells', () => {
    forceOption('salvageSeen', 'loot');
    const { w, npc } = passingWreck();
    addGoods(w, npc, 'scrap', freeCells(npc) - 1);
    w.salvage.push({ id: 'wreck901', pos: { x: 10.5, y: 10 }, radius: 0.6, goods: {}, parts: [makePart(w, 'longRifle', 0)], hidden: emptyHidden() });
    npc.speed = 0;
    npc.brain!.goals.push({ kind: 'loot', targetId: 'wreck901', destination: { x: 10.5, y: 10 }, phase: 'travel', reason: 'loot salvage on the way' });
    resolveNpcActivities(w);
    expect(npc.brain!.fullAt).toBe(1);
    expect(optionWeights(w, npc, 'salvageSeen', 'wreck900', null)).not.toHaveProperty('loot');
    expect(optionWeights(w, npc, 'idle', null, null)).not.toHaveProperty('scavenge');
    thinkNpc(w, npc);
    expect(npc.brain!.goals.map((g) => g.kind)).not.toContain('loot');
    npc.items = npc.items.filter((it) => it.kind !== 'good');
    thinkNpc(w, npc);
    expect(npc.brain!.fullAt).toBeUndefined();
    expect(optionWeights(w, npc, 'salvageSeen', 'wreck900', null)).toHaveProperty('loot');
  });

  it('a driver that a sale would not make room for passes up only that loot', () => {
    const { w, npc } = passingWreck();
    w.salvage.push({ id: 'wreck901', pos: { x: 10.5, y: 10 }, radius: 0.6, goods: {}, parts: [makePart(w, 'plates', 0)], hidden: emptyHidden() });
    addGoods(w, npc, 'scrap', 2);
    npc.speed = 0;
    expect(canTakeAny(w, npc, w.salvage.find((s) => s.id === 'wreck901')!)).toBe(false);
    npc.brain!.goals.push({ kind: 'loot', targetId: 'wreck901', destination: { x: 10.5, y: 10 }, phase: 'travel', reason: 'loot salvage on the way' });
    finishGoal(w, npc, CANNOT_HOLD);
    expect(npc.brain!.fullAt).toBeUndefined();
    expect(npc.brain!.unfit).toEqual(['wreck901']);
    expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck900']);
    w.salvage = w.salvage.filter((s) => s.id !== 'wreck901');
    thinkNpc(w, npc);
    expect(npc.brain!.unfit).toBeUndefined();
  });

  it('rolls once per sighting', () => {
    forceOption('salvageSeen', 'keep');
    const { w, npc } = passingWreck();
    thinkNpc(w, npc);
    forceOption('salvageSeen', 'loot');
    thinkNpc(w, npc);
    expect(topGoal(npc)?.kind).toBe('scavenge');
  });

  it('ignores salvage while an interruption is on top', () => {
    forceOption('salvageSeen', 'loot');
    const { w, npc } = passingWreck();
    npc.brain!.goals.push({ kind: 'resupply', targetId: 'dustwell', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'test' });
    thinkNpc(w, npc);
    expect(topGoal(npc)?.kind).toBe('resupply');
  });

  it('ignores the stock of a site it passes', () => {
    forceOption('salvageSeen', 'loot');
    const { w, npc } = passingWreck();
    const site = REGION.locations.find((l) => l.id === 'ridge-wrecks')!;
    w.salvage = w.salvage.filter((s) => s.id === site.id);
    npc.pos = { ...sitePads(site)[0] };
    thinkNpc(w, npc);
    expect(topGoal(npc)?.kind).toBe('scavenge');
  });

  it('keeps heading for a looted wreck it cannot inspect yet', () => {
    forceOption('salvageSeen', 'loot');
    const { w, npc } = passingWreck();
    w.salvage.find((s) => s.id === 'wreck900')!.goods.scrap = 0;
    thinkNpc(w, npc);
    thinkNpc(w, npc);
    expect(topGoal(npc)?.kind).toBe('loot');
  });
});

describe('point goals', () => {
  it('an explore goal ends once the move arrives as close as it can to a point another truck covers', () => {
    const w0 = emptyWorld({ x: 10, y: 10 });
    const npc = addVehicle(w0, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 150, y: 150 });
    npc.brain = npcBrain('roamer', npc.pos, ['roamer']);
    npc.brain.goals = [{ kind: 'explore', targetId: null, destination: { x: 170, y: 150 }, phase: 'travel', reason: 'test spot' }];
    addVehicle(w0, 'traders', 'hauler', [], { x: 170, y: 150 });
    const moveFar = (w: World) => w.vehicles.forEach((v) => advanceFar(w, v));
    forceOption('salvageSeen', 'keep');
    let w = w0;
    for (let i = 0; i < 20 && topGoal(w.vehicles.find((v) => v.id === npc.id)!)?.kind === 'explore'; i++) w = endTurn(w, moveFar);
    const after = w.vehicles.find((v) => v.id === npc.id)!;
    expect(topGoal(after)?.kind).not.toBe('explore');
    expect(dist(after.pos, { x: 170, y: 150 })).toBeGreaterThan(RULES.arriveRadius * 2);
  });
});

describe('loot out of reach', () => {
  function besideCache(gap: number) {
    const w = emptyWorld({ x: 10, y: 10 });
    const stock = w.salvage.find((s) => s.id.startsWith('hullCache-'))!;
    const npc = addVehicle(w, 'scavengers', 'van', ['stockEngine'], { x: stock.pos.x, y: stock.pos.y + gap });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.brain.goals = [{ kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'loot salvage on the way' }];
    npc.speed = 0;
    return { w, npc, stock };
  }

  it('gives the salvage up when the move arrives out of search range', () => {
    const { w, npc, stock } = besideCache(4.2);
    expect(salvageInRange(npc, stock)).toBe(false);
    w.events.push({ t: 'arrived', vehicle: npc.id });
    resolveNpcActivities(w);
    expect(topGoal(npc)).toBeNull();
  });

  it('keeps the goal while the move is still under way', () => {
    const { w, npc } = besideCache(4.2);
    resolveNpcActivities(w);
    expect(topGoal(npc)?.kind).toBe('loot');
  });

  it('searches when the move arrives in range', () => {
    const { w, npc } = besideCache(2);
    w.events.push({ t: 'arrived', vehicle: npc.id });
    resolveNpcActivities(w);
    expect(topGoal(npc)).toMatchObject({ kind: 'loot', phase: 'act' });
  });
});

describe('a trader too poor to trade', () => {
  it('hauls free cargo far more often than it waits', () => {
    const { w, npc } = createTrader();
    getResources(w, npc).money = 0;
    const chances = optionChances(optionWeights(w, npc, 'idle', null, null));
    expect(chances.trade).toBeUndefined();
    expect(chances.haul!).toBeGreaterThan(chances.wait! * 5);
  });
});

describe('repair goal in combat', () => {
  it('turns on a visible foe when the driver cannot reach repairs, even after the combat timer expires', () => {
    const { w, npc } = createScavenger();
    const foe = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 16, y: 10 });
    addState(w, 'feud', npc.id, foe.id, { kind: 'feud', robbery: false });
    npc.brain!.goals = [
      { kind: 'fight', targetId: foe.id, destination: { ...foe.pos }, phase: 'travel', reason: 'fight back' },
      { kind: 'resupply', targetId: 'bowl', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'needs repairs' },
    ];
    refreshVision(w);
    expect(inCombat(w, npc)).toBe(false);

    expect(turnCornered(w, npc)).toBe(true);
    expect(topGoal(npc)?.kind).toBe('fight');
    expect(topGoal(npc)?.targetId).toBe(foe.id);
  });

  it('does not turn back without a gun, and its stuck recovery starts', () => {
    const w = emptyWorld({ x: 50, y: 50 });
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    const foe = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 16, y: 10 });
    addState(w, 'feud', foe.id, npc.id, { kind: 'feud', robbery: false });
    startCombat(w, foe, npc);
    refreshVision(w);
    expect(turnCornered(w, npc)).toBe(false);
    npc.brain!.goals = [{ kind: 'flee', targetId: foe.id, destination: { x: 40, y: 10 }, phase: 'travel', reason: 'test' }];
    for (let i = 0; i < RULES.unstick.turns + 2 && !npc.brain!.recovery; i++) {
      startCombat(w, foe, npc);
      planNpcOrders(w);
    }
    expect(npc.brain!.recovery).toBeGreaterThan(0);
  });

  it('turns only on the foe it is in combat with, not on a nearer one it only feuds with', () => {
    const { w, npc } = createScavenger();
    const near = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 14, y: 10 });
    const far = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 18, y: 10 });
    addState(w, 'feud', npc.id, near.id, { kind: 'feud', robbery: false });
    addState(w, 'feud', far.id, npc.id, { kind: 'feud', robbery: false });
    startCombat(w, far, npc);
    refreshVision(w);
    expect(turnCornered(w, npc)).toBe(true);
    expect(topGoal(npc)?.targetId).toBe(far.id);
  });

  it('is given up when no repair is under way, since none can start', () => {
    const { w, npc } = createScavenger();
    npc.brain!.goals = [{ kind: 'repair', targetId: null, destination: null, phase: 'act', reason: 'patch damaged parts' }];
    const foe = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 16, y: 10 });
    addState(w, 'feud', foe.id, npc.id, { kind: 'feud', robbery: false });
    startCombat(w, foe, npc);
    refreshVision(w);
    expect(inCombat(w, npc)).toBe(true);
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'repair')).toBe(false);
  });
});

describe('salvage in combat', () => {
  it('is given up at the stock when no search runs, since none can start', () => {
    const { w, npc } = createScavenger();
    w.salvage.push({ id: 'test-stock', pos: { ...npc.pos }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'test-stock', destination: { ...npc.pos }, phase: 'act', reason: 'collect visible salvage' }];
    const foe = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 16, y: 10 });
    addState(w, 'feud', foe.id, npc.id, { kind: 'feud', robbery: false });
    startCombat(w, foe, npc);
    refreshVision(w);
    resolveNpcActivities(w);
    expect(npc.brain!.goals.some((g) => g.kind === 'scavenge')).toBe(false);
    expect(npc.job).toBeNull();
  });
});

describe('one looter per target', () => {
  const GONE = 'someone else is looting it';

  function lootGoal(kind: 'scavenge' | 'loot', targetId: string, phase: NpcActivity['phase'], at: { x: number; y: number }): NpcActivity {
    return { kind, targetId, destination: { ...at }, phase, reason: 'test loot' };
  }

  function parkedScavenger(w: World, pos: { x: number; y: number }): Vehicle {
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], pos);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    return npc;
  }

  function contestedWreck() {
    const { w, npc: first } = createScavenger();
    const wreck = { id: 'wreck901', pos: { x: 10.5, y: 10.5 }, radius: 0.6, goods: { scrap: 6 }, parts: [], hidden: emptyHidden() };
    w.salvage.push(wreck);
    first.speed = 0;
    first.brain!.goals = [lootGoal('scavenge', wreck.id, 'act', wreck.pos)];
    beginSearch(w, first, wreck.id);
    const second = parkedScavenger(w, { x: 11, y: 11 });
    refreshVision(w);
    return { w, first, second, wreck };
  }

  function contestedTruck() {
    const w = emptyWorld({ x: 50, y: 50 });
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 20, y: 10 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    addGoods(w, buggy, 'scrap', 2);
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const looters = [-gap, gap].map((dx) => {
      const npc = parkedScavenger(w, { x: 20 + dx, y: 10 });
      npc.brain!.goals = [lootGoal('loot', buggy.id, 'travel', buggy.pos)];
      return npc;
    });
    refreshVision(w);
    return { w, buggy, looters };
  }

  const stripping = (w: World, targetId: string) =>
    w.vehicles.filter((v) => v.job?.kind === 'refit' && v.job.pickup?.from === 'truck' && v.job.pickup.vehicleId === targetId);

  it('a second driver at a searched wreck gives up its goal and starts no search, while the first search runs on', () => {
    const { w, first, second, wreck } = contestedWreck();
    second.brain!.goals = [lootGoal('loot', wreck.id, 'travel', wreck.pos)];
    const turnsLeft = first.job!.turnsLeft;
    w.events = [];
    resolveNpcActivities(w);
    expect(second.job).toBeNull();
    expect(second.brain!.goals).toEqual([]);
    expect(w.events).toContainEqual(expect.objectContaining({ vehicle: second.id, previous: 'loot', reason: GONE }));
    expect(first.job).toMatchObject({ kind: 'search', stockId: wreck.id, turnsLeft });
    expect(topGoal(first)?.targetId).toBe(wreck.id);
  });

  it('drops a scavenge goal on its way to a wreck another truck searches', () => {
    const { w, second, wreck } = contestedWreck();
    second.pos = { x: 16, y: 10 };
    second.speed = 3;
    second.brain!.goals = [lootGoal('scavenge', wreck.id, 'travel', wreck.pos)];
    w.events = [];
    thinkNpc(w, second);
    expect(second.brain!.goals.some((g) => g.targetId === wreck.id)).toBe(false);
    expect(w.events).toContainEqual(expect.objectContaining({ vehicle: second.id, previous: 'scavenge', reason: GONE }));
  });

  it('does not see a wreck another truck searches as salvage', () => {
    const { w, first, second, wreck } = contestedWreck();
    expect(visibleSalvage(w, second).map((s) => s.id)).not.toContain(wreck.id);
    expect(visibleSalvage(w, first).map((s) => s.id)).toContain(wreck.id);
  });

  it('never picks a claimed wreck as its idle scavenge goal', () => {
    forceOption('idle', 'scavenge');
    const { w, second, wreck } = contestedWreck();
    thinkNpc(w, second);
    expect(topGoal(second)?.kind).toBe('scavenge');
    expect(topGoal(second)?.targetId).not.toBe(wreck.id);
  });

  it('never stops on the way for a wreck another truck searches', () => {
    forceOption('salvageSeen', 'loot');
    const { w, second, wreck } = contestedWreck();
    second.pos = { x: 16, y: 10 };
    second.speed = 3;
    second.brain!.goals = [{ kind: 'scavenge', targetId: 'podfield', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'search a known salvage site' }];
    thinkNpc(w, second);
    expect(second.brain!.goals.map((g) => g.targetId)).toEqual(['podfield']);
    expect(`salvageSeen:${wreck.id}` in second.brain!.noticed).toBe(false);
  });

  it('lets a second driver strip a knocked-out truck only after the first is gone', () => {
    const { w, buggy, looters } = contestedTruck();
    const [first, second] = looters;
    const held = goodsCount(second).scrap ?? 0;
    w.events = [];
    resolveNpcActivities(w);
    expect(stripping(w, buggy.id)).toEqual([first]);
    expect(goodsCount(second).scrap ?? 0).toBe(held);
    expect(second.brain!.goals).toEqual([]);
    expect(w.events).toContainEqual(expect.objectContaining({ vehicle: second.id, previous: 'loot', reason: GONE }));
    expect(visibleDowned(w, second).map((v) => v.id)).not.toContain(buggy.id);
  });

  it('gives a knocked-out player truck only one NPC looter', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    const gap = chassisDef(me.chassisId).radius + chassisDef('scout').radius + 0.2;
    const looters = [-gap, gap].map((dx) => {
      const npc = parkedScavenger(w, { x: 30 + dx, y: 30 });
      npc.brain!.goals = [lootGoal('loot', me.id, 'travel', me.pos)];
      return npc;
    });
    refreshVision(w);
    resolveNpcActivities(w);
    const acting = looters.filter((npc) => topGoal(npc)?.targetId === me.id);
    expect(acting).toEqual([looters[0]]);
    expect(looters[1].brain!.goals).toEqual([]);
  });

  it('never lets two drivers search one wreck at once, through full turns', () => {
    const w0 = emptyWorld({ x: 50, y: 50 });
    for (const key of Object.keys(NPCS)) w0.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const wreck = { id: 'wreck902', pos: { x: 15, y: 12 }, radius: 0.6, goods: { scrap: 8 }, parts: [], hidden: emptyHidden() };
    w0.salvage.push(wreck);
    const ids = [{ x: 10, y: 12 }, { x: 20, y: 12 }].map((pos) => {
      const npc = parkedScavenger(w0, pos);
      npc.brain!.goals = [lootGoal('loot', wreck.id, 'travel', wreck.pos)];
      return npc.id;
    });
    let w = w0;
    let searched = 0;
    for (let turn = 0; turn < 40; turn++) {
      w = endTurn(w, testDrive);
      const searching = w.vehicles.filter((v) => ids.includes(v.id) && v.job?.kind === 'search' && v.job.stockId === wreck.id);
      expect(searching.length, `turn ${turn}`).toBeLessThanOrEqual(1);
      searched += searching.length;
    }
    expect(searched).toBeGreaterThan(0);
  });

  describe('backing off', () => {
    it('ends the search and the goal, and passes the wreck by while it stays in sight', () => {
      const { w, first, wreck } = contestedWreck();
      w.turn = 7;
      w.events = [];
      backOffLoot(w, first);
      expect(first.job).toBeNull();
      expect(first.brain!.goals.some((g) => g.targetId === wreck.id)).toBe(false);
      expect(first.brain!.noticed[`salvageSeen:${wreck.id}`]).toBe(7);
      expect(w.events).toContainEqual(expect.objectContaining({ vehicle: first.id, previous: 'scavenge', reason: 'warned off the loot' }));
    });

    it('ends the strip of a knocked-out truck', () => {
      const { w, buggy, looters } = contestedTruck();
      resolveNpcActivities(w);
      const [first] = looters;
      expect(stripping(w, buggy.id)).toEqual([first]);
      backOffLoot(w, first);
      expect(stripping(w, buggy.id)).toEqual([]);
      expect(first.brain!.goals.some((g) => g.targetId === buggy.id)).toBe(false);
    });

    it('throws for a driver with no loot claim', () => {
      const { w, second } = contestedWreck();
      second.brain!.goals = [{ kind: 'travel', targetId: 'bowl', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'test goal' }];
      expect(() => backOffLoot(w, second)).toThrow('no loot claim');
    });
  });
});

describe('stall watchdog', () => {
  function frozen() {
    const { w, npc } = createScavenger();
    npc.brain!.goals = [{ kind: 'travel', targetId: 'bowl', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'test goal' }];
    return { w, npc };
  }

  function run(w: World, turns: number): void {
    for (let i = 0; i < turns; i++) {
      w.turn++;
      watchStalls(w);
    }
  }

  it('after stallTurns turns without progress clears the goals, jumps the truck nearby and gives it a fresh goal', () => {
    const { w, npc } = frozen();
    const start = { ...npc.pos };
    run(w, NPC_BEHAVIOR.stallTurns);
    expect(topGoal(npc)?.reason).toBe('test goal');
    run(w, 1);
    expect(w.events).toContainEqual({ t: 'stall', vehicle: npc.id, goal: 'travel', reason: 'test goal' });
    expect(npc.brain!.goals.some((g) => g.reason === 'test goal')).toBe(false);
    expect(topGoal(npc)).not.toBeNull();
    expect(topGoal(npc)!.kind).not.toBe('wait');
    expect(dist(npc.pos, start)).toBeGreaterThan(0);
    expect(dist(npc.pos, start)).toBeLessThanOrEqual(NPC_BEHAVIOR.stallJump);
  });

  it('gives a driver idle for stallTurns turns a goal', () => {
    const { w, npc } = createScavenger();
    run(w, NPC_BEHAVIOR.stallTurns + 1);
    expect(topGoal(npc)).not.toBeNull();
    expect(w.events.some((e) => e.t === 'stall' && e.goal === null)).toBe(true);
  });

  it('never jumps a truck the player sees', () => {
    const { w, npc } = frozen();
    w.vehicles[0].pos = { x: npc.pos.x + 5, y: npc.pos.y };
    refreshVision(w);
    const start = { ...npc.pos };
    run(w, NPC_BEHAVIOR.stallTurns + 1);
    expect(w.events.some((e) => e.t === 'stall')).toBe(true);
    expect(npc.pos).toEqual(start);
  });

  it('counts a new tile or a job turn as progress', () => {
    const { w, npc } = frozen();
    for (let i = 0; i <= NPC_BEHAVIOR.stallTurns * 2; i++) {
      npc.pos = { x: npc.pos.x + (i % 2 === 0 ? 1 : -1), y: npc.pos.y };
      run(w, 1);
    }
    npc.job = { kind: 'weld', turnsLeft: 1000, total: 1000 };
    for (let i = 0; i <= NPC_BEHAVIOR.stallTurns * 2; i++) {
      npc.job.turnsLeft--;
      run(w, 1);
    }
    expect(w.events.some((e) => e.t === 'stall')).toBe(false);
  });

  it('counts a driver shut down by an emitter pulse as making progress', () => {
    const { w, npc } = frozen();
    run(w, NPC_BEHAVIOR.stallTurns - 1);
    npc.shutDown = { from: w.turn + 1, until: w.turn + 2 };
    run(w, 2);
    expect(npc.brain!.progress!.since).toBe(w.turn);
    expect(w.events.some((e) => e.t === 'stall')).toBe(false);
  });

  it('counts a follower parked at its spot as waiting on its leader, and one short of its spot as stuck', () => {
    const follower = (off: number) => {
      const { w, npc } = createScavenger();
      npc.brain!.goals = [{ kind: 'follow', targetId: 'v-leader', destination: { x: npc.pos.x + off, y: npc.pos.y }, phase: 'travel', reason: 'test goal' }];
      run(w, NPC_BEHAVIOR.stallTurns + 1);
      return w.events.some((e) => e.t === 'stall');
    };
    expect(follower(0)).toBe(false);
    expect(follower(RULES.arriveRadius + 2)).toBe(true);
  });

  it('counts as waiting when its spot lies on the far side of the leader', () => {
    const { w, npc } = createScavenger();
    const leader = addVehicle(w, npc.faction, 'scout', ['stockEngine'], { x: npc.pos.x + 2, y: npc.pos.y });
    leader.speed = 0;
    npc.brain!.goals = [{ kind: 'follow', targetId: leader.id, destination: { x: leader.pos.x + 3, y: leader.pos.y }, phase: 'travel', reason: 'test goal' }];
    run(w, NPC_BEHAVIOR.stallTurns + 1);
    expect(w.events.some((e) => e.t === 'stall')).toBe(false);
  });
});

describe('parking beside a truck', () => {
  function meeting() {
    const w = emptyWorld({ x: 30, y: 30 });
    const tower = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 50, y: 30 }, Math.PI);
    tower.brain = npcBrain('trader', tower.pos, NPCS.trader.traits);
    const client = w.vehicles[0];
    const stop = (): { x: number; y: number } =>
      getActivityDestination(w, tower, { kind: 'tow', targetId: client.id, destination: { ...client.pos }, phase: 'travel', reason: 'test activity' })!;
    return { w, tower, client, stop };
  }

  it('is on the side the driver comes from while that spot is free', () => {
    const { client, stop } = meeting();
    const spot = stop();
    expect(spot.x).toBeGreaterThan(client.pos.x);
    expect(spot.y).toBeCloseTo(client.pos.y);
  });

  it('moves to the nearest free spot around the truck when another truck stands on the approach spot', () => {
    const { w, tower, client, stop } = meeting();
    const taken = stop();
    const blocker = addVehicle(w, 'bowl', 'hauler', ['stockEngine'], taken, 0);
    const spot = stop();
    expect(dist(spot, blocker.pos)).toBeGreaterThanOrEqual(chassisDef(blocker.chassisId).radius + vehicleStats(w, tower).radius);
    expect(dist(spot, client.pos)).toBeCloseTo(dist(taken, client.pos));
  });
});

describe('a full hold', () => {
  function heavyLoaded() {
    const w = emptyWorld({ x: 50, y: 50 });
    const npc = addVehicle(w, 'scavengers', 'hauler', ['mg', 'stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    for (const good of Object.keys(GOODS).sort((a, b) => GOODS[b].mass - GOODS[a].mass)) addGoods(w, npc, good, 1000);
    expect(freeCells(npc)).toBeGreaterThan(0);
    expect(hasCargoRoom(npc)).toBe(false);
    return { w, npc };
  }

  it('sends no driver to salvage on the way, and goes on selling its cargo', () => {
    forceOption('salvageSeen', 'loot');
    forceOption('idle', 'scavenge');
    const { w, npc } = heavyLoaded();
    w.salvage = [{ id: 'wreck-on-road', pos: { x: 18, y: 10 }, radius: 0.6, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() }];
    npc.speed = 3;
    npc.brain!.goals = [{ kind: 'sell', targetId: 'bowl', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'sell carried cargo' }];
    refreshVision(w);
    expect(visibleSalvage(w, npc).map((s) => s.id)).toContain('wreck-on-road');
    thinkNpc(w, npc);
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['sell']);
    expect(`salvageSeen:wreck-on-road` in npc.brain!.noticed).toBe(false);
  });

  it('picks no scavenge goal when idle, and sells instead', () => {
    forceOption('idle', 'scavenge');
    const { w, npc } = heavyLoaded();
    w.salvage = [{ id: 'wreck-in-sight', pos: { x: 14, y: 10 }, radius: 0.6, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() }];
    refreshVision(w);
    thinkNpc(w, npc);
    expect(topGoal(npc)?.kind).toBe('sell');
  });
});

describe('a loot refit under way', () => {
  function strippingLooter() {
    const w = emptyWorld({ x: 50, y: 50 });
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 20, y: 10 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 20 - gap, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    npc.brain.goals = [{ kind: 'loot', targetId: buggy.id, destination: { ...buggy.pos }, phase: 'travel', reason: 'test loot' }];
    refreshVision(w);
    resolveNpcActivities(w);
    expect(npc.job?.kind).toBe('refit');
    return { w, npc, buggy };
  }

  function needsRepair(w: World, npc: Vehicle): void {
    addGoods(w, npc, 'parts', 4);
    corePart(npc, 'cab').hp = 1;
  }

  it('is not cancelled by a repair, and the loot goal stays on top', () => {
    const { w, npc, buggy } = strippingLooter();
    needsRepair(w, npc);
    thinkNpc(w, npc);
    expect(npc.job?.kind).toBe('refit');
    expect(topGoal(npc)).toMatchObject({ kind: 'loot', targetId: buggy.id });
    expect(npc.brain!.goals.some((g) => g.kind === 'repair')).toBe(false);
  });

  it('gives way to a repair once the refit ends', () => {
    const { w, npc } = strippingLooter();
    needsRepair(w, npc);
    npc.job = null;
    npc.brain!.goals = [];
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'repair')).toBe(true);
  });
});
