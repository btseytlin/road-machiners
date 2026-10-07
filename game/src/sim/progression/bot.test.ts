import { PRESSURE_MAX } from '../../data/market';
import type { GameEvent, Vehicle, World } from '../types';
import { describe, expect, it } from 'vitest';
import { CHASSIS, chassisDef } from '../../data/chassis';
import { REGION } from '../../data/region';
import { partDef } from '../../data/parts';
import { SHOPS } from '../../data/market';
import { CONDITION } from '../../data/wear';
import { playerVehicle, vehicleById } from '../damage';
import { makePart } from '../factory';
import { goodsCount, mountedParts } from '../grid';
import { addGoods, mountPart, removeAllGoods, stowPart } from '../inventory';
import { siteOf } from '../market';
import { nearestPad, nearestTown } from '../sites';
import { isStranded, vehicleStats } from '../stats';
import { dist, type Vec } from '../vec';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls, startCombat, testDrive } from '../testkit';
import { NPCS, TRAITS } from '../../data/npcs';
import { towData } from '../states';
import { playerTow, startEscort } from '../tow';
import { playerSees } from '../vision';
import { cloneWorld, endTurn } from '../world';
import { getTradePrice, partTradePrice, repairCost } from '../economy';
import { getKnownSite, getUpkeepReserve, tripFuelCost } from '../npc-decisions';
import { maxHp } from '../wear';
import { botOrders, CONVOY_ROB_PATROL, haulMarginAt, robTarget, wouldRob } from './bot';

function town(id: string) {
  const found = REGION.towns.find((t) => t.id === id);
  if (!found) throw new Error(`No town ${id}`);
  return found;
}

// An empty world with the player parked on a pad of a town, its cargo gone, and both towns known.
function parkedAt(id: string) {
  const site = town(id);
  const w = emptyWorld(nearestPad(site, site.pos));
  const me = playerVehicle(w);
  removeAllGoods(me);
  me.speed = 0;
  w.player.discovered = ['bowl', 'nose'];
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

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
    expect(turn.world.player.money).toBeLessThan(w.player.money);
  });

  // It arrives broke with a damaged truck and electronics both towns pay well for, so service repairs nothing before
  // the sale here, and salt is the load to buy after it.
  it('has a trader keep the repair bill out of the load it buys after a sale', () => {
    const w = saltGlut(parkedAt('nose'));
    w.shops.nose.pressure.electronics = PRESSURE_MAX;
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

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
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
    w.salvage.push({ id: 'wreck-beside', pos: { x: 31.5, y: 30 }, radius: 0.6, goods: { scrap: 2 }, parts: [] });
    startCombat(w, addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }), me);

    const turn = botOrders(w, 'scavenger');

    expect(playerVehicle(turn.world).job).toBeNull();
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

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
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

  // A stall buys spares but takes no part off the truck, so the mounted gear stays. It hands a bought engine over
  // loose, and the scout has no free cargo spot that holds one.
  it('has a broke truck without an engine at a stall keep its mounted gear', () => {
    const yard = siteOf('salvage-yard');
    const w = withoutEngine(parkedAt('bowl'));
    const me = playerVehicle(w);
    me.pos = nearestPad(yard, yard.pos);
    w.player.money = 0;
    w.shops['salvage-yard'].stock = [makePart(w, 'stockEngine', 0)];
    expect(stowPart(w, me, makePart(w, 'heavyMg', 0))).toBe(true);
    expect(partTradePrice(w, me, makePart(w, 'heavyMg', 0), 'sell')).toBeGreaterThan(partTradePrice(w, me, w.shops['salvage-yard'].stock[0], 'buy'));
    const mountedBefore = mountedParts(me).map((p) => p.id);

    const turn = botOrders(w, 'trader');

    expect(mountedParts(playerVehicle(turn.world)).map((p) => p.id)).toEqual(mountedBefore);
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
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    me.order = null;

    const turn = botOrders(w, 'hunter');

    const order = playerVehicle(turn.world).order;
    if (order?.kind !== 'stopAt') throw new Error('Expected a stop order');
    expect(Math.hypot(order.dest.x - me.pos.x, order.dest.y - me.pos.y)).toBeGreaterThan(20);
  });

  it('has a broke hunter with no gun scavenge instead of patrol', () => {
    const armed = parkedAt('bowl');
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
      const toTown = nearestPad(nearestTown(w), me.pos);
      return { faster, turned: order?.kind === 'stopAt' && dist(order.dest, raider.pos) < 1, ran: order?.kind === 'stopAt' && dist(order.dest, toTown) < 1 };
    };
    const runs = Object.keys(CHASSIS).map(attackedBy);

    expect(runs.some((r) => r.faster) && runs.some((r) => !r.faster)).toBe(true);
    for (const r of runs) expect([r.turned, r.ran]).toEqual([r.faster, !r.faster]);
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

  // A merc camps at the gate. Firing from town makes the guard shoot the bot, so it holds fire and repairs instead.
  it('has a bot at a town gate in combat hold its fire and repair', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    for (const part of mountedParts(me)) part.hp = Math.floor(maxHp(part) / 4);
    w.player.money = 66667;
    const merc = addVehicle(w, 'mercs', 'van', ['mg', 'stockEngine'], { x: me.pos.x + 8, y: me.pos.y });
    merc.brain = npcBrain('merc', merc.pos, NPCS.merc.traits);
    startCombat(w, merc, me);

    const turn = botOrders(w, 'trader');

    expect(turn.world.player.autoFire).toBe(false);
    expect(turn.ledger.repairs).toBeLessThan(0);
  });

  it('has a bot at a town gate drop the aim it set while auto fire was on', () => {
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    const merc = addVehicle(w, 'mercs', 'van', ['mg', 'stockEngine'], { x: me.pos.x + 8, y: me.pos.y });
    merc.brain = npcBrain('merc', merc.pos, NPCS.merc.traits);
    startCombat(w, merc, me);
    for (const mw of vehicleStats(w, me).weapons) me.weaponOrders[mw.part.id] = { targetId: merc.id, aim: 'body' };

    const turn = botOrders(w, 'trader');

    expect(playerVehicle(turn.world).weaponOrders).toEqual({});
  });

  it('has a hunter take the bounty on the board it is parked at, and a trader leave it', () => {
    const heldAfter = (archetype: 'hunter' | 'trader') => {
      const w = parkedAt('bowl');
      w.shops.bowl.contracts = [{ id: 'ct-bounty', shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: 'Raider outrider', reward: 23333, deadline: 5000, window: 600, tier: 1 }];
      return botOrders(w, archetype).world.player.contracts.map((c) => c.id);
    };

    expect(heldAfter('hunter')).toEqual(['ct-bounty']);
    expect(heldAfter('trader')).toEqual([]);
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
      { id: 'ct-bounty', shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: 'Raider outrider', reward: 23333, deadline: 5000, window: 600, tier: 1 },
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
    expect(haulMarginAt(w, 2000, 20)).toBeGreaterThan(haulMarginAt(w, 200, 20));
    expect(haulMarginAt(w, 2000, 20)).toBeGreaterThan(haulMarginAt(w, 2000, 2));
  });
});
