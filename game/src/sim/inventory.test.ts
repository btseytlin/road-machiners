import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PARTS } from '../data/parts';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { makePart } from './factory';
import { update } from './world';
import { gunSpans, spanDegrees } from './armor';
import { freeCells, goodsCount, gridOf, isMounted, mountedItems, mountedParts } from './grid';
import { addGoods, canStowPart, cargoMassRoom, cargoRoom, dumpItem, hasCargoRoom, installSpot, mountPart, moveItem, plannedRefitTurns, removeAllGoods, spareParts, startRefit, storePart, stowPart, stowSpot, takeFromStorage } from './inventory';
import { fuelCap, suppliesCap, vehicleStats } from './stats';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { CRATE_MASS } from '../data/goods';
import { npcMassRoom } from './stats';
import type { GridItem, Vehicle, World } from './types';
import { sitePads } from './sites';
import { siteOf } from './market';
import { advanceJobs } from './jobs';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const item = (w: World, defId: string) => w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === defId)!;
const good = (w: World) => w.vehicles[0].items.find((it) => it.kind === 'good')!;
const rackRow = CHASSIS.scout.layout.length;

describe('inventory grid', () => {
  it('the standard kit starts with a scout, 333 M, two cargo parts, and full resources', () => {
    const w = emptyWorld();
    expect(w.vehicles[0].chassisId).toBe('scout');
    expect(w.player.money).toBe(33300);
    expect(goodsCount(w.vehicles[0]).parts).toBe(2);
    expect(w.player.fuel).toBe(CHASSIS.scout.fuelCap);
    expect(w.player.supplies).toBe(RULES.baseSupplies);
  });

  it('the start kit is mounted and working', () => {
    const w = emptyWorld();
    expect(mountedParts(w.vehicles[0]).map((p) => p.defId).filter((id) => PARTS[id].kind !== 'core').sort()).toEqual(['cage', 'mg', 'panniers', 'stockEngine']);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(1);
  });

  it('the panniers add a full row', () => {
    const w = emptyWorld();
    expect(gridOf(w.vehicles[0]).h).toBe(rackRow + 1);
  });

  it('goods move anywhere, even out of town', () => {
    const w = emptyWorld();
    const g = good(w);
    const moved = moveItem(w, g.id, { x: 0, y: rackRow, rot: 0 });
    expect(moved.vehicles[0].items.find((it) => it.id === g.id)).toMatchObject({ x: 0, y: rackRow });
  });

  it('items cannot overlap or leave the grid', () => {
    const w = emptyWorld();
    const g = good(w);
    expect(() => moveItem(w, g.id, { x: 1, y: 1, rot: 0 })).toThrow('Refused: builtInFixed');
    expect(() => moveItem(w, g.id, { x: 9, y: 0, rot: 0 })).toThrow('Refused: badLayout');
  });

  it('disarms a claymore ram that is moved or stored', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const claymore = makePart(w, 'claymoreRam', 0);
    if (!mountPart(w, w.vehicles[0], claymore)) throw new Error('No room for the claymore ram');
    claymore.charge = { reload: 0, armed: true };
    const it = item(w, 'claymoreRam');
    const spot = stowSpot(w.vehicles[0], it);
    if (!spot) throw new Error('No storage room');

    const moved = moveItem(w, it.id, spot);
    const stored = storePart(update(w, (d) => { (item(d, 'claymoreRam') as Extract<GridItem, { kind: 'part' }>).part.charge = { reload: 0, armed: true }; }), it.id);

    expect((item(moved, 'claymoreRam') as Extract<GridItem, { kind: 'part' }>).part.charge).toEqual({ reload: 0 });
    expect(stored.player.storage.find((p) => p.defId === 'claymoreRam')?.charge).toEqual({ reload: 0 });
  });

  it('unmounting takes five turns in the field and is instant in town', () => {
    const w = emptyWorld();
    const mg = item(w, 'mg');
    const field = moveItem(w, mg.id, { x: 5, y: rackRow, rot: 1 });
    expect(field.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: 5 });
    for (let turn = 0; turn < 4; turn++) advanceJobs(field);
    expect(vehicleStats(field, field.vehicles[0]).weapons).toHaveLength(1);
    advanceJobs(field);
    expect(field.vehicles[0].job).toBeNull();
    expect(vehicleStats(field, field.vehicles[0]).weapons).toHaveLength(0);
    const inTown = emptyWorld(sitePads(bowl)[0]);
    const off = moveItem(inTown, item(inTown, 'mg').id, { x: 5, y: rackRow, rot: 1 });
    expect(vehicleStats(off, off.vehicles[0]).weapons).toHaveLength(0);
    expect(spareParts(off.vehicles[0]).map((p) => p.defId)).toEqual(['mg']);
  });

  it('swaps a spare with a mounted weapon after ten turns', () => {
    const w = emptyWorld();
    const mg = item(w, 'mg');
    if (mg.kind !== 'part') throw new Error('Expected weapon');
    w.vehicles[0].items.push({ ...mg, id: 'spare-item', part: { ...mg.part, id: 'spare-part' }, x: 4, y: rackRow, rot: 1 });
    const next = moveItem(w, 'spare-item', { x: mg.x, y: mg.y, rot: 0 });
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', total: 10 });
    for (let turn = 0; turn < 9; turn++) advanceJobs(next);
    expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: mg.x, y: mg.y });
    advanceJobs(next);
    expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: 4, y: rackRow, rot: 1 });
    expect(next.vehicles[0].items.find((it) => it.id === 'spare-item')).toMatchObject({ x: mg.x, y: mg.y });
    expect(next.vehicles[0].items.map((it) => it.id).sort()).toEqual(w.vehicles[0].items.map((it) => it.id).sort());
  });

  it('swaps a spare with installed equipment instantly in a garage', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const mg = item(w, 'mg');
    if (mg.kind !== 'part') throw new Error('Expected weapon');
    w.vehicles[0].items.push({ ...mg, id: 'spare-item', part: { ...mg.part, id: 'spare-part' }, x: 4, y: rackRow, rot: 1 });
    const next = moveItem(w, 'spare-item', { x: mg.x, y: mg.y, rot: 0 });
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.find((entry) => entry.id === mg.id)).toMatchObject({ x: 4, y: rackRow, rot: 1 });
    expect(next.vehicles[0].items.find((entry) => entry.id === 'spare-item')).toMatchObject({ x: mg.x, y: mg.y });
  });

  it('a gun works only lying fully on deck cells', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w.player.money = 2000;
    removeAllGoods(w.vehicles[0]);
    w = storePart(w, item(w, 'mg').id);
    w = storePart(w, item(w, 'panniers').id);
    w = update(w, (d) => { d.player.storage.push(makePart(d, 'heavyMg', 0)); });
    const id = w.player.storage.find((p) => p.defId === 'heavyMg')!.id;
    const stacked = takeFromStorage(w, id, { x: 4, y: 1, rot: 0 });
    expect(vehicleStats(stacked, stacked.vehicles[0]).weapons.map((m) => m.def.id)).toEqual(['heavyMg']);
    const across = takeFromStorage(w, id, { x: 4, y: 0, rot: 1 });
    expect(vehicleStats(across, across.vehicles[0]).weapons).toHaveLength(0);
  });

  it('removing the panniers is blocked while their row holds items', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w = moveItem(w, good(w).id, { x: 0, y: rackRow, rot: 0 });
    expect(() => storePart(w, item(w, 'panniers').id)).toThrow('Refused: badLayout');
  });

  it('more parts mean less cargo room', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w.player.money = 2000;
    removeAllGoods(w.vehicles[0]);
    w = storePart(w, item(w, 'panniers').id);
    const free = freeCells(w.vehicles[0]);
    w = update(w, (d) => { d.player.storage.push(makePart(d, 'mg', 0)); });
    w = takeFromStorage(w, w.player.storage.find((p) => p.defId === 'mg')!.id, { x: 4, y: 1, rot: 0 });
    expect(freeCells(w.vehicles[0])).toBe(free - PARTS.mg.w * PARTS.mg.h);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(2);
  });

  it('goods and loose parts can be dumped, installed parts cannot', () => {
    const w = emptyWorld();
    const before = w.vehicles[0].items.filter((it) => it.kind === 'good').length;
    expect(dumpItem(w, good(w).id).vehicles[0].items.filter((it) => it.kind === 'good')).toHaveLength(before - 1);
    expect(() => dumpItem(w, item(w, 'mg').id)).toThrow('Remove an installed part');
    expect(stowPart(w, w.vehicles[0], makePart(w, 'mg', 0))).toBe(true);
    const loose = w.vehicles[0].items.filter((it) => it.kind === 'part' && it.part.defId === 'mg').at(-1)!;
    expect(dumpItem(w, loose.id).vehicles[0].items.some((it) => it.id === loose.id)).toBe(false);
  });
});

function mountedItemOf(v: Vehicle, defId: string): GridItem {
  return mountedItems(v).find((it) => it.part.defId === defId)!;
}

describe('auto mounting on the deck', () => {
  it('places a turret where no tall part blocks it', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    expect(mountPart(w, v, makePart(w, 'mg', 0))).toBe(true);
    expect(spanDegrees(gunSpans(v, mountedItemOf(v, 'mg')))).toBe(270);
  });

  it('places a cargo box where it blinds no mounted gun', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'longbed', ['stockEngine', 'mg'], { x: 40, y: 40 });
    const firing = (u: Vehicle) => gunSpans(u, mountedItemOf(u, 'mg'));
    const before = firing(v);
    expect(mountPart(w, v, makePart(w, 'trailerBox', 0))).toBe(true);
    expect(firing(v)).toEqual(before);
  });

  it('lets a gun and a cargo frame compete for the same deck cells', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    v.items.push({ id: 'i-rack', x: 2, y: 5, rot: 0, kind: 'part', part: makePart(w, 'rack', 0) });
    v.items.push({ id: 'i-mg', x: 4, y: 5, rot: 0, kind: 'part', part: makePart(w, 'mg', 0) });
    expect(mountedItems(v, 'cargo').map((it) => it.id)).toEqual(['i-rack']);
    expect(mountedItems(v, 'weapon').map((it) => it.id)).toEqual(['i-mg']);
  });
});

function freeDeck(v: Vehicle): void {
  removeAllGoods(v);
  v.items = v.items.filter((it) => it.kind === 'good' || !['mg', 'panniers'].includes(it.part.defId));
}

describe('stores', () => {
  it('unmounting a full store in town spills what no longer fits and logs it', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const me = w.vehicles[0];
    freeDeck(me);
    expect(mountPart(w, me, makePart(w, 'jerrycans', 0))).toBe(true);
    expect(mountPart(w, me, makePart(w, 'supplyLocker', 0))).toBe(true);
    w.player.fuel = fuelCap(me);
    w.player.supplies = suppliesCap(me);
    const noCans = storePart(w, item(w, 'jerrycans').id);
    expect(noCans.player.fuel).toBe(CHASSIS.scout.fuelCap);
    expect(noCans.events.filter((e) => e.t === 'supply').map((e) => e.note)).toEqual([{ id: 'noRoomFuel', fuel: 12 }]);
    const noLocker = storePart(noCans, item(noCans, 'supplyLocker').id);
    expect(noLocker.player.supplies).toBe(RULES.baseSupplies);
    expect(noLocker.events.filter((e) => e.t === 'supply').map((e) => e.note)).toEqual([{ id: 'noRoomSupplies', supplies: 10 }]);
  });

  it('unmounting a store with room to spare keeps every drop', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const me = w.vehicles[0];
    freeDeck(me);
    expect(mountPart(w, me, makePart(w, 'jerrycans', 0))).toBe(true);
    w.player.fuel = CHASSIS.scout.fuelCap - 1;
    const off = storePart(w, item(w, 'jerrycans').id);
    expect(off.player.fuel).toBe(CHASSIS.scout.fuelCap - 1);
    expect(off.events.some((e) => e.t === 'supply')).toBe(false);
  });
});

describe('spots for double click moves', () => {
  const partItem = (w: World, defId: string): Extract<GridItem, { kind: 'part' }> => ({ id: 'probe', x: 0, y: 0, rot: 0, kind: 'part', part: makePart(w, defId, 0) });

  it('installSpot finds a free mount that holds the part', () => {
    const w = emptyWorld();
    const probe = partItem(w, 'cage');
    const spot = installSpot(w.vehicles[0], probe);
    expect(spot).not.toBeNull();
    expect(isMounted('scout', { ...probe, ...spot! })).toBe(true);
  });

  it('installSpot is null when every fitting mount is taken', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    while (mountPart(w, me, makePart(w, 'cage', 0)));
    expect(installSpot(me, partItem(w, 'cage'))).toBeNull();
  });

  it('installSpot ignores the spare own cells', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const spare = { ...partItem(w, 'cage'), id: 'spare' };
    const spot = installSpot(me, spare)!;
    me.items.push({ ...spare, ...spot });
    expect(installSpot(me, { ...spare, ...spot })).toEqual(spot);
  });

  it('stowSpot keeps a part off the mounts', () => {
    const w = emptyWorld();
    removeAllGoods(w.vehicles[0]);
    const probe = partItem(w, 'cage');
    const spot = stowSpot(w.vehicles[0], probe);
    expect(spot).not.toBeNull();
    expect(isMounted('scout', { ...probe, ...spot! })).toBe(false);
  });

  it('stowSpot is null when the grid has no free plain cell', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    while (stowPart(w, me, makePart(w, 'cage', 0)));
    expect(stowSpot(me, partItem(w, 'cage'))).toBeNull();
  });
});

describe('garage work at every shop', () => {
  const pump = sitePads(siteOf('pump-station'))[0];
  const noShop: [string, { x: number; y: number }][] = [
    ['an oasis', sitePads(siteOf('dustwell'))[0]],
    ['a raider camp', sitePads(siteOf('scrapjaw'))[0]],
    ['open ground', { x: 30, y: 30 }],
  ];

  it('stores a part and installs it back at once on a stall pad', () => {
    let w = emptyWorld(pump);
    const mg = item(w, 'mg');
    w = storePart(w, mg.id);
    expect(w.player.storage.map((p) => p.defId)).toEqual(['mg']);
    w = takeFromStorage(w, w.player.storage[0].id, { x: mg.x, y: mg.y, rot: mg.rot });
    expect(w.vehicles[0].job).toBeNull();
    expect(w.player.storage).toEqual([]);
    expect(vehicleStats(w, w.vehicles[0]).weapons).toHaveLength(1);
  });

  it('swaps a spare with an installed part at once on a stall pad', () => {
    const w = emptyWorld(pump);
    const mg = item(w, 'mg');
    if (mg.kind !== 'part') throw new Error('Expected weapon');
    w.vehicles[0].items.push({ ...mg, id: 'spare-item', part: { ...mg.part, id: 'spare-part' }, x: 4, y: rackRow, rot: 1 });
    const next = moveItem(w, 'spare-item', { x: mg.x, y: mg.y, rot: 0 });
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: 4, y: rackRow, rot: 1 });
    expect(next.vehicles[0].items.find((it) => it.id === 'spare-item')).toMatchObject({ x: mg.x, y: mg.y });
  });

  it.each(noShop)('refuses storage and starts a refit job on %s', (_, pos) => {
    const w = emptyWorld(pos);
    expect(() => storePart(w, item(w, 'mg').id)).toThrow('Not parked at a shop');
    const stored = update(w, (d) => { d.player.storage.push(makePart(d, 'mg', 0)); });
    expect(() => takeFromStorage(stored, stored.player.storage[0].id, { x: 4, y: rackRow, rot: 1 })).toThrow('Not parked at a shop');
    const off = moveItem(w, item(w, 'mg').id, { x: 5, y: rackRow, rot: 1 });
    expect(off.vehicles[0].job).toMatchObject({ kind: 'refit' });
  });

  it('canStowPart agrees with stowPart', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    while (canStowPart(me, makePart(w, 'cage', 0))) expect(stowPart(w, me, makePart(w, 'cage', 0))).toBe(true);
    expect(stowPart(w, me, makePart(w, 'cage', 0))).toBe(false);
  });

  describe('startRefit', () => {
    const withSpare = () => {
      const w = emptyWorld();
      const mg = item(w, 'mg');
      if (mg.kind !== 'part') throw new Error('Expected weapon');
      w.vehicles[0].items.push({ ...mg, id: 'spare-item', part: { ...mg.part, id: 'spare-part' }, x: 4, y: rackRow, rot: 1 });
      return { w, mg };
    };

    it('runs one job for a plan of several moves, with turns from the original layout', () => {
      const { w, mg } = withSpare();
      const layout = { 'spare-item': { x: mg.x, y: mg.y, rot: 0 as const }, [mg.id]: { x: 4, y: rackRow, rot: 1 as const } };
      const next = startRefit(w, layout);
      expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', total: 10 });
      expect(plannedRefitTurns(w, w.vehicles[0], layout)).toBe(10);
      for (let turn = 0; turn < 10; turn++) advanceJobs(next);
      expect(next.vehicles[0].items.find((it) => it.id === 'spare-item')).toMatchObject({ x: mg.x, y: mg.y });
      expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: 4, y: rackRow, rot: 1 });
    });

    it('charges nothing for a part the plan puts back where it started', () => {
      const { w, mg } = withSpare();
      const turned = { x: 4, y: rackRow, rot: 3 as const };
      const layout = { [mg.id]: { x: mg.x, y: mg.y, rot: mg.rot }, 'spare-item': turned };
      expect(plannedRefitTurns(w, w.vehicles[0], layout)).toBe(0);
      const next = startRefit(w, layout);
      expect(next.vehicles[0].job).toBeNull();
      expect(next.vehicles[0].items.find((it) => it.id === 'spare-item')).toMatchObject(turned);
      expect(next.vehicles[0].items.find((it) => it.id === mg.id)).toMatchObject({ x: mg.x, y: mg.y });
    });

    it('turns a gun in place for the price of its mount', () => {
      const w = emptyWorld();
      const mg = item(w, 'mg');
      const next = startRefit(w, { [mg.id]: { x: mg.x, y: mg.y, rot: 2 } });
      expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', moves: [{ itemId: mg.id, to: { rot: 2 } }] });
    });

    it('applies at once at a shop', () => {
      const w = emptyWorld(sitePads(bowl)[0]);
      const mg = item(w, 'mg');
      const free = stowSpot(w.vehicles[0], mg);
      if (!free) throw new Error('No storage room');
      const next = startRefit(w, { [mg.id]: free });
      expect(next.vehicles[0].job).toBeNull();
      expect(spareParts(next.vehicles[0]).map((p) => p.defId)).toEqual(['mg']);
    });

    it('throws on a plan that is empty, overlaps, moves a built-in part or names no item', () => {
      const { w, mg } = withSpare();
      const core = w.vehicles[0].items.find((it) => it.kind === 'part' && PARTS[it.part.defId].kind === 'core')!;
      expect(() => startRefit(w, {})).toThrow(/changes nothing/);
      expect(() => startRefit(w, { [mg.id]: { x: mg.x, y: mg.y, rot: mg.rot } })).toThrow(/changes nothing/);
      expect(() => startRefit(w, { [good(w).id]: { x: 9, y: 0, rot: 0 } })).toThrow(/badLayout/);
      expect(() => startRefit(w, { [core.id]: { x: 0, y: rackRow, rot: 0 } })).toThrow(/builtInFixed/);
      expect(() => startRefit(w, { nope: { x: 0, y: 0, rot: 0 } })).toThrow(/No item/);
      expect(() => startRefit(w, { 'spare-item': { x: mg.x, y: mg.y, rot: 0 } })).toThrow(/badLayout/);
    });

    it('throws while a refit runs', () => {
      const { w, mg } = withSpare();
      const running = startRefit(w, { [mg.id]: { x: mg.x, y: mg.y, rot: 2 } });
      expect(() => startRefit(running, { [good(w).id]: { x: 0, y: rackRow, rot: 0 } })).toThrow(/refitRunning/);
    });
  });
});

describe('cargo room in crates', () => {
  it('a player fits as many crates as free cells, and none on a full grid', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'player', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    expect(cargoMassRoom(v)).toBe(Infinity);
    expect(cargoRoom(v)).toBe(freeCells(v));
    addGoods(w, v, 'tools', 1000);
    expect(freeCells(v)).toBe(0);
    expect(cargoRoom(v)).toBe(0);
    expect(hasCargoRoom(v)).toBe(false);
  });

  it('an NPC fits the fewer of its free cells and the crates its mass room holds', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'hauler', ['mg', 'stockEngine'], { x: 40, y: 40 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    expect(cargoRoom(npc)).toBe(freeCells(npc));
    const crates = Math.min(freeCells(npc), Math.floor(npcMassRoom(npc) / CRATE_MASS));
    expect(cargoRoom(npc)).toBe(crates);
    expect(addGoods(w, npc, 'electronics', 1000)).toBe(crates);
    expect(cargoRoom(npc)).toBe(0);
    expect(hasCargoRoom(npc)).toBe(false);
  });
});
