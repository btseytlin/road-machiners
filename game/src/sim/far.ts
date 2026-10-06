// Travel for vehicles far from the player. They have no physics body: each turn they follow their
// stored route at the speed the physics driver would plan and burn fuel for the distance, like the physics turn. They never
// crash, but they cannot drive into another vehicle: a truck in the way holds them just short of it at its speed, and
// the next route goes around it. A breakable prop on the way breaks.

import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';
import { inLiveRange, isHeadless } from './fidelity';
import { boxSegmentDistance, propBoxes, propReach } from './mapgen';
import { route } from './path';
import { propSlotsAlong } from './prop-index';
import { breakProp } from './salvage';
import { burnFuel, getResources } from './resources';
import { fuelCap, vehicleStats, type VehicleStats } from './stats';
import { parkedVehicles, throughSpeed } from './steering';
import { isOnRope, ropeClientOf } from './tow';
import type { Blocker } from './nav/buckets';
import type { MoveOrder, Obstacle, Pose, Vehicle, World } from './types';
import { bearing, dist, segmentDist, type Vec } from './vec';

// The player, and every vehicle within sight radius plus the live margin of the player, drives in physics.
// A towed truck has no body: it follows its tower through followTower instead.
export function isNear(w: World, v: Vehicle): boolean {
  if (isOnRope(w, v.id)) return false;
  return inLiveRange(w, v.pos);
}

// Why the tank limits the truck now: 'low' halves top speed, 'empty' leaves a crawl. Null when it limits nothing.
export function fuelLimit(w: World, v: Vehicle, burnsFuel: boolean): 'low' | 'empty' | null {
  if (!burnsFuel) return null;
  const fuel = getResources(w, v).fuel;
  if (fuel <= 0) return 'empty';
  return fuel < fuelCap(v) * RULES.lowFuelThreshold ? 'low' : null;
}

// Fuel limits the engine like the 2D rules: under the low-fuel share of the tank the top
// speed halves, and a tank that cannot cover this turn's drive still lets the truck crawl.
// A pushed truck burns no fuel, so its tank limits nothing.
// Shared by the physics driver and far travel, so both plan the same speed.
export function fuelLimited(w: World, v: Vehicle, s: VehicleStats, speed: number, order: MoveOrder | null): VehicleStats {
  const fuel = getResources(w, v).fuel;
  const low = fuelLimit(w, v, s.fuelPerTile > 0) === 'low';
  const limit = low ? Math.max(s.maxSpeed * RULES.lowFuelSpeedFactor, speed - s.brake) : s.maxSpeed;
  const capped = low ? { ...s, maxSpeed: limit } : s;
  const wanted = order?.kind === 'through' ? throughSpeed(capped, speed, dist(v.pos, order.dest), order.pace) : Math.min(capped.maxSpeed, speed + capped.accel);
  if (wanted * s.fuelPerTile <= fuel) return capped;
  const cap = Math.max(s.limpSpeed, speed - s.brake);
  return { ...s, maxSpeed: cap, accel: Math.min(s.accel, s.limpAccel) };
}

// One turn of far travel. With no order or a brake order the vehicle slows by its brake and stays
// in place: without physics it cannot coast into obstacles, so it does not coast at all.
// A move order follows the stored route for the order's point, or plans a new one. The distance
// is the mean of the start and end speeds, as under steady acceleration. A stop order ends at rest
// on its point; a drive-through order keeps its speed.
export function advanceFar(w: World, v: Vehicle): void {
  const full = vehicleStats(w, v);
  const start: Pose = { x: v.pos.x, y: v.pos.y, heading: v.heading };
  const order = v.order;
  if (!order || order.kind === 'brake') {
    v.speed = Math.max(0, v.speed - full.brake);
    v.trail = Array.from({ length: RULES.substeps + 1 }, () => ({ ...start }));
    if (order && v.speed === 0) v.order = null;
    return;
  }

  const s = fuelLimited(w, v, full, v.speed, order);
  const next = order.kind === 'through' ? throughSpeed(s, v.speed, dist(v.pos, order.dest), order.pace) : Math.min(s.maxSpeed, v.speed + s.accel);
  const stored = keptFarRoute(v);
  // A new route steers around parked vehicles, like the physics driver's, and around slower ones it could reach.
  const points = stored && stored.dest.x === order.dest.x && stored.dest.y === order.dest.y ? stored.points : route(w, v.pos, order.dest, full.radius, farBlockers(w, v, s), v);

  const planned = follow(v.pos, points, (v.speed + next) / 2);
  const block = firstContact(w, v, planned.path, full.radius);
  const walk = block ? follow(v.pos, points, block.clear) : planned;
  const end = walk.path[walk.path.length - 1];
  const reach = order.kind === 'stopAt' ? RULES.arriveRadius : RULES.passRadius;
  // A truck on the destination leaves the closest free spot as the arrival: either the planner's
  // route ends there, or the walk stops against that truck.
  const routeEnd = walk.ahead.length === 0;
  const done = dist(end, order.dest) < reach || routeEnd || (block !== null && dist(block.other.pos, order.dest) < block.contact + reach);
  v.trail = sample(start, walk.path, walk.moved);
  v.pos = { x: end.x, y: end.y };
  v.heading = v.trail[v.trail.length - 1].heading;
  // A truck that catches up with another falls in behind it at its speed, and a stop order ends at rest.
  v.speed = done && order.kind === 'stopAt' ? 0 : block ? Math.min(next, block.other.speed) : next;
  burnFuel(w, v, walk.moved);
  breakCrossed(w, v, walk.path, full.radius);
  // A blocked truck drops its route, so next turn it plans one around the vehicles now parked.
  keepFarRoute(v, done || block ? undefined : { dest: { ...order.dest }, points: walk.ahead });
  if (done) {
    w.events.push({ t: 'arrived', vehicle: v.id });
    v.order = null;
  }
}

// The trucks a new far route steers around: parked ones, and moving ones slower than this truck's top speed within
// a turn's drive of it, so it overtakes them as a driver would instead of trailing them. A ram target stays a target.
function farBlockers(w: World, v: Vehicle, s: VehicleStats): Blocker[] {
  const target = v.brain?.ramTarget;
  const reach = s.maxSpeed + radiusOf(v);
  const slower = w.vehicles.filter((o) => o.id !== v.id && o.id !== target && o.speed >= RULES.parkedSpeed && o.speed < s.maxSpeed && dist(o.pos, v.pos) <= reach + radiusOf(o));
  return [...parkedVehicles(w, v.id), ...slower.map((o) => ({ pos: o.pos, r: radiusOf(o) }))];
}

function radiusOf(v: Vehicle): number {
  return chassisDef(v.chassisId).radius;
}

// A truck without a brain has nowhere to store its route, so in a game it plans every turn. The recorder's player is
// such a truck, and keeps its route here instead: the world is cloned each turn, so the route waits beside it, with
// the spot it ended on. A truck moved from that spot by anything else plans anew.
type FarRoute = { dest: Vec; points: Vec[] };
const playerRoutes = new Map<string, { route: FarRoute; at: Vec }>();

export function clearFarRoutes(): void {
  playerRoutes.clear();
}

function keptFarRoute(v: Vehicle): FarRoute | undefined {
  if (v.brain) return v.brain.farRoute;
  const kept = isHeadless() ? playerRoutes.get(v.id) : undefined;
  return kept && kept.at.x === v.pos.x && kept.at.y === v.pos.y ? kept.route : undefined;
}

function keepFarRoute(v: Vehicle, route: FarRoute | undefined): void {
  if (v.brain) v.brain.farRoute = route;
  else if (!isHeadless()) return;
  else if (route) playerRoutes.set(v.id, { route, at: { x: v.pos.x, y: v.pos.y } });
  else playerRoutes.delete(v.id);
}

const CONTACT_STEP = 0.25; // tiles between overlap checks along a far walk, below the smallest vehicle radius

// The first vehicle the walk would drive into, and how far the walk stays clear of it. Moving away from a
// vehicle already overlapped is allowed, so two trucks that start on top of each other can separate. The truck on
// the vehicle's own rope trails it and is never in its way.
function firstContact(w: World, v: Vehicle, path: Vec[], radius: number): { other: Vehicle; clear: number; contact: number } | null {
  const client = ropeClientOf(w, v.id);
  const others = w.vehicles.filter((o) => o.id !== v.id && o.id !== client).map((o) => ({ o, contact: radius + chassisDef(o.chassisId).radius }));
  let walked = 0;
  for (let seg = 1; seg < path.length; seg++) {
    const a = path[seg - 1];
    const b = path[seg];
    const len = dist(a, b);
    for (let d = Math.min(CONTACT_STEP, len); d <= len; d += CONTACT_STEP) {
      const t = len > 0 ? d / len : 0;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      for (const { o, contact } of others) {
        const gap = dist(p, o.pos);
        if (gap < contact && gap < dist(path[0], o.pos)) return { other: o, clear: Math.max(0, walked + d - CONTACT_STEP), contact };
      }
      if (d < len && d + CONTACT_STEP > len) d = len - CONTACT_STEP; // always check the segment's end
    }
    walked += len;
  }
  return null;
}

// Breaks every breakable prop the truck body touches along the walk.
function breakCrossed(w: World, v: Vehicle, path: Vec[], radius: number): void {
  const crossed = new Set<number>();
  for (let seg = 1; seg < path.length; seg++) {
    for (const at of propSlotsAlong(w, 'breakable', path[seg - 1], path[seg], radius)) {
      if (touches(w.obstacles[at], path[seg - 1], path[seg], radius)) crossed.add(at);
    }
  }
  // Props break in world order, so the events and growback queue match a scan of every obstacle.
  const ids = [...crossed].sort((a, b) => a - b).map((at) => w.obstacles[at].id);
  for (const id of ids) breakProp(w, id, v.id);
}

// Whether a truck of this radius driving from a to b touches the prop's boxes. The reach test skips far props cheaply.
function touches(o: Obstacle, a: Vec, b: Vec, radius: number): boolean {
  return segmentDist(o.pos, a, b) < propReach(o) + radius && propBoxes(o).some((box) => boxSegmentDistance(box, a, b) < radius);
}

// Walks up to `budget` tiles along the route. path starts at from and holds each corner passed and the end point.
function follow(from: Vec, points: Vec[], budget: number): { path: Vec[]; moved: number; ahead: Vec[] } {
  const path: Vec[] = [from];
  let cur = from;
  let left = budget;
  let i = 0;
  for (; i < points.length && left > 0; i++) {
    const seg = dist(cur, points[i]);
    if (seg > left) {
      const t = left / seg;
      cur = { x: cur.x + (points[i].x - cur.x) * t, y: cur.y + (points[i].y - cur.y) * t };
      path.push(cur);
      left = 0;
      break;
    }
    cur = points[i];
    path.push(cur);
    left -= seg;
  }
  return { path, moved: budget - left, ahead: points.slice(i) };
}

// RULES.substeps + 1 poses spread evenly by distance along the walked path, facing along it.
function sample(start: Pose, path: Vec[], moved: number): Pose[] {
  const trail: Pose[] = [start];
  let seg = 1;
  let walked = 0; // distance to the start of path[seg - 1]
  let heading = start.heading;
  for (let i = 1; i <= RULES.substeps; i++) {
    const at = (i * moved) / RULES.substeps;
    while (seg < path.length - 1 && walked + dist(path[seg - 1], path[seg]) < at) {
      walked += dist(path[seg - 1], path[seg]);
      seg++;
    }
    const a = path[seg - 1];
    const b = path[Math.min(seg, path.length - 1)];
    const len = dist(a, b);
    if (len > 0) heading = bearing(a, b);
    const t = len > 0 ? Math.min(1, (at - walked) / len) : 0;
    trail.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading });
  }
  return trail;
}
