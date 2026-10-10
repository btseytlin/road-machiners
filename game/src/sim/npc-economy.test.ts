import { maxHp, partValue } from './wear';
import { describe, expect, it } from 'vitest';
import * as economy from './economy';
import { addVehicle, emptyWorld } from './testkit';
import { REGION } from '../data/region';
import { ECONOMY } from '../data/goods';
import { corePart, goodsCount } from './grid';
import { sitePads } from './sites';
import { partDef } from '../data/parts';
import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';

describe('NPC transactions', () => {
  it('pays to repair the built-in cab without selling it', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], sitePads(REGION.towns[0])[0]);
    const cab = corePart(npc, 'cab');
    cab.hp -= 2;
    npc.resources!.money = Math.ceil((2 * ECONOMY.repairShare * partValue(cab)) / maxHp(cab));
    npc.resources!.fuel = chassisDef(npc.chassisId).fuelCap;
    npc.resources!.supplies = RULES.baseSupplies;
    economy.serviceVehicle(w, npc, 'bowl', 0);
    expect(corePart(npc, 'cab').id).toBe(cab.id);
    expect(cab.hp).toBe(partDef(cab.defId).hp);
    expect(npc.resources!.money).toBe(0);
  });

  it('rejects an unaffordable purchase without partial effects', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', [], sitePads(REGION.towns[0])[0]);
    npc.resources!.money = 1;
    const before = structuredClone(npc);
    expect(() => economy.tradeGoods(w, npc, 'bowl', 'scrap', 2, 'buy')).toThrow('Refused: noMoney');
    expect(npc).toEqual(before);
  });

  it('buys and sells real cargo without spending player money', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], sitePads(REGION.towns[0])[0]);
    const money = npc.resources!.money;
    const playerMoney = w.player.money;
    expect(economy.tradeGoods).toBeTypeOf('function');
    const buy = economy.getLotTradePrice(w, npc, 'bowl', 'scrap', 2, 'buy');
    economy.tradeGoods(w, npc, 'bowl', 'scrap', 2, 'buy');
    expect(goodsCount(npc).scrap).toBe(2);
    expect(npc.resources!.money).toBe(money - buy);
    const sell = economy.getLotTradePrice(w, npc, 'bowl', 'scrap', 2, 'sell');
    economy.tradeGoods(w, npc, 'bowl', 'scrap', 2, 'sell');
    expect(goodsCount(npc).scrap ?? 0).toBe(0);
    expect(npc.resources!.money).toBe(money - buy + sell);
    expect(w.player.money).toBe(playerMoney);
  });

  it('rejects remote transactions without changing inventory or money', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', [], { x: 30, y: 30 });
    expect(economy.tradeGoods).toBeTypeOf('function');
    const before = structuredClone(npc);
    expect(() => economy.tradeGoods(w, npc, 'bowl', 'scrap', 1, 'buy')).toThrow('gate');
    expect(npc).toEqual(before);
  });

  it('buys only affordable fuel before other service', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], sitePads(REGION.towns[0])[0]);
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    npc.resources!.money = ECONOMY.supplyPrice.fuel * 2;
    expect(economy.serviceVehicle).toBeTypeOf('function');
    economy.serviceVehicle(w, npc, 'bowl', 0);
    expect(npc.resources!.fuel).toBe(2);
    expect(npc.resources!.money).toBe(0);
    expect(npc.resources!.supplies).toBe(0);
  });

  it('serves like a town garage at a stall', () => {
    const w = emptyWorld();
    const granary = REGION.locations.find((l) => l.id === 'granary')!;
    const make = (pad: { x: number; y: number }) => {
      const npc = addVehicle(w, 'scavengers', 'scout', [], pad);
      corePart(npc, 'cab').hp -= 2;
      npc.resources!.fuel = 0;
      npc.resources!.supplies = 0;
      npc.resources!.money = 333_333;
      return npc;
    };
    const atStall = make(sitePads(granary)[0]);
    const atTown = make(sitePads(REGION.towns[0])[0]);
    economy.serviceAtStall(w, atStall, 'granary', 0);
    economy.serviceVehicle(w, atTown, 'bowl', 0);
    expect(atStall.resources).toEqual(atTown.resources);
    expect(atStall.resources!.fuel).toBe(chassisDef(atStall.chassisId).fuelCap);
    const cab = corePart(atStall, 'cab');
    expect(cab.hp).toBe(partDef(cab.defId).hp);
    expect(cab.hp).toBe(corePart(atTown, 'cab').hp);
  });

  it('never serves a raider at a stall', () => {
    const w = emptyWorld();
    const yard = REGION.locations.find((l) => l.id === 'salvage-yard')!;
    const npc = addVehicle(w, 'raiders', 'scout', [], sitePads(yard)[0]);
    corePart(npc, 'cab').hp -= 2;
    npc.resources!.fuel = 0;
    npc.resources!.money = 333_333;
    const before = structuredClone(npc);
    expect(() => economy.serviceAtStall(w, npc, 'salvage-yard', 0)).toThrow('Only non-raiders');
    expect(npc).toEqual(before);
  });

  it('refuses stall service at a town garage', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], sitePads(REGION.towns[0])[0]);
    expect(() => economy.serviceAtStall(w, npc, 'bowl', 0)).toThrow('no stall');
  });
});
