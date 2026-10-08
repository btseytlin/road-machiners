// Watch posts and the watch. A raid ends at a post beside its hunting ground: off the road, outside sites, hazards and
// lawman reach, clear for any raider's truck and in sight of the ground. There the raider watches HUNT.watchTurns
// turns, parked and silent, for prey that comes into sight. Posts are pure geometry over the terrain and the map's
// fixed props, built once per terrain and cached by its identity, so a map always gives the same posts and no random
// draw is spent on them. Transient wrecks come and go, so posts ignore them.

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

// The largest chassis any raider template rolls plus the route clearance, so every raider's truck fits on every post.
// One more grid cell covers the rounding of the route grid, so the cell under the post stays free too. It is worked
// out with the first post map, not at load: this module sits in an import cycle with the nav layer, which the turn
// worker may load first.
function postReach(): number {
  const radii = Object.values(NPCS).filter((t) => t.traits.includes('raider')).flatMap((t) => t.loadout.chassis.map((c) => chassisDef(c.value).radius));
  return Math.max(...radii) + CLEARANCE + CELL;
}

// What every post on one terrain is checked against, and each ground's post, keyed by the ground's coordinates.
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

// The props fixed at map generation, standing or broken, and the site edges. A broken prop grows back, so it counts.
function fixedProps(world: World): Obstacle[] {
  return [...world.obstacles.filter((o) => isBakedObstacle(o) || o.kind === 'site'), ...world.broken.map((b) => b.obstacle)];
}

// The ground itself when it qualifies as a post, else the first point on HUNT.postRings at HUNT.postBearings bearings
// that does. Null when none does.
export function watchPost(world: World, ground: Vec): Vec | null {
  const map = postMap(world);
  const key = `${ground.x},${ground.y}`;
  const cached = map.posts.get(key);
  if (cached !== undefined) return cached;
  const post = candidates(ground).find((p) => qualifies(world, map, p, ground)) ?? null;
  map.posts.set(key, post);
  return post;
}

// The posts of a list of grounds, each once, in ground order. A ground with no post gives none. The list is built
// once per key and terrain, since decisions ask for it every turn.
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

// At least HUNT.postRoadGap from the edge of every road.
function clearOfRoads(p: Vec): boolean {
  return ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth / 2 + HUNT.postRoadGap) === Infinity;
}

// Outside every site, hazard zone and lawman reach.
function clearOfPlaces(map: PostMap, p: Vec): boolean {
  if (siteUnder(p) !== null) return false;
  return map.hazards.every((z) => dist(p, z.pos) > z.radius + map.reach) && map.gates.every((gate) => dist(gate, p) > HUNT.lawReach);
}

// No cliff and no fixed drive obstacle within reach of the largest raider truck.
function drivable(map: PostMap, p: Vec): boolean {
  if (nearCliff(map.nav, p.x, p.y, map.reach) || cliffWithin(map.nav, p, map.reach)) return false;
  return !map.statics.buckets.alongSegment(p, p, map.reach).some((b) => blocks(b, p, map.reach));
}

// nearCliff() samples five points. A post checks every cliff tile whose square comes within reach.
function cliffWithin(nav: TerrainNav, p: Vec, reach: number): boolean {
  for (let y = Math.floor(p.y - reach); y <= Math.floor(p.y + reach); y++) {
    for (let x = Math.floor(p.x - reach); x <= Math.floor(p.x + reach); x++) {
      if (nav.cliffTile[tileIndex(nav.size, x, y)] === 1 && tileGap(p, x, y) < reach) return true;
    }
  }
  return false;
}

// Distance from p to the square of tile (x, y).
function tileGap(p: Vec, x: number, y: number): number {
  return Math.hypot(Math.max(x - p.x, 0, p.x - x - 1), Math.max(y - p.y, 0, p.y - y - 1));
}

// The bucket query keeps only props with a box within reach. A circle, a site edge or a hazard, needs its own test.
function blocks(b: Blocker, p: Vec, reach: number): boolean {
  return b.prop !== undefined || dist(b.pos, p) < b.r + reach;
}

// Within the base sight radius, over the hills and past the fixed props between.
function seesGround(world: World, p: Vec, ground: Vec): boolean {
  if (dist(p, ground) > TERRAIN.vision.radius) return false;
  const line = sightLine(world.terrain, p, ground);
  return clearOverTerrain(world.terrain, line) && hasLineOfSight(world.terrain, line, fixedSightProps(world, p, ground), []);
}

// The fixed props that may hide b from a: the standing ones from the sight index and the broken ones near the line.
function fixedSightProps(world: World, a: Vec, b: Vec): Obstacle[] {
  const standing = propsAlong(world, 'sight', a, b, 0).filter(isBakedObstacle);
  const broken = world.broken.map((x) => x.obstacle).filter((o) => segmentDist(o.pos, a, b) < propReach(o));
  return [...standing, ...broken];
}

// ---- The watch.

// Whether the driver watches from its post: a raid on top in its act phase.
export function isWatching(vehicle: Vehicle): boolean {
  const top = vehicle.brain?.goals.at(-1);
  return top?.kind === 'raid' && top.phase === 'act';
}

// A raid that reached its post parks there and watches until HUNT.watchTurns turns have passed.
export function startWatch(world: World, goal: NpcActivity): void {
  if (goal.kind !== 'raid' || goal.phase !== 'travel') throw new Error(`A ${goal.kind} goal in its ${goal.phase} phase cannot start a watch`);
  goal.phase = 'act';
  goal.destination = null;
  goal.watchUntil = world.turn + HUNT.watchTurns;
}

// Why a goal's watch is over, or null. Only a raid in its act phase holds a watch end. The watch may run out under
// an interruption, and the raid then ends once it is on top again, with no drive back.
export function watchOver(world: World, goal: NpcActivity): string | null {
  if (goal.watchUntil === undefined) return null;
  if (goal.kind !== 'raid' || goal.phase !== 'act') throw new Error(`A ${goal.kind} goal in its ${goal.phase} phase holds a watch end`);
  return world.turn >= goal.watchUntil ? 'watched the road' : null;
}
