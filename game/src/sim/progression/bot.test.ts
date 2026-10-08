import { PRESSURE_MAX } from '../../data/market';
import type { GameEvent, Vehicle, World } from '../types';
import { describe, expect, it } from 'vitest';
import { CHASSIS, chassisDef } from '../../data/chassis';
import { REGION } from '../../data/region';
import { START_KITS } from '../../data/start';
import { partDef } from '../../data/parts';
import { SHOPS } from '../../data/market';
import { CONDITION, ENGINE_HEAT } from '../../data/wear';
import { playerVehicle, vehicleById } from '../damage';
import { makePart } from '../factory';
import { freeCells, goodsCount, mountedParts } from '../grid';
import { addGoods, mountPart, removeAllGoods, stowPart } from '../inventory';
import { siteOf } from '../market';
import { playerSees } from '../vision';
import { nearestPad, nearestTown } from '../sites';
import { TERRAIN } from '../../data/terrain';
import { isStranded, vehicleStats } from '../stats';
import { dist, pointsAway, type Vec } from '../vec';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls, startCombat, testDrive } from '../testkit';
import { NPC_BEHAVIOR, NPCS, TRAITS } from '../../data/npcs';
import { towData } from '../states';
import { playerTow, startEscort } from '../tow';
import { cloneWorld, endTurn, hostileToPlayer } from '../world';
import { basicsRepairCost, driveRepairCost, getTradePrice, partTradePrice, repairCost } from '../economy';
import { getKnownSite, getUpkeepReserve, judgeDanger, tripFuelCost } from '../npc-decisions';
import { maxHp } from '../wear';
import { emptyHidden } from '../salvage';
import { botOrders, CONVOY_ROB_PATROL, haulMarginAt, robTarget, wouldRob } from './bot';

function town(id: string) {
  const found = REGION.towns.find((t) => t.id === id);
  if (!found) throw new Error(`No town ${id}`);
  return found;
}

// The goods a truck carries beside the repair parts every bot keeps.
const loadOf = (v: Vehicle): string[] => Object.keys(goodsCount(v)).filter((good) => good !== 'parts');

// An empty world with the player parked on a pad of a town, its cargo gone but the standard kit's repair parts, and
// both towns known.
function parkedAt(id: string) {
  const site = town(id);
  const w = emptyWorld(nearestPad(site, site.pos));
  const me = playerVehicle(w);
  removeAllGoods(me);
  addGoods(w, me, 'parts', START_KITS.standard.cargo.parts ?? 0);
  me.speed = 0;
  w.player.discovered = ['bowl', 'nose'];
  return w;
}

// A raider with no gun far off, so a hunter always has prey in the world and patrols for it.
function withPrey(w: World): World {
  const me = playerVehicle(w);
  const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: me.pos.x + 150, y: me.pos.y });
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  return w;
}

// Salt flooded at Nose and short at Bowl, so it is the clear best haul whatever the tuned prices.
function saltGlut(w: World): World {
  w.shops.nose.pressure.salt = -PRESSURE_MAX;
  w.shops.bowl.pressure.salt = PRESSURE_MAX;
  return w;
}

describe('botOrders', () => {
  it('gives a knocked-out player no commands', () => {
    const w = parkedAt('bowl');
    w.player.state = 'knockedOut';

    const turn = botOrders(w, 'trader');

    expect(turn.world).toBe(w);
    expect(turn.events).toEqual([]);
  });

  it('has a trader with money for one unit buy that one unit', () => {
    const w = saltGlut(parkedAt('nose'));
    const me = playerVehicle(w);
    w.player.money = getUpkeepReserve(me) + getTradePrice(w, me, 'nose', 'salt', 'buy') + 1;

    const turn = botOrders(w, 'trader');

    expect(goodsCount(playerVehicle(turn.world)).salt).toBe(1);
  });

  // Nose sells salt cheap, and Bowl pays well for it.
  it('has a trader buy the most profitable good in the town it stands at', () => {
    const w = saltGlut(parkedAt('nose'));

    const turn = botOrders(w, 'trader');

    expect(loadOf(playerVehicle(turn.world))).toEqual(['salt']);
    expect(turn.world.player.money).toBeLessThan(w.player.money);
  });

  it('has a trader take the trade from the town it stands at over a richer one that needs an empty trip back', () => {
    const w = saltGlut(parkedAt('nose'));
    w.shops.bowl.pressure.textiles = -PRESSURE_MAX;
    w.shops.nose.pressure.textiles = PRESSURE_MAX;

    const turn = botOrders(w, 'trader');

    expect(loadOf(playerVehicle(turn.world))).toEqual(['salt']);
  });

  // It arrives broke with a damaged truck and electronics both towns pay well for, so service repairs nothing before
  // the sale here, and salt is the load to buy after it.
  it('has a trader keep the repair bill out of the load it buys after a sale', () => {
    const w = saltGlut(parkedAt('nose'));
    w.shops.nose.pressure.textiles = PRESSURE_MAX;
    w.shops.bowl.pressure.electronics = PRESSURE_MAX;
    addGoods(w, playerVehicle(w), 'electronics', 6);
    w.player.costBasis.electronics = 33;
    w.player.money = 0;
    for (const part of mountedParts(playerVehicle(w))) part.hp = Math.floor(maxHp(part) / 4);
    expect(repairCost(w)).toBeGreaterThan(getUpkeepReserve(playerVehicle(w)));

    const turn = botOrders(w, 'trader');

    expect(turn.ledger.goodsSold).toBeGreaterThan(0);
    expect(turn.ledger.goodsBought).toBeLessThan(0);
    expect(turn.world.player.money).toBeGreaterThanOrEqual(repairCost(turn.world));
  });

  it('has a bot in town with a broken junk engine and money to spare carry on', () => {
    const w = parkedAt('nose');
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    engine.wear = CONDITION.maxWear + 1;
    engine.hp = 1;

    expect(() => botOrders(w, 'trader')).not.toThrow();
  });

  it('has a trader carry its cargo to the known town that pays more for it', () => {
    const w = parkedAt('bowl');
    addGoods(w, playerVehicle(w), 'electronics', 2);
    w.player.costBasis.electronics = 3333;

    const turn = botOrders(w, 'trader');

    const order = playerVehicle(turn.world).order;
    const nose = town('nose');
    expect(order).toEqual({ kind: 'stopAt', dest: nearestPad(nose, playerVehicle(w).pos) });
  });

  it('has a scavenger with no salvage left and every site found trade instead', () => {
    const w = saltGlut(parkedAt('nose'));
    w.salvage = [];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((site) => site.id);

    const turn = botOrders(w, 'scavenger');

    expect(loadOf(playerVehicle(turn.world))).toEqual(['salt']);
  });

  it('has a scavenger with no salvage left, every site found and no load it can afford read the next board', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const me = playerVehicle(w);
    removeAllGoods(me);
    w.salvage = [];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((site) => site.id);
    w.player.money = 0;

    const turn = botOrders(w, 'scavenger');

    const nearestShop = Object.keys(SHOPS).map(siteOf).sort((a, b) => dist(me.pos, a.pos) - dist(me.pos, b.pos))[0];
    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: nearestPad(nearestShop, me.pos) });
  });

  // A knockout strips the engine, and the stranded truck is stuck until it gets one.
  function withoutEngine(w: ReturnType<typeof parkedAt>) {
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => it.kind !== 'part' || !mountedParts(me, 'engine').includes(it.part));
    return w;
  }

  it('has a scavenger beside a wreck wait to search it while in combat', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.speed = 0;
    w.salvage.push({ id: 'wreck-beside', pos: { x: 31.5, y: 30 }, radius: 0.6, goods: { scrap: 2 }, parts: [], hidden: emptyHidden() });
    startCombat(w, addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }), me);

    const turn = botOrders(w, 'scavenger');

    expect(playerVehicle(turn.world).job).toBeNull();
  });

  it('has a scavenger search a searched wreck again while units stay hidden there', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.speed = 0;
    w.salvage.push({ id: 'wreck-beside', pos: { x: 31.5, y: 30 }, radius: 0.6, goods: {}, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 4 } } });
    w.player.scavenged.push('wreck-beside');

    const turn = botOrders(w, 'scavenger');

    expect(playerVehicle(turn.world).job).toMatchObject({ kind: 'search', stockId: 'wreck-beside' });
  });

  it('has a stranded truck crawl to the nearest town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
    const me = playerVehicle(w);
    me.pos = { x: me.pos.x + 20, y: me.pos.y - 20 };

    const turn = botOrders(w, 'trader');

    const after = playerVehicle(turn.world);
    expect(after.order).toEqual({ kind: 'stopAt', dest: nearestPad(nearestTown(w), me.pos) });
    expect(turn.world.player.beacon).toBe(true);
  });

  it('has a stranded truck keep its beacon off in combat and turn it on once the fight is over', () => {
    const beaconIn = (fight: boolean) => {
      const w = withoutEngine(parkedAt('bowl'));
      w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
      const me = playerVehicle(w);
      me.pos = { x: me.pos.x + 20, y: me.pos.y - 20 };
      if (fight) {
        const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: me.pos.x + 6, y: me.pos.y });
        raider.brain = npcBrain('buggy', raider.pos, ['raider']);
        startCombat(w, raider, me);
      }
      return botOrders(w, 'trader').world.player.beacon;
    };

    expect(beaconIn(true)).toBe(false);
    expect(beaconIn(false)).toBe(true);
  });

  // A broken transmission strands the truck, and it still crawls. A tow helps only when the money and the gear for
  // sale cover the repair. A robbery leaves only the built-in parts and the engine.
  it('has a stranded truck call for a tow only when it can pay for the fix', () => {
    const stranded = (money: number) => {
      const w = parkedAt('bowl');
      const me = playerVehicle(w);
      me.pos = { x: me.pos.x + 40, y: me.pos.y };
      me.items = me.items.filter((it) => it.kind === 'part' && ['core', 'engine'].includes(partDef(it.part.defId).kind));
      for (const part of mountedParts(me)) if (part.defId.includes('transmission')) part.hp = 0;
      w.player.money = money;
      expect(isStranded(w, me)).toBe(true);
      return botOrders(w, 'trader').world;
    };

    expect(stranded(66667).player.beacon).toBe(true);
    expect(stranded(0).player.beacon).toBe(false);
  });

  // An empty tank still lets the truck crawl, and a tow to a town it cannot buy fuel in only adds the fee.
  it('has a broke truck with an empty tank crawl on instead of calling a tow', () => {
    const dry = (money: number) => {
      const w = parkedAt('bowl');
      const me = playerVehicle(w);
      me.pos = { x: me.pos.x + 40, y: me.pos.y };
      me.items = me.items.filter((it) => it.kind === 'part' && ['core', 'engine'].includes(partDef(it.part.defId).kind));
      w.player.fuel = 0;
      w.player.money = money;
      return botOrders(w, 'trader').world;
    };

    expect(dry(16667).player.beacon).toBe(true);
    expect(dry(0).player.beacon).toBe(false);
  });

  // A trader parks beside a truck a robbery left with no engine and offers a tow to its nearest town.
  it('has a truck without an engine take a tow only to a town where it can get one', () => {
    const offerTo = (money: number, stock: 'there' | 'elsewhere') => {
      const w = withoutEngine(emptyWorld({ x: 30, y: 30 }));
      const me = playerVehicle(w);
      me.items = me.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core');
      w.player.money = money;
      const tower = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
      tower.brain = npcBrain('trader', tower.pos, NPCS.trader.traits);
      forceOption('strandedSeen', 'tow');
      let at = w;
      for (let i = 0; i < 30 && !playerTow(at); i++) at = endTurn(at, testDrive);
      const site = towData(playerTow(at)!).site;
      for (const [id, shop] of Object.entries(at.shops)) {
        shop.stock = shop.stock.filter((p) => partDef(p.defId).kind !== 'engine');
        if ((id === site) === (stock === 'there')) shop.stock.push(makePart(at, 'stockEngine', 0));
      }
      return playerTow(botOrders(at, 'trader').world);
    };

    expect(offerTo(0, 'there')).toBeNull();
    expect(offerTo(66667, 'elsewhere')).toBeNull();
    expect(offerTo(66667, 'there')).toMatchObject({ data: { hitched: true } });
  });

  it('has a stranded truck without an engine buy and mount one in town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
    expect(isStranded(w, playerVehicle(w))).toBe(true);

    const turn = botOrders(w, 'hunter');

    expect(mountedParts(playerVehicle(turn.world), 'engine')).toHaveLength(1);
    expect(isStranded(turn.world, playerVehicle(turn.world))).toBe(false);
  });

  // Just off the Bowl pad with a haul for Nose: back to Bowl only for an engine it stocks and the money covers.
  it('has a truck without an engine turn back only to a shop with an engine it can afford', () => {
    const offPad = (engineInStock: boolean) => {
      const w = withoutEngine(parkedAt('bowl'));
      const me = playerVehicle(w);
      me.pos = { x: me.pos.x + 8, y: me.pos.y };
      w.player.money = 66667;
      for (const shop of Object.values(w.shops)) shop.stock = shop.stock.filter((p) => partDef(p.defId).kind !== 'engine');
      if (engineInStock) w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
      w.player.contracts.push({ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'salt', units: 1, to: 'nose', reward: 10000, deadline: 5000, window: 5000, rush: false, tier: 1 });
      addGoods(w, me, 'salt', 1);
      return botOrders(w, 'trader').world;
    };
    const dest = (w: World) => (playerVehicle(w).order as { dest: { x: number; y: number } }).dest;
    const toward = (w: World, id: string) => nearestPad(town(id), playerVehicle(w).pos);

    const stocked = offPad(true);
    const bare = offPad(false);

    expect(dest(stocked)).toEqual(toward(stocked, 'bowl'));
    expect(dest(bare)).toEqual(toward(bare, 'nose'));
  });

  // A raider took the haul's goods, so the haul can never be handed in.
  it('has a trader whose haul goods are gone trade on', () => {
    const w = saltGlut(parkedAt('nose'));
    w.player.contracts.push({ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'fuel', units: 12, to: 'nose', reward: 10000, deadline: 5000, window: 5000, rush: false, tier: 1 });

    const turn = botOrders(w, 'trader');

    expect(loadOf(playerVehicle(turn.world))).toEqual(['salt']);
  });

  it('has a bot in debt in town sell gear to clear it', () => {
    const w = parkedAt('bowl');
    w.player.money = -2000;

    const turn = botOrders(w, 'trader');

    expect(turn.ledger.gear).toBeGreaterThan(0);
    expect(turn.world.player.money).toBeGreaterThanOrEqual(0);
  });

  it('has a broke bot in town with a broken transmission sell gear to fix it first', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    for (const p of mountedParts(me, 'core')) if (partDef(p.defId).id === 'transmission') p.hp = 0;
    w.player.money = 0;
    w.player.fuel = 0;

    const turn = botOrders(w, 'trader');

    const after = playerVehicle(turn.world);
    expect(mountedParts(after, 'core').every((p) => p.hp === maxHp(p))).toBe(true);
    expect(turn.ledger.gear).toBeGreaterThan(0);
    expect(turn.ledger.repairs).toBeLessThan(0);
  });

  // The town's scrap patch counts the drive fix as paid when the money covers it, so a bot that waited for money to
  // fix the cab as well left town still stranded.
  it('has a stranded bot that cannot pay for every built-in part fix the ones that strand it', () => {
    const w = parkedAt('nose');
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => it.kind !== 'part' || ['core', 'engine'].includes(partDef(it.part.defId).kind));
    for (const p of mountedParts(me, 'core')) {
      if (p.defId.includes('transmission')) p.hp = 0;
      if (p.defId.startsWith('cab')) p.hp = maxHp(p) * 0.2;
    }
    w.player.money = driveRepairCost(w);
    expect(basicsRepairCost(w)).toBeGreaterThan(w.player.money);

    const turn = botOrders(w, 'trader');

    const after = playerVehicle(turn.world);
    expect(isStranded(turn.world, after)).toBe(false);
    expect(mountedParts(after, 'core').find((p) => p.defId.startsWith('cab'))!.hp).toBeLessThan(maxHp(mountedParts(after, 'core').find((p) => p.defId.startsWith('cab'))!));
    expect(turn.world.player.money).toBeGreaterThanOrEqual(0);
  });

  // Haul goods ride on the roof rack's row, so the rack cannot come off for the repair money.
  it('has a broke bot keep a rack that carries its haul when it sells gear for a repair', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    expect(mountPart(w, me, makePart(w, 'rack', 0))).toBe(true);
    const units = addGoods(w, me, 'tools', 99);
    w.player.contracts.push({ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'tools', units, to: 'nose', reward: 10000, deadline: 5000, window: 5000, rush: false, tier: 1 });
    for (const p of mountedParts(me, 'core')) if (partDef(p.defId).id === 'transmission') p.hp = 0;
    w.player.money = 0;

    const turn = botOrders(w, 'trader');

    expect(mountedParts(playerVehicle(turn.world)).map((p) => p.defId)).toContain('rack');
  });

  // A bill the gear cannot cover leaves the gear on, since selling it buys no repair.
  it('has a broke bot keep its gear when selling it cannot pay the repair', () => {
    const w = parkedAt('bowl');
    for (const p of mountedParts(playerVehicle(w), 'core')) p.hp = 0;
    w.player.money = 0;

    const turn = botOrders(w, 'trader');

    expect(turn.ledger.gear).toBe(0);
  });

  // Below the working capital a bot buys no upgrade, but a gun it lost it buys back.
  it('has a hunter that lost its gun buy the cheapest one in town', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => it.kind !== 'part' || !mountedParts(me, 'weapon').includes(it.part));
    w.player.money = 20000;
    w.shops.bowl.stock = [makePart(w, 'mg', 0), makePart(w, 'heavyMg', 0)];

    const turn = botOrders(w, 'hunter');

    expect(mountedParts(playerVehicle(turn.world), 'weapon').map((p) => p.defId)).toEqual(['mg']);
    expect(turn.ledger.gear).toBeLessThan(0);
  });

  // Out of supplies too: the money left after the engine buys them.
  it('has a broke truck without an engine sell gear in town to buy one', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.player.money = 0;
    w.player.supplies = 0;
    w.shops.bowl.stock = [makePart(w, 'stockEngine', 0)];
    const gearBefore = mountedParts(playerVehicle(w)).filter((p) => !['core', 'engine'].includes(partDef(p.defId).kind)).length;

    const turn = botOrders(w, 'trader');

    const me = playerVehicle(turn.world);
    expect(mountedParts(me, 'engine')).toHaveLength(1);
    expect(mountedParts(me).filter((p) => !['core', 'engine'].includes(partDef(p.defId).kind)).length).toBeLessThan(gearBefore);
    expect(turn.world.player.money).toBeGreaterThanOrEqual(0);
    expect(turn.world.player.supplies).toBeGreaterThan(0);
  });

  // Every shop does garage work, so a stall mounts a bought engine that does not fit the cargo cells. The spare
  // covers the price, so the mounted gear stays.
  it('has a broke truck without an engine at a stall sell a spare and mount a bought engine', () => {
    const yard = siteOf('salvage-yard');
    const w = withoutEngine(parkedAt('bowl'));
    const me = playerVehicle(w);
    me.pos = nearestPad(yard, yard.pos);
    w.player.money = 0;
    const engine = makePart(w, 'stockEngine', 0);
    w.shops['salvage-yard'].stock = [engine];
    expect(stowPart(w, me, makePart(w, 'heavyMg', 0))).toBe(true);
    expect(partTradePrice(w, me, makePart(w, 'heavyMg', 0), 'sell')).toBeGreaterThan(partTradePrice(w, me, engine, 'buy'));
    const mountedBefore = mountedParts(me).map((p) => p.id);

    const turn = botOrders(w, 'trader');

    expect(mountedParts(playerVehicle(turn.world)).map((p) => p.id).sort()).toEqual([...mountedBefore, engine.id].sort());
  });

  it('has a broke stranded truck crawl on with its goal instead of waiting in town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.player.money = 0;
    for (const shop of Object.values(w.shops)) shop.stock = shop.stock.filter((p) => partDef(p.defId).kind !== 'engine');

    const turn = botOrders(w, 'hunter');

    expect(mountedParts(playerVehicle(turn.world), 'engine')).toHaveLength(0);
    expect(playerVehicle(turn.world).order?.kind).toBe('stopAt');
  });

  it('has a hunter with no foe in sight patrol on to a shop other than the one it stands at', () => {
    const w = withPrey(parkedAt('bowl'));
    const me = playerVehicle(w);
    me.order = null;

    const turn = botOrders(w, 'hunter');

    const order = playerVehicle(turn.world).order;
    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(Math.hypot(order.dest.x - me.pos.x, order.dest.y - me.pos.y)).toBeGreaterThan(20);
  });

  // It stopped to cool its engine on the way from the north to the Bowl pad, which dropped its order.
  it('has a hunter that lost its order between posts patrol on to a post ahead, not back the way it came', () => {
    const w = withPrey(emptyWorld({ x: 120, y: 368 }));
    const me = playerVehicle(w);
    me.heading = Math.atan2(442 - 368, 93 - 120);
    me.speed = 0;

    const order = playerVehicle(botOrders(w, 'hunter').world).order;

    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect((order.dest.x - me.pos.x) * Math.cos(me.heading) + (order.dest.y - me.pos.y) * Math.sin(me.heading)).toBeGreaterThan(0);
  });

  it('has a hunter scavenge while no raider is weak enough to hunt', () => {
    const order = (w: World, archetype: 'hunter' | 'scavenger') => playerVehicle(botOrders(w, archetype).world).order;

    expect(order(parkedAt('bowl'), 'hunter')).toEqual(order(parkedAt('bowl'), 'scavenger'));
    expect(order(withPrey(parkedAt('bowl')), 'hunter')).not.toEqual(order(parkedAt('bowl'), 'scavenger'));
  });

  it('has a scavenging hunter in town with more repair parts than it needs drive on', () => {
    const w = parkedAt('bowl');
    w.player.discovered = [];
    addGoods(w, playerVehicle(w), 'parts', 1);

    expect(playerVehicle(botOrders(w, 'hunter').world).order).not.toBeNull();
  });

  it('has a scavenging hunter that starts stripping a spare in town stay parked for the strip', () => {
    const w = parkedAt('bowl');
    w.player.discovered = [];
    expect(stowPart(w, playerVehicle(w), makePart(w, 'mg', 0))).toBe(true);

    const me = playerVehicle(botOrders(w, 'hunter').world);

    expect(me.job?.kind).toBe('strip');
    expect(me.order).toBeNull();
  });

  it('has a scavenging hunter that left town with more repair parts than it needs not drive back to sell them', () => {
    const site = town('bowl');
    const pad = nearestPad(site, site.pos);
    const out = dist(pad, site.pos);
    const w = emptyWorld({ x: pad.x + ((pad.x - site.pos.x) / out) * 10, y: pad.y + ((pad.y - site.pos.y) / out) * 10 });
    w.player.discovered = [];
    removeAllGoods(playerVehicle(w));
    addGoods(w, playerVehicle(w), 'parts', START_KITS.standard.cargo.parts! + 1);

    const order = playerVehicle(botOrders(w, 'hunter').world).order;

    expect(order?.kind).toBe('stopAt');
    expect(order?.kind === 'stopAt' && order.dest).not.toEqual(nearestPad(site, playerVehicle(w).pos));
  });

  it('has a broke hunter with no gun scavenge instead of patrol', () => {
    const armed = withPrey(parkedAt('bowl'));
    armed.player.money = 0;
    const unarmed = structuredClone(armed);
    const me = playerVehicle(unarmed);
    me.items = me.items.filter((it) => it.kind !== 'part' || !mountedParts(me, 'weapon').includes(it.part));

    const patrol = playerVehicle(botOrders(armed, 'hunter').world).order;
    const scavenge = playerVehicle(botOrders(unarmed, 'hunter').world).order;
    const scavenger = playerVehicle(botOrders(unarmed, 'scavenger').world).order;

    expect(scavenge).toEqual(scavenger);
    expect(scavenge).not.toEqual(patrol);
  });
});

describe('the hunter', () => {
  it('strips a knocked-out truck it is parked beside', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 });
    raider.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };

    const turn = botOrders(w, 'hunter');

    const job = playerVehicle(turn.world).job;
    expect(job?.kind).toBe('refit');
  });

  it('drives beside a knocked-out truck it sees that still has loot', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    raider.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };

    const turn = botOrders(w, 'hunter');

    const order = playerVehicle(turn.world).order;
    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(Math.hypot(order.dest.x - raider.pos.x, order.dest.y - raider.pos.y)).toBeLessThan(6);
  });

  it('has a trader run from a weak raider it can outrun and turn on one it cannot', () => {
    const attackedBy = (chassisId: string) => {
      const w = emptyWorld({ x: 30, y: 30 });
      const me = playerVehicle(w);
      me.speed = 0;
      const raider = addVehicle(w, 'raiders', chassisId, ['stockEngine'], { x: 36, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      startCombat(w, raider, me);
      const faster = vehicleStats(w, raider).maxSpeed >= vehicleStats(w, me).maxSpeed;
      const order = playerVehicle(botOrders(w, 'trader').world).order;
      const ran = order?.kind === 'stopAt' && pointsAway(me.pos, order.dest, raider.pos);
      return { faster, turned: order?.kind === 'stopAt' && dist(order.dest, raider.pos) < 1, ran };
    };
    const runs = Object.keys(CHASSIS).map(attackedBy);

    expect(runs.some((r) => r.faster) && runs.some((r) => !r.faster)).toBe(true);
    for (const r of runs) expect([r.turned, r.ran]).toEqual([r.faster, !r.faster]);
  });

  it('has a trader caught between two raiders run square to them, closing on neither', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.speed = 0;
    const raiders = [24, 36].map((x) => {
      const raider = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      return raider;
    });
    startCombat(w, raiders[1], me);

    const order = playerVehicle(botOrders(w, 'trader').world).order;

    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(order.dest.x).toBeCloseTo(30);
    expect(dist(order.dest, me.pos)).toBeGreaterThan(1);
  });

  // The raider dropped behind a ridge for a turn. Turning back to the trade route would drive into it again.
  // Its cargo sells better at Nose, so its goal leads away from Bowl, the nearest town.
  it('has a trader keep running for town while the combat lasts with the raider out of sight', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    me.pos = { x: me.pos.x + 10, y: me.pos.y };
    addGoods(w, me, 'electronics', 2);
    w.player.costBasis.electronics = 3333;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 300, y: 300 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(w, raider, me);

    const order = playerVehicle(botOrders(w, 'trader').world).order;

    expect(order).toEqual({ kind: 'stopAt', dest: nearestPad(nearestTown(w), me.pos) });
  });

  // The nearest town lies past the raider. Running there drives into its guns, so the bot runs away from it, as an NPC does.
  it('has a bot run from a stronger raider that blocks the nearest town to a town away from it', () => {
    const bowl = town('bowl');
    const pad = nearestPad(bowl, bowl.pos);
    const w = emptyWorld({ x: pad.x + 40, y: pad.y });
    const me = playerVehicle(w);
    me.speed = 0;
    const toBowl = dist(me.pos, bowl.pos);
    const between = { x: me.pos.x + ((bowl.pos.x - me.pos.x) / toBowl) * 8, y: me.pos.y + ((bowl.pos.y - me.pos.y) / toBowl) * 8 };
    const raider = addVehicle(w, 'raiders', 'wagon', ['cannon', 'heavyDiesel'], between);
    raider.brain = npcBrain('gunwagon', raider.pos, ['raider']);
    startCombat(w, raider, me);

    const order = playerVehicle(botOrders(w, 'trader').world).order;

    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(dist(order.dest, nearestPad(bowl, me.pos))).toBeGreaterThan(50);
    expect(pointsAway(me.pos, order.dest, raider.pos)).toBe(true);
  });

  // A hunter drove on toward a raider gunwagon it saw, and one tank gun shot at 9 tiles knocked it out.
  it('has a bot turn away from a stronger raider in sight before any fight starts', () => {
    const w = withPrey(emptyWorld({ x: 30, y: 30 }));
    const me = playerVehicle(w);
    const ahead = { x: me.pos.x + 12, y: me.pos.y };
    me.order = { kind: 'stopAt', dest: { x: me.pos.x + 60, y: me.pos.y } };
    const raider = addVehicle(w, 'raiders', 'wagon', ['cannon', 'heavyDiesel'], ahead);
    raider.brain = npcBrain('gunwagon', raider.pos, ['raider']);
    expect([hostileToPlayer(w, raider), playerSees(w, raider.pos)]).toEqual([true, true]);

    for (const archetype of ['hunter', 'trader'] as const) {
      const order = playerVehicle(botOrders(w, archetype).world).order;

      if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
      expect(pointsAway(me.pos, order.dest, raider.pos)).toBe(true);
    }
  });

  // A hauler ran back and forth for 40 turns from a crawling raider with no gun.
  it('has a bot drive on past a hostile it can beat', () => {
    const ordersWith = (raider: boolean) => {
      const w = emptyWorld({ x: 30, y: 30 });
      const me = playerVehicle(w);
      me.order = { kind: 'stopAt', dest: { x: me.pos.x + 60, y: me.pos.y } };
      if (raider) {
        const unarmed = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: me.pos.x + 12, y: me.pos.y });
        unarmed.brain = npcBrain('buggy', unarmed.pos, ['raider']);
        for (const p of mountedParts(unarmed, 'core')) if (p.defId.includes('transmission')) p.hp = 0;
        expect([hostileToPlayer(w, unarmed), playerSees(w, unarmed.pos), isStranded(w, unarmed)]).toEqual([true, true, true]);
      }
      return playerVehicle(botOrders(w, 'trader').world).order;
    };

    expect(ordersWith(true)).toEqual(ordersWith(false));
  });

  // The gunwagon dropped out of sight for a turn, and the trade route turned the bot back into its guns.
  // A new misjudgment each turn flipped the bot between running from a near-even gunwagon and driving on, so it stood
  // still for ten turns.
  it('has a bot judge the same foe the same way whatever the turn rolls', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.order = { kind: 'stopAt', dest: { x: me.pos.x + 60, y: me.pos.y } };
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'heavyDiesel'], { x: me.pos.x + 14, y: me.pos.y });
    raider.brain = npcBrain('gunwagon', raider.pos, ['raider']);
    // A near-even foe, so a fresh misjudgment can land on either side of running.
    expect(Math.abs(judgeDanger(w, me, raider) - 1)).toBeLessThan(NPC_BEHAVIOR.dangerSpread / 2);
    const orders = Array.from({ length: 12 }, (_, i) => {
      const x = structuredClone(w);
      x.rngState = Math.imul(i + 1, 2654435761);
      return playerVehicle(botOrders(x, 'trader').world).order;
    });

    for (const order of orders) expect(order).toEqual(orders[0]);
  });

  it('has a bot keep running while it hears a stronger raider it no longer sees', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    addGoods(w, me, 'electronics', 2);
    const raider = addVehicle(w, 'raiders', 'wagon', ['cannon', 'heavyDiesel'], { x: me.pos.x + 40, y: me.pos.y });
    raider.brain = npcBrain('gunwagon', raider.pos, ['raider']);
    w.player.contacts = [{ vehicleId: raider.id, center: { ...raider.pos }, radius: 5, sources: ['sound'], loudness: 1 }];
    const run = { kind: 'stopAt' as const, dest: { x: 1, y: me.pos.y } };
    me.order = run;
    expect(playerSees(w, raider.pos)).toBe(false);

    const turn = botOrders(w, 'trader');

    expect(playerVehicle(turn.world).order).toEqual(run);
  });

  // With no town away from it, the bot ran only as far as the foe stood and braked inside its guns.
  it('has a bot with no town away from a stronger raider run on past its guns', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.speed = 0;
    const raider = addVehicle(w, 'raiders', 'wagon', ['cannon', 'heavyDiesel'], { x: me.pos.x + 6, y: me.pos.y + 6 });
    raider.brain = npcBrain('gunwagon', raider.pos, ['raider']);
    startCombat(w, raider, me);

    const order = playerVehicle(botOrders(w, 'trader').world).order;

    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(pointsAway(me.pos, order.dest, raider.pos)).toBe(true);
    expect(dist(order.dest, raider.pos)).toBeGreaterThan(TERRAIN.vision.radius);
  });

  // A merc camps at the gate. No gate gun covers the bot there, and none punishes it, so it fires back as anywhere.
  it('has a bot at a town gate in combat fire back', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    for (const part of mountedParts(me)) part.hp = Math.floor(maxHp(part) / 4);
    w.player.money = 66667;
    const merc = addVehicle(w, 'mercs', 'van', ['mg', 'stockEngine'], { x: me.pos.x + 8, y: me.pos.y });
    merc.brain = npcBrain('merc', merc.pos, NPCS.merc.traits);
    startCombat(w, merc, me);

    const turn = botOrders(w, 'trader');

    expect(turn.world.player.autoFire).toBe(true);
  });

  it('has a bot out of combat drop the aim it set while auto fire was on', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    const merc = addVehicle(w, 'mercs', 'van', ['mg', 'stockEngine'], { x: me.pos.x + 8, y: me.pos.y });
    merc.brain = npcBrain('merc', merc.pos, NPCS.merc.traits);
    for (const mw of vehicleStats(w, me).weapons) me.weaponOrders[mw.part.id] = { targetId: merc.id, aim: 'body' };

    const turn = botOrders(w, 'trader');

    expect(playerVehicle(turn.world).weaponOrders).toEqual({});
  });

  it('has a hunter take the bounty on the board it is parked at, and a trader leave it', () => {
    const heldAfter = (archetype: 'hunter' | 'trader') => {
      const w = parkedAt('bowl');
      const target = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 300, y: 300 });
      target.brain = npcBrain('buggy', target.pos, ['raider']);
      w.shops.bowl.contracts = [{ id: 'ct-bounty', shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: 'Raider outrider', reward: 23333, deadline: 5000, window: 600, tier: 1, fulfilled: false }];
      return botOrders(w, archetype).world.player.contracts.map((c) => c.id);
    };

    expect(heldAfter('hunter')).toEqual(['ct-bounty']);
    expect(heldAfter('trader')).toEqual([]);
  });

  it('has a hunter take a bounty only on a raider type it would fight', () => {
    const heldWith = (template: string, chassis: string, parts: string[]) => {
      const w = parkedAt('bowl');
      const target = addVehicle(w, 'raiders', chassis, parts, { x: 300, y: 300 });
      target.brain = npcBrain(template, target.pos, ['raider']);
      w.shops.bowl.contracts = [{ id: 'ct-bounty', shop: 'bowl', kind: 'bounty', template, targetName: 'Raider', reward: 700, deadline: 5000, window: 600, tier: 1, fulfilled: false }];
      return botOrders(w, 'hunter').world.player.contracts.length;
    };

    expect(heldWith('buggy', 'buggy', ['stockEngine'])).toBe(1);
    expect(heldWith('gunwagon', 'wagon', ['cannon', 'heavyDiesel'])).toBe(0);
  });

  it('has a hunter take no bounty when no truck of the type is left', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [{ id: 'ct-bounty', shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: 'Raider', reward: 700, deadline: 5000, window: 600, tier: 1, fulfilled: false }];

    expect(botOrders(w, 'hunter').world.player.contracts).toEqual([]);
  });

  it('has a hunter hold its chase of a heard raider it would refuse on sight', () => {
    const orderFacing = (parts: string[]) => {
      const w = emptyWorld({ x: 30, y: 30 });
      playerVehicle(w).speed = 0;
      const raider = addVehicle(w, 'raiders', 'buggy', [...parts, 'stockEngine'], { x: 120, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      w.player.contacts = [{ vehicleId: raider.id, center: { ...raider.pos }, radius: 10, sources: ['sound'], loudness: 1 }];
      expect(playerSees(w, raider.pos)).toBe(false);
      return { w, order: playerVehicle(botOrders(w, 'hunter').world).order };
    };
    const weak = orderFacing([]);
    const strong = orderFacing(['mg', 'mg', 'mg', 'mg']);

    expect(weak.order).toEqual({ kind: 'stopAt', dest: { x: 120, y: 30 } });
    expect(strong.order?.kind === 'stopAt' && strong.order.dest.x === 120).toBe(false);
  });

  it('has a hunter strip a spare part for repair parts where a trader sells it', () => {
    const turnOf = (archetype: 'hunter' | 'trader') => {
      const w = parkedAt('bowl');
      expect(stowPart(w, playerVehicle(w), makePart(w, 'mg', 0))).toBe(true);
      return botOrders(w, archetype);
    };

    expect(playerVehicle(turnOf('hunter').world).job?.kind).toBe('strip');
    expect(turnOf('hunter').ledger.lootSales).toBe(0);
    expect(turnOf('trader').ledger.lootSales).toBeGreaterThan(0);
  });

  it('has an engineless hunter sell a spare for the engine money where it would otherwise strip it', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => !(it.kind === 'part' && partDef(it.part.defId).kind === 'engine'));
    expect(stowPart(w, me, makePart(w, 'mg', 0))).toBe(true);
    w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
    w.player.money = 0;

    const turn = botOrders(w, 'hunter');

    expect(turn.ledger.lootSales).toBeGreaterThan(0);
    expect(playerVehicle(turn.world).job?.kind).not.toBe('strip');
  });

  it('has a hunter leave a worn gun to field repair where a trader pays the garage', () => {
    const repairsOf = (archetype: 'hunter' | 'trader') => {
      const w = parkedAt('bowl');
      const gun = mountedParts(playerVehicle(w)).find((p) => partDef(p.defId).kind === 'weapon');
      if (!gun) throw new Error('The start truck mounts no gun');
      gun.hp = 1;
      return botOrders(w, archetype).ledger.repairs;
    };

    expect(repairsOf('hunter')).toBe(0);
    expect(repairsOf('trader')).toBeLessThan(0);
  });

  it('has a hauler take the haul on the board it is parked at before it trades', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [{ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'scrap', units: 3, to: 'nose', reward: 20000, deadline: 5000, window: 600, rush: false, tier: 2 }];

    expect(botOrders(w, 'hauler').world.player.contracts.map((c) => c.id)).toEqual(['ct-haul']);
  });

  it('has a climber with fewer than three guns haul, and take no bounty', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [
      { id: 'ct-bounty', shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: 'Raider outrider', reward: 23333, deadline: 5000, window: 600, tier: 1, fulfilled: false },
      { id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'scrap', units: 3, to: 'nose', reward: 20000, deadline: 5000, window: 600, rush: false, tier: 2 },
    ];

    expect(botOrders(w, 'climber').world.player.contracts.map((c) => c.id)).toEqual(['ct-haul']);
  });

  it('has a bot with a hot engine stop to cool, but keep driving while a raider fights it', () => {
    const hotAt = (fight: boolean) => {
      const w = emptyWorld({ x: 30, y: 30 });
      const me = playerVehicle(w);
      me.order = { kind: 'stopAt', dest: { x: 200, y: 30 } };
      w.player.engineHeat = 0.8;
      if (fight) {
        const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 60, y: 30 });
        raider.brain = npcBrain('buggy', raider.pos, ['raider']);
        startCombat(w, raider, me);
      }
      return playerVehicle(botOrders(w, 'trader').world).order;
    };

    expect(hotAt(false)).toBeNull();
    expect(hotAt(true)).not.toBeNull();
  });

  it('keeps a truck parked for heat until the engine is well below the warning', () => {
    const orderAt = (heat: number, driving: boolean) => {
      const w = emptyWorld({ x: 30, y: 30 });
      playerVehicle(w).order = driving ? { kind: 'stopAt', dest: { x: 200, y: 30 } } : null;
      w.player.engineHeat = heat;
      return playerVehicle(botOrders(w, 'trader').world).order;
    };
    const justBelowWarning = ENGINE_HEAT.warnAt - 0.02;

    expect(orderAt(justBelowWarning, false)).toBeNull();
    expect(orderAt(justBelowWarning, true)).not.toBeNull();
    expect(orderAt(ENGINE_HEAT.warnAt / 4, false)).not.toBeNull();
  });

  it('has a bot with a hot engine drive on while a hostile is in sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).order = { kind: 'stopAt', dest: { x: 200, y: 30 } };
    w.player.engineHeat = ENGINE_HEAT.warnAt + 0.05;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 45, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    expect([hostileToPlayer(w, raider), playerSees(w, raider.pos)]).toEqual([true, true]);

    expect(playerVehicle(botOrders(w, 'trader').world).order).not.toBeNull();
  });

  // The truck is faster than the raider on paper, but a dry tank leaves it a crawl, so it hands the cargo over.
  it('has a truck with a dry tank hand its cargo to a stronger raider it cannot outrun', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    addGoods(w, me, 'salt', 2);
    w.player.fuel = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['autocannon', 'ram', 'stockEngine'], { x: 36, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    expect(vehicleStats(w, me).maxSpeed).toBeGreaterThan(vehicleStats(w, raider).maxSpeed);
    startCombat(w, raider, me);
    w.player.call = { with: raider.id, topic: 'demand', node: 'demand', vars: {}, line: { text: 'Dump your cargo and roll on.', vars: {} } };

    expect(goodsCount(playerVehicle(botOrders(w, 'trader').world)).salt ?? 0).toBe(0);
  });

  it('has a fleeing bot that loses sight of its foe keep running the same way', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    const raider = addVehicle(w, 'raiders', 'buggy', ['autocannon', 'ram', 'stockEngine'], { x: 300, y: 300 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(w, raider, me);
    expect(playerSees(w, raider.pos)).toBe(false);
    me.order = { kind: 'stopAt', dest: { x: 5, y: 5 } };

    expect(playerVehicle(botOrders(w, 'trader').world).order).toEqual({ kind: 'stopAt', dest: { x: 5, y: 5 } });
  });

  it('has a hunter that loses sight of a foe it would not hunt keep running the same way', () => {
    const w = withPrey(emptyWorld({ x: 30, y: 30 }));
    const me = playerVehicle(w);
    const raider = addVehicle(w, 'raiders', 'buggy', ['autocannon', 'ram', 'stockEngine'], { x: 300, y: 300 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(w, raider, me);
    expect(playerSees(w, raider.pos)).toBe(false);
    me.order = { kind: 'stopAt', dest: { x: 5, y: 5 } };

    expect(playerVehicle(botOrders(w, 'hunter').world).order).toEqual({ kind: 'stopAt', dest: { x: 5, y: 5 } });
  });

  // The grid is full of a haul's goods the hunter may not sell, and it stands in town with nothing to sell.
  it('has a hunter with a full grid in town go on patrol instead of idling', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    addGoods(w, me, 'scrap', 100);
    const units = goodsCount(me).scrap;
    w.player.contracts = [{ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'scrap', units, to: 'nose', reward: 600, deadline: 5000, window: 600, rush: false, tier: 2 }];
    expect(freeCells(me)).toBe(0);

    expect(playerVehicle(botOrders(w, 'hunter').world).order).not.toBeNull();
  });

  // A raider demands the cargo. A trader too slow to get away hands it to a stronger raider and refuses a weaker one.
  it('has a trader hand its cargo only to a raider that outmatches it', () => {
    const demandedBy = (weapons: string[]) => {
      const w = emptyWorld({ x: 30, y: 30 });
      const me = playerVehicle(w);
      addGoods(w, me, 'salt', 2);
      for (const wheel of mountedParts(me).filter((p) => p.defId.includes('wheel'))) wheel.hp = 0;
      const raider = addVehicle(w, 'raiders', 'buggy', [...weapons, 'stockEngine'], { x: 36, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      expect(vehicleStats(w, raider).maxSpeed).toBeGreaterThanOrEqual(vehicleStats(w, me).maxSpeed);
      startCombat(w, raider, me);
      w.player.call = { with: raider.id, topic: 'demand', node: 'demand', vars: {}, line: { text: 'Dump your cargo and roll on.', vars: {} } };
      return goodsCount(playerVehicle(botOrders(w, 'trader').world)).salt ?? 0;
    };

    expect(demandedBy(['autocannon', 'ram'])).toBe(0);
    expect(demandedBy([])).toBeGreaterThan(0);
  });

  // A raider offers to strip the stranded truck. The bot gives up its gear only to a raider that outmatches it, and
  // fights on against one its guns already disarmed.
  it('has a stranded bot accept a strip offer only from a raider that outmatches it', () => {
    const offeredBy = (weapons: string[]) => {
      const w = emptyWorld({ x: 30, y: 30 });
      const me = playerVehicle(w);
      addGoods(w, me, 'salt', 2);
      for (const wheel of mountedParts(me).filter((p) => p.defId.includes('wheel'))) wheel.hp = 0;
      const raider = addVehicle(w, 'raiders', 'buggy', [...weapons, 'stockEngine'], { x: 36, y: 30 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      startCombat(w, raider, me);
      w.player.call = { with: raider.id, topic: 'surrender', node: 'offer', vars: {}, line: { text: 'Your truck is dead.', vars: {} } };
      return goodsCount(playerVehicle(botOrders(w, 'trader').world)).salt ?? 0;
    };

    expect(offeredBy(['autocannon', 'ram'])).toBe(0);
    expect(offeredBy([])).toBeGreaterThan(0);
  });

  // A breakdown on the road needs parts for a field patch, so the bot keeps the start kit's stock of them.
  it('has a bot in town top up its repair parts to the standard kit stock before buying gear', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    w.player.money = 2000;
    removeAllGoods(me);
    const want = START_KITS.standard.cargo.parts ?? 0;
    expect(want).toBeGreaterThan(0);

    const turn = botOrders(w, 'trader');

    expect(goodsCount(playerVehicle(turn.world)).parts).toBe(want);
    expect(turn.ledger.repairs).toBeLessThan(0);
  });

  it('drives at the weaker of two raiders in sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const strong = addVehicle(w, 'raiders', 'buggy', ['mg', 'mg', 'stockEngine'], { x: 30, y: 42 });
    const weak = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 42, y: 30 });
    for (const raider of [strong, weak]) raider.brain = npcBrain('buggy', raider.pos, ['raider']);

    const turn = botOrders(w, 'hunter');

    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: weak.pos });
  });

  it('leaves the world random stream where it was', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    playerVehicle(w).speed = 0;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const state = w.rngState;

    const turn = botOrders(w, 'hunter');

    expect(turn.world.rngState).toBe(state);
  });
});

describe('the markov bot', () => {
  it('needs a stretch length', () => {
    expect(() => botOrders(parkedAt('bowl'), 'markov')).toThrow(/markovTurns/);
  });

  it('plays a goal without shifting the world random stream', () => {
    const w = saltGlut(parkedAt('nose'));
    const state = w.rngState;

    const turn = botOrders(w, 'markov', { markovTurns: 10 });

    expect(turn.world.rngState).toBe(state);
  });

  it('draws the same goal for the same seed and stretch', () => {
    const a = botOrders(saltGlut(parkedAt('nose')), 'markov', { markovTurns: 10 });
    const b = botOrders(saltGlut(parkedAt('nose')), 'markov', { markovTurns: 10 });

    expect(b.world.player.money).toBe(a.world.player.money);
    expect(playerVehicle(b.world).order).toEqual(playerVehicle(a.world).order);
  });
});

describe('the fast trader', () => {
  it('buys a faster chassis and no armor with money to spare', () => {
    const w = parkedAt('bowl');
    w.player.money = 6_666_667;
    const before = playerVehicle(w);
    const armor = mountedParts(before, 'armor').length;

    const turn = botOrders(w, 'fastTrader');

    const after = playerVehicle(turn.world);
    expect(chassisDef(after.chassisId).maxSpeed).toBeGreaterThan(chassisDef(before.chassisId).maxSpeed);
    expect(mountedParts(after, 'armor').length).toBeLessThanOrEqual(armor);
  });
});

// ---- Robbery.

// A trader in the player's sight, at peace, with goods on its grid and a goal line that says it carries cargo.
function addTrader(w: World, pos: Vec, parts: string[] = ['stockEngine']): Vehicle {
  const v = addVehicle(w, 'traders', 'hauler', parts, pos);
  v.brain = npcBrain('trader', pos, ['trader']);
  v.brain.goals = [{ kind: 'sell', targetId: 'nose', destination: { ...town('nose').pos }, phase: 'travel', reason: 'deliver purchased cargo' }];
  if (addGoods(w, v, 'electronics', 4) < 4) throw new Error('No room for trader cargo');
  return v;
}

// A supply convoy on its way to load cargo, and a convoy guard escorting it, both beside it.
function addGuardedConvoy(w: World, pos: Vec): { convoy: Vehicle; guard: Vehicle } {
  const convoy = addVehicle(w, 'convoys', 'hauler', ['stockEngine'], pos);
  convoy.brain = npcBrain('convoy', pos, ['supplier']);
  convoy.brain.goals = [{ kind: 'haul', targetId: 'nose', destination: { ...town('nose').pos }, phase: 'travel', reason: 'load cargo at its source' }];
  if (addGoods(w, convoy, 'water', 4) < 4) throw new Error('No room for convoy cargo');
  const guardPos = { x: pos.x, y: pos.y + 3 };
  const guard = addVehicle(w, 'convoys', 'scout', ['mg', 'stockEngine'], guardPos);
  guard.brain = npcBrain('convoyGuard', guardPos, ['guard', 'brave']);
  startEscort(w, guard, convoy, null, 0);
  return { convoy, guard };
}

function radioed(turn: { events: GameEvent[] }, target: Vehicle): boolean {
  return turn.events.some((e) => e.t === 'call' && e.with === target.id && e.outcome === 'opened');
}

// The player parked in open ground away from towns, with the scout kit's one machine gun.
function robberWorld(): World {
  const w = emptyWorld({ x: 60, y: 60 });
  playerVehicle(w).speed = 0;
  w.player.discovered = ['bowl', 'nose'];
  return w;
}

describe('botOrders for robbers', () => {
  it('does not radio a loaded trader out of sight', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 160, y: 60 });
    expect(playerSees(w, trader.pos)).toBe(false);

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, trader)).toBe(false);
  });

  it('radios a loaded trader in sight', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 64, y: 60 });
    expect(playerSees(w, trader.pos)).toBe(true);

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, trader)).toBe(true);
    expect(turn.world.player.talked[trader.id]?.rob).toBeDefined();
  });

  it('radios a trader whose goal line says it sells carried cargo, and skips one going for repairs', () => {
    const w = robberWorld();
    const seller = addTrader(w, { x: 64, y: 60 });
    seller.brain!.goals[0].reason = 'sell carried cargo';
    expect(radioed(botOrders(w, 'robber'), seller)).toBe(true);
    seller.brain!.goals[0].reason = 'needs repairs';
    expect(radioed(botOrders(w, 'robber'), seller)).toBe(false);
  });

  it('skips a trader with more guns than the player', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 64, y: 60 }, ['mg', 'mg', 'stockEngine']);

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, trader)).toBe(false);
  });

  it('skips a convoy whose guard is in sight', () => {
    const w = robberWorld();
    const { convoy } = addGuardedConvoy(w, { x: 64, y: 60 });

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, convoy)).toBe(false);
  });

  it('has the convoy robber radio a guarded convoy', () => {
    const w = robberWorld();
    const { convoy } = addGuardedConvoy(w, { x: 64, y: 60 });

    const turn = botOrders(w, 'convoyRobber');

    expect(radioed(turn, convoy)).toBe(true);
  });

  it('notes the answer of a demand', () => {
    forceOption('threatened', 'comply');
    const w = robberWorld();
    w.rngState = rngStateForForcedRolls(4);
    const trader = addTrader(w, { x: 62, y: 60 });

    const turn = botOrders(w, 'robber');

    expect(turn.notes).toContainEqual({ kind: 'demand', target: trader.id, answer: 'comply', guarded: false });
  });

  it('searches the pile a complying trader drops, then takes it', () => {
    forceOption('threatened', 'comply');
    const w = robberWorld();
    w.rngState = rngStateForForcedRolls(4);
    const trader = addTrader(w, { x: 61.5, y: 60 });

    const demanded = botOrders(w, 'robber');
    const pile = demanded.world.salvage.find((s) => s.pile && s.goods.electronics);
    if (!pile) throw new Error('The trader dropped no pile');
    expect(playerVehicle(demanded.world).job).toMatchObject({ kind: 'search', stockId: pile.id });

    const searched = cloneWorld(demanded.world);
    playerVehicle(searched).job = null;
    searched.player.scavenged.push(pile.id);
    const looted = botOrders(searched, 'robber');

    expect(goodsCount(playerVehicle(looted.world)).electronics).toBe(4);
    expect(goodsCount(vehicleById(looted.world, trader.id)).electronics).toBeUndefined();
  });
});

describe('the convoy robber patrol', () => {
  it('runs between the sites supply convoys haul between', () => {
    expect(CONVOY_ROB_PATROL).toEqual([...TRAITS.supplier.haulSites, ...TRAITS.supplier.towns]);
  });

  it('drives to the nearest of them with no target in sight', () => {
    const w = robberWorld();
    const order = playerVehicle(botOrders(w, 'convoyRobber').world).order;
    if (order?.kind !== 'stopAt') throw new Error(`The convoy robber gave order ${order?.kind}`);
    const near = CONVOY_ROB_PATROL.map(getKnownSite).sort((a, b) => dist(w.vehicles[0].pos, a.pos) - dist(w.vehicles[0].pos, b.pos))[0];
    expect(dist(order.dest, nearestPad(near, playerVehicle(w).pos))).toBeLessThan(1e-6);
  });
});

describe('wouldRob', () => {
  it('takes a loaded trader out of sight that robTarget cannot see', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 160, y: 60 });
    expect(wouldRob(w, trader)).toBe(true);
    expect(robTarget(w, true)).toBeNull();
  });

  it('skips a trader with more guns than the player', () => {
    const w = robberWorld();
    expect(wouldRob(w, addTrader(w, { x: 160, y: 60 }, ['mg', 'mg', 'stockEngine']))).toBe(false);
  });
});

describe('haulMarginAt', () => {
  it('with no money left is the cheapest haul fuel lost', () => {
    const w = robberWorld();
    const me = playerVehicle(w);
    const fuels = REGION.towns.flatMap((a) => REGION.towns.filter((b) => b.id !== a.id).map((b) => tripFuelCost(w, me, dist(a.pos, b.pos))));
    expect(haulMarginAt(w, 0, 20)).toBeCloseTo(-Math.min(...fuels), 9);
  });

  it('grows with the money and room of the load', () => {
    const w = robberWorld();
    expect(haulMarginAt(w, 66667, 20)).toBeGreaterThan(haulMarginAt(w, 6667, 20));
    expect(haulMarginAt(w, 66667, 20)).toBeGreaterThan(haulMarginAt(w, 66667, 2));
  });
});
