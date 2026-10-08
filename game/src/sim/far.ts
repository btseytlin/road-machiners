// Travel for vehicles far from the player. They have no physics body: each turn they follow their
// stored route at the speed the physics driver would plan and burn fuel for the distance, like the physics turn. They never
// crash, but they cannot drive into another vehicle: a truck in the way stops them just short of it. A breakable prop

import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';
import { inLiveRange, isHeadless } from './fidelity';
import { boxSegmentDistance, propBoxes, propReach } from './mapgen';
import { keepsOffRoads } from './off-road';
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

export function isNear(w: World, v: Vehicle): boolean {
  if (isOnRope(w, v.id)) return false;
  return inLiveRange(w, v.pos);
}

export function fuelLimit(w: World, v: Vehicle, burnsFuel: boolean): 'low' | 'empty' | null {
  if (!burnsFuel) return null;
  const fuel = getResources(w, v).fuel;
  if (fuel <= 0) return 'empty';
  return fuel < fuelCap(v) * RULES.lowFuelThreshold ? 'low' : null;
}

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
  const offRoad = keepsOffRoads(w, v);
  const points = farPoints(w, v, order.dest, offRoad, full, s);

  const planned = follow(v.pos, points, (v.speed + next) / 2);
  const block = firstContact(w, v, planned.path, full.radius);
  const walk = block ? follow(v.pos, points, block.clear) : planned;
  const end = walk.path[walk.path.length - 1];
  const reach = order.kind === 'stopAt' ? RULES.arriveRadius : RULES.passRadius;
  const routeEnd = walk.ahead.length === 0;
  const done = dist(end, order.dest) < reach || routeEnd || (block !== null && dist(block.other.pos, order.dest) < block.contact + reach);
  v.trail = sample(start, walk.path, walk.moved);
  v.pos = { x: end.x, y: end.y };
  v.heading = v.trail[v.trail.length - 1].heading;
  v.speed = done && order.kind === 'stopAt' ? 0 : block ? Math.min(next, block.other.speed) : next;
  burnFuel(w, v, walk.moved);
  breakCrossed(w, v, walk.path, full.radius);
  keepFarRoute(v, done || block ? undefined : { dest: { ...order.dest }, points: walk.ahead, offRoad });
  if (done) {
    w.events.push({ t: 'arrived', vehicle: v.id });
    v.order = null;
  }
}

function farPoints(w: World, v: Vehicle, dest: Vec, offRoad: boolean, full: VehicleStats, s: VehicleStats): Vec[] {
  const stored = keptFarRoute(v);
  if (stored && stored.dest.x === dest.x && stored.dest.y === dest.y && keptOffRoad(stored) === offRoad) return stored.points;
  return route(w, v.pos, dest, full.radius, farBlockers(w, v, s), v);
}

function farBlockers(w: World, v: Vehicle, s: VehicleStats): Blocker[] {
  const target = v.brain?.ramTarget;
  const reach = s.maxSpeed + radiusOf(v);
  const slower = w.vehicles.filter((o) => o.id !== v.id && o.id !== target && o.speed >= RULES.parkedSpeed && o.speed < s.maxSpeed && dist(o.pos, v.pos) <= reach + radiusOf(o));
  return [...parkedVehicles(w, v.id), ...slower.map((o) => ({ pos: o.pos, r: radiusOf(o) }))];
}

function radiusOf(v: Vehicle): number {
  return chassisDef(v.chassisId).radius;
}

type FarRoute = { dest: Vec; points: Vec[]; offRoad: boolean };
const playerRoutes = new Map<string, { route: FarRoute; at: Vec }>();

export function clearFarRoutes(): void {
  playerRoutes.clear();
}

function keptOffRoad(stored: FarRoute): boolean {
  if (typeof stored.offRoad !== 'boolean') throw new Error('A far route has no offRoad flag');
  return stored.offRoad;
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

const CONTACT_STEP = 0.25;

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
      if (d < len && d + CONTACT_STEP > len) d = len - CONTACT_STEP;
    }
    walked += len;
  }
  return null;
}

function breakCrossed(w: World, v: Vehicle, path: Vec[], radius: number): void {
  const crossed = new Set<number>();
  for (let seg = 1; seg < path.length; seg++) {
    for (const at of propSlotsAlong(w, 'breakable', path[seg - 1], path[seg], radius)) {
      if (touches(w.obstacles[at], path[seg - 1], path[seg], radius)) crossed.add(at);
    }
  }
  const ids = [...crossed].sort((a, b) => a - b).map((at) => w.obstacles[at].id);
  for (const id of ids) breakProp(w, id, v.id);
}

function touches(o: Obstacle, a: Vec, b: Vec, radius: number): boolean {
  return segmentDist(o.pos, a, b) < propReach(o) + radius && propBoxes(o).some((box) => boxSegmentDistance(box, a, b) < radius);
}

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

function sample(start: Pose, path: Vec[], moved: number): Pose[] {
  const trail: Pose[] = [start];
  let seg = 1;
  let walked = 0;
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
