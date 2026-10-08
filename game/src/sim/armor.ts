import { RULES } from '../data/rules';
import { PHYSICS } from '../data/physics';
import { bodyOf } from './body';
// Sides and lanes of a truck's grid. A round enters the grid from the struck side and walks one lane of cells inward.
// Each working part it meets takes damage and stops some of its penetration. Fire leaves the other way: seen from the
// gun's center, each tall cell on the truck hides a slice of angles, and the gun fires through its arc minus those
// slices. So a gun behind the cab cannot fire forward over it, and a cargo box behind a turret blinds its rear.

import { partDef, type PartDef, type WeaponDef } from '../data/parts';
import { wornDef } from './wear';
import { damagePart } from './damage';
import { cellKey, facingOf, gridOf, itemCells, itemSize, mountedItems, mountedParts, sideOf, type Grid, type SideLetter } from './grid';
import type { GridItem, PartInstance, Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

export type Side = 'front' | 'rear' | 'left' | 'right';
export type PartHit = { part: string; damage: number };
// A blast round meets an armor part's blastArmor instead of its armor. Armor parts take damage times armorShare.
export type Round = { damage: number; pen: number; blast: boolean; armorShare: number };

const QUARTER = Math.PI / 4;

// Map heading grows from +x toward +y, which is a right turn. So a point at a positive bearing off the heading lies to the right.
export function sideToward(v: Vehicle, p: Vec): Side {
  const rel = angleDiff(v.heading, bearing(v.pos, p));
  if (Math.abs(rel) <= QUARTER) return 'front';
  if (Math.abs(rel) >= 3 * QUARTER) return 'rear';
  return rel > 0 ? 'right' : 'left';
}

const LETTER: Record<Side, SideLetter> = { front: 'F', rear: 'B', left: 'L', right: 'R' };

// The strongest ram multiplier among working armor parts mounted on the side, or 1 without one.
export function ramMult(v: Vehicle, side: Side): number {
  let mult = 1;
  for (const p of mountedParts(v, 'armor')) {
    const def = partDef(p.defId);
    if (def.kind !== 'armor') throw new Error(`${p.id} is mounted as armor but is ${def.kind}`);
    if (p.hp > 0 && coversSide(v, p, side)) mult = Math.max(mult, def.ramMult);
  }
  return mult;
}

// Whether a mounted armor part covers the side.
export function coversSide(v: Vehicle, part: PartInstance, side: Side): boolean {
  return sideOf(v, part) === LETTER[side];
}

// How well armor shields the cab, to compare armor layouts. A cab lane is shielded where an armor cell on that
// side's edge lies in a lane that crosses the cab. Front and rear lanes are columns, left and right lanes are rows.
// Each side adds the square root of its shielded lanes, so cover spreads over the sides before it deepens on one.
export function cabShield(v: Vehicle): number {
  const g = gridOf(v);
  const cab = mountedItems(v, 'core').filter((it) => isCab(partDef(it.part.defId))).flatMap(itemCells);
  const cabLanes = new Set(cab.flatMap((c) => [`F${c.x}`, `B${c.x}`, `L${c.y}`, `R${c.y}`]));
  const shielded = new Set(mountedItems(v, 'armor').flatMap(itemCells).map((c) => laneKey(g, c)).filter((key) => cabLanes.has(key)));
  const perSide = new Map<string, number>();
  for (const key of shielded) perSide.set(key[0], (perSide.get(key[0]) ?? 0) + 1);
  return [...perSide.values()].reduce((sum, n) => sum + Math.sqrt(n), 0);
}

// The side and lane an edge cell covers, like "F2" for front column 2. Front and rear lanes are columns, left and
// right lanes are rows. A cell off the edge gives a key no lane has.
function laneKey(g: Grid, c: { x: number; y: number }): string {
  const letter = g.cells[c.y]?.[c.x] ?? '';
  return letter === 'F' || letter === 'B' ? `${letter}${c.x}` : `${letter}${c.y}`;
}

function isCab(def: PartDef): boolean {
  return def.kind === 'core' && def.role === 'cab';
}

// A point in the truck's frame, in meters: forward along the heading and right across it.
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

// Where a lane's center meets the outer face of a side. Column 0 is the truck's left edge, row 0 its nose.
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

// The map point where a round entering a lane meets the truck.
export function lanePoint(v: Vehicle, side: Side, lane: number): Vec {
  return toMap(v, laneFace(v, side, lane));
}

// The side of a truck facing a blast, and its lanes whose face centers lie within radius meters of the blast.
export function blastLanes(v: Vehicle, p: Vec, radius: number): { side: Side; lanes: number[] } {
  const side = sideToward(v, p);
  const at = toLocal(v, p);
  const lanes = Array.from({ length: laneCount(v, side) }, (_, i) => i).filter((lane) => {
    const face = laneFace(v, side, lane);
    return Math.hypot(at.fwd - face.fwd, at.right - face.right) <= radius;
  });
  return { side, lanes };
}

// Front and rear lanes are grid columns. Left and right lanes are grid rows.
export function laneCount(v: Vehicle, side: Side): number {
  const g = gridOf(v);
  return side === 'front' || side === 'rear' ? g.w : g.h;
}

// The lane through the center cell of a mounted part, across the given side.
export function partLane(v: Vehicle, partId: string, side: Side): number {
  const item = mountedItems(v).find((it) => it.part.id === partId);
  if (!item) throw new Error(`${v.id} has no mounted part ${partId}`);
  const size = itemSize(item);
  return side === 'front' || side === 'rear' ? item.x + Math.floor(size.w / 2) : item.y + Math.floor(size.h / 2);
}

// Lane cells by grid. Grids are frozen and shared, see gridOf(), so their lanes never change.
const laneCache = new WeakMap<Grid, Map<string, readonly { x: number; y: number }[]>>();

// Cells of one lane in the order a round meets them. The nose is row 0, the left edge is column 0.
function laneCells(g: Grid, side: Side, lane: number): readonly { x: number; y: number }[] {
  let lanes = laneCache.get(g);
  if (!lanes) laneCache.set(g, (lanes = new Map()));
  const key = `${side}${lane}`;
  let cells = lanes.get(key);
  if (!cells) lanes.set(key, (cells = buildLaneCells(g, side, lane)));
  return cells;
}

function buildLaneCells(g: Grid, side: Side, lane: number): { x: number; y: number }[] {
  const lengthwise = side === 'front' || side === 'rear';
  checkLane(lane, lengthwise ? g.w : g.h, side);
  return Array.from({ length: lengthwise ? g.h : g.w }, (_, i) => LANE_STEP[side](g, lane, i));
}

// The i-th cell a round meets in a lane, from the struck side inward.
const LANE_STEP: Record<Side, (g: Grid, lane: number, i: number) => { x: number; y: number }> = {
  front: (_g, lane, i) => ({ x: lane, y: i }),
  rear: (g, lane, i) => ({ x: lane, y: g.h - 1 - i }),
  left: (_g, lane, i) => ({ x: i, y: lane }),
  right: (g, lane, i) => ({ x: g.w - 1 - i, y: lane }),
};

function checkLane(lane: number, across: number, side: Side): void {
  if (!Number.isInteger(lane) || lane < 0 || lane >= across) throw new Error(`Lane ${lane} is outside the ${side} side (${across} lanes)`);
}

// The only way damage reaches parts. A working mounted part takes damage × min(1, pen / armor), then lowers pen
// by its armor, and damage drops in the same proportion as pen. The walk stops at zero pen. Holes, empty cells, goods, spares and broken parts let the round pass.
// A broken cargo part's dead rows are still the truck's body, so they cost pen like empty cells.
// A part covering several cells of the lane is hit once.
export function walkLane(world: World, v: Vehicle, side: Side, lane: number, round: Round): PartHit[] {
  return planLane(v, side, lane, round).map((h) => ({ part: h.part.id, damage: damagePart(world, v, h.part, h.amount) }));
}

// The parts a round walking this lane would hit and the damage each would take, without dealing it.
export function planLane(v: Vehicle, side: Side, lane: number, round: Round): { part: PartInstance; amount: number }[] {
  return walkCells(laneOwners(gridOf(v), cellOwners(v), side, lane), round);
}

// planLane() for every lane of a side, with each lane's cells read once for every round.
export function sidePlanner(v: Vehicle): (side: Side, round: Round) => { part: PartInstance; amount: number }[][] {
  const g = gridOf(v);
  const owner = cellOwners(v);
  const sides = new Map<Side, LaneCell[][]>();
  return (side, round) => {
    let lanes = sides.get(side);
    if (!lanes) sides.set(side, (lanes = Array.from({ length: laneCount(v, side) }, (_, lane) => laneOwners(g, owner, side, lane))));
    return lanes.map((cells) => walkCells(cells, round));
  };
}

// A lane cell as a round meets it: null for a hole in the grid, else the mounted part there, if any.
type LaneCell = { part: PartInstance | undefined } | null;

function laneOwners(g: Grid, owner: Map<number, PartInstance>, side: Side, lane: number): LaneCell[] {
  return laneCells(g, side, lane).map((c) => (g.cells[c.y][c.x] === null && c.y < g.deadFrom ? null : { part: owner.get(cellKey(c.x, c.y)) }));
}

function walkCells(cells: LaneCell[], round: Round): { part: PartInstance; amount: number }[] {
  checkRound(round);
  const hits: { part: PartInstance; amount: number }[] = [];
  const struck = new Set<string>();
  const left = { pen: round.pen, damage: round.damage };
  for (const cell of cells) {
    if (left.pen <= 0) break;
    if (cell === null) continue;
    left.pen -= RULES.cellPen;
    const part = cell.part;
    if (!takesHit(part, left.pen, struck)) continue;
    struck.add(part.id);
    hits.push(hitPart(part, left, round));
  }
  return hits;
}

// Where a harpoon bolt that struck the truck in this lane holds: the first working part in the lane from its side,
// whatever pen it would take to reach it. A lane with none, as an outer lane of empty armor slots, passes the hold to
// the nearest lane that has one. Null only for a truck with no working part.
export function heldPart(v: Vehicle, side: Side, lane: number): PartInstance | null {
  const owner = cellOwners(v);
  const g = gridOf(v);
  const working = (at: number) => laneCells(g, side, at).map((c) => owner.get(cellKey(c.x, c.y))).find((p) => p !== undefined && p.hp > 0);
  for (const at of lanesOutFrom(lane, laneCount(v, side))) {
    const part = working(at);
    if (part) return part;
  }
  return null;
}

// Every lane from `lane` outward, nearest first and the lower one first at equal distance.
function lanesOutFrom(lane: number, lanes: number): number[] {
  const all = Array.from({ length: lanes }, (_, at) => at);
  return all.sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane) || a - b);
}

function cellOwners(v: Vehicle): Map<number, PartInstance> {
  const owner = new Map<number, PartInstance>();
  for (const it of mountedItems(v)) for (const c of itemCells(it)) owner.set(cellKey(c.x, c.y), it.part);
  return owner;
}

function takesHit(part: PartInstance | undefined, pen: number, struck: Set<string>): part is PartInstance {
  return pen > 0 && part !== undefined && part.hp > 0 && !struck.has(part.id);
}

// The part takes damage × min(1, pen / armor). Its armor then lowers the pen and damage left in the round.
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

// Armor parts take a round's armor share of its damage, and every other part the whole of it.
function shareOf(def: PartDef, round: Round): number {
  return def.kind === 'armor' ? round.armorShare : 1;
}

// The share of a round's damage that gets past the armor on one side, averaged over its lanes. A lane whose first
// working part is armor stops pen equal to its armor and lets the rest through, as walkLane() does. Any other lane
// lets it all through.
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

// The first working part a round meets in a lane, or null when it meets none.
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

// Angle span in degrees off the heading. Positive angles lie to the right, as in sideToward(). On the grid 0 points to
// the nose, up, and positive angles turn right. A span starts in [-180, 180) and may run past 180 through the rear.
export type FireSpan = { from: number; to: number };

const SIDE_CENTER: Record<Side, number> = { front: 0, right: 90, rear: 180, left: -90 };

// Where a mounted gun can fire: its arc, centered on the way it faces, minus the shadows of the tall parts on its truck.
export function gunSpans(v: Vehicle, item: GridItem): FireSpan[] {
  return spansIn(tallItems(v), item);
}

// The tall items that hide part of the gun's own arc, for outlining them on the grid.
export function gunBlockers(v: Vehicle, item: GridItem): GridItem[] {
  const arc = arcPieces(item);
  const out = new Set<GridItem>();
  for (const s of shadowsOf(tallItems(v), item)) if (overlaps(s.pieces, arc)) out.add(s.blocker);
  return [...out];
}

// The sides whose 90 degree quarter the spans reach into.
export function spanSides(spans: readonly FireSpan[]): Side[] {
  const pieces = spans.flatMap((s) => splitAtBack(s.from, s.to));
  return SIDES.filter((side) => {
    const from = wrapFrom(SIDE_CENTER[side] - 45);
    return overlaps(splitAtBack(from, from + 90), pieces);
  });
}

// Pieces on the line from -180 to 180 that share more than an edge.
function overlaps(a: readonly FireSpan[], b: readonly FireSpan[]): boolean {
  return a.some((p) => b.some((q) => p.to > q.from && p.from < q.to));
}

// Degrees the spans cover in total.
export function spanDegrees(spans: readonly FireSpan[]): number {
  return spans.reduce((sum, s) => sum + s.to - s.from, 0);
}

// True when every mounted gun can fire somewhere.
export function everyGunFires(v: Vehicle): boolean {
  const tall = tallItems(v);
  return mountedItems(v, 'weapon').every((item) => spansIn(tall, item).length > 0);
}

// Compares gun layouts. The sides any gun covers count first, so a new gun goes where it fires toward a side no
// other gun does. Open degrees summed over every gun break ties.
export function gunLayoutScore(v: Vehicle): number {
  const guns = mountedItems(v, 'weapon');
  const tall = tallItems(v);
  const covered = new Set<Side>();
  let sum = 0;
  for (const item of guns) {
    const spans = spansIn(tall, item);
    for (const side of spanSides(spans)) covered.add(side);
    sum += spanDegrees(spans);
  }
  return covered.size * (360 * guns.length + 1) + sum;
}

function spansIn(tall: readonly GridItem[], item: GridItem): FireSpan[] {
  const shadows = shadowsOf(tall, item).flatMap((s) => s.pieces);
  const open = arcPieces(item).flatMap((piece) => shadows.reduce((left, cut) => left.flatMap((p) => subtract(p, cut)), [piece]));
  return joinAcrossBack(mergeSpans(open));
}

// The gun's own arc on the line from -180 to 180, split where it crosses the rear.
function arcPieces(item: GridItem): FireSpan[] {
  if (item.kind !== 'part') throw new Error(`${item.id} is not a part`);
  const { arc } = partDef(item.part.defId) as WeaponDef;
  if (arc >= 360) return [{ from: -180, to: 180 }];
  const from = wrapFrom(facingOf(item) - arc / 2);
  return splitAtBack(from, from + arc);
}

// The slice of angles each tall cell hides from the gun's center: from its leftmost to its rightmost corner. A cell
// the gun owns never blocks it. No cell holds the gun's center, so each slice is under 180 degrees.
function shadowsOf(tall: readonly GridItem[], item: GridItem): { blocker: GridItem; pieces: FireSpan[] }[] {
  const { w, h } = itemSize(item);
  const ox = item.x + w / 2;
  const oy = item.y + h / 2;
  return tall.filter((blocker) => blocker.id !== item.id).map((blocker) => ({
    blocker,
    pieces: itemCells(blocker).flatMap(({ x, y }) => {
      const center = gridAngle(x + 0.5 - ox, y + 0.5 - oy);
      const off = (a: number) => wrapDegrees(a - center);
      const corners = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([cx, cy]) => gridAngle(cx - ox, cy - oy));
      const left = corners.reduce((best, a) => (off(a) < off(best) ? a : best));
      const right = corners.reduce((best, a) => (off(a) > off(best) ? a : best));
      const from = wrapFrom(left);
      return splitAtBack(from, from + off(right) - off(left));
    }),
  }));
}

// Degrees off the nose of a grid offset. Up on the grid is the nose and +x is right.
function gridAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

// An angle moved into [-180, 180).
function wrapFrom(angle: number): number {
  return angle >= 180 ? angle - 360 : angle < -180 ? angle + 360 : angle;
}

function subtract(p: FireSpan, cut: FireSpan): FireSpan[] {
  if (cut.to <= p.from || cut.from >= p.to) return [p];
  return [{ from: p.from, to: cut.from }, { from: cut.to, to: p.to }].filter((s) => s.to > s.from);
}

function mergeSpans(pieces: FireSpan[]): FireSpan[] {
  const merged: FireSpan[] = [];
  for (const p of [...pieces].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else merged.push({ ...p });
  }
  return merged;
}

function tallItems(v: Vehicle): GridItem[] {
  return v.items.filter((it) => it.kind === 'part' && Boolean(partDef(it.part.defId).tall));
}

// Where a gun can point to cover a bearing off the heading: the bearing itself inside the spans, else the nearest span edge.
// Degrees in and out, in (-180, 180]. A tie goes to the edge first in span order.
export function aimWithin(spans: readonly FireSpan[], rel: number): number {
  if (spans.length === 0) throw new Error('aimWithin needs at least one span');
  if (spansHold(spans, rel)) return rel;
  const edges = spans.flatMap((span) => [span.from, span.to]);
  const apart = (edge: number) => Math.abs(((edge - rel + 540) % 360) - 180);
  const nearest = edges.reduce((best, edge) => (apart(edge) < apart(best) ? edge : best));
  return wrapDegrees(nearest);
}

// True when a bearing off the heading, in degrees, lies inside the spans.
export function spansHold(spans: readonly FireSpan[], rel: number): boolean {
  return spans.some((span) => spanHolds(span, rel) || spanHolds(span, rel + 360));
}

function spanHolds(span: FireSpan, angle: number): boolean {
  return angle >= span.from && angle <= span.to;
}

function wrapDegrees(angle: number): number {
  return angle > 180 ? angle - 360 : angle <= -180 ? angle + 360 : angle;
}

// The rear quarter crosses 180 degrees, so it splits into its right and left halves.
function splitAtBack(from: number, to: number): FireSpan[] {
  return to <= 180 ? [{ from, to }] : [{ from, to: 180 }, { from: -180, to: to - 360 }];
}

// A span ending at 180 and one starting at -180 are one span through the rear.
function joinAcrossBack(spans: FireSpan[]): FireSpan[] {
  const first = spans[0];
  const last = spans.at(-1);
  if (spans.length < 2 || !first || !last || first.from !== -180 || last.to !== 180) return spans;
  return [{ from: last.from, to: first.to + 360 }, ...spans.slice(1, -1)];
}
