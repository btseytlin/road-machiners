// Physics driving for every vehicle. The map's terrain and obstacles become Rapier colliders; each
// vehicle is a ray-cast car. Time only moves inside simulateTurn. A turn restores the world from a
// snapshot and runs it forward, so the same state and orders always give the same result: the

import RAPIER from '@dimforge/rapier3d-compat';
import { chassisDef } from '../data/chassis';
import { PERF } from '../data/perf';
import { PHYSICS } from '../data/physics';
import { BREAKABLE, CRATER, RULES } from '../data/rules';
import { fuelLimited, isNear } from '../sim/far';
import { blockingBoxes, isBreakable, isDriveObstacle, obstacleReach } from '../sim/mapgen';
import { playerVehicle } from '../sim/damage';
import { vehicleMass } from '../sim/mass';
import { groundSpeed, vehicleStats, type VehicleStats } from '../sim/stats';
import { continueRoute, keepRoute, route, type KeptRoute } from '../sim/path';
import { backsToDestination, throughSpeed } from '../sim/steering';
import { routeBlockers } from '../sim/ai';
import { DECKS, propBase, railOffset, type Deck } from '../sim/bridge';
import { deckSegments, groundAt, heightAt, tileAt, type DeckSegment, type Terrain } from '../sim/terrain';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import { craterReach, craterRimPoints } from '../sim/craters';
import type { Crater, MoveOrder, Obstacle, Pose, Vehicle, World } from '../sim/types';
import { angleDiff, bearing, clamp, DEG, dist, type Vec } from '../sim/vec';
import { bodyOf, type Body } from '../sim/body';
import { wheelMounts } from './body';
import { computeClosingSpeed, locateCrashContact, type CrashGeometry } from '../sim/crash-contact';
import { headingOf, headingQuat, noseRise, rotateBy, toPhys, toPhysCircle, upOf, type Circle, type Quat, type TurnFrames, type V3, type VehicleFrame, type WheelFrame } from './frames';
import { oilPatches } from '../sim/hazards';
import { lineAnchors, type BodyPoint, type LineAnchor } from '../sim/harpoon';
import { claymoreOf, claymoresSetOff, type ClaymoreCrash } from '../sim/claymore';
import { HARPOON, OIL } from '../data/utilities';

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
  craters: Record<string, number[]>;
  memory: Record<string, Memory>;
  terrain: number;
  decks: DeckColliders[];
};

export type DeckColliders = { plates: number[]; rails: number[]; lips: number[] };

export type Crash = { a: string; b: string; impact: number; contact: CrashGeometry; step: number };
export type Break = { prop: string; vehicle: string; step: number };
export type VehicleResult = { passed: boolean; arrived: boolean };
export type Landing = { vehicle: string; impact: number; step: number };
export type Tear = { line: string; step: number };
export type TurnResult = { next: Drive; frames: TurnFrames; crashes: Crash[]; breaks: Break[]; landings: Landing[]; tears: Tear[]; results: Record<string, VehicleResult> };

export type DriveSnapshot = Omit<Drive, "world"> & { snapshot: Uint8Array };

export function captureDrive(drive: Drive): DriveSnapshot {
  const { world, ...handles } = drive;
  return { ...structuredClone(handles), snapshot: world.takeSnapshot() };
}

export function restoreDrive(saved: DriveSnapshot): Drive {
  const { snapshot, ...handles } = saved;
  return { ...structuredClone(handles), world: RAPIER.World.restoreSnapshot(snapshot) };
}

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

export function buildDrive(w: World): Drive {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  const d: Drive = { world, bodies: {}, obstacles: {}, craters: {}, memory: {}, terrain: addTerrain(world, w), decks: addDecks(world, w) };
  syncDrive(d, w);
  return d;
}

export function freeDrive(d: Drive): void {
  d.world.free();
}

export function syncDrive(d: Drive, w: World): void {
  checkHandles(d);
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
  syncCraters(d, w);
  for (const v of w.vehicles) {
    if (isNear(w, v) !== (d.bodies[v.id] !== undefined)) throw new Error(`Vehicle ${v.id} is ${isNear(w, v) ? 'near without' : 'far with'} a physics body`);
  }
}

function checkHandles(d: Drive): void {
  for (const [id, handle] of Object.entries(d.bodies)) {
    if (d.world.getRigidBody(handle)?.handle !== handle) throw new Error(`Vehicle ${id} has no body ${handle}`);
  }
  for (const [id, handles] of Object.entries(d.obstacles)) checkColliders(d, id, handles);
  for (const [id, handles] of Object.entries(d.craters)) checkColliders(d, id, handles);
}

function checkColliders(d: Drive, id: string, handles: number[]): void {
  for (const handle of handles) {
    if (d.world.getCollider(handle)?.handle !== handle) throw new Error(`Obstacle or crater ${id} has no collider ${handle}`);
  }
}

function syncObstacles(d: Drive, w: World): void {
  const live = w.obstacles.filter((o) => isDriveObstacle(o) && inLiveRange(w, o.pos, obstacleReach(o)));
  dropColliders(d, d.obstacles, new Set(live.map((o) => o.id)));
  for (const o of live) {
    if (d.obstacles[o.id] === undefined) d.obstacles[o.id] = addColliders(d, obstacleColliders(w.terrain, o));
  }
}

function inLiveRange(w: World, pos: Vec, reach: number): boolean {
  const range = TERRAIN.vision.radius + PERF.liveMargin + PHYSICS.propLiveMargin;
  return dist(pos, playerVehicle(w).pos) <= range + reach;
}

function dropColliders(d: Drive, record: Record<string, number[]>, keep: Set<string>): void {
  for (const [id, handles] of Object.entries(record)) {
    if (keep.has(id)) continue;
    for (const handle of handles) d.world.removeCollider(d.world.getCollider(handle), false);
    delete record[id];
  }
}

function addColliders(d: Drive, descs: RAPIER.ColliderDesc[]): number[] {
  return descs.map((desc) => d.world.createCollider(desc).handle);
}

function syncCraters(d: Drive, w: World): void {
  const live = w.craters.filter((c) => inLiveRange(w, c.pos, craterReach(c)));
  dropColliders(d, d.craters, new Set(live.map((c) => c.id)));
  for (const c of live) {
    if (d.craters[c.id] === undefined && clearOfBodies(d, w, c)) d.craters[c.id] = addColliders(d, craterColliders(w.terrain, c));
  }
}

function clearOfBodies(d: Drive, w: World, c: Crater): boolean {
  return w.vehicles.every((v) => {
    const handle = d.bodies[v.id];
    if (handle === undefined) return true;
    const t = d.world.getRigidBody(handle).translation();
    return dist({ x: t.x / S, y: t.z / S }, c.pos) > chassisDef(v.chassisId).radius + craterReach(c);
  });
}

export function craterColliders(t: Terrain, c: Crater): RAPIER.ColliderDesc[] {
  const rim = craterRimPoints(c).map((p) => toPhys(p, groundAt(t, p.x, p.y)));
  const radius = (CRATER.rimWidthRatio * c.radius) / 2;
  const lift = CRATER.rimRatio * c.radius - radius;
  return rim.map((a, k) => capsuleBetween(a, rim[(k + 1) % rim.length], radius, lift));
}

function capsuleBetween(a: V3, b: V3, radius: number, lift: number): RAPIER.ColliderDesc {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(u.x, u.y, u.z);
  if (!(len > 0)) throw new Error('Capsule between one point');
  const desc = RAPIER.ColliderDesc.capsule(len / 2, radius).setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2);
  return desc.setRotation(upOnto({ x: u.x / len, y: u.y / len, z: u.z / len }));
}

function upOnto(u: V3): Quat {
  const w = 1 + u.y;
  const n = Math.hypot(u.z, u.x, w);
  return { x: u.z / n, y: 0, z: -u.x / n, w: w / n };
}

export function obstacleColliders(t: Terrain, o: Obstacle): RAPIER.ColliderDesc[] {
  const ground = propBase(t, o) * S;
  if (o.kind === 'site') {
    const half = PHYSICS.rockHeight / 2;
    return [RAPIER.ColliderDesc.cylinder(half, o.r * S).setTranslation(o.pos.x * S, ground + half - PHYSICS.rockSink, o.pos.y * S)];
  }
  return blockingBoxes(o, t).map((b) => {
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

type Car = { v: Vehicle; s: VehicleStats; b: Body; body: RAPIER.RigidBody; ctl: RAPIER.DynamicRayCastVehicleController; mem: Memory; plan: Plan; result: VehicleResult; grip: number; oil: Circle[]; kicked: boolean };

function run(d: Drive, w: World, steps: number): TurnResult {
  const world = RAPIER.World.restoreSnapshot(d.world.takeSnapshot());
  world.timestep = DT;
  const events = new RAPIER.EventQueue(true);
  const memory: Record<string, Memory> = structuredClone(d.memory);
  const oil = oilPatches(w);
  const cars: Car[] = w.vehicles.filter((v) => d.bodies[v.id] !== undefined).map((v) => {
    const body = world.getRigidBody(d.bodies[v.id]);
    const s = vehicleStats(w, v);
    const b = bodyOf(v.chassisId);
    const mem = memory[v.id];
    return { v, s, b, body, ctl: makeCar(world, body, b, s.mass), mem, plan: planOf(w, v, s, body, mem), result: { passed: false, arrived: false }, grip: 1, oil: oilInReach(oil, v, s, body), kicked: false };
  });
  const owner = new Map<number, string>();
  for (const c of cars) noteOwner(owner, c.body, c.v.id);
  const obstacleOf = new Map(Object.entries(d.obstacles).flatMap(([id, handles]) => handles.map((h) => [h, id] as const)));

  const frames: TurnFrames = Object.fromEntries(cars.map((c) => [c.v.id, [] as VehicleFrame[]]));
  const contacts = new Contacts(w);
  const throws = new ClaymoreThrows(w, cars);
  const landings = new Landings();
  const lines = new Lines(lineAnchors(w), cars);
  for (let i = 0; i < steps; i++) {
    const before = new Map(cars.map((c) => [c.v.id, captureImpactMotion(c.body)]));
    for (const c of cars) driveStep(c, w.terrain);
    for (const c of cars) c.ctl.updateVehicle(DT);
    lines.pull(i);
    landings.note(cars, before, i);
    world.step(events);
    events.drainCollisionEvents((h1, h2, started) => {
      if (started) contacts.add(crashOf(h1, h2, owner, obstacleOf, d, before, world, w), i);
    });
    smash(world, d, contacts.takeNewBreaks(), cars, before);
    throws.apply(contacts.takeNewCrashes());
    for (const c of cars) frames[c.v.id].push(frameOf(c.ctl, c.body, before.get(c.v.id)!.velocity));
  }
  for (const c of cars) world.removeVehicleController(c.ctl);
  events.free();
  const results = Object.fromEntries(cars.map((c) => [c.v.id, c.result]));
  const obstacles = Object.fromEntries(Object.entries(d.obstacles).filter(([id]) => !contacts.isBroken(id)));
  return { next: { world, bodies: { ...d.bodies }, obstacles, craters: { ...d.craters }, memory, terrain: d.terrain, decks: d.decks }, frames, crashes: contacts.crashes, breaks: contacts.breaks, landings: landings.all(), tears: lines.tears, results };
}

class Lines {
  readonly tears: Tear[] = [];
  private readonly held: { line: LineAnchor; a: Car; b: Car }[];

  constructor(lines: LineAnchor[], cars: Car[]) {
    const car = (id: string) => cars.find((c) => c.v.id === id);
    this.held = lines.flatMap((line) => {
      const a = car(line.from);
      const b = car(line.to);
      return a && b ? [{ line, a, b }] : [];
    });
  }

  pull(step: number): void {
    for (const h of this.held) {
      if (this.tears.some((t) => t.line === h.line.id)) continue;
      if (!pullLine(h.line, h.a.body, h.b.body)) this.tears.push({ line: h.line.id, step });
    }
  }
}

function pullLine(line: LineAnchor, a: RAPIER.RigidBody, b: RAPIER.RigidBody): boolean {
  const pa = worldPoint(a, line.fromAt);
  const pb = worldPoint(b, line.toAt);
  const gap = Math.hypot(pb.x - pa.x, pb.z - pa.z);
  if (gap <= line.length) return true;
  const stretch = HARPOON.stiffness * (gap - line.length);
  if (stretch > HARPOON.tearForce) return false;
  const n = { x: (pb.x - pa.x) / gap, z: (pb.z - pa.z) / gap };
  const va = a.velocityAtPoint(pa);
  const vb = b.velocityAtPoint(pb);
  const separating = (vb.x - va.x) * n.x + (vb.z - va.z) * n.z;
  const force = Math.max(0, stretch + HARPOON.damping * separating);
  const j = force * DT;
  a.applyImpulseAtPoint({ x: n.x * j, y: 0, z: n.z * j }, pa, true);
  b.applyImpulseAtPoint({ x: -n.x * j, y: 0, z: -n.z * j }, pb, true);
  return true;
}

function worldPoint(body: RAPIER.RigidBody, at: BodyPoint): V3 {
  const t = body.translation();
  const r = rotateBy(body.rotation(), at);
  return { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
}

class Landings {
  private readonly hardest = new Map<string, { impact: number; step: number }>();

  note(cars: Car[], before: Map<string, ImpactMotion>, step: number): void {
    for (const c of cars) this.noteCar(c, before.get(c.v.id)!, step);
  }

  private noteCar(c: Car, motion: ImpactMotion, step: number): void {
    const touching = wheelsTouch(c.ctl);
    if (c.mem.airborne && touching) {
      const impact = landingImpact(c, motion);
      if (impact > (this.hardest.get(c.v.id)?.impact ?? 0)) this.hardest.set(c.v.id, { impact, step });
    }
    c.mem.airborne = !touching;
  }

  all(): Landing[] {
    return [...this.hardest].map(([vehicle, h]) => ({ vehicle, ...h }));
  }
}

function landingImpact(c: Car, motion: ImpactMotion): number {
  const com = c.body.worldCom();
  const { velocity: v, spin: w } = motion;
  let impact = 0;
  for (let i = 0; i < c.ctl.numWheels(); i++) {
    if (!c.ctl.wheelIsInContact(i)) continue;
    const point = c.ctl.wheelContactPoint(i);
    const normal = c.ctl.wheelContactNormal(i);
    if (!point || !normal) throw new Error(`Wheel ${i} of ${c.v.id} is in contact without a contact point or normal`);
    const r = { x: point.x - com.x, y: point.y - com.y, z: point.z - com.z };
    const at = { x: v.x + w.y * r.z - w.z * r.y, y: v.y + w.z * r.x - w.x * r.z, z: v.z + w.x * r.y - w.y * r.x };
    impact = Math.max(impact, Math.min(-(at.x * normal.x + at.y * normal.y + at.z * normal.z), -at.y));
  }
  return impact;
}

function wheelsTouch(ctl: RAPIER.DynamicRayCastVehicleController): boolean {
  for (let i = 0; i < ctl.numWheels(); i++) if (ctl.wheelIsInContact(i)) return true;
  return false;
}

class Contacts {
  readonly crashes: Crash[] = [];
  readonly breaks: Break[] = [];
  private readonly crashed = new Map<string, number>();
  private readonly breakable: Set<string>;
  private fresh: Break[] = [];
  private freshCrashes: Crash[] = [];

  constructor(w: World) {
    this.breakable = new Set(w.obstacles.filter(isBreakable).map((o) => o.id));
  }

  add(found: Omit<Crash, 'step'> | null, step: number): void {
    if (!found || this.isBroken(found.b)) return;
    const crash = { ...found, step };
    if (this.breakable.has(crash.b) && crash.impact >= BREAKABLE.breakSpeed) {
      const b = { prop: crash.b, vehicle: crash.a, step };
      this.breaks.push(b);
      this.fresh.push(b);
      return;
    }
    this.keepHardest(crash);
  }

  private keepHardest(crash: Crash): void {
    const key = [crash.a, crash.b].sort().join('|');
    const known = this.crashed.get(key);
    if (known === undefined) {
      this.crashed.set(key, this.crashes.length);
      this.crashes.push(crash);
    } else if (crash.impact > this.crashes[known].impact) this.crashes[known] = crash;
    else return;
    this.freshCrashes.push(crash);
  }

  takeNewCrashes(): Crash[] {
    const out = this.freshCrashes;
    this.freshCrashes = [];
    return out;
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

class ClaymoreThrows {
  private readonly blown = new Set<string>();

  constructor(private readonly w: World, private readonly cars: Car[]) {}

  apply(crashes: Crash[]): void {
    for (const crash of crashes) {
      const impact = toTilesPerTurn(crash.impact);
      this.tryBlast(crash.a, crash.b, { impact, own: crash.contact.a, theirs: crash.contact.b });
      if (crash.contact.b) this.tryBlast(crash.b, crash.a, { impact, own: crash.contact.b, theirs: crash.contact.a });
    }
  }

  private tryBlast(userId: string, hitId: string, crash: ClaymoreCrash): void {
    const user = this.cars.find((c) => c.v.id === userId);
    const target = this.targetOf(hitId);
    if (user && target && !this.blown.has(userId)) this.blast(user, target, crash);
  }

  private targetOf(id: string): BlastTarget | null {
    const car = this.cars.find((c) => c.v.id === id);
    if (car) return { car, at: car.body.translation() };
    const obstacle = this.w.obstacles.find((o) => o.id === id);
    return obstacle ? { car: null, at: { x: obstacle.pos.x * S, z: obstacle.pos.y * S } } : null;
  }

  private blast(user: Car, target: BlastTarget, crash: ClaymoreCrash): void {
    const rams = claymoresSetOff(this.w, user.v, target.car?.v ?? null, crash);
    if (rams.length === 0) return;
    this.blown.add(user.v.id);
    const away = awayFrom(user.body.translation(), target.at);
    const { impulse, lift } = claymoreOf(rams[0]).throw;
    throwBody(user.body, away, impulse, lift);
    if (target.car) throwBody(target.car.body, { x: -away.x, z: -away.z }, impulse, lift);
  }
}

type BlastTarget = { car: Car | null; at: { x: number; z: number } };

function awayFrom(from: { x: number; z: number }, at: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(from.x - at.x, from.z - at.z);
  if (length === 0) throw new Error('A claymore blast between two points in one place has no direction');
  return { x: (from.x - at.x) / length, z: (from.z - at.z) / length };
}

function throwBody(body: RAPIER.RigidBody, dir: { x: number; z: number }, impulse: number, lift: number): void {
  const flat = impulse * Math.sqrt(1 - lift * lift);
  body.applyImpulse({ x: dir.x * flat, y: impulse * lift, z: dir.z * flat }, true);
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

function crashOf(h1: number, h2: number, owner: Map<number, string>, obstacleOf: Map<number, string>, d: Drive, before: Map<string, ImpactMotion>, physics: RAPIER.World, state: World): Omit<Crash, 'step'> | null {
  const a = owner.get(h1) ?? owner.get(h2);
  if (a === undefined) return null;
  const [first, other] = owner.get(h1) === a ? [h1, h2] : [h2, h1];
  const va = before.get(a)!;
  if (isGround(d, other)) return captureGroundCrash(physics, state, a, first, other, va);
  return captureCrash(physics, state, before, { a, b: crashTarget(other, owner, obstacleOf, d), first, other }, va);
}

function isGround(d: Drive, handle: number): boolean {
  return handle === d.terrain || d.decks.some((c) => c.plates.includes(handle)) || Object.values(d.craters).some((handles) => handles.includes(handle));
}

function crashTarget(other: number, owner: Map<number, string>, obstacleOf: Map<number, string>, d: Drive): string {
  return owner.get(other) ?? obstacleOf.get(other) ?? (d.decks.some((c) => c.rails.includes(other) || c.lips.includes(other)) ? RAIL : EDGE);
}

function captureCrash(physics: RAPIER.World, state: World, before: Map<string, ImpactMotion>, pair: { a: string; b: string; first: number; other: number }, va: ImpactMotion): Omit<Crash, 'step'> | null {
  const vb = before.get(pair.b) ?? { velocity: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, heading: 0 };
  const vehicle = state.vehicles.find((v) => v.id === pair.a);
  if (!vehicle) throw new Error(`Unknown crash vehicle ${pair.a}`);
  const target = state.vehicles.find((v) => v.id === pair.b) ?? null;
  const hit = readCrashContact(physics, physics.getCollider(pair.first), physics.getCollider(pair.other), vehicle, target, va, vb);
  return hit ? { a: pair.a, b: pair.b, ...hit } : null;
}

function captureGroundCrash(physics: RAPIER.World, state: World, a: string, first: number, ground: number, motion: ImpactMotion): Omit<Crash, 'step'> | null {
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

// Side friction stiffness of wheel `i` (rear wheels are 2 and 3 in wheelMounts order). The rear tires keep only
// rearSideGrip of the front's hold, so a truck that yaws fast swings its tail, while a straight line never slides.
function sideStiffness(i: number, sideGrip: number, share: number): number {
  return T.sideFrictionStiffness * sideGrip * share * (i >= 2 ? T.rearSideGrip : 1);
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
    car.setWheelSideFrictionStiffness(i, sideStiffness(i, 1, 1));
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
  mem.route = path ? { ...keepRoute(w, order.dest, path, blockers, v), radius: s.radius } : null;
  const drive = (next: number) => toMps(engine ? next : speed);
  if (order.kind === 'stopAt') return { ...base, dest: stopPoint(path, order.dest), route: path, target: drive(Math.min(s.maxSpeed, speed + s.accel)), stopAt: true };
  const next = throughSpeed(s, speed, dist(v.pos, order.dest), order.pace);
  return { ...base, dest: order.dest, route: path, target: drive(next), stopAt: false };
}

function stopPoint(path: Vec[] | null, dest: Vec): Vec {
  return path ? path[path.length - 1] : dest;
}

function planOf(w: World, v: Vehicle, full: VehicleStats, body: RAPIER.RigidBody, mem: Memory): Plan {
  const plan = planTurn(w, v, full, body, v.order, mem);
  return isFrozenNpc(w, v) ? { ...plan, engine: false, brakeForce: 0, dest: null, route: null, stopAt: false } : plan;
}

function isFrozenNpc(w: World, v: Vehicle): boolean {
  return w.player.frozen && v.brain !== null && v.id !== w.player.vehicleId;
}

function idleTarget(speed: number): number {
  return speed <= RULES.parkedSpeed ? 0 : toMps(speed);
}

function applyTerrainGrip(c: Car, terrain: Terrain, slick: readonly boolean[]): void {
  const p = c.body.translation();
  const ground = TERRAIN_TYPES[terrain.types[tileAt(terrain, { x: p.x / S, y: p.z / S })]];
  c.grip = ground.grip;
  const grip = T.frictionSlip * groundSpeed(c.s, ground.speed) * ground.grip;
  for (let i = 0; i < 4; i++) {
    const share = slick[i] ? OIL.grip : 1;
    c.ctl.setWheelFrictionSlip(i, grip * share);
    c.ctl.setWheelSideFrictionStiffness(i, sideStiffness(i, ground.sideGrip, share));
  }
}

function oilInReach(patches: readonly { pos: Vec; r: number }[], v: Vehicle, s: VehicleStats, body: RAPIER.RigidBody): Circle[] {
  const half = bodyOf(v.chassisId).half;
  const reach = Math.max(s.maxSpeed, toTilesPerTurn(flatSpeed(body))) + Math.hypot(half.x, half.z) / S;
  return patches.filter((p) => dist(p.pos, v.pos) <= reach + p.r).map((p) => toPhysCircle(p.pos, p.r));
}

const DRY_WHEELS: readonly boolean[] = [false, false, false, false];

function oiledWheels(c: Car): readonly boolean[] {
  const oil = c.oil;
  if (oil.length === 0) return DRY_WHEELS;
  const p = c.body.translation();
  const h = headingOf(c.body.rotation());
  const cos = Math.cos(h);
  const sin = Math.sin(h);
  return wheelMounts(c.b).map((m) => {
    const x = p.x + cos * m.x - sin * m.z;
    const z = p.z + sin * m.x + cos * m.z;
    return oil.some((o) => Math.hypot(x - o.x, z - o.z) <= o.r);
  });
}

function driveStep(c: Car, terrain: Terrain): void {
  const slick = oiledWheels(c);
  applyTerrainGrip(c, terrain, slick);
  oilKick(c, slick);
  const speed = forwardSpeed(c.body);
  const driving = c.plan.dest && !reached(c);
  if (!driving) c.mem.stall = 0;
  const command = driving ? commandToward(c, c.plan.dest!, speed) : { target: c.plan.target, steerTo: 0 };
  if (c.result.arrived) command.target = 0;
  if (!c.plan.dest) {
    c.mem.reverse = false;
    c.mem.backFrom = null;
  }
  turnWheels(c, command.steerTo);
  applyPedals(c, command.target, speed);
}

function oilKick(c: Car, slick: readonly boolean[]): void {
  if (c.kicked || !(slick[2] || slick[3])) return;
  c.kicked = true;
  const up = rotateBy(c.body.rotation(), { x: 0, y: 1, z: 0 });
  const spin = c.body.angvel();
  const kick = tailKick(toTilesPerTurn(flatSpeed(c.body)), slick, spin.x * up.x + spin.y * up.y + spin.z * up.z);
  c.body.setAngvel({ x: spin.x + up.x * kick, y: spin.y + up.y * kick, z: spin.z + up.z * kick }, true);
}

export function tailKick(speed: number, slick: readonly boolean[], yawRate: number): number {
  const size = Math.min(OIL.maxKick, (OIL.kick * Math.max(0, speed - OIL.safeSpeed)) / OIL.safeSpeed);
  return size * kickSide(slick, yawRate);
}

function kickSide(slick: readonly boolean[], yawRate: number): number {
  if (slick[2] && slick[3]) return yawRate < 0 ? -1 : 1;
  if (slick[2]) return -1;
  if (slick[3]) return 1;
  throw new Error('A tail kick needs a rear wheel on oil');
}

function flatSpeed(body: RAPIER.RigidBody): number {
  const v = body.linvel();
  return Math.hypot(v.x, v.z);
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
  const corner = Math.min(cornerSpeed(dist(at, aim) * S, ang), routeCornerSpeed(plan.route, at, Math.abs(speed), plan.stopDecel * c.grip));
  return { target: Math.min(target, corner), steerTo: clamp(ang * D.steerGain, -plan.maxSteer, plan.maxSteer) };
}

function arrivalTarget(c: Car, dest: Vec, at: Vec, heading: number, speed: number): number {
  const far = dist(at, dest) * S;
  if (!c.plan.stopAt) {
    c.result.passed = passedThrough(dest, c.plan.route, c.mem, { x: at.x * S, y: at.y * S }, heading, speed);
    return c.plan.target;
  }
  if (far < RULES.arriveRadius * S) c.result.arrived = true;
  return Math.min(c.plan.target, Math.sqrt(2 * c.plan.stopDecel * c.grip * Math.max(0, far - RULES.arriveRadius * S)));
}

function backs(c: Car, at: Vec, ang: number, rearAng: number, far: number, target: number, speed: number): boolean {
  if (Math.abs(ang) > Math.PI / 2 && backsToPoint(c, rearAng, far, target, speed)) {
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
  const pushing = target >= D.pushSpeed || (target > 0 && c.mem.stall > 0);
  c.mem.stall = pushing && Math.abs(speed) < D.stallSpeed ? c.mem.stall + DT : 0;
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
  const cap = climbForce(c, target);
  const u = clamp((target - speed) * D.throttleGain + slopeThrottle(c, target, cap), -1, 1);
  const more = wantsMore(u, target);
  const pushing = plan.engine && more;
  const brake = more ? 0 : brakeOf(plan, u, target);
  const force = pushing ? u * cap : 0;
  for (let i = 0; i < 4; i++) ctl.setWheelBrake(i, brake);
  for (const i of [2, 3]) ctl.setWheelEngineForce(i, force);
}

function wantsMore(u: number, target: number): boolean {
  return target !== 0 && Math.sign(u) === Math.sign(target);
}

function slopeThrottle(c: Car, target: number, cap: number): number {
  if (target === 0 || !c.plan.engine) return 0;
  const pull = T.gravityScale * PHYSICS.gravity * noseRise(c.body.rotation()) * c.s.mass;
  return pull / (2 * cap);
}

function climbForce(c: Car, target: number): number {
  if (target === 0) return c.plan.engineForce;
  const pull = (T.gravityScale * PHYSICS.gravity * c.s.mass * climbSine(c, Math.sign(target))) / 2;
  return c.plan.engineForce + Math.min(T.climbReserve * c.plan.engineForce, Math.max(0, pull));
}

function contactNormals(c: Car): { x: number; y: number; z: number } {
  const n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < c.ctl.numWheels(); i++) {
    if (!c.ctl.wheelIsInContact(i)) continue;
    const normal = c.ctl.wheelContactNormal(i);
    if (!normal) throw new Error(`Wheel ${i} of ${c.v.id} is in contact without a contact normal`);
    n.x += normal.x;
    n.y += normal.y;
    n.z += normal.z;
  }
  return n;
}

function climbSine(c: Car, sign: number): number {
  const n = contactNormals(c);
  const length = Math.hypot(n.x, n.y, n.z);
  if (length === 0) return 0;
  const heading = headingOf(c.body.rotation());
  const way = { x: Math.cos(heading) * sign, z: Math.sin(heading) * sign };
  const into = (way.x * n.x + way.z * n.z) / (length * length);
  const along = { x: way.x - into * n.x, y: -into * n.y, z: way.z - into * n.z };
  const run = Math.hypot(along.x, along.y, along.z);
  return run === 0 ? 0 : along.y / run;
}

function brakeOf(plan: Plan, u: number, target: number): number {
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
    wheels.push({ steer: car.wheelSteering(i) ?? 0, spin: car.wheelRotation(i) ?? 0, suspension: car.wheelSuspensionLength(i) ?? T.suspensionRest, ground: car.wheelIsInContact(i) });
  }
  const t = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const acc = { x: (v.x - velocityBefore.x) / DT, y: (v.y - velocityBefore.y) / DT, z: (v.z - velocityBefore.z) / DT };
  return { pos: { x: t.x, y: t.y, z: t.z }, rot: { x: r.x, y: r.y, z: r.z, w: r.w }, acc, wheels };
}

export function restFrame(w: World, v: Vehicle): VehicleFrame {
  const q = headingQuat(v.heading);
  return { pos: { x: v.pos.x * S, y: rideHeight(w, v), z: v.pos.y * S }, rot: q, acc: { x: 0, y: 0, z: 0 }, wheels: restWheels(v.chassisId) };
}

export function restWheels(chassisId: string): WheelFrame[] {
  return wheelMounts(bodyOf(chassisId)).map(() => ({ steer: 0, spin: 0, suspension: T.suspensionRest, ground: true }));
}

export function restFrames(w: World, v: Vehicle): VehicleFrame[] {
  return Array.from({ length: TURN_STEPS }, () => restFrame(w, v));
}

export function trailFrames(w: World, v: Vehicle, start: WheelFrame[]): VehicleFrame[] {
  const last = v.trail.length - 1;
  if (last < 1) throw new Error(`Vehicle ${v.id} has no trail to frame`);
  const b = bodyOf(v.chassisId);
  const mounts = wheelMounts(b);
  if (start.length !== mounts.length) throw new Error(`Vehicle ${v.id} starts with ${start.length} wheels, not ${mounts.length}`);
  const spin = start.map((wheel) => wheel.spin);
  let prev = mounts.map((m) => mountPoint(v.trail[0], m));
  const frames: VehicleFrame[] = [];
  for (let i = 1; i <= TURN_STEPS; i++) {
    const t = (i / TURN_STEPS) * last;
    const k = Math.min(Math.floor(t), last - 1);
    const f = t - k;
    const a = v.trail[k];
    const c = v.trail[k + 1];
    const pose = { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, heading: a.heading + angleDiff(a.heading, c.heading) * f };
    const at = mounts.map((m) => mountPoint(pose, m));
    const frame = restFrame(w, { ...v, pos: { x: pose.x, y: pose.y }, heading: pose.heading });
    frame.wheels = frame.wheels.map((wheel, n) => {
      spin[n] += (((at[n].x - prev[n].x) * Math.cos(pose.heading) + (at[n].y - prev[n].y) * Math.sin(pose.heading)) * S * ROLL_SIGN) / b.wheelRadius;
      return { ...wheel, spin: spin[n] };
    });
    prev = at;
    frames.push(frame);
  }
  return frames;
}

const ROLL_SIGN = 1;

function mountPoint(p: Pose, m: { x: number; z: number }): Vec {
  const x = m.x / S;
  const z = m.z / S;
  return { x: p.x + Math.cos(p.heading) * x - Math.sin(p.heading) * z, y: p.y + Math.sin(p.heading) * x + Math.cos(p.heading) * z };
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

function addDecks(world: RAPIER.World, w: World): DeckColliders[] {
  return DECKS.map((deck) => addDeck(world, w, deck));
}

function addDeck(world: RAPIER.World, w: World, deck: Deck): DeckColliders {
  const B = PHYSICS.bridge;
  const halfWidth = (deck.width * S) / 2;
  const segments = deckSegments(w.terrain, deck);
  const plates: number[] = [];
  const rails: number[] = [];
  for (const seg of segments) {
    const box = segmentBox(world, deck, seg);
    const length = seg.length * S;
    plates.push(box({ along: length / 2, up: B.deckThickness / 2, across: halfWidth }, { along: 0, lift: 0, side: 0 }));
    for (const [i, side] of [-1, 1].entries()) {
      const off = railOffset(deck.axis, deck.width, side);
      const a = { x: seg.from.x + off.x, y: seg.from.y + off.y };
      const b = { x: seg.to.x + off.x, y: seg.to.y + off.y };
      const depth = deck.skirt ? skirtDepth(w.terrain, a, b, seg.h0, seg.h1) : 0;
      rails.push(box({ along: length / 2, up: (B.railHeight + depth) / 2, across: B.railThickness / 2 }, { along: 0, lift: B.railHeight, side: (i === 0 ? -1 : 1) * halfWidth }));
    }
  }
  const lips = deck.lips.map(([a, b]) => {
    const atTo = (a.x - deck.from.x) * deck.axis.x + (a.y - deck.from.y) * deck.axis.y > deck.length / 2;
    const seg = atTo ? segments[segments.length - 1] : segments[0];
    const h = atTo ? seg.h1 : seg.h0;
    const depth = skirtDepth(w.terrain, a, b, h, h);
    const end = (atTo ? 1 : -1) * ((seg.length * S) / 2 - B.railThickness / 2);
    return segmentBox(world, deck, seg)({ along: B.railThickness / 2, up: depth / 2, across: halfWidth }, { along: end, lift: 0, side: 0 });
  });
  return { plates, rails, lips };
}

function segmentBox(world: RAPIER.World, deck: Deck, seg: DeckSegment) {
  const { axis } = deck;
  const pitch = Math.atan2((seg.h1 - seg.h0) * S, seg.length * S);
  const yaw = headingQuat(Math.atan2(axis.y, axis.x));
  const rot = { x: yaw.y * Math.sin(pitch / 2), y: yaw.y * Math.cos(pitch / 2), z: yaw.w * Math.sin(pitch / 2), w: yaw.w * Math.cos(pitch / 2) };
  const along = { x: Math.cos(pitch) * axis.x, y: Math.sin(pitch), z: Math.cos(pitch) * axis.y };
  const up = { x: -Math.sin(pitch) * axis.x, y: Math.cos(pitch), z: -Math.sin(pitch) * axis.y };
  const across = { x: -axis.y, z: axis.x };
  const mid = {
    x: (seg.from.x + (axis.x * seg.length) / 2) * S,
    y: ((seg.h0 + seg.h1) / 2) * S,
    z: (seg.from.y + (axis.y * seg.length) / 2) * S,
  };
  return (half: { along: number; up: number; across: number }, at: { along: number; lift: number; side: number }): number => {
    const c = at.lift - half.up;
    const desc = RAPIER.ColliderDesc.cuboid(half.along, half.up, half.across)
      .setTranslation(
        mid.x + along.x * at.along + up.x * c + across.x * at.side,
        mid.y + along.y * at.along + up.y * c,
        mid.z + along.z * at.along + up.z * c + across.z * at.side,
      )
      .setRotation(rot);
    return world.createCollider(desc).handle;
  };
}

function skirtDepth(t: Terrain, a: Vec, b: Vec, h0: number, h1: number): number {
  const steps = Math.max(1, Math.ceil(dist(a, b)));
  let depth = 0;
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    const line = h0 + (h1 - h0) * f;
    const ground = groundAt(t, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    depth = Math.max(depth, (line - ground) * S + PHYSICS.rockSink);
  }
  return depth;
}
