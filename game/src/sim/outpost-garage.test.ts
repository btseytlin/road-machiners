import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { atGarage } from './garage';
import { mountedParts } from './grid';
import { canStowPart, moveItem, plannedRefitTurns, startRefit, storePart, stowSpot, takeFromStorage } from './inventory';
import { outpostBuyPart, outpostPartPrice } from './outposts';
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
