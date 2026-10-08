// Old-world layer: what stood on the map before, placed by rules from terrain, flow and today's sites and
// roads. It reads the draft after geology. It appends props and marks old-road and field tiles in d.built.
// Numbers live in OLD_WORLD in src/data/terrain.ts. Every rule draws from the map seed and its own seed offset.

import { REGION } from '../data/region';
import {
  GEOLOGY,
  OLD_WORLD,
  TERRAIN,
  type BendRules,
  type BillboardRules,
  type FieldRules,
  type HighwayRules,
  type OldRoadRules,
  type OverlookRules,
  type PowerLineRules,
  type SettlementRules,
  type TankRules,
} from '../data/terrain';
import { deckAt } from '../sim/bridge';
import { clearOfSites, onDeck } from '../sim/mapgen';
import { ROAD_INDEX } from '../sim/road-index';
import { chance, hashRandom, randInt, randRange, type Rng } from '../sim/rng';
import type { BakedProp, PropKind } from '../sim/terrain';
import { siteGap } from '../sim/sites';
import { angleDiff, bearing, clamp, DEG, dist, polylineDist, segmentDist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';

export const BUILT_NONE = 0;
export const BUILT_OLD_ROAD = 1;
export const BUILT_FIELD = 2;

export type OldSettlement = { pos: Vec; radius: number; farm: boolean; ground: number };
export type OldRoad = { line: RoadLine; width: number; bridges: [Vec, Vec][] };

export function oldWorldLayer(seed: number, d: MapDraft): MapDraft {
  const W = OLD_WORLD;
  shipWing(d);
  const towns = settlements(seed, d, W.settlements);
  overlooks(seed, d, W.overlooks);
  bendBuildings(seed, d, W.bends);
  const roads = [...oldRoads(d, towns, W.oldRoads), ...highway(d, towns, W.oldRoads, W.highway)];
  powerLines(seed, d, W.powerLines);
  billboards(seed, d, W.billboards);
  tankHulks(seed, d, roads, W.tanks);
  fields(seed, d, towns, W.fields);
  return d;
}

export class RoadLine {
  readonly points: Vec[];
  readonly length: number;
  private readonly cum: number[];

  constructor(points: readonly Vec[]) {
    this.points = points.filter((p, k) => k === 0 || dist(points[k - 1], p) > 1e-9);
    if (this.points.length < 2) throw new Error(`A road line needs two distinct points, got ${points.length}`);
    this.cum = [0];
    for (let k = 1; k < this.points.length; k++) this.cum.push(this.cum[k - 1] + dist(this.points[k - 1], this.points[k]));
    this.length = this.cum[this.cum.length - 1];
  }

  pointAt(s: number): Vec {
    const k = this.segmentAt(s);
    const a = this.points[k];
    const b = this.points[k + 1];
    const t = clamp((s - this.cum[k]) / (this.cum[k + 1] - this.cum[k]), 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  dirAt(s: number): Vec {
    const k = this.segmentAt(s);
    return unit(this.points[k], this.points[k + 1]);
  }

  private segmentAt(s: number): number {
    let k = 0;
    while (k < this.points.length - 2 && this.cum[k + 1] < s) k++;
    return k;
  }
}

const HALF = REGION.roadWidth / 2;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];
const CANYON = TERRAIN.features.canyon;
const TURN = Math.PI * 2;

type Scored = { pos: Vec; score: number };

export function shipWing(d: MapDraft): void {
  const W = TERRAIN.features.wing;
  d.props.push(prop('shipWing', W.pos, W.r, W.yaw));
}

export function prop(kind: PropKind, pos: Vec, r: number, yaw: number, group = 0, step = 0): BakedProp {
  return { kind, pos, r, yaw, group, step };
}

export function ruleRng(seed: number, offset: number): Rng {
  return { rngState: Math.floor(hashRandom(seed, offset) * 2 ** 32) | 0 };
}

export function clearGround(size: number, pos: Vec, r: number, roadGap: number): boolean {
  if (Math.min(pos.x, pos.y, size - pos.x, size - pos.y) < O.edgeMargin + r) return false;
  const reach = HALF + roadGap + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach) return false;
  return clearOfSites(pos, r) && !onDeck(pos, HALF + r);
}

export function place(d: MapDraft, p: BakedProp, roadGap: number): boolean {
  if (!clearGround(d.size, p.pos, p.r, roadGap)) return false;
  if (tileSteepness(d.heights, d.size, tileOf(d.size, p.pos)) > TERRAIN.drive.maxSlope) return false;
  if (d.props.some((o) => dist(o.pos, p.pos) < o.r + p.r + O.gap)) return false;
  d.props.push(p);
  return true;
}

export function builtGround(c: Vec): boolean {
  if (deckAt(c.x, c.y) !== null) return true;
  return ROAD_INDEX.nearestWithin(c.x, c.y, HALF) < HALF || !clearOfSites(c, 0);
}

export function isCutTile(d: MapDraft, tile: number): boolean {
  const w = d.size + 1;
  const k = Math.floor(tile / d.size) * w + (tile % d.size);
  if (Math.max(d.flow[k], d.flow[k + 1], d.flow[k + w], d.flow[k + w + 1]) >= GEOLOGY.ground.washFlow) return true;
  return polylineDist(tileCenter(d.size, tile), CANYON.path) <= CANYON.width;
}

export function tileOf(size: number, p: Vec): number {
  return clamp(Math.floor(p.y), 0, size - 1) * size + clamp(Math.floor(p.x), 0, size - 1);
}

export function tileCenter(size: number, tile: number): Vec {
  return { x: (tile % size) + 0.5, y: Math.floor(tile / size) + 0.5 };
}

function tileHeight(d: MapDraft, tile: number): number {
  const w = d.size + 1;
  const k = Math.floor(tile / d.size) * w + (tile % d.size);
  return (d.heights[k] + d.heights[k + 1] + d.heights[k + w] + d.heights[k + w + 1]) / 4;
}

export function tilesWithin(size: number, c: Vec, r: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, Math.floor(c.y - r)); y <= Math.min(size - 1, Math.floor(c.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(c.x - r)); x <= Math.min(size - 1, Math.floor(c.x + r)); x++) {
      if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= r) out.push(y * size + x);
    }
  }
  return out;
}

function spaced<T extends Scored>(spots: T[], spacing: number, count: number): T[] {
  const out: T[] = [];
  for (const s of [...spots].sort((a, b) => b.score - a.score)) {
    if (out.length >= count) break;
    if (out.every((o) => dist(o.pos, s.pos) >= spacing)) out.push(s);
  }
  return out;
}

export function stations(length: number, step: number): number[] {
  const out: number[] = [];
  for (let k = 0; k * step <= length; k++) out.push(k * step);
  return out;
}

function unit(a: Vec, b: Vec): Vec {
  const d = dist(a, b);
  if (d === 0) throw new Error(`No direction between equal points ${a.x}, ${a.y}`);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

export function offset(p: Vec, dir: Vec, by: number): Vec {
  return { x: p.x + dir.x * by, y: p.y + dir.y * by };
}

export function sideOf(dir: Vec, side: number): Vec {
  return { x: -dir.y * side, y: dir.x * side };
}

export function facing(dir: Vec): number {
  return Math.atan2(dir.y, dir.x);
}

export function range(rng: Rng, [lo, hi]: readonly [number, number]): number {
  return randRange(rng, lo, hi);
}

type Anchor = (pos: Vec) => number;

export function settlements(seed: number, d: MapDraft, rules: SettlementRules): OldSettlement[] {
  const rng = ruleRng(seed, rules.seedOffset);
  const spots = spaced(settlementSpots(seed, d, rules), rules.spacing, rules.count);
  return spots.map((s) => settle(d, rng, rules, s.pos));
}

function settlementSpots(seed: number, d: MapDraft, rules: SettlementRules): Scored[] {
  const anchors = siteAnchors();
  const out: Scored[] = [];
  for (let y = rules.candidateStep; y < d.size; y += rules.candidateStep) {
    for (let x = rules.candidateStep; x < d.size; x += rules.candidateStep) {
      const score = settlementScore(seed, d, rules, anchors, { x, y });
      if (score !== null) out.push({ pos: { x, y }, score });
    }
  }
  return out;
}

function settlementScore(seed: number, d: MapDraft, rules: SettlementRules, anchors: Anchor[], pos: Vec): number | null {
  const [near, far] = rules.anchorGap;
  const gap = Math.min(...anchors.map((a) => a(pos)));
  if (gap < near || gap > far) return null;
  if (!clearGround(d.size, pos, rules.radius, rules.roadGap) || !flatAndDry(d, pos, rules)) return null;
  const closeness = 1 - (gap - near) / (far - near);
  return closeness * (1 - rules.jitter) + hashRandom(seed, rules.seedOffset, pos.x, pos.y) * rules.jitter;
}

function siteAnchors(): Anchor[] {
  return [...SITES.map((s): Anchor => (pos) => siteGap(s, pos)), ...roadJunctions().map((j): Anchor => (pos) => dist(pos, j))];
}

export function roadJunctions(): Vec[] {
  return REGION.roads
    .flatMap((road) => [road[0], road[road.length - 1]])
    .filter((p) => REGION.roads.filter((road) => road.some((q) => dist(p, q) < 0.01)).length > 1);
}

function flatAndDry(d: MapDraft, pos: Vec, rules: SettlementRules): boolean {
  return tilesWithin(d.size, pos, rules.radius).every((tile) => tileSteepness(d.heights, d.size, tile) <= rules.flatSlope && !isCutTile(d, tile));
}

function settle(d: MapDraft, rng: Rng, rules: SettlementRules, pos: Vec): OldSettlement {
  const farm = chance(rng, rules.farmShare);
  if (farm) placeWithin(d, rng, rules, pos, chance(rng, rules.towerShare) ? 'waterTower' : 'silo', rules.towerRadius);
  const houses = randInt(rng, rules.houses[0], rules.houses[1]);
  for (let k = 0; k < houses; k++) {
    const kind = chance(rng, rules.intactShare) ? 'house' : 'ruin';
    placeWithin(d, rng, rules, pos, kind, range(rng, rules.houseRadius));
  }
  return { pos, radius: rules.radius, farm, ground: tileHeight(d, tileOf(d.size, pos)) };
}

function placeWithin(d: MapDraft, rng: Rng, rules: SettlementRules, center: Vec, kind: PropKind, r: number): void {
  for (let t = 0; t < rules.placeTries; t++) {
    const a = randRange(rng, 0, TURN);
    const at = Math.max(0, rules.radius - r) * Math.sqrt(randRange(rng, 0, 1));
    const pos = { x: center.x + Math.cos(a) * at, y: center.y + Math.sin(a) * at };
    if (place(d, prop(kind, pos, r, randRange(rng, 0, TURN)), rules.roadGap)) return;
  }
}

type View = Scored & { yaw: number };

const COMPASS: Vec[] = Array.from({ length: 8 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 4), y: Math.sin((k * Math.PI) / 4) }));

export function overlooks(seed: number, d: MapDraft, rules: OverlookRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  for (const view of spaced(overlookSpots(seed, d, rules), rules.spacing, rules.count)) {
    const kind = chance(rng, rules.intactShare) ? 'house' : 'ruin';
    place(d, prop(kind, view.pos, range(rng, rules.radius), view.yaw), rules.roadGap);
  }
}

function overlookSpots(seed: number, d: MapDraft, rules: OverlookRules): View[] {
  const out: View[] = [];
  const from = O.edgeMargin + rules.reach;
  for (let j = from; j <= d.size - from; j += rules.step) {
    for (let i = from; i <= d.size - from; i += rules.step) {
      const view = viewFrom(d, rules, i, j);
      if (view) out.push({ ...view, score: view.score + hashRandom(seed, rules.seedOffset, i, j) });
    }
  }
  return out;
}

function viewFrom(d: MapDraft, rules: OverlookRules, i: number, j: number): View | null {
  const pos = { x: i, y: j };
  if (tileSteepness(d.heights, d.size, j * d.size + i) > rules.flatSlope) return null;
  if (!clearGround(d.size, pos, rules.radius[1], rules.roadGap)) return null;
  const h = d.heights[j * (d.size + 1) + i];
  const around = COMPASS.map((c) => d.heights[Math.round(j + c.y * rules.reach) * (d.size + 1) + Math.round(i + c.x * rules.reach)] - h);
  if (Math.max(...around) > rules.rise) return null;
  const drops = COMPASS.filter((_, k) => around[k] <= -rules.drop);
  if (drops.length < rules.directions) return null;
  const toward = drops.reduce((s, c) => ({ x: s.x + c.x, y: s.y + c.y }), { x: 0, y: 0 });
  return { pos, score: drops.length, yaw: Math.atan2(toward.y, toward.x) };
}

type Bend = Scored & { outer: Vec };

export function bendBuildings(seed: number, d: MapDraft, rules: BendRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  const bends = REGION.roads.flatMap((road) => sharpBends(new RoadLine(road), rules));
  for (const bend of spaced(bends, rules.spacing, Infinity)) {
    if (!chance(rng, rules.chance)) continue;
    const kind = chance(rng, rules.gasShare) ? 'gasStation' : 'house';
    const r = range(rng, rules.radius);
    place(d, prop(kind, offset(bend.pos, bend.outer, HALF + rules.gap + r), r, facing({ x: -bend.outer.x, y: -bend.outer.y })), 0);
  }
}

function sharpBends(line: RoadLine, rules: BendRules): Bend[] {
  const out: Bend[] = [];
  for (let s = rules.reach; s <= line.length - rules.reach; s += rules.sample) {
    const back = line.pointAt(s - rules.reach);
    const p = line.pointAt(s);
    const ahead = line.pointAt(s + rules.reach);
    const turn = Math.abs(angleDiff(bearing(back, p), bearing(p, ahead)));
    if (turn >= rules.angle * DEG) out.push({ pos: p, score: turn, outer: unit({ x: (back.x + ahead.x) / 2, y: (back.y + ahead.y) / 2 }, p) });
  }
  return out;
}

type Link = { from: Vec; to: Vec };

export function oldRoads(d: MapDraft, towns: OldSettlement[], rules: OldRoadRules): OldRoad[] {
  const grid = new RouteGrid(d, rules);
  const out: OldRoad[] = [];
  for (const link of [...townLinks(towns, rules), ...roadLinks(d, towns, rules)]) {
    const path = grid.route(link.from, link.to);
    if (!path) continue;
    out.push(layOldRoad(d, { line: new RoadLine(path.points), width: rules.width, bridges: path.bridges }, rules));
  }
  return out;
}

export function highway(d: MapDraft, towns: OldSettlement[], roads: OldRoadRules, rules: HighwayRules): OldRoad[] {
  const grid = new RouteGrid(d, { ...roads, bridgeCost: rules.bridgeCost, maxBridge: rules.maxBridge });
  const pairs = towns.flatMap((a, k) => towns.slice(k + 1).map((b) => [a.pos, b.pos] as const));
  const candidates = pairs
    .filter(([a, b]) => dist(a, b) <= rules.maxLength)
    .map(([a, b]) => grid.route(a, b))
    .filter((path): path is RoutePath => path !== null)
    .map((path) => ({ path, best: deepestBridge(d, path.bridges.filter((br) => !overCanyon(br)), roads) }))
    .filter((c) => c.best !== null && c.best.gap >= roads.spanGap)
    .sort((x, y) => y.best!.gap - x.best!.gap);
  const chosen: typeof candidates = [];
  for (const c of candidates) {
    if (chosen.length >= rules.count) break;
    if (chosen.every((o) => dist(o.best!.mid, c.best!.mid) >= rules.spacing)) chosen.push(c);
  }
  return chosen.map((c) => layOldRoad(d, { line: new RoadLine(c.path.points), width: roads.width, bridges: c.path.bridges.filter((br) => !overCanyon(br)) }, roads));
}

function deepestBridge(d: MapDraft, bridges: [Vec, Vec][], rules: OldRoadRules): { gap: number; mid: Vec } | null {
  const real = realBridges(d, bridges, rules).map(([a, b]) => ({ gap: gapDepth(d, [a, b]), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }));
  return real.length === 0 ? null : real.reduce((x, y) => (y.gap > x.gap ? y : x));
}

function realBridges(d: MapDraft, bridges: [Vec, Vec][], rules: OldRoadRules): [Vec, Vec][] {
  return bridges.filter((br) => gapDepth(d, br) >= Math.max(rules.minDrop, dist(br[0], br[1]) * rules.minGapRatio));
}

function gapDepth(d: MapDraft, [a, b]: [Vec, Vec]): number {
  const at = (p: Vec) => d.heights[Math.round(p.y) * (d.size + 1) + Math.round(p.x)];
  const steps = Math.ceil(dist(a, b));
  let low = Infinity;
  for (let k = 1; k < steps; k++) low = Math.min(low, at({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }));
  return Math.min(at(a), at(b)) - low;
}

function overCanyon([a, b]: [Vec, Vec]): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return polylineDist(mid, CANYON.path) < CANYON.width + CANYON.bank;
}

function townLinks(towns: OldSettlement[], rules: OldRoadRules): Link[] {
  const pairs = new Set<string>();
  const out: Link[] = [];
  towns.forEach((t, k) => {
    const others = towns.map((o, m) => ({ m, d: m === k ? Infinity : dist(t.pos, o.pos) }));
    const near = others.reduce((a, b) => (b.d < a.d ? b : a));
    const key = `${Math.min(k, near.m)}-${Math.max(k, near.m)}`;
    if (near.d > rules.maxLink || pairs.has(key)) return;
    pairs.add(key);
    out.push({ from: t.pos, to: towns[near.m].pos });
  });
  return out;
}

function roadLinks(d: MapDraft, towns: OldSettlement[], rules: OldRoadRules): Link[] {
  return towns
    .map((t) => ({ from: t.pos, to: nearestRoadPoint(t.pos) }))
    .filter((l) => dist(l.from, l.to) <= rules.maxLink && Math.min(l.to.x, l.to.y, d.size - l.to.x, d.size - l.to.y) >= 0);
}

function nearestRoadPoint(p: Vec): Vec {
  let best = p;
  let bestDist = Infinity;
  for (const road of REGION.roads) {
    for (let k = 0; k + 1 < road.length; k++) {
      const q = closestOnSegment(p, road[k], road[k + 1]);
      if (dist(p, q) < bestDist) [best, bestDist] = [q, dist(p, q)];
    }
  }
  return best;
}

function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

const STEPS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

type RoutePath = { points: Vec[]; bridges: [Vec, Vec][] };

type SearchState = { cost: Float64Array; parent: Int32Array; bridged: Uint8Array; open: NodeHeap };

class RouteGrid {
  private readonly n: number;
  private readonly heights: Float32Array;
  private readonly cut: Uint8Array;
  private readonly closed: Uint8Array;

  constructor(d: MapDraft, private readonly rules: OldRoadRules) {
    this.n = Math.floor(d.size / rules.cell) + 1;
    const count = this.n * this.n;
    this.heights = new Float32Array(count);
    this.cut = new Uint8Array(count);
    this.closed = new Uint8Array(count);
    for (let node = 0; node < count; node++) {
      const p = this.posOf(node);
      this.heights[node] = d.heights[p.y * (d.size + 1) + p.x];
      this.cut[node] = isCutTile(d, tileOf(d.size, p)) ? 1 : 0;
      this.closed[node] = SITES.some((s) => siteGap(s, p) < 0) ? 1 : 0;
    }
  }

  route(from: Vec, to: Vec): RoutePath | null {
    const goal = this.nodeNear(to);
    const found = this.search(this.nodeNear(from), goal);
    if (!found) return null;
    const { parent, bridged } = found;
    const nodes: number[] = [goal];
    while (parent[nodes[nodes.length - 1]] >= 0) nodes.push(parent[nodes[nodes.length - 1]]);
    nodes.reverse();
    const bridgeEnd = (k: number) => bridged[nodes[k]] === 1 || (k + 1 < nodes.length && bridged[nodes[k + 1]] === 1);
    const inner = nodes.slice(1, -1).filter((_, k) => (k + 1) % this.rules.smoothEvery === 0 || bridgeEnd(k + 1));
    const bridges = nodes.slice(1).flatMap((node, k): [Vec, Vec][] => (bridged[node] ? [[this.posOf(nodes[k]), this.posOf(node)]] : []));
    return { points: [from, ...inner.map((node) => this.posOf(node)), to], bridges };
  }

  private search(start: number, goal: number): { parent: Int32Array; bridged: Uint8Array } | null {
    const cost = new Float64Array(this.n * this.n).fill(Infinity);
    const parent = new Int32Array(this.n * this.n).fill(-1);
    const bridged = new Uint8Array(this.n * this.n);
    const done = new Uint8Array(this.n * this.n);
    const open = new NodeHeap();
    cost[start] = 0;
    open.push(start, 0);
    while (open.size > 0) {
      const a = open.pop();
      if (a === goal) return { parent, bridged };
      if (done[a]) continue;
      done[a] = 1;
      this.relax(a, goal, { cost, parent, bridged, open });
      this.relaxBridges(a, goal, { cost, parent, bridged, open });
    }
    return null;
  }

  private relaxBridges(a: number, goal: number, s: SearchState): void {
    for (const [di, dj, len] of STEPS) {
      const b = this.bridgeEnd(a, di, dj);
      if (b < 0) continue;
      const steps = Math.max(Math.abs((b % this.n) - (a % this.n)), Math.abs(Math.floor(b / this.n) - Math.floor(a / this.n)));
      const through = s.cost[a] + steps * len * this.rules.cell * this.rules.bridgeCost;
      if (through >= s.cost[b]) continue;
      s.cost[b] = through;
      s.parent[b] = a;
      s.bridged[b] = 1;
      s.open.push(b, through + this.guess(b, goal));
    }
  }

  private bridgeEnd(a: number, di: number, dj: number): number {
    let low = Infinity;
    for (let k = 1; k * this.rules.cell <= this.rules.maxBridge; k++) {
      const b = this.openNode((a % this.n) + di * k, Math.floor(a / this.n) + dj * k);
      if (b < 0) return -1;
      if (this.spansGap(a, b, low, k * Math.hypot(di, dj))) return b;
      low = Math.min(low, this.heights[b]);
    }
    return -1;
  }

  private spansGap(a: number, b: number, low: number, cells: number): boolean {
    const drop = this.rules.minDrop;
    return low <= this.heights[a] - drop && this.heights[b] >= this.heights[a] - drop && this.reachable(a, b, cells);
  }

  private openNode(i: number, j: number): number {
    const node = this.nodeAt(i, j);
    return node >= 0 && !this.closed[node] ? node : -1;
  }

  private reachable(a: number, b: number, cells: number): boolean {
    return this.stepCost(a, b, cells * this.rules.cell) < Infinity;
  }

  private relax(a: number, goal: number, s: SearchState): void {
    const ai = a % this.n;
    const aj = Math.floor(a / this.n);
    for (const [di, dj, len] of STEPS) {
      const b = this.nodeAt(ai + di, aj + dj);
      if (b < 0) continue;
      const through = s.cost[a] + this.stepCost(a, b, len * this.rules.cell);
      if (through >= s.cost[b]) continue;
      s.cost[b] = through;
      s.parent[b] = a;
      s.bridged[b] = 0;
      s.open.push(b, through + this.guess(b, goal));
    }
  }

  private stepCost(a: number, b: number, len: number): number {
    if (this.closed[b]) return Infinity;
    const slope = Math.abs(this.heights[b] - this.heights[a]) / len;
    if (slope > this.rules.maxSlope) return Infinity;
    const wash = this.cut[b] ? this.rules.washCost * len : 0;
    return len * (1 + this.rules.slopeCost * (slope / this.rules.maxSlope) ** 2) + wash;
  }

  private guess(a: number, b: number): number {
    return dist(this.posOf(a), this.posOf(b));
  }

  private nodeAt(i: number, j: number): number {
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }

  private nodeNear(p: Vec): number {
    const i = clamp(Math.round(p.x / this.rules.cell), 0, this.n - 1);
    return clamp(Math.round(p.y / this.rules.cell), 0, this.n - 1) * this.n + i;
  }

  private posOf(node: number): Vec {
    return { x: (node % this.n) * this.rules.cell, y: Math.floor(node / this.n) * this.rules.cell };
  }
}

class NodeHeap {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let k = this.nodes.length - 1;
    while (k > 0 && this.keys[(k - 1) >> 1] > this.keys[k]) {
      this.swap(k, (k - 1) >> 1);
      k = (k - 1) >> 1;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop();
    const lastKey = this.keys.pop();
    if (lastNode === undefined || lastKey === undefined) throw new Error('Pop from an empty node heap');
    if (this.nodes.length === 0) return top;
    this.nodes[0] = lastNode;
    this.keys[0] = lastKey;
    this.sink(0);
    return top;
  }

  private sink(from: number): void {
    let k = from;
    for (;;) {
      const l = 2 * k + 1;
      const least = [l, l + 1].filter((c) => c < this.keys.length).reduce((a, c) => (this.keys[c] < this.keys[a] ? c : a), k);
      if (least === k) return;
      this.swap(k, least);
      k = least;
    }
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

function layOldRoad(d: MapDraft, route: OldRoad, rules: OldRoadRules): OldRoad {
  const road = { ...route, bridges: realBridges(d, route.bridges, rules) };
  const along = stations(road.line.length, rules.sample);
  for (const p of along.map((s) => road.line.pointAt(s))) {
    if (isCutTile(d, tileOf(d.size, p)) || road.bridges.some(([x, y]) => segmentDist(p, x, y) < road.width / 2)) continue;
    markTiles(d, tilesWithin(d.size, p, road.width / 2), BUILT_OLD_ROAD);
  }
  for (const [x, y] of road.bridges.filter((br) => gapDepth(d, br) >= rules.spanGap)) {
    placeSpan(d, x, y, rules);
    placeSpan(d, y, x, rules);
  }
  return road;
}

function placeSpan(d: MapDraft, bank: Vec, far: Vec, rules: OldRoadRules): void {
  const yaw = bearing(bank, far);
  for (let back = 0; back <= rules.spanBack; back++) {
    const at = { x: bank.x - Math.cos(yaw) * back, y: bank.y - Math.sin(yaw) * back };
    if (place(d, prop('bridgeSpan', at, rules.spanRadius, yaw), rules.spanRoadGap)) return;
  }
}

function markTiles(d: MapDraft, tiles: number[], code: number): void {
  for (const tile of tiles) if (markable(d, tile)) d.built[tile] = code;
}

export function markable(d: MapDraft, tile: number): boolean {
  return d.built[tile] === BUILT_NONE && !isCutTile(d, tile) && !builtGround(tileCenter(d.size, tile));
}




export function powerLines(seed: number, d: MapDraft, rules: PowerLineRules): void {
  REGION.roads.forEach((road, r) => {
    const line = new RoadLine(road);
    if (line.length < rules.minLength || hashRandom(seed, rules.seedOffset, r) >= rules.roadShare) return;
    const side = hashRandom(seed, rules.seedOffset, r, 1) < 0.5 ? 1 : -1;
    for (let step = 0; rules.spacing / 2 + step * rules.spacing <= line.length; step++) {
      if (hashRandom(seed, rules.seedOffset, r, step, 2) < rules.missingShare) continue;
      const s = rules.spacing / 2 + step * rules.spacing;
      const dir = line.dirAt(s);
      const pos = offset(line.pointAt(s), sideOf(dir, side), HALF + rules.gap + rules.radius);
      place(d, prop('pole', pos, rules.radius, facing(dir), r + 1, step), 0);
    }
  });
}

type RoadSpot = Scored & { dir: Vec };

export function billboards(seed: number, d: MapDraft, rules: BillboardRules): void {
  const spots = spaced([...approachSpots(rules), ...straightSpots(seed, rules)], rules.spacing, Infinity);
  spots.forEach((spot, k) => {
    const out = sideOf(spot.dir, hashRandom(seed, rules.seedOffset, k) < 0.5 ? 1 : -1);
    const pos = offset(spot.pos, out, HALF + rules.gap + rules.radius);
    place(d, prop('billboard', pos, rules.radius, facing({ x: -out.x, y: -out.y })), 0);
  });
}

function approachSpots(rules: BillboardRules): RoadSpot[] {
  const out: RoadSpot[] = [];
  for (const town of REGION.towns) {
    for (const road of REGION.roads) {
      const line = new RoadLine(dist(road[0], town.pos) < 0.01 ? road : [...road].reverse());
      if (dist(line.points[0], town.pos) >= 0.01) continue;
      for (const a of rules.approach) out.push({ pos: line.pointAt(town.radius + a), dir: line.dirAt(town.radius + a), score: 2 });
    }
  }
  return out;
}

function straightSpots(seed: number, rules: BillboardRules): RoadSpot[] {
  const out: RoadSpot[] = [];
  REGION.roads.forEach((road, r) => {
    const line = new RoadLine(road);
    for (let s = rules.straightReach, k = 0; s <= line.length - rules.straightReach; s += rules.straightStep, k++) {
      const chord = dist(line.pointAt(s - rules.straightReach), line.pointAt(s + rules.straightReach)) / (2 * rules.straightReach);
      if (chord >= rules.straightness && hashRandom(seed, rules.seedOffset, r, k, 1) < rules.straightChance) out.push({ pos: line.pointAt(s), dir: line.dirAt(s), score: chord });
    }
  });
  return out;
}

export function tankHulks(seed: number, d: MapDraft, roads: OldRoad[], rules: TankRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  for (const road of roads) {
    if (!chance(rng, rules.chance)) continue;
    const s = Math.min(road.line.length, range(rng, rules.along));
    const count = randInt(rng, rules.group[0], rules.group[1]);
    for (let k = 0; k < count; k++) placeHulk(d, rng, rules, road, s);
  }
}

function placeHulk(d: MapDraft, rng: Rng, rules: TankRules, road: OldRoad, s: number): void {
  for (let t = 0; t < rules.placeTries; t++) {
    const at = s + randRange(rng, -rules.spread, rules.spread);
    const out = sideOf(road.line.dirAt(at), chance(rng, 0.5) ? 1 : -1);
    const pos = offset(road.line.pointAt(at), out, road.width / 2 + rules.gap + rules.radius + randRange(rng, 0, rules.spread));
    if (place(d, prop('tank', pos, rules.radius, randRange(rng, 0, TURN)), rules.gap)) return;
  }
}

type Rect = { center: Vec; angle: number; w: number; h: number };

export function fields(seed: number, d: MapDraft, towns: OldSettlement[], rules: FieldRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  for (const town of towns.filter((t) => t.farm)) {
    const angle = randRange(rng, 0, Math.PI / 2);
    const count = randInt(rng, rules.perFarm[0], rules.perFarm[1]);
    for (let f = 0; f < count; f++) layField(d, rng, rules, town, angle);
  }
}

function layField(d: MapDraft, rng: Rng, rules: FieldRules, town: OldSettlement, angle: number): void {
  for (let t = 0; t < rules.tries; t++) {
    const all = rectTiles(d.size, fieldRect(rng, rules, town, angle));
    const good = all.filter((tile) => fieldTile(d, rules, town, tile));
    if (all.length === 0 || good.length < rules.minShare * all.length) continue;
    markTiles(d, good, BUILT_FIELD);
    return;
  }
}

function fieldRect(rng: Rng, rules: FieldRules, town: OldSettlement, angle: number): Rect {
  const w = range(rng, rules.side);
  const h = range(rng, rules.side);
  const a = randRange(rng, 0, TURN);
  const out = town.radius + rules.gap + Math.hypot(w, h) / 2 + randRange(rng, 0, rules.reach);
  return { center: { x: town.pos.x + Math.cos(a) * out, y: town.pos.y + Math.sin(a) * out }, angle, w, h };
}

function rectTiles(size: number, rect: Rect): number[] {
  const cos = Math.cos(rect.angle);
  const sin = Math.sin(rect.angle);
  return tilesWithin(size, rect.center, Math.hypot(rect.w, rect.h) / 2).filter((tile) => {
    const c = tileCenter(size, tile);
    const dx = c.x - rect.center.x;
    const dy = c.y - rect.center.y;
    return Math.abs(dx * cos + dy * sin) <= rect.w / 2 && Math.abs(dy * cos - dx * sin) <= rect.h / 2;
  });
}

function fieldTile(d: MapDraft, rules: FieldRules, town: OldSettlement, tile: number): boolean {
  if (!markable(d, tile) || tileSteepness(d.heights, d.size, tile) > rules.flatSlope) return false;
  const c = tileCenter(d.size, tile);
  if (Math.min(c.x, c.y, d.size - c.x, d.size - c.y) < O.edgeMargin) return false;
  return tileHeight(d, tile) <= town.ground + rules.lowRise;
}
