// Route planning around static obstacles and cliffs: A* on a grid weighted by terrain speed and a
// cost for leaving the road, so routes prefer roads, then shortcut to visible corners. Moving vehicles are not in the
// grid, so ramming and blocking still happen. The grid itself lives in ./nav. An NPC driver weighs the cost by
// its own taste, so drivers between the same points take different ways.

import { REGION } from '../data/region';
import { crossesRail } from './bridge';
import { count, timed } from '../perf';
import { canStepOut, findCellsToward, nearestFreeCell, stampOverlay, startComponent, type Overlay } from './nav/astar';
import type { Blocker } from './nav/buckets';
import { CELL, CLEARANCE, blockerKey, componentOf, dynamicBlockers, navLayer, nearCliff, staticSet, tasted, tasteKey, tasteOf, terrainNav, tileIndex, type NavLayer, type StaticSet, type Taste, type TerrainNav } from './nav/layer';
import type { Vehicle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';

export type { Blocker };

// Recent A* results. 64 covers up to 20 vehicles times 3 preview turns, so a repeated preview or
// the turn after it finds every search done. Keys hold layer identity and exact blocker content.
const ROUTE_CACHE_MAX = 64;
const routeCache = new Map<string, { goal: number; cells: Int32Array }>();

// `driver` plans with its taste; without one the route is the plain cheapest. A goal beyond the map edge moves
// in to the nearest point a truck of this radius fits, since no truck may leave the map.
export function route(world: World, from: Vec, dest: Vec, radius: number, extra: Blocker[], driver?: Pick<Vehicle, "id" | "brain">): Vec[] {
  return timed('route', () => {
    const to = insideMap(world, dest, radius);
    const taste = tasteOf(world, driver);
    const nav = terrainNav(world.terrain);
    const statics = staticSet(world.obstacles, world.terrain);
    const dynamic = dynamicBlockers(world.obstacles, world.terrain, extra);
    const reach = radius + CLEARANCE;
    // An unobstructed line all on road is already the shortest, cheapest route, except for a driver that shuns roads.
    if (!taste?.offRoad && lineCost(nav, statics, dynamic, from, to, reach, 1, nav.tileCost, null) < Infinity) return [to];
    const layer = navLayer(world.terrain, world.obstacles, radius);
    const start = cellOf(layer, from);
    const target = cellOf(layer, to);
    const { goal, cells } = search(layer, dynamic, radius, start, target, taste);
    const end = goal === target ? to : centerOf(layer, goal);
    const points: Vec[] = [];
    for (let i = 1; i < cells.length - 1; i++) points.push(centerOf(layer, cells[i]));
    points.push(end);
    return shortcut(nav, statics, dynamic, from, points, reach, taste);
  });
}

function insideMap(world: World, p: Vec, radius: number): Vec {
  const hi = world.terrain.size - radius;
  return { x: Math.min(hi, Math.max(radius, p.x)), y: Math.min(hi, Math.max(radius, p.y)) };
}

// Builds the nav layers for these vehicle radii now, so the first turn or preview does not pay for them.
export function warmRoutes(world: World, radii: number[]): void {
  timed('warm-routes', () => {
    for (const r of radii) navLayer(world.terrain, world.obstacles, r);
  });
}

// Cached cells are shared between calls and never handed out, so callers cannot mutate them.
// The goal is the target cell, or the reachable cell closest to it when the target lies beyond a cliff or behind
// kill wrecks and parked vehicles.
function search(layer: NavLayer, dynamic: Blocker[], radius: number, start: number, target: number, taste: Taste | null): { goal: number; cells: Int32Array } {
  const key = `${layer.id}:${radius}:${start}:${target}:${tasteKey(taste)}:${blockerKey(dynamic)}`;
  const hit = routeCache.get(key);
  if (hit) {
    count('route-cache-hit');
    routeCache.delete(key);
    routeCache.set(key, hit);
    return hit;
  }
  const overlay = stampOverlay(layer, dynamic, radius);
  // A truck pushed into the clearance of an obstacle or another vehicle past its neighbouring cells first drives
  // out to a free cell. The start cell stays first, since route() drops it.
  const exit = canStepOut(layer, overlay, start) ? start : exitCell(layer, overlay, start, target, radius);
  // An unreachable point, such as one beyond a cliff, routes to the closest point the truck can reach.
  const near = nearestFreeCell(layer, overlay, target, startComponent(layer, exit));
  if (near === null) throw new Error(`No free cell joined to cell ${exit} for a route to cell ${target}`);
  const found = findCellsToward(layer, overlay, exit, near, taste);
  if (!found) throw new Error(`Cells ${exit} and ${near} share a component but have no route`);
  const result = { goal: found[found.length - 1], cells: exit !== start ? Int32Array.of(start, ...found) : found };
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value!);
  routeCache.set(key, result);
  return result;
}

// The free cell a truck on blocked ground drives out to. A truck pushed against an obstacle lies at most its
// radius plus CLEARANCE inside blocked cells, and one more cell covers the grid rounding. Within that ring, a cell
// joined to the target's side wins over a closer one in a closed pocket. A truck deeper in, such as one on steep
// ground, drives out to the nearest free cell.
function exitCell(layer: NavLayer, overlay: Overlay, start: number, target: number, radius: number): number {
  const ring = Math.ceil((radius + CLEARANCE) / CELL) + 1;
  const targetSide = nearestFreeCell(layer, overlay, target);
  const toward = targetSide === null ? null : nearestFreeCell(layer, overlay, start, componentOf(layer, targetSide), ring);
  const exit = toward ?? nearestFreeCell(layer, overlay, start);
  if (exit === null) throw new Error(`Route starts at cell ${start} on a map with no free cell`);
  return exit;
}

// Whether a vehicle can drive straight from a to b without touching an obstacle or a cliff.
export function straightClear(world: World, a: Vec, b: Vec, radius: number, extra: Blocker[]): boolean {
  const statics = staticSet(world.obstacles, world.terrain);
  const nav = terrainNav(world.terrain);
  return lineCost(nav, statics, dynamicBlockers(world.obstacles, world.terrain, extra), a, b, radius + CLEARANCE, Infinity, nav.tileCost, null) < Infinity;
}

// A route kept from an earlier turn: its point, its waypoints, and the keys of the blockers that
// change during play which it was planned around.
export type KeptRoute = { dest: Vec; points: Vec[]; blockers: string[] };

export function keepRoute(world: World, dest: Vec, points: Vec[], extra: Blocker[]): KeptRoute {
  return { dest: { ...dest }, points, blockers: dynamicBlockers(world.obstacles, world.terrain, extra).map((o) => blockerKey([o])) };
}

// The rest of a kept route toward nearly the same point, or null when it no longer holds. Points the
// vehicle has driven past drop off first. A route that ended on its old point now ends on `to`; one
// that ended at the closest reachable spot keeps it. The leg from the vehicle and a moved last leg must
// be clear lines over ground no costlier than either end, as for a shortcut. The vehicle may already
// drive inside the CLEARANCE margin, which only absorbs steering bulge, so these legs must just not
// touch. A road or kill wreck or parked vehicle the route was not planned around must keep full clearance
// from every leg. Static obstacles, cliffs and the known blockers are as the planner checked them.
export function continueRoute(world: World, from: Vec, kept: KeptRoute, to: Vec, radius: number, extra: Blocker[], driver?: Pick<Vehicle, "id" | "brain">): Vec[] | null {
  return timed('route-continue', () => continueKept(world, from, kept, to, radius, extra, driver));
}

function continueKept(world: World, from: Vec, kept: KeptRoute, to: Vec, radius: number, extra: Blocker[], driver: Pick<Vehicle, "id" | "brain"> | undefined): Vec[] | null {
  const c = legCheck(world, kept, radius, extra);
  const { rest, moved } = remainingPoints(from, kept, to);
  if (lastBrokenLeg(c, from, rest, moved) >= 0) return null;
  // Shortcuts from the new position, as a fresh plan takes them, so the truck does not hold to a corner
  // chosen from where it was a turn ago.
  return straightenAhead(c.nav, c.statics, c.dynamic, from, rest, c.reach, tasteOf(world, driver));
}

// What the legs of a kept route are checked against. `fresh` holds the dynamic blockers the route was
// not planned around.
type LegCheck = { nav: TerrainNav; statics: StaticSet; dynamic: Blocker[]; fresh: Blocker[]; radius: number; reach: number };

function legCheck(world: World, kept: KeptRoute, radius: number, extra: Blocker[]): LegCheck {
  const dynamic = dynamicBlockers(world.obstacles, world.terrain, extra);
  const known = new Set(kept.blockers);
  const fresh = dynamic.filter((o) => !known.has(blockerKey([o])));
  return { nav: terrainNav(world.terrain), statics: staticSet(world.obstacles, world.terrain), dynamic, fresh, radius, reach: radius + CLEARANCE };
}

// The kept points still ahead of the vehicle. A route that ended on its old point now ends on `to`,
// and `moved` tells so.
function remainingPoints(from: Vec, kept: KeptRoute, to: Vec): { rest: Vec[]; moved: boolean } {
  const points = kept.points;
  let k = 0;
  while (k < points.length - 1 && passed(from, points[k], points[k + 1])) k++;
  const moved = endMoved(kept, to);
  return { rest: moved ? [...points.slice(k, -1), to] : points.slice(k), moved };
}

// Whether the route ended on its old point and that point moved to `to`. A route that ended at the
// closest reachable spot keeps its end.
function endMoved(kept: KeptRoute, to: Vec): boolean {
  const last = kept.points[kept.points.length - 1];
  return last.x === kept.dest.x && last.y === kept.dest.y && (last.x !== to.x || last.y !== to.y);
}

// Index into `rest` of the end point of the last leg that no longer holds, or -1 when all hold. Leg i
// runs from the previous point, or from the vehicle for i = 0, to rest[i].
function lastBrokenLeg(c: LegCheck, from: Vec, rest: Vec[], moved: boolean): number {
  const touches = (a: Vec, b: Vec) => lineCost(c.nav, c.statics, c.dynamic, a, b, c.radius, costliestFlat(c.nav, a, [b], 0, 0), c.nav.flatCost, null) === Infinity;
  let broken = lastFreshHit(c, from, rest);
  if (moved && rest.length > 1 && touches(rest[rest.length - 2], rest[rest.length - 1])) broken = rest.length - 1;
  if (broken < 0 && touches(from, rest[0])) broken = 0;
  return broken;
}

// Index of the last leg that passes within clearance of a fresh blocker, or -1.
function lastFreshHit(c: LegCheck, from: Vec, rest: Vec[]): number {
  for (let i = rest.length - 1; i >= 0; i--) {
    const a = i === 0 ? from : rest[i - 1];
    if (c.fresh.some((o) => segmentDist(o.pos, a, rest[i]) < o.r + c.reach)) return i;
  }
  return -1;
}

// Shortcuts over the points up to the first one past REGION.navigation.lookahead tiles along the route.
// Later points stay as planned, so reuse costs the same on a long trip as on a short one.
function straightenAhead(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], from: Vec, points: Vec[], reach: number, taste: Taste | null): Vec[] {
  let end = 0;
  for (let length = dist(from, points[0]); end < points.length - 1 && length <= REGION.navigation.lookahead; end++) length += dist(points[end], points[end + 1]);
  return [...shortcut(nav, statics, dynamic, from, points.slice(0, end + 1), reach, taste), ...points.slice(end + 1)];
}

// Whether at is beyond point a along the leg from a to b.
function passed(at: Vec, a: Vec, b: Vec): boolean {
  return (at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y) > 0;
}

export function routeLength(from: Vec, points: Vec[]): number {
  let total = 0;
  let prev = from;
  for (const p of points) {
    total += dist(prev, p);
    prev = p;
  }
  return total;
}

function cellOf(l: NavLayer, p: Vec): number {
  const x = Math.min(l.n - 1, Math.max(0, Math.floor(p.x / CELL)));
  const y = Math.min(l.n - 1, Math.max(0, Math.floor(p.y / CELL)));
  return y * l.n + x;
}

function centerOf(l: NavLayer, c: number): Vec {
  return { x: ((c % l.n) + 0.5) * CELL, y: (Math.floor(c / l.n) + 0.5) * CELL };
}

// Probe progressively longer shortcuts instead of rescanning the entire remaining route at every bend.
// Each accepted segment still avoids obstacles, cliffs and costlier flat ground than its original path,
// and costs at most `straighten` more than the path it replaces, slope counted, so a shortcut never
// trades the road for open ground or goes over a hill the path avoided. Costs include the taste, so a
// shortcut keeps the way the driver chose.
function shortcut(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], from: Vec, points: Vec[], reach: number, taste: Taste | null): Vec[] {
  // along[j] is the route cost from `from` to points[j - 1]; along[0] is `from` itself.
  const along = new Float64Array(points.length + 1);
  for (let j = 0; j < points.length; j++) along[j + 1] = along[j] + groundCost(nav, j === 0 ? from : points[j - 1], points[j], null, Infinity, nav.tileCost, taste);
  const out: Vec[] = [];
  let cur = from;
  let i = 0;
  const fits = (candidate: number) => lineCost(nav, statics, dynamic, cur, points[candidate], reach, costliestFlat(nav, cur, points, i, candidate), nav.flatCost, taste) <= (along[candidate + 1] - along[i]) * (1 + REGION.navigation.straighten + COST_ROUNDING);
  while (i < points.length) {
    let best = i;
    let step = 1;
    let failed = points.length;
    while (best < points.length - 1) {
      const candidate = Math.min(i + step, points.length - 1);
      if (!fits(candidate)) {
        failed = candidate;
        break;
      }
      best = candidate;
      step *= 2;
    }
    while (failed - best > 1) {
      const candidate = Math.floor((best + failed) / 2);
      if (fits(candidate)) best = candidate;
      else failed = candidate;
    }
    out.push(points[best]);
    cur = points[best];
    i = best + 1;
  }
  return out;
}

const LINE_SAMPLES_PER_TILE = 4;
// Relative slack when a shortcut's cost is compared with the path it replaces. Summing the same
// segments in another order differs in the last bits, and a straight run must still count as equal.
const COST_ROUNDING = 1e-9;

// Costliest flat tile cost under cur and points[i..last].
function costliestFlat(nav: TerrainNav, cur: Vec, points: Vec[], i: number, last: number): number {
  let max = nav.flatCost[tileIndex(nav.size, cur.x, cur.y)];
  for (let k = i; k <= last; k++) max = Math.max(max, nav.flatCost[tileIndex(nav.size, points[k].x, points[k].y)]);
  return max;
}

// Route cost of the straight line from a to b, or Infinity when it touches an obstacle or a cliff or
// crosses a tile whose `capCost` is above maxCost.
function lineCost(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], a: Vec, b: Vec, reach: number, maxCost: number, capCost: Float64Array, taste: Taste | null): number {
  for (const o of dynamic) if (segmentDist(o.pos, a, b) < o.r + reach) return Infinity;
  if (crossesRail(a, b, reach)) return Infinity;
  for (const o of statics.buckets.alongSegment(a, b, reach)) if (segmentDist(o.pos, a, b) < o.r + reach) return Infinity;
  return groundCost(nav, a, b, reach, maxCost, capCost, taste);
}

// Length of the line times the mean tile cost of its samples. With a reach, a sample near a cliff
// makes it Infinity; so does a tile whose capCost entry is above maxCost. The sum always reads the full tile cost, with taste.
function groundCost(nav: TerrainNav, a: Vec, b: Vec, reach: number | null, maxCost: number, capCost: Float64Array, taste: Taste | null): number {
  const length = dist(a, b);
  const n = Math.ceil(length * LINE_SAMPLES_PER_TILE);
  const steps = Math.max(1, n);
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k) / steps;
    const y = a.y + ((b.y - a.y) * k) / steps;
    if (reach !== null && nearCliff(nav, x, y, reach)) return Infinity;
    const tile = tileIndex(nav.size, x, y);
    if (capCost[tile] > maxCost) return Infinity;
    const cost = nav.tileCost[tile];
    sum += tasted(taste, cost, x, y);
  }
  return (length * sum) / (n + 1);
}
