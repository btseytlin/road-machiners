import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { moveItem, dumpItem, removeAllGoods } from './inventory';
import { advanceJobs, startJob } from './jobs';
import { emptyWorld, practiceOf } from './testkit';
import { findSpot, gridOf, MOUNT_CELLS } from './grid';
import { planItemMove } from './inventory';
import type { GridItem, World } from './types';

function getWeapon(w: World): Extract<GridItem, { kind: 'part' }> {
  const item = w.vehicles[0].items.find((entry) => entry.kind === 'part' && entry.part.defId === 'mg');
  if (!item || item.kind !== 'part') throw new Error('Expected weapon');
  return item;
}

function startUnmount() {
  const w = emptyWorld();
  const weapon = getWeapon(w);
  const next = moveItem(w, weapon.id, { x: 1, y: CHASSIS.scout.layout.length, rot: 0 });
  return { next, weapon };
}

describe('field refits', () => {
  it('installs a spare on turn three', () => {
    const w = emptyWorld();
    const weapon = getWeapon(w);
    const target = { x: weapon.x, y: weapon.y, rot: weapon.rot };
    weapon.x = 1;
    weapon.y = CHASSIS.scout.layout.length;
    const next = moveItem(w, weapon.id, target);
    for (let turn = 0; turn < 2; turn++) advanceJobs(next);
    expect(getWeapon(next).y).toBe(weapon.y);
    advanceJobs(next);
    expect(getWeapon(next)).toMatchObject(target);
    expect(practiceOf(next, 'fieldJob')).toEqual([]);
  });

  it('charges removal and installation for relocation between mounts', () => {
    const w = emptyWorld();
    removeAllGoods(w.vehicles[0]);
    w.vehicles[0].items = w.vehicles[0].items.filter((it) => it.kind === 'good' || it.part.defId !== 'panniers');
    const weapon = getWeapon(w);
    const to = findSpot(gridOf(w.vehicles[0]), w.vehicles[0].items, { ...weapon, id: 'probe' }, MOUNT_CELLS.weapon, null);
    if (!to) throw new Error('Expected spare mount');
    const next = moveItem(w, weapon.id, to);
    expect(next.vehicles[0].job).toMatchObject({ total: 5 });
  });

  it('does not start work for the unchanged position', () => {
    const w = emptyWorld();
    const weapon = getWeapon(w);
    const next = moveItem(w, weapon.id, weapon);
    expect(next.vehicles[0].job).toBeNull();
  });

  it('cancels on movement without changing layout', () => {
    const { next, weapon } = startUnmount();
    advanceJobs(next);
    next.vehicles[0].speed = 5;
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(getWeapon(next)).toEqual(weapon);
    expect(next.events.at(-1)).toMatchObject({ t: 'job', outcome: 'cancelled' });
  });

  it('rejects a moving or busy truck without changing the input', () => {
    const w = emptyWorld();
    const weapon = getWeapon(w);
    const to = { x: 1, y: CHASSIS.scout.layout.length, rot: 0 as const };
    w.vehicles[0].speed = 5;
    expect(() => moveItem(w, weapon.id, to)).toThrow('Stop');
    w.vehicles[0].speed = 0;
    startJob(w, w.vehicles[0], { kind: 'search', stockId: 'stock', total: 2, turnsLeft: 2 });
    expect(() => moveItem(w, weapon.id, to)).toThrow('already busy');
    expect(getWeapon(w)).toEqual(weapon);
  });

  it('blocks inventory moves and dumping during a refit', () => {
    const { next, weapon } = startUnmount();
    const good = next.vehicles[0].items.find((item) => item.kind === 'good');
    if (!good) throw new Error('Expected goods');
    expect(() => moveItem(next, weapon.id, weapon)).toThrow('Finish the refit');
    expect(() => dumpItem(next, good.id)).toThrow('Finish the refit');
  });

  it('cancels if a required item disappears', () => {
    const { next, weapon } = startUnmount();
    next.vehicles[0].items = next.vehicles[0].items.filter((item) => item.id !== weapon.id);
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.some((item) => item.id === weapon.id)).toBe(false);
  });

  it('cancels if the target space becomes occupied', () => {
    const { next, weapon } = startUnmount();
    next.vehicles[0].items.push({ id: 'new-cargo', kind: 'good', good: 'scrap', x: 1, y: CHASSIS.scout.layout.length, rot: 0 });
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(getWeapon(next)).toEqual(weapon);
  });

  it('preserves damage received while working', () => {
    const { next } = startUnmount();
    getWeapon(next).part.hp = 1;
    for (let turn = 0; turn < 5; turn++) advanceJobs(next);
    expect(getWeapon(next).part.hp).toBe(1);
  });

  it('swaps goods instantly and preserves both identities', () => {
    const w = emptyWorld();
    const goods = w.vehicles[0].items.filter((item) => item.kind === 'good');
    const [first, second] = goods;
    const next = moveItem(w, first.id, second);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.find((item) => item.id === first.id)).toMatchObject({ x: second.x, y: second.y });
    expect(next.vehicles[0].items.find((item) => item.id === second.id)).toMatchObject({ x: first.x, y: first.y });
  });

  it('rejects a swap whose displaced item cannot fit', () => {
    const w = emptyWorld();
    const weapon = getWeapon(w);
    const engine = w.vehicles[0].items.find((item) => item.kind === 'part' && item.part.defId === 'stockEngine');
    if (!engine) throw new Error('Expected engine');
    expect(() => moveItem(w, weapon.id, { x: engine.x, y: engine.y, rot: 0 })).toThrow();
    expect(w.vehicles[0].job).toBeNull();
  });

  it('rejects a footprint covering more than one item', () => {
    const w = emptyWorld();
    const engine = w.vehicles[0].items.find((item) => item.kind === 'part' && item.part.defId === 'stockEngine');
    if (!engine) throw new Error('Expected engine');
    expect(() => moveItem(w, engine.id, { x: 4, y: 1, rot: 0 })).toThrow('More than one item');
  });

  it('cancels when a required item has changed position', () => {
    const { next } = startUnmount();
    getWeapon(next).x += 1;
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.events.at(-1)).toMatchObject({ outcome: 'cancelled' });
  });

  it('swaps two spares without starting work', () => {
    const w = emptyWorld();
    removeAllGoods(w.vehicles[0]);
    const first = getWeapon(w);
    first.x = 0;
    first.y = CHASSIS.scout.layout.length;
    const second = { ...first, id: 'second-spare', part: { ...first.part, id: 'second-part' }, x: 1 };
    w.vehicles[0].items.push(second);
    const next = moveItem(w, first.id, { x: second.x, y: second.y, rot: 0 });
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.find((item) => item.id === first.id)?.x).toBe(1);
    expect(next.vehicles[0].items.find((item) => item.id === second.id)?.x).toBe(0);
  });

  it('rejects removal of cargo rows that still hold items', () => {
    const w = emptyWorld();
    removeAllGoods(w.vehicles[0]);
    const rack = w.vehicles[0].items.find((item) => item.kind === 'part' && item.part.defId === 'panniers');
    if (!rack) throw new Error('Expected panniers');
    w.vehicles[0].items.push({ id: 'cargo', kind: 'good', good: 'scrap', x: 0, y: CHASSIS.scout.layout.length, rot: 0 });
    const result = planItemMove(w.vehicles[0], rack.id, { x: 2, y: CHASSIS.scout.layout.length, rot: 0 });
    expect(result.error).toMatch(/fit|fall off/);
  });
});

describe('machining on refits', () => {
  it('takes fewer refit turns for the player at rank 5', () => {
    const w = emptyWorld();
    w.player.ranks.machining = 5;
    const weapon = getWeapon(w);
    const next = moveItem(w, weapon.id, { x: 1, y: CHASSIS.scout.layout.length, rot: 0 });
    const turns = Math.ceil(RULES.refitTurnsPerPart * (1 - 5 * SKILL_EFFECTS.machining.refit));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
    expect(turns).toBeLessThan(RULES.refitTurnsPerPart);
  });
});

