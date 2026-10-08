import { RULES } from '../data/rules';
import { PHYSICS } from '../data/physics';
import { bodyOf } from './body';

import { partDef, type PartDef, type WeaponDef } from '../data/parts';
import { wornDef } from './wear';
import { damagePart } from './damage';
import { cellKey, gridOf, itemCells, itemSize, mountedItems, mountedParts, sideOf, type Grid, type SideLetter } from './grid';
import type { GridItem, PartInstance, Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

export type Side = 'front' | 'rear' | 'left' | 'right';
export type PartHit = { part: string; damage: number };
export type Round = { damage: number; pen: number; blast: boolean; armorShare: number };

const QUARTER = Math.PI / 4;

export function sideToward(v: Vehicle, p: Vec): Side {
  const rel = angleDiff(v.heading, bearing(v.pos, p));
  if (Math.abs(rel) <= QUARTER) return 'front';
  if (Math.abs(rel) >= 3 * QUARTER) return 'rear';
  return rel > 0 ? 'right' : 'left';
}

const LETTER: Record<Side, SideLetter> = { front: 'F', rear: 'B', left: 'L', right: 'R' };

export function ramMult(v: Vehicle, side: Side): number {
  let mult = 1;
  for (const p of mountedParts(v, 'armor')) {
    const def = partDef(p.defId);
    if (def.kind !== 'armor') throw new Error(`${p.id} is mounted as armor but is ${def.kind}`);
    if (p.hp > 0 && sideOf(v, p) === LETTER[side]) mult = Math.max(mult, def.ramMult);
  }
  return mult;
}

export function cabShield(v: Vehicle): number {
  const g = gridOf(v);
  const cab = mountedItems(v, 'core').filter((it) => isCab(partDef(it.part.defId))).flatMap(itemCells);
  const cabLanes = new Set(cab.flatMap((c) => [`F${c.x}`, `B${c.x}`, `L${c.y}`, `R${c.y}`]));
  const shielded = new Set(mountedItems(v, 'armor').flatMap(itemCells).map((c) => laneKey(g, c)).filter((key) => cabLanes.has(key)));
  const perSide = new Map<string, number>();
  for (const key of shielded) perSide.set(key[0], (perSide.get(key[0]) ?? 0) + 1);
  return [...perSide.values()].reduce((sum, n) => sum + Math.sqrt(n), 0);
}

function laneKey(g: Grid, c: { x: number; y: number }): string {
  const letter = g.cells[c.y]?.[c.x] ?? '';
  return letter === 'F' || letter === 'B' ? `${letter}${c.x}` : `${letter}${c.y}`;
}

function isCab(def: PartDef): boolean {
  return def.kind === 'core' && def.role === 'cab';
}

type Local = { fwd: number; right: number };

function toLocal(v: Vehicle, p: Vec): Local {
  const dx = (p.x - v.pos.x) * PHYSICS.metersPerTile;
  const dy = (p.y - v.pos.y) * PHYSICS.metersPerTile;
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  return { fwd: dx * c + dy * s, right: -dx * s + dy * c };
}

function toMap(v: Vehicle, l: Local): Vec {
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  const m = PHYSICS.metersPerTile;
  return { x: v.pos.x + (l.fwd * c - l.right * s) / m, y: v.pos.y + (l.fwd * s + l.right * c) / m };
}

function laneFace(v: Vehicle, side: Side, lane: number): Local {
  const half = bodyOf(v.chassisId).half;
  const n = laneCount(v, side);
  const across = (lane + 0.5) / n;
  switch (side) {
    case 'front': return { fwd: half.x, right: (across * 2 - 1) * half.z };
    case 'rear': return { fwd: -half.x, right: (across * 2 - 1) * half.z };
    case 'left': return { fwd: (1 - across * 2) * half.x, right: -half.z };
    case 'right': return { fwd: (1 - across * 2) * half.x, right: half.z };
  }
}

export function lanePoint(v: Vehicle, side: Side, lane: number): Vec {
  return toMap(v, laneFace(v, side, lane));
}

export function blastLanes(v: Vehicle, p: Vec, radius: number): { side: Side; lanes: number[] } {
  const side = sideToward(v, p);
  const at = toLocal(v, p);
  const lanes = Array.from({ length: laneCount(v, side) }, (_, i) => i).filter((lane) => {
    const face = laneFace(v, side, lane);
    return Math.hypot(at.fwd - face.fwd, at.right - face.right) <= radius;
  });
  return { side, lanes };
}

export function laneCount(v: Vehicle, side: Side): number {
  const g = gridOf(v);
  return side === 'front' || side === 'rear' ? g.w : g.h;
}

export function partLane(v: Vehicle, partId: string, side: Side): number {
  const item = mountedItems(v).find((it) => it.part.id === partId);
  if (!item) throw new Error(`${v.id} has no mounted part ${partId}`);
  const size = itemSize(item);
  return side === 'front' || side === 'rear' ? item.x + Math.floor(size.w / 2) : item.y + Math.floor(size.h / 2);
}

function laneCells(g: Grid, side: Side, lane: number): { x: number; y: number }[] {
  const across = side === 'front' || side === 'rear' ? g.w : g.h;
  if (!Number.isInteger(lane) || lane < 0 || lane >= across) throw new Error(`Lane ${lane} is outside the ${side} side (${across} lanes)`);
  const depth = side === 'front' || side === 'rear' ? g.h : g.w;
  const steps = Array.from({ length: depth }, (_, i) => i);
  switch (side) {
    case 'front': return steps.map((y) => ({ x: lane, y }));
    case 'rear': return steps.map((i) => ({ x: lane, y: g.h - 1 - i }));
    case 'left': return steps.map((x) => ({ x, y: lane }));
    case 'right': return steps.map((i) => ({ x: g.w - 1 - i, y: lane }));
  }
}

export function walkLane(world: World, v: Vehicle, side: Side, lane: number, round: Round): PartHit[] {
  return planLane(v, side, lane, round).map((h) => ({ part: h.part.id, damage: damagePart(world, v, h.part, h.amount) }));
}

export function planLane(v: Vehicle, side: Side, lane: number, round: Round): { part: PartInstance; amount: number }[] {
  checkRound(round);
  const g = gridOf(v);
  const owner = cellOwners(v);
  const hits: { part: PartInstance; amount: number }[] = [];
  const struck = new Set<string>();
  const left = { pen: round.pen, damage: round.damage };
  for (const c of laneCells(g, side, lane)) {
    if (left.pen <= 0) break;
    if (g.cells[c.y][c.x] === null) continue;
    left.pen -= RULES.cellPen;
    const part = owner.get(cellKey(c.x, c.y));
    if (!takesHit(part, left.pen, struck)) continue;
    struck.add(part.id);
    hits.push(hitPart(part, left, round));
  }
  return hits;
}

function cellOwners(v: Vehicle): Map<number, PartInstance> {
  const owner = new Map<number, PartInstance>();
  for (const it of mountedItems(v)) for (const c of itemCells(it)) owner.set(cellKey(c.x, c.y), it.part);
  return owner;
}

function takesHit(part: PartInstance | undefined, pen: number, struck: Set<string>): part is PartInstance {
  return pen > 0 && part !== undefined && part.hp > 0 && !struck.has(part.id);
}

function hitPart(part: PartInstance, left: { pen: number; damage: number }, round: Round): { part: PartInstance; amount: number } {
  const def = wornDef(part);
  const armor = armorAgainst(def, round.blast);
  const amount = left.damage * shareOf(def, round) * Math.min(1, left.pen / armor);
  left.damage *= Math.max(0, left.pen - armor) / left.pen;
  left.pen -= armor;
  return { part, amount };
}

function checkRound(round: Round): void {
  if (!(round.damage >= 0 && round.pen >= 0 && round.armorShare >= 0)) throw new Error(`Bad round ${JSON.stringify(round)}`);
}

function shareOf(def: PartDef, round: Round): number {
  return def.kind === 'armor' ? round.armorShare : 1;
}

export function passShare(v: Vehicle, side: Side, round: { pen: number; blast: boolean }): number {
  const g = gridOf(v);
  const owner = new Map<string, PartInstance>();
  for (const it of mountedItems(v)) for (const c of itemCells(it)) owner.set(`${c.x},${c.y}`, it.part);
  const lanes = Array.from({ length: laneCount(v, side) }, (_, lane) => firstPart(g, owner, side, lane));
  const pass = (part: PartInstance | null) => {
    const def = part && wornDef(part);
    if (!def || def.kind !== 'armor') return 1;
    return round.pen <= 0 ? 0 : Math.max(0, round.pen - armorAgainst(def, round.blast)) / round.pen;
  };
  return lanes.reduce((sum, part) => sum + pass(part), 0) / lanes.length;
}

function firstPart(g: Grid, owner: Map<string, PartInstance>, side: Side, lane: number): PartInstance | null {
  for (const c of laneCells(g, side, lane)) {
    const part = owner.get(`${c.x},${c.y}`);
    if (part && part.hp > 0) return part;
  }
  return null;
}

function armorAgainst(def: PartDef, blast: boolean): number {
  return blast && def.kind === 'armor' ? def.blastArmor : def.armor;
}

export const SIDES: readonly Side[] = ['front', 'rear', 'left', 'right'];

const STEP: Record<Side, { dx: number; dy: number }> = {
  front: { dx: 0, dy: -1 },
  rear: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function openSides(v: Vehicle, item: GridItem): Side[] {
  return openIn(gridOf(v), tallCells(v), item);
}

export function sideBlockers(v: Vehicle, item: GridItem): Partial<Record<Side, GridItem>> {
  return blockersIn(gridOf(v), tallCells(v), item);
}

function openIn(g: Grid, tall: Map<number, GridItem>, item: GridItem): Side[] {
  const blocked = blockersIn(g, tall, item);
  return SIDES.filter((side) => !blocked[side]);
}

function blockersIn(g: Grid, tall: Map<number, GridItem>, item: GridItem): Partial<Record<Side, GridItem>> {
  const out: Partial<Record<Side, GridItem>> = {};
  if (tall.size === 0) return out;
  const { w, h } = itemSize(item);
  const center = { x: item.x + Math.floor(w / 2), y: item.y + Math.floor(h / 2) };
  for (const side of SIDES) {
    const { dx, dy } = STEP[side];
    for (let x = center.x, y = center.y; inGrid(g, { x, y }); x += dx, y += dy) {
      const blocker = tall.get(cellKey(x, y));
      if (blocker && blocker.id !== item.id) {
        out[side] = blocker;
        break;
      }
    }
  }
  return out;
}

function tallCells(v: Vehicle): Map<number, GridItem> {
  const tall = new Map<number, GridItem>();
  for (const it of v.items) if (isTall(it)) paintCells(tall, it);
  return tall;
}

function isTall(it: GridItem): boolean {
  return it.kind === 'part' && Boolean(partDef(it.part.defId).tall);
}

function paintCells(cells: Map<number, GridItem>, it: GridItem): void {
  const { w, h } = itemSize(it);
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.set(cellKey(it.x + dx, it.y + dy), it);
}

export function everyGunFires(v: Vehicle): boolean {
  const g = gridOf(v);
  const tall = tallCells(v);
  return mountedItems(v, 'weapon').every((item) => {
    const reach = reachedSides(partDef(item.part.defId) as WeaponDef);
    return openIn(g, tall, item).some((side) => reach.includes(side));
  });
}

export function gunLayoutScore(v: Vehicle): number {
  const guns = mountedItems(v, 'weapon');
  const g = gridOf(v);
  const tall = tallCells(v);
  const covered = new Set<Side>();
  let sum = 0;
  for (const item of guns) {
    const reach = reachedSides(partDef(item.part.defId) as WeaponDef);
    const open = openIn(g, tall, item).filter((side) => reach.includes(side));
    for (const side of open) covered.add(side);
    sum += open.length;
  }
  return covered.size * (SIDES.length * guns.length + 1) + sum;
}

export function reachedSides(def: WeaponDef): Side[] {
  if (def.arc > 270) return [...SIDES];
  if (def.arc > 90) return ['front', 'left', 'right'];
  return ['front'];
}

function inGrid(g: Grid, c: { x: number; y: number }): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h;
}

export type FireSpan = { from: number; to: number };

const SIDE_CENTER: Record<Side, number> = { front: 0, right: 90, rear: 180, left: -90 };

export function fireSpans(arc: number, sides: readonly Side[]): FireSpan[] {
  const half = Math.min(arc, 360) / 2;
  const pieces = sides
    .flatMap((side) => splitAtBack(SIDE_CENTER[side] - 45, SIDE_CENTER[side] + 45))
    .map((p) => ({ from: Math.max(p.from, -half), to: Math.min(p.to, half) }))
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from);
  const merged: FireSpan[] = [];
  for (const p of pieces) {
    const last = merged.at(-1);
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else merged.push({ ...p });
  }
  return joinAcrossBack(merged);
}

function splitAtBack(from: number, to: number): FireSpan[] {
  return to <= 180 ? [{ from, to }] : [{ from, to: 180 }, { from: -180, to: to - 360 }];
}

function joinAcrossBack(spans: FireSpan[]): FireSpan[] {
  const first = spans[0];
  const last = spans.at(-1);
  if (spans.length < 2 || !first || !last || first.from !== -180 || last.to !== 180) return spans;
  return [{ from: last.from, to: first.to + 360 }, ...spans.slice(1, -1)];
}
