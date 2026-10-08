import { describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { ECONOMY, GOODS } from '../data/goods';
import { NPC_UPKEEP, NPCS, STATE_TURNS } from '../data/npcs';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { canTradeWith, inMeetingReach, partTradePrice, playerTrades, truckPartPrice } from './economy';
import { makePart } from './factory';
import { freeCells, goodsCount } from './grid';
import { addGoods, spareParts, stowPart } from './inventory';
import { topGoal } from './npc-activities';
import { addState, stateOf } from './states';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import {
  buyTruckGood, buyTruckPart, buyTruckSupply, endTrade, sellTruckGood, sellTruckPart, startTrade, tradeReady,
  truckGoodPrice, truckGoodsForSale, truckSupplyForSale, truckSupplyPrice,
} from './economy';
import type { GameEvent, Vehicle, World } from './types';
import { endTurn, update } from './world';

// A trader in the open, the given distance east of a parked player. No other trucks spawn.
function withTrader(x: number): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x, y: 30 }, Math.PI);
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  return { w, npc };
}

function find(w: World, id: string): Vehicle {
  return w.vehicles.find((v) => v.id === id)!;
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !done(w); i++) {
    w = endTurn(w, testDrive);
    events.push(...w.events);
  }
  return { w, events };
}

function agreed(start: World, npcId: string): World {
  return update(start, (w) => startTrade(w, find(w, npcId)));
}

describe('trade meeting', () => {
  it('the driver drives over and parks beside the player', () => {
    const { w: start, npc } = withTrader(50);
    let w = agreed(start, npc.id);
    expect(tradeReady(w)).toBeNull();
    w = runUntil(w, 40, (x) => tradeReady(x) !== null).w;
    expect(tradeReady(w)?.id).toBe(npc.id);
    expect(find(w, npc.id).speed).toBeLessThanOrEqual(RULES.parkedSpeed);
  });

  it('a moving player cannot trade even beside the driver', () => {
    const { w: start, npc } = withTrader(50);
    let w = runUntil(agreed(start, npc.id), 40, (x) => tradeReady(x) !== null).w;
    w = update(w, (d) => { playerVehicle(d).speed = RULES.parkedSpeed + 0.1; });
    expect(tradeReady(w)).toBeNull();
    expect(() => endTrade(w, npc.id)).toThrow('parked side by side');
  });

  it('a meeting that never comes together lapses', () => {
    const { w: start, npc } = withTrader(80);
    // The state alone, with no meet goal, so the driver never comes.
    const w0 = update(start, (w) => { addState(w, 'trade', npc.id, w.player.vehicleId, { kind: 'none' }); });
    const r = runUntil(w0, STATE_TURNS.trade! + 2, (x) => stateOf(x, 'trade', npc.id, x.player.vehicleId) === null);
    expect(r.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'expired' }));
  });

  it('a feud breaks the meeting, and the driver stops coming', () => {
    const { w: start, npc } = withTrader(60);
    let w = agreed(start, npc.id);
    w = update(w, (d) => { addState(d, 'feud', npc.id, d.player.vehicleId, { kind: 'feud', robbery: false }); });
    const r = runUntil(w, 3, (x) => stateOf(x, 'trade', npc.id, x.player.vehicleId) === null);
    expect(r.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'broken' }));
    expect(topGoal(find(endTurn(r.w, testDrive), npc.id))?.kind).not.toBe('meet');
  });

  it('ending the trade frees the driver', () => {
    const { w: start, npc } = withTrader(50);
    let w = runUntil(agreed(start, npc.id), 40, (x) => tradeReady(x) !== null).w;
    w = endTrade(w, npc.id);
    expect(stateOf(w, 'trade', npc.id, w.player.vehicleId)).toBeNull();
    expect(topGoal(find(endTurn(w, testDrive), npc.id))?.kind).not.toBe('meet');
  });
});

describe('trades', () => {
  // A trader parked beside a parked player, with a trade agreed.
  function meeting(): { w: World; npc: Vehicle } {
    const { w: start, npc } = withTrader(34);
    const w = agreed(start, npc.id);
    if (tradeReady(w)?.id !== npc.id) throw new Error('The test trader is not in reach');
    return { w, npc };
  }

  function wallets(w: World, npcId: string): number {
    return w.player.money + find(w, npcId).resources!.money;
  }

  it('buying a good moves it to the player, pays the driver and keeps money whole', () => {
    const { w: start, npc } = meeting();
    const w0 = update(start, (w) => { addGoods(w, find(w, npc.id), 'salt', 3); });
    const price = truckGoodPrice(w0, 'salt', 'buy');
    const w = buyTruckGood(w0, npc.id, 'salt', 2);
    expect(w.player.money).toBe(w0.player.money - 2 * price);
    expect(wallets(w, npc.id)).toBe(wallets(w0, npc.id));
    expect(goodsCount(playerVehicle(w)).salt).toBe(2);
    expect(goodsCount(find(w, npc.id)).salt).toBe(1);
    expect(w.player.costBasis.salt).toBe(price);
  });

  it('selling a good pays the player from the driver wallet', () => {
    const { w: start, npc } = meeting();
    const w0 = update(start, (w) => { addGoods(w, playerVehicle(w), 'meds', 2); });
    const price = truckGoodPrice(w0, 'meds', 'sell');
    const w = sellTruckGood(w0, npc.id, 'meds', 2);
    expect(w.player.money).toBe(w0.player.money + 2 * price);
    expect(wallets(w, npc.id)).toBe(wallets(w0, npc.id));
    expect(goodsCount(find(w, npc.id)).meds).toBe(2);
  });

  it('a driver without the money buys nothing', () => {
    const { w: start, npc } = meeting();
    const w0 = update(start, (w) => {
      addGoods(w, playerVehicle(w), 'meds', 1);
      find(w, npc.id).resources!.money = 0;
    });
    expect(() => sellTruckGood(w0, npc.id, 'meds', 1)).toThrow('cannot pay');
  });

  it('a driver keeps its field repair parts', () => {
    const { w: start, npc } = meeting();
    const w0 = update(start, (w) => { addGoods(w, find(w, npc.id), 'parts', NPC_UPKEEP.repairParts + 1); });
    expect(truckGoodsForSale(find(w0, npc.id), 'parts')).toBe(1);
    expect(() => buyTruckGood(w0, npc.id, 'parts', 2)).toThrow('will not sell');
  });

  it('parts trade both ways at the road part prices, wider than a shop', () => {
    const { w: start, npc } = meeting();
    const w0 = update(start, (w) => { stowPart(w, find(w, npc.id), makePart(w, 'mg', 1)); });
    const part = spareParts(find(w0, npc.id))[0];
    const buy = truckPartPrice(w0, part, 'buy');
    expect(buy).toBeGreaterThan(partTradePrice(w0, playerVehicle(w0), part, 'buy'));
    const w1 = buyTruckPart(w0, npc.id, part.id);
    expect(w1.player.money).toBe(w0.player.money - buy);
    expect(spareParts(playerVehicle(w1)).map((p) => p.id)).toContain(part.id);
    const sell = truckPartPrice(w1, part, 'sell');
    expect(sell).toBeLessThan(partTradePrice(w1, playerVehicle(w1), part, 'sell'));
    const w2 = sellTruckPart(w1, npc.id, part.id);
    expect(w2.player.money).toBe(w1.player.money + sell);
    expect(spareParts(find(w2, npc.id)).map((p) => p.id)).toContain(part.id);
    expect(wallets(w2, npc.id)).toBe(wallets(w0, npc.id));
  });

  it('a part with no room on the player truck stays with the driver', () => {
    const { w: start, npc } = meeting();
    const w0 = update(start, (w) => {
      stowPart(w, find(w, npc.id), makePart(w, 'mg', 0));
      const me = playerVehicle(w);
      addGoods(w, me, 'scrap', freeCells(me));
    });
    const part = spareParts(find(w0, npc.id))[0];
    expect(() => buyTruckPart(w0, npc.id, part.id)).toThrow('No room');
  });

  it('the driver sells fuel only above its reserve', () => {
    const { w: start, npc } = meeting();
    const cap = chassisDef(npc.chassisId).fuelCap;
    const w0 = update(start, (w) => {
      find(w, npc.id).resources!.fuel = cap * NPC_UPKEEP.tradeReserve + 5;
      w.player.fuel = 0;
    });
    expect(truckSupplyForSale(find(w0, npc.id), 'fuel')).toBe(5);
    expect(() => buyTruckSupply(w0, npc.id, 'fuel', 6)).toThrow('will not sell');
    const w = buyTruckSupply(w0, npc.id, 'fuel', 5);
    expect(w.player.fuel).toBe(5);
    expect(w.player.money).toBe(w0.player.money - 5 * truckSupplyPrice(w0, 'fuel'));
    expect(find(w, npc.id).resources!.fuel).toBe(cap * NPC_UPKEEP.tradeReserve);
  });

  it('a truck trades goods at the road spread around their value', () => {
    const { w } = meeting();
    const value = GOODS.scrap.value;
    const margin = ECONOMY.spread + ECONOMY.roadSpread;
    expect(truckGoodPrice(w, 'scrap', 'buy')).toBe(Math.ceil(value * (1 + margin)));
    expect(truckGoodPrice(w, 'scrap', 'sell')).toBe(Math.floor(value * (1 - margin)));
  });

  it('a truck charges more for fuel than a town', () => {
    const { w } = meeting();
    expect(truckSupplyPrice(w, 'fuel')).toBeGreaterThan(ECONOMY.supplyPrice.fuel);
  });

  it('no trade runs without an agreed meeting', () => {
    const { w: start, npc } = withTrader(34);
    const w0 = update(start, (w) => { addGoods(w, find(w, npc.id), 'salt', 1); });
    expect(() => buyTruckGood(w0, npc.id, 'salt', 1)).toThrow('No trade agreed');
  });
});

describe('trade reach', () => {
  it('tells which driver the player can trade with and keeps reach apart from parking', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const far = addVehicle(w, 'traders', 'scout', [], { x: 90, y: 30 });
    const near = addVehicle(w, 'traders', 'scout', [], { x: 34, y: 30 });
    const a = addState(w, 'trade', far.id, w.player.vehicleId, { kind: 'none' });
    const b = addState(w, 'trade', near.id, w.player.vehicleId, { kind: 'none' });
    expect(playerTrades(w)).toHaveLength(2);
    expect(inMeetingReach(w, a)).toBe(false);
    expect(inMeetingReach(w, b)).toBe(true);
    expect(canTradeWith(w, far.id)).toBe(false);
    expect(canTradeWith(w, near.id)).toBe(true);
    near.speed = RULES.parkedSpeed + 1;
    expect(inMeetingReach(w, b)).toBe(true);
    expect(canTradeWith(w, near.id)).toBe(false);
  });
});
