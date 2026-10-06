// Travel for vehicles far from the player. They have no physics body: each turn they follow their
// stored route at the speed the physics driver would plan and burn fuel for the distance, like the physics turn. They never
// crash, but they cannot drive into another vehicle: a truck in the way stops them just short of it. A breakable prop
// on the way breaks.

import { chassisDef } from '../data/chassis';
import { PERF } from '../data/perf';
import { RULES } from '../data/rules';
import { TERRAIN } from '../data/terrain';
import { playerVehicle } from './damage';
import { boxSegmentDistance, isBreakable, propBoxes, propReach } from './mapgen';
import { route } from './path';
import { breakProp } from './salvage';
import { burnFuel, getResources } from './resources';
import { fuelCap, vehicleStats, type VehicleStats } from './stats';
import { parkedVehicles, throughSpeed } from './steering';
import { isOnRope } from './tow';
import type { MoveOrder, Obstacle, Pose, Vehicle, World } from './types';
import { bearing, dist, segmentDist, type Vec } from './vec';

// The player, and every vehicle within sight radius plus the live margin of the player, drives in physics.
// A towed truck has no body: it follows its tower through followTower instead.
export function isNear(w: World, v: Vehicle): boolean {
  if (isOnRope(w, v.id)) return false;
  if (v.id === w.player.vehicleId) return true;
  return dist(v.pos, playerVehicle(w).pos) <= TERRAIN.vision.radius + PERF.liveMargin;
}

// Why the tank limits the truck now: 'low' halves top speed, 'empty' leaves a crawl. Null when it limits nothing.
export function fuelLimit(w: World, v: Vehicle, s: VehicleStats): 'low' | 'empty' | null {
  if (s.fuelPerTile <= 0) return null;
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
  const low = fuelLimit(w, v, s) === 'low';
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
  // Vehicles without a brain have nowhere to store the route, so they plan it every turn.
  const stored = v.brain?.farRoute;
  // A new route steers around parked vehicles, like the physics driver's.
  const points = stored && stored.dest.x === order.dest.x && stored.dest.y === order.dest.y ? stored.points : route(w, v.pos, order.dest, full.radius, parkedVehicles(w, v.id), v);

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
  v.speed = block || (done && order.kind === 'stopAt') ? 0 : next;
  burnFuel(w, v, walk.moved);
  breakCrossed(w, v, walk.path, full.radius);
  // A blocked truck drops its route, so next turn it plans one around the vehicles now parked.
  if (v.brain) v.brain.farRoute = done || block ? undefined : { dest: { ...order.dest }, points: walk.ahead };
  if (done) {
    w.events.push({ t: 'arrived', vehicle: v.id });
    v.order = null;
  }
}

const CONTACT_STEP = 0.25; // tiles between overlap checks along a far walk, below the smallest vehicle radius

// The first vehicle the walk would drive into, and how far the walk stays clear of it. Moving away from a
// vehicle already overlapped is allowed, so two trucks that start on top of each other can separate.
function firstContact(w: World, v: Vehicle, path: Vec[], radius: number): { other: Vehicle; clear: number; contact: number } | null {
  const others = w.vehicles.filter((o) => o.id !== v.id).map((o) => ({ o, contact: radius + chassisDef(o.chassisId).radius }));
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
  const crossed = w.obstacles.filter((o) => isBreakable(o) && path.some((p, seg) => seg > 0 && touches(o, path[seg - 1], p, radius)));
  for (const o of crossed) breakProp(w, o.id, v.id);
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
