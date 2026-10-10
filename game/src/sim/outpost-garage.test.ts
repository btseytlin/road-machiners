import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { atGarage } from './garage';
import { mountedParts } from './grid';
import { addGoods, canStowPart, moveItem, plannedRefitTurns, startRefit, storePart, stowSpot, takeFromStorage } from './inventory';
import { outpostBuyChassis, outpostBuyPart, outpostPartPrice } from './outposts';
import { chassisPrice, chassisSwapRefusal, swapChassis } from './economy';
import { outpostTrucks, truckOffers } from './fury-road';
import { goodsCount } from './grid';
import { FURY_ROAD } from '../data/modes';
import { PLAYER_CHASSIS } from '../data/chassis';
import { fillCargo, parkedAtOutpost, stockOfKind } from './testkit';
import type { GridItem, World } from './types';

const atOutpost = () => parkedAtOutpost();
const stockArmor = (w: World) => stockOfKind(w, 'armor');

function mountedGun(w: World): GridItem {
  const me = playerVehicle(w);
  const gun = mountedParts(me, 'weapon')[0];
  const item = me.items.find((it) => it.kind === 'part' && it.part.id === gun.id);
  if (!item) throw new Error('No mounted gun');
  return item;
}

describe('an outpost garage', () => {
  it('is a garage on the pad and not off it', () => {
    const w = atOutpost();
    expect(atGarage(w)).toBe(true);

    playerVehicle(w).pos = { x: 20, y: 20 };

    expect(atGarage(w)).toBe(false);
  });

  it('takes a fitted gun into storage and back onto its mount at once', () => {
    const w = atOutpost();
    const gun = mountedGun(w);

    const stored = storePart(w, gun.id);
    expect(stored.player.storage.map((p) => p.id)).toEqual([gun.kind === 'part' && gun.part.id]);
    expect(playerVehicle(stored).job).toBeNull();

    const back = takeFromStorage(stored, stored.player.storage[0].id, { x: gun.x, y: gun.y, rot: gun.rot });
    expect(back.player.storage).toEqual([]);
    expect(playerVehicle(back).job).toBeNull();
    expect(mountedParts(playerVehicle(back), 'weapon')).toHaveLength(mountedParts(playerVehicle(w), 'weapon').length);
  });

  it('moves a fitted part off its mount with no refit job and no planned turns', () => {
    const w = atOutpost();
    const gun = mountedGun(w);
    const spot = stowSpot(playerVehicle(w), gun);
    if (!spot) throw new Error('No cargo room');

    expect(plannedRefitTurns(w, playerVehicle(w), { [gun.id]: spot })).toBe(0);
    expect(playerVehicle(moveItem(w, gun.id, spot)).job).toBeNull();
    expect(playerVehicle(startRefit(w, { [gun.id]: spot })).job).toBeNull();
  });

  it('times the same refit off the pad', () => {
    const w = atOutpost();
    playerVehicle(w).pos = { x: 20, y: 20 };
    const gun = mountedGun(w);
    const spot = stowSpot(playerVehicle(w), gun);
    if (!spot) throw new Error('No cargo room');

    expect(playerVehicle(moveItem(w, gun.id, spot)).job).toMatchObject({ kind: 'refit' });
    expect(() => storePart(w, gun.id)).toThrow('Not parked at a garage');
  });
});

describe('buying at an outpost', () => {
  it('buys armor with no room on the truck into storage, then fits it from storage at once', () => {
    const w = atOutpost();
    fillCargo(w);
    const armor = stockArmor(w);
    expect(canStowPart(playerVehicle(w), armor)).toBe(false);
    const price = outpostPartPrice(w, armor);

    const bought = outpostBuyPart(w, armor.id);

    expect(bought.player.money).toBe(w.player.money - price);
    expect(bought.furyRoad!.outposts[0].stock.map((p) => p.id)).not.toContain(armor.id);
    expect(bought.player.storage.map((p) => p.id)).toEqual([armor.id]);

    const gone = playerVehicle(bought).items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'armor');
    const cleared = gone.reduce((x, it) => storePart(x, it.id), bought);
    const slot = gone[0];
    const fitted = takeFromStorage(cleared, armor.id, { x: slot.x, y: slot.y, rot: slot.rot });

    expect(playerVehicle(fitted).job).toBeNull();
    expect(mountedParts(playerVehicle(fitted), 'armor').map((p) => p.id)).toContain(armor.id);
  });

  it('puts a part that fits on the truck, not in storage', () => {
    const w = atOutpost();
    const part = w.furyRoad!.outposts[0].stock.find((p) => canStowPart(playerVehicle(w), p));
    if (!part) throw new Error('Nothing in stock fits');

    const bought = outpostBuyPart(w, part.id);

    expect(bought.player.storage).toEqual([]);
    expect(playerVehicle(bought).items.some((it) => it.kind === 'part' && it.part.id === part.id)).toBe(true);
  });

  it('refuses only when money is short or the part is not stocked here', () => {
    const w = atOutpost();
    fillCargo(w);
    const armor = stockArmor(w);
    w.player.money = outpostPartPrice(w, armor) - 1;

    expect(() => outpostBuyPart(w, armor.id)).toThrow();
    expect(() => outpostBuyPart({ ...w, player: { ...w.player, money: 10_000_000 } }, 'no-such-part')).toThrow(/has no part/);
    w.player.money += 1;
    expect(() => outpostBuyPart(w, armor.id)).not.toThrow();
  });
});

function nonBuiltIns(w: World): string[] {
  const me = playerVehicle(w);
  const onTruck = me.items.flatMap((it) => (it.kind === 'part' && partDef(it.part.defId).kind !== 'core' ? [it.part.id] : []));
  return [...onTruck, ...w.player.storage.map((p) => p.id)].sort();
}

function tightSwap(): { w: World; tight: string } {
  for (let seed = 1; seed <= 20; seed++) {
    const w = parkedAtOutpost(seed);
    swapChassis(w, 'longbed');
    addGoods(w, playerVehicle(w), 'parts', 1000);
    const tight = outpostTrucks(w, w.furyRoad!.outposts[0]).find((id) => chassisSwapRefusal(w, id)?.id === 'noCargoRoom');
    if (tight) return { w, tight };
  }
  throw new Error('No outpost of seeds 1 to 20 offers a truck with less cargo room than the longbed');
}

describe('the trucks an outpost sells', () => {
  it('offers three distinct chassis from the pool, the same on every call', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (let j = 1; j <= 10; j++) {
        const offer = truckOffers(seed, j);
        expect(offer).toHaveLength(FURY_ROAD.trucks.offers);
        expect(new Set(offer).size).toBe(offer.length);
        expect(offer.every((id) => FURY_ROAD.trucks.pool.includes(id))).toBe(true);
        expect(truckOffers(seed, j)).toEqual(offer);
      }
    }
  });

  it('draws from every player chassis but the scout the run starts on', () => {
    expect([...FURY_ROAD.trucks.pool].sort()).toEqual(PLAYER_CHASSIS.filter((id) => id !== 'scout').sort());
  });

  it('swaps for the town price, keeps every part and marks the truck sold', () => {
    const w = atOutpost();
    const post = w.furyRoad!.outposts[0];
    const id = outpostTrucks(w, post)[0];
    const price = chassisPrice(w, id);
    const parts = nonBuiltIns(w);
    const goods = goodsCount(playerVehicle(w));

    const after = outpostBuyChassis(w, id);

    expect(playerVehicle(after).chassisId).toBe(id);
    expect(after.player.money).toBe(w.player.money - price);
    expect(nonBuiltIns(after)).toEqual(parts);
    expect(goodsCount(playerVehicle(after))).toEqual(goods);
    expect(playerVehicle(after).job).toBeNull();
    expect(after.furyRoad!.outposts[0].trucksSold).toEqual([id]);
    expect(outpostTrucks(after, after.furyRoad!.outposts[0])).toEqual(outpostTrucks(w, post).slice(1));
    expect(() => outpostBuyChassis(after, id)).toThrow(/offers no/);
  });

  it('refuses a short purse before any change', () => {
    const w = atOutpost();
    const id = outpostTrucks(w, w.furyRoad!.outposts[0]).find((c) => chassisPrice(w, c) > 0);
    if (!id) throw new Error('Every offered truck costs less than the trade-in');
    w.player.money = chassisPrice(w, id) - 1;

    expect(chassisSwapRefusal(w, id)).toEqual({ id: 'noMoney' });
    expect(() => outpostBuyChassis(w, id)).toThrow('Refused: noMoney');
  });

  it('refuses goods that would not fit the new truck and changes nothing', () => {
    const { w, tight } = tightSwap();
    const before = structuredClone(w);

    expect(() => outpostBuyChassis(w, tight)).toThrow('Refused: noCargoRoom');
    expect(w).toEqual(before);
  });

  it('gives no refusal for an affordable swap that fits', () => {
    const w = atOutpost();
    const id = outpostTrucks(w, w.furyRoad!.outposts[0])[0];

    expect(chassisSwapRefusal(w, id)).toBeNull();
  });

  it('refuses a truck off the pad', () => {
    const w = atOutpost();
    const id = outpostTrucks(w, w.furyRoad!.outposts[0])[0];
    playerVehicle(w).pos = { x: 20, y: 20 };

    expect(() => outpostBuyChassis(w, id)).toThrow(/outpost/);
  });
});
