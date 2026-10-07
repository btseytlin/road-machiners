import {
  captureDrive,
  restoreDrive,
  type DriveSnapshot,
  restFrames,
  trailFrames,
  type Drive,
  type TurnResult,
} from "../phys/drive";
import type { PreparedTurn, TurnRequest, TurnResponse } from "../phys/turn";
import { mergePerf } from "../perf";
import { reportError } from "./crash";
import { playerVehicle } from "../sim/damage";
import type { GameEvent, World } from "../sim/types";
import { dist, type Vec } from "../sim/vec";
import { isOnRope, isTowed } from "../sim/tow";
import { playerSees } from "../sim/vision";
import { autoRuns, hostileToPlayer, playerCanAct } from "../sim/world";

export type LiveVision = {
  visible: Set<number>;
  explored: Uint8Array;
  from: Vec | null;
};

export type Playback = {
  result: TurnResult;
  // The worker's snapshot that `result.next` was restored from, which the next turn starts from.
  nextSnapshot: DriveSnapshot;
  before: World;
  lastTick: number | null;
  elapsed: number;
  moved: boolean;
  impacts: boolean;
  combat: boolean;
};

function stopsVehicle(event: GameEvent, id: string): boolean {
  switch (event.t) {
    case "knockout":
    case "death":
      return true;
    case "breakdown":
    case "partDisabled":
    case "destroyed":
      return event.vehicle === id;
    default:
      return false;
  }
}

function interruptsTravel(event: GameEvent, id: string): boolean {
  switch (event.t) {
    case "collision":
      return [event.a, event.b].includes(id);
    case "shot":
      return [event.shooter, event.target].includes(id);
    default:
      return stopsVehicle(event, id);
  }
}

// Whether a turn passes the drive-through point and ends farther from it than the truck is now.
// Travel stops before such a turn, so control returns at the turn end nearest the point.
export function overshoots(world: World, next: Pick<World, "events" | "vehicles">): boolean {
  const me = playerVehicle(world);
  if (me.order?.kind !== "through") return false;
  const passed = next.events.some((e) => e.t === "arrived" && e.vehicle === me.id);
  const after = next.vehicles.find((v) => v.id === me.id);
  if (!passed || !after) return false;
  return dist(after.pos, me.order.dest) > dist(me.pos, me.order.dest);
}

// A truck on a rope has no physics frames. Its tower placed it along its trail after the physics step. A truck let
// off the rope at the end of the turn, like on arrival in town, rode the rope during the step too. One that
// jumped this turn, like a retreating truck sent home, has no trail and stands at its new pose.
export function addRopeFrames(before: World, after: World, frames: TurnResult["frames"]): void {
  for (const v of after.vehicles) {
    if (!isOnRope(after, v.id) && (frames[v.id] || !isOnRope(before, v.id))) continue;
    frames[v.id] = v.trail.length < 2 ? restFrames(after, v) : trailFrames(after, v);
  }
}

export function canTravel(world: World): boolean {
  const me = playerVehicle(world);
  if (!playerCanAct(world) || me.direct) return false;
  if (
    world.vehicles.some(
      (v) => hostileToPlayer(world, v) && playerSees(world, v.pos),
    )
  )
    return false;
  return !world.events.some((event) => interruptsTravel(event, me.id));
}

export class Travel {
  private automatic = false;
  private pressedAt: number | null = null;
  private requested = false;
  private autoHalted = false;
  private remainder = 0;
  private readonly turns = new TurnPreparation();

  constructor(private readonly holdMs: number) {}

  pause(): void {
    this.automatic = false;
    this.requested = false;
    this.release();
  }

  press(now: number, playing: boolean, followWaypoint: boolean): boolean {
    if (this.pressedAt !== null) return false;
    this.pressedAt = now;
    const step = !this.automatic && !playing;
    this.automatic = step && followWaypoint;
    this.requested = false;
    return step;
  }

  // Returns whether to play one turn now.
  pressTurn(playing: boolean, world: World): boolean {
    if (autoRuns(world)) {
      this.toggleAutoHalt();
      return false;
    }
    const order = playerVehicle(world).order;
    const follow = canTravel(world) && order !== null && order.kind !== "brake";
    return this.press(performance.now(), playing, follow);
  }

  // A turn press stops the turns that run on their own while the player is stranded, and the next press restarts them.
  // Holding the restarting press fast-forwards, as in travel.
  private toggleAutoHalt(): void {
    this.autoHalted = !this.autoHalted;
    if (!this.autoHalted) this.pressedAt = performance.now();
  }

  // Whether turns run on their own now. A stop lasts until a turn press or until the stranded spell ends.
  autoAllowed(world: World): boolean {
    if (!autoRuns(world)) this.autoHalted = false;
    return autoRuns(world) && !this.autoHalted;
  }

  // Whether turns follow each other without a key press: travel to the order point or turns while stranded.
  isAuto(world: World): boolean {
    return this.automatic || (autoRuns(world) && !this.autoHalted);
  }

  // Stops automatic turns as Space does. Returns whether any were running.
  stopAuto(world: World): boolean {
    if (!this.isAuto(world)) return false;
    if (autoRuns(world)) this.autoHalted = true;
    this.pause();
    return true;
  }

  // A failed turn stops every automatic turn, so the same turn is not retried each frame.
  abandon(world: World): void {
    this.stopAuto(world);
    this.pause();
  }

  release(): void {
    this.pressedAt = null;
  }

  isFast(now: number): boolean {
    return this.pressedAt !== null && now - this.pressedAt >= this.holdMs;
  }

  update(safe: boolean, hasWaypoint: boolean): void {
    if (!safe || !hasWaypoint) this.automatic = false;
  }

  updateWorld(world: World, visibleHostile: boolean): void {
    const order = playerVehicle(world).order;
    this.update(
      canTravel(world) && !visibleHostile,
      order !== null && order.kind !== "brake",
    );
  }

  shouldAdvance(now: number): boolean {
    return this.automatic || this.isFast(now);
  }
  isPlaying(playback: Playback | null): boolean {
    return playback !== null || this.requested;
  }
  isAdvancing(playback: Playback | null, now: number): boolean {
    return this.isPlaying(playback) || this.shouldAdvance(now);
  }

  warm(world: World, drive: Drive): void {
    this.turns.warm(world, drive);
  }

  request(world: World, drive: Drive): void {
    this.requested = true;
    this.turns.prepare(world, drive);
  }

  // Turns on a tow rope chain like waypoint travel: the next turn is prepared during playback and starts with no pause.
  private onRope(world: World): boolean {
    return isTowed(world) && this.autoAllowed(world);
  }

  private wantsTurn(world: World, now: number): boolean {
    return this.isAdvancing(null, now) || this.onRope(world);
  }

  takeReady(world: World, drive: Drive, now: number): PreparedTurn | null {
    if (world.player.state === "dead") {
      this.pause();
      return null;
    }
    if (!this.wantsTurn(world, now)) return null;
    this.turns.prepare(world, drive);
    const prepared = this.turns.take(world);
    if (!prepared) return null;
    if (this.requested) {
      this.requested = false;
      return prepared;
    }
    if (!overshoots(world, prepared.world)) return prepared;
    this.pause();
    return null;
  }

  prepareNext(world: World, playback: Playback | null, now: number): void {
    if (playback && (this.shouldAdvance(now) || this.onRope(world)))
      this.turns.prepareFrom(world, playback.nextSnapshot);
  }

  beginPlayback(
    before: World,
    prepared: PreparedTurn,
    now: number,
    elapsed: number,
  ): { world: World; playback: Playback; towed: boolean } {
    const world = { ...prepared.world, terrain: before.terrain };
    // Frames first: a throw here must not leave a restored Rapier world behind.
    addRopeFrames(before, world, prepared.result.frames);
    const nextSnapshot = prepared.result.next;
    const result: TurnResult = { ...prepared.result, next: restoreDrive(nextSnapshot) };
    if (!playerCanAct(world)) this.pause();
    const towed = isTowed(before) || isTowed(world);
    const playback: Playback = {
      result,
      nextSnapshot,
      before,
      lastTick: now,
      elapsed,
      moved: false,
      impacts: false,
      combat: false,
    };
    return { world, playback, towed };
  }

  getSpeed(now: number, fastSpeed: number): number {
    return this.isFast(now) ? fastSpeed : 1;
  }

  advanceClock(playback: Playback, now: number, speed: number, maxFrameMs: number): number {
    if (playback.lastTick !== null)
      playback.elapsed += Math.min(now - playback.lastTick, maxFrameMs) * speed;
    playback.lastTick = now;
    return playback.elapsed;
  }

  finishClock(elapsed: number, finishAt: number): void {
    this.remainder = elapsed - finishAt;
  }
  getRemainder(wasPlaying: boolean): number {
    return wasPlaying ? this.remainder : 0;
  }
}

export class TurnPreparation {
  private worker: Worker | null = null;
  private terrain: World["terrain"] | null = null;
  private serial = 0;
  private warmId = 0;
  private pending: {
    id: number;
    before: World;
    ready: PreparedTurn | null;
    failure: string | null;
  } | null = null;

  private createWorker(): Worker {
    const worker = new Worker(new URL("../phys/turn.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<TurnResponse>) => {
      const response = event.data;
      if ("error" in response) return this.fail(response.id, response.error);
      // A warm-up turn is no player turn, so it keeps its own timer.
      mergePerf(response.id === this.warmId ? { "turn-warm": response.perf.turn } : response.perf);
      if (this.pending?.id === response.id) this.pending.ready = response.turn;
    };
    worker.onerror = (event) => this.fail(null, `Turn worker failed: ${event.message}`);
    worker.onmessageerror = () => this.fail(null, "Could not read turn worker response");
    return worker;
  }

  // A failure of the pending turn waits in it for take() to throw. A failure that belongs to no pending turn, like the
  // warm-up's, goes to the error route. A worker event without a request id belongs to the pending turn.
  private fail(id: number | null, message: string): void {
    if (this.pending && (id === null || this.pending.id === id)) this.pending.failure = message;
    else reportError(new Error(message));
  }

  // Runs the turn after `world` once and drops it. The worker then has its route grids built, its code compiled
  // and the routes of that turn cached before the player's first turn. No turn runs during a radio call or after death.
  warm(world: World, drive: Drive): void {
    if (world.player.call || world.player.state === "dead") return;
    this.warmId = this.post(world, captureDrive(drive));
  }

  prepare(world: World, drive: Drive): void {
    if (this.pending?.before !== world) this.prepareFrom(world, captureDrive(drive));
  }

  // Prepares the turn after `world` from a snapshot already in hand. It posts a copy, since a post transfers its
  // buffer and the caller keeps the snapshot for a retry.
  prepareFrom(world: World, saved: DriveSnapshot): void {
    if (this.pending?.before === world) return;
    const copy = { ...saved, snapshot: saved.snapshot.slice() };
    this.pending = { id: this.post(world, copy), before: world, ready: null, failure: null };
  }

  private post(world: World, saved: DriveSnapshot): number {
    const { terrain, ...state } = world;
    const id = ++this.serial;
    // Terrain identity owns route caches, so keep one terrain instance in the worker.
    this.worker ??= this.createWorker();
    this.worker.postMessage(
      {
        id,
        world: state,
        drive: saved,
        terrain: this.terrain === terrain ? null : terrain,
      } satisfies TurnRequest,
      [saved.snapshot.buffer as ArrayBuffer],
    );
    this.terrain = terrain;
    return id;
  }

  // The prepared turn after `world`, or null while it is not ready. It throws the worker's failure once and then
  // forgets the turn, so the next prepare() asks again.
  take(world: World): PreparedTurn | null {
    const pending = this.pending;
    if (pending?.before !== world) return null;
    if (pending.failure) {
      this.pending = null;
      throw new Error(pending.failure);
    }
    if (!pending.ready) return null;
    this.pending = null;
    return pending.ready;
  }
}
