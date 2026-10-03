// Fortress layout: the curtain outline of each fortress site, and the wall, tower, gatehouse, bastion and inner
// gate pieces that close it. Map tiles throughout.
//
// The outline runs counterclockwise, from map +x toward +y. A piece's pos is its footprint center, and its model
// +x runs along the wall at its yaw. The prop pose lands model (x, y) at map (x cos + y sin, x sin - y cos), so
// model +y, the outer face, looks to the right of the yaw. A piece with yaw a + PI/2 faces out at bearing a.
//
// Each gate is a gatehouse whose outer face lies on the site circle at a road gate from siteGates(), so the pads
// stay where they are. Where the curtain runs through the gatehouse, the gatehouse closes that stretch of it.
// Where the gatehouse lies wholly outside the curtain, a barbican joins it back: two neck walls and an inner gate
// in the curtain.

import { FORTRESS, FORTRESS_SITES, type FortressSite, type FortressStyle } from '../data/fortress';
import { siteGates, type Site } from './sites';
import type { PropKind } from './terrain';
import { bearing, DEG, dist, segmentDist, type Vec } from './vec';

export type FortressKind = 'wall' | 'tower' | 'gate' | 'bastion' | 'inner';
// r is half the piece's length along its model +x. For a wall that is half its stretched length.
// The one table of a fort piece's prop kind. The map file stores the kind, and the kind names the piece's model.
export type FortModel = `fort_${'masonry' | 'ship' | 'scrap'}_${FortressKind}`;
export const FORT_PROPS: Record<FortressStyle, Record<FortressKind, PropKind>> = {
  masonry: { wall: 'fortMasonryWall', tower: 'fortMasonryTower', gate: 'fortMasonryGate', bastion: 'fortMasonryBastion', inner: 'fortMasonryInner' },
  shipMetal: { wall: 'fortShipWall', tower: 'fortShipTower', gate: 'fortShipGate', bastion: 'fortShipBastion', inner: 'fortShipInner' },
  scrap: { wall: 'fortScrapWall', tower: 'fortScrapTower', gate: 'fortScrapGate', bastion: 'fortScrapBastion', inner: 'fortScrapInner' },
};
const FORT_STYLE_NAMES: Record<FortressStyle, 'masonry' | 'ship' | 'scrap'> = { masonry: 'masonry', shipMetal: 'ship', scrap: 'scrap' };

// The model name of each fort prop kind, and the piece it is. Built once, since no map says more than the kind.
export const FORT_MODELS: ReadonlyMap<PropKind, { model: FortModel; piece: FortressKind }> = new Map(
  (Object.keys(FORT_PROPS) as FortressStyle[]).flatMap((style) =>
    (Object.keys(FORT_PROPS[style]) as FortressKind[]).map((piece) => [FORT_PROPS[style][piece], { model: `fort_${FORT_STYLE_NAMES[style]}_${piece}` as FortModel, piece }] as const),
  ),
);

export type FortressPiece = { kind: FortressKind; pos: Vec; yaw: number; r: number };

// An outline corner and the piece that stands on it. Plain circle corners carry none.
type Corner = { pos: Vec; piece: 'tower' | 'bastion' | null };
// A rectangle in map tiles: center, unit axis along its length, and half sizes along and across it.
type Rect = { center: Vec; axis: Vec; half: { along: number; across: number } };
// A stretch of the outline left after the gate cuts: points in outline order, with the outline corner index of each
// point, or null for a cut end.
type Run = { points: Vec[]; corners: (number | null)[] };

// Each site's outline is derived once from the constants, then reused by every inside test.
const OUTLINES = new WeakMap<Site, Vec[]>();

export function fortressOutline(site: Site): Vec[] {
  let outline = OUTLINES.get(site);
  if (outline === undefined) {
    outline = outlineCorners(site).map((c) => c.pos);
    OUTLINES.set(site, outline);
  }
  return outline;
}

// Whether a point lies inside the site's curtain, at least inset tiles from every wall line. Interiors keep half a
// wall depth clear, so a model never pokes into the wall.
export function insideCurtain(site: Site, p: Vec, inset: number = FORTRESS.wallDepth / 2): boolean {
  const outline = fortressOutline(site);
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    if (segmentDist(p, a, b) < inset) return false;
  }
  return inside;
}

export function fortressPieces(site: Site): FortressPiece[] {
  const corners = outlineCorners(site);
  const laid = siteGates(site).map((gate) => layGate(site, gate, corners));
  const cuts = laid.map((l) => l.cut);
  const houses = laid.filter((l) => l.cut === l.house).map((l) => l.house);
  const walls = cutOutline(corners.map((c) => c.pos), cuts).flatMap((run) => wallRun(mergeShortEnds(run, corners)));
  return [...laid.flatMap((l) => l.pieces), ...walls, ...cornerPieces(site, corners, houses)];
}

function wallRun(points: Vec[]): FortressPiece[] {
  return points.slice(1).flatMap((p, i) => wallLine(points[i], p));
}

// The towers and bastions on the outline corners, less those a gatehouse stands in for.
function cornerPieces(site: Site, corners: Corner[], houses: Rect[]): FortressPiece[] {
  return corners.flatMap((c) => {
    if (c.piece === null || houses.some((h) => inRect(h, c.pos))) return [];
    const size = c.piece === 'tower' ? FORTRESS.towerSize : FORTRESS.bastionSize;
    return [{ kind: c.piece, pos: c.pos, yaw: bearing(site.pos, c.pos) + Math.PI / 2, r: size / 2 }];
  });
}

// The four footprint corners of a piece, counterclockwise.
export function fortressFootprint(piece: FortressPiece): Vec[] {
  const rect = pieceRect(piece);
  const { axis, half, center } = rect;
  const side = { x: -axis.y, y: axis.x };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, s]) => ({ x: center.x + axis.x * half.along * a + side.x * half.across * s, y: center.y + axis.y * half.along * a + side.y * half.across * s }));
}

function pieceRect(piece: FortressPiece): Rect {
  const axis = { x: Math.cos(piece.yaw), y: Math.sin(piece.yaw) };
  const across = { wall: FORTRESS.wallDepth, inner: FORTRESS.wallDepth, gate: FORTRESS.gate.depth, tower: FORTRESS.towerSize, bastion: FORTRESS.bastionSize }[piece.kind];
  return { center: piece.pos, axis, half: { along: piece.r, across: across / 2 } };
}

function fortressOf(site: Site): FortressSite {
  const def: FortressSite | undefined = FORTRESS_SITES[site.id];
  if (def === undefined) throw new Error(`Site ${site.id} is no fortress`);
  return def;
}

// The outline corners, counterclockwise from the site's turn.
function outlineCorners(site: Site): Corner[] {
  const def = fortressOf(site);
  const radius = site.radius - FORTRESS.inset;
  const turn = def.turn * DEG;
  const at = (a: number, r: number): Vec => ({ x: site.pos.x + Math.cos(turn + a) * r, y: site.pos.y + Math.sin(turn + a) * r });
  if (def.shape === 'square') return [0, 1, 2, 3].map((k) => ({ pos: at((k * Math.PI) / 2, radius), piece: 'tower' }));
  if (def.shape === 'star') {
    const count = FORTRESS.starPoints * 2;
    return Array.from({ length: count }, (_, k) => {
      const point = k % 2 === 0;
      return { pos: at((k * 2 * Math.PI) / count, point ? radius : radius * (1 - FORTRESS.starDepth)), piece: point ? 'bastion' : null };
    });
  }
  // A circle is an N-gon of sections about one wall long, with a tower every circleTowerEvery sections.
  const every = FORTRESS.circleTowerEvery;
  const count = every * Math.ceil((2 * Math.PI * radius) / (FORTRESS.wallLength * every));
  return Array.from({ length: count }, (_, k) => ({ pos: at((k * 2 * Math.PI) / count, radius), piece: k % every === 0 ? 'tower' : null }));
}

// The pieces of one gate, and the rectangle it cuts out of the curtain: the gatehouse where the curtain runs
// through it, or else the inner gate of its barbican.
function layGate(site: Site, gate: Vec, corners: Corner[]): { pieces: FortressPiece[]; cut: Rect; house: Rect } {
  const outline = corners.map((c) => c.pos);
  const a = bearing(site.pos, gate);
  const out = { x: Math.cos(a), y: Math.sin(a) };
  const { width, depth } = FORTRESS.gate;
  const gatehouse: FortressPiece = { kind: 'gate', pos: along(gate, out, -depth / 2), yaw: a + Math.PI / 2, r: width / 2 };
  const house = pieceRect(gatehouse);
  const tagged = corners.filter((c) => c.piece !== null).map((c) => c.pos);
  if (!outline.some((p, i) => clipSegment(p, outline[(i + 1) % outline.length], house) !== null)) {
    const barbican = layBarbican(site, { gate, out, outline, tagged });
    return { pieces: [gatehouse, ...barbican.pieces], cut: barbican.cut, house };
  }
  for (const c of tagged) {
    if (Math.abs(rectEdgeDistance(house, c)) < FORTRESS.gateClearance) throw new Error(`Site ${site.id} has a corner on the edge of its gatehouse at ${fmt(gate)}`);
  }
  return { pieces: [gatehouse], cut: house, house };
}

type GateSpot = { gate: Vec; out: Vec; outline: Vec[]; tagged: Vec[] };

// A barbican. The neck walls run in from the gatehouse back to the curtain, inside its side faces.
function layBarbican(site: Site, spot: GateSpot): { pieces: FortressPiece[]; cut: Rect } {
  const { gate, out, outline, tagged } = spot;
  const { width, depth } = FORTRESS.gate;
  const tangent = { x: -out.y, y: out.x };
  const back = along(gate, out, -depth);
  const inward = { x: -out.x, y: -out.y };
  const necks = [1, -1].map((side) => {
    const from = along(back, tangent, side * (width / 2 - FORTRESS.wallDepth / 2));
    const reach = castToOutline(from, inward, outline);
    if (reach === null) throw new Error(`Site ${site.id} has a barbican neck that misses the curtain at ${fmt(gate)}`);
    // A short neck reaches further back into the gatehouse, so it is at least one wall model long.
    const into = Math.max(0, FORTRESS.wallLength - FORTRESS.wallDepth - reach.distance);
    if (into > depth) throw new Error(`Site ${site.id} has no room for a barbican neck at ${fmt(gate)}`);
    return { start: along(from, out, into), end: reach.point };
  });
  const crossing = castToOutline(gate, inward, outline);
  if (crossing === null) throw new Error(`Site ${site.id} has a gate that misses its curtain at ${fmt(gate)}`);
  const sideFrom = outline[crossing.segment];
  const sideTo = outline[(crossing.segment + 1) % outline.length];
  const inner: FortressPiece = { kind: 'inner', pos: crossing.point, yaw: bearing(sideFrom, sideTo), r: FORTRESS.innerWidth / 2 };
  const cut = pieceRect(inner);
  const innerEnds = [along(crossing.point, cut.axis, -cut.half.along), along(crossing.point, cut.axis, cut.half.along)];
  const deepest = Math.max(...necks.map((n) => dist(back, n.end)), crossing.distance - depth);
  const zone: Rect = { center: along(gate, out, -(depth + deepest) / 2), axis: tangent, half: { along: width / 2, across: (depth + deepest) / 2 } };
  for (const c of tagged) {
    const near = [...innerEnds, ...necks.map((n) => n.end)].some((p) => dist(p, c) < FORTRESS.gateClearance);
    if (near || inRect(zone, c)) throw new Error(`Site ${site.id} has a corner in or by its barbican at ${fmt(gate)}`);
  }
  return { pieces: [inner, ...necks.flatMap((n) => wallLine(n.start, n.end))], cut };
}

type Span = { segment: number; t0: number; t1: number };

// The outline less the cut rectangles, as runs in outline order.
function cutOutline(outline: Vec[], cuts: Rect[]): Run[] {
  const kept = outline.flatMap((_, i) => keptSpans(outline, i, cuts));
  const n = outline.length;
  const first = firstCut(kept, n);
  const runs: Run[] = [];
  for (let j = 0; j < kept.length; j++) {
    const k = kept[(first + j) % kept.length];
    const prev = kept[(first + j - 1 + kept.length) % kept.length];
    const a = lerpVec(outline[k.segment], outline[(k.segment + 1) % n], k.t0);
    const b = lerpVec(outline[k.segment], outline[(k.segment + 1) % n], k.t1);
    const endCorner = k.t1 === 1 ? (k.segment + 1) % n : null;
    if (j > 0 && continues(prev, k, n)) {
      runs[runs.length - 1].points.push(b);
      runs[runs.length - 1].corners.push(endCorner);
    } else {
      runs.push({ points: [a, b], corners: [k.t0 === 0 ? k.segment : null, endCorner] });
    }
  }
  return runs;
}

// The index of a span that begins at a cut, so every run starts and ends at one.
function firstCut(kept: Span[], n: number): number {
  const first = kept.findIndex((k, i) => !continues(kept[(i - 1 + kept.length) % kept.length], k, n));
  if (first < 0) throw new Error('A fortress outline has no gate cut');
  return first;
}

// Whether span k picks up where span prev ends, with no cut between.
function continues(prev: Span, k: Span, n: number): boolean {
  return k.t0 === 0 && prev.t1 === 1 && prev.segment === (k.segment - 1 + n) % n;
}

// The parts of outline segment i that lie outside every cut.
function keptSpans(outline: Vec[], i: number, cuts: Rect[]): Span[] {
  let spans: [number, number][] = [[0, 1]];
  for (const cut of cuts) {
    const hit = clipSegment(outline[i], outline[(i + 1) % outline.length], cut);
    if (hit === null) continue;
    spans = spans.flatMap(([s0, s1]): [number, number][] => [
      [s0, Math.min(s1, hit[0])],
      [Math.max(s0, hit[1]), s1],
    ]).filter(([s0, s1]) => s1 - s0 > 1e-9);
  }
  return spans.map(([t0, t1]) => ({ segment: i, t0, t1 }));
}

// A run's points, with a cut end joined straight past a plain circle corner when the stretch between them is too
// short for a wall. Towers and bastions stay, and the gate clearance keeps their stretches long enough.
function mergeShortEnds(run: Run, corners: Corner[]): Vec[] {
  const shortest = FORTRESS.wallLength * FORTRESS.stretch[0] - FORTRESS.wallDepth;
  const points = [...run.points];
  const tags = [...run.corners];
  const plain = (i: number): boolean => {
    const c = tags[i];
    return c !== null && corners[c].piece === null;
  };
  const drop = (gap: number, i: number): boolean => points.length > 2 && gap < shortest && plain(i);
  while (drop(dist(points[0], points[1]), 1)) {
    points.splice(1, 1);
    tags.splice(1, 1);
  }
  while (drop(dist(points[points.length - 2], points[points.length - 1]), points.length - 2)) {
    points.splice(points.length - 2, 1);
    tags.splice(tags.length - 2, 1);
  }
  return points;
}

// Walls along a straight line from a to b, in equal sections near the model length. Each wall reaches half the
// wall depth past both section ends, so it overlaps its neighbors at every joint.
function wallLine(a: Vec, b: Vec): FortressPiece[] {
  const length = dist(a, b);
  const [least, most] = FORTRESS.stretch.map((s) => s * FORTRESS.wallLength);
  let count = Math.max(1, Math.round((length + FORTRESS.wallDepth) / FORTRESS.wallLength));
  while (length / count + FORTRESS.wallDepth > most) count++;
  const section = length / count;
  const span = section + FORTRESS.wallDepth;
  if (span < least - 1e-9) throw new Error(`A fortress wall from ${fmt(a)} to ${fmt(b)} is too short`);
  const yaw = bearing(a, b);
  return Array.from({ length: count }, (_, k) => ({ kind: 'wall', pos: lerpVec(a, b, (k + 0.5) / count), yaw, r: span / 2 }));
}

type Cast = { point: Vec; distance: number; segment: number };

// The first point where a ray from p along unit dir meets the outline.
function castToOutline(p: Vec, dir: Vec, outline: Vec[]): Cast | null {
  const hits = outline.flatMap((a, i): Cast[] => {
    const t = rayHit(p, dir, a, outline[(i + 1) % outline.length]);
    return t === null ? [] : [{ point: along(p, dir, t), distance: t, segment: i }];
  });
  return hits.reduce<Cast | null>((best, h) => (best === null || h.distance < best.distance ? h : best), null);
}

// How far along the ray from p the segment ab is met, or null.
function rayHit(p: Vec, dir: Vec, a: Vec, b: Vec): number | null {
  const e = { x: b.x - a.x, y: b.y - a.y };
  const denom = dir.x * e.y - dir.y * e.x;
  if (Math.abs(denom) < 1e-12) return null;
  const w = { x: a.x - p.x, y: a.y - p.y };
  const t = (w.x * e.y - w.y * e.x) / denom;
  const u = (w.x * dir.y - w.y * dir.x) / denom;
  return t < 0 || u < 0 || u > 1 ? null : t;
}

// The span of segment ab, as fractions of it, that lies inside the rectangle, or null.
function clipSegment(a: Vec, b: Vec, rect: Rect): [number, number] | null {
  const la = toRect(rect, a);
  const lb = toRect(rect, b);
  let t0 = 0;
  let t1 = 1;
  for (const [from, to, half] of [
    [la.x, lb.x, rect.half.along],
    [la.y, lb.y, rect.half.across],
  ]) {
    const d = to - from;
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(from) > half) return null;
      continue;
    }
    const s0 = (-half - from) / d;
    const s1 = (half - from) / d;
    t0 = Math.max(t0, Math.min(s0, s1));
    t1 = Math.min(t1, Math.max(s0, s1));
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

// Signed distance from p to the rectangle's edge: positive inside, negative outside.
function rectEdgeDistance(rect: Rect, p: Vec): number {
  const l = toRect(rect, p);
  const dx = rect.half.along - Math.abs(l.x);
  const dy = rect.half.across - Math.abs(l.y);
  if (dx >= 0 && dy >= 0) return Math.min(dx, dy);
  return -Math.hypot(Math.min(dx, 0), Math.min(dy, 0));
}

function inRect(rect: Rect, p: Vec): boolean {
  return rectEdgeDistance(rect, p) >= 0;
}

function toRect(rect: Rect, p: Vec): Vec {
  const dx = p.x - rect.center.x;
  const dy = p.y - rect.center.y;
  return { x: dx * rect.axis.x + dy * rect.axis.y, y: -dx * rect.axis.y + dy * rect.axis.x };
}

export function along(p: Vec, dir: Vec, d: number): Vec {
  return { x: p.x + dir.x * d, y: p.y + dir.y * d };
}

function lerpVec(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function fmt(p: Vec): string {
  return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
}
