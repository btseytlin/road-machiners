// Obstacle placement: the baked map's props, then seeded site props and road wrecks.

import { PHYSICS } from '../data/physics';
import SHAPES from '../data/prop-shapes.json';
import { REGION } from '../data/region';
import { BREAKABLE } from '../data/rules';
import { PROP_KINDS, type BakedMap, type BakedProp } from './terrain';
import { randInt, randRange } from './rng';
import { TERRAIN } from '../data/terrain';
import type { LandmarkLook, Obstacle, World } from './types';
import { angleDiff, bearing, dist, segmentDist, type Vec } from './vec';

const O = REGION.obstacles;

export function generateObstacles(world: World, map: BakedMap): Obstacle[] {
  const baked = mapObstacles(map);
  const sites = placeSites(world);
  const out = [...baked, ...sites];
  placeRoadWrecks(world, out);
  return out;
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

function propObstacle(p: BakedProp, k: number): Obstacle {
  if (p.kind === 'rock') return { id: `rock${k}`, pos: { ...p.pos }, r: p.r, kind: 'rock' };
  const id = p.kind === 'pole' ? `pole-${p.group}-${p.step}` : `${p.kind}-${k}`;
  return { id, pos: { ...p.pos }, r: p.r, kind: 'landmark', look: p.kind, yaw: p.yaw };
}

const BAKED_ID = new RegExp(`^(rock\\d+|pole-\\d+-\\d+|(${PROP_KINDS.filter((k) => k !== 'rock' && k !== 'pole').join('|')})-\\d+)$`);

export function isBakedObstacle(o: Obstacle): boolean {
  return BAKED_ID.test(o.id);
}

function placeSites(world: World): Obstacle[] {
  const S = REGION.sites;
  const out: Obstacle[] = [...REGION.towns, ...REGION.locations].map((s) => ({ id: `site-${s.id}`, pos: { ...s.pos }, r: s.radius, kind: 'site' }));
  for (const town of REGION.towns) {
    const exits = roadExits(town.pos);
    for (let i = 0; i < S.buildingsPerTown; i++) {
      const a = (i / S.buildingsPerTown) * Math.PI * 2 + randRange(world, -0.3, 0.3);
      if (exits.some((e) => Math.abs(angleDiff(a, e)) < S.roadGapAngle)) continue;
      const d = town.radius * randRange(world, S.buildingRing[0], S.buildingRing[1]);
      const pos = { x: town.pos.x + Math.cos(a) * d, y: town.pos.y + Math.sin(a) * d };
      const r = randRange(world, S.buildingRadius[0], S.buildingRadius[1]);
      if (!overlapsAny(out, pos, r)) out.push({ id: `bld-${town.id}-${i}`, pos, r, kind: 'building' });
    }
  }
  for (const loc of REGION.locations) {
    if (loc.kind === 'oasis') out.push({ id: `pond-${loc.id}`, pos: { ...loc.pos }, r: S.pondRadius, kind: 'water' });
    if (loc.kind === 'convoy')
      S.convoyWrecks.forEach((o, i) => out.push({ id: `cw-${loc.id}-${i}`, pos: { x: loc.pos.x + o.x, y: loc.pos.y + o.y }, r: 0.65, kind: 'wreck' }));
  }
  return out;
}

export function roadExits(p: Vec): number[] {
  const exits: number[] = [];
  for (const road of REGION.roads) {
    road.forEach((q, i) => {
      if (dist(q, p) > 0.01) return;
      if (i > 0) exits.push(bearing(p, road[i - 1]));
      if (i + 1 < road.length) exits.push(bearing(p, road[i + 1]));
    });
  }
  return exits;
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
    if (clearOfSites(pos, r) && !overlapsAny(obstacles, pos, r) && !onBridge(pos, r) && allowed(pos, r)) return { pos, r };
  }
  throw new Error('Road wreck placement ran out of tries');
}

function overlapsAny(out: Obstacle[], pos: Vec, r: number): boolean {
  return out.some((o) => o.kind !== 'site' && dist(pos, o.pos) < o.r + r + O.gap);
}

export function isDriveObstacle(o: Obstacle): boolean {
  return o.kind !== 'building' && o.kind !== 'water' && !o.id.startsWith('cw-');
}

export function isBreakable(o: Obstacle): boolean {
  return o.kind === 'landmark' && BREAKABLE.kinds.includes(o.look);
}

export function onBridge(pos: Vec, r: number): boolean {
  const bridge = TERRAIN.features.bridge;
  return segmentDist(pos, bridge.from, bridge.to) < bridge.width / 2 + r;
}

export function clearOfSites(pos: Vec, r: number): boolean {
  return [...REGION.towns, ...REGION.locations].every((s) => dist(pos, s.pos) > s.radius + O.siteClearance + r);
}

export type PropScale = { x: number; y: number; z: number };
export type PropPose = { model: PropModel; pos: Vec; yaw: number; scale: PropScale };
export type ShapeBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;
type PropModel = 'rock' | 'wreck' | 'building' | 'crag' | 'ruin_house' | 'silo' | 'water_tower' | 'gas_station' | 'bridge_broken' | 'power_pole' | 'billboard' | 'tank_hulk' | 'shack' | 'fence' | 'junk';

const M = PHYSICS.metersPerTile;
const TURN = Math.PI * 2;
const LANDMARK_MODELS: Record<LandmarkLook, PropModel> = {
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
};
const MODEL_RADIUS: Partial<Record<PropModel, number>> = { crag: 1, silo: 2.5, water_tower: 2, ruin_house: 4.8, gas_station: 7.2, bridge_broken: 6, wreck: 0.7 * M, shack: 3.6, junk: 2.4, fence: 2 };
const WRECK_RADIUS = 0.7;
const BUILDING_FILL = 0.78;
const SHAPE_BOXES = new Map<string, readonly ShapeBox[]>(Object.entries(SHAPES).map(([name, shape]) => [name, shape.boxes]));

export function propPose(o: Obstacle): PropPose {
  const pos = { ...o.pos };
  if (o.kind === 'landmark') return landmarkPose(o);
  if (o.kind === 'rock') return { model: 'rock', pos, yaw: -idHash(o.id) * TURN, scale: even(o.r * M) };
  if (o.kind === 'wreck') return { model: 'wreck', pos, yaw: idHash(o.id) * TURN, scale: even(o.r / WRECK_RADIUS) };
  if (o.kind === 'building') return { model: 'building', pos, yaw: idHash(o.id) * Math.PI, scale: buildingScale(o) };
  throw new Error(`Obstacle ${o.id} of kind ${o.kind} has no prop model`);
}

export function propShape(model: string): readonly ShapeBox[] {
  const boxes = SHAPE_BOXES.get(model);
  if (boxes === undefined) throw new Error(`Prop model ${model} has no shape in prop-shapes.json. Run npm run models:shapes.`);
  return boxes;
}

function landmarkPose(o: Landmark): PropPose {
  const model = LANDMARK_MODELS[o.look];
  const pos = { ...o.pos };
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

export function propReach(o: Obstacle): number {
  return posedShape(o).reach;
}

export function obstacleReach(o: Obstacle): number {
  return o.kind === 'site' || o.kind === 'water' ? o.r : propReach(o);
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
  const key = `${pose.model}|${pose.yaw}|${sx}|${sy}|${sz}`;
  const hit = LOCAL_SHAPES.get(key);
  if (hit) return hit;
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  let reach = 0;
  const boxes = propShape(pose.model).map((b) => {
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
  const p = boxLocal(box, a);
  const q = boxLocal(box, b);
  let t0 = 0;
  let t1 = 1;
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
  return true;
}

export function boxSegmentDistance(box: PosedBox, a: Vec, b: Vec): number {
  if (segmentCrossesBox(box, a, b)) return 0;
  const { center: c, axis: u, half: h } = box;
  let best = Math.min(boxDistance(box, a), boxDistance(box, b));
  for (const i of [-1, 1])
    for (const j of [-1, 1]) best = Math.min(best, segmentDist({ x: c.x + u.x * h.x * i - u.y * h.y * j, y: c.y + u.y * h.x * i + u.x * h.y * j }, a, b));
  return best;
}
