import { chassisDef } from '../data/chassis';
import { FURY_ROAD, HAZARDS, HIGHWAY, type Range, type SceneKind } from '../data/modes';
import { NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { START_KITS } from '../data/start';
import { hulkBoxes } from './body';
import { fromRoad, milestoneAt, roadAt, roadHeading, roadPiece, stretchOf, stretchStream, type RoadPiece, type RoadPos } from './highway';
import { boxDistance, propBoxes, propObstacle, type PosedBox } from './mapgen';
import { hashRandom, nextRandom, randInt, randRange, type Rng } from './rng';
import type { DeckSpec } from '../data/terrain';
import type { PropKind } from './terrain';
import type { Vec } from './vec';

const ROAD = HIGHWAY.road;
const H = HAZARDS;
const DEG = Math.PI / 180;

export type Span = { from: number; to: number };
export type Crater = { at: RoadPos; radius: number; depth: number };
export type RampSpec = { id: string; from: RoadPos; to: RoadPos; width: number; rise: number };
export type Scene = Span & { kind: SceneKind; rows: RoadPiece[][]; craters: Crater[]; ramps: RampSpec[] };
export type StretchLayout = { stretch: number; arenas: Span[]; scenes: Scene[] };

type Local = { kind: PropKind; a: number; o: number; r: number; rel: number; hulk?: string };
type LocalCrater = { a: number; o: number; radius: number; depth: number };
type LocalRamp = { a: number; o: number };
type Draft = { kind: SceneKind; rows: Local[][]; craters: LocalCrater[]; ramps: LocalRamp[] };
type Shape = { box: PosedBox } | { circle: { c: Vec; r: number } };
type Band = { lo: number; hi: number; lanes: number[] };

const LAYOUTS = new Map<string, StretchLayout>();

export function stretchLayout(seed: number, j: number): StretchLayout {
  if (!Number.isInteger(j) || j < 1) throw new Error(`Stretch ${j} has no layout`);
  const key = `${seed}:${j}`;
  let layout = LAYOUTS.get(key);
  if (!layout) {
    layout = layStretch(seed, j);
    LAYOUTS.set(key, layout);
  }
  return layout;
}

export function scenesOf(j: number): number {
  const s = H.scenes;
  return Math.min(s.max, s.first + Math.floor((j - 1) / s.every));
}

export function lanesCoveredOf(j: number): number {
  const c = H.lanesCovered;
  return j <= c.upTo ? c.early : c.late;
}

function layStretch(seed: number, j: number): StretchLayout {
  const rng = stretchStream(seed, j, 'scenes');
  const from = milestoneAt(j - 1) + H.clearAfterOutpost;
  const to = milestoneAt(j) - H.clearBeforeOutpost;
  const drafts = Array.from({ length: scenesOf(j) }, (_, i) => draftScene(rng, j, i));
  const extents = drafts.map(draftSpan);
  const spare = to - from - extents.reduce((sum, e) => sum + (e.to - e.from), 0) - (drafts.length + 1) * H.arenaMin;
  if (spare < 0) throw new Error(`Stretch ${j} has no room for ${drafts.length} scenes between arenas of ${H.arenaMin} tiles`);
  const shares = Array.from({ length: drafts.length + 1 }, () => nextRandom(rng) + 0.25);
  const total = shares.reduce((a, b) => a + b, 0);
  const arenas: Span[] = [];
  const scenes: Scene[] = [];
  let n = from;
  drafts.forEach((draft, i) => {
    const arena = H.arenaMin + (spare * shares[i]) / total;
    arenas.push({ from: n, to: n + arena });
    n += arena;
    scenes.push(placeScene(seed, j, i, draft, n - extents[i].from));
    n += extents[i].to - extents[i].from;
  });
  arenas.push({ from: n, to });
  return { stretch: j, arenas, scenes };
}

function weightsOf(j: number): Record<SceneKind, number> {
  const tier = H.tiers.find((t) => j <= t.upTo);
  if (!tier) throw new Error(`Stretch ${j} falls in no scene tier`);
  return tier.weights;
}

function pickKind(rng: Rng, j: number): SceneKind {
  const weights = Object.entries(weightsOf(j)) as [SceneKind, number][];
  let roll = nextRandom(rng) * weights.reduce((sum, [, w]) => sum + w, 0);
  for (const [kind, w] of weights) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return weights[weights.length - 1][0];
}

function draftScene(rng: Rng, j: number, i: number): Draft {
  const kind = pickKind(rng, j);
  for (let tries = 0; tries < H.maxTries; tries++) {
    const draft = DRAFTS[kind](rng, lanesCoveredOf(j));
    if (draft && draftPasses(draft)) return draft;
  }
  throw new Error(`Scene ${i + 1} of stretch ${j}, a ${kind}, found no layout that leaves a way through`);
}

const DRAFTS: Record<SceneKind, (rng: Rng, cap: number) => Draft | null> = {
  pileup: draftPileup,
  jackknife: draftJackknife,
  checkpoint: draftCheckpoint,
  tankline: draftTankline,
  rockfall: draftRockfall,
  craters: draftCraters,
  ramp: draftRamp,
};

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[randInt(rng, 0, list.length - 1)];
}

function sign(rng: Rng): 1 | -1 {
  return nextRandom(rng) < 0.5 ? -1 : 1;
}

function laneBand(rng: Rng, count: number): Band {
  const first = randInt(rng, 0, ROAD.lanes.length - count);
  const lanes = ROAD.lanes.slice(first, first + count);
  return { lo: lanes[0] - ROAD.laneWidth / 2, hi: lanes[lanes.length - 1] + ROAD.laneWidth / 2, lanes };
}

function laneCount(rng: Rng, range: Range, cap: number): number {
  return randInt(rng, range[0], Math.min(range[1], cap));
}

function radiusOf(kind: PropKind): number {
  const r = H.pieceR[kind];
  if (r === undefined) throw new Error(`Hazard piece ${kind} has no radius`);
  return r;
}

function piece(kind: PropKind, a: number, o: number, rel: number): Local {
  return { kind, a, o, r: radiusOf(kind), rel };
}

function hulkPiece(chassisId: string, a: number, o: number, rel: number): Local {
  return { kind: 'deadTruck', a, o, r: chassisDef(chassisId).radius * RULES.wreckRadiusScale, rel, hulk: chassisId };
}

function place(out: Local[], tries: number, make: () => Local, gap = H.pieceGap): boolean {
  for (let t = 0; t < tries; t++) {
    const p = make();
    if (out.every((q) => !overlaps(p, q, gap))) {
      out.push(p);
      return true;
    }
  }
  return false;
}

function draftPileup(rng: Rng, cap: number): Draft | null {
  const P = H.pileup;
  const band = laneBand(rng, laneCount(rng, P.lanes, cap));
  const length = randRange(rng, ...P.length);
  const count = randInt(rng, ...P.vehicles);
  const out: Local[] = [];
  for (let k = 0; k < count; k++) {
    const hulk = nextRandom(rng) < P.hulkShare;
    const chassis = pick(rng, P.hulks);
    const car = pick(rng, P.cars);
    place(out, H.placeTries, () => {
      const a = randRange(rng, 0, length);
      const o = randRange(rng, band.lo + 0.5, band.hi - 0.5);
      const rel = sign(rng) * randRange(rng, ...P.yaw) * DEG;
      return hulk ? hulkPiece(chassis, a, o, rel) : piece(car, a, o, rel);
    });
  }
  if (out.length < P.vehicles[0]) return null;
  const spill = randInt(rng, ...P.spill);
  for (let k = 0; k < spill; k++) {
    const kind = pick(rng, P.spillKinds);
    place(out, H.placeTries, () => piece(kind, length + randRange(rng, ...P.spillAhead), randRange(rng, band.lo + 0.3, band.hi - 0.3), randRange(rng, 0, Math.PI * 2)));
  }
  return { kind: 'pileup', rows: [out], craters: [], ramps: [] };
}

function draftJackknife(rng: Rng, cap: number): Draft | null {
  const J = H.jackknife;
  const band = laneBand(rng, laneCount(rng, J.lanes, cap));
  const at = randInt(rng, 0, band.lanes.length - 2);
  const across = (band.lanes[at] + band.lanes[at + 1]) / 2;
  const out = [hulkPiece(pick(rng, J.hulks), 0, across, sign(rng) * randRange(rng, ...J.yaw) * DEG)];
  const cars = randInt(rng, ...J.cars);
  let behind = 0;
  for (let k = 0; k < cars; k++) {
    const car = pick(rng, H.pileup.cars);
    const lane = pick(rng, band.lanes);
    behind += randRange(rng, ...J.behind);
    if (!place(out, H.placeTries, () => piece(car, -behind - randRange(rng, 0, 0.6), lane + randRange(rng, -0.25, 0.25), randRange(rng, -J.carYaw, J.carYaw) * DEG))) return null;
  }
  return { kind: 'jackknife', rows: [out], craters: [], ramps: [] };
}

function draftCheckpoint(rng: Rng): Draft | null {
  const C = H.checkpoint;
  const lines = randInt(rng, ...C.lines);
  const first = sign(rng);
  const traps = randInt(rng, ...C.traps);
  const truckLine = randInt(rng, 0, lines - 1);
  const rows = Array.from({ length: lines }, (_, i) => checkpointLine(rng, i, i % 2 === 0 ? first : -first, { lines, traps, truck: i === truckLine }));
  return { kind: 'checkpoint', rows, craters: [], ramps: [] };
}

function checkpointLine(rng: Rng, i: number, side: number, of: { lines: number; traps: number; truck: boolean }): Local[] {
  const C = H.checkpoint;
  const a = i * C.spacing;
  const row: Local[] = [];
  for (let o = C.inner + C.barrierStep / 2; o < ROAD.asphalt; o += C.barrierStep) row.push(piece('barrier', a, side * o, Math.PI / 2 + randRange(rng, -C.lineYaw, C.lineYaw) * DEG));
  const bags = randInt(rng, ...C.sandbags);
  for (let k = 0; k < bags; k++) place(row, H.placeTries, () => piece('sandbags', a + C.behind, side * (C.inner + 0.4 + k * C.bagStep), randRange(rng, -0.1, 0.1)));
  for (let k = i; k < of.traps; k += of.lines) row.push(piece('tankTrap', a + randRange(rng, -0.3, 0.3), side * (C.trapFrom + Math.floor(k / of.lines) * C.trapStep), randRange(rng, 0, Math.PI)));
  if (of.truck) place(row, H.placeTries, () => piece('armyTruck', a + randRange(rng, 0.5, 1), side * randRange(rng, ...C.truckAcross), randRange(rng, -C.truckYaw, C.truckYaw) * DEG));
  return row;
}

function draftTankline(rng: Rng, cap: number): Draft | null {
  const T = H.tankline;
  const band = laneBand(rng, laneCount(rng, T.lanes, cap));
  const rowsAt = band.lanes.length === 1 ? [band.lanes[0] - 0.5, band.lanes[0] + 0.5] : band.lanes.slice(0, 2);
  const count = randInt(rng, ...T.traps);
  const step = randRange(rng, ...T.step);
  const out: Local[] = [];
  for (let k = 0; k < count; k++) out.push(piece('tankTrap', Math.floor(k / 2) * step + (k % 2) * (step / 2), rowsAt[k % 2] + randRange(rng, -0.15, 0.15), randRange(rng, 0, Math.PI)));
  const side = sign(rng);
  const length = Math.floor((count - 1) / 2) * step + step / 2;
  if (!place(out, H.placeTries, () => piece('tank', randRange(rng, 0, length), side * randRange(rng, ...T.tankAcross), randRange(rng, -T.tankYaw, T.tankYaw) * DEG))) return null;
  return { kind: 'tankline', rows: [out], craters: [], ramps: [] };
}

function draftRockfall(rng: Rng): Draft | null {
  const R = H.rockfall;
  const side = sign(rng);
  const crag: Local = { kind: 'crag', a: 0, o: side * randRange(rng, ...R.crag.across), r: randRange(rng, ...R.crag.r), rel: randRange(rng, 0, Math.PI * 2) };
  const out = [crag];
  const rocks = randInt(rng, ...R.rocks);
  const from = Math.abs(crag.o) - crag.r;
  for (let k = 0; k < rocks; k++) {
    place(out, H.placeTries, () => {
      const t = nextRandom(rng);
      const r = R.r[1] + (R.r[0] - R.r[1]) * t;
      const o = side * (from - t * (from - R.reach) - r);
      return { kind: 'rock', a: randRange(rng, -R.fan, R.fan) * (0.4 + t), o, r, rel: 0 };
    }, R.gap);
  }
  return out.length >= R.rocks[0] ? { kind: 'rockfall', rows: [out], craters: [], ramps: [] } : null;
}

function draftCraters(rng: Rng): Draft | null {
  const C = H.craters;
  const count = randInt(rng, ...C.count);
  const craters: LocalCrater[] = [];
  let a = 0;
  for (let k = 0; k < count; k++) {
    const radius = randRange(rng, ...C.radius);
    craters.push({ a, o: randRange(rng, -ROAD.asphalt + radius, ROAD.asphalt - radius), radius, depth: randRange(rng, ...C.depth) });
    a += randRange(rng, ...C.spacing) + radius;
  }
  const junk: Local[] = [];
  const pieces = randInt(rng, ...C.junk);
  for (let k = 0; k < pieces; k++) {
    const c = pick(rng, craters);
    place(junk, H.placeTries, () => piece('junk', c.a + randRange(rng, -c.radius, c.radius), c.o + sign(rng) * (c.radius + 0.7), randRange(rng, 0, Math.PI * 2)));
  }
  return { kind: 'craters', rows: [junk], craters, ramps: [] };
}

function draftRamp(rng: Rng): Draft | null {
  const R = H.ramp;
  const lane = pick(rng, ROAD.lanes);
  const craters = nextRandom(rng) < R.craterChance ? [{ a: R.length + R.craterGap, o: lane, radius: randRange(rng, ...H.craters.radius), depth: randRange(rng, ...H.craters.depth) }] : [];
  return { kind: 'ramp', rows: [[]], craters, ramps: [{ a: 0, o: lane }] };
}

function proxyProp(p: Local) {
  return { kind: p.kind, pos: { x: p.o, y: -p.a }, r: p.r, yaw: p.rel - Math.PI / 2, group: 0, step: 0, hulk: p.hulk };
}

const SHAPES = new WeakMap<Local, Shape[]>();

function shapesOf(p: Local): Shape[] {
  let shapes = SHAPES.get(p);
  if (!shapes) {
    if (p.hulk) hulkBoxes(p.hulk);
    shapes = p.kind === 'rock' || p.kind === 'crag' ? [{ circle: { c: { x: p.o, y: -p.a }, r: p.r } }] : propBoxes(propObstacle(proxyProp(p), 0)).map((box) => ({ box }));
    SHAPES.set(p, shapes);
  }
  return shapes;
}

function corners(b: PosedBox): Vec[] {
  return [-1, 1].flatMap((i) => [-1, 1].map((k) => ({
    x: b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * k,
    y: b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * k,
  })));
}

function shapeSpan(s: Shape, dir: Vec): [number, number] {
  if ('circle' in s) {
    const c = s.circle.c.x * dir.x + s.circle.c.y * dir.y;
    return [c - s.circle.r, c + s.circle.r];
  }
  const dots = corners(s.box).map((p) => p.x * dir.x + p.y * dir.y);
  return [Math.min(...dots), Math.max(...dots)];
}

function boxesApart(a: PosedBox, b: PosedBox): boolean {
  const axes = [a.axis, { x: -a.axis.y, y: a.axis.x }, b.axis, { x: -b.axis.y, y: b.axis.x }];
  return axes.some((dir) => {
    const sa = shapeSpan({ box: a }, dir);
    const sb = shapeSpan({ box: b }, dir);
    return sa[1] + H.pieceGap <= sb[0] || sb[1] + H.pieceGap <= sa[0];
  });
}

function shapesTouch(a: Shape, b: Shape, gap: number): boolean {
  if ('circle' in a && 'circle' in b) return Math.hypot(a.circle.c.x - b.circle.c.x, a.circle.c.y - b.circle.c.y) < a.circle.r + b.circle.r + gap;
  if ('circle' in a) return 'box' in b && boxDistance(b.box, a.circle.c) < a.circle.r + gap;
  if ('circle' in b) return boxDistance(a.box, b.circle.c) < b.circle.r + gap;
  return !boxesApart(a.box, b.box);
}

function overlaps(p: Local, q: Local, gap: number): boolean {
  if (Math.hypot(p.a - q.a, p.o - q.o) > 6 + gap) return false;
  return shapesOf(p).some((a) => shapesOf(q).some((b) => shapesTouch(a, b, gap)));
}

const ACROSS: Vec = { x: 1, y: 0 };
const ALONG: Vec = { x: 0, y: -1 };

function rowSpan(row: Local[], dir: Vec): [number, number] {
  const spans = row.flatMap((p) => shapesOf(p).map((s) => shapeSpan(s, dir)));
  return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
}

let widest: number | null = null;

export function passageInflate(): number {
  widest ??= Math.max(
    chassisDef(START_KITS.furyRoad.chassis).radius,
    ...FURY_ROAD.waves.flat().flatMap((g) => g.templates).flatMap((id) => NPCS[id].loadout.chassis.map((c) => chassisDef(c.value).radius)),
  );
  return widest + H.inflate;
}

export function freeAcross(blocked: [number, number][]): [number, number][] {
  const grow = passageInflate();
  const spans = blocked.map(([lo, hi]): [number, number] => [lo - grow, hi + grow]).sort((x, y) => x[0] - y[0]);
  const free: [number, number][] = [];
  let at = -ROAD.verge;
  for (const [lo, hi] of spans) {
    if (lo > at) free.push([at, Math.min(lo, ROAD.verge)]);
    at = Math.max(at, hi);
  }
  if (at < ROAD.verge) free.push([at, ROAD.verge]);
  return free.filter(([lo, hi]) => hi > lo);
}

export function leavesPassage(blocked: [number, number][]): boolean {
  return freeAcross(blocked).some(([lo, hi]) => hi - lo >= H.passage && Math.min(hi, ROAD.asphalt) - Math.max(lo, -ROAD.asphalt) >= H.onAsphalt);
}

function draftPasses(draft: Draft): boolean {
  const rows = draft.rows.filter((row) => row.length > 0);
  if (!rows.every((row) => leavesPassage(row.flatMap((p) => shapesOf(p).map((s) => shapeSpan(s, ACROSS)))))) return false;
  const along = rows.map((row) => rowSpan(row, ALONG)).sort((x, y) => x[0] - y[0]);
  return along.every((span, i) => i === 0 || span[0] - along[i - 1][1] >= H.passage + 2 * passageInflate());
}

function draftSpan(draft: Draft): Span {
  const pieces = draft.rows.flat();
  const ends = [
    ...pieces.map((p) => rowSpan([p], ALONG)),
    ...draft.craters.map((c): [number, number] => [c.a - c.radius, c.a + c.radius]),
    ...draft.ramps.map((r): [number, number] => [r.a, r.a + H.ramp.length]),
  ];
  return { from: Math.min(...ends.map((e) => e[0])), to: Math.max(...ends.map((e) => e[1])) };
}

function placeScene(seed: number, j: number, i: number, draft: Draft, n0: number): Scene {
  const span = draftSpan(draft);
  const toPiece = (p: Local, k: number): RoadPiece => {
    const n = n0 + p.a;
    return { kind: p.kind, at: roadAt(seed, n, p.o), r: p.r, yaw: roadHeading(seed, n) + p.rel, group: 0, step: k, ...(p.hulk ? { hulk: p.hulk } : {}) };
  };
  const ramps = draft.ramps.map((r, k): RampSpec => ({ id: `ramp-${j}-${i}-${k}`, from: roadAt(seed, n0 + r.a, r.o), to: roadAt(seed, n0 + r.a + H.ramp.length, r.o), width: H.ramp.width, rise: H.ramp.rise }));
  return {
    kind: draft.kind,
    from: n0 + span.from,
    to: n0 + span.to,
    rows: draft.rows.map((row) => row.map(toPiece)),
    craters: draft.craters.map((c) => ({ at: roadAt(seed, n0 + c.a, c.o), radius: c.radius, depth: c.depth })),
    ramps,
  };
}

export function scenePieces(scene: Scene): RoadPiece[] {
  return scene.rows.flat();
}

export function sceneAt(seed: number, n: number, margin: number): Scene | null {
  const j = stretchOf(n);
  if (j < 1) return null;
  return stretchLayout(seed, j).scenes.find((s) => n >= s.from - margin && n <= s.to + margin) ?? null;
}

export function windowStretches(window: number): number[] {
  return [window, window + 1, window + 2].filter((j) => j >= 1);
}

export function craterDip(craters: readonly Crater[], at: RoadPos): number {
  let dip = 0;
  for (const c of craters) {
    if (Math.abs(at.n - c.at.n) >= c.radius || Math.abs(at.u - c.at.u) >= c.radius) continue;
    const d = Math.hypot(at.n - c.at.n, at.u - c.at.u) / c.radius;
    if (d < 1) dip += c.depth * (1 - d * d) * (1 - d * d);
  }
  return dip;
}

export function windowCraters(seed: number, window: number): Crater[] {
  return windowStretches(window).flatMap((j) => stretchLayout(seed, j).scenes.flatMap((s) => s.craters));
}


const CLOSURE_SALT = 0x68776364;

function rolled<T>(list: readonly T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}

function closureRoll(seed: number, window: number, k: number): number {
  return hashRandom(seed, CLOSURE_SALT, window, k);
}

function lineRow(seed: number, n: number, offset: number, kinds: (k: number) => Local, reach: number): RoadPiece[] {
  const out: RoadPiece[] = [];
  let cursor = -reach + offset;
  for (let k = 0; cursor < reach; k++) {
    const p = kinds(k);
    const [lo, hi] = rowSpan([{ ...p, a: 0, o: 0 }], ACROSS);
    const o = cursor - lo + H.pieceGap;
    cursor = o + hi;
    out.push({ kind: p.kind, at: roadAt(seed, n, o), r: p.r, yaw: roadHeading(seed, n) + p.rel, group: 0, step: k, ...(p.hulk ? { hulk: p.hulk } : {}) });
  }
  return out;
}

export function northClosureAt(window: number): number {
  return milestoneAt(window + 1) + H.closures.north.gap;
}

export function southClosureAt(window: number): number {
  return milestoneAt(window) - H.closures.south.behind;
}

function northClosure(seed: number, window: number): RoadPiece[] {
  const N = H.closures.north;
  const n = northClosureAt(window);
  const barrier = (): Local => piece('barrier', 0, 0, Math.PI / 2);
  const rows = Array.from({ length: N.rows }, (_, i) => lineRow(seed, n + i * N.rowGap, (i % 2) * 0.5, barrier, N.reach));
  const ahead = n - N.trapsAhead;
  const nests = Array.from({ length: N.sandbags }, (_, k) => {
    const o = ((k + 0.5) / N.sandbags - 0.5) * 2 * ROAD.verge;
    return roadPiece('sandbags', roadAt(seed, n - 1, o), radiusOf('sandbags'), roadHeading(seed, n));
  });
  const traps = Array.from({ length: N.traps }, (_, k) => {
    const o = ((k + 0.5) / N.traps - 0.5) * 2 * ROAD.asphalt * 1.6;
    return roadPiece('tankTrap', roadAt(seed, ahead, o), radiusOf('tankTrap'), closureRoll(seed, window, k) * Math.PI);
  });
  return [...rows.flat(), ...nests, ...traps];
}

function southClosure(seed: number, window: number): RoadPiece[] {
  const S = H.closures.south;
  const n = southClosureAt(window);
  const wreck = (row: number) => (k: number): Local => {
    const key = 3 * (1000 * (row + 1) + k);
    const rel = Math.PI / 2 + (closureRoll(seed, window, key) < 0.5 ? -1 : 1) * S.yaw * DEG;
    const which = closureRoll(seed, window, key + 2);
    if (closureRoll(seed, window, key + 1) < S.hulkShare) return hulkPiece(rolled(H.pileup.hulks, which), 0, 0, rel);
    return piece(rolled(H.pileup.cars, which), 0, 0, rel);
  };
  return Array.from({ length: S.rows }, (_, i) => lineRow(seed, n + i * S.rowGap, (i % 2) * 0.7, wreck(i), S.reach)).flat();
}

export function closurePieces(seed: number, window: number): RoadPiece[] {
  return [...northClosure(seed, window), ...southClosure(seed, window)];
}

export function highwayDecks(seed: number, window: number): DeckSpec[] {
  const size = HIGHWAY.size;
  const inside = (p: Vec) => p.x >= 0 && p.y >= 0 && p.x <= size && p.y <= size;
  return windowStretches(window).flatMap((j) => stretchLayout(seed, j).scenes.flatMap((s) => s.ramps)).flatMap((ramp) => {
    const from = fromRoad(window, ramp.from.n, ramp.from.u);
    const to = fromRoad(window, ramp.to.n, ramp.to.u);
    if (!inside(from) || !inside(to)) return [];
    return [{ id: ramp.id, line: [{ at: from, rise: 0 }, { at: to, rise: ramp.rise }], width: ramp.width, cut: null, skirt: true, look: 'ship_flap' as const }];
  });
}
