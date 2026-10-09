// Inventory grid queries. The grid comes from the chassis layout plus rows added by mounted cargo parts.

import { chassisDef } from '../data/chassis';
import { partDef, type CoreDef, type PartKind } from '../data/parts';
import type { GridItem, PartInstance, Vehicle } from './types';

export type SideLetter = 'F' | 'B' | 'L' | 'R';
export type Cell = 'D' | 'E' | SideLetter | 'X' | '.';
export type Grid = { w: number; h: number; chassisH: number; deadFrom: number; cells: (Cell | null)[][] };
export type Spot = { x: number; y: number; rot: 0 | 1 };

export const MOUNT_CELLS: Record<PartKind, Cell[]> = {
  weapon: ['D'],
  engine: ['E'],
  armor: ['F', 'B', 'L', 'R'],
  cargo: ['D'],
  core: ['X'],
  scanner: ['D'],
  store: ['D'],
  utility: ['D'],
};
const SIDES: readonly Cell[] = ['F', 'B', 'L', 'R'];
const CELL_CHARS: readonly string[] = ['D', 'E', 'F', 'B', 'L', 'R', 'X', '.'];

const baseGridCache = new Map<string, Grid>();

export function baseGrid(chassisId: string): Grid {
  const cached = baseGridCache.get(chassisId);
  if (cached) return cached;
  const rows = chassisDef(chassisId).layout;
  const w = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: w }, (_, x) => toCell(r[x] ?? ' ')));
  const grid = { w, h: rows.length, chassisH: rows.length, deadFrom: rows.length, cells };
  baseGridCache.set(chassisId, grid);
  return grid;
}

function toCell(ch: string): Cell | null {
  if (ch === ' ') return null;
  if (CELL_CHARS.includes(ch)) return ch as Cell;
  throw new Error(`Bad layout character "${ch}"`);
}

export function itemSize(item: Pick<GridItem, 'rot'> & ({ kind: 'part'; part: PartInstance } | { kind: 'good' })): { w: number; h: number } {
  if (item.kind === 'good') return { w: 1, h: 1 };
  const d = partDef(item.part.defId);
  return item.rot === 1 ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}

export function itemCells(item: GridItem): { x: number; y: number }[] {
  const { w, h } = itemSize(item);
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: item.x + dx, y: item.y + dy });
  return out;
}

export function isMounted(chassisId: string, item: GridItem): boolean {
  return mountLetter(chassisId, item) !== null;
}

export function plateSide(chassisId: string, item: GridItem): SideLetter {
  const letter = mountLetter(chassisId, item);
  if (letter !== null && SIDES.includes(letter)) return letter as SideLetter;
  const size = itemSize(item);
  return size.w >= size.h ? 'F' : 'L';
}

function mountLetter(chassisId: string, item: GridItem): Cell | null {
  if (item.kind !== 'part') return null;
  const base = baseGrid(chassisId);
  const first = letterAt(base, item.x, item.y);
  if (first === null || !MOUNT_CELLS[partDef(item.part.defId).kind].includes(first)) return null;
  return coversOnly(base, item, first) ? first : null;
}

function letterAt(g: Grid, x: number, y: number): Cell | null {
  return g.cells[y]?.[x] ?? null;
}

function coversOnly(g: Grid, item: GridItem & { kind: 'part' }, letter: Cell): boolean {
  const { w, h } = itemSize(item);
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (letterAt(g, item.x + dx, item.y + dy) !== letter) return false;
  return true;
}

export function sideOf(v: Vehicle, part: PartInstance): SideLetter | null {
  const item = v.items.find((it) => it.kind === 'part' && it.part.id === part.id);
  if (!item) throw new Error(`Part ${part.id} is not on ${v.id}`);
  const letter = mountLetter(v.chassisId, item);
  return letter !== null && SIDES.includes(letter) ? (letter as SideLetter) : null;
}

const gridCache = new Map<string, Grid>();

export function gridOf(v: Vehicle): Grid {
  const base = baseGrid(v.chassisId);
  let working = 0;
  let dead = 0;
  for (const it of mountedItems(v, 'cargo')) {
    const rows = (partDef(it.part.defId) as { extraRows: number }).extraRows;
    if (it.part.hp > 0) working += rows;
    else dead += rows;
  }
  const key = `${v.chassisId}|${working}|${dead}`;
  const cached = gridCache.get(key);
  if (cached) return cached;
  const row = (cell: Cell | null) => Object.freeze(Array.from({ length: base.w }, () => cell));
  const rows = [...Array.from({ length: working }, () => row('.')), ...Array.from({ length: dead }, () => row(null))];
  const grid = Object.freeze({
    w: base.w,
    h: base.h + working + dead,
    chassisH: base.h,
    deadFrom: base.h + working,
    cells: Object.freeze([...base.cells, ...rows]) as (Cell | null)[][],
  });
  gridCache.set(key, grid);
  return grid;
}

// Net cells a working mounted cargo part adds on this chassis: its full-width rows, less the deck cells it sits on,
// which would otherwise hold cargo. Throws for a part that is not cargo.
export function cargoCellsGained(chassisId: string, defId: string): number {
  const def = partDef(defId);
  if (def.kind !== 'cargo') throw new Error(`${defId} is not a cargo part`);
  return def.extraRows * baseGrid(chassisId).w - def.w * def.h;
}

// True when any cell of the item lies on a broken cargo part's dead row.
export function onDeadRow(g: Grid, item: GridItem): boolean {
  return itemCells(item).some((c) => c.y >= g.deadFrom && c.y < g.h);
}

type PartItem = Extract<GridItem, { kind: 'part' }>;

export function mountedItems(v: Vehicle, kind?: PartKind): PartItem[] {
  const out: PartItem[] = [];
  for (const it of v.items) if (it.kind === 'part' && (!kind || partDef(it.part.defId).kind === kind) && isMounted(v.chassisId, it)) out.push(it);
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function mountedParts(v: Vehicle, kind?: PartKind): PartInstance[] {
  return mountedItems(v, kind).map((it) => it.part);
}

export function coreParts(v: Vehicle, role: CoreDef['role']): PartInstance[] {
  return mountedParts(v, 'core').filter((p) => (partDef(p.defId) as CoreDef).role === role);
}

export function corePart(v: Vehicle, role: CoreDef['role']): PartInstance {
  const parts = coreParts(v, role);
  if (parts.length !== 1) throw new Error(`${v.id} has ${parts.length} mounted ${role} parts, expected 1`);
  return parts[0];
}

export function isLoot(chassisId: string, item: GridItem): boolean {
  return item.kind === 'good' || partDef(item.part.defId).kind !== 'core' || !isMounted(chassisId, item);
}

export function hasLoot(v: Vehicle): boolean {
  return v.items.some((item) => isLoot(v.chassisId, item));
}

export function goodsCount(v: Vehicle): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of v.items) if (it.kind === 'good') out[it.good] = (out[it.good] ?? 0) + 1;
  return out;
}

function isSkin(cell: Cell | null): boolean {
  return cell === 'L' || cell === 'R';
}

export function cellCount(g: Grid): number {
  return g.cells.flat().filter((c) => c !== null && !isSkin(c)).length;
}

export function freeCells(v: Vehicle): number {
  const g = gridOf(v);
  const used = v.items.reduce((a, it) => a + itemCells(it).filter((c) => !isSkin(g.cells[c.y]?.[c.x] ?? null)).length, 0);
  return cellCount(g) - used;
}

export function placementError(g: Grid, items: GridItem[], item: GridItem, ignoreId: string | null): string | null {
  const taken = takenCells(items, ignoreId);
  const cells = itemCells(item);
  if (crossesChassisEnd(g, cells) || !cells.every((c) => onGrid(g, c))) return 'Does not fit there';
  if (cells.some((c) => taken.has(cellKey(c.x, c.y)))) return 'Something is in the way';
  if (!isArmorItem(item) && cells.some((c) => isSkin(g.cells[c.y][c.x]))) return 'Only armor fits on the sides';
  return null;
}

function isArmorItem(item: GridItem): boolean {
  return item.kind === 'part' && partDef(item.part.defId).kind === 'armor';
}

function onGrid(g: Grid, c: { x: number; y: number }): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h && g.cells[c.y][c.x] !== null;
}

function crossesChassisEnd(g: Grid, cells: { y: number }[]): boolean {
  const onChassis = cells.filter((c) => c.y < g.chassisH).length;
  return onChassis !== 0 && onChassis !== cells.length;
}

export function findSpot(g: Grid, items: GridItem[], item: GridItem, mount: Cell[] | null, avoid: Cell[] | null): Spot | null {
  if (mount) return mountSpots(g, items, item, mount)[0] ?? null;
  const tries = allSpots(g);
  const fits = (s: Spot) => placementError(g, items, { ...item, ...s }, item.id) === null;
  const onlyOn = (s: Spot, cell: Cell) => itemCells({ ...item, ...s }).every((c) => g.cells[c.y]?.[c.x] === cell);
  const allowed = (s: Spot) => fits(s) && !(avoid && avoid.some((a) => onlyOn(s, a)));
  return tries.find((s) => allowed(s) && onlyOn(s, '.')) ?? tries.find(allowed) ?? null;
}

export function mountSpots(g: Grid, items: GridItem[], item: GridItem, mount: Cell[]): Spot[] {
  const taken = takenCells(items, item.id);
  const tries = allSpots(g);
  const sizes = [itemSize({ ...item, rot: 0 }), itemSize({ ...item, rot: 1 })];
  const free = (s: Spot, letter: Cell) => {
    const { w, h } = sizes[s.rot];
    for (let dy = 0; dy < h; dy++) {
      const row = g.cells[s.y + dy];
      for (let dx = 0; dx < w; dx++) if (row?.[s.x + dx] !== letter || taken.has(cellKey(s.x + dx, s.y + dy))) return false;
    }
    return true;
  };
  return mount.flatMap((letter) => tries.filter((s) => free(s, letter)));
}

const KEY_ROW = 1024;

export function cellKey(x: number, y: number): number {
  return y * KEY_ROW + x;
}

function takenCells(items: GridItem[], ignoreId: string | null): Set<number> {
  const taken = new Set<number>();
  for (const it of items) {
    if (it.id === ignoreId) continue;
    const { w, h } = itemSize(it);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) taken.add(cellKey(it.x + dx, it.y + dy));
  }
  return taken;
}

const spotCache = new Map<number, readonly Spot[]>();

function allSpots(g: Grid): readonly Spot[] {
  const key = cellKey(g.w, g.h);
  const cached = spotCache.get(key);
  if (cached) return cached;
  const tries: Spot[] = [];
  for (const rot of [0, 1] as const) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) tries.push(Object.freeze({ x, y, rot }));
  spotCache.set(key, tries);
  return tries;
}
