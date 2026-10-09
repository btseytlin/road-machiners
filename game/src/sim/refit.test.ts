import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { lootRefitTurns, moveItem, mountPart, dumpItem, refitTurns, removeAllGoods } from './inventory';
import { advanceJobs, startJob } from './jobs';
import { makePart } from './factory';
import { sitePads, townAt } from './sites';
import { addVehicle, emptyWorld, practiceOf } from './testkit';
import { findSpot, gridOf, MOUNT_CELLS } from './grid';
import { planItemMove } from './inventory';
import type { GridItem, PartInstance, World } from './types';

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
  it('installs a spare on turn five', () => {
    const w = emptyWorld();
    const weapon = getWeapon(w);
    const target = { x: weapon.x, y: weapon.y, rot: weapon.rot };
    weapon.x = 1;
    weapon.y = CHASSIS.scout.layout.length;
    const next = moveItem(w, weapon.id, target);
    for (let turn = 0; turn < 4; turn++) advanceJobs(next);
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
    expect(next.vehicles[0].job).toMatchObject({ total: 10 });
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
    const turns = Math.ceil(RULES.refitTurnsPerPart * 2 * (1 - 5 * SKILL_EFFECTS.machining.refit));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
    expect(turns).toBeLessThan(RULES.refitTurnsPerPart * 2);
  });
});

function mountCrane(w: World): PartInstance {
  const crane = makePart(w, 'patcherCrane', 0);
  if (!mountPart(w, w.vehicles[0], crane)) throw new Error('No deck room for the crane');
  return crane;
}

const INSTALL = RULES.refitTurnsPerPart;
const REPLACE = RULES.refitTurnsPerPart * 2;

describe('the Patcher crane on refits', () => {
  it.each([
    { machining: 0, crane: false, install: 5, replace: 10 },
    { machining: 0, crane: true, install: 4, replace: 7 },
    { machining: 3, crane: false, install: 4, replace: 8 },
    { machining: 3, crane: true, install: 3, replace: 6 },
  ])('takes $install and $replace turns at Machining $machining, crane $crane', ({ machining, crane, install, replace }) => {
    const w = emptyWorld();
    w.player.ranks.machining = machining;
    if (crane) mountCrane(w);

    expect(refitTurns(w, w.vehicles[0], INSTALL)).toBe(install);
    expect(refitTurns(w, w.vehicles[0], REPLACE)).toBe(replace);
  });

  it('starts the install job with the crane time', () => {
    const w = emptyWorld();
    mountCrane(w);
    const weapon = getWeapon(w);
    const target = { x: weapon.x, y: weapon.y, rot: weapon.rot };
    weapon.x = 1;
    weapon.y = CHASSIS.scout.layout.length;

    const next = moveItem(w, weapon.id, target);

    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: 4, total: 4 });
  });

  it('counts a broken crane as none', () => {
    const w = emptyWorld();
    mountCrane(w).hp = 0;

    expect(refitTurns(w, w.vehicles[0], INSTALL)).toBe(5);
  });

  it('counts two cranes once, for NPCs as for the player', () => {
    const w = emptyWorld();
    const one = addVehicle(w, 'traders', 'hauler', ['patcherCrane'], { x: 40, y: 30 });
    const two = addVehicle(w, 'traders', 'hauler', ['patcherCrane', 'patcherCrane'], { x: 50, y: 30 });

    expect(two.items.filter((it) => it.kind === 'part' && it.part.defId === 'patcherCrane')).toHaveLength(2);
    expect(refitTurns(w, one, REPLACE)).toBe(7);
    expect(refitTurns(w, two, REPLACE)).toBe(7);
  });

  it('keeps the Cannibal perk at its flat turns without a crane', () => {
    const w = emptyWorld();
    w.player.perks = ['cannibal'];

    expect(lootRefitTurns(w, w.vehicles[0], REPLACE)).toBe(PERK_NUMBERS.cannibal.turns);
  });

  it('keeps garage changes instant', () => {
    const w = emptyWorld(sitePads(REGION.towns[0])[0]);
    expect(townAt(w)).not.toBeNull();
    const weapon = getWeapon(w);

    const next = moveItem(w, weapon.id, { x: 1, y: CHASSIS.scout.layout.length, rot: 0 });

    expect(next.vehicles[0].job).toBeNull();
    expect(getWeapon(next)).toMatchObject({ x: 1, y: CHASSIS.scout.layout.length });
  });
});

