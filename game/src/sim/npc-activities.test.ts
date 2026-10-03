import { TERRAIN } from '../data/terrain';
import { describe, expect, it } from 'vitest';
import { contactsOf } from './detect';
import { emptyWorld, addVehicle, editableTerrain, forceOption, npcBrain, testDrive , startCombat } from './testkit';
import { planNpcOrders } from './ai';
import { getResources } from './resources';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { MIN_CHANCE, NPC_BEHAVIOR, NPC_UPKEEP, NPCS, TRAITS, type TraitId } from '../data/npcs';
import { SHOPS } from '../data/market';
import { optionChances, optionWeights, visibleDowned, visibleSalvage } from './npc-decisions';
import { endTurn, newWorld } from './world';
import { corePart, freeCells, goodsCount } from './grid';
import { makePart } from './factory';
import { addGoods } from './inventory';
import { backOffLoot, getActivityDestination, resolveNpcActivities, thinkNpc, topGoal, watchStalls } from './npc-activities';
import { beginSearch } from './search';
import { knockOutNpc } from './defeat';
import { chassisDef } from '../data/chassis';
import { cloneWorld } from './world';
import { canUseSite, siteGates, sitePads } from './sites';
import { bayPoints, deckAlongAt, hullDecks, territoryEntries, territoryOfStock, territorySpots } from './territory';
import { heightAt, isCliff, tileAt } from './terrain';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { fuelCap, vehicleStats } from './stats';
import { heatAt } from './sun';
import { dist, type Vec } from './vec';
import { advanceFar } from './far';
import type { NpcActivity, Vehicle, World } from './types';
import { addState } from './states';
import { inCombat } from './combat';
import { refreshVision } from './vision';
import { recall } from './memory';

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

// The fuel a trader from createTrader keeps for the straight way to its nearest pump, a town or a service stall,
// with no misjudgment.
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

  it.each(['sell', 'resupply', 'raid'] as const)('records completion of %s once', (kind) => {
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
    w.salvage = [{ id: 'wreck-test', pos: { x: 10.5, y: 10 }, radius: 0.6, goods: {}, parts: [makePart(w, 'plates', 0)] }];
    npc.speed = 0;
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'wreck-test', destination: { ...npc.pos }, phase: 'travel', reason: 'collect visible salvage' }];
    w.events = [];
    resolveNpcActivities(w);
    expect(npc.job).toBeNull();
    expect(w.events).toEqual([expect.objectContaining({ previous: 'scavenge', activity: null, reason: 'cargo cannot hold salvage' })]);
  });

  it('does not see a reachable stock as salvage when nothing in it fits', () => {
    const { w, npc } = createScavenger();
    addGoods(w, npc, 'scrap', freeCells(npc) - 1);
    w.salvage = [{ id: 'wreck-test', pos: { x: 10.5, y: 10 }, radius: 0.6, goods: {}, parts: [makePart(w, 'plates', 0)] }];
    npc.speed = 0;
    expect(visibleSalvage(w, npc)).toEqual([]);
    w.salvage[0].goods.scrap = 1;
    expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck-test']);
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
    // Spawn timers are initialized lazily, so disable every template explicitly.
    for (const key of Object.keys(NPCS)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const id = npc.id;
    const initialMoney = npc.resources!.money;
    let collected = false;
    let sold = false;
    let serviced = false;
    // Observed completion is well under 500 turns; keep a generous cap so a stalled NPC fails fast.
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
    w.salvage = [{ id: 'wreck-test', pos: { x: 17, y: 10 }, radius: 0.6, goods: { scrap: 0 }, parts: [] }];
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

  it('a raider can knock out an NPC, strip its cargo and sell it', () => {
    // The player waits far off the raider's way to any shop, so the raider has no reason to stop for it.
    const w0 = emptyWorld({ x: 450, y: 60 });
    const raider = addVehicle(w0, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 14, y: 12 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    forceOption('idle', 'scavenge');
    // The engineless victim is stranded. It holds out when offered a way out, so the fight ends in a knockout.
    forceOption('surrenderOffered', 'refuse');
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
    // The broken cab knocks the victim out. A death roll would leave a wreck instead.
    const deathChance = RULES.npcDeathChance;
    (RULES as { npcDeathChance: number }).npcDeathChance = 0;
    try {
      for (let turn = 0; turn < w.size * 5; turn++) {
        w = endTurn(w, testDrive);
        if (w.vehicles.find((v) => v.id === victim.id)?.defeat) knockedOut = true;
        const actor = w.vehicles.find((v) => v.id === raider.id)!;
        const scrap = goodsCount(actor).scrap ?? 0;
        if (scrap > 0) looted = true;
        // The sale pays for the scrap. The raider may buy fuel on the way, so its money can end below the start.
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
    // A territory is searched at one of its loot spots.
    const spotOf = w.salvage.find((stock) => stock.id === target && territoryOfStock(stock));
    expect(spotOf ? 'fallen-sun' : target).toSatisfy((id: string) => TRAITS.scavenger.salvageSites.includes(id));
  });

  describe('in a territory', () => {
    // A scavenger that knows only the Fallen Sun, with the player far away.
    function fallenSunScavenger(at: { x: number; y: number }) {
      const { w, npc } = createScavenger();
      npc.pos = { ...at };
      npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
      const traits = TRAITS.scavenger as { salvageSites: string[] };
      const saved = traits.salvageSites;
      traits.salvageSites = ['fallen-sun'];
      return { w, npc, restore: () => void (traits.salvageSites = saved) };
    }
    const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    const entry = () => territoryEntries(sun as never)[0];

    it('targets one of its loot spots, and keeps the goal while the spot is out of sight', () => {
      const { w, npc, restore } = fallenSunScavenger({ x: 10, y: 10 });
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

    it('parks beside the spot, searches it and takes its loot', () => {
      const { w, npc, restore } = fallenSunScavenger({ x: 10, y: 10 });
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

    it('drives up a hull deck by its low end to the bay at its top, searches it and takes its loot', () => {
      // The real map, with the decks stamped into the ground, and the scavenger on the floor before the bow's low end.
      const w = newWorld(1337, START_KITS.standard, TEST_MAP);
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
      const bow = hullDecks().find((d) => d.section.id === 'bow')!;
      const back = { x: bow.low.x - (bow.high.x - bow.low.x) / bow.section.length * 3, y: bow.low.y - (bow.high.y - bow.low.y) / bow.section.length * 3 };
      const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], back);
      npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
      const top = bayPoints(bow).at(-1)!;
      const bay = w.salvage.find((s) => dist(s.pos, top) < 1e-3)!;
      expect(bay.id).toMatch(/^deckBay-/);
      npc.brain.goals = [{ kind: 'scavenge', targetId: bay.id, destination: { ...bay.pos }, phase: 'travel', reason: 'search a loot spot' }];
      const moveFar = (next: World) => next.vehicles.forEach((v) => v.brain && advanceFar(next, v));
      // The lower bays on the way would pull the driver off the top one.
      forceOption('salvageSeen', 'keep');
      const scrapIn = (world: World) => world.salvage.find((s) => s.id === bay.id)!.goods.scrap ?? 0;
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
      const t = next.terrain;
      expect(path.filter((p) => isCliff(t, tileAt(t, p)))).toEqual([]);
      const firstOnDeck = path.map((p) => deckAlongAt(bow, p)).find((a) => a !== null)!;
      expect(firstOnDeck).toBeLessThan(0.25);
      expect(deckAlongAt(bow, took!.pos)).toBeGreaterThan(0.6);
      expect(heightAt(t, took!.pos.x, took!.pos.y) - heightAt(t, back.x, back.y)).toBeGreaterThan(bow.section.rise / 2);
    });

    it('ends a trip to a territory at its road end, not at its centre', () => {
      const { w, npc } = createScavenger();
      const goal: NpcActivity = { kind: 'travel', targetId: sun.id, destination: { ...entry() }, phase: 'travel', reason: 'make a trip to another site' };
      expect(getActivityDestination(w, npc, goal)).toEqual(entry());
    });
  });

  it('interrupts work for low fuel', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    getResources(w, npc).fuel = 0;
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('resupply');
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

  it('drives on near a town with a tank well below a fifth', () => {
    const { w, npc } = createTrader();
    const pad = sitePads(REGION.towns[0])[0];
    npc.pos = { x: pad.x, y: pad.y + 30 };
    planNpcOrders(w);
    getResources(w, npc).fuel = 0.1 * fuelCap(npc);
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).not.toBe('resupply');
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
    player.speed = 4; // loud enough to be heard far past sight range
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 }); // just past sight
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('investigate');
    expect(topGoal(raider)?.targetId).toBe(player.id);
  });

  it('a raider fighting a hostile in sight ignores a heard contact beyond sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 4;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 }); // hears the player just past sight
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
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 220, y: 300 }); // 40 tiles: heard, but the contact circle is wider than the reaction limit
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
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 }); // just past sight
    raider.speed = 4;
    forceOption('contactHeard', 'flee');
    planNpcOrders(w);
    expect(topGoal(trader)?.kind).toBe('flee');
    expect(topGoal(trader)?.targetId).toBe(raider.id);
  });

  it('a parked player behind a hill goes unnoticed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 0; // parked: no sound, no dust
    editableTerrain(w);
    const size = w.terrain.size;
    for (let i = 33; i <= 37; i++) for (let j = 28; j <= 32; j++) w.terrain.heights[j * (size + 1) + i] = 3;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 }); // beyond the hill
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).not.toBe('investigate');
    expect(topGoal(raider)?.kind).not.toBe('fight');
    expect(topGoal(raider)?.kind).not.toBe('flee');
  });
});

describe('hunting a lost fight target', () => {
  // A raider 15 tiles from the player sees it and fights it. The player then parks 25 tiles from the raider, out of
  // sight and silent.
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

  it('re-aims at the heard engine of the target and restarts the search', () => {
    const { w, player, raider } = raiderLosesPlayer();
    player.speed = 4;
    w.turn += NPC_BEHAVIOR.fightSearchTurns;
    const contact = contactsOf(w, raider, Infinity).find((c) => c.vehicleId === player.id)!;
    expect(contact.sources).toContain('sound');
    planNpcOrders(w);
    expect(topGoal(raider)).toMatchObject({ kind: 'fight', destination: contact.center, perceived: w.turn });
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
  // A scavenger driving to a known site, with a road wreck in sight off its route.
  function passingWreck(traits: TraitId[] = ['scavenger']) {
    const { w, npc } = createScavenger();
    npc.brain = npcBrain('scavenger', npc.pos, traits);
    npc.brain.goals = [{ kind: 'scavenge', targetId: 'podfield', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'search a known salvage site' }];
    w.salvage.push({ id: 'wreck900', pos: { x: 14, y: 10 }, radius: 0.6, goods: { scrap: 2 }, parts: [] });
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
    // Salvage on the way would pull the driver off its point.
    forceOption('salvageSeen', 'keep');
    let w = w0;
    for (let i = 0; i < 20 && topGoal(w.vehicles.find((v) => v.id === npc.id)!)?.kind === 'explore'; i++) w = endTurn(w, moveFar);
    const after = w.vehicles.find((v) => v.id === npc.id)!;
    expect(topGoal(after)?.kind).not.toBe('explore');
    expect(dist(after.pos, { x: 170, y: 150 })).toBeGreaterThan(RULES.arriveRadius * 2);
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
    w.salvage.push({ id: 'test-stock', pos: { ...npc.pos }, radius: 1, goods: { scrap: 3 }, parts: [] });
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

  // Two scavengers parked beside a road wreck. The first one searches it.
  function contestedWreck() {
    const { w, npc: first } = createScavenger();
    const wreck = { id: 'wreck901', pos: { x: 10.5, y: 10.5 }, radius: 0.6, goods: { scrap: 6 }, parts: [] };
    w.salvage.push(wreck);
    first.speed = 0;
    first.brain!.goals = [lootGoal('scavenge', wreck.id, 'act', wreck.pos)];
    beginSearch(w, first, wreck.id);
    const second = parkedScavenger(w, { x: 11, y: 11 });
    refreshVision(w);
    return { w, first, second, wreck };
  }

  // Two raiders parked on either side of a knocked-out buggy with a gun and two scrap.
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
    const wreck = { id: 'wreck902', pos: { x: 15, y: 12 }, radius: 0.6, goods: { scrap: 8 }, parts: [] };
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
  // A scavenger pinned to one tile with a goal it never works on.
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
