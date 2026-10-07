// The icon catalog gives every model-backed item and every chassis one entry, and no two entries draw alike.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { GOODS } from '../data/goods';
import { PARTS, type PartDef } from '../data/parts';
import { BODY_PARTS, iconCatalog, ICON_WEAPON_PICKS, renderKey, WEAPON_POOLS, weaponLook } from './partLooks';

const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
const entry = (id: string) => {
  const found = catalog.find((e) => e.id === id);
  if (!found) throw new Error(`No entry ${id}`);
  return found;
};

describe('icon catalog', () => {
  it('has one entry per part, good and chassis, and nothing else', () => {
    const expected = [...Object.keys(PARTS), ...Object.keys(GOODS), ...Object.keys(CHASSIS)];
    expect(catalog.map((e) => e.id).sort()).toEqual(expected.sort());
  });

  it('draws every cab from its icon-only model', () => {
    const models = [...BODY_PARTS].map((id) => catalog.find((e) => e.id === id)?.models);
    expect(models).toEqual([['cab_seat'], ['cab_pickup'], ['cab_hardtop']]);
  });

  it('gives no two entries the same render key once ranks count', () => {
    const keys = catalog.map(renderKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts the rank in the render key, so same-model defs differ only by it', () => {
    expect(renderKey(entry('tank'))).toMatch(/#1$/);
    expect(renderKey(entry('tankHeavy'))).toMatch(/#4$/);
  });

  it('labels each entry with its def name', () => {
    expect(entry('mg').label).toBe(PARTS.mg.name);
    expect(entry('salt').label).toBe(GOODS.salt.name);
    expect(entry('bus').label).toBe(CHASSIS.bus.name);
  });

  it.each(Object.keys(ICON_WEAPON_PICKS))('picks %s from its own pool', (id) => {
    const pick = ICON_WEAPON_PICKS[id];
    const pool = WEAPON_POOLS[id];
    expect(pool.mount).toContain(pick.mount);
    expect(pool.receiver).toContain(pick.receiver);
    expect(pool.barrel).toContain(pick.barrel);
    if (pool.extra.length === 0) expect(pick.extra).toBeNull();
    else expect(pool.extra).toContain(pick.extra);
  });

  it('has a pick for every weapon def', () => {
    const weapons = Object.values(PARTS).filter((p) => p.kind === 'weapon').map((p) => p.id);
    expect(Object.keys(ICON_WEAPON_PICKS).sort()).toEqual(weapons.sort());
  });

  it('draws a weapon from its pick: mount, receiver, barrel and extra', () => {
    const pick = ICON_WEAPON_PICKS.cannon;
    expect(entry('cannon').weapon).toEqual(pick);
    expect(entry('cannon').models).toEqual([pick.mount, pick.receiver, pick.barrel, pick.extra]);
  });

  it('ranks defs that draw alike by HP, then id', () => {
    expect(['wheel', 'wheelMid', 'wheelHeavy'].map((id) => entry(id).rank)).toEqual([1, 2, 3]);
    expect(['tank', 'tankLong', 'tankMid', 'tankHeavy'].map((id) => entry(id).rank)).toEqual([1, 2, 3, 4]);
    expect(['transmission', 'transmissionMid', 'transmissionHeavy'].map((id) => entry(id).rank)).toEqual([1, 2, 3]);
  });

  it('gives a def that draws unlike every other rank 0', () => {
    expect(entry('stockEngine').rank).toBe(0);
    expect(entry('salt').rank).toBe(0);
    expect(entry('scout').rank).toBe(0);
  });

  it('tells apart weapons of one look by rank and by their footprint, which the stretched mount draws', () => {
    expect(entry('amRifle').models).toEqual(entry('sniperCannon').models);
    expect([entry('amRifle').rank, entry('sniperCannon').rank]).toEqual([1, 2]);
    expect(renderKey(entry('amRifle'))).toContain('@1x3');
    expect(renderKey(entry('sniperCannon'))).toContain('@2x3');
  });

  it('takes its footprint from the def, one cell for a good and the layout for a chassis', () => {
    expect(entry('sniperCannon').footprint).toEqual({ w: PARTS.sniperCannon.w, h: PARTS.sniperCannon.h });
    expect(entry('salt').footprint).toEqual({ w: 1, h: 1 });
    expect(entry('scout').footprint).toEqual({ w: CHASSIS.scout.layout[0].length, h: CHASSIS.scout.layout.length });
  });

  it('fails naming a part that has no model', () => {
    const parts: Record<string, PartDef> = { ...PARTS, hoverPad: { ...PARTS.scanner, id: 'hoverPad', name: 'Hover pad' } };
    expect(() => iconCatalog(parts, GOODS, CHASSIS, ICON_WEAPON_PICKS)).toThrow(/hoverPad/);
  });

  it('draws a weapon with no pick from its pool, so a new weapon def gets an icon with no code change', () => {
    const { mg: _, ...picks } = ICON_WEAPON_PICKS;
    const drawn = iconCatalog(PARTS, GOODS, CHASSIS, picks).find((e) => e.id === 'mg');
    expect(drawn?.weapon).toEqual(weaponLook('icon:mg', 'mg'));
  });
});
