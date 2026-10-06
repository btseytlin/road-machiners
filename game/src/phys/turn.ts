// Physics as the sim's movement step. The turn pipeline hands the draft world to physicsMove, which
// runs the turn in the physics engine and writes breaks, poses, speeds, trails, fuel, crashes and orders back.
// Vehicles far from the player have no body and travel through advanceFar.

import { RULES } from '../data/rules';
import { CHASSIS } from '../data/chassis';
import { warmRoutes } from '../sim/path';
import { endTurn } from '../sim/world';
import { perfSnapshot, resetPerf, type PerfStat } from '../perf';
import { playerVehicle } from '../sim/damage';
import { advanceFar } from '../sim/far';
import { applyContactCrash, applyGroundCrash, applyLanding } from '../sim/crash-contact';
import { breakProp } from '../sim/salvage';
import { isOnRope } from '../sim/tow';
import { burnFuel } from '../sim/resources';
import { setDownSpot } from '../sim/steering';
import type { MoveOrder, Pose, Vehicle, World } from '../sim/types';
import { angleDiff, dist, lerp } from '../sim/vec';
import { exploreFrom } from '../sim/vision';
import { bodyState, GROUND, isLifted, captureDrive, freeDrive, initPhysics, restoreDrive, restWheels, simulateTurn, syncDrive, toTilesPerTurn, trailFrames, TURN_STEPS, type Drive, type DriveSnapshot, type TurnResult, type VehicleResult } from './drive';
import { headingOf, toMap } from './frames';

export type TurnState = Omit<World, 'terrain'>;
export type TurnTask = { world: TurnState; drive: DriveSnapshot };
export type PreparedTurn = {
  world: TurnState;
  result: Omit<TurnResult, 'next'> & { next: DriveSnapshot };
};
export type TurnRequest = TurnTask & { id: number; terrain: World['terrain'] | null };
export type TurnResponse =
  | { id: number; turn: PreparedTurn; perf: Record<string, PerfStat> }
  | { id: number; error: string };

export function computeTurn(task: TurnTask, terrain: World['terrain']): PreparedTurn {
  // Worker messages drop frozen flags. Turn clones must keep the terrain and its route cache.
  Object.freeze(terrain.heights);
  Object.freeze(terrain.types);
  Object.freeze(terrain);
  const drive = restoreDrive(task.drive);
  let result: TurnResult | null = null;
  try {
    const world = endTurn({ ...task.world, terrain }, physicsMove(drive, (next) => { result = next; }));
    if (!result) throw new Error('Turn ran without physics');
    const { terrain: _terrain, ...state } = world;
    const { next, ...motion } = result as TurnResult;
    return { world: state, result: { ...motion, next: captureDrive(next) } };
  } finally {
    freeDrive(drive);
    if (result) freeDrive((result as TurnResult).next);
  }
}

function startTurnWorker(): void {
  let terrain: World['terrain'] | null = null;
  const ready = initPhysics();
  self.onmessage = async (event: MessageEvent<TurnRequest>) => {
    const request = event.data;
    try {
      await ready;
      if (request.terrain) {
        terrain = request.terrain;
        warmRoutes({ ...request.world, terrain }, [...new Set(Object.values(CHASSIS).map((chassis) => chassis.radius))]);
      }
      if (!terrain) throw new Error('Turn worker has no terrain');
      resetPerf();
      const turn = computeTurn(request, terrain);
      self.postMessage({ id: request.id, turn, perf: perfSnapshot() } satisfies TurnResponse, {
        transfer: [turn.result.next.snapshot.buffer as ArrayBuffer],
      });
    } catch (error) {
      self.postMessage({ id: request.id, error: describeWorkerError(error) } satisfies TurnResponse);
    }
  };
}

function describeWorkerError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// The same turn pipeline is importable by the game and is the dedicated worker entry point.
if (typeof self !== 'undefined' && !('document' in self)) startTurnWorker();

const EXPLORE_EVERY = 4; // trail poses between sight checks while exploring along a turn
const STOPPED = 0.05; // tiles per turn; slower than this a braking truck counts as stopped

// Returns the movement step for endTurn. It keeps the turn's result for the caller through done.
export function physicsMove(d: Drive, done: (r: TurnResult) => void): (w: World) => void {
  return (w) => {
    syncDrive(d, w);
    const r = simulateTurn(d, w);
    // A towed truck has no frames either, but its tower places it after this step.
    const far = w.vehicles.filter((v) => !r.frames[v.id] && !isOnRope(w, v.id));
    applyTurn(w, r);
    for (const v of far) {
      advanceFar(w, v);
      r.frames[v.id] = trailFrames(w, v, restWheels(v.chassisId));
    }
    exploreAlong(w);
    done(r);
  };
}

// Writes the physics result back for the vehicles that drove in it. Vehicles without frames were far
// and are left alone. A vehicle driving in physics drops any route stored while it was far, since it
// no longer starts where that route left off. Breaks go first, from each truck's pose at the turn's start, so
// the side that hit takes the scrape. The body's speed then replaces the sim's, since physics already took the
// slowdown when the prop broke.
export function applyTurn(w: World, r: TurnResult): void {
  applyBreaks(w, r);
  for (const v of w.vehicles) {
    const frames = r.frames[v.id];
    if (frames) applyDriven(w, r, v, frames);
  }
  applyCrashes(w, r);
  applyLandings(w, r);
}

function applyCrashes(w: World, r: TurnResult): void {
  for (const c of r.crashes) {
    const a = w.vehicles.find((v) => v.id === c.a);
    if (!a) throw new Error(`Crash with unknown vehicle ${c.a}`);
    if (c.b === GROUND) applyGroundCrash(w, a, c.b, toTilesPerTurn(c.impact), c.contact.a);
    else applyContactCrash(w, a, w.vehicles.find((v) => v.id === c.b) ?? null, c.b, toTilesPerTurn(c.impact), c.contact);
  }
}

function applyLandings(w: World, r: TurnResult): void {
  for (const l of r.landings) {
    const v = w.vehicles.find((x) => x.id === l.vehicle);
    if (!v) throw new Error(`Landing of unknown vehicle ${l.vehicle}`);
    applyLanding(w, v, GROUND, toTilesPerTurn(l.impact));
  }
}

function applyBreaks(w: World, r: TurnResult): void {
  for (const b of r.breaks) breakProp(w, b.prop, b.vehicle);
}

// Moves a stranded truck to free ground and stops it. syncDrive then sets its body there on its wheels.
function setDown(w: World, v: Vehicle): void {
  v.pos = setDownSpot(w, v);
  v.speed = 0;
}

function applyDriven(w: World, r: TurnResult, v: Vehicle, frames: TurnResult['frames'][string]): void {
  if (v.brain) delete v.brain.farRoute;
  const s = bodyState(r.next, v.id);
  const start: Pose = { x: v.pos.x, y: v.pos.y, heading: v.heading };
  v.pos = s.pos;
  v.heading = s.heading;
  v.speed = Math.max(0, toTilesPerTurn(s.speed));
  v.strandedTurns = s.upright && !isLifted(r.next, w, v) ? 0 : (v.strandedTurns ?? 0) + 1;
  if (v.strandedTurns >= RULES.stranded.turns) setDown(w, v);
  v.trail = trailOf(start, frames);
  burnFuel(w, v, pathLength(v.trail));
  settleOrder(w, v, r.results[v.id]);
}

// Clears an order the turn completed. A stop order holds until the truck stands still,
// so a slow roll after arrival still brakes.
function settleOrder(w: World, v: Vehicle, res: VehicleResult): void {
  if (!v.order || !orderDone(v.order, res, v.speed < STOPPED)) return;
  if (v.order.kind !== 'brake') w.events.push({ t: 'arrived', vehicle: v.id });
  v.order = null;
}

function orderDone(order: MoveOrder, res: VehicleResult, stopped: boolean): boolean {
  switch (order.kind) {
    case 'through':
      return res.passed;
    case 'stopAt':
      return res.arrived && stopped;
    case 'brake':
      return stopped;
  }
}

// Tiles the player saw while driving count as explored, not only those seen at the turn's end.
function exploreAlong(w: World): void {
  const me = playerVehicle(w);
  for (let i = 0; i < me.trail.length; i += EXPLORE_EVERY) {
    exploreFrom(w, me.trail[i]);
  }
}

// The sim keeps RULES.substeps + 1 poses per turn, from the start pose, for fuel and the log. Pose i is the pose at
// time i / substeps of the turn, so playing the trail back runs at the speed the truck drove.
export function trailOf(start: Pose, frames: TurnResult['frames'][string]): Pose[] {
  const trail: Pose[] = [start];
  for (let i = 1; i <= RULES.substeps; i++) trail.push(poseAt(start, frames, (i * TURN_STEPS) / RULES.substeps));
  return trail;
}

// The pose at a fractional physics step: step 0 is the start, step k is frame k - 1. Position and heading are
// interpolated between the two frames around it.
function poseAt(start: Pose, frames: TurnResult['frames'][string], step: number): Pose {
  const poseOfFrame = (k: number): Pose => {
    if (k === 0) return start;
    const f = frames[k - 1];
    const p = toMap(f.pos);
    return { x: p.x, y: p.y, heading: headingOf(f.rot) };
  };
  const lo = Math.min(Math.floor(step), TURN_STEPS);
  const hi = Math.min(lo + 1, TURN_STEPS);
  const t = step - lo;
  const a = poseOfFrame(lo);
  if (t === 0 || hi === lo) return a;
  const b = poseOfFrame(hi);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), heading: a.heading + angleDiff(a.heading, b.heading) * t };
}

function pathLength(trail: Pose[]): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++) total += dist(trail[i - 1], trail[i]);
  return total;
}
