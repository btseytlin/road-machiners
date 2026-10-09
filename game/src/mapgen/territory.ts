// Territory layer: a wreck's hull pieces, caches, buildings, rim rocks, field spots and debris, the reactor, a farm's
// layout (./farm) and debris, and fused glass (./glass) inside each territory, placed by the rules in TERRITORIES. It
// runs after the new-world layer, so ground rules read these props, the seated heights and the marks. Pieces, the

import { PHYSICS } from '../data/physics';
import { REGION, type TerritoryDef } from '../data/region';
import { TERRITORIES, type FarmRules, type Patch, type RimRocks, type TerritoryRules, type WreckRules } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { boxDistance, onDeck, propBoxes, type PosedBox } from '../sim/mapgen';
import { ROAD_INDEX } from '../sim/road-index';
import { randRange, type Rng } from '../sim/rng';
import { siteGap } from '../sim/sites';
import { basinUnder, isTerritory, landingStrips, reactorPos, territoryCaches, territoryPieces, territoryRoads, type BakedPiece, type LandingStrip } from '../sim/territory';
import { groundAt, type BakedProp } from '../sim/terrain';
import { dist, segmentDist, type Vec } from '../sim/vec';
import { footprintRelief, tileSteepness, type MapDraft } from './bake';
import { fillFarm, placeBuildingGroups, touchesMarks } from './farm';
import { fillGlass } from './glass';
import { at, markRoads, type Touch } from './marks';
import { prop, ruleRng, tileOf } from './oldworld';

export const TERRITORY_SEED_OFFSET = 9100;
const TRIES = 5000;
const REACTOR_MARGIN = 2;
const DEBRIS_BAND: [number, number] = [0, 1.5];

export function territoryLayer(seed: number, d: MapDraft): MapDraft {
  for (const t of REGION.locations.filter(isTerritory)) {
    const rules = TERRITORIES[t.id];
    fill(d, t, rules, ruleRng(seed, TERRITORY_SEED_OFFSET + rules.seed));
  }
  return d;
}

type Draws = { d: MapDraft; t: TerritoryDef; rules: TerritoryRules; rng: Rng };
type Ground = Draws & {
  wreck: WreckRules;
  pieces: ReadonlySet<BakedProp>;
  pieceBoxes: readonly PosedBox[];
  onRoad: Touch;
  strips: readonly LandingStrip[];
};

function fill(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, rng: Rng): void {
  const pieces = rules.wreck ? placePieces(d, t, rules.wreck) : [];
  if (rules.reactor) d.props.push(prop(rules.reactor.look, reactorPos(t), rules.reactor.radius, 0));
  if (rules.wreck) fillWreck({ d, t, rules, rng }, rules, rules.wreck, pieces);
  if (rules.farm) fillFarmBand({ d, t, rules, rng }, rules, rules.farm);
  if (rules.glass) fillGlass(d, t, rules, rules.glass, rng);
}

function placePieces(d: MapDraft, t: TerritoryDef, wreck: WreckRules): BakedProp[] {
  const pieces = territoryPieces(t);
  seatPieces(d, pieces, wreck.seatEase);
  const props = pieces.map((p) => prop(p.look, p.pos, p.r, p.yaw));
  d.props.push(...props);
  return props;
}

function fillWreck(draws: Draws, rules: TerritoryRules, wreck: WreckRules, pieceProps: readonly BakedProp[]): void {
  const { d, t, rng } = draws;
  const { roads, spurs } = territoryRoads(t);
  const [onWeb, onSpur] = [markRoads(d, t, roads, 'inside'), markRoads(d, t, spurs, 'spur')];
  const onRoad: Touch = (pos, r) => onWeb(pos, r) || onSpur(pos, r);
  const pieceBoxes = territoryPieces(t).flatMap((p) => propBoxes(pieceObstacle(p, 'piece')));
  const caches = territoryCaches(t).map((pos) => prop(wreck.cacheLook, pos, wreck.cacheRadius, 0));
  for (const c of caches) if (onRoad(c.pos, c.r) || touchesMarks(d, c.pos, c.r)) throw new Error(`${t.id} cache at ${at(c.pos)} stands on a dirt road`);
  d.props.push(...caches);
  const buildings = placeBuildingGroups(d, t, 0, wreck.buildings, onRoad, pieceBoxes, rng);
  d.props.push(...buildings);
  const g: Ground = { ...draws, rules, wreck, pieces: new Set(pieceProps), pieceBoxes, onRoad, strips: landingStrips(t) };
  if (wreck.rimRocks) placeRimRocks(g, wreck.rimRocks);
  let spots: BakedProp[] = [...caches, ...buildings];
  for (const patch of wreck.patches) spots = placePatch(g, patch, spots);
}

function fillFarmBand(draws: Draws, rules: TerritoryRules, farm: FarmRules): void {
  const { d, t, rng } = draws;
  const buildings = fillFarm(d, t, rules, farm, rng);
  const hazard = rules.reactor?.hazard ? { pos: reactorPos(t), reach: rules.reactor.hazard.radius + REACTOR_MARGIN } : null;
  const open = (pos: Vec, r: number): boolean =>
    siteGap(t, pos) < -r && (!hazard || dist(pos, hazard.pos) > hazard.reach + r) && clearOf(d.props, pos, r, 0) && clearOf(buildings, pos, r, rules.debrisGap);
  for (const rule of farm.debris) {
    for (let i = 0; i < rule.count; i++) d.props.push(draw(draws, rule.look, 'in the spine band', () => bandPoint(draws, farm, DEBRIS_BAND), rule.radius, open));
  }
}

function bandPoint({ t, rng }: Draws, farm: FarmRules, band: [number, number]): Vec {
  const { from, to } = farm.spine;
  const share = randRange(rng, 0, 1);
  const off = farm.spine.band * randRange(rng, band[0], band[1]) * (randRange(rng, 0, 1) < 0.5 ? -1 : 1);
  const length = dist(from, to);
  return {
    x: t.pos.x + from.x + (to.x - from.x) * share - ((to.y - from.y) / length) * off,
    y: t.pos.y + from.y + (to.y - from.y) * share + ((to.x - from.x) / length) * off,
  };
}

function pieceObstacle(p: BakedPiece, id: string) {
  return { id, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw } as const;
}

function seatPieces(d: MapDraft, pieces: readonly BakedPiece[], ease: number): void {
  const before = { size: d.size, heights: Array.from(d.heights), types: [] };
  const level: { k: number; h: number }[] = [];
  pieces.forEach((p, n) => {
    const low = propBoxes(pieceObstacle(p, `seat-${n}`)).filter((b) => b.z0 < PHYSICS.truckClearance);
    const centre = groundAt(before, p.pos.x, p.pos.y) - p.sink;
    for (const c of seatCorners(d.size, p, low, ease)) {
      const k = c.j * (d.size + 1) + c.i;
      if (c.gap === 0) level.push({ k, h: centre });
      else d.heights[k] = centre + (before.heights[k] - centre) * smooth(c.gap / ease);
    }
  });
  for (const { k, h } of level) d.heights[k] = h;
}

function seatCorners(size: number, p: BakedPiece, low: readonly PosedBox[], ease: number): { i: number; j: number; gap: number }[] {
  if (low.length === 0) return [];
  const reach = Math.max(...low.map((b) => dist(b.center, p.pos) + Math.hypot(b.half.x, b.half.y))) + ease;
  const [cx, cy] = [Math.floor(p.pos.x), Math.floor(p.pos.y)];
  const gapAt = (i: number, j: number): number => (i - cx >= 0 && i - cx <= 1 && j - cy >= 0 && j - cy <= 1 ? 0 : Math.min(...low.map((b) => boxDistance(b, { x: i, y: j }))));
  const out: { i: number; j: number; gap: number }[] = [];
  for (const j of cornerSpan(size, p.pos.y, reach)) {
    for (const i of cornerSpan(size, p.pos.x, reach)) {
      const gap = gapAt(i, j);
      if (gap < ease) out.push({ i, j, gap });
    }
  }
  return out;
}

function cornerSpan(size: number, v: number, reach: number): number[] {
  const [lo, hi] = [Math.max(0, Math.floor(v - reach)), Math.min(size, Math.ceil(v + reach))];
  return Array.from({ length: hi - lo + 1 }, (_, n) => lo + n);
}

function smooth(s: number): number {
  return s * s * (3 - 2 * s);
}

function placeRimRocks(g: Ground, rim: RimRocks): void {
  const { from, to, out, count, size } = rim;
  const b = basinUnder(g.t);
  const n = b.floor.length;
  if (![from, to].every((k) => Number.isInteger(k) && k >= 0 && k < n)) throw new Error(`${g.t.id} rim rock arc ${from}..${to} is not on a basin of ${n} floor points`);
  const foot = Array.from({ length: ((to - from + n) % n) + 1 }, (_, i) => b.floor[(from + i) % n]).map((p) => ({ x: b.center.x + p.x, y: b.center.y + p.y }));
  const lengths = foot.slice(1).map((q, k) => dist(foot[k], q));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const pick = (): Vec => {
    let left = randRange(g.rng, 0, total);
    let k = 0;
    while (k < lengths.length - 1 && left > lengths[k]) left -= lengths[k++];
    const [a, c] = [foot[k], foot[k + 1]];
    const share = Math.min(left / lengths[k], 1);
    const edge = { x: a.x + (c.x - a.x) * share, y: a.y + (c.y - a.y) * share };
    const normal = { x: (c.y - a.y) / lengths[k], y: -(c.x - a.x) / lengths[k] };
    const side = (edge.x - b.center.x) * normal.x + (edge.y - b.center.y) * normal.y >= 0 ? 1 : -1;
    const reach = randRange(g.rng, out[0], out[1]) * side;
    return { x: edge.x + normal.x * reach, y: edge.y + normal.y * reach };
  };
  const others = drawn(g);
  const rocks: BakedProp[] = [];
  const ok = (pos: Vec, r: number): boolean => clearOfPieces(g, pos, r) && clearOf(others, pos, r, 0) && rocks.every((o) => dist(o.pos, pos) >= (o.r + r) / 3);
  for (let i = 0; i < count; i++) {
    const rock = draw(g, 'rimRock', 'on the rim', pick, size, ok);
    rocks.push({ ...rock, yaw: Math.atan2(rock.pos.y - g.t.pos.y, rock.pos.x - g.t.pos.x) + Math.PI / 2 });
  }
  g.d.props.push(...rocks);
}

function placePatch(g: Ground, patch: Patch, before: BakedProp[]): BakedProp[] {
  const spots = [...before];
  const centre = { x: g.t.pos.x + patch.at.x, y: g.t.pos.y + patch.at.y };
  const where = `in the patch at ${patch.at.x},${patch.at.y}`;
  const pick = (): Vec => {
    const a = randRange(g.rng, 0, Math.PI * 2);
    const r = patch.radius * Math.sqrt(randRange(g.rng, 0, 1));
    return { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
  };
  const apart = (pos: Vec, r: number): boolean => open(g, pos, r) && spots.every((o) => dist(o.pos, pos) >= g.rules.spotGap) && clearOf(drawn(g), pos, r, 0);
  for (let i = 0; i < patch.spots; i++) {
    const p = draw(g, g.wreck.spotLook, where, pick, g.wreck.spotRadius, apart);
    spots.push(p);
    g.d.props.push(p);
  }
  const clear = (pos: Vec, r: number): boolean => open(g, pos, r) && clearOf(drawn(g), pos, r, 0) && clearOf(spots, pos, r, g.rules.debrisGap);
  for (const rule of patch.debris) for (let i = 0; i < rule.count; i++) g.d.props.push(draw(g, rule.look, where, pick, rule.radius, clear));
  return spots;
}

function drawn(g: Ground): BakedProp[] {
  return g.d.props.filter((p) => !g.pieces.has(p));
}

function open(g: Ground, pos: Vec, r: number): boolean {
  if (siteGap(g.t, pos) >= -r || inHazard(g, pos, r) || !clearOfPieces(g, pos, r)) return false;
  return !onWay(g, pos, r);
}

function inHazard(g: Ground, pos: Vec, r: number): boolean {
  const reactor = g.rules.reactor;
  return !!reactor?.hazard && dist(pos, reactorPos(g.t)) <= reactor.hazard.radius + REACTOR_MARGIN + r;
}

function onWay(g: Ground, pos: Vec, r: number): boolean {
  return g.onRoad(pos, r) || onDeck(pos, r) || g.strips.some((s) => onStrip(s, pos, r));
}

function onStrip(s: LandingStrip, pos: Vec, r: number): boolean {
  const length = dist(s.a, s.b);
  const along = ((pos.x - s.a.x) * (s.b.x - s.a.x) + (pos.y - s.a.y) * (s.b.y - s.a.y)) / length;
  return along > -r && along < length + r && segmentDist(pos, s.a, s.b) < s.width / 2 + r;
}

export function draw(g: Draws, look: BakedProp['kind'], where: string, pick: () => Vec, radius: [number, number], ok: (pos: Vec, r: number) => boolean): BakedProp {
  for (let k = 0; k < TRIES; k++) {
    const pos = pick();
    const r = randRange(g.rng, radius[0], radius[1]);
    const yaw = randRange(g.rng, 0, Math.PI * 2);
    const p = prop(look, pos, r, yaw);
    if (!standable(g.d, p, g.rules.relief) || !ok(pos, r)) continue;
    return p;
  }
  throw new Error(`Territory ${g.t.id} has no room for a ${look} ${where}`);
}

function clearOfPieces(g: Ground, pos: Vec, r: number): boolean {
  return g.pieceBoxes.every((b) => boxDistance(b, pos) >= r + REGION.obstacles.gap);
}

function standable(d: MapDraft, p: BakedProp, relief: number | null): boolean {
  const { pos, r } = p;
  if (Math.min(pos.x, pos.y, d.size - pos.x, d.size - pos.y) < REGION.obstacles.edgeMargin + r) return false;
  const reach = REGION.roadWidth / 2 + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach) return false;
  if (touchesMarks(d, pos, r)) return false;
  if (tileSteepness(d.heights, d.size, tileOf(d.size, pos)) > TERRAIN.drive.maxSlope) return false;
  return relief === null || footprintRelief(d.heights, d.size, p, false) <= relief;
}

export function clearOf(props: readonly BakedProp[], pos: Vec, r: number, gap: number): boolean {
  return props.every((o) => dist(o.pos, pos) >= o.r + r + REGION.obstacles.gap + gap);
}
