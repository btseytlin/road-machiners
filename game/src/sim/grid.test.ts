import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { NPCS } from '../data/npcs';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { buyChassis } from './economy';
import { partDef } from '../data/parts';
import { makePart, makeVehicle } from './factory';
import { baseGrid, cellCount, freeCells, gridOf, isMounted, onDeadRow, placementError, itemCells, mountedItems, mountedParts, plateSide, sideOf, type Cell } from './grid';
import { moveItem, storePart } from './inventory';
import { generateNpcLoadout } from './npc-loadout';
import { addVehicle, emptyWorld } from './testkit';
import type { GridItem, Vehicle, World } from './types';
import { sitePads } from './sites';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;

const coreIds = (v: Vehicle) => mountedParts(v, 'core').map((p) => p.defId).sort();
const roleOf = (defId: string) => { const def = partDef(defId); return def.kind === 'core' ? def.role : null; };
const coreItem = (w: World, role: string) => w.vehicles[0].items.find((it) => it.kind === 'part' && roleOf(it.part.defId) === role)!;

function spotOn(chassisId: string, defId: string, letter: Cell, items: GridItem[]): GridItem {
  const g = baseGrid(chassisId);
  const taken = new Set(items.flatMap((it) => itemCells(it).map((c) => `${c.x},${c.y}`)));
  for (const rot of [0, 1] as const) {
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const item: GridItem = { id: 'probe', x, y, rot, kind: 'part', part: { id: 'probe', defId, hp: 1, wear: 0 } };
        const cells = itemCells(item);
        if (cells.every((c) => g.cells[c.y]?.[c.x] === letter && !taken.has(`${c.x},${c.y}`))) return item;
      }
    }
  }
  throw new Error(`No ${letter} spot for ${defId} on ${chassisId}`);
}

describe('built-in parts', () => {
  it('every chassis builds with all its core parts mounted', () => {
    for (const ch of Object.values(CHASSIS)) {
      const w = emptyWorld();
      const v = addVehicle(w, 'raiders', ch.id, [], { x: 40, y: 40 });
      const want = ch.core.map((c) => c.defId).sort();
      const roles = want.map(roleOf);
      expect(roles.filter((r) => r === 'cab')).toHaveLength(1);
      expect(roles.filter((r) => r === 'wheel')).toHaveLength(4);
      expect(roles.filter((r) => r === 'transmission')).toHaveLength(1);
      expect(roles.filter((r) => r === 'tank')).toHaveLength(1);
      expect(coreIds(v)).toEqual(want);
    }
  });

  it('every NPC template mounts all its parts', () => {
    for (const tpl of Object.values(NPCS)) {
      const w = emptyWorld();
      const loadout = generateNpcLoadout(w, tpl);
      const v = makeVehicle(w, { name: tpl.name, faction: tpl.faction, ...loadout, pos: { x: 40, y: 40 }, heading: 0, brain: null });
      const mounted = mountedParts(v).map((p) => p.defId).filter((id) => PARTS[id].kind !== 'core');
      expect(mounted.sort()).toEqual(loadout.parts.map((p) => p.defId).sort());
    }
  });

  it('moving or storing a core part throws', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const cab = coreItem(w, 'cab');
    expect(() => moveItem(w, cab.id, { x: cab.x, y: cab.y, rot: cab.rot })).toThrow(/built.in/i);
    expect(() => storePart(w, cab.id)).toThrow(/built.in/i);
  });

  it('shops never stock core parts', () => {
    const w = emptyWorld(sitePads(bowl)[0]);
    const stocked = Object.values(w.shops).flatMap((shop) => shop.stock);
    expect(stocked.some((p) => partDef(p.defId).kind === 'core')).toBe(false);
  });

  it('a chassis swap replaces the core parts with the new chassis ones', () => {
    let w = emptyWorld(sitePads(bowl)[0]);
    w.player.money = CHASSIS.hauler.value;
    w.vehicles[0].items.forEach((it) => { if (it.kind === 'part' && roleOf(it.part.defId) === 'cab') it.part.hp = 1; });
    w = buyChassis(w, 'hauler');
    const me = w.vehicles[0];
    expect(coreIds(me)).toEqual(CHASSIS.hauler.core.map((c) => c.defId).sort());
    expect(mountedParts(me, 'core').every((p) => p.hp === PARTS[p.defId].hp)).toBe(true);
    expect(w.player.storage.filter((p) => PARTS[p.defId].kind === 'core')).toHaveLength(0);
  });
});

describe('cargo rows', () => {
  it('rejects an item across the end of the chassis grid', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', [], { x: 40, y: 40 });
    v.items.push({ ...spotOn('scout', 'rack', 'D', v.items), id: 'i-rack', part: makePart(w, 'rack', 0) } as GridItem);
    const g = gridOf(v);
    const spare = (y: number, rot: 0 | 1): GridItem => ({ id: 'i-spare', x: 1, y, rot, kind: 'part', part: makePart(w, 'rack', 0) });
    expect(g.cells[g.chassisH][1]).toBe('.');
    expect(placementError(g, v.items, spare(g.chassisH - 1, 1), null)).toBe('Does not fit there');
    expect(placementError(g, v.items, spare(g.chassisH, 0), null)).toBeNull();
  });
});

describe('broken cargo rows', () => {
  function boxTruck(parts: string[]) {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', parts, { x: 40, y: 40 });
    const box = mountedParts(v, 'cargo').find((p) => p.defId === 'trailerBox')!;
    return { v, box };
  }

  it('a broken cargo box keeps its rows in the grid but makes them dead', () => {
    const { v, box } = boxTruck(['trailerBox']);
    const working = gridOf(v);
    const free = freeCells(v);
    box.hp = 0;
    const g = gridOf(v);
    expect(g.h).toBe(working.h);
    expect(g.deadFrom).toBe(g.h - 3);
    expect(g.cells.slice(g.deadFrom).every((row) => row.every((c) => c === null))).toBe(true);
    expect(freeCells(v)).toBe(free - 3 * g.w);
  });

  it('working cargo rows come before the dead rows', () => {
    const { v, box } = boxTruck(['rack', 'trailerBox']);
    box.hp = 0;
    const g = gridOf(v);
    expect(g.deadFrom).toBe(g.chassisH + 1);
    expect(g.cells[g.chassisH].every((c) => c === '.')).toBe(true);
    expect(g.h - g.deadFrom).toBe(3);
  });

  it('rejects an item on a dead row', () => {
    const { v, box } = boxTruck(['trailerBox']);
    box.hp = 0;
    const g = gridOf(v);
    const salt: GridItem = { id: 'i-salt', x: 0, y: g.h - 1, rot: 0, kind: 'good', good: 'salt' };
    expect(placementError(g, v.items, salt, null)).toBe('Does not fit there');
    expect(onDeadRow(g, salt)).toBe(true);
    expect(onDeadRow(g, { ...salt, y: g.deadFrom - 1 })).toBe(false);
  });

  it('repairing the box brings its rows back', () => {
    const { v, box } = boxTruck(['trailerBox']);
    box.hp = 0;
    gridOf(v);
    box.hp = 1;
    const g = gridOf(v);
    expect(g.deadFrom).toBe(g.h);
    expect(g.cells.slice(g.chassisH).every((row) => row.every((c) => c === '.'))).toBe(true);
  });
});

describe('side armor mounts', () => {
  for (const letter of ['F', 'B', 'L', 'R'] as const) {
    it(`armor mounts on ${letter}`, () => {
      const w = emptyWorld();
      const v = addVehicle(w, 'raiders', 'hauler', [], { x: 40, y: 40 });
      const plate: GridItem = { ...spotOn('hauler', 'plates', letter, v.items), id: 'i-plate', part: makePart(w, 'plates', 0) } as GridItem;
      v.items.push(plate);
      expect(isMounted('hauler', plate)).toBe(true);
      expect(sideOf(v, (plate as Extract<GridItem, { kind: 'part' }>).part)).toBe(letter);
    });
  }

  it('a part spanning two letters is not mounted', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', [], { x: 40, y: 40 });
    const onL = spotOn('hauler', 'plates', 'L', v.items);
    const g = baseGrid('hauler');
    const across: GridItem = { ...onL, rot: 1, id: 'i-plate', part: makePart(w, 'plates', 0) } as GridItem;
    const letters = new Set(itemCells(across).map((c) => g.cells[c.y][c.x]));
    expect(letters.has('L')).toBe(true);
    expect(letters.size).toBeGreaterThan(1);
    expect(isMounted('hauler', across)).toBe(false);
  });

  it('plateSide gives a mounted plate its mount side, even a square one', () => {
    for (const letter of ['F', 'B', 'L', 'R'] as const) expect(plateSide('hauler', spotOn('hauler', 'steelPlate', letter, []))).toBe(letter);
  });

  it('plateSide lays a spare plate on the front when it lies wide and on the left when it lies tall', () => {
    const spare = (rot: 0 | 1): GridItem => ({ id: 'i-plate', x: 0, y: 20, rot, kind: 'part', part: { id: 'p', defId: 'plates', hp: 1, wear: 0 } });
    const wide = partDef('plates').w > partDef('plates').h;
    expect(plateSide('hauler', spare(0))).toBe(wide ? 'F' : 'L');
    expect(plateSide('hauler', spare(1))).toBe(wide ? 'L' : 'F');
  });

  it('sideOf is null for parts that are not mounted armor', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['mg'], { x: 40, y: 40 });
    expect(sideOf(v, mountedParts(v, 'weapon')[0])).toBeNull();
  });

  it('NPC armor takes the front first', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'wagon', ['plates'], { x: 40, y: 40 });
    const [plate] = mountedItems(v, 'armor');
    expect(sideOf(v, plate.part)).toBe('F');
  });

  it('every part states its armor', () => {
    for (const p of Object.values(PARTS)) expect(p.armor).toBeGreaterThan(0);
  });

  it('the ram multiplies ram damage, plates and cage do not', () => {
    const ram = PARTS.ram;
    if (ram.kind !== 'armor') throw new Error('ram must be armor');
    expect(ram.ramMult).toBeGreaterThan(1);
    for (const id of ['plates', 'cage']) {
      const d = PARTS[id];
      if (d.kind !== 'armor') throw new Error(`${id} must be armor`);
      expect(d.ramMult).toBe(1);
    }
  });
});

const OPEN_RING = ['buggy', 'courier', 'jeep'];
const FACES: Record<string, { dx: number; dy: number }> = { F: { dx: 0, dy: -1 }, B: { dx: 0, dy: 1 }, L: { dx: -1, dy: 0 }, R: { dx: 1, dy: 0 } };

function openFaces(chassisId: string, x: number, y: number): string[] {
  const g = baseGrid(chassisId);
  return Object.entries(FACES).filter(([, f]) => g.cells[y + f.dy]?.[x + f.dx] == null).map(([letter]) => letter);
}

function cellsOfLayout(chassisId: string): { x: number; y: number; letter: Cell }[] {
  const g = baseGrid(chassisId);
  return g.cells.flatMap((row, y) => row.flatMap((letter, x) => (letter === null ? [] : [{ x, y, letter }])));
}

describe('armor ring', () => {
  it('leaves the four corner cells out of every chassis', () => {
    for (const id of Object.keys(CHASSIS)) {
      const g = baseGrid(id);
      const corners = [g.cells[0][0], g.cells[0][g.w - 1], g.cells[g.h - 1][0], g.cells[g.h - 1][g.w - 1]];
      expect(corners, id).toEqual([null, null, null, null]);
    }
  });

  it('puts an armor mount on every outline cell, on a side that cell faces', () => {
    for (const id of Object.keys(CHASSIS).filter((c) => !OPEN_RING.includes(c))) {
      for (const { x, y, letter } of cellsOfLayout(id)) {
        const faces = openFaces(id, x, y);
        if (faces.length > 0) expect(faces, `${id} ${x},${y}`).toContain(letter);
      }
    }
  });

  it('keeps armor mounts off the inside of the ring', () => {
    for (const id of Object.keys(CHASSIS).filter((c) => !OPEN_RING.includes(c))) {
      for (const { x, y, letter } of cellsOfLayout(id)) {
        if (openFaces(id, x, y).length === 0) expect('FBLR'.includes(letter), `${id} ${x},${y}`).toBe(false);
      }
    }
  });
});

describe('side armor skin', () => {
  const probe = (defId: string, x: number, y: number): GridItem => ({ id: 'probe', x, y, rot: 0, kind: 'part', part: { id: 'probe', defId, hp: 1, wear: 0 } });

  it('lets armor lie on a side column and refuses every other item there', () => {
    const g = baseGrid('scout');
    expect(placementError(g, [], probe('steelPlate', 0, 2), null)).toBeNull();
    expect(placementError(g, [], probe('mg', 0, 2), null)).toMatch(/only armor/i);
    expect(placementError(g, [], { id: 'g', x: g.w - 1, y: 2, rot: 0, kind: 'good', good: 'scrap' }, null)).toMatch(/only armor/i);
  });

  it('does not count the side columns as cargo cells', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', [], { x: 40, y: 40 });
    const g = baseGrid('scout');
    const skin = g.cells.flat().filter((c) => c === 'L' || c === 'R').length;
    expect(skin).toBe(2 * (g.h - 2));
    expect(cellCount(g)).toBe(g.cells.flat().filter((c) => c !== null).length - skin);
    const before = freeCells(v);
    v.items.push({ id: 'i-plate', x: 0, y: 2, rot: 0, kind: 'part', part: makePart(w, 'steelPlate', 0) });
    expect(freeCells(v)).toBe(before);
  });
});
