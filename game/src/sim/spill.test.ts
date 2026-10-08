import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { gridOf, itemCells, mountedParts } from './grid';
import { moveItem } from './inventory';
import { makePart } from './factory';
import { spillDeadRows } from './spill';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import type { GameEvent, GridItem, PartInstance, Vehicle, World } from './types';
import { endTurn } from './world';
import { maxHp } from './wear';
import { WEAR } from '../data/wear';

const panniersOf = (v: Vehicle): PartInstance => mountedParts(v, 'cargo').find((p) => p.defId === 'panniers')!;
const lastRow = (v: Vehicle) => gridOf(v).h - 1;
const onRow = (v: Vehicle, y: number) => v.items.filter((it) => itemCells(it).some((c) => c.y === y));
const spills = (w: World) => w.events.filter((e): e is Extract<GameEvent, { t: 'cargoSpilled' }> => e.t === 'cargoSpilled');
const unitsOn = (v: Vehicle) => v.items.length;
const pileUnits = (w: World) => w.salvage.filter((s) => s.pile).reduce((n, s) => n + Object.values(s.goods).reduce((a, b) => a + b, 0) + s.parts.length, 0);

function loadedPlayer(): { w: World; me: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const y = lastRow(me);
  me.items = me.items.filter((it) => !onRow(me, y).includes(it));
  const g = gridOf(me);
  for (let x = 0; x < g.w; x++) if (g.cells[y][x] === '.') me.items.push({ id: `salt-${x}`, x, y, rot: 0, kind: 'good', good: 'salt' });
  w.player.costBasis.salt = 20;
  return { w, me };
}

describe('cargo spills', () => {
  it('a broken cargo part drops what lies on its rows onto a player pile at the truck', () => {
    const { w, me } = loadedPlayer();
    const salt = onRow(me, lastRow(me)).length;
    const kept = me.items.filter((it) => it.y < lastRow(me)).map((it) => ({ ...it }));
    const before = unitsOn(me);
    panniersOf(me).hp = 0;
    const next = endTurn(w, testDrive);
    const mine = next.vehicles[0];
    const piles = next.salvage.filter((s) => s.pile);
    expect(piles).toHaveLength(1);
    expect(piles[0].goods.salt).toBe(salt);
    expect(piles[0].pile!.fromPlayer).toBe(true);
    expect(piles[0].pile!.basis.salt).toBe(20);
    expect(mine.items).toEqual(kept);
    expect(unitsOn(mine) + pileUnits(next)).toBe(before);
    expect(spills(next)).toEqual([{ t: 'cargoSpilled', vehicle: mine.id, part: panniersOf(mine).id, pile: piles[0].id, units: salt }]);
  });

  it('a spilled part keeps its id, wear and HP', () => {
    const { w, me } = loadedPlayer();
    const spare = makePart(w, 'mg', 2);
    spare.hp = 7;
    me.items = me.items.filter((it) => it.id !== 'salt-1');
    me.items.push({ id: 'i-spare', x: 1, y: lastRow(me), rot: 0, kind: 'part', part: spare });
    panniersOf(me).hp = 0;
    spillDeadRows(w);
    const pile = w.salvage.find((s) => s.pile)!;
    expect(pile.parts).toEqual([{ ...spare }]);
  });

  it('an item lying partly on a dead row spills whole', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['rack', 'trailerBox'], { x: 60, y: 60 });
    const g = gridOf(npc);
    const box = mountedParts(npc, 'cargo').find((p) => p.defId === 'trailerBox')!;
    const rackRows = (partDef('rack') as { extraRows: number }).extraRows;
    const tall: GridItem = { id: 'i-tall', x: 0, y: g.chassisH + rackRows - 1, rot: 1, kind: 'part', part: makePart(w, 'rack', 0) };
    npc.items.push(tall);
    box.hp = 0;
    expect(gridOf(npc).deadFrom).toBe(g.chassisH + rackRows);
    spillDeadRows(w);
    expect(npc.items.some((it) => it.id === 'i-tall')).toBe(false);
    const pile = w.salvage.find((s) => s.pile)!;
    expect(pile.parts.map((p) => p.id)).toEqual([tall.part.id]);
    expect(pile.pile!.fromPlayer).toBe(false);
  });

  it('a second spill beside the first joins its pile', () => {
    const { w, me } = loadedPlayer();
    const box = panniersOf(me);
    box.hp = 0;
    spillDeadRows(w);
    box.hp = 5;
    me.items.push({ id: 'salt-again', x: 1, y: lastRow(me), rot: 0, kind: 'good', good: 'salt' });
    box.hp = 0;
    spillDeadRows(w);
    const piles = w.salvage.filter((s) => s.pile);
    expect(piles).toHaveLength(1);
    expect(spills(w).map((e) => e.pile)).toEqual([piles[0].id, piles[0].id]);
  });

  it('a repaired cargo part gives its rows back empty and spills nothing more', () => {
    const { w, me } = loadedPlayer();
    const box = panniersOf(me);
    box.hp = 0;
    spillDeadRows(w);
    box.hp = 5;
    spillDeadRows(w);
    const g = gridOf(me);
    expect(g.deadFrom).toBe(g.h);
    expect(onRow(me, lastRow(me))).toEqual([]);
    expect(spills(w)).toHaveLength(1);
  });

  it('wear that breaks a cargo part on the road spills it in the same turn', () => {
    const { w, me } = loadedPlayer();
    const box = panniersOf(me);
    box.hp = maxHp(box) * WEAR.hpShare;
    const salt = onRow(me, lastRow(me)).length;
    const rough = (world: World) => {
      const v = world.vehicles[0];
      v.trail = Array.from({ length: 200 }, (_, i) => ({ x: i % 2 === 0 ? 30 : 90, y: 30, heading: 0 }));
      v.speed = 5;
    };
    const next = endTurn(w, rough);
    expect(panniersOf(next.vehicles[0]).hp).toBe(0);
    expect(spills(next).map((e) => e.units)).toEqual([salt]);
    expect(onRow(next.vehicles[0], lastRow(next.vehicles[0]))).toEqual([]);
  });

  it('an open refit that moved a spilled item cancels', () => {
    const { w, me } = loadedPlayer();
    const gun = me.items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    const target = onRow(me, lastRow(me))[0];
    let next = moveItem(w, gun.id, { x: target.x, y: target.y, rot: gun.rot });
    expect(next.vehicles[0].job?.kind).toBe('refit');
    panniersOf(next.vehicles[0]).hp = 0;
    next = endTurn(next, testDrive);
    expect(next.vehicles[0].job).toBeNull();
  });
});
