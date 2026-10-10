import { describe, expect, it } from 'vitest';
import { partDef, type UtilityDef } from '../data/parts';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { addVehicle, emptyWorld } from './testkit';
import type { PartInstance, Vehicle, World } from './types';
import { activateUtilities, advanceUtilityEffects, hasWorkingUtility, pointReach, tickCharges, utilityBlock, utilityOrderError, wornReload } from './utility';
import { setUtilityOrder } from './world';

function withUtility(defId: string): { w: World; v: Vehicle; part: PartInstance } {
  const w = emptyWorld();
  const v = addVehicle(w, 'traders', 'hauler', [defId], { x: 40, y: 30 });
  const part = v.items.flatMap((it) => (it.kind === 'part' && it.part.defId === defId ? [it.part] : []))[0];
  return { w, v, part };
}

function playerWith(defId: string): { w: World; part: PartInstance } {
  const w = emptyWorld();
  const part = makePart(w, defId, 0);
  if (!mountPart(w, w.vehicles[0], part)) throw new Error(`No deck room for ${defId}`);
  return { w, part };
}

describe('utility charge state', () => {
  it('gives a new active utility and a claymore ram a ready charge, and a passive utility none', () => {
    const w = emptyWorld();

    expect(makePart(w, 'sprout', 0).charge).toEqual({ reload: 0 });
    expect(makePart(w, 'claymoreRam', 0).charge).toEqual({ reload: 0 });
    expect(makePart(w, 'patcherCrane', 0).charge).toBeUndefined();
    expect(makePart(w, 'ram', 0).charge).toBeUndefined();
  });

  it('gives a new vehicle no utility orders', () => {
    const { v } = withUtility('sprout');

    expect(v.utilityOrders).toEqual({});
  });
});

describe('utility orders', () => {
  it('accepts a self order on a ready, working, mounted utility', () => {
    const { w, v, part } = withUtility('sprout');

    expect(utilityOrderError(w, v, part.id, { kind: 'self' })).toBeNull();
    expect(utilityBlock(w, v, part)).toBeNull();
  });

  it('refuses a broken utility', () => {
    const { w, v, part } = withUtility('sprout');
    part.hp = 0;

    expect(utilityBlock(w, v, part)).toBe('disabled');
    expect(utilityOrderError(w, v, part.id, { kind: 'self' })).toMatchObject({ id: 'utilityBlocked', block: 'disabled' });
  });

  it('refuses a utility that is not mounted', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', [], { x: 40, y: 30 });
    const part = makePart(w, 'sprout', 0);
    mountPart(w, v, part, ['F', 'B', 'L', 'R']);

    expect(utilityBlock(w, v, part)).toBe('unmounted');
    expect(utilityOrderError(w, v, part.id, { kind: 'self' })).toMatchObject({ id: 'utilityBlocked', block: 'unmounted' });
  });

  it('refuses a recharging utility', () => {
    const { w, v, part } = withUtility('sprout');
    part.charge = { reload: 3 };

    expect(utilityBlock(w, v, part)).toBe('cooldown');
    expect(utilityOrderError(w, v, part.id, { kind: 'self' })).toMatchObject({ id: 'utilityBlocked', block: 'cooldown' });
  });

  it('refuses a passive utility and an order of the wrong kind', () => {
    const crane = withUtility('patcherCrane');
    const sprout = withUtility('sprout');

    expect(utilityOrderError(crane.w, crane.v, crane.part.id, { kind: 'self' })).toMatchObject({ id: 'utilityPassive' });
    expect(utilityOrderError(sprout.w, sprout.v, sprout.part.id, { kind: 'point', pos: { x: 45, y: 30 } })).toMatchObject({ id: 'utilityOrder', order: 'self' });
  });

  it('refuses a part the truck does not carry', () => {
    const { w, v } = withUtility('sprout');

    expect(() => utilityOrderError(w, v, 'p-none', { kind: 'self' })).toThrow(/no part p-none/);
  });

  it('a player command stores an accepted order, clears it with null and throws on a refused one', () => {
    const { w, part } = playerWith('sprout');

    const ordered = setUtilityOrder(w, part.id, { kind: 'self' });
    expect(ordered.vehicles[0].utilityOrders).toEqual({ [part.id]: { kind: 'self' } });
    expect(setUtilityOrder(ordered, part.id, null).vehicles[0].utilityOrders).toEqual({});

    part.hp = 0;
    expect(() => setUtilityOrder(w, part.id, { kind: 'self' })).toThrow('Refused: utilityBlocked');
  });
});

describe('utility reload', () => {
  it('counts down once per turn and gates the order until it reaches 0', () => {
    const { w, v, part } = withUtility('sprout');
    part.charge = { reload: 2 };

    tickCharges(w);
    expect(part.charge).toEqual({ reload: 1 });
    expect(utilityOrderError(w, v, part.id, { kind: 'self' })).not.toBeNull();

    tickCharges(w);
    expect(part.charge).toEqual({ reload: 0 });
    expect(utilityOrderError(w, v, part.id, { kind: 'self' })).toBeNull();

    tickCharges(w);
    expect(part.charge).toEqual({ reload: 0 });
  });

  it('a worn utility recharges slower: 10% of its reload per wear step, rounded up', () => {
    const w = emptyWorld();
    const sprout = partDef('sprout') as UtilityDef;
    const oil = partDef('oilSpiller') as UtilityDef;

    expect(sprout.reload).toBe(10);
    expect(oil.reload).toBe(6);
    expect(wornReload(makePart(w, 'sprout', 0))).toBe(10);
    expect(wornReload(makePart(w, 'sprout', 1))).toBe(11);
    expect(wornReload(makePart(w, 'sprout', 3))).toBe(13);
    expect(wornReload(makePart(w, 'oilSpiller', 1))).toBe(7);
  });

  it('a worn claymore ram re-arms slower by the same rule', () => {
    const w = emptyWorld();

    expect(wornReload(makePart(w, 'claymoreRam', 0))).toBe(20);
    expect(wornReload(makePart(w, 'claymoreRam', 1))).toBe(22);
  });

  it('a passive utility has no reload', () => {
    const w = emptyWorld();

    expect(() => wornReload(makePart(w, 'patcherCrane', 0))).toThrow(/no reload/);
  });
});

describe('the activation step', () => {
  it('drops a refused order without acting, and clears it', () => {
    const { w, v, part } = withUtility('sprout');
    v.utilityOrders[part.id] = { kind: 'self' };
    part.hp = 0;

    activateUtilities(w);

    expect(v.utilityOrders).toEqual({});
    expect(part.charge).toEqual({ reload: 0 });
    expect(w.smoke).toEqual([]);
  });

  it('clears a self order after it acts once', () => {
    const { w, v, part } = withUtility('sprout');
    v.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(v.utilityOrders).toEqual({});
    expect(w.smoke).toHaveLength(1);
    expect(part.charge).toEqual({ reload: wornReload(part) });
  });

  it('clears a self order on a recharging part without acting, rather than waiting on the charge', () => {
    const { w, v, part } = withUtility('sprout');
    v.utilityOrders[part.id] = { kind: 'self' };
    part.charge = { reload: 1 };

    activateUtilities(w);

    expect(v.utilityOrders).toEqual({});
    expect(w.smoke).toEqual([]);
  });

  it('clears a point order after it acts once, and one out of reach without acting', () => {
    const near = withUtility('smokeMortar');
    const far = withUtility('smokeMortar');
    const { maxRange } = pointReach(near.part);
    near.v.utilityOrders[near.part.id] = { kind: 'point', pos: { x: near.v.pos.x + maxRange - 1, y: near.v.pos.y } };
    far.v.utilityOrders[far.part.id] = { kind: 'point', pos: { x: far.v.pos.x + maxRange + 5, y: far.v.pos.y } };

    activateUtilities(near.w);
    activateUtilities(far.w);

    expect(near.v.utilityOrders).toEqual({});
    expect(near.w.smoke).toHaveLength(1);
    expect(far.v.utilityOrders).toEqual({});
    expect(far.w.smoke).toEqual([]);
  });

  it('hands an accepted arming order to the claymore ram, which keeps its reload at 0', () => {
    const { w, v, part } = withUtility('claymoreRam');
    v.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(part.charge).toEqual({ reload: 0, armed: true });
  });
});

describe('working utilities', () => {
  it('counts only a mounted utility above 0 HP with that effect', () => {
    const { v, part } = withUtility('patcherCrane');

    expect(hasWorkingUtility(v, 'crane')).toBe(true);
    expect(hasWorkingUtility(v, 'scraper')).toBe(false);
    part.hp = 0;
    expect(hasWorkingUtility(v, 'crane')).toBe(false);
  });
});

describe('utility effects in the world', () => {
  it('starts a new world with no smoke, fields, flares or lines', () => {
    const w = emptyWorld();

    expect([w.smoke, w.fields, w.flares, w.lines]).toEqual([[], [], [], []]);
    expect(w.searchRng.rngState).toEqual(expect.any(Number));
  });

  it('ages every effect each turn and removes it when its turns run out', () => {
    const w = emptyWorld();
    w.smoke = [{ id: 's1', source: 'v1', pos: { x: 1, y: 1 }, r: 5, turnsLeft: 2 }];
    w.fields = [{ id: 'f1', kind: 'oil', source: 'v1', pos: { x: 1, y: 1 }, r: 1.25, turnsLeft: 1, hit: [] }];
    w.flares = [{ id: 'l1', source: 'v1', pos: { x: 1, y: 1 }, r: 10, turnsLeft: 3 }];
    w.lines = [{ id: 'h1', from: 'v1', fromPart: 'p1', to: 'v2', toPart: 'p2', length: 6, turnsLeft: 1 }];

    advanceUtilityEffects(w);

    expect(w.smoke.map((s) => s.turnsLeft)).toEqual([1]);
    expect(w.fields).toEqual([]);
    expect(w.flares.map((f) => f.turnsLeft)).toEqual([2]);
    expect(w.lines).toEqual([]);
  });
});
