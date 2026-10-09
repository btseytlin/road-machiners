// Fortress layout: the curtain outline of each fortress site, and the wall, tower, gatehouse, bastion and inner
// gate pieces that close it, and the pit dug inside a curtain. Map tiles throughout.
//

import { FORTRESS, FORTRESS_SITES, FORTRESS_STYLES, type FortressBastions, type FortressKind, type FortressSite, type FortressStyle, type FortressStyleDef } from '../data/fortress';
import { siteGates, siteLook, type Site } from './sites';
import type { BakedProp, PropKind } from './terrain';
import { bearing, DEG, dist, pointInPolygon, polygonEdgeDist, segmentDist, type Vec } from './vec';

export const FORT_PROPS = {
  masonry: { wall: 'fortMasonryWall', tower: 'fortMasonryTower', gate: 'fortMasonryGate', bastion: 'fortMasonryBastion', inner: 'fortMasonryInner' },
  shipMetal: { wall: 'fortShipWall', tower: 'fortShipTower', gate: 'fortShipGate' },
  scrap: { wall: 'fortScrapWall', tower: 'fortScrapTower', gate: 'fortScrapGate', bastion: 'fortScrapBastion', inner: 'fortScrapInner' },
  patchwork: { wall: 'fortPatchworkWall', tower: 'fortPatchworkTower', gate: 'fortPatchworkGate' },
  compound: { wall: 'fortCompoundWall', tower: 'fortCompoundTower', gate: 'fortCompoundGate' },
  ring: { wall: 'fortRingWall', gate: 'fortRingGate' },
  yard: { wall: 'fortYardWall', tower: 'fortYardTower', gate: 'fortYardGate' },
} as const satisfies Record<FortressStyle, Partial<Record<FortressKind, PropKind>>>;
const FORT_STYLE_NAMES = { masonry: 'masonry', shipMetal: 'ship', scrap: 'scrap', patchwork: 'patchwork', compound: 'compound', ring: 'ring', yard: 'yard' } as const satisfies Record<FortressStyle, string>;
export type FortModel = { [S in FortressStyle]: `fort_${(typeof FORT_STYLE_NAMES)[S]}_${keyof (typeof FORT_PROPS)[S] & string}` }[FortressStyle];

export const FORT_MODELS: ReadonlyMap<PropKind, { model: FortModel; piece: FortressKind }> = new Map(
  (Object.keys(FORT_PROPS) as FortressStyle[]).flatMap((style) =>
    (Object.entries(FORT_PROPS[style]) as [FortressKind, PropKind][]).map(([piece, kind]) => [kind, { model: `fort_${FORT_STYLE_NAMES[style]}_${piece}` as FortModel, piece }] as const),
  ),
);

export function fortProp(style: FortressStyle, piece: FortressKind): PropKind {
  const table: Partial<Record<FortressKind, PropKind>> = FORT_PROPS[style];
  const kind = table[piece];
  if (kind === undefined || !FORTRESS_STYLES[style].pieces.includes(piece)) throw new Error(`Fortress style ${style} has no ${piece} piece`);
  return kind;
}

export type FortressPiece = { kind: FortressKind; pos: Vec; yaw: number; r: number };

type Corner = { pos: Vec; piece: 'tower' | 'bastion' | null };
type Rect = { center: Vec; axis: Vec; half: { along: number; across: number } };
type Run = { points: Vec[]; corners: (number | null)[] };

export type FortGate = { gate: Vec; face: Vec; out: Vec; width: number; height: number };

const OUTLINES = new WeakMap<Site, Vec[]>();
const CORES = new WeakMap<Site, Vec[]>();
const GATES = new WeakMap<Site, FortGate[]>();

export function fortressOutline(site: Site): Vec[] {
  let outline = OUTLINES.get(site);
  if (outline === undefined) {
    outline = outlineCorners(site).map((c) => c.pos);
    OUTLINES.set(site, outline);
  }
  return outline;
}

export function fortressCore(site: Site): Vec[] {
  let core = CORES.get(site);
  if (core === undefined) {
    const def = fortressOf(site);
    core = def.shape === 'bastioned' ? bastionVertices(site, def).map((v) => v.inner) : fortressOutline(site);
    CORES.set(site, core);
  }
  return core;
}

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

export function fortressGates(site: Site): FortGate[] {
  let gates = GATES.get(site);
  if (gates === undefined) {
    const outline = fortressOutline(site);
    gates = siteGates(site).map((gate) => gateSpot(site, gate, outline).fort);
    GATES.set(site, gates);
  }
  return gates;
}

export function fortressPieces(site: Site): FortressPiece[] {
  const corners = outlineCorners(site);
  const laid = siteGates(site).map((gate) => layGate(site, gate, corners));
  const cuts = laid.map((l) => l.cut);
  const houses = laid.flatMap((l) => (l.standsIn === null ? [] : [l.standsIn]));
  const outline = corners.map((c) => c.pos);
  const walls = cutOutline(outline, cuts, (i) => onFortressRock(site, lerpVec(outline[i], outline[(i + 1) % outline.length], 0.5))).flatMap((run) => wallRun(mergeShortEnds(run, corners)));
  const standing = cornerPieces(site, corners, houses).filter((p) => !onFortressRock(site, p.pos));
  return [...laid.flatMap((l) => l.pieces), ...walls, ...standing];
}

export function onFortressRock(site: Site, p: Vec): boolean {
  const { rock, turn } = fortressOf(site);
  const turned = (deg: number): number => ((deg % 360) + 360) % 360;
  return (rock ?? []).some((r) => turned(bearing(site.pos, p) / DEG - turn - r.from) <= turned(r.to - r.from));
}

export function pitDepth(site: Site, p: Vec): number {
  const pit = fortressOf(site).pit;
  if (pit === undefined) throw new Error(`Site ${site.id} has no pit`);
  const core = fortressCore(site);
  if (!pointInPolygon(p, core)) return 0;
  const past = polygonEdgeDist(p, core) - pit.margin;
  if (past <= 0) return 0;
  return pit.stepHeight * Math.min(pit.terraces, Math.ceil(past / pit.terraceWidth));
}

function wallRun(points: Vec[]): FortressPiece[] {
  return points.slice(1).flatMap((p, i) => wallLine(points[i], p));
}

function cornerPieces(site: Site, corners: Corner[], houses: Rect[]): FortressPiece[] {
  const style = fortressOf(site).style;
  return corners.flatMap((c) => {
    if (c.piece === null || houses.some((h) => inRect(h, c.pos))) return [];
    fortProp(style, c.piece);
    const size = c.piece === 'tower' ? FORTRESS.towerSize : FORTRESS.bastionSize;
    return [{ kind: c.piece, pos: c.pos, yaw: bearing(site.pos, c.pos) + Math.PI / 2, r: size / 2 }];
  });
}

export function fortressFootprint(site: Site, piece: FortressPiece): Vec[] {
  const rect = pieceRect(styleOf(site), piece);
  const { axis, half, center } = rect;
  const side = { x: -axis.y, y: axis.x };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, s]) => ({ x: center.x + axis.x * half.along * a + side.x * half.across * s, y: center.y + axis.y * half.along * a + side.y * half.across * s }));
}

function pieceRect(style: FortressStyleDef, piece: FortressPiece): Rect {
  const axis = { x: Math.cos(piece.yaw), y: Math.sin(piece.yaw) };
  const across = { wall: FORTRESS.wallDepth, inner: FORTRESS.wallDepth, gate: style.gate.depth, tower: FORTRESS.towerSize, bastion: FORTRESS.bastionSize }[piece.kind];
  return { center: piece.pos, axis, half: { along: piece.r, across: across / 2 } };
}

function fortressOf(site: Site): FortressSite {
  const def: FortressSite | undefined = FORTRESS_SITES[siteLook(site)];
  if (def === undefined) throw new Error(`Site ${site.id} is no fortress`);
  return 'turn' in site && site.turn !== undefined ? { ...def, turn: site.turn } : def;
}

export function fortressStyle(site: Site): FortressStyle {
  return fortressOf(site).style;
}

export function fortressProps(site: Site): BakedProp[] {
  const style = fortressStyle(site);
  return fortressPieces(site).map((piece) => bakedPiece(style, piece));
}

function bakedPiece(style: FortressStyle, piece: FortressPiece): BakedProp {
  const base = { kind: fortProp(style, piece.kind), r: piece.r, group: 0, step: 0 };
  if (piece.kind === 'gate') {
    const yaw = piece.yaw - Math.PI / 2;
    const { gate, gateFlare } = FORTRESS_STYLES[style];
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, gate.depth / 2 - gateFlare), yaw };
  }
  if (piece.kind === 'bastion') {
    const yaw = piece.yaw - Math.PI / 2;
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, -FORTRESS.bastionBack), yaw };
  }
  if (piece.kind === 'inner') return { ...base, pos: piece.pos, yaw: piece.yaw - Math.PI / 2 };
  return { ...base, pos: piece.pos, yaw: piece.yaw };
}

function styleOf(site: Site): FortressStyleDef {
  return FORTRESS_STYLES[fortressOf(site).style];
}

function outlineCorners(site: Site): Corner[] {
  const def = fortressOf(site);
  const radius = site.radius - FORTRESS.inset;
  const turn = def.turn * DEG;
  const at = (a: number, r: number): Vec => ({ x: site.pos.x + Math.cos(turn + a) * r, y: site.pos.y + Math.sin(turn + a) * r });
  if (def.shape === 'square') return [0, 1, 2, 3].map((k) => ({ pos: at((k * Math.PI) / 2, radius), piece: 'tower' }));
  if (def.shape === 'bastioned') return bastionedCorners(site, def);
  if (def.shape === 'star') {
    const count = FORTRESS.starPoints * 2;
    return Array.from({ length: count }, (_, k) => {
      const point = k % 2 === 0;
      return { pos: at((k * 2 * Math.PI) / count, point ? radius : radius * (1 - FORTRESS.starDepth)), piece: point ? 'bastion' : null };
    });
  }
  const every = def.towerEvery ?? FORTRESS.circleTowerEvery;
  const count = every * Math.ceil((2 * Math.PI * radius) / (FORTRESS.wallLength * every));
  const towers = def.towers ?? true;
  return Array.from({ length: count }, (_, k) => ({ pos: at((k * 2 * Math.PI) / count, radius), piece: towers && k % every === 0 ? 'tower' : null }));
}

type BastionVertex = { capital: number; inner: Vec };

function bastionVertices(site: Site, def: FortressSite): BastionVertex[] {
  const b = def.bastions;
  if (b === undefined || b.capitals.length < 3) throw new Error(`Site ${site.id} has a bastioned outline with under three bastions`);
  return b.capitals.map((c) => {
    const a = (def.turn + c) * DEG;
    return { capital: a, inner: { x: site.pos.x + Math.cos(a) * b.curtain, y: site.pos.y + Math.sin(a) * b.curtain } };
  });
}

function bastionedCorners(site: Site, def: FortressSite): Corner[] {
  const b = def.bastions as FortressBastions;
  const vertices = bastionVertices(site, def);
  const n = vertices.length;
  const half = FORTRESS.towerSize / 2;
  const toward = (from: Vec, to: Vec, d: number): Vec => along(from, unit(from, to), d);
  const out = (p: Vec, from: Vec, to: Vec): Vec => {
    const u = unit(from, to);
    return { x: p.x + u.y * b.flank, y: p.y - u.x * b.flank };
  };
  const corners = vertices.flatMap((v, i): Corner[] => {
    const prev = vertices[(i + n - 1) % n].inner;
    const next = vertices[(i + 1) % n].inner;
    for (const [from, to] of [[prev, v.inner], [v.inner, next]]) {
      if (dist(from, to) < 2 * b.gorge + FORTRESS.wallLength) throw new Error(`Site ${site.id} has a curtain too short for its bastion gorges`);
    }
    const gorgeL = toward(v.inner, prev, b.gorge);
    const gorgeR = toward(v.inner, next, b.gorge);
    const salient = { x: site.pos.x + Math.cos(v.capital) * b.salient, y: site.pos.y + Math.sin(v.capital) * b.salient };
    const left = out(gorgeL, prev, v.inner);
    const right = out(gorgeR, v.inner, next);
    for (const t of [left, salient, right]) {
      if (Math.hypot(dist(site.pos, t) + half, half) > site.radius) throw new Error(`Site ${site.id} has a bastion tower at ${fmt(t)} outside its circle`);
    }
    return [
      { pos: gorgeL, piece: null },
      { pos: left, piece: 'tower' },
      { pos: salient, piece: 'tower' },
      { pos: right, piece: 'tower' },
      { pos: gorgeR, piece: null },
    ];
  });
  const outline = corners.map((c) => c.pos);
  const crossing = outline.findIndex((a, i) => outline.some((c, j) => j > i + 1 && !(i === 0 && j === outline.length - 1) && segmentsCross(a, outline[(i + 1) % outline.length], c, outline[(j + 1) % outline.length])));
  if (crossing >= 0) throw new Error(`Site ${site.id} has a bastioned outline that crosses itself at ${fmt(outline[crossing])}`);
  return corners;
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const turn = (p: Vec, q: Vec, r: Vec): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

function unit(from: Vec, to: Vec): Vec {
  const d = dist(from, to);
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

function gateSpot(site: Site, gate: Vec, outline: Vec[]): { fort: FortGate; house: FortressPiece } {
  const style = styleOf(site);
  const { width, depth, height } = style.gate;
  const a = bearing(site.pos, gate);
  const out = { x: Math.cos(a), y: Math.sin(a) };
  if (!style.flush) return { fort: { gate, face: gate, out, width, height }, house: { kind: 'gate', pos: along(gate, out, -depth / 2), yaw: a + Math.PI / 2, r: width / 2 } };
  const cast = castToOutline(gate, { x: -out.x, y: -out.y }, outline);
  if (cast === null) throw new Error(`Site ${site.id} has a gate that misses its curtain at ${fmt(gate)}`);
  const yaw = bearing(outline[cast.segment], outline[(cast.segment + 1) % outline.length]);
  const normal = { x: Math.sin(yaw), y: -Math.cos(yaw) };
  return { fort: { gate, face: cast.point, out, width, height }, house: { kind: 'gate', pos: along(cast.point, normal, -depth / 2), yaw, r: width / 2 } };
}

function layGate(site: Site, gate: Vec, corners: Corner[]): { pieces: FortressPiece[]; cut: Rect; standsIn: Rect | null } {
  const outline = corners.map((c) => c.pos);
  const style = styleOf(site);
  const { house: gatehouse, fort } = gateSpot(site, gate, outline);
  const house = pieceRect(style, gatehouse);
  const tagged = corners.filter((c) => c.piece !== null).map((c) => c.pos);
  const cut: Rect = style.flush ? { center: fort.face, axis: house.axis, half: { along: house.half.along, across: style.gate.depth } } : house;
  if (!style.flush && !outline.some((p, i) => clipSegment(p, outline[(i + 1) % outline.length], house) !== null)) {
    const barbican = layBarbican(site, { gate, out: fort.out, outline, tagged });
    return { pieces: [gatehouse, ...barbican.pieces], cut: barbican.cut, standsIn: null };
  }
  checkGateClearance(site, gate, cut, corners);
  return { pieces: [gatehouse], cut, standsIn: cut };
}

function checkGateClearance(site: Site, gate: Vec, cut: Rect, corners: Corner[]): void {
  const keepClear = corners.filter((c) => c.piece !== null || fortressOf(site).shape === 'bastioned');
  for (const c of keepClear) {
    if (Math.abs(rectEdgeDistance(cut, c.pos)) < FORTRESS.gateClearance) throw new Error(`Site ${site.id} has a corner on the edge of its gatehouse at ${fmt(gate)}`);
  }
}

type GateSpot = { gate: Vec; out: Vec; outline: Vec[]; tagged: Vec[] };

function layBarbican(site: Site, spot: GateSpot): { pieces: FortressPiece[]; cut: Rect } {
  const { gate, out, outline, tagged } = spot;
  const style = styleOf(site);
  fortProp(fortressOf(site).style, 'inner');
  const { width, depth } = style.gate;
  const tangent = { x: -out.y, y: out.x };
  const back = along(gate, out, -depth);
  const inward = { x: -out.x, y: -out.y };
  const necks = [1, -1].map((side) => {
    const from = along(back, tangent, side * (width / 2 - FORTRESS.wallDepth / 2));
    const reach = castToOutline(from, inward, outline);
    if (reach === null) throw new Error(`Site ${site.id} has a barbican neck that misses the curtain at ${fmt(gate)}`);
    const into = Math.max(0, FORTRESS.wallLength - FORTRESS.wallDepth - reach.distance);
    if (into > depth) throw new Error(`Site ${site.id} has no room for a barbican neck at ${fmt(gate)}`);
    return { start: along(from, out, into), end: reach.point };
  });
  const crossing = castToOutline(gate, inward, outline);
  if (crossing === null) throw new Error(`Site ${site.id} has a gate that misses its curtain at ${fmt(gate)}`);
  const sideFrom = outline[crossing.segment];
  const sideTo = outline[(crossing.segment + 1) % outline.length];
  const inner: FortressPiece = { kind: 'inner', pos: crossing.point, yaw: bearing(sideFrom, sideTo), r: FORTRESS.innerWidth / 2 };
  const cut = pieceRect(style, inner);
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

function cutOutline(outline: Vec[], cuts: Rect[], onRock: (segment: number) => boolean): Run[] {
  const kept = outline.flatMap((_, i) => (onRock(i) ? [] : keptSpans(outline, i, cuts)));
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

function firstCut(kept: Span[], n: number): number {
  const first = kept.findIndex((k, i) => !continues(kept[(i - 1 + kept.length) % kept.length], k, n));
  if (first < 0) throw new Error('A fortress outline has no gate cut');
  return first;
}

function continues(prev: Span, k: Span, n: number): boolean {
  return k.t0 === 0 && prev.t1 === 1 && prev.segment === (k.segment - 1 + n) % n;
}

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

function castToOutline(p: Vec, dir: Vec, outline: Vec[]): Cast | null {
  const hits = outline.flatMap((a, i): Cast[] => {
    const t = rayHit(p, dir, a, outline[(i + 1) % outline.length]);
    return t === null ? [] : [{ point: along(p, dir, t), distance: t, segment: i }];
  });
  return hits.reduce<Cast | null>((best, h) => (best === null || h.distance < best.distance ? h : best), null);
}

function rayHit(p: Vec, dir: Vec, a: Vec, b: Vec): number | null {
  const e = { x: b.x - a.x, y: b.y - a.y };
  const denom = dir.x * e.y - dir.y * e.x;
  if (Math.abs(denom) < 1e-12) return null;
  const w = { x: a.x - p.x, y: a.y - p.y };
  const t = (w.x * e.y - w.y * e.x) / denom;
  const u = (w.x * dir.y - w.y * dir.x) / denom;
  return t < 0 || u < 0 || u > 1 ? null : t;
}

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
