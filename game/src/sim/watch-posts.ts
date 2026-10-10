
import { chassisDef } from '../data/chassis';
import { HUNT, NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { isBakedObstacle, propReach } from './mapgen';
import { CELL, CLEARANCE, nearCliff, staticSet, terrainNav, tileIndex, type StaticSet, type TerrainNav } from './nav/layer';
import type { Blocker } from './nav/buckets';
import { lawmanTowns } from './npc-decisions';
import { propsAlong } from './prop-index';
import { INDEX_CELL, ROAD_INDEX } from './road-index';
import { siteGates, siteUnder } from './sites';
import type { Terrain } from './terrain';
import { hazardZones, type HazardZone } from './territory';
import type { GoalReason, NpcActivity, Obstacle, Vehicle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';
import { icarusAtlas } from './atlas';
import { clearOverTerrain, hasLineOfSight, sightLine } from './vision';

function postReach(): number {
  const radii = Object.values(NPCS).filter((t) => t.traits.includes('raider')).flatMap((t) => t.loadout.chassis.map((c) => chassisDef(c.value).radius));
  return Math.max(...radii) + CLEARANCE + CELL;
}

type RoadSamples = Map<number, Vec[]>;

type PostMap = { reach: number; roadSamples: RoadSamples; nav: TerrainNav; statics: StaticSet; gates: Vec[]; hazards: HazardZone[]; posts: Map<string, Vec | null>; lists: Map<string, readonly Vec[]> };

const maps = new WeakMap<Terrain, PostMap>();

function postMap(world: World): PostMap {
  const hit = maps.get(world.terrain);
  if (hit) return hit;
  const map: PostMap = {
    reach: postReach(),
    roadSamples: roadSamplesOf(),
    nav: terrainNav(world.terrain),
    statics: staticSet(fixedProps(world), world.terrain),
    gates: lawmanTowns().flatMap((town) => siteGates(town)),
    hazards: hazardZones(),
    posts: new Map(),
    lists: new Map(),
  };
  maps.set(world.terrain, map);
  return map;
}

function fixedProps(world: World): Obstacle[] {
  return [...world.obstacles.filter((o) => isBakedObstacle(o) || o.kind === 'site'), ...world.broken.map((b) => b.obstacle)];
}

export function watchPost(world: World, ground: Vec): Vec | null {
  const map = postMap(world);
  const key = `${ground.x},${ground.y}`;
  const cached = map.posts.get(key);
  if (cached !== undefined) return cached;
  const post = pickHide(world, map, ground);
  map.posts.set(key, post);
  return post;
}

// The lexicographic minimum of (road exposure, out of sight of the ground, candidate order) over the hides.
function pickHide(world: World, map: PostMap, ground: Vec): Vec | null {
  let best: Vec | null = null;
  let bestRank: [number, number] = [Infinity, Infinity];
  for (const p of candidates(ground)) {
    if (!qualifiesAsHide(world, map, p)) continue;
    const seen = exposure(world, map, p, bestRank[0]);
    if (seen > bestRank[0]) continue;
    const blind = seesGround(world, p, ground) ? 0 : 1;
    if (seen === bestRank[0] && blind >= bestRank[1]) continue;
    best = p;
    bestRank = [seen, blind];
    if (seen === 0 && blind === 0) break;
  }
  return best;
}

export function hidesOf(world: World, ground: Vec): Vec[] {
  const map = postMap(world);
  return candidates(ground).filter((p) => qualifiesAsHide(world, map, p));
}

function roadSamplesOf(): RoadSamples {
  const out: RoadSamples = new Map();
  const add = (p: Vec): void => {
    const key = cellKey(Math.floor(p.x / INDEX_CELL), Math.floor(p.y / INDEX_CELL));
    const cell = out.get(key);
    if (cell) cell.push(p);
    else out.set(key, [p]);
  };
  for (const road of REGION.roads) {
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const steps = Math.max(1, Math.ceil(dist(a, b) / HUNT.roadSample));
      for (let k = 0; k < steps; k++) add({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    }
    add(road[road.length - 1]);
  }
  return out;
}

function cellKey(cx: number, cy: number): number {
  return (cy + 1000) * 4096 + cx + 1000;
}

// How many road sample points within day sight the spot has a line of sight to. It stops counting past `limit`, since
// a spot with more exposure than the best so far cannot win.
function exposure(world: World, map: PostMap, p: Vec, limit = Infinity): number {
  const reach = TERRAIN.vision.radius;
  let seen = 0;
  for (let cy = Math.floor((p.y - reach) / INDEX_CELL); cy <= Math.floor((p.y + reach) / INDEX_CELL); cy++) {
    for (let cx = Math.floor((p.x - reach) / INDEX_CELL); cx <= Math.floor((p.x + reach) / INDEX_CELL); cx++) {
      for (const sample of map.roadSamples.get(cellKey(cx, cy)) ?? []) {
        if (dist(p, sample) <= reach && sees(world, p, sample) && ++seen > limit) return seen;
      }
    }
  }
  return seen;
}

export function exposureAt(world: World, p: Vec): number {
  return exposure(world, postMap(world), p);
}

export function postsOf(world: World, key: string, grounds: readonly Vec[]): readonly Vec[] {
  const map = postMap(world);
  const cached = map.lists.get(key);
  if (cached) return cached;
  const out = postsOfGrounds(world, grounds);
  map.lists.set(key, out);
  return out;
}

function postsOfGrounds(world: World, grounds: readonly Vec[]): readonly Vec[] {
  const seen = new Set<string>();
  const out: Vec[] = [];
  for (const ground of grounds) {
    const post = watchPost(world, ground);
    if (!post || seen.has(`${post.x},${post.y}`)) continue;
    seen.add(`${post.x},${post.y}`);
    out.push(post);
  }
  return out;
}

function candidates(ground: Vec): Vec[] {
  const out = [ground];
  for (const r of HUNT.postRings) {
    for (let k = 0; k < HUNT.postBearings; k++) {
      const angle = (k / HUNT.postBearings) * Math.PI * 2;
      out.push({ x: ground.x + Math.cos(angle) * r, y: ground.y + Math.sin(angle) * r });
    }
  }
  return out;
}

function qualifiesAsHide(world: World, map: PostMap, p: Vec): boolean {
  return onMap(world, map, p) && clearOfRoads(p) && clearOfPlaces(map, p) && drivable(map, p);
}

function onMap(world: World, map: PostMap, p: Vec): boolean {
  return Math.min(p.x, p.y) >= map.reach && Math.max(p.x, p.y) <= world.size - map.reach;
}

function clearOfRoads(p: Vec): boolean {
  return ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth / 2 + HUNT.postRoadGap) === Infinity;
}

function clearOfPlaces(map: PostMap, p: Vec): boolean {
  if (siteUnder(icarusAtlas(), p) !== null) return false;
  return map.hazards.every((z) => dist(p, z.pos) > z.radius + map.reach) && map.gates.every((gate) => dist(gate, p) > HUNT.lawReach);
}

function drivable(map: PostMap, p: Vec): boolean {
  if (nearCliff(map.nav, p.x, p.y, map.reach) || cliffWithin(map.nav, p, map.reach)) return false;
  return !map.statics.buckets.alongSegment(p, p, map.reach).some((b) => blocks(b, p, map.reach));
}

function cliffWithin(nav: TerrainNav, p: Vec, reach: number): boolean {
  for (let y = Math.floor(p.y - reach); y <= Math.floor(p.y + reach); y++) {
    for (let x = Math.floor(p.x - reach); x <= Math.floor(p.x + reach); x++) {
      if (nav.cliffTile[tileIndex(nav.size, x, y)] === 1 && tileGap(p, x, y) < reach) return true;
    }
  }
  return false;
}

function tileGap(p: Vec, x: number, y: number): number {
  return Math.hypot(Math.max(x - p.x, 0, p.x - x - 1), Math.max(y - p.y, 0, p.y - y - 1));
}

function blocks(b: Blocker, p: Vec, reach: number): boolean {
  return b.prop !== undefined || dist(b.pos, p) < b.r + reach;
}

function seesGround(world: World, p: Vec, ground: Vec): boolean {
  return dist(p, ground) <= TERRAIN.vision.radius && sees(world, p, ground);
}

function sees(world: World, a: Vec, b: Vec): boolean {
  const line = sightLine(world.terrain, a, b);
  return clearOverTerrain(world.terrain, line) && hasLineOfSight(world.terrain, line, fixedSightProps(world, a, b), []);
}

function fixedSightProps(world: World, a: Vec, b: Vec): Obstacle[] {
  const standing = propsAlong(world, 'sight', a, b, 0).filter(isBakedObstacle);
  const broken = world.broken.map((x) => x.obstacle).filter((o) => segmentDist(o.pos, a, b) < propReach(o));
  return [...standing, ...broken];
}

export function isWatching(vehicle: Vehicle): boolean {
  const top = vehicle.brain?.goals.at(-1);
  return top?.kind === 'raid' && top.phase === 'act';
}

export function startWatch(world: World, goal: NpcActivity): void {
  if (goal.kind !== 'raid' || goal.phase !== 'travel') throw new Error(`A ${goal.kind} goal in its ${goal.phase} phase cannot start a watch`);
  goal.phase = 'act';
  goal.destination = null;
  goal.watchUntil = world.turn + HUNT.watchTurns;
}

export function watchOver(world: World, goal: NpcActivity): GoalReason | null {
  if (goal.watchUntil === undefined) return null;
  if (goal.kind !== 'raid' || goal.phase !== 'act') throw new Error(`A ${goal.kind} goal in its ${goal.phase} phase holds a watch end`);
  return world.turn >= goal.watchUntil ? 'watchedRoad' : null;
}
