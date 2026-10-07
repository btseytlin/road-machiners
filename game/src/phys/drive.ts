// Physics driving for every vehicle. The map's terrain and obstacles become Rapier colliders; each
// vehicle is a ray-cast car. Time only moves inside simulateTurn. A turn restores the world from a
// snapshot and runs it forward, so the same state and orders always give the same result: the
// preview is the turn itself.

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
import type { Crater, MoveOrder, Obstacle, Vehicle, World } from '../sim/types';
import { angleDiff, bearing, clamp, DEG, dist, type Vec } from '../sim/vec';
import { bodyOf, type Body } from '../sim/body';
import { wheelMounts } from './body';
import { computeClosingSpeed, locateCrashContact, type CrashGeometry } from '../sim/crash-contact';
import { headingOf, headingQuat, noseRise, rotateBy, toPhys, toPhysCircle, upOf, type Circle, type Quat, type TurnFrames, type V3, type VehicleFrame } from './frames';
import { oilPatches } from '../sim/hazards';
import { lineAnchors, type BodyPoint, type LineAnchor } from '../sim/harpoon';
import { HARPOON, OIL } from '../data/utilities';

const S = PHYSICS.metersPerTile;
const T = PHYSICS.truck;
const D = PHYSICS.driver;
const DT = 1 / PHYSICS.stepsPerSecond;
export const TURN_STEPS = Math.round(PHYSICS.turnSeconds * PHYSICS.stepsPerSecond);
const TELEPORT_TILES = 0.5; // a sim position this far from its body was moved by the rules, not by driving
const WALL = 50; // meters of wall thickness at the map edge
export const EDGE = 'edge'; // the crash target name for the map border
export const RAIL = 'rail'; // the crash target name for a deck rail
export const GROUND = 'ground'; // the crash target name for the terrain and a deck under a truck's body

// Tiles per turn to meters per second, and back.
export const toMps = (tilesPerTurn: number) => (tilesPerTurn * S) / PHYSICS.turnSeconds;
export const toTilesPerTurn = (mps: number) => (mps * PHYSICS.turnSeconds) / S;

// The driver's memory between turns: current wheel angle, and whether it backed at the last step.
// route is the rest of the route driven last turn, so a driver keeps following it instead of planning
// the whole way again every turn.
// ahead holds the drive-through point that was ahead of the nose on the last leg at the last step.
// stall holds the seconds the truck has pushed forward at a point behind it without moving.
// backFrom is the point, in tiles, where the current back-out from a blockage began, or null.
// airborne is true when no wheel touched the ground at the last step, so a jump that spans two turns still lands.
type Memory = { steer: number; reverse: boolean; route: (KeptRoute & { radius: number }) | null; ahead: Vec | null; stall: number; backFrom: Vec | null; airborne: boolean };

// Everything a turn needs to start: the physics world, which body and collider belongs to which
// vehicle or obstacle, and each driver's memory.
export type Drive = {
  world: RAPIER.World;
  bodies: Record<string, number>; // vehicle id to rigid body handle
  obstacles: Record<string, number[]>; // obstacle id to its collider handles
  craters: Record<string, number[]>; // crater id to its rim collider handles
  memory: Record<string, Memory>;
  terrain: number; // terrain collider handle
  decks: DeckColliders[]; // one per deck in DECKS, in order
};

// Collider handles of one deck: a plate and two rails per straight piece, and its lips.
export type DeckColliders = { plates: number[]; rails: number[]; lips: number[] };

export type Crash = { a: string; b: string; impact: number; contact: CrashGeometry; step: number }; // b is a vehicle id, an obstacle id, 'edge', 'rail' or 'ground'; impact in m/s
export type Break = { prop: string; vehicle: string; step: number }; // a breakable prop the vehicle smashed through at this physics step
export type VehicleResult = { passed: boolean; arrived: boolean };
export type Landing = { vehicle: string; impact: number; step: number }; // wheels touching down after a jump, impact in m/s: the speed into the ground along the contact normal, counted only while also moving downward
export type Tear = { line: string; step: number }; // a harpoon line that tore at this physics step
export type TurnResult = { next: Drive; frames: TurnFrames; crashes: Crash[]; breaks: Break[]; landings: Landing[]; tears: Tear[]; results: Record<string, VehicleResult> };

export type DriveSnapshot = Omit<Drive, "world"> & { snapshot: Uint8Array };

export function captureDrive(drive: Drive): DriveSnapshot {
  const { world, ...handles } = drive;
  return { ...structuredClone(handles), snapshot: world.takeSnapshot() };
}

// Each Drive and DriveSnapshot owns its handle records, so a sync of a restored drive never reaches the snapshot it came from.
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

// Brings the physics world in line with the sim: new and removed vehicles and obstacles, vehicle
// masses after loadout changes, and vehicles moved outside physics, such as by a debug script.
// Only near vehicles keep a body. A far vehicle loses its body and driver memory, and gets a new body
// at its sim pose once it comes near again.
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

// Rapier looks up by index only, so a stale handle reads as null or as another object.
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

// Only obstacles that block driving get colliders. Site props are scenery; the site boundary blocks instead. Every
// physics step costs time per collider in the world, so a prop gets colliders only while a truck with a body could
// reach it this turn: bodies stay within the near radius of the player, and PHYSICS.propLiveMargin covers a turn.
function syncObstacles(d: Drive, w: World): void {
  const live = w.obstacles.filter((o) => isDriveObstacle(o) && inLiveRange(w, o.pos, obstacleReach(o)));
  dropColliders(d, d.obstacles, new Set(live.map((o) => o.id)));
  for (const o of live) {
    if (d.obstacles[o.id] === undefined) d.obstacles[o.id] = addColliders(d, obstacleColliders(w.terrain, o));
  }
}

// Whether something at pos, reaching `reach` tiles around it, lies where a truck with a body could touch it this turn.
function inLiveRange(w: World, pos: Vec, reach: number): boolean {
  const range = TERRAIN.vision.radius + PERF.liveMargin + PHYSICS.propLiveMargin;
  return dist(pos, playerVehicle(w).pos) <= range + reach;
}

// Removes the colliders of every entry of `record` whose id is not in `keep`.
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

// A crater's rim gets colliders in the same range as props. A rim made under a truck would pop it into the air, so
// it waits while any truck body stands within the crater's reach, and each sync tries again.
function syncCraters(d: Drive, w: World): void {
  const live = w.craters.filter((c) => inLiveRange(w, c.pos, craterReach(c)));
  dropColliders(d, d.craters, new Set(live.map((c) => c.id)));
  for (const c of live) {
    if (d.craters[c.id] === undefined && clearOfBodies(d, w, c)) d.craters[c.id] = addColliders(d, craterColliders(w.terrain, c));
  }
}

// Whether every vehicle body's centre is farther from the crater than the vehicle's radius plus the crater's reach.
function clearOfBodies(d: Drive, w: World, c: Crater): boolean {
  return w.vehicles.every((v) => {
    const handle = d.bodies[v.id];
    if (handle === undefined) return true;
    const t = d.world.getRigidBody(handle).translation();
    return dist({ x: t.x / S, y: t.z / S }, c.pos) > chassisDef(v.chassisId).radius + craterReach(c);
  });
}

// A ring of capsules, one between each pair of neighbouring rim points on the ground, sunk so CRATER.rimRatio of
// the crater's radius shows above it. The ring follows the slope. The bowl is not dug: the heightfield is static.
export function craterColliders(t: Terrain, c: Crater): RAPIER.ColliderDesc[] {
  const rim = craterRimPoints(c).map((p) => toPhys(p, groundAt(t, p.x, p.y)));
  const radius = (CRATER.rimWidthRatio * c.radius) / 2;
  const lift = CRATER.rimRatio * c.radius - radius;
  return rim.map((a, k) => capsuleBetween(a, rim[(k + 1) % rim.length], radius, lift));
}

// A capsule of the given radius whose axis runs from a to b, raised `lift` meters.
function capsuleBetween(a: V3, b: V3, radius: number, lift: number): RAPIER.ColliderDesc {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(u.x, u.y, u.z);
  if (!(len > 0)) throw new Error('Capsule between one point');
  const desc = RAPIER.ColliderDesc.capsule(len / 2, radius).setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2);
  return desc.setRotation(upOnto({ x: u.x / len, y: u.y / len, z: u.z / len }));
}

// The quaternion that turns +y onto the unit vector u, about the axis +y x u. Not for u pointing straight down.
function upOnto(u: V3): Quat {
  const w = 1 + u.y;
  const n = Math.hypot(u.z, u.x, w);
  return { x: u.z / n, y: 0, z: -u.x / n, w: w / n };
}

// A site's boundary blocks as a cylinder of its radius. A prop blocks by its model's boxes at the pose the view
// draws it: turned by yaw and scaled, standing at propBase() in src/sim/bridge.ts. Boxes that start above truck
// roofs are left out, so trucks pass under canopies. A box that starts lower than PHYSICS.rockSink reaches that far
// below the ground, so slopes leave no gap under it.
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

// A stranded truck is set back on its wheels at its sim pose, which applyTurn has moved to free ground.
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
  // The boxes carry no density: setMass gives the body its mass, center and inertia.
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

// Mass from the vehicle's load, with box inertia per axis, scaled up, around a center of mass lowered toward the axles.
function setMass(body: RAPIER.RigidBody, v: Vehicle): void {
  const h = bodyOf(v.chassisId).half;
  const mass = vehicleMass(v);
  const k = (mass / 3) * T.inertiaScale; // m/12 * (2a)^2 = m/3 * a^2
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

// Runs one turn of the sim's orders from a copy of the physics world. The input drive stays untouched.
// Call syncDrive first so the physics world matches the sim. Only vehicles with a body drive and get
// frames; far vehicles travel through advanceFar instead.
export function simulateTurn(d: Drive, w: World): TurnResult {
  return run(d, w, TURN_STEPS);
}

function noteOwner(owner: Map<number, string>, body: RAPIER.RigidBody, vehicleId: string): void {
  for (let i = 0; i < body.numColliders(); i++) owner.set(body.collider(i).handle, vehicleId);
}

// oil holds the oil patches the car can reach this turn, in physics space. kicked is true once oil kicked its tail this turn.
type Car = { v: Vehicle; s: VehicleStats; b: Body; body: RAPIER.RigidBody; ctl: RAPIER.DynamicRayCastVehicleController; mem: Memory; plan: Plan; result: VehicleResult; oil: Circle[]; kicked: boolean };

function run(d: Drive, w: World, steps: number): TurnResult {
  const world = RAPIER.World.restoreSnapshot(d.world.takeSnapshot());
  world.timestep = DT;
  const events = new RAPIER.EventQueue(true);
  const memory: Record<string, Memory> = structuredClone(d.memory);
  // Oil patches are fixed for the turn, so each car keeps the ones it can reach once, and the steps never read the sim.
  const oil = oilPatches(w);
  const cars: Car[] = w.vehicles.filter((v) => d.bodies[v.id] !== undefined).map((v) => {
    const body = world.getRigidBody(d.bodies[v.id]);
    const s = vehicleStats(w, v);
    const b = bodyOf(v.chassisId);
    const mem = memory[v.id];
    return { v, s, b, body, ctl: makeCar(world, body, b, s.mass), mem, plan: planTurn(w, v, s, body, v.order, mem), result: { passed: false, arrived: false }, oil: oilInReach(oil, v, s, body), kicked: false };
  });
  const owner = new Map<number, string>(); // collider handle to vehicle id
  for (const c of cars) noteOwner(owner, c.body, c.v.id);
  const obstacleOf = new Map(Object.entries(d.obstacles).flatMap(([id, handles]) => handles.map((h) => [h, id] as const)));

  const frames: TurnFrames = Object.fromEntries(cars.map((c) => [c.v.id, [] as VehicleFrame[]]));
  const contacts = new Contacts(w);
  const landings = new Landings();
  // Harpoon lines are fixed for the turn too: their anchors come in body space, so the steps only read the bodies.
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
    for (const c of cars) frames[c.v.id].push(frameOf(c.ctl, c.body, before.get(c.v.id)!.velocity));
  }
  for (const c of cars) world.removeVehicleController(c.ctl);
  events.free();
  const results = Object.fromEntries(cars.map((c) => [c.v.id, c.result]));
  const obstacles = Object.fromEntries(Object.entries(d.obstacles).filter(([id]) => !contacts.isBroken(id)));
  return { next: { world, bodies: { ...d.bodies }, obstacles, craters: { ...d.craters }, memory, terrain: d.terrain, decks: d.decks }, frames, crashes: contacts.crashes, breaks: contacts.breaks, landings: landings.all(), tears: lines.tears, results };
}

// Harpoon lines between two trucks with bodies. A line is a one-sided spring on the ground plane between its anchors:
// past its length it pulls both trucks toward each other with HARPOON.stiffness per meter of stretch plus
// HARPOON.damping on the separating speed, and never pushes. A pull above HARPOON.tearForce tears it for the rest of
// the turn. A line with a far truck does nothing.
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
      const force = pullLine(h.line, h.a.body, h.b.body);
      if (force > HARPOON.tearForce) this.tears.push({ line: h.line.id, step });
    }
  }
}

// Pulls the two bodies together when the line is stretched, unless the pull tears it. Returns the pull in newtons.
function pullLine(line: LineAnchor, a: RAPIER.RigidBody, b: RAPIER.RigidBody): number {
  const pa = worldPoint(a, line.fromAt);
  const pb = worldPoint(b, line.toAt);
  const gap = Math.hypot(pb.x - pa.x, pb.z - pa.z);
  if (gap <= line.length) return 0;
  const n = { x: (pb.x - pa.x) / gap, z: (pb.z - pa.z) / gap };
  const va = a.velocityAtPoint(pa);
  const vb = b.velocityAtPoint(pb);
  const separating = (vb.x - va.x) * n.x + (vb.z - va.z) * n.z;
  const force = Math.max(0, HARPOON.stiffness * (gap - line.length) + HARPOON.damping * separating);
  if (force > HARPOON.tearForce) return force;
  const j = force * DT;
  a.applyImpulseAtPoint({ x: n.x * j, y: 0, z: n.z * j }, pa, true);
  b.applyImpulseAtPoint({ x: -n.x * j, y: 0, z: -n.z * j }, pb, true);
  return force;
}

// A body-space point of a body in physics space.
function worldPoint(body: RAPIER.RigidBody, at: BodyPoint): V3 {
  const t = body.translation();
  const r = rotateBy(body.rotation(), at);
  return { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
}

// The hardest landing of each truck this turn: its wheels touch the ground after a step with every wheel in the air.
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

// The hardest speed into the ground over the wheels touching it, from the body's motion before the step: the
// motion at each contact point against that wheel's contact normal. Only motion that is also downward counts, so a
// truck meeting a slope along it lands softly, and one whose wheels meet a rising bump face drives up it.
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

// The turn's crashes and breaks. A contact with a breakable prop at BREAKABLE.breakSpeed or faster breaks it
// instead of crashing. Slower, the prop holds and the contact is a crash like any other. One crash per pair per turn.
class Contacts {
  readonly crashes: Crash[] = [];
  readonly breaks: Break[] = [];
  private readonly crashed = new Set<string>();
  private readonly breakable: Set<string>;
  private fresh: Break[] = [];

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
    const key = [crash.a, crash.b].sort().join('|');
    if (this.crashed.has(key)) return;
    this.crashed.add(key);
    this.crashes.push(crash);
  }

  isBroken(id: string): boolean {
    return this.breaks.some((b) => b.prop === id);
  }

  // Breaks since the last call.
  takeNewBreaks(): Break[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
}

// Removes each broken prop's colliders and gives the truck that broke it back its motion from before the hit, less
// the BREAKABLE.slowdown share of its speed, so it drives on through where the prop stood.
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

// A deck and a crater rim are ground, like the terrain.
function isGround(d: Drive, handle: number): boolean {
  return handle === d.terrain || d.decks.some((c) => c.plates.includes(handle)) || Object.values(d.craters).some((handles) => handles.includes(handle));
}

// The name of what a truck hit: a vehicle id, an obstacle id, a rail or the map edge.
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

// The truck's body, not its wheels, hitting the ground: a flip, a nose dive off a jump or a slam into a steep bank.
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
    // The normal out of the truck in its own frame, so a truck on its side or roof takes the hit where it lands.
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

// What a driver wants this turn, fixed at the start of the turn like the 2D rules: a destination to
// steer at, and a speed from the throttle zone of the click. Without fuel the engine gives nothing.
// route holds the planner's waypoints to dest, or null for a careless driver who drives straight.
type Plan = { dest: Vec | null; route: Vec[] | null; target: number; stopAt: boolean; engine: boolean; maxSteer: number; engineForce: number; brakeForce: number; stopDecel: number };

function planTurn(w: World, v: Vehicle, full: VehicleStats, body: RAPIER.RigidBody, order: MoveOrder | null, mem: Memory): Plan {
  const ch = chassisDef(v.chassisId);
  const speed = Math.max(0, toTilesPerTurn(forwardSpeed(body)));
  const s = fuelLimited(w, v, full, speed, order);
  const engine = s.maxSpeed > 0;
  // The stats accel already falls with load, so the engine force stays fixed as mass grows.
  // Brakes grip with a force sized for the handling mass, so a heavy truck brakes worse.
  const base = {
    engine,
    maxSteer: T.maxSteer * (s.turnSlow / (ch.turnSlow * DEG)),
    engineForce: (full.mass * T.engineAccel * (s.accel / ch.accel)) / 2,
    brakeForce: T.brakeForce * (ch.handlingMass / 1000),
    stopDecel: D.stopDecel * (ch.handlingMass / full.mass), // the stop plan brakes as hard as this load allows
  };
  if (!order) return { ...base, dest: null, route: null, target: idleTarget(speed), stopAt: false };
  if (order.kind === 'brake') return { ...base, dest: null, route: null, target: 0, stopAt: false };
  // Careful drivers follow the route planner, which keeps to roads and goes around obstacles and traffic; careless ones drive straight.
  const blockers = routeBlockers(w, v);
  // A point that moved less than the arrival radius, like the stop point of a town seen from a new angle, is the same place.
  const stored = mem.route && dist(mem.route.dest, order.dest) < RULES.arriveRadius && mem.route.radius === s.radius ? continueRoute(w, v.pos, mem.route, order.dest, s.radius, blockers, v) : null;
  const path = v.direct ? null : stored ?? [...route(w, v.pos, order.dest, s.radius, blockers, v)]; // copied, since driving consumes it
  mem.route = path ? { ...keepRoute(w, order.dest, path, blockers), radius: s.radius } : null;
  // Without engine force, as while an emitter pulse shuts the truck down, the driver can only keep the speed it has:
  // it coasts and steers, and brakes only to stop on a stop point.
  const drive = (next: number) => toMps(engine ? next : speed);
  if (order.kind === 'stopAt') return { ...base, dest: stopPoint(path, order.dest), route: path, target: drive(Math.min(s.maxSpeed, speed + s.accel)), stopAt: true };
  const next = throughSpeed(s, speed, dist(v.pos, order.dest), order.pace);
  return { ...base, dest: order.dest, route: path, target: drive(next), stopAt: false };
}

// A stop order arrives at the route's end, which is the closest point the planner reaches when the order point
// itself cannot be reached, as in far travel. A careless driver has no route and stops on the order point.
function stopPoint(path: Vec[] | null, dest: Vec): Vec {
  return path ? path[path.length - 1] : dest;
}

// Without an order a moving truck coasts on, and a parked one holds its brakes, so it does not roll down a slope.
function idleTarget(speed: number): number {
  return speed <= RULES.parkedSpeed ? 0 : toMps(speed);
}

// Loose ground gives less grip, so wheels spin instead of converting engine force to speed. A skilled driver
// loses less of it. Slope needs no separate handling: it already slows or speeds the climb through gravity on
// the heightfield. A wheel whose hub lies over any oil patch, as `slick` says in wheelMounts order, keeps OIL.grip of
// its friction slip and side friction stiffness. Overlapping patches count once.
function applyTerrainGrip(c: Car, terrain: Terrain, slick: readonly boolean[]): void {
  const p = c.body.translation();
  const type = terrain.types[tileAt(terrain, { x: p.x / S, y: p.z / S })];
  const grip = T.frictionSlip * groundSpeed(c.s, TERRAIN_TYPES[type].speed);
  for (let i = 0; i < 4; i++) {
    const share = slick[i] ? OIL.grip : 1;
    c.ctl.setWheelFrictionSlip(i, grip * share);
    c.ctl.setWheelSideFrictionStiffness(i, T.sideFrictionStiffness * share);
  }
}

// The oil patches a car can reach this turn: those within its top speed for the turn, or its speed now if faster,
// plus its half diagonal and the patch's radius. One pass over the turn's patches per car per turn.
function oilInReach(patches: readonly { pos: Vec; r: number }[], v: Vehicle, s: VehicleStats, body: RAPIER.RigidBody): Circle[] {
  const half = bodyOf(v.chassisId).half;
  const reach = Math.max(s.maxSpeed, toTilesPerTurn(flatSpeed(body))) + Math.hypot(half.x, half.z) / S;
  return patches.filter((p) => dist(p.pos, v.pos) <= reach + p.r).map((p) => toPhysCircle(p.pos, p.r));
}

const DRY_WHEELS: readonly boolean[] = [false, false, false, false];

// Whether each wheel's hub, in wheelMounts order, lies over any oil patch the car can reach.
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

// One physics step of driving. Steer at the destination and hold the turn's speed. A stop order slows
// to arrive. A drive-through point counts as passed once close, or once the truck drives forward past
// it on the last leg, so a wide miss does not circle back. A side click behind the truck still steers.
function driveStep(c: Car, terrain: Terrain): void {
  const slick = oiledWheels(c);
  applyTerrainGrip(c, terrain, slick);
  oilKick(c, slick);
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

// The tail kick. At the first step this turn that a rear wheel is on oil, the yaw rate about the truck's up axis jumps
// by tailKick. Physics then decides how far the swing grows on the low grip.
function oilKick(c: Car, slick: readonly boolean[]): void {
  if (c.kicked || !(slick[2] || slick[3])) return;
  c.kicked = true;
  const up = rotateBy(c.body.rotation(), { x: 0, y: 1, z: 0 });
  const spin = c.body.angvel();
  const kick = tailKick(toTilesPerTurn(flatSpeed(c.body)), slick, spin.x * up.x + spin.y * up.y + spin.z * up.z);
  c.body.setAngvel({ x: spin.x + up.x * kick, y: spin.y + up.y * kick, z: spin.z + up.z * kick }, true);
}

// The tail kick's yaw rate change in rad/s about the truck's up axis, for a truck at `speed` tiles per turn whose
// wheels in wheelMounts order are on oil as `slick` says, turning at `yawRate` rad/s about its up axis. A positive
// rate turns the nose toward the truck's left. The kick is OIL.kick for each OIL.safeSpeed above OIL.safeSpeed, up
// to OIL.maxKick. It swings the tail toward the oiled rear wheel. With both rear wheels on oil it adds to the yaw
// rate, and with no yaw rate it turns the nose left. Throws without a rear wheel on oil.
export function tailKick(speed: number, slick: readonly boolean[], yawRate: number): number {
  const size = Math.min(OIL.maxKick, (OIL.kick * Math.max(0, speed - OIL.safeSpeed)) / OIL.safeSpeed);
  return size * kickSide(slick, yawRate);
}

// +1 turns the nose left and the tail right, -1 the other way. Wheel 2 is the left rear and 3 the right rear.
function kickSide(slick: readonly boolean[], yawRate: number): number {
  if (slick[2] && slick[3]) return yawRate < 0 ? -1 : 1;
  if (slick[2]) return -1;
  if (slick[3]) return 1;
  throw new Error('A tail kick needs a rear wheel on oil');
}

// The body's speed along the ground in m/s, whichever way it moves.
function flatSpeed(body: RAPIER.RigidBody): number {
  const v = body.linvel();
  return Math.hypot(v.x, v.z);
}

type Command = { target: number; steerTo: number }; // target in m/s along the nose, steerTo in radians of wheel angle

function reached(c: Car): boolean {
  return c.result.passed || c.result.arrived;
}

// Steer at the next route point far enough ahead, or at the destination.
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
    // Backing up turns the truck the opposite way from the wheels.
    const rearAng = angleDiff(heading + Math.PI, bearing(at, aim));
    // Backing out of a blockage swings the nose toward the aim instead.
    const gain = c.mem.backFrom ? D.steerGain : -D.steerGain;
    return { target: -Math.min(D.reverseSpeed, plan.target), steerTo: clamp(rearAng * gain, -plan.maxSteer, plan.maxSteer) };
  }
  const corner = Math.min(cornerSpeed(dist(at, aim) * S, ang), routeCornerSpeed(plan.route, at, Math.abs(speed), plan.stopDecel));
  return { target: Math.min(target, corner), steerTo: clamp(ang * D.steerGain, -plan.maxSteer, plan.maxSteer) };
}

// The turn's target speed, capped by a stop order's braking curve. Marks the destination arrived or passed.
function arrivalTarget(c: Car, dest: Vec, at: Vec, heading: number, speed: number): number {
  const far = dist(at, dest) * S;
  if (!c.plan.stopAt) {
    c.result.passed = passedThrough(dest, c.plan.route, c.mem, { x: at.x * S, y: at.y * S }, heading, speed);
    return c.plan.target;
  }
  if (far < RULES.arriveRadius * S) c.result.arrived = true;
  return Math.min(c.plan.target, Math.sqrt(2 * c.plan.stopDecel * Math.max(0, far - RULES.arriveRadius * S)));
}

// Whether the truck backs up this step. It backs only while its aim is behind the nose and a reason holds.
// Reason one: backsToDestination allows it. It starts below reverseBelow and holds while the rule holds.
// Reason two: something in front stopped it. It backs RULES.reverse.distance tiles from where the back-out
// began, then tries nose first again. Any other point behind turns the truck around nose first.
// at: truck position in tiles. ang: aim off the nose. rearAng: destination off straight behind. Both in radians; far in tiles.
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

// Reason one: backing to the destination. It starts on a slow truck and holds while backsToDestination does.
function backsToPoint(c: Car, rearAng: number, far: number, target: number, speed: number): boolean {
  const starts = target > 0 && Math.abs(speed) < D.reverseBelow;
  return backsToDestination(c.v, far, rearAng) && (c.mem.reverse || starts);
}

// Counts the seconds a truck pushes forward without moving, and says whether that lasted long enough to back up.
function blockedInFront(c: Car, target: number, speed: number): boolean {
  c.mem.stall = target > 0 && Math.abs(speed) < D.stallSpeed ? c.mem.stall + DT : 0;
  return c.mem.stall >= D.stallSeconds;
}

function turnWheels(c: Car, steerTo: number): void {
  const step = T.steerRate * DT;
  c.mem.steer = clamp(steerTo, c.mem.steer - step, c.mem.steer + step);
  // Positive wheel steering turns toward -z; map headings grow toward +z.
  c.ctl.setWheelSteering(0, -c.mem.steer);
  c.ctl.setWheelSteering(1, -c.mem.steer);
}

// Throttle toward the target speed, plus the engine share that cancels gravity along the nose,
// so a truck holds its speed on a slope. Without engine push the truck brakes when it is too fast. A truck with no
// engine force at all coasts while it is too slow.
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

// The throttle asks for more speed along the target's direction, so the driver does not brake.
function wantsMore(u: number, target: number): boolean {
  return target !== 0 && Math.sign(u) === Math.sign(target);
}

// Throttle share that holds the truck against gravity along its nose, at cap force per driven wheel. A truck holding
// still brakes instead, and a truck with no engine force has no throttle to hold with.
function slopeThrottle(c: Car, target: number, cap: number): number {
  if (target === 0 || !c.plan.engine) return 0;
  const pull = T.gravityScale * PHYSICS.gravity * noseRise(c.body.rotation()) * c.s.mass;
  return pull / (2 * cap);
}

// Full-throttle force of each driven wheel: the plan's engine force, plus a reserve against a climb in the direction
// the engine pushes. The reserve is at most climbReserve of the engine force and never more than gravity's pull along
// the ground the wheels stand on, so flat ground, downhill and the air get none.
function climbForce(c: Car, target: number): number {
  if (target === 0) return c.plan.engineForce;
  const pull = (T.gravityScale * PHYSICS.gravity * c.s.mass * climbSine(c, Math.sign(target))) / 2;
  return c.plan.engineForce + Math.min(T.climbReserve * c.plan.engineForce, Math.max(0, pull));
}

// Sum of the contact normals of the wheels touching the ground, as of the last vehicle update.
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

// Sine of the grade under the wheels along the nose, or along the tail for a sign of -1: positive uphill. The ground
// is the mean contact normal of the wheels touching it. 0 when no wheel touches.
function climbSine(c: Car, sign: number): number {
  const n = contactNormals(c);
  const length = Math.hypot(n.x, n.y, n.z);
  if (length === 0) return 0;
  const heading = headingOf(c.body.rotation());
  const way = { x: Math.cos(heading) * sign, z: Math.sin(heading) * sign };
  // The travel direction laid onto the ground plane; its vertical share is the grade's sine.
  const into = (way.x * n.x + way.z * n.z) / (length * length);
  const along = { x: way.x - into * n.x, y: -into * n.y, z: way.z - into * n.z };
  const run = Math.hypot(along.x, along.y, along.z);
  // A wall contact normal parallel to the travel direction leaves no ground direction to climb along.
  return run === 0 ? 0 : along.y / run;
}

// A truck holding still brakes fully on top of the throttle's brake share.
function brakeOf(plan: Plan, u: number, target: number): number {
  return Math.abs(u) * plan.brakeForce + (target === 0 ? plan.brakeForce : 0);
}

// Whether a drive-through point is passed: the truck is close, or it drove forward past the point
// on the last leg. `at` is in physics meters. Records in mem whether the point is ahead now.
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

// The fastest speed that still curves onto a point `aimDist` meters away, `ang` off the nose. The arc
// that leaves along the nose and ends on the point has radius aimDist / (2 sin ang). Without this cap a
// fast truck circles a point inside its turning circle forever.
function cornerSpeed(aimDist: number, ang: number): number {
  const sin = Math.abs(Math.sin(ang));
  return sin === 0 ? Infinity : Math.sqrt((D.cornerAccel * aimDist) / (2 * sin));
}

// The fastest speed now that still brakes in time for every route corner ahead. A corner turned by
// theta is driven as an arc that starts cornerCut before it, of radius cornerCut / tan(theta / 2).
// Theta runs to the route point cornerCut past the corner, so a sharp turn split into small steps counts whole.
// Corners past the braking distance at the current speed cannot limit it, so the scan stops there.
// A driver without a route drives straight and has no corners.
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

// The route point at least `d` tiles along the route after point k, or the last one.
function pointAfter(route: Vec[], k: number, d: number): Vec {
  let along = 0;
  for (let i = k + 1; i < route.length; i++) {
    along += dist(route[i - 1], route[i]);
    if (along >= d) return route[i];
  }
  return route[route.length - 1];
}

// The truck covers several route points in one turn. Points it has come close to or driven past
// drop off the front of the route, so it never turns back for one behind it.
export function routeAim(route: Vec[], at: Vec): Vec {
  while (route.length > 1 && (dist(at, route[0]) < RULES.minAimDistance || passed(at, route[0], route[1]))) route.shift();
  return route[0];
}

// Whether the truck is beyond point a along the segment from a to b.
function passed(at: Vec, a: Vec, b: Vec): boolean {
  return (at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y) > 0;
}

// Speed along the truck's nose, m/s; negative when backing up.
export function forwardSpeed(body: RAPIER.RigidBody): number {
  const v = body.linvel();
  const h = headingOf(body.rotation());
  return v.x * Math.cos(h) + v.z * Math.sin(h);
}

// velocityBefore: the body's velocity before this step, for the step's acceleration.
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

// A vehicle standing on the ground at its sim pose, wheels at rest. For vehicles that have not
// driven a turn yet, such as ones that spawned at the end of the last turn.
export function restFrame(w: World, v: Vehicle): VehicleFrame {
  const b = bodyOf(v.chassisId);
  const q = headingQuat(v.heading);
  const wheels = wheelMounts(b).map(() => ({ steer: 0, spin: 0, suspension: T.suspensionRest, ground: true }));
  return { pos: { x: v.pos.x * S, y: rideHeight(w, v), z: v.pos.y * S }, rot: q, acc: { x: 0, y: 0, z: 0 }, wheels };
}

// Frames for a vehicle that jumped this turn, with no trail to follow: it stands at its sim pose all turn.
export function restFrames(w: World, v: Vehicle): VehicleFrame[] {
  return Array.from({ length: TURN_STEPS }, () => restFrame(w, v));
}

// Frames for a vehicle that moved without physics: rest poses along its trail, one per physics step,
// ending on its sim pose. Far vehicles get these so the view moves them smoothly, like driven ones.
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

// Height of the body center for a truck standing at its sim position with springs at rest.
function rideHeight(w: World, v: Vehicle): number {
  const b = bodyOf(v.chassisId);
  return heightAt(w.terrain, v.pos.x, v.pos.y) * S + b.wheelRadius + T.suspensionRest - b.wheelY;
}

// Whether the vehicle's body rests high above the ground at its sim position, so its wheels hang in the air.
export function isLifted(d: Drive, w: World, v: Vehicle): boolean {
  const handle = d.bodies[v.id];
  if (handle === undefined) throw new Error(`No physics body for ${v.id}`);
  return d.world.getRigidBody(handle).translation().y > rideHeight(w, v) + T.liftedRise;
}

// Map pose and speed of a vehicle's body, and whether it stands on its wheels.
export function bodyState(d: Drive, id: string): { pos: Vec; heading: number; speed: number; upright: boolean } {
  const handle = d.bodies[id];
  if (handle === undefined) throw new Error(`No physics body for ${id}`);
  const body = d.world.getRigidBody(handle);
  const t = body.translation();
  const r = body.rotation();
  const upright = upOf(r) >= Math.cos(T.flipTilt * DEG);
  return { pos: { x: t.x / S, y: t.z / S }, heading: headingOf(r), speed: forwardSpeed(body), upright };
}

// A heightfield over the (n + 1) x (n + 1) corner grid. Rapier rows run along z and columns along x,
// stored column-major, and the field is centered on its collider, so it moves by half the map size.
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

// Every deck's colliders, in DECKS order.
function addDecks(world: RAPIER.World, w: World): DeckColliders[] {
  return DECKS.map((deck) => addDeck(world, w, deck));
}

// A deck, its top on the deck line from sim/terrain.ts, and a rail along each edge, one plate and two rail boxes per
// straight piece (deckSegments()). A skirted deck's rails reach down past the lowest ground along them, so a truck on
// the ground cannot get under the deck. Each lip is a skirt wall across its end, from the deck line down past the
// lowest ground along it: nothing stands over the deck line there, so a truck drives off the lip and flies, and
// nothing drives in under it.
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
    // The lip lies at the from or the to end; its wall stands just inside the end, on the end piece.
    const atTo = (a.x - deck.from.x) * deck.axis.x + (a.y - deck.from.y) * deck.axis.y > deck.length / 2;
    const seg = atTo ? segments[segments.length - 1] : segments[0];
    const h = atTo ? seg.h1 : seg.h0;
    const depth = skirtDepth(w.terrain, a, b, h, h);
    const end = (atTo ? 1 : -1) * ((seg.length * S) / 2 - B.railThickness / 2);
    return segmentBox(world, deck, seg)({ along: B.railThickness / 2, up: depth / 2, across: halfWidth }, { along: end, lift: 0, side: 0 });
  });
  return { plates, rails, lips };
}

// A box half.along, half.up and half.across meters each way in a deck piece's frame, whose top face center sits
// at.lift meters along the piece's up from the deck line, at.side meters across and at.along meters along from
// the piece's middle.
function segmentBox(world: RAPIER.World, deck: Deck, seg: DeckSegment) {
  const { axis } = deck;
  const pitch = Math.atan2((seg.h1 - seg.h0) * S, seg.length * S);
  // Yaw turns local +x onto the deck axis, then pitch about local z raises the piece's to end.
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

// Meters a skirted rail reaches below the deck line: down to PHYSICS.rockSink under the lowest ground
// along the rail, sampled every tile. h0 and h1 are the deck line at the rail's from and to ends.
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
