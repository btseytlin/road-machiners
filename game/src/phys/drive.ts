// Physics driving for every vehicle. The map's terrain and obstacles become Rapier colliders; each
// vehicle is a ray-cast car. Time only moves inside simulateTurn. A turn restores the world from a
// snapshot and runs it forward, so the same state and orders always give the same result: the

import RAPIER from '@dimforge/rapier3d-compat';
import { chassisDef } from '../data/chassis';
import { PERF } from '../data/perf';
import { PHYSICS } from '../data/physics';
import { BREAKABLE, RULES } from '../data/rules';
import { fuelLimited, isNear } from '../sim/far';
import { isBreakable, isDriveObstacle, obstacleReach, propBoxes } from '../sim/mapgen';
import { playerVehicle } from '../sim/damage';
import { vehicleMass } from '../sim/mass';
import { groundSpeed, vehicleStats, type VehicleStats } from '../sim/stats';
import { continueRoute, keepRoute, route, type KeptRoute } from '../sim/path';
import { backsToDestination, throughSpeed } from '../sim/steering';
import { routeBlockers } from '../sim/ai';
import { BRIDGE_AXIS, BRIDGE_LENGTH } from '../sim/bridge';
import { deckEnds, heightAt, tileAt, type Terrain } from '../sim/terrain';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import type { MoveOrder, Obstacle, Vehicle, World } from '../sim/types';
import { angleDiff, bearing, clamp, DEG, dist, type Vec } from '../sim/vec';
import { bodyOf, type Body } from '../sim/body';
import { wheelMounts } from './body';
import { computeClosingSpeed, locateCrashContact, type CrashGeometry } from '../sim/crash-contact';
import { headingOf, headingQuat, noseRise, upOf, type TurnFrames, type V3, type VehicleFrame } from './frames';

const S = PHYSICS.metersPerTile;
const T = PHYSICS.truck;
const D = PHYSICS.driver;
const DT = 1 / PHYSICS.stepsPerSecond;
export const TURN_STEPS = Math.round(PHYSICS.turnSeconds * PHYSICS.stepsPerSecond);
const TELEPORT_TILES = 0.5;
const WALL = 50;
export const EDGE = 'edge';
export const RAIL = 'rail';
export const GROUND = 'ground';

export const toMps = (tilesPerTurn: number) => (tilesPerTurn * S) / PHYSICS.turnSeconds;
export const toTilesPerTurn = (mps: number) => (mps * PHYSICS.turnSeconds) / S;

type Memory = { steer: number; reverse: boolean; route: (KeptRoute & { radius: number }) | null; ahead: Vec | null; stall: number; backFrom: Vec | null; airborne: boolean };

export type Drive = {
  world: RAPIER.World;
  bodies: Record<string, number>;
  obstacles: Record<string, number[]>;
  memory: Record<string, Memory>;
  terrain: number;
  bridge: Bridge;
};

export type Bridge = { deck: number; rails: number[] };

export type Crash = { a: string; b: string; impact: number; contact: CrashGeometry };
export type Break = { prop: string; vehicle: string; step: number };
export type VehicleResult = { passed: boolean; arrived: boolean };
export type Landing = { vehicle: string; impact: number };
export type TurnResult = { next: Drive; frames: TurnFrames; crashes: Crash[]; breaks: Break[]; landings: Landing[]; results: Record<string, VehicleResult> };

export type DriveSnapshot = Omit<Drive, "world"> & { snapshot: Uint8Array };

export function captureDrive(drive: Drive): DriveSnapshot {
  const { world, ...handles } = drive;
  return { ...structuredClone(handles), snapshot: world.takeSnapshot() };
}

export function restoreDrive(saved: DriveSnapshot): Drive {
  const { snapshot, ...handles } = saved;
  return { ...handles, world: RAPIER.World.restoreSnapshot(snapshot) };
}

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

export function buildDrive(w: World): Drive {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  const d: Drive = { world, bodies: {}, obstacles: {}, memory: {}, terrain: addTerrain(world, w), bridge: addBridge(world, w) };
  syncDrive(d, w);
  return d;
}

export function freeDrive(d: Drive): void {
  d.world.free();
}

export function syncDrive(d: Drive, w: World): void {
  const near = w.vehicles.filter((v) => isNear(w, v));
  const ids = new Set(near.map((v) => v.id));
  for (const [id, handle] of Object.entries(d.bodies)) {
    if (ids.has(id)) continue;
    d.world.removeRigidBody(d.world.getRigidBody(handle));
    delete d.bodies[id];
    delete d.memory[id];
  }
  for (const v of near) syncVehicle(d, w, v);
  syncObstacles(d, w);
  for (const v of w.vehicles) {
    if (isNear(w, v) !== (d.bodies[v.id] !== undefined)) throw new Error(`Vehicle ${v.id} is ${isNear(w, v) ? 'near without' : 'far with'} a physics body`);
  }
}

function syncObstacles(d: Drive, w: World): void {
  const center = playerVehicle(w).pos;
  const range = TERRAIN.vision.radius + PERF.liveMargin + PHYSICS.propLiveMargin;
  const live = w.obstacles.filter((o) => isDriveObstacle(o) && dist(o.pos, center) <= range + obstacleReach(o));
  const liveIds = new Set(live.map((o) => o.id));
  for (const [id, handles] of Object.entries(d.obstacles)) {
    if (liveIds.has(id)) continue;
    for (const handle of handles) d.world.removeCollider(d.world.getCollider(handle), false);
    delete d.obstacles[id];
  }
  for (const o of live) {
    if (d.obstacles[o.id] === undefined) d.obstacles[o.id] = obstacleColliders(w.terrain, o).map((desc) => d.world.createCollider(desc).handle);
  }
}

export function obstacleColliders(t: Terrain, o: Obstacle): RAPIER.ColliderDesc[] {
  const ground = heightAt(t, o.pos.x, o.pos.y) * S;
  if (o.kind === 'site') {
    const half = PHYSICS.rockHeight / 2;
    return [RAPIER.ColliderDesc.cylinder(half, o.r * S).setTranslation(o.pos.x * S, ground + half - PHYSICS.rockSink, o.pos.y * S)];
  }
  return propBoxes(o).filter((b) => b.z0 < PHYSICS.truckClearance).map((b) => {
    const bottom = b.z0 < PHYSICS.rockSink ? Math.min(b.z0, -PHYSICS.rockSink) : b.z0;
    const desc = RAPIER.ColliderDesc.cuboid(b.half.x * S, (b.z1 - bottom) / 2, b.half.y * S);
    desc.setTranslation(b.center.x * S, ground + (b.z1 + bottom) / 2, b.center.y * S);
    return desc.setRotation(headingQuat(Math.atan2(b.axis.y, b.axis.x)));
  });
}

function syncVehicle(d: Drive, w: World, v: Vehicle): void {
  const handle = d.bodies[v.id];
  if (handle === undefined) {
    d.bodies[v.id] = addVehicle(d.world, w, v);
    d.memory[v.id] = { steer: 0, reverse: false, route: null, ahead: null, stall: 0, backFrom: null, airborne: false };
    return;
  }
  const body = d.world.getRigidBody(handle);
  setMass(body, v);
  const t = body.translation();
  const moved = dist({ x: t.x / S, y: t.z / S }, v.pos) > TELEPORT_TILES;
  if (moved || (v.strandedTurns ?? 0) >= RULES.stranded.turns) placeBody(body, w, v);
}

function addVehicle(world: RAPIER.World, w: World, v: Vehicle): number {
  const b = bodyOf(v.chassisId);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setGravityScale(T.gravityScale));
  for (const box of b.boxes) {
    const collider = RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z)
      .setTranslation(box.at.x, box.at.y, box.at.z)
      .setDensity(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(collider, body);
  }
  setMass(body, v);
  placeBody(body, w, v);
  return body.handle;
}

function setMass(body: RAPIER.RigidBody, v: Vehicle): void {
  const h = bodyOf(v.chassisId).half;
  const mass = vehicleMass(v);
  const k = (mass / 3) * T.inertiaScale;
  const inertia = { x: k * (h.y * h.y + h.z * h.z), y: k * (h.x * h.x + h.z * h.z), z: k * (h.x * h.x + h.y * h.y) };
  body.setAdditionalMassProperties(mass, { x: 0, y: -T.comBelow, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
  body.recomputeMassPropertiesFromColliders();
}

function placeBody(body: RAPIER.RigidBody, w: World, v: Vehicle): void {
  body.setTranslation({ x: v.pos.x * S, y: rideHeight(w, v), z: v.pos.y * S }, true);
  body.setRotation(headingQuat(v.heading), true);
  const fwd = toMps(v.speed);
  body.setLinvel({ x: Math.cos(v.heading) * fwd, y: 0, z: Math.sin(v.heading) * fwd }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

export function simulateTurn(d: Drive, w: World): TurnResult {
  return run(d, w, TURN_STEPS);
}

function noteOwner(owner: Map<number, string>, body: RAPIER.RigidBody, vehicleId: string): void {
  for (let i = 0; i < body.numColliders(); i++) owner.set(body.collider(i).handle, vehicleId);
}

type Car = { v: Vehicle; s: VehicleStats; b: Body; body: RAPIER.RigidBody; ctl: RAPIER.DynamicRayCastVehicleController; mem: Memory; plan: Plan; result: VehicleResult };

function run(d: Drive, w: World, steps: number): TurnResult {
  const world = RAPIER.World.restoreSnapshot(d.world.takeSnapshot());
  world.timestep = DT;
  const events = new RAPIER.EventQueue(true);
  const memory: Record<string, Memory> = structuredClone(d.memory);
  const cars: Car[] = w.vehicles.filter((v) => d.bodies[v.id] !== undefined).map((v) => {
    const body = world.getRigidBody(d.bodies[v.id]);
    const s = vehicleStats(w, v);
    const b = bodyOf(v.chassisId);
    const mem = memory[v.id];
    return { v, s, b, body, ctl: makeCar(world, body, b, s.mass), mem, plan: planTurn(w, v, s, body, v.order, mem), result: { passed: false, arrived: false } };
  });
  const owner = new Map<number, string>();
  for (const c of cars) noteOwner(owner, c.body, c.v.id);
  const obstacleOf = new Map(Object.entries(d.obstacles).flatMap(([id, handles]) => handles.map((h) => [h, id] as const)));

  const frames: TurnFrames = Object.fromEntries(cars.map((c) => [c.v.id, [] as VehicleFrame[]]));
  const contacts = new Contacts(w);
  const landings = new Landings();
  for (let i = 0; i < steps; i++) {
    const before = new Map(cars.map((c) => [c.v.id, captureImpactMotion(c.body)]));
    for (const c of cars) driveStep(c, w.terrain);
    for (const c of cars) c.ctl.updateVehicle(DT);
    landings.note(cars, before);
    world.step(events);
    events.drainCollisionEvents((h1, h2, started) => {
      if (started) contacts.add(crashOf(h1, h2, owner, obstacleOf, d, before, world, w), i);
    });
    smash(world, d, contacts.takeNewBreaks(), cars, before);
    for (const c of cars) frames[c.v.id].push(frameOf(c.ctl, c.body, before.get(c.v.id)!.velocity));
  }
  for (const c of cars) world.removeVehicleController(c.ctl);
  events.free();
  const results = Object.fromEntries(cars.map((c) => [c.v.id, c.result]));
  const obstacles = Object.fromEntries(Object.entries(d.obstacles).filter(([id]) => !contacts.isBroken(id)));
  return { next: { world, bodies: { ...d.bodies }, obstacles, memory, terrain: d.terrain, bridge: d.bridge }, frames, crashes: contacts.crashes, breaks: contacts.breaks, landings: landings.all(), results };
}

class Landings {
  private readonly hardest = new Map<string, number>();

  note(cars: Car[], before: Map<string, ImpactMotion>): void {
    for (const c of cars) this.noteCar(c, before.get(c.v.id)!);
  }

  private noteCar(c: Car, motion: ImpactMotion): void {
    const touching = wheelsTouch(c.ctl);
    const impact = Math.max(0, -motion.velocity.y);
    if (c.mem.airborne && touching && impact > (this.hardest.get(c.v.id) ?? 0)) this.hardest.set(c.v.id, impact);
    c.mem.airborne = !touching;
  }

  all(): Landing[] {
    return [...this.hardest].map(([vehicle, impact]) => ({ vehicle, impact }));
  }
}

function wheelsTouch(ctl: RAPIER.DynamicRayCastVehicleController): boolean {
  for (let i = 0; i < ctl.numWheels(); i++) if (ctl.wheelIsInContact(i)) return true;
  return false;
}

class Contacts {
  readonly crashes: Crash[] = [];
  readonly breaks: Break[] = [];
  private readonly crashed = new Set<string>();
  private readonly breakable: Set<string>;
  private fresh: Break[] = [];

  constructor(w: World) {
    this.breakable = new Set(w.obstacles.filter(isBreakable).map((o) => o.id));
  }

  add(crash: Crash | null, step: number): void {
    if (!crash || this.isBroken(crash.b)) return;
    if (this.breakable.has(crash.b) && crash.impact >= BREAKABLE.breakSpeed) {
      const b = { prop: crash.b, vehicle: crash.a, step };
      this.breaks.push(b);
      this.fresh.push(b);
      return;
    }
    const key = [crash.a, crash.b].sort().join('|');
    if (this.crashed.has(key)) return;
    this.crashed.add(key);
    this.crashes.push(crash);
  }

  isBroken(id: string): boolean {
    return this.breaks.some((b) => b.prop === id);
  }

  takeNewBreaks(): Break[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
}

function smash(world: RAPIER.World, d: Drive, breaks: Break[], cars: Car[], before: Map<string, ImpactMotion>): void {
  for (const b of breaks) smashOne(world, d, b, cars, before);
}

function smashOne(world: RAPIER.World, d: Drive, b: Break, cars: Car[], before: Map<string, ImpactMotion>): void {
  for (const handle of d.obstacles[b.prop]) world.removeCollider(world.getCollider(handle), false);
  const car = cars.find((c) => c.v.id === b.vehicle);
  const motion = before.get(b.vehicle);
  if (!car || !motion) throw new Error(`Break of ${b.prop} by ${b.vehicle}, which has no body`);
  const keep = 1 - BREAKABLE.slowdown;
  car.body.setLinvel({ x: motion.velocity.x * keep, y: motion.velocity.y * keep, z: motion.velocity.z * keep }, true);
  car.body.setAngvel(motion.spin, true);
}

function crashOf(h1: number, h2: number, owner: Map<number, string>, obstacleOf: Map<number, string>, d: Drive, before: Map<string, ImpactMotion>, physics: RAPIER.World, state: World): Crash | null {
  const a = owner.get(h1) ?? owner.get(h2);
  if (a === undefined) return null;
  const [first, other] = owner.get(h1) === a ? [h1, h2] : [h2, h1];
  const va = before.get(a)!;
  if (other === d.terrain || other === d.bridge.deck) return captureGroundCrash(physics, state, a, first, other, va);
  return captureCrash(physics, state, before, { a, b: crashTarget(other, owner, obstacleOf, d), first, other }, va);
}

function crashTarget(other: number, owner: Map<number, string>, obstacleOf: Map<number, string>, d: Drive): string {
  return owner.get(other) ?? obstacleOf.get(other) ?? (d.bridge.rails.includes(other) ? RAIL : EDGE);
}

function captureCrash(physics: RAPIER.World, state: World, before: Map<string, ImpactMotion>, pair: { a: string; b: string; first: number; other: number }, va: ImpactMotion): Crash | null {
  const vb = before.get(pair.b) ?? { velocity: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, heading: 0 };
  const vehicle = state.vehicles.find((v) => v.id === pair.a);
  if (!vehicle) throw new Error(`Unknown crash vehicle ${pair.a}`);
  const target = state.vehicles.find((v) => v.id === pair.b) ?? null;
  const hit = readCrashContact(physics, physics.getCollider(pair.first), physics.getCollider(pair.other), vehicle, target, va, vb);
  return hit ? { a: pair.a, b: pair.b, ...hit } : null;
}

function captureGroundCrash(physics: RAPIER.World, state: World, a: string, first: number, ground: number, motion: ImpactMotion): Crash | null {
  const vehicle = state.vehicles.find((v) => v.id === a);
  if (!vehicle) throw new Error(`Unknown crash vehicle ${a}`);
  const hits: { impact: number; contact: CrashGeometry }[] = [];
  physics.contactPair(physics.getCollider(first), physics.getCollider(ground), (manifold, flipped) => {
    const raw = manifold.normal();
    const sign = flipped ? -1 : 1;
    const v = motion.velocity;
    const impact = Math.max(0, (v.x * raw.x + v.y * raw.y + v.z * raw.z) * sign);
    const points = readManifoldPoints(manifold, flipped);
    if (points.a.length === 0) return;
    const local = flipped ? manifold.localNormal2() : manifold.localNormal1();
    hits.push({ impact, contact: { a: locateCrashContact(vehicle.chassisId, points.a, { x: local.x, y: local.z }), b: null } });
  });
  hits.sort((x, y) => y.impact - x.impact);
  return hits[0] ? { a, b: GROUND, ...hits[0] } : null;
}

type ImpactMotion = { velocity: RAPIER.Vector; spin: RAPIER.Vector; heading: number };

function rotateToBody(vector: Vec, heading: number): Vec {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: vector.x * c + vector.y * s, y: vector.y * c - vector.x * s };
}

function readManifoldPoints(manifold: RAPIER.TempContactManifold, flipped: boolean): { a: Vec[]; b: Vec[] } {
  const points = { a: [] as Vec[], b: [] as Vec[] };
  for (let i = 0; i < manifold.numContacts(); i++) {
    const first = manifold.localContactPoint1(i);
    const second = manifold.localContactPoint2(i);
    if (!first || !second) throw new Error('Missing collision contact point');
    const pair = [{ x: first.x, y: first.z }, { x: second.x, y: second.z }];
    if (flipped) pair.reverse();
    points.a.push(pair[0]);
    points.b.push(pair[1]);
  }
  return points;
}

function readCrashContact(world: RAPIER.World, first: RAPIER.Collider, second: RAPIER.Collider, a: Vehicle, b: Vehicle | null, motionA: ImpactMotion, motionB: ImpactMotion): { impact: number; contact: CrashGeometry } | null {
  const hits: { impact: number; contact: CrashGeometry }[] = [];
  world.contactPair(first, second, (manifold, flipped) => {
    const raw = manifold.normal();
    const sign = flipped ? -1 : 1;
    const normal = { x: raw.x * sign, y: raw.z * sign };
    if (Math.hypot(normal.x, normal.y) === 0) return;
    const impact = computeClosingSpeed({ x: motionA.velocity.x - motionB.velocity.x, y: motionA.velocity.z - motionB.velocity.z }, normal);
    const points = readManifoldPoints(manifold, flipped);
    if (points.a.length === 0) return;
    const contact = {
      a: locateCrashContact(a.chassisId, points.a, rotateToBody(normal, motionA.heading)),
      b: b ? locateCrashContact(b.chassisId, points.b, rotateToBody({ x: -normal.x, y: -normal.y }, motionB.heading)) : null,
    };
    hits.push({ impact, contact });
  });
  hits.sort((a, b) => b.impact - a.impact);
  return hits[0] ?? null;
}

function captureImpactMotion(body: RAPIER.RigidBody): ImpactMotion {
  return { velocity: body.linvel(), spin: body.angvel(), heading: headingOf(body.rotation()) };
}

function makeCar(world: RAPIER.World, body: RAPIER.RigidBody, b: Body, mass: number): RAPIER.DynamicRayCastVehicleController {
  const car = world.createVehicleController(body);
  for (const m of wheelMounts(b)) {
    const i = car.numWheels();
    car.addWheel(m, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, T.suspensionRest, b.wheelRadius);
    car.setWheelMaxSuspensionTravel(i, T.suspensionTravel);
    car.setWheelSuspensionStiffness(i, T.suspensionStiffness);
    car.setWheelSuspensionCompression(i, T.suspensionCompression);
    car.setWheelSuspensionRelaxation(i, T.suspensionRelaxation);
    car.setWheelMaxSuspensionForce(i, T.maxSuspensionForce * (mass / 1000));
    car.setWheelFrictionSlip(i, T.frictionSlip);
    car.setWheelSideFrictionStiffness(i, T.sideFrictionStiffness);
  }
  return car;
}

type Plan = { dest: Vec | null; route: Vec[] | null; target: number; stopAt: boolean; engine: boolean; maxSteer: number; engineForce: number; brakeForce: number; stopDecel: number };

function planTurn(w: World, v: Vehicle, full: VehicleStats, body: RAPIER.RigidBody, order: MoveOrder | null, mem: Memory): Plan {
  const ch = chassisDef(v.chassisId);
  const speed = Math.max(0, toTilesPerTurn(forwardSpeed(body)));
  const s = fuelLimited(w, v, full, speed, order);
  const engine = s.maxSpeed > 0;
  const base = {
    engine,
    maxSteer: T.maxSteer * (s.turnSlow / (ch.turnSlow * DEG)),
    engineForce: (full.mass * T.engineAccel * (s.accel / ch.accel)) / 2,
    brakeForce: T.brakeForce * (ch.handlingMass / 1000),
    stopDecel: D.stopDecel * (ch.handlingMass / full.mass),
  };
  if (!order) return { ...base, dest: null, route: null, target: idleTarget(speed), stopAt: false };
  if (order.kind === 'brake') return { ...base, dest: null, route: null, target: 0, stopAt: false };
  const blockers = routeBlockers(w, v);
  const stored = mem.route && dist(mem.route.dest, order.dest) < RULES.arriveRadius && mem.route.radius === s.radius ? continueRoute(w, v.pos, mem.route, order.dest, s.radius, blockers, v) : null;
  const path = v.direct ? null : stored ?? [...route(w, v.pos, order.dest, s.radius, blockers, v)];
  mem.route = path ? { ...keepRoute(w, order.dest, path, blockers), radius: s.radius } : null;
  if (order.kind === 'stopAt') return { ...base, dest: stopPoint(path, order.dest), route: path, target: toMps(Math.min(s.maxSpeed, speed + s.accel)), stopAt: true };
  const next = throughSpeed(s, speed, dist(v.pos, order.dest), order.pace);
  return { ...base, dest: order.dest, route: path, target: toMps(next), stopAt: false };
}

function stopPoint(path: Vec[] | null, dest: Vec): Vec {
  return path ? path[path.length - 1] : dest;
}

function idleTarget(speed: number): number {
  return speed <= RULES.parkedSpeed ? 0 : toMps(speed);
}

function applyTerrainGrip(c: Car, terrain: Terrain): void {
  const p = c.body.translation();
  const type = terrain.types[tileAt(terrain, { x: p.x / S, y: p.z / S })];
  const grip = T.frictionSlip * groundSpeed(c.s, TERRAIN_TYPES[type].speed);
  for (let i = 0; i < 4; i++) c.ctl.setWheelFrictionSlip(i, grip);
}

function driveStep(c: Car, terrain: Terrain): void {
  applyTerrainGrip(c, terrain);
  const speed = forwardSpeed(c.body);
  const command = c.plan.dest && !reached(c) ? commandToward(c, c.plan.dest, speed) : { target: c.plan.target, steerTo: 0 };
  if (c.result.arrived) command.target = 0;
  if (!c.plan.dest) {
    c.mem.reverse = false;
    c.mem.backFrom = null;
  }
  turnWheels(c, command.steerTo);
  applyPedals(c, command.target, speed);
}

type Command = { target: number; steerTo: number };

function reached(c: Car): boolean {
  return c.result.passed || c.result.arrived;
}

function commandToward(c: Car, dest: Vec, speed: number): Command {
  const { plan, body } = c;
  const p = body.translation();
  const at = { x: p.x / S, y: p.z / S };
  const heading = headingOf(body.rotation());
  const target = arrivalTarget(c, dest, at, heading, speed);
  if (reached(c)) return { target, steerTo: 0 };
  const aim = plan.route ? routeAim(plan.route, at) : dest;
  const ang = angleDiff(heading, bearing(at, aim));
  c.mem.reverse = backs(c, at, ang, angleDiff(heading + Math.PI, bearing(at, dest)), dist(at, dest), target, speed);
  if (c.mem.reverse) {
    const rearAng = angleDiff(heading + Math.PI, bearing(at, aim));
    const gain = c.mem.backFrom ? D.steerGain : -D.steerGain;
    return { target: -Math.min(D.reverseSpeed, plan.target), steerTo: clamp(rearAng * gain, -plan.maxSteer, plan.maxSteer) };
  }
  const corner = Math.min(cornerSpeed(dist(at, aim) * S, ang), routeCornerSpeed(plan.route, at, Math.abs(speed), plan.stopDecel));
  return { target: Math.min(target, corner), steerTo: clamp(ang * D.steerGain, -plan.maxSteer, plan.maxSteer) };
}

function arrivalTarget(c: Car, dest: Vec, at: Vec, heading: number, speed: number): number {
  const far = dist(at, dest) * S;
  if (!c.plan.stopAt) {
    c.result.passed = passedThrough(dest, c.plan.route, c.mem, { x: at.x * S, y: at.y * S }, heading, speed);
    return c.plan.target;
  }
  if (far < RULES.arriveRadius * S) c.result.arrived = true;
  return Math.min(c.plan.target, Math.sqrt(2 * c.plan.stopDecel * Math.max(0, far - RULES.arriveRadius * S)));
}

function backs(c: Car, at: Vec, ang: number, rearAng: number, far: number, target: number, speed: number): boolean {
  if (Math.abs(ang) <= Math.PI / 2) {
    c.mem.stall = 0;
    c.mem.backFrom = null;
    return false;
  }
  if (backsToPoint(c, rearAng, far, target, speed)) {
    c.mem.backFrom = null;
    return true;
  }
  if (c.mem.backFrom && dist(at, c.mem.backFrom) < RULES.reverse.distance) return true;
  c.mem.backFrom = null;
  if (!blockedInFront(c, target, speed)) return false;
  c.mem.backFrom = { ...at };
  c.mem.stall = 0;
  return true;
}

function backsToPoint(c: Car, rearAng: number, far: number, target: number, speed: number): boolean {
  const starts = target > 0 && Math.abs(speed) < D.reverseBelow;
  return backsToDestination(c.v, far, rearAng) && (c.mem.reverse || starts);
}

function blockedInFront(c: Car, target: number, speed: number): boolean {
  c.mem.stall = target > 0 && Math.abs(speed) < D.stallSpeed ? c.mem.stall + DT : 0;
  return c.mem.stall >= D.stallSeconds;
}

function turnWheels(c: Car, steerTo: number): void {
  const step = T.steerRate * DT;
  c.mem.steer = clamp(steerTo, c.mem.steer - step, c.mem.steer + step);
  c.ctl.setWheelSteering(0, -c.mem.steer);
  c.ctl.setWheelSteering(1, -c.mem.steer);
}

function applyPedals(c: Car, target: number, speed: number): void {
  const { plan, ctl } = c;
  const u = clamp((target - speed) * D.throttleGain + slopeThrottle(c, target), -1, 1);
  const pushing = plan.engine && target !== 0 && Math.sign(u) === Math.sign(target);
  const brake = brakeOf(plan, u, target, pushing);
  const force = pushing ? u * plan.engineForce : 0;
  for (let i = 0; i < 4; i++) ctl.setWheelBrake(i, brake);
  for (const i of [2, 3]) ctl.setWheelEngineForce(i, force);
}

function slopeThrottle(c: Car, target: number): number {
  if (target === 0) return 0;
  const pull = T.gravityScale * PHYSICS.gravity * noseRise(c.body.rotation()) * c.s.mass;
  return pull / (2 * c.plan.engineForce);
}

function brakeOf(plan: Plan, u: number, target: number, pushing: boolean): number {
  if (pushing) return 0;
  return Math.abs(u) * plan.brakeForce + (target === 0 ? plan.brakeForce : 0);
}

function passedThrough(dest: Vec, route: Vec[] | null, mem: Memory, at: Vec, heading: number, speed: number): boolean {
  const dx = dest.x * S - at.x;
  const dz = dest.y * S - at.y;
  if (Math.hypot(dx, dz) < RULES.passRadius * S) return true;
  if (!onLastLeg(route)) {
    mem.ahead = null;
    return false;
  }
  const ahead = Math.abs(angleDiff(heading, Math.atan2(dz, dx))) < Math.PI / 2;
  const wasAhead = samePoint(mem.ahead, dest);
  mem.ahead = ahead ? dest : null;
  return wasAhead && !ahead && speed > 0;
}

function onLastLeg(route: Vec[] | null): boolean {
  return !route || route.length === 1;
}

function samePoint(a: Vec | null, b: Vec): boolean {
  return a !== null && a.x === b.x && a.y === b.y;
}

function cornerSpeed(aimDist: number, ang: number): number {
  const sin = Math.abs(Math.sin(ang));
  return sin === 0 ? Infinity : Math.sqrt((D.cornerAccel * aimDist) / (2 * sin));
}

function routeCornerSpeed(route: Vec[] | null, at: Vec, speed: number, decel: number): number {
  if (!route) return Infinity;
  const reach = (speed * speed) / (2 * decel) + D.cornerCut;
  let limit = Infinity;
  let along = dist(at, route[0]) * S;
  let prev = at;
  for (let k = 0; k + 1 < route.length && along <= reach; k++) {
    const theta = Math.abs(angleDiff(bearing(prev, route[k]), bearing(route[k], pointAfter(route, k, D.cornerCut / S))));
    if (theta > 0) {
      const corner = Math.sqrt((D.cornerAccel * D.cornerCut) / Math.tan(theta / 2));
      limit = Math.min(limit, Math.sqrt(corner * corner + 2 * decel * Math.max(0, along - D.cornerCut)));
    }
    along += dist(route[k], route[k + 1]) * S;
    prev = route[k];
  }
  return limit;
}

function pointAfter(route: Vec[], k: number, d: number): Vec {
  let along = 0;
  for (let i = k + 1; i < route.length; i++) {
    along += dist(route[i - 1], route[i]);
    if (along >= d) return route[i];
  }
  return route[route.length - 1];
}

export function routeAim(route: Vec[], at: Vec): Vec {
  while (route.length > 1 && (dist(at, route[0]) < RULES.minAimDistance || passed(at, route[0], route[1]))) route.shift();
  return route[0];
}

function passed(at: Vec, a: Vec, b: Vec): boolean {
  return (at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y) > 0;
}

export function forwardSpeed(body: RAPIER.RigidBody): number {
  const v = body.linvel();
  const h = headingOf(body.rotation());
  return v.x * Math.cos(h) + v.z * Math.sin(h);
}

function frameOf(car: RAPIER.DynamicRayCastVehicleController, body: RAPIER.RigidBody, velocityBefore: V3): VehicleFrame {
  const wheels = [];
  for (let i = 0; i < car.numWheels(); i++) {
    wheels.push({ steer: car.wheelSteering(i) ?? 0, spin: car.wheelRotation(i) ?? 0, suspension: car.wheelSuspensionLength(i) ?? T.suspensionRest });
  }
  const t = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const acc = { x: (v.x - velocityBefore.x) / DT, y: (v.y - velocityBefore.y) / DT, z: (v.z - velocityBefore.z) / DT };
  return { pos: { x: t.x, y: t.y, z: t.z }, rot: { x: r.x, y: r.y, z: r.z, w: r.w }, acc, wheels };
}

export function restFrame(w: World, v: Vehicle): VehicleFrame {
  const b = bodyOf(v.chassisId);
  const q = headingQuat(v.heading);
  const wheels = wheelMounts(b).map(() => ({ steer: 0, spin: 0, suspension: T.suspensionRest }));
  return { pos: { x: v.pos.x * S, y: rideHeight(w, v), z: v.pos.y * S }, rot: q, acc: { x: 0, y: 0, z: 0 }, wheels };
}

export function restFrames(w: World, v: Vehicle): VehicleFrame[] {
  return Array.from({ length: TURN_STEPS }, () => restFrame(w, v));
}

export function trailFrames(w: World, v: Vehicle): VehicleFrame[] {
  const last = v.trail.length - 1;
  if (last < 1) throw new Error(`Vehicle ${v.id} has no trail to frame`);
  const frames: VehicleFrame[] = [];
  for (let i = 1; i <= TURN_STEPS; i++) {
    const t = (i / TURN_STEPS) * last;
    const k = Math.min(Math.floor(t), last - 1);
    const f = t - k;
    const a = v.trail[k];
    const b = v.trail[k + 1];
    const heading = a.heading + angleDiff(a.heading, b.heading) * f;
    frames.push(restFrame(w, { ...v, pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading }));
  }
  return frames;
}

function rideHeight(w: World, v: Vehicle): number {
  const b = bodyOf(v.chassisId);
  return heightAt(w.terrain, v.pos.x, v.pos.y) * S + b.wheelRadius + T.suspensionRest - b.wheelY;
}

export function isLifted(d: Drive, w: World, v: Vehicle): boolean {
  const handle = d.bodies[v.id];
  if (handle === undefined) throw new Error(`No physics body for ${v.id}`);
  return d.world.getRigidBody(handle).translation().y > rideHeight(w, v) + T.liftedRise;
}

export function bodyState(d: Drive, id: string): { pos: Vec; heading: number; speed: number; upright: boolean } {
  const handle = d.bodies[id];
  if (handle === undefined) throw new Error(`No physics body for ${id}`);
  const body = d.world.getRigidBody(handle);
  const t = body.translation();
  const r = body.rotation();
  const upright = upOf(r) >= Math.cos(T.flipTilt * DEG);
  return { pos: { x: t.x / S, y: t.z / S }, heading: headingOf(r), speed: forwardSpeed(body), upright };
}

function addTerrain(world: RAPIER.World, w: World): number {
  const n = w.terrain.size;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) heights[i * (n + 1) + j] = w.terrain.heights[j * (n + 1) + i];
  }
  const size = n * S;
  const field = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: S, z: size }).setTranslation(size / 2, 0, size / 2);
  const terrain = world.createCollider(field).handle;
  for (const [x, z, hx, hz] of [[-WALL, size / 2, WALL, size], [size + WALL, size / 2, WALL, size], [size / 2, -WALL, size, WALL], [size / 2, size + WALL, size, WALL]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, PHYSICS.wallHeight, hz).setTranslation(x, 0, z));
  }
  return terrain;
}

function addBridge(world: RAPIER.World, w: World): Bridge {
  const B = PHYSICS.bridge;
  const { from } = TERRAIN.features.bridge;
  const [h0, h1] = deckEnds(w.terrain);
  const length = BRIDGE_LENGTH * S;
  const pitch = Math.atan2((h1 - h0) * S, length);
  const yaw = headingQuat(Math.atan2(BRIDGE_AXIS.y, BRIDGE_AXIS.x));
  const rot = { x: yaw.y * Math.sin(pitch / 2), y: yaw.y * Math.cos(pitch / 2), z: yaw.w * Math.sin(pitch / 2), w: yaw.w * Math.cos(pitch / 2) };
  const up = { x: -Math.sin(pitch) * BRIDGE_AXIS.x, y: Math.cos(pitch), z: -Math.sin(pitch) * BRIDGE_AXIS.y };
  const across = { x: -BRIDGE_AXIS.y, z: BRIDGE_AXIS.x };
  const mid = {
    x: (from.x + (BRIDGE_AXIS.x * BRIDGE_LENGTH) / 2) * S,
    y: ((h0 + h1) / 2) * S,
    z: (from.y + (BRIDGE_AXIS.y * BRIDGE_LENGTH) / 2) * S,
  };
  const box = (halfWidth: number, halfHeight: number, side: number, lift: number) => {
    const c = lift - halfHeight;
    const desc = RAPIER.ColliderDesc.cuboid(length / 2, halfHeight, halfWidth)
      .setTranslation(mid.x + up.x * c + across.x * side, mid.y + up.y * c, mid.z + up.z * c + across.z * side)
      .setRotation(rot);
    return world.createCollider(desc).handle;
  };
  const halfWidth = (TERRAIN.features.bridge.width * S) / 2;
  const deck = box(halfWidth, B.deckThickness / 2, 0, 0);
  const rails = [-1, 1].map((side) => box(B.railThickness / 2, B.railHeight / 2, side * halfWidth, B.railHeight));
  return { deck, rails };
}
