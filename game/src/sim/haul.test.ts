import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { cargoHaul, haulVar, showsHaul, surrenderHaul } from './haul';
import { GOODS } from '../data/goods';
import { addGoods, cargoMassRoom, cargoRoom, stowPart } from './inventory';
import { goodsCount } from './grid';
import { collectSalvage, dropHaul } from './salvage';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { Vehicle, World } from './types';

function robber(w: World, parts = ['mg', 'stockEngine']): Vehicle {
  const v = addVehicle(w, 'raiders', 'scout', parts, { x: 10, y: 10 });
  v.brain = npcBrain('buggy', v.pos, ['scumbag']);
  return v;
}

function victim(w: World, goods: Record<string, number>, spares: string[] = []): Vehicle {
  const v = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 14, y: 10 });
  for (const [good, n] of Object.entries(goods)) addGoods(w, v, good, n);
  for (const defId of spares) stowPart(w, v, { id: `${defId}-spare`, defId, hp: 10, wear: 0 } as never);
  return v;
}

const count = (items: { kind: string }[]) => items.length;

describe('the haul', () => {
  it('is empty for a winner with no room and a loser with no cargo', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    const empty = victim(w, {});
    expect(cargoHaul(r, empty)).toEqual([]);
  });

  it('is limited by the winner mass room, taking the most valuable goods first', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    const v = victim(w, { scrap: 2, electronics: 3 });
    const haul = cargoHaul(r, v);
    const room = cargoMassRoom(r);
    const mass = haul.reduce((sum, item) => sum + (item.kind === 'good' ? { scrap: 100, electronics: 15 }[item.good]! : 0), 0);
    expect(mass).toBeLessThanOrEqual(room);
    expect(count(haul)).toBeLessThanOrEqual(5);
  });

  it('leaves what does not fit with the loser, and nothing when the winner is full', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    const v = victim(w, { scrap: 3, tools: 2 });
    while (cargoRoom(r, 'scrap') > 1) addGoods(w, r, 'scrap', 1);
    const haul = cargoHaul(r, v);
    const kinds = haul.map((item) => (item.kind === 'good' ? item.good : 'part'));
    expect(kinds).toHaveLength(1);
    expect(GOODS[kinds[0]].mass).toBeLessThanOrEqual(cargoMassRoom(r));
    expect(v.items.filter((item) => item.kind === 'good')).toHaveLength(5);
    addGoods(w, r, 'scrap', 1);
    expect(cargoHaul(r, v)).toEqual([]);
  });

  it('draws no random numbers and changes no world state', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    const v = victim(w, { scrap: 2, electronics: 3 });
    const rng = w.rngState;
    const items = structuredClone([r.items, v.items]);
    cargoHaul(r, v);
    surrenderHaul(r, v);
    expect(w.rngState).toBe(rng);
    expect([r.items, v.items]).toEqual(items);
  });

  it('is the whole cargo for a player winner without mass limits', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const v = victim(w, { scrap: 2, electronics: 3 });
    const me = w.vehicles[0];
    expect(count(cargoHaul(me, v))).toBe(count(v.items.filter((i) => i.kind === 'good')));
  });

  it('is collected whole from a pile that holds exactly it', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    r.pos = { x: 14, y: 10 };
    const v = victim(w, { scrap: 4, electronics: 6 });
    const haul = cargoHaul(r, v);
    const before = { ...goodsCount(r) };
    const pile = dropHaul(w, v, haul);
    collectSalvage(w, r, pile.id, Infinity);
    expect(Object.values(pile.goods).reduce((a, b) => a + b, 0) + pile.parts.length).toBe(0);
    const after = goodsCount(r);
    for (const item of haul) if (item.kind === 'good') before[item.good] = (before[item.good] ?? 0) + 1;
    expect(after).toEqual(before);
  });

  it('names its goods and parts for the radio and matches only itself', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    const v = victim(w, { electronics: 2 });
    const haul = cargoHaul(r, v);
    expect(showsHaul(haulVar(haul), haul)).toBe(true);
    expect(showsHaul(haulVar(haul), haul.slice(1))).toBe(false);
    expect(showsHaul(undefined, haul)).toBe(false);
  });

  it('adds at most the surrender parts after the cargo', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const r = robber(w);
    const v = addVehicle(w, 'traders', 'wagon', ['mg', 'stockEngine', 'heavyMg', 'mg'], { x: 14, y: 10 });
    const cargo = cargoHaul(r, v);
    const strip = surrenderHaul(r, v);
    const mounted = strip.filter((item) => !cargo.includes(item));
    expect(mounted.length).toBeLessThanOrEqual(RULES.surrenderParts);
  });
});
