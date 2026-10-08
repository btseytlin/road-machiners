import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { getLotTradePrice, partRepairCost, enterTown, scrapPatch } from './economy';
import { corePart, coreParts, mountedParts } from './grid';
import { makePart } from './factory';
import { addGoods, stowPart } from './inventory';
import { acceptContract, shopState, type Contract } from './market';
import { sitePads } from './sites';
import { fuelCap, isStranded } from './stats';
import { emptyWorld } from './testkit';
import { maxHp } from './wear';
import { endTurn } from './world';
import type { PartInstance, Vehicle, World } from './types';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const engineOf = (v: Vehicle) => mountedParts(v, 'engine')[0];
const share = (p: PartInstance) => p.hp / maxHp(p);

// The player at the Bowl pad with a broken transmission, a worn engine, no money and nothing to sell. The truck
// keeps only its built-in parts and its engine.
function strandedBroke(pos = sitePads(bowl)[0]): World {
  const w = emptyWorld(pos);
  const me = w.vehicles[0];
  me.items = me.items.filter((it) => it.kind === 'part' && (partDef(it.part.defId).kind === 'core' || it.part === engineOf(me)));
  corePart(me, 'transmission').hp = 0;
  engineOf(me).hp = 1;
  w.player.money = 0;
  w.events = [];
  return w;
}

describe('scrap patch', () => {
  it('raises every drive part to the patch share when a broke player with nothing to sell reaches town', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    const fullWheel = coreParts(me, 'wheel')[0].hp;

    scrapPatch(w);

    expect(share(corePart(me, 'transmission'))).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(share(engineOf(me))).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(coreParts(me, 'wheel')[0].hp).toBe(fullWheel);
    expect(isStranded(w, me)).toBe(false);
    expect(w.events).toContainEqual({ t: 'scrapPatch', fuel: 0 });
  });

  it('patches a broken fuel tank, which would leak away any fuel found', () => {
    const w = strandedBroke();
    corePart(w.vehicles[0], 'tank').hp = 0;

    scrapPatch(w);

    expect(share(corePart(w.vehicles[0], 'tank'))).toBeGreaterThanOrEqual(RULES.scrapPatch);
  });

  it('fills an empty tank to the patch share when the drive parts work', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = maxHp(corePart(me, 'transmission'));
    w.player.fuel = 0;

    scrapPatch(w);

    expect(w.player.fuel).toBeCloseTo(fuelCap(me) * RULES.scrapPatch);
    expect(isStranded(w, me)).toBe(false);
    expect(w.events).toContainEqual({ t: 'scrapPatch', fuel: fuelCap(me) * RULES.scrapPatch });
  });

  it('leaves a player who can buy the patch fuel to the pump', () => {
    const w = strandedBroke();
    corePart(w.vehicles[0], 'transmission').hp = maxHp(corePart(w.vehicles[0], 'transmission'));
    w.player.fuel = 0;
    w.player.money = Math.ceil(fuelCap(w.vehicles[0]) * RULES.scrapPatch) * ECONOMY.supplyPrice.fuel;

    scrapPatch(w);

    expect(w.player.fuel).toBe(0);
  });

  it('brings a junk engine back to the last wear step and patches it', () => {
    const w = strandedBroke();
    const engine = engineOf(w.vehicles[0]);
    engine.hp = 0;
    engine.wear = CONDITION.maxWear + 2;

    scrapPatch(w);

    expect(engine.wear).toBe(CONDITION.maxWear);
    expect(share(engine)).toBeGreaterThanOrEqual(RULES.scrapPatch);
    expect(isStranded(w, w.vehicles[0])).toBe(false);
  });

  it('gives nothing to a truck with no engine, since no patch makes one', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    const engine = engineOf(me);
    me.items = me.items.filter((it) => !(it.kind === 'part' && it.part === engine));

    scrapPatch(w);

    expect(corePart(me, 'transmission').hp).toBe(0);
    expect(w.events).not.toContainEqual(expect.objectContaining({ t: 'scrapPatch' }));
  });

  it('leaves a player who can pay for the repair to the garage', () => {
    const w = strandedBroke();
    w.player.money = 3333333;

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });

  it('patches a player whose goods to sell are worth less than the repair', () => {
    const w = strandedBroke();
    expect(addGoods(w, w.vehicles[0], 'scrap', 1)).toBe(1);

    scrapPatch(w);

    expect(isStranded(w, w.vehicles[0])).toBe(false);
  });

  it('leaves a player whose goods to sell pay for the repair to sell them first', () => {
    const w = strandedBroke();
    const me = w.vehicles[0];
    const trans = corePart(me, 'transmission');
    expect(addGoods(w, me, 'scrap', 1)).toBe(1);
    w.player.money = partRepairCost(w, trans) - getLotTradePrice(w, me, 'bowl', 'scrap', 1, 'sell');

    scrapPatch(w);

    expect(trans.hp).toBe(0);
  });

  it('leaves a player with a spare part to sell it first', () => {
    const w = strandedBroke();
    expect(stowPart(w, w.vehicles[0], makePart(w, 'heavyMg', 0))).toBe(true);

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });

  it('leaves a player with a mounted gun to take it off and sell it first', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    expect(mountedParts(me, 'weapon').length + mountedParts(me, 'armor').length).toBeGreaterThan(0);
    corePart(me, 'transmission').hp = 0;
    w.player.money = 0;

    scrapPatch(w);

    expect(corePart(me, 'transmission').hp).toBe(0);
  });

  it('does nothing away from a town', () => {
    const w = strandedBroke({ x: 30, y: 30 });

    scrapPatch(w);

    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(0);
  });
});

describe('scrap fuel for a low tank', () => {
  function lowFuel(share: number, pos = sitePads(bowl)[0]): World {
    const w = strandedBroke(pos);
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = maxHp(corePart(me, 'transmission'));
    w.player.fuel = fuelCap(me) * share;
    return w;
  }

  it('tops a broke player with a sliver of fuel to the patch share and leaves the parts alone', () => {
    const w = lowFuel(0.1);
    const me = w.vehicles[0];
    const engineHp = engineOf(me).hp;

    scrapPatch(w);

    expect(w.player.fuel).toBeCloseTo(fuelCap(me) * RULES.scrapPatch);
    expect(engineOf(me).hp).toBe(engineHp);
  });

  it('gives nothing above the low fuel threshold, and nothing a second time', () => {
    const w = lowFuel(0.3);
    scrapPatch(w);
    expect(w.player.fuel).toBeCloseTo(fuelCap(w.vehicles[0]) * 0.3);

    const low = lowFuel(0.1);
    scrapPatch(low);
    low.events = [];
    scrapPatch(low);
    expect(low.events).toHaveLength(0);
  });

  it('gives nothing to a player who can pay for the fuel', () => {
    const w = lowFuel(0.1);
    w.player.money = 3333333;
    scrapPatch(w);
    expect(w.player.fuel).toBeCloseTo(fuelCap(w.vehicles[0]) * 0.1);
  });

  it('gives nothing on a stall pad', () => {
    const stall = REGION.locations.find((l) => l.id === 'salvage-yard')!;
    const w = lowFuel(0.1, sitePads(stall)[0]);
    scrapPatch(w);
    expect(w.player.fuel).toBeCloseTo(fuelCap(w.vehicles[0]) * 0.1);
  });

  it('leaves a player with no money, no fuel and a broken engine able to drive and take a haul', () => {
    const w = strandedBroke();
    w.player.fuel = 0;
    engineOf(w.vehicles[0]).hp = 0;

    const next = endTurn(w, () => undefined);

    expect(isStranded(next, next.vehicles[0])).toBe(false);
    expect(next.player.fuel).toBeGreaterThan(0);
    // The board's own roll depends on the world newWorld() spawns, so the test offers a small haul of its own.
    const haul: Contract = { id: 'haul-test', shop: 'bowl', kind: 'haul', good: 'scrap', units: 1, to: 'nose', reward: 3333, deadline: next.turn + 50, window: 50, rush: false, tier: 1 };
    shopState(next, 'bowl').contracts.push(haul);
    expect(acceptContract(next, haul.id).player.contracts.map((c) => c.id)).toContain(haul.id);
  });
});

describe('enter town', () => {
  const critical = (me: Vehicle) => [engineOf(me), corePart(me, 'transmission'), corePart(me, 'cab'), corePart(me, 'tank'), ...coreParts(me, 'wheel')];

  function wornCritical(pos: { x: number; y: number }): World {
    const w = emptyWorld(pos);
    for (const part of critical(w.vehicles[0])) part.hp = 1;
    w.events = [];
    return w;
  }

  it('raises every worn critical part to the town patch share', () => {
    const next = enterTown(wornCritical(sitePads(bowl)[0]));

    for (const part of critical(next.vehicles[0])) expect(share(part)).toBeGreaterThanOrEqual(RULES.townPatch);
  });

  it('logs one line when it patches and none when nothing is worn', () => {
    const worn = enterTown(wornCritical(sitePads(bowl)[0]));
    expect(worn.events.filter((e) => e.t === 'townPatch')).toHaveLength(1);

    const sound = wornCritical(sitePads(bowl)[0]);
    for (const part of critical(sound.vehicles[0])) part.hp = maxHp(part);
    expect(enterTown(sound).events.filter((e) => e.t === 'townPatch')).toHaveLength(0);
  });

  it('patches at a stall as at a town, and clears the visit when the truck leaves it', () => {
    const stall = REGION.locations.find((l) => l.id === 'salvage-yard')!;
    const next = enterTown(wornCritical(sitePads(stall)[0]));
    for (const part of critical(next.vehicles[0])) expect(share(part)).toBeGreaterThanOrEqual(RULES.townPatch);
    expect(next.events.filter((e) => e.t === 'townPatch')).toHaveLength(1);
    expect(next.player.townPatched).toBe(true);
    expect(endTurn(next, () => undefined).player.townPatched).toBe(true);
  });

  it('repairs only the first time on a visit and again after the truck leaves the town', () => {
    const first = enterTown(wornCritical(sitePads(bowl)[0]));
    const hurt = first.vehicles[0];
    corePart(hurt, 'transmission').hp = 1;

    const second = enterTown(first);
    expect(corePart(second.vehicles[0], 'transmission').hp).toBe(1);

    const away = emptyWorld({ x: 30, y: 30 });
    away.player.townPatched = true;
    expect(endTurn(away, () => undefined).player.townPatched).toBe(false);
  });

  it('throws away from a shop and repairs nothing', () => {
    const w = wornCritical({ x: 30, y: 30 });

    expect(() => enterTown(w)).toThrow();
    expect(corePart(w.vehicles[0], 'transmission').hp).toBe(1);
  });

  it('leaves parts above the share and junk parts alone', () => {
    const w = wornCritical(sitePads(bowl)[0]);
    const me = w.vehicles[0];
    for (const part of critical(me)) part.hp = maxHp(part);
    const engine = engineOf(me);
    engine.hp = 0;
    engine.wear = CONDITION.maxWear + 2;

    const next = enterTown(w);

    expect(engineOf(next.vehicles[0]).hp).toBe(0);
    expect(corePart(next.vehicles[0], 'cab').hp).toBe(maxHp(corePart(next.vehicles[0], 'cab')));
  });
});
