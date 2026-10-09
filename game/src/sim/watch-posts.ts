// Watch posts and the watch. A raid ends at a post beside its hunting ground: off the road, outside sites, hazards and
// lawman reach, clear for any raider's truck and in sight of the ground. There the raider watches HUNT.watchTurns
// turns, parked and silent, for prey that comes into sight. Posts are pure geometry over the terrain and the map's

import { chassisDef } from '../data/chassis';
import { HUNT, NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { isBakedObstacle, propReach } from './mapgen';
import { CELL, CLEARANCE, nearCliff, staticSet, terrainNav, tileIndex, type StaticSet, type TerrainNav } from './nav/layer';
import type { Blocker } from './nav/buckets';
import { lawmanTowns } from './npc-decisions';
import { propsAlong } from './prop-index';
import { ROAD_INDEX } from './road-index';
import { siteGates, siteUnder } from './sites';
import type { Terrain } from './terrain';
import { hazardZones, type HazardZone } from './territory';
import type { NpcActivity, Obstacle, Vehicle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';
import { clearOverTerrain, hasLineOfSight, sightLine } from './vision';

function postReach(): number {
  const radii = Object.values(NPCS).filter((t) => t.traits.includes('raider')).flatMap((t) => t.loadout.chassis.map((c) => chassisDef(c.value).radius));
  return Math.max(...radii) + CLEARANCE + CELL;
}

type PostMap = { reach: number; nav: TerrainNav; statics: StaticSet; gates: Vec[]; hazards: HazardZone[]; posts: Map<string, Vec | null>; lists: Map<string, readonly Vec[]> };

const maps = new WeakMap<Terrain, PostMap>();

function postMap(world: World): PostMap {
  const hit = maps.get(world.terrain);
  if (hit) return hit;
  const map: PostMap = {
    reach: postReach(),
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
  const post = candidates(ground).find((p) => qualifies(world, map, p, ground)) ?? null;
  map.posts.set(key, post);
  return post;
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

function qualifies(world: World, map: PostMap, p: Vec, ground: Vec): boolean {
  return onMap(world, map, p) && clearOfRoads(p) && clearOfPlaces(map, p) && drivable(map, p) && seesGround(world, p, ground);
}

function onMap(world: World, map: PostMap, p: Vec): boolean {
  return Math.min(p.x, p.y) >= map.reach && Math.max(p.x, p.y) <= world.size - map.reach;
}

function clearOfRoads(p: Vec): boolean {
  return ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth / 2 + HUNT.postRoadGap) === Infinity;
}

function clearOfPlaces(map: PostMap, p: Vec): boolean {
  if (siteUnder(p) !== null) return false;
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
  if (dist(p, ground) > TERRAIN.vision.radius) return false;
  const line = sightLine(world.terrain, p, ground);
  return clearOverTerrain(world.terrain, line) && hasLineOfSight(world.terrain, line, fixedSightProps(world, p, ground), []);
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

export function watchOver(world: World, goal: NpcActivity): string | null {
  if (goal.watchUntil === undefined) return null;
  if (goal.kind !== 'raid' || goal.phase !== 'act') throw new Error(`A ${goal.kind} goal in its ${goal.phase} phase holds a watch end`);
  return world.turn >= goal.watchUntil ? 'watched the road' : null;
}
