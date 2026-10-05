// Obstacle placement: the baked map's props, then seeded site props and road wrecks.

import { FORTRESS } from '../data/fortress';
import { FORT_MODELS, type FortModel } from './fortress';
import { PHYSICS } from '../data/physics';
import SHAPES from '../data/prop-shapes.json';
import { REGION } from '../data/region';
import { BREAKABLE } from '../data/rules';
import { PROP_KINDS, type BakedMap, type BakedProp, type PropKind, type Terrain } from './terrain';
import { isFortress, siteGap } from './sites';
import { TERRAIN } from '../data/terrain';
import { randInt, randRange } from './rng';
import { hulkBoxes } from './body';
import { DECKS, propBase, underDeck } from './bridge';
import type { LandmarkLook, Obstacle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';

const O = REGION.obstacles;
// Baked props come first and never change in play, so a save leaves them out and a load puts them back in
// the same place in the list.
export function generateObstacles(world: World, map: BakedMap): Obstacle[] {
  const baked = mapObstacles(map);
  const sites = placeSites();
  const out = [...baked, ...sites];
  placeRoadWrecks(world, out);
  return out;
}

// The baked map's props as obstacles: rocks as rocks, every other kind as a landmark of that look. Ids are
// rock<k> for rocks by prop order, <kind>-<group>-<step> for poles and <kind>-<k> for other props.
export function mapObstacles(map: BakedMap): Obstacle[] {
  const out = map.props.map((p, k) => propObstacle(p, k));
  const ids = new Set<string>();
  for (const o of out) {
    if (ids.has(o.id)) throw new Error(`Baked prop id ${o.id} is not unique`);
    ids.add(o.id);
  }
  return out;
}

function propObstacle(p: BakedProp, k: number): Obstacle {
  if (p.kind === 'rock') return { id: `rock${k}`, pos: { ...p.pos }, r: p.r, kind: 'rock' };
  const id = p.kind === 'pole' ? `${p.kind}-${p.group}-${p.step}` : `${p.kind}-${k}`;
  return { id, pos: { ...p.pos }, r: p.r, kind: 'landmark', look: p.kind, yaw: p.yaw };
}

// Ids mapObstacles makes. No other obstacle id takes these forms.
const BAKED_ID = new RegExp(`^(rock\\d+|pole-\\d+-\\d+|(${PROP_KINDS.filter((k) => k !== 'rock' && k !== 'pole').join('|')})-\\d+)$`);

export function isBakedObstacle(o: Obstacle): boolean {
  return BAKED_ID.test(o.id);
}

// A circle marks each abandoned site. Wrecks sit at the convoy, a pond at an oasis that is no fortress: a fortress
// oasis draws its water inside its curtain.
function placeSites(): Obstacle[] {
  const S = REGION.sites;
  // A fortress site has no circle: its baked pieces are its walls, and the town houses come from the render.
  const out: Obstacle[] = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')].filter((s) => !isFortress(s)).map((s) => ({ id: `site-${s.id}`, pos: { ...s.pos }, r: s.radius, kind: 'site' }));
  for (const loc of REGION.locations) {
    if (loc.kind === 'oasis' && !isFortress(loc)) out.push({ id: `pond-${loc.id}`, pos: { ...loc.pos }, r: S.pondRadius, kind: 'water' });
    // A fortress yard holds its wrecks inside the curtain, where no truck reaches them.
    if (loc.kind === 'convoy' && !isFortress(loc))
      S.convoyWrecks.forEach((o, i) => out.push({ id: `cw-${loc.id}-${i}`, pos: { x: loc.pos.x + o.x, y: loc.pos.y + o.y }, r: 0.65, kind: 'wreck' }));
  }
  return out;
}

function placeRoadWrecks(world: World, out: Obstacle[]): void {
  for (let placed = 0; placed < O.roadWrecks; placed++) {
    const spot = findRoadWreckSpot(world, out, () => true);
    out.push({ id: `wreck${placed}`, ...spot, kind: 'wreck' });
  }
}

// A random spot on a road shoulder, clear of sites, the decks and their ramps, the given obstacles, and any spot
// `allowed` rejects. The world RNG picks it.
export function findRoadWreckSpot(world: World, obstacles: Obstacle[], allowed: (pos: Vec, r: number) => boolean): { pos: Vec; r: number } {
  for (let tries = 1; tries <= O.maxTries; tries++) {
    const road = REGION.roads[randInt(world, 0, REGION.roads.length - 1)];
    const seg = randInt(world, 0, road.length - 2);
    const t = randRange(world, 0.2, 0.8);
    const a = road[seg];
    const b = road[seg + 1];
    // On the shoulder, left or right of the center line, so traffic keeps an open lane past it.
    const side = (randInt(world, 0, 1) * 2 - 1) * randRange(world, O.roadWreckShoulder[0], O.roadWreckShoulder[1]) * (REGION.roadWidth / 2);
    const len = dist(a, b);
    const pos = { x: a.x + (b.x - a.x) * t - ((b.y - a.y) / len) * side, y: a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * side };
    const r = randRange(world, 0.55, 0.8);
    if (clearOfSites(pos, r) && !overlapsAny(obstacles, pos, r) && clearOfDecks(pos, r) && allowed(pos, r)) return { pos, r };
  }
  throw new Error('Road wreck placement ran out of tries');
}

function overlapsAny(out: Obstacle[], pos: Vec, r: number): boolean {
  return out.some((o) => o.kind !== 'site' && dist(pos, o.pos) < o.r + r + O.gap);
}

// Site props are scenery. The whole site boundary blocks traffic instead.
export function isDriveObstacle(o: Obstacle): boolean {
  return o.kind !== 'building' && o.kind !== 'water' && !o.id.startsWith('cw-');
}

// Fences and junk piles break when a truck drives into them fast enough. See breakProp() in src/sim/salvage.ts.
export function isBreakable(o: Obstacle): boolean {
  return o.kind === 'landmark' && BREAKABLE.kinds.includes(o.look);
}

// A prop on a narrow deck would close the crossing. True when a circle reaches onto any deck.
export function onDeck(pos: Vec, r: number): boolean {
  return DECKS.some((deck) => segmentDist(pos, deck.from, deck.to) < deck.width / 2 + r);
}

// A wreck on a deck or its ramp would block the way over the deck. True when a circle keeps off every deck and every
// ramp mound.
function clearOfDecks(pos: Vec, r: number): boolean {
  return !onDeck(pos, r) && TERRAIN.features.mounds.every((m) => dist(pos, m.center) >= m.radius + m.bank + r);
}

// Whether a prop keeps the extra site clearance from every town and location.
export function clearOfSites(pos: Vec, r: number): boolean {
  return [...REGION.towns, ...REGION.locations].every((s) => siteGap(s, pos) > O.siteClearance + r);
}

// Prop poses: the model each obstacle shows, and its place, turn and scale. The views draw from the pose, and
// collisions place the model's shape by it.

// Scale from model meters on each model axis: x forward, y sideways, z up.
export type PropScale = { x: number; y: number; z: number };
// yaw turns the model's +x in radians from map +x toward +y.
// A hulk is a dead truck's chassis model, see hulkBoxes() in src/sim/body.ts.
export type PropPose =
  | { model: PropModel; pos: Vec; yaw: number; scale: PropScale }
  | { model: 'hulk'; chassisId: string; pos: Vec; yaw: number; scale: PropScale };
// One box of a model's collision shape, in model meters: x forward, y sideways, z up.
export type ShapeBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

type FortLook = Extract<PropKind, `fort${string}`>;
type Landmark = Extract<Obstacle, { kind: 'landmark' }>;
type PropModel = 'rock' | 'wreck' | 'building' | 'crag' | 'ruin_house' | 'silo' | 'water_tower' | 'gas_station' | 'bridge_broken' | 'power_pole' | 'billboard' | 'tank_hulk' | 'shack' | 'fence' | 'junk' | 'hull_chunk' | 'crates' | 'reactor' | 'dead_tree' | 'bunker' | 'sandbags' | 'farmhouse' | 'barn' | 'quonset' | 'guard_post' | 'army_truck' | 'barrier' | 'drums' | 'woodpile' | 'ship_wing' | 'ship_bow' | 'ship_cage' | 'ship_hub' | 'hull_shell' | 'hull_drum' | 'hull_shard' | 'hull_tower' | 'hull_gantry' | 'rim_rock' | FortModel;

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
  shipCache: 'crates',
  reactor: 'reactor',
  deadTree: 'dead_tree',
  armyCache: 'crates',
  bunker: 'bunker',
  sandbags: 'sandbags',
  farmhouse: 'farmhouse',
  barn: 'barn',
  armyTruck: 'army_truck',
  quonset: 'quonset',
  guardPost: 'guard_post',
  barrier: 'barrier',
  drums: 'drums',
  woodpile: 'woodpile',
  shipWing: 'ship_wing',
  hullCache: 'crates',
  shipBow: 'ship_bow',
  shipCage: 'ship_cage',
  shipHub: 'ship_hub',
  hullShell: 'hull_shell',
  hullDrum: 'hull_drum',
  hullShard: 'hull_shard',
  hullTower: 'hull_tower',
  hullGantry: 'hull_gantry',
  rimRock: 'rim_rock',
};
// Footprint radius in meters each model is built at, for models that scale evenly to their obstacle radius. A
// fence or barrier segment is 4 m long, so its radius is half that: it is one straight segment along its yaw. The
// orchard's buildings, army truck and clutter are built at their size against the 8.1 m army truck, and the orchard
// poses them at about these radii, so they draw near scale 1 (each radius is stated in its tools/blender script). The
// Fallen Sun's hull pieces are built at their real size, with half their length along +x as the radius. The building
// model stretches to its footprint instead. The pole, billboard and tank stand at their real size.
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
};
const WRECK_RADIUS = 0.7; // tiles, the reference size of the wreck model
const BUILDING_FILL = 0.78; // share of the obstacle radius a building's footprint fills
const SHAPE_BOXES = new Map<string, readonly ShapeBox[]>(Object.entries(SHAPES).map(([name, shape]) => [name, shape.boxes]));

export function propPose(o: Obstacle): PropPose {
  const pos = { ...o.pos };
  if (o.kind === 'landmark') return landmarkPose(o);
  if (o.kind === 'rock') return { model: 'rock', pos, yaw: -idHash(o.id) * TURN, scale: even(o.r * M) };
  if (o.kind === 'wreck') return wreckPose(o, pos);
  if (o.kind === 'building') return { model: 'building', pos, yaw: idHash(o.id) * Math.PI, scale: buildingScale(o) };
  throw new Error(`Obstacle ${o.id} of kind ${o.kind} has no prop model`);
}

// A kill wreck with a hulk lies as its dead truck did. Any other wreck is the generic model, turned by its id.
function wreckPose(o: Exclude<Obstacle, Landmark>, pos: Vec): PropPose {
  if (o.hulk) return { model: 'hulk', chassisId: o.hulk.chassisId, pos, yaw: o.hulk.yaw, scale: even(1) };
  return { model: 'wreck', pos, yaw: idHash(o.id) * TURN, scale: even(o.r / WRECK_RADIUS) };
}

// The collision boxes of a prop model, from src/data/prop-shapes.json.
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

// A landmark faces its baked yaw. A pole turns a quarter more, so its crossbar lies across its line.
function landmarkPose(o: Landmark): PropPose {
  const model = landmarkModel(o.look);
  const pos = { ...o.pos };
  if (FORT_MODELS.get(o.look)?.piece === 'wall') return { model, pos, yaw: o.yaw, scale: { x: o.r / FORTRESS.wallLength * 2, y: 1, z: 1 } };
  const yaw = o.look === 'pole' ? o.yaw + Math.PI / 2 : o.yaw;
  if (model === 'building') return { model, pos, yaw, scale: buildingScale(o) };
  const radius = MODEL_RADIUS[model];
  return { model, pos, yaw, scale: even(radius === undefined ? 1 : (o.r * M) / radius) };
}

// The building model has a 1 by 0.85 m footprint and 1 m walls. It stretches to the obstacle's footprint, at a
// height from its id: 16 to 36 height units of the 2D relief scale, at 45 px per unit.
function buildingScale(o: Obstacle): PropScale {
  const size = o.r * BUILDING_FILL * 2 * M;
  return { x: size, y: size, z: (16 + idHash(o.id) * 20) * (M / 45) };
}

function even(s: number): PropScale {
  return { x: s, y: s, z: s };
}

// A hash of an obstacle id in [0, 1), for turns and heights that must not draw on the world RNG.
function idHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // Final avalanche so ids that differ in one character land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// One box of a posed prop. Its ground outline is a rectangle in map tiles around center: half.x tiles each way
// along axis, a unit vector, and half.y tiles each way across it. z0 and z1 are meters above the prop's ground point.
export type PosedBox = { center: Vec; axis: Vec; half: Vec; z0: number; z1: number };
// key: names the model, turn, scale and position, so equal keys mean equal boxes. reach: tiles from the prop's
// position to the farthest corner of its boxes.
type PosedShape = { key: string; reach: number; boxes: readonly PosedBox[] };

// Shapes about the origin by model, turn and scale, and posed shapes by key. World clones copy obstacles, so the
// key finds a clone's shape again. Obstacles never change after placement, so each object also keeps its shape.
const LOCAL_SHAPES = new Map<string, PosedShape>();
const POSED_BY_KEY = new Map<string, PosedShape>();
const POSED_SHAPES = new WeakMap<Obstacle, PosedShape>();

// The collision boxes of a prop at its pose.
export function propBoxes(o: Obstacle): readonly PosedBox[] {
  return posedShape(o).boxes;
}

// A prop's boxes in reach, with the height it stands on, per terrain and posed box list. World clones share posed
// boxes and their terrain, so each list is filtered once per terrain.
const REACHABLE_BOXES = new WeakMap<Terrain, WeakMap<readonly PosedBox[], ReachableBoxes>>();
const BLOCKING_BOXES = new WeakMap<ReachableBoxes, readonly PosedBox[]>();
export type ReachableBoxes = { base: number; boxes: readonly PosedBox[] };

// The boxes of a prop that are not out of reach under a deck (underDeck() in bridge.ts), and the height it stands on:
// propBase() in bridge.ts, where its colliders and its view stand it. Blocking and sight both start from these.
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

// The boxes of a prop that block a truck: those in reach that start below truck roofs. Higher boxes, like a canopy or
// the ship wing, leave trucks to pass under.
export function blockingBoxes(o: Obstacle, t: Terrain): readonly PosedBox[] {
  const reachable = reachableBoxes(o, t);
  let low = BLOCKING_BOXES.get(reachable);
  if (!low) {
    low = reachable.boxes.filter((b) => b.z0 < PHYSICS.truckClearance);
    BLOCKING_BOXES.set(reachable, low);
  }
  return low;
}

// Tiles from the prop's position to the farthest corner of its posed boxes. A circle of this radius holds the
// whole shape, so a cheap test with it never misses a collision. The obstacle radius is only the placement footprint.
export function propReach(o: Obstacle): number {
  return posedShape(o).reach;
}

// Tiles within which an obstacle can touch anything: its shape's reach for a prop, its radius for a site or a
// pond, which have no model.
export function obstacleReach(o: Obstacle): number {
  return o.kind === 'site' || o.kind === 'water' ? o.r : propReach(o);
}

// Whether a disc of radius r at pos comes within margin of the obstacle. A prop is judged by its boxes that block trucks, since its
// reach circle holds gaps a long gatehouse leaves open beside it.
export function touchesObstacle(o: Obstacle, t: Terrain, pos: Vec, r: number, margin: number = 0): boolean {
  const reach = obstacleReach(o);
  if (dist(o.pos, pos) >= reach + r + margin) return false;
  if (o.kind === 'site' || o.kind === 'water') return true;
  return blockingBoxes(o, t).some((b) => boxDistance(b, pos) < r + margin);
}

// Names a prop's model, turn, scale and position: two props with one key have the same boxes.
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

// The view turns a model by -yaw about the up axis, and model sideways +y is three.js -z, which is map -y. So a
// model point (x, y) lands at map offset (x cos + y sin, x sin - y cos) after scaling.
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

// The model boxes a pose places.
function poseBoxes(pose: PropPose): readonly ShapeBox[] {
  return pose.model === 'hulk' ? hulkBoxes(pose.chassisId) : propShape(pose.model);
}

// Point p in the box's frame: tiles along its axis and across it, from its center.
function boxLocal(box: PosedBox, p: Vec): Vec {
  const dx = p.x - box.center.x;
  const dy = p.y - box.center.y;
  return { x: dx * box.axis.x + dy * box.axis.y, y: dy * box.axis.x - dx * box.axis.y };
}

// Tiles from p to the box's ground outline, 0 inside it.
export function boxDistance(box: PosedBox, p: Vec): number {
  const q = boxLocal(box, p);
  return Math.hypot(Math.max(0, Math.abs(q.x) - box.half.x), Math.max(0, Math.abs(q.y) - box.half.y));
}

// Whether segment ab touches the box's ground outline.
export function segmentCrossesBox(box: PosedBox, a: Vec, b: Vec): boolean {
  return stretchCrossesBox(box, a, b, 0, 1);
}

// Whether the stretch of segment ab from fraction t0 to t1 of it touches the box's ground outline. Clips the stretch
// to the outline's slabs. An empty stretch, t0 past t1, never touches.
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

// Tiles from segment ab to the box's ground outline, 0 where it crosses. Apart, the nearest points are an end of
// the segment or a corner of the outline.
export function boxSegmentDistance(box: PosedBox, a: Vec, b: Vec): number {
  if (segmentCrossesBox(box, a, b)) return 0;
  const { center: c, axis: u, half: h } = box;
  let best = Math.min(boxDistance(box, a), boxDistance(box, b));
  for (const i of [-1, 1])
    for (const j of [-1, 1]) best = Math.min(best, segmentDist({ x: c.x + u.x * h.x * i - u.y * h.y * j, y: c.y + u.y * h.x * i + u.x * h.y * j }, a, b));
  return best;
}
