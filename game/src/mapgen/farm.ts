// Farm layout of a territory, from its FarmRules in TERRITORIES: an old asphalt road, dirt roads and tracks, concrete
// pads, irrigation canals, buildings that are loot spots, runs of segment props, sandbag emplacements with tank traps
// ahead of them, clutter round the buildings, and blocks of dead trees in rows with strays between them. The skeleton
// is authored in the road's frame: roads, pads, canals, building poses, run lines, emplacements and blocks. Everything
// on it is jittered, broken or scattered from the territory's seed, so no detail stands in a ruled line. The roads are
// graded into the ground together with a levelled pad under each building. Authored buildings, pads, road and canal
// points, run points and block corners fail loudly off the outline or on bad ground, and so do emplacement points.
// Trees, strays, run segments, sandbag arcs, tank traps and clutter that land on bad ground are dropped, all but trees
// also on ground that lies off their seat past the territory's relief, but a block that keeps too few of its trees
// fails loudly too.

import { PHYSICS } from '../data/physics';
import { REGION, type TerritoryDef } from '../data/region';
import { EMPLACEMENT, type BuildingGroup, type ClutterRule, type Emplacement, type FarmRoad, type FarmRules, type GroveBlock, type GroveRule, type Pad, type Run, type TerritoryRules } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { flattenFalloff } from '../sim/elevation';
import { propBoxes } from '../sim/mapgen';
import { gradePaths, type GradedPad } from '../sim/road-grade';
import { ROAD_INDEX } from '../sim/road-index';
import { chance, randInt, randRange, type Rng } from '../sim/rng';
import { siteGap } from '../sim/sites';
import { groundAt, type BakedProp } from '../sim/terrain';
import { angleDiff, bearing, dist, segmentDist, type Vec } from '../sim/vec';
import { footprintRelief, tileSteepness, type MapDraft } from './bake';
import { at, mark, markLine, markRoads, onNewRoad, steep, type Touch } from './marks';
import { BUILT_CANAL, BUILT_PAD, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, facing, prop, RoadLine, tileCenter, tileOf, tilesWithin } from './oldworld';

const LENGTH_SLACK = 1e-6; // share of a segment a run's length may miss by rounding and still count it whole
const LINE_SAMPLE = 0.25; // tiles between the points of a run segment tested against roads and marks
const NEW_ROAD_SURFACE = REGION.roadWidth / 2 + 1; // tiles from a road of today's world that gradeRoads() grades as its surface
const ROAD_END_SLACK = 1; // tiles a road's outer end may lie past the outline, so the road meets the edge
const TRIES = 40; // draws for one clutter piece or stray tree before it is dropped
const STRAY_FRAY = 4; // tiles past a block's edge where its stray trees stand
// Three props of one look whose centres lie within ROW_LINE tiles of one line and whose turns lie within ROW_TURN
// radians read as a ruled row. A run segment that would make one turns ROW_NUDGE more, or is dropped.
const ROW_LINE = 0.1;
const ROW_TURN = 0.02;
const ROW_NUDGE = 0.06;
const SEGMENT_CLEAR = 0.05; // tiles two segment props must keep apart unless their ends meet

// The road's frame: its heading, and the unit vectors along it and across it toward the map's west.
type Frame = { yaw: number; along: Vec; across: Vec };

// Lays out the farm and returns its buildings, the loot spots. Roads, pads and canals go down first, so nothing drawn
// stands on them and blocks mark field only on bare ground. Once the buildings stand, the roads are graded with the
// buildings' levelled pads, so everything drawn after is checked on the ground it stands on. Buildings come before the
// runs, emplacements, clutter and trees, which keep a parking gap round them.
export function fillFarm(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, farm: FarmRules, rng: Rng): BakedProp[] {
  const frame = frameOf(farm.spine);
  const onRoad = markRoads(d, t, farm.roads.map((road) => ({ ...road, points: road.points.map((p) => shift(t, p)) })), 'inside');
  markPads(d, t, frame, farm.pads);
  const canals = farm.canals.map((c) => ({ points: c.points.map((p) => inside(t, shift(t, p), 0, 'canal point')), width: c.width }));
  for (const canal of canals) markLine(d, t, canal, BUILT_CANAL, 'inside');
  const spots = placeBuildings(d, t, frame, farm, onRoad, rng);
  d.props.push(...spots);
  gradeFarmRoads(d, t, farm.roads, spots);
  const marked: Touch = (pos, r) => onRoad(pos, r) || touchesMarks(d, pos, r);
  const runs = placeRuns(d, t, farm.runs, spots, marked, rules.relief, rules.debrisGap, rng);
  d.props.push(...runs);
  const works = placeEmplacements(d, t, frame, farm, spots, marked, rules.relief, rules.debrisGap, rng);
  d.props.push(...works);
  // Blocks mark their field first, so clutter keeps out of the groves.
  const blocks = farm.blocks.map((block) => fieldOf(d, t, frame, block));
  // Clutter keeps a tree's room off the field, so the trees at a block's edge still stand.
  const fieldClear = farm.groves.radius + REGION.obstacles.gap;
  const offField: Touch = (pos, r) => !marked(pos, r) && !touchedTiles(d.size, pos, r + fieldClear).some((tile) => d.built[tile] === BUILT_FIELD);
  const clutter = placeClutter(d, t, spots, rules.debrisGap, farm.clutter, offField, rules.relief, rng);
  d.props.push(...clutter);
  // Trees keep a parking gap round every building, clear of the clutter, sandbag arcs and tank traps, and clear of the
  // run segments as the lines they are.
  const keep = (pos: Vec, r: number): boolean =>
    standsOnFarm(d, t, prop(farm.groves.look, pos, r, 0), false, null) &&
    !marked(pos, r) &&
    clearOf(spots, pos, r, rules.debrisGap) &&
    clearOf(clutter, pos, r, 0) &&
    clearOf(works, pos, r, 0) &&
    runs.every((seg) => clearOfSegment(seg, pos, r));
  const trees = plantBlocks(t, farm.groves, blocks, rng, keep);
  trees.push(...plantStrays(t, frame, farm.groves, farm.blocks, trees, rng, keep));
  d.props.push(...trees);
  return spots;
}

// Tiles whose square a circle at pos with radius r overlaps, and the tile under pos.
function touchedTiles(size: number, pos: Vec, r: number): number[] {
  const out: number[] = [tileOf(size, pos)];
  for (let y = Math.max(0, Math.floor(pos.y - r)); y <= Math.min(size - 1, Math.floor(pos.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(pos.x - r)); x <= Math.min(size - 1, Math.floor(pos.x + r)); x++) {
      const near = { x: Math.min(Math.max(pos.x, x), x + 1), y: Math.min(Math.max(pos.y, y), y + 1) };
      if (dist(near, pos) < r && y * size + x !== out[0]) out.push(y * size + x);
    }
  }
  return out;
}

// Whether a circle overlaps a tile of old road, a pad, a dirt road or track, or a canal, where no prop may stand.
export function touchesMarks(d: MapDraft, pos: Vec, r: number): boolean {
  return touchedTiles(d.size, pos, r).some((tile) => d.built[tile] === BUILT_OLD_ROAD || d.built[tile] === BUILT_TRACK || d.built[tile] === BUILT_CANAL || d.built[tile] === BUILT_PAD);
}

function frameOf(spine: FarmRules['spine']): Frame {
  const yaw = bearing(spine.from, spine.to);
  return { yaw, along: { x: Math.cos(yaw), y: Math.sin(yaw) }, across: { x: Math.sin(yaw), y: -Math.cos(yaw) } };
}

// Concrete on every tile of each pad. A pad lies wholly inside the territory on drivable ground off the roads.
function markPads(d: MapDraft, t: TerritoryDef, frame: Frame, pads: readonly Pad[]): void {
  for (const pad of pads) {
    const centre = shift(t, pad.at);
    const yaw = frame.yaw + pad.turn;
    for (const corner of corners(centre, yaw, pad.size)) inside(t, corner, 0, `pad at ${at(centre)}`);
    for (const tile of rectTiles(d, centre, yaw, pad.size)) markPadTile(d, t, tile, centre);
  }
}

function markPadTile(d: MapDraft, t: TerritoryDef, tile: number, centre: Vec): void {
  const c = tileCenter(d.size, tile);
  if (steep(d, tile)) throw new Error(`${t.id} pad at ${at(centre)} lies on a cliff at ${at(c)}`);
  if (onNewRoad(c, 0)) throw new Error(`${t.id} pad at ${at(centre)} lies on a road at ${at(c)}`);
  mark(d, tile, BUILT_PAD);
}

// One loot spot at each pose, turned from the road's heading and jittered by its group. A pose that falls outside
// the territory, on a cliff, on a road, or on a farm road without leave to stand on its shoulder is a data error.
function placeBuildings(d: MapDraft, t: TerritoryDef, frame: Frame, farm: FarmRules, onRoad: Touch, rng: Rng): BakedProp[] {
  return farm.buildings.flatMap((group) => group.poses.map((pose) => building(d, t, frame, group, pose, onRoad, rng)));
}

function building(d: MapDraft, t: TerritoryDef, frame: Frame, group: BuildingGroup, pose: BuildingGroup['poses'][number], onRoad: Touch, rng: Rng): BakedProp {
  const turn = pose.turn + randRange(rng, -group.turnJitter, group.turnJitter);
  const at0 = shift(t, pose.at);
  const pos = { x: at0.x + randRange(rng, -group.shift, group.shift), y: at0.y + randRange(rng, -group.shift, group.shift) };
  const where = `${t.id} ${group.look} at ${at(pos)}`;
  inside(t, pos, pose.r, group.look);
  if (touchedTiles(d.size, pos, pose.r).some((tile) => steep(d, tile))) throw new Error(`${where} stands on a cliff`);
  if (onNewRoad(pos, pose.r)) throw new Error(`${where} stands on a road`);
  if (!pose.shoulder && onRoad(pos, pose.r)) throw new Error(`${where} stands on a farm road`);
  if (touchedTiles(d.size, pos, pose.r).some((tile) => d.built[tile] === BUILT_CANAL)) throw new Error(`${where} stands on a canal`);
  return prop(group.look, pos, pose.r, frame.yaw + turn);
}

// Each building stands upright at the ground under its centre, so the ground under it is levelled. Every corner a point
// of its footprint reads its ground from, within r + a tile's diagonal, is its pad, aiming at the mean of the ungraded
// ground under it. Each pad levels as one rigid piece. Where rings overlap, the grading meets both pads within the bank
// grade in one pass, so a later pad never tilts an earlier one. Returns the pads, which the road grading holds.
function levelPads(d: MapDraft, buildings: readonly BakedProp[]): GradedPad[] {
  return buildings.map((p, n) => {
    const corners = padCorners(d, p);
    const height = corners.reduce((sum, k) => sum + d.heights[k], 0) / corners.length;
    return { pos: p.pos, r: padRadius(p), height, margin: TERRAIN.levelMargin, group: n };
  });
}

function padRadius(p: BakedProp): number {
  return p.r + Math.SQRT2;
}

function padCorners(d: MapDraft, p: BakedProp): number[] {
  const out: number[] = [];
  const r = padRadius(p);
  for (let j = Math.max(0, Math.floor(p.pos.y - r)); j <= Math.min(d.size, Math.ceil(p.pos.y + r)); j++) {
    for (let i = Math.max(0, Math.floor(p.pos.x - r)); i <= Math.min(d.size, Math.ceil(p.pos.x + r)); i++) if (dist({ x: i, y: j }, p.pos) <= r) out.push(j * (d.size + 1) + i);
  }
  return out;
}

// Grades the roads into the ground in one pass, each to its own grade, so their crossings share one surface, and
// holds the building pads as surface at their heights. A road beside a pad meets it within the grades. Grading blends
// back to the ground within farmGradeMargin tiles past a road's edge and levelMargin past a pad's. A road's end may
// lie ROAD_END_SLACK past the outline and a pad a tile's diagonal past it, so a corner moved farther out than they
// reach means a road or a building lies too far out. Near a road of today's world the grading fades out, so that road
// keeps its own. A tile round a pad that the grading turns into a cliff is a data error.
function gradeFarmRoads(d: MapDraft, t: TerritoryDef, roads: readonly FarmRoad[], buildings: readonly BakedProp[]): void {
  const pads = levelPads(d, buildings);
  const before = Float32Array.from(d.heights);
  const paths = roads.map((road) => ({ points: road.points.map((p) => shift(t, p)), width: road.width, grade: road.grade ?? TERRAIN.roadGrade }));
  const graded = gradePaths({ size: d.size, heights: Array.from(d.heights), types: [] }, paths, TERRAIN.farmGradeMargin, pads);
  const reach = Math.max(ROAD_END_SLACK + Math.max(...roads.map((road) => road.width / 2)) + TERRAIN.farmGradeMargin, Math.SQRT2 + TERRAIN.levelMargin);
  graded.forEach((h, k) => {
    if (h === d.heights[k]) return;
    const corner = { x: k % (d.size + 1), y: Math.floor(k / (d.size + 1)) };
    if (siteGap(t, corner) > reach) throw new Error(`${t.id} road grading moves the ground at ${at(corner)}, outside the territory`);
    const onPad = pads.some((pad) => dist(pad.pos, corner) <= pad.r);
    d.heights[k] += (h - d.heights[k]) * (onPad ? 1 : 1 - newRoadHold(corner));
  });
  for (const p of buildings) {
    const cliff = tilesWithin(d.size, p.pos, padRadius(p) + TERRAIN.levelMargin + 1).find((tile) => steep(d, tile) && tileSteepness(before, d.size, tile) <= TERRAIN.drive.maxSlope);
    if (cliff !== undefined) throw new Error(`${t.id} ${p.kind} at ${at(p.pos)} levels its ground into a cliff at ${at(tileCenter(d.size, cliff))}`);
  }
}

// Roads of today's world keep the grading the finish layer gave them: their surface, up to a tile past their edge as
// gradeRoads() grades it, takes none of a farm's grading, which fades in over farmGradeMargin tiles past it. Returns
// the share of the ground's own height a corner keeps. A farm road's stretch in this fade blends its graded and its own
// ground, so it may run steeper than its grade there: the territory test allows it a junction limit of 0.15.
export function newRoadHold(p: Vec): number {
  const d = ROAD_INDEX.nearestWithin(p.x, p.y, NEW_ROAD_SURFACE + TERRAIN.farmGradeMargin);
  return d === Infinity ? 0 : flattenFalloff(d - NEW_ROAD_SURFACE, TERRAIN.farmGradeMargin);
}

// Segment props, segment tiles long, along each run's polyline. A share of segments is broken off, the rest turn and
// shift a little, and segments on bad ground, roads or marks are left out. A run's points lie inside the territory.
function placeRuns(d: MapDraft, t: TerritoryDef, runs: readonly Run[], spots: readonly BakedProp[], marked: Touch, relief: number | null, debrisGap: number, rng: Rng): BakedProp[] {
  const placed: BakedProp[] = [];
  // A segment keeps off marks and out of every building's parking gap, and never crosses another segment.
  const fits = (seg: BakedProp): boolean =>
    !lineTouches(seg, marked) && spots.every((o) => lineDist(seg, o.pos) >= o.r + debrisGap) && placed.every((o) => !segmentsCross(seg, o)) && !formsRow(seg, placed);
  for (const run of runs) {
    for (const seg of runSegments(t, run, rng)) {
      if (!standsOnFarm(d, t, seg, true, relief)) continue;
      const turned = [seg, { ...seg, yaw: seg.yaw + ROW_NUDGE }, { ...seg, yaw: seg.yaw - ROW_NUDGE }].find(fits);
      if (turned) placed.push(turned);
    }
  }
  return placed;
}

// The two ends of a segment prop, a line seg.r tiles to each side of its centre.
function segmentEnds(seg: BakedProp): [Vec, Vec] {
  const half = { x: Math.cos(seg.yaw) * seg.r, y: Math.sin(seg.yaw) * seg.r };
  return [{ x: seg.pos.x - half.x, y: seg.pos.y - half.y }, { x: seg.pos.x + half.x, y: seg.pos.y + half.y }];
}

function lineDist(seg: BakedProp, p: Vec): number {
  const [a, b] = segmentEnds(seg);
  return segmentDist(p, a, b);
}

// Whether two segment props cross or lie on each other. Ends that meet are not a crossing.
function segmentsCross(s: BakedProp, o: BakedProp): boolean {
  const [a, b] = segmentEnds(s);
  const [c, e] = segmentEnds(o);
  const side = (p: Vec, q: Vec, r: Vec) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const [d1, d2, d3, d4] = [side(a, b, c), side(a, b, e), side(c, e, a), side(c, e, b)];
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  // Near-parallel pieces lying along each other also overlap.
  return Math.min(segmentDist(c, a, b), segmentDist(e, a, b), segmentDist(a, c, e), segmentDist(b, c, e)) < SEGMENT_CLEAR && dist(s.pos, o.pos) < s.r + o.r - SEGMENT_CLEAR;
}

// Whether a prop would stand in a ruled row with two placed props of its look: on one line at one turn. A segment
// prop looks the same turned half round, so turns compare modulo pi.
function formsRow(p: BakedProp, placed: readonly BakedProp[]): boolean {
  const same = placed.filter((o) => o.kind === p.kind && Math.abs(turnGap(o.yaw, p.yaw)) <= ROW_TURN);
  for (let i = 0; i < same.length; i++) {
    for (let j = i + 1; j < same.length; j++) {
      if (Math.abs(turnGap(same[i].yaw, same[j].yaw)) <= ROW_TURN && rowLineGap(same[i].pos, same[j].pos, p.pos) <= ROW_LINE) return true;
    }
  }
  return false;
}

function turnGap(a: number, b: number): number {
  return angleDiff(2 * a, 2 * b) / 2;
}

// How far three points lie from one line: the least of each point's tiles to the line through the other two.
function rowLineGap(a: Vec, b: Vec, c: Vec): number {
  return Math.min(lineGap(a, b, c), lineGap(a, c, b), lineGap(b, c, a));
}

// Tiles from c to the line through a and b.
function lineGap(a: Vec, b: Vec, c: Vec): number {
  const length = dist(a, b);
  return length === 0 ? dist(a, c) : Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / length;
}

// Every segment of a run that is not broken, jittered, wherever it lands. A knocked segment turns and shifts further.
// Each segment draws its break, turn, shift, knock, knocked turn and knocked shift whether or not it uses them, so one
// segment's fate never shifts another's.
function runSegments(t: TerritoryDef, run: Run, rng: Rng): BakedProp[] {
  const line = new RoadLine(run.points.map((p) => inside(t, shift(t, p), 0, `${run.look} run point`)));
  const count = Math.floor(line.length / run.segment + LENGTH_SLACK);
  const lead = (line.length - count * run.segment) / 2;
  return Array.from({ length: count }, (_, step) => {
    const s = lead + (step + 0.5) * run.segment;
    const broken = chance(rng, run.broken);
    const turn = randRange(rng, -run.jitter.turn, run.jitter.turn);
    const p = line.pointAt(s);
    const jitter = { x: randRange(rng, -run.jitter.shift, run.jitter.shift), y: randRange(rng, -run.jitter.shift, run.jitter.shift) };
    const knocked = chance(rng, run.knocked.share);
    const knockTurn = randRange(rng, -run.knocked.turn, run.knocked.turn);
    const knock = { x: randRange(rng, -run.knocked.shift, run.knocked.shift), y: randRange(rng, -run.knocked.shift, run.knocked.shift) };
    const [extraTurn, extra] = knocked ? [knockTurn, knock] : [0, { x: 0, y: 0 }];
    const pos = { x: p.x + jitter.x + extra.x, y: p.y + jitter.y + extra.y };
    return broken ? null : prop(run.look, pos, run.segment / 2, facing(line.dirAt(s)) + turn + extraTurn);
  }).filter((p): p is BakedProp => p !== null);
}

// Sandbag arcs and the tank traps ahead of them, for every emplacement. Every emplacement draws all its arcs and traps
// first, a fixed number of values each, so a dropped piece shifts no other's draws. Arcs go down before any trap, so a
// trap is checked against every arc. An arc or trap that lands on bad ground or off its seat past the relief, on a
// road, track, canal or pad, in a building's parking gap or on another prop is dropped. A trap also keeps trapGap from
// every arc and trap, and stands only out ahead of its nearest arc and clear of every arc's back.
function placeEmplacements(d: MapDraft, t: TerritoryDef, frame: Frame, farm: FarmRules, spots: readonly BakedProp[], marked: Touch, relief: number | null, debrisGap: number, rng: Rng): BakedProp[] {
  const drawn = farm.emplacements.map((e) => drawEmplacement(d, t, frame, e, rng));
  const fits = (p: BakedProp): boolean => standsOnFarm(d, t, p, false, relief) && !marked(p.pos, p.r) && clearOf(spots, p.pos, p.r, debrisGap) && clearOf(d.props, p.pos, p.r, 0);
  const arcs: BakedProp[] = [];
  // An emplacement's own arcs stand side by side and meet, so each keeps clear only of the arcs placed before it.
  for (const group of drawn) arcs.push(...group.arcs.filter((arc) => fits(arc) && clearOf(arcs, arc.pos, arc.r, 0)));
  const traps: BakedProp[] = [];
  for (const trap of drawn.flatMap((group) => group.traps)) {
    if (fits(trap) && [arcs, traps].every((placed) => placed.every((o) => dist(o.pos, trap.pos) >= EMPLACEMENT.trapGap)) && coveredBy(arcs, trap.pos)) traps.push(trap);
  }
  return [...arcs, ...traps];
}

// An emplacement's arcs, arcStep apart across its face and turned to it, and its traps out ahead on the approach,
// staggered: every other trap stands in the far half of trapAhead. The emplacement's point lies inside the territory,
// off cliffs and off every road of today's world, or the farm's data is wrong.
function drawEmplacement(d: MapDraft, t: TerritoryDef, frame: Frame, e: Emplacement, rng: Rng): { arcs: BakedProp[]; traps: BakedProp[] } {
  const at0 = inside(t, shift(t, e.at), 0, 'emplacement');
  if (steep(d, tileOf(d.size, at0))) throw new Error(`${t.id} emplacement at ${at(at0)} lies on a cliff`);
  if (onNewRoad(at0, 0)) throw new Error(`${t.id} emplacement at ${at(at0)} lies on a road`);
  const yaw = frame.yaw + e.face;
  const dir = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const side = { x: -dir.y, y: dir.x };
  const place = (ahead: number, aside: number): Vec => ({ x: at0.x + dir.x * ahead + side.x * aside, y: at0.y + dir.y * ahead + side.y * aside });
  const arcs = Array.from({ length: e.arcs }, (_, k) => {
    const turn = randRange(rng, -EMPLACEMENT.turnJitter, EMPLACEMENT.turnJitter);
    const p = place(0, (k - (e.arcs - 1) / 2) * EMPLACEMENT.arcStep);
    const pos = { x: p.x + randRange(rng, -EMPLACEMENT.shift, EMPLACEMENT.shift), y: p.y + randRange(rng, -EMPLACEMENT.shift, EMPLACEMENT.shift) };
    return prop('sandbags', pos, EMPLACEMENT.arcRadius, yaw + turn);
  });
  const [near, far] = EMPLACEMENT.trapAhead;
  const bin = (2 * EMPLACEMENT.trapSpread) / e.traps;
  const traps = Array.from({ length: e.traps }, (_, k) => {
    const ahead = near + ((far - near) * ((k % 2) + randRange(rng, 0, 1))) / 2;
    const aside = -EMPLACEMENT.trapSpread + bin * (k + 0.5) + randRange(rng, -bin / 4, bin / 4);
    return prop('tankTrap', place(ahead, aside), EMPLACEMENT.trapRadius, randRange(rng, 0, Math.PI * 2));
  });
  return { arcs, traps };
}

// Whether p lies more than an arc's radius out in front of the nearest arc, on its convex side, and behindClear from
// every arc it lies behind, where the guards crouch.
function coveredBy(arcs: readonly BakedProp[], p: Vec): boolean {
  if (arcs.length === 0) return false;
  const ahead = (arc: BakedProp): number => (p.x - arc.pos.x) * Math.cos(arc.yaw) + (p.y - arc.pos.y) * Math.sin(arc.yaw);
  const nearest = arcs.reduce((a, b) => (dist(b.pos, p) < dist(a.pos, p) ? b : a));
  return ahead(nearest) > EMPLACEMENT.arcRadius && arcs.every((arc) => ahead(arc) > 0 || dist(arc.pos, p) >= EMPLACEMENT.behindClear);
}

// Loose pieces round the buildings of the looks each rule names: from the debris gap past a building's footprint to
// reach tiles further out, at random turns. A piece keeps the parking gap from every building, stands off roads and
// marks and clear of every prop. A piece with no room after TRIES draws is dropped.
function placeClutter(d: MapDraft, t: TerritoryDef, spots: readonly BakedProp[], debrisGap: number, rules: readonly ClutterRule[], open: Touch, relief: number | null, rng: Rng): BakedProp[] {
  const placed: BakedProp[] = [];
  for (const rule of rules) {
    const near = spots.filter((s) => rule.near.includes(s.kind));
    if (near.length === 0) throw new Error(`${t.id} has no building for its ${rule.look} clutter`);
    for (let i = 0; i < rule.count; i++) {
      const piece = clutterPiece(near, debrisGap, rule, rng, (p) =>
        standsOnFarm(d, t, p, false, relief) && open(p.pos, p.r) && clearOf(spots, p.pos, p.r, debrisGap) && clearOf(d.props, p.pos, p.r, 0) && clearOf(placed, p.pos, p.r, 0) && !formsRow(p, [...d.props, ...placed]));
      if (piece) placed.push(piece);
    }
  }
  return placed;
}

function clutterPiece(near: readonly BakedProp[], debrisGap: number, rule: ClutterRule, rng: Rng, ok: (p: BakedProp) => boolean): BakedProp | null {
  for (let k = 0; k < TRIES; k++) {
    const by = near[randInt(rng, 0, near.length - 1)];
    const r = randRange(rng, rule.radius[0], rule.radius[1]);
    const a = randRange(rng, 0, Math.PI * 2);
    const out = by.r + r + REGION.obstacles.gap + debrisGap + randRange(rng, 0, rule.reach);
    const pos = { x: by.pos.x + Math.cos(a) * out, y: by.pos.y + Math.sin(a) * out };
    const piece = prop(rule.look, pos, r, randRange(rng, 0, Math.PI * 2));
    if (ok(piece)) return piece;
  }
  return null;
}

// A block on the map: its centre and the heading of its frame. Its corners are checked and its tiles become field.
type Field = { block: GroveBlock; centre: Vec; yaw: number };

function fieldOf(d: MapDraft, t: TerritoryDef, frame: Frame, block: GroveBlock): Field {
  const centre = shift(t, block.at);
  const yaw = frame.yaw + block.turn;
  checkBlock(d, t, yaw, block, centre);
  markField(d, t, yaw, block, centre);
  return { block, centre, yaw };
}

// Trees stand on each block's grid. A share of grid points stays empty, trees that keep rejects are dropped, and
// planting stops at maxTrees. A block that keeps under groves.keep of its planned trees, the points not left empty,
// lies on bad ground and fails loudly.
function plantBlocks(t: TerritoryDef, groves: GroveRule, fields: readonly Field[], rng: Rng, keep: Touch): BakedProp[] {
  const trees: BakedProp[] = [];
  for (const { block, centre, yaw } of fields) {
    const grid = blockGrid(yaw, groves, block, centre, rng);
    // The block's plan is its grid points that are not left empty; ground that rejects too many of them is bad data.
    const planned = grid.filter((p) => !p.gone);
    // A tree of a neighbouring block may stand near this block's edge.
    const standing = planned.filter((p) => keep(p.pos, groves.radius) && clearOf(trees, p.pos, groves.radius, 0));
    const kept = standing.slice(0, Math.max(0, groves.maxTrees - trees.length)).map((p) => prop(groves.look, p.pos, groves.radius, p.turn));
    if (kept.length < groves.keep * planned.length) throw new Error(`${t.id} grove block at ${at(centre)} keeps ${kept.length} of ${planned.length} planned trees, under ${groves.keep}`);
    trees.push(...kept);
  }
  return trees;
}

function markField(d: MapDraft, t: TerritoryDef, yaw: number, block: GroveBlock, centre: Vec): void {
  for (const tile of rectTiles(d, centre, yaw, block.size)) if (siteGap(t, tileCenter(d.size, tile)) < 0) mark(d, tile, BUILT_FIELD);
}

// The block's planned trees: rows rowGap apart, trees treeGap apart along each row with a little jitter along it, so
// lanes between rows stay rowGap - 2 radius wide. Each point draws whether it stays empty and its turn.
function blockGrid(yaw: number, groves: GroveRule, block: GroveBlock, centre: Vec, rng: Rng): { pos: Vec; gone: boolean; turn: number }[] {
  const along = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const across = { x: Math.sin(yaw), y: -Math.cos(yaw) };
  const [row, lane] = block.rows === 'along' ? [along, across] : [across, along];
  const [rowLength, rowSpan] = block.rows === 'along' ? [block.size.x, block.size.y] : [block.size.y, block.size.x];
  const perRow = Math.floor(rowLength / groves.treeGap) + 1;
  const rows = Math.floor(rowSpan / groves.rowGap) + 1;
  return Array.from({ length: rows * perRow }, (_, k) => {
    const a = ((k % perRow) - (perRow - 1) / 2) * groves.treeGap + randRange(rng, -groves.jitter, groves.jitter);
    const c = (Math.floor(k / perRow) - (rows - 1) / 2) * groves.rowGap;
    const gone = chance(rng, groves.missing);
    const turn = randRange(rng, 0, Math.PI * 2);
    return { pos: { x: centre.x + row.x * a + lane.x * c, y: centre.y + row.y * a + lane.y * c }, gone, turn };
  });
}

// Single trees just past the blocks' edges, so the groves fray and no block edge is a ruler line. Each stands a tree
// gap from every other tree. A stray with no room after TRIES draws is dropped, and planting stops at maxTrees.
function plantStrays(t: TerritoryDef, frame: Frame, groves: GroveRule, blocks: readonly GroveBlock[], trees: readonly BakedProp[], rng: Rng, keep: Touch): BakedProp[] {
  const strays: BakedProp[] = [];
  const ok = (pos: Vec): boolean => keep(pos, groves.radius) && [...trees, ...strays].every((o) => dist(o.pos, pos) >= groves.treeGap);
  for (let i = 0; i < groves.strays && trees.length + strays.length < groves.maxTrees; i++) {
    const stray = drawStray(t, frame, blocks, rng, ok);
    if (stray) strays.push(prop(groves.look, stray.pos, groves.radius, stray.turn));
  }
  return strays;
}

function drawStray(t: TerritoryDef, frame: Frame, blocks: readonly GroveBlock[], rng: Rng, ok: (pos: Vec) => boolean): { pos: Vec; turn: number } | null {
  for (let k = 0; k < TRIES; k++) {
    const p = strayPoint(t, frame, blocks, rng);
    if (p && ok(p.pos)) return p;
  }
  return null;
}

// A point in the fray just past a random block's edge, with a turn, or null when the draw lands inside the block.
function strayPoint(t: TerritoryDef, frame: Frame, blocks: readonly GroveBlock[], rng: Rng): { pos: Vec; turn: number } | null {
  const block = blocks[randInt(rng, 0, blocks.length - 1)];
  const yaw = frame.yaw + block.turn;
  const [a, c] = [randRange(rng, -0.5, 0.5) * (block.size.x + 2 * STRAY_FRAY), randRange(rng, -0.5, 0.5) * (block.size.y + 2 * STRAY_FRAY)];
  const turn = randRange(rng, 0, Math.PI * 2);
  if (Math.abs(a) < block.size.x / 2 && Math.abs(c) < block.size.y / 2) return null;
  const centre = shift(t, block.at);
  return { pos: { x: centre.x + Math.cos(yaw) * a + Math.sin(yaw) * c, y: centre.y + Math.sin(yaw) * a - Math.cos(yaw) * c }, turn };
}

// A block's corners lie inside the territory on drivable ground off the roads.
function checkBlock(d: MapDraft, t: TerritoryDef, yaw: number, block: GroveBlock, centre: Vec): void {
  for (const corner of corners(centre, yaw, block.size)) {
    const where = `${t.id} grove block at ${at(centre)} has its corner ${at(corner)}`;
    inside(t, corner, 0, `grove block at ${at(centre)} corner`);
    if (steep(d, tileOf(d.size, corner))) throw new Error(`${where} on a cliff`);
    if (onNewRoad(corner, 0)) throw new Error(`${where} on a road`);
  }
}

// Inside the territory, off cliffs and off every road of today's world. With a relief limit, also on ground that
// lies no farther than it off the piece's seat under its footprint, a line for a segment prop or a disc, and under
// every ground corner of the model's boxes that block a truck, which can reach past the footprint.
function standsOnFarm(d: MapDraft, t: TerritoryDef, p: BakedProp, segment: boolean, relief: number | null): boolean {
  if (siteGap(t, p.pos) >= -p.r || steep(d, tileOf(d.size, p.pos)) || onNewRoad(p.pos, p.r)) return false;
  return relief === null || (footprintRelief(d.heights, d.size, p, segment) <= relief && cornerRelief(d, p) <= relief);
}

// The most the ground at a ground corner of the prop's blocking boxes lies off its seat at its centre, in height units.
function cornerRelief(d: MapDraft, p: BakedProp): number {
  const ground = { size: d.size, heights: d.heights };
  const seat = groundAt(ground, p.pos.x, p.pos.y);
  const look = p.kind;
  if (look === 'rock') throw new Error('A farm never places a rock');
  const boxes = propBoxes({ id: `${look}-farm`, pos: p.pos, r: p.r, kind: 'landmark', look, yaw: p.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
  let worst = 0;
  for (const b of boxes) {
    for (const [i, j] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const x = b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * j;
      const y = b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * j;
      worst = Math.max(worst, Math.abs(groundAt(ground, x, y) - seat));
    }
  }
  return worst;
}

// Whether no prop of the list stands within gap tiles of a circle at pos with radius r.
function clearOf(props: readonly BakedProp[], pos: Vec, r: number, gap: number): boolean {
  return props.every((o) => dist(o.pos, pos) >= o.r + r + REGION.obstacles.gap + gap);
}

// Whether a run segment, a line seg.r tiles to each side of its centre, touches something. A barrier lies along a
// road's edge, so the circle round it would touch the road where the line does not.
function lineTouches(seg: BakedProp, touch: Touch): boolean {
  const steps = Math.ceil((2 * seg.r) / LINE_SAMPLE);
  return Array.from({ length: steps + 1 }, (_, k) => -seg.r + (2 * seg.r * k) / steps).some((o) => touch({ x: seg.pos.x + Math.cos(seg.yaw) * o, y: seg.pos.y + Math.sin(seg.yaw) * o }, 0));
}

// Whether a circle keeps the obstacle gap from a run segment.
function clearOfSegment(seg: BakedProp, pos: Vec, r: number): boolean {
  return lineDist(seg, pos) >= r + REGION.obstacles.gap;
}

// Tiles whose centre lies in a rectangle of size (along yaw, across it) around centre.
function rectTiles(d: MapDraft, centre: Vec, yaw: number, size: Vec): number[] {
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
  return tilesWithin(d.size, centre, Math.hypot(size.x, size.y) / 2).filter((tile) => {
    const c = tileCenter(d.size, tile);
    const [x, y] = [c.x - centre.x, c.y - centre.y];
    return Math.abs(x * cos + y * sin) <= size.x / 2 && Math.abs(x * sin - y * cos) <= size.y / 2;
  });
}

function corners(centre: Vec, yaw: number, size: Vec): Vec[] {
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
  return [-1, 1].flatMap((a) => [-1, 1].map((c) => ({ x: centre.x + (a * size.x * cos + c * size.y * sin) / 2, y: centre.y + (a * size.x * sin - c * size.y * cos) / 2 })));
}

// The point, which must lie inside the territory with r tiles to spare, or the farm's data is wrong.
function inside(t: TerritoryDef, p: Vec, r: number, what: string): Vec {
  if (siteGap(t, p) > -r) throw new Error(`${t.id} ${what} at ${at(p)} lies outside the territory`);
  return p;
}

function shift(t: TerritoryDef, offset: Vec): Vec {
  return { x: t.pos.x + offset.x, y: t.pos.y + offset.y };
}
