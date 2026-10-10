import { FORTRESS } from '../data/fortress';
import { FORT_MODELS, type FortModel } from './fortress';
import { PHYSICS } from '../data/physics';
import SHAPES from '../data/prop-shapes.json';
import { REGION } from '../data/region';
import { BREAKABLE } from '../data/rules';
import { STORY_WRECKS } from '../data/salvage';
import { PROP_KINDS, type BakedMap, type BakedProp, type PropKind, type Terrain } from './terrain';
import { siteGap } from './sites';
import { TERRAIN } from '../data/terrain';
import { randInt, randRange } from './rng';
import { hulkBoxes } from './body';
import { chassisDef } from '../data/chassis';
import { propBase, underDeck } from './bridge';
import { atlasOf, atlasSites, type Atlas } from './atlas';
import { modeRules } from './settings';
import type { LandmarkLook, Obstacle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';

const O = REGION.obstacles;
export function generateObstacles(world: World, map: BakedMap, fixed: Obstacle[]): Obstacle[] {
  const atlas = atlasOf(map.terrain);
  const out = mapObstacles(map);
  for (const o of fixed) {
    if (overlapsAny(out, o.pos, o.r) || !clearOfSites(atlas, o.pos, o.r) || !clearOfDecks(atlas, o.pos, o.r))
      throw new Error(`Obstacle ${o.id} at ${o.pos.x.toFixed(1)}, ${o.pos.y.toFixed(1)} overlaps a prop, a site or a deck`);
    out.push(o);
  }
  placeModeWrecks(world, out);
  return out;
}

function placeModeWrecks(world: World, out: Obstacle[]): void {
  const rules = modeRules(world);
  if (rules.roadWrecks) placeRoadWrecks(world, out);
  if (rules.salvage) out.push(...STORY_WRECKS.map((w): Obstacle => ({ id: w.id, pos: { ...w.pos }, r: w.r, kind: 'wreck', hulk: { chassisId: w.chassisId, yaw: w.yaw } })));
}

export function mapObstacles(map: BakedMap): Obstacle[] {
  const out = map.props.map((p, k) => propObstacle(p, k));
  const ids = new Set<string>();
  for (const o of out) {
    if (ids.has(o.id)) throw new Error(`Baked prop id ${o.id} is not unique`);
    ids.add(o.id);
  }
  return out;
}

export function propObstacle(p: BakedProp, k: number): Obstacle {
  if (p.hulk !== undefined) return hulkObstacle(p, k, p.hulk);
  if (p.kind === 'rock') return { id: `rock${k}`, pos: { ...p.pos }, r: p.r, kind: 'rock' };
  const id = p.kind === 'pole' ? `${p.kind}-${p.group}-${p.step}` : `${p.kind}-${k}`;
  return { id, pos: { ...p.pos }, r: p.r, kind: 'landmark', look: p.kind, yaw: p.yaw };
}

function hulkObstacle(p: BakedProp, k: number, chassisId: string): Obstacle {
  chassisDef(chassisId);
  return { id: `hulk-${k}`, pos: { ...p.pos }, r: p.r, kind: 'wreck', hulk: { chassisId, yaw: p.yaw } };
}

let bakedId: RegExp | null = null;

export function isBakedObstacle(o: Obstacle): boolean {
  bakedId ??= new RegExp(`^(rock\\d+|hulk-\\d+|pole-\\d+-\\d+|(${PROP_KINDS.filter((k) => k !== 'rock' && k !== 'pole').join('|')})-\\d+)$`);
  return bakedId.test(o.id);
}

function placeRoadWrecks(world: World, out: Obstacle[]): void {
  for (let placed = 0; placed < O.roadWrecks; placed++) {
    const spot = findRoadWreckSpot(world, out, () => true);
    out.push({ id: `wreck${placed}`, ...spot, kind: 'wreck' });
  }
}

export function findRoadWreckSpot(world: World, obstacles: Obstacle[], allowed: (pos: Vec, r: number) => boolean): { pos: Vec; r: number } {
  for (let tries = 1; tries <= O.maxTries; tries++) {
    const road = REGION.roads[randInt(world, 0, REGION.roads.length - 1)];
    const seg = randInt(world, 0, road.length - 2);
    const t = randRange(world, 0.2, 0.8);
    const a = road[seg];
    const b = road[seg + 1];
    const side = (randInt(world, 0, 1) * 2 - 1) * randRange(world, O.roadWreckShoulder[0], O.roadWreckShoulder[1]) * (REGION.roadWidth / 2);
    const len = dist(a, b);
    const pos = { x: a.x + (b.x - a.x) * t - ((b.y - a.y) / len) * side, y: a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * side };
    const r = randRange(world, 0.55, 0.8);
    const atlas = atlasOf(world.terrain);
    if (clearOfSites(atlas, pos, r) && !overlapsAny(obstacles, pos, r) && clearOfDecks(atlas, pos, r) && allowed(pos, r)) return { pos, r };
  }
  throw new Error('Road wreck placement ran out of tries');
}

export function overlapsAny(out: Obstacle[], pos: Vec, r: number): boolean {
  return out.some((o) => o.kind !== 'site' && dist(pos, o.pos) < o.r + r + O.gap);
}

export function isDriveObstacle(o: Obstacle): boolean {
  return o.kind !== 'building' && o.kind !== 'water' && !o.id.startsWith('cw-');
}

export function isBreakable(o: Obstacle): boolean {
  return o.kind === 'landmark' && BREAKABLE.kinds.includes(o.look);
}

export function onDeck(atlas: Atlas, pos: Vec, r: number): boolean {
  return atlas.decks.decks.some((deck) => segmentDist(pos, deck.from, deck.to) < deck.width / 2 + r);
}

export function clearOfDecks(atlas: Atlas, pos: Vec, r: number): boolean {
  return !onDeck(atlas, pos, r) && (!atlas.landforms || TERRAIN.features.mounds.every((m) => dist(pos, m.center) >= m.radius + m.bank + r));
}

export function clearOfSites(atlas: Atlas, pos: Vec, r: number): boolean {
  return atlasSites(atlas).every((s) => siteGap(s, pos) > O.siteClearance + r);
}

export type PropScale = { x: number; y: number; z: number };
export type PropPose =
  | { model: PropModel; pos: Vec; yaw: number; scale: PropScale }
  | { model: 'hulk'; chassisId: string; pos: Vec; yaw: number; scale: PropScale };
export type ShapeBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

type FortLook = Extract<PropKind, `fort${string}`>;
type Landmark = Extract<Obstacle, { kind: 'landmark' }>;
type PropModel = 'rock' | 'wreck' | 'building' | 'crag' | 'ruin_house' | 'silo' | 'water_tower' | 'gas_station' | 'bridge_broken' | 'power_pole' | 'billboard' | 'tank_hulk' | 'shack' | 'fence' | 'junk' | 'hull_chunk' | 'crates' | 'reactor' | 'dead_tree' | 'bunker' | 'sandbags' | 'farmhouse' | 'barn' | 'quonset' | 'guard_post' | 'army_truck' | 'barrier' | 'drums' | 'woodpile' | 'ship_wing' | 'ship_bow' | 'ship_cage' | 'ship_hub' | 'hull_shell' | 'hull_drum' | 'hull_shard' | 'hull_tower' | 'hull_gantry' | 'rim_rock' | 'escape_pod' | 'habitat_cylinder' | 'wing_shard' | 'power_cell' | 'tank_trap' | 'nose_rise' | 'nose_crag' | 'engine_nozzle' | 'engine_frame' | 'watchtower' | 'ruin_compound' | 'glass_spire' | 'scrap_wall' | 'hull_bay' | 'cargo_pod' | 'engine_section' | FortModel;

const M = PHYSICS.metersPerTile;
const TURN = Math.PI * 2;
const LANDMARK_MODELS: Record<Exclude<LandmarkLook, FortLook>, PropModel> = {
  crag: 'crag',
  ruin: 'ruin_house',
  house: 'building',
  silo: 'silo',
  waterTower: 'water_tower',
  gasStation: 'gas_station',
  bridgeSpan: 'bridge_broken',
  pole: 'power_pole',
  billboard: 'billboard',
  tank: 'tank_hulk',
  shack: 'shack',
  fence: 'fence',
  junk: 'junk',
  carWreck: 'wreck',
  hullChunk: 'hull_chunk',
  shipCache: 'cargo_pod',
  reactor: 'reactor',
  deadTree: 'dead_tree',
  armyCache: 'crates',
  bunker: 'bunker',
  sandbags: 'sandbags',
  tankTrap: 'tank_trap',
  farmhouse: 'farmhouse',
  barn: 'barn',
  armyTruck: 'army_truck',
  quonset: 'quonset',
  guardPost: 'guard_post',
  barrier: 'barrier',
  drums: 'drums',
  woodpile: 'woodpile',
  shipWing: 'ship_wing',
  hullCache: 'hull_bay',
  engineCache: 'engine_section',
  shipBow: 'ship_bow',
  shipCage: 'ship_cage',
  shipHub: 'ship_hub',
  hullShell: 'hull_shell',
  hullDrum: 'hull_drum',
  hullShard: 'hull_shard',
  hullTower: 'hull_tower',
  hullGantry: 'hull_gantry',
  rimRock: 'rim_rock',
  noseRise: 'nose_rise',
  noseCrag: 'nose_crag',
  engineNozzle: 'engine_nozzle',
  engineFrame: 'engine_frame',
  watchtower: 'watchtower',
  ruinCompound: 'ruin_compound',
  deadTruck: 'wreck',
  glassSpire: 'glass_spire',
  scrapWall: 'scrap_wall',
  escapePod: 'escape_pod',
  habitat: 'habitat_cylinder',
  wingShard: 'wing_shard',
  powerCell: 'power_cell',
};
const MODEL_RADIUS: Partial<Record<PropModel, number>> = {
  crag: 1,
  silo: 2.5,
  water_tower: 2,
  ruin_house: 4.8,
  gas_station: 7.2,
  bridge_broken: 6,
  wreck: 0.7 * M,
  shack: 3.6,
  junk: 2.4,
  fence: 2,
  hull_chunk: 6,
  crates: 1.5,
  reactor: 8,
  farmhouse: 16,
  barn: 14.7,
  quonset: 12.9,
  bunker: 15.6,
  guard_post: 3.2,
  army_truck: 4.4,
  barrier: 2,
  drums: 1.75,
  woodpile: 2.6,
  ship_wing: 26.5,
  ship_bow: 66,
  ship_cage: 50,
  ship_hub: 24,
  hull_shell: 24,
  hull_drum: 20,
  hull_shard: 10,
  hull_tower: 6,
  hull_gantry: 22,
  rim_rock: 8,
  escape_pod: 2.4,
  hull_bay: 2.8,
  cargo_pod: 2.8,
  engine_section: 2.8,
  habitat_cylinder: 8,
  wing_shard: 7,
  power_cell: 1.6,
  tank_trap: 1,
  engine_nozzle: 13,
  engine_frame: 15,
  watchtower: 2.4,
  ruin_compound: 9.8,
  glass_spire: 5,
  scrap_wall: 3.8,
};
const WRECK_RADIUS = 0.7;
const BUILDING_FILL = 0.78;
const SHAPE_BOXES = new Map<string, readonly ShapeBox[]>(Object.entries(SHAPES).map(([name, shape]) => [name, shape.boxes]));

export function propPose(o: Obstacle): PropPose {
  const pos = { ...o.pos };
  if (o.kind === 'landmark') return landmarkPose(o);
  if (o.kind === 'rock') return { model: 'rock', pos, yaw: -idHash(o.id) * TURN, scale: even(o.r * M) };
  if (o.kind === 'wreck') return wreckPose(o, pos);
  if (o.kind === 'building') return { model: 'building', pos, yaw: idHash(o.id) * Math.PI, scale: buildingScale(o) };
  throw new Error(`Obstacle ${o.id} of kind ${o.kind} has no prop model`);
}

function wreckPose(o: Exclude<Obstacle, Landmark>, pos: Vec): PropPose {
  if (o.hulk) return { model: 'hulk', chassisId: o.hulk.chassisId, pos, yaw: o.hulk.yaw, scale: even(1) };
  return { model: 'wreck', pos, yaw: idHash(o.id) * TURN, scale: even(o.r / WRECK_RADIUS) };
}

export function propShape(model: string): readonly ShapeBox[] {
  const boxes = SHAPE_BOXES.get(model);
  if (boxes === undefined) throw new Error(`Prop model ${model} has no shape in prop-shapes.json. Run npm run models:shapes.`);
  return boxes;
}

function landmarkModel(look: LandmarkLook): PropModel {
  const model = FORT_MODELS.get(look)?.model ?? LANDMARK_MODELS[look as Exclude<LandmarkLook, FortLook>];
  if (model === undefined) throw new Error(`Landmark look ${look} has no model`);
  return model;
}

function landmarkPose(o: Landmark): PropPose {
  const model = landmarkModel(o.look);
  const pos = { ...o.pos };
  if (FORT_MODELS.get(o.look)?.piece === 'wall') return { model, pos, yaw: o.yaw, scale: { x: o.r / FORTRESS.wallLength * 2, y: 1, z: 1 } };
  const yaw = o.look === 'pole' ? o.yaw + Math.PI / 2 : o.yaw;
  if (model === 'building') return { model, pos, yaw, scale: buildingScale(o) };
  const radius = MODEL_RADIUS[model];
  return { model, pos, yaw, scale: even(radius === undefined ? 1 : (o.r * M) / radius) };
}

function buildingScale(o: Obstacle): PropScale {
  const size = o.r * BUILDING_FILL * 2 * M;
  return { x: size, y: size, z: (16 + idHash(o.id) * 20) * (M / 45) };
}

function even(s: number): PropScale {
  return { x: s, y: s, z: s };
}

function idHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type PosedBox = { center: Vec; axis: Vec; half: Vec; z0: number; z1: number };
type PosedShape = { key: string; reach: number; boxes: readonly PosedBox[] };

const LOCAL_SHAPES = new Map<string, PosedShape>();
const POSED_BY_KEY = new Map<string, PosedShape>();
const POSED_SHAPES = new WeakMap<Obstacle, PosedShape>();

export function propBoxes(o: Obstacle): readonly PosedBox[] {
  return posedShape(o).boxes;
}

const REACHABLE_BOXES = new WeakMap<Terrain, WeakMap<readonly PosedBox[], ReachableBoxes>>();
const BLOCKING_BOXES = new WeakMap<ReachableBoxes, readonly PosedBox[]>();
export type ReachableBoxes = { base: number; boxes: readonly PosedBox[] };

export function reachableBoxes(o: Obstacle, t: Terrain): ReachableBoxes {
  const all = propBoxes(o);
  let byBoxes = REACHABLE_BOXES.get(t);
  if (!byBoxes) {
    byBoxes = new WeakMap();
    REACHABLE_BOXES.set(t, byBoxes);
  }
  let found = byBoxes.get(all);
  if (!found) {
    const base = propBase(t, o);
    found = { base, boxes: all.filter((b) => !underDeck(b, base, t)) };
    byBoxes.set(all, found);
  }
  return found;
}

export function blockingBoxes(o: Obstacle, t: Terrain): readonly PosedBox[] {
  const reachable = reachableBoxes(o, t);
  let low = BLOCKING_BOXES.get(reachable);
  if (!low) {
    low = reachable.boxes.filter((b) => b.z0 < PHYSICS.truckClearance);
    BLOCKING_BOXES.set(reachable, low);
  }
  return low;
}

export function propReach(o: Obstacle): number {
  return posedShape(o).reach;
}

export function obstacleReach(o: Obstacle): number {
  return o.kind === 'site' || o.kind === 'water' ? o.r : propReach(o);
}

export function touchesObstacle(o: Obstacle, t: Terrain, pos: Vec, r: number, margin: number = 0): boolean {
  const reach = obstacleReach(o);
  if (dist(o.pos, pos) >= reach + r + margin) return false;
  if (o.kind === 'site' || o.kind === 'water') return true;
  return blockingBoxes(o, t).some((b) => boxDistance(b, pos) < r + margin);
}

export function propKey(o: Obstacle): string {
  return posedShape(o).key;
}

function posedShape(o: Obstacle): PosedShape {
  const own = POSED_SHAPES.get(o);
  if (own) return own;
  const pose = propPose(o);
  const local = localShape(pose);
  const key = `${local.key}|${pose.pos.x},${pose.pos.y}`;
  let shape = POSED_BY_KEY.get(key);
  if (!shape) {
    shape = { key, reach: local.reach, boxes: local.boxes.map((b) => ({ ...b, center: { x: pose.pos.x + b.center.x, y: pose.pos.y + b.center.y } })) };
    POSED_BY_KEY.set(key, shape);
  }
  POSED_SHAPES.set(o, shape);
  return shape;
}

function localShape(pose: PropPose): PosedShape {
  const { x: sx, y: sy, z: sz } = pose.scale;
  const model = pose.model === 'hulk' ? `hulk:${pose.chassisId}` : pose.model;
  const key = `${model}|${pose.yaw}|${sx}|${sy}|${sz}`;
  const hit = LOCAL_SHAPES.get(key);
  if (hit) return hit;
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  let reach = 0;
  const boxes = poseBoxes(pose).map((b) => {
    const mx = ((b.x0 + b.x1) / 2) * sx;
    const my = ((b.y0 + b.y1) / 2) * sy;
    const half = { x: ((b.x1 - b.x0) / 2) * (sx / M), y: ((b.y1 - b.y0) / 2) * (sy / M) };
    reach = Math.max(reach, Math.hypot(Math.abs(mx) / M + half.x, Math.abs(my) / M + half.y));
    return { center: { x: (mx * c + my * s) / M, y: (mx * s - my * c) / M }, axis: { x: c, y: s }, half, z0: b.z0 * sz, z1: b.z1 * sz };
  });
  const shape = { key, reach, boxes };
  LOCAL_SHAPES.set(key, shape);
  return shape;
}

function poseBoxes(pose: PropPose): readonly ShapeBox[] {
  return pose.model === 'hulk' ? hulkBoxes(pose.chassisId) : propShape(pose.model);
}

function boxLocal(box: PosedBox, p: Vec): Vec {
  const dx = p.x - box.center.x;
  const dy = p.y - box.center.y;
  return { x: dx * box.axis.x + dy * box.axis.y, y: dy * box.axis.x - dx * box.axis.y };
}

export function boxDistance(box: PosedBox, p: Vec): number {
  const q = boxLocal(box, p);
  return Math.hypot(Math.max(0, Math.abs(q.x) - box.half.x), Math.max(0, Math.abs(q.y) - box.half.y));
}

export function segmentCrossesBox(box: PosedBox, a: Vec, b: Vec): boolean {
  return stretchCrossesBox(box, a, b, 0, 1);
}

export function stretchCrossesBox(box: PosedBox, a: Vec, b: Vec, t0: number, t1: number): boolean {
  const p = boxLocal(box, a);
  const q = boxLocal(box, b);
  for (const [from, to, half] of [[p.x, q.x, box.half.x], [p.y, q.y, box.half.y]]) {
    const d = to - from;
    if (d === 0) {
      if (Math.abs(from) > half) return false;
      continue;
    }
    const ta = (-half - from) / d;
    const tb = (half - from) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  return t0 <= t1;
}

export function boxSegmentDistance(box: PosedBox, a: Vec, b: Vec): number {
  if (segmentCrossesBox(box, a, b)) return 0;
  const { center: c, axis: u, half: h } = box;
  let best = Math.min(boxDistance(box, a), boxDistance(box, b));
  for (const i of [-1, 1])
    for (const j of [-1, 1]) best = Math.min(best, segmentDist({ x: c.x + u.x * h.x * i - u.y * h.y * j, y: c.y + u.y * h.x * i + u.x * h.y * j }, a, b));
  return best;
}
