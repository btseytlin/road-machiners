// Farm layout of a territory, from its FarmRules in TERRITORIES: an old asphalt road, dirt roads and tracks, concrete
// pads, irrigation canals, buildings that are loot spots, runs of segment props, clutter round the buildings, and
// blocks of dead trees in rows with strays between them. The skeleton is authored in the road's frame: roads, pads,
// canals, building poses, run lines and blocks. Everything on it is jittered, broken or scattered from the territory's
// seed, so no detail stands in a ruled line. Authored buildings, pads, road and canal points, run points and block
// corners fail loudly off the outline or on bad ground. Trees, strays, run segments and clutter that land on bad
// ground are dropped, but a block that keeps too few of its trees fails loudly too.

import { REGION, type TerritoryDef } from '../data/region';
import type { BuildingGroup, ClutterRule, FarmRules, GroveBlock, GroveRule, Pad, Run, TerritoryRules } from '../data/territory';
import { chance, randInt, randRange, type Rng } from '../sim/rng';
import { siteGap } from '../sim/sites';
import type { BakedProp } from '../sim/terrain';
import { angleDiff, bearing, dist, segmentDist, type Vec } from '../sim/vec';
import type { MapDraft } from './bake';
import { at, mark, markLine, markRoads, onNewRoad, steep, type Touch } from './marks';
import { BUILT_CANAL, BUILT_PAD, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, facing, prop, RoadLine, tileCenter, tileOf, tilesWithin } from './oldworld';

const LENGTH_SLACK = 1e-6; // share of a segment a run's length may miss by rounding and still count it whole
const LINE_SAMPLE = 0.25; // tiles between the points of a run segment tested against roads and marks
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
// stands on them and blocks mark field only on bare ground. Buildings come before the runs, clutter and trees, which
// keep a parking gap round them.
export function fillFarm(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, farm: FarmRules, rng: Rng): BakedProp[] {
  const frame = frameOf(farm.spine);
  const onRoad = markRoads(d, t, farm.roads.map((road) => ({ ...road, points: road.points.map((p) => shift(t, p)) })), 'inside');
  markPads(d, t, frame, farm.pads);
  const canals = farm.canals.map((c) => ({ points: c.points.map((p) => inside(t, shift(t, p), 0, 'canal point')), width: c.width }));
  for (const canal of canals) markLine(d, t, canal, BUILT_CANAL, 'inside');
  const spots = placeBuildings(d, t, frame, farm, onRoad, rng);
  d.props.push(...spots);
  const marked: Touch = (pos, r) => onRoad(pos, r) || touchesMarks(d, pos, r);
  const runs = placeRuns(d, t, farm.runs, spots, marked, rng);
  d.props.push(...runs);
  // Blocks mark their field first, so clutter keeps out of the groves.
  const blocks = farm.blocks.map((block) => fieldOf(d, t, frame, block));
  // Clutter keeps a tree's room off the field, so the trees at a block's edge still stand.
  const fieldClear = farm.groves.radius + REGION.obstacles.gap;
  const offField: Touch = (pos, r) => !marked(pos, r) && !touchedTiles(d.size, pos, r + fieldClear).some((tile) => d.built[tile] === BUILT_FIELD);
  const clutter = placeClutter(d, t, spots, rules.debrisGap, farm.clutter, offField, rng);
  d.props.push(...clutter);
  // Trees keep a parking gap round every building, and keep clear of the run segments as the lines they are.
  const keep = (pos: Vec, r: number): boolean =>
    standsOnFarm(d, t, pos, r) && !marked(pos, r) && clearOf(spots, pos, r, rules.debrisGap) && clearOf(clutter, pos, r, 0) && runs.every((seg) => clearOfSegment(seg, pos, r));
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

// Segment props, segment tiles long, along each run's polyline. A share of segments is broken off, the rest turn and
// shift a little, and segments on bad ground, roads or marks are left out. A run's points lie inside the territory.
function placeRuns(d: MapDraft, t: TerritoryDef, runs: readonly Run[], spots: readonly BakedProp[], marked: Touch, rng: Rng): BakedProp[] {
  const placed: BakedProp[] = [];
  // A segment keeps off marks and out of every building, and never crosses another segment.
  const fits = (seg: BakedProp): boolean =>
    !lineTouches(seg, marked) && spots.every((o) => lineDist(seg, o.pos) >= o.r) && placed.every((o) => !segmentsCross(seg, o)) && !formsRow(seg, placed);
  for (const run of runs) {
    for (const seg of runSegments(t, run, rng)) {
      if (!standsOnFarm(d, t, seg.pos, seg.r)) continue;
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

// Every segment of a run that is not broken, jittered, wherever it lands. Each segment draws its break, turn and
// shift, so one segment's fate never shifts another's.
function runSegments(t: TerritoryDef, run: Run, rng: Rng): BakedProp[] {
  const line = new RoadLine(run.points.map((p) => inside(t, shift(t, p), 0, `${run.look} run point`)));
  const count = Math.floor(line.length / run.segment + LENGTH_SLACK);
  const lead = (line.length - count * run.segment) / 2;
  return Array.from({ length: count }, (_, step) => {
    const s = lead + (step + 0.5) * run.segment;
    const broken = chance(rng, run.broken);
    const turn = randRange(rng, -run.jitter.turn, run.jitter.turn);
    const p = line.pointAt(s);
    const pos = { x: p.x + randRange(rng, -run.jitter.shift, run.jitter.shift), y: p.y + randRange(rng, -run.jitter.shift, run.jitter.shift) };
    return broken ? null : prop(run.look, pos, run.segment / 2, facing(line.dirAt(s)) + turn);
  }).filter((p): p is BakedProp => p !== null);
}

// Loose pieces round the buildings of the looks each rule names: from the debris gap past a building's footprint to
// reach tiles further out, at random turns. A piece keeps the parking gap from every building, stands off roads and
// marks and clear of every prop. A piece with no room after TRIES draws is dropped.
function placeClutter(d: MapDraft, t: TerritoryDef, spots: readonly BakedProp[], debrisGap: number, rules: readonly ClutterRule[], open: Touch, rng: Rng): BakedProp[] {
  const placed: BakedProp[] = [];
  for (const rule of rules) {
    const near = spots.filter((s) => rule.near.includes(s.kind));
    if (near.length === 0) throw new Error(`${t.id} has no building for its ${rule.look} clutter`);
    for (let i = 0; i < rule.count; i++) {
      const piece = clutterPiece(near, debrisGap, rule, rng, (p) =>
        standsOnFarm(d, t, p.pos, p.r) && open(p.pos, p.r) && clearOf(spots, p.pos, p.r, debrisGap) && clearOf(d.props, p.pos, p.r, 0) && clearOf(placed, p.pos, p.r, 0) && !formsRow(p, [...d.props, ...placed]));
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

// Inside the territory, off cliffs and off every road of today's world.
function standsOnFarm(d: MapDraft, t: TerritoryDef, pos: Vec, r: number): boolean {
  return siteGap(t, pos) < -r && !steep(d, tileOf(d.size, pos)) && !onNewRoad(pos, r);
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
