import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  buildDrive,
  captureDrive,
  freeDrive,
  initPhysics,
  type Drive,
} from "../phys/drive";
import type { PreparedTurn, TurnRequest, TurnResponse } from "../phys/turn";
import { computeTurn } from "../phys/turn";
import { restoreDrive } from "../phys/drive";
import { emptyWorld } from "../sim/testkit";
import { setMoveOrder } from "../sim/world";
import type { World } from "../sim/types";
import { reportError } from "./crash";
import { TurnPreparation } from "./travel";

vi.mock("./crash", () => ({ reportError: vi.fn() }));

class TestWorker {
  static latest: TestWorker;
  requests: TurnRequest[] = [];
  onmessage: ((event: MessageEvent<TurnResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    TestWorker.latest = this;
  }
  postMessage(request: TurnRequest): void {
    this.requests.push(request);
  }
  respond(response: TurnResponse): void {
    if (!this.onmessage) throw new Error("Missing worker response handler");
    this.onmessage({ data: response } as MessageEvent<TurnResponse>);
  }
}

let world: World;
let drive: Drive;
let reply: PreparedTurn;
beforeAll(initPhysics);
beforeEach(() => {
  vi.stubGlobal("Worker", TestWorker);
  world = emptyWorld();
  drive = buildDrive(world);
  const { terrain: _terrain, ...state } = world;
  reply = {
    world: state,
    result: { next: captureDrive(drive), frames: {}, crashes: [], breaks: [], landings: [], results: {} },
  };
});
afterEach(() => {
  freeDrive(drive);
  vi.unstubAllGlobals();
});

it("prepares once and exposes a result only when ready for the same world", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  turns.prepare(world, drive);
  expect(turns.take(world)).toBeNull();
  const worker = TestWorker.latest;
  expect(worker?.requests).toHaveLength(1);
  worker.respond({ id: worker.requests[0].id, turn: reply, perf: {} });
  expect(turns.take(world)).toBe(reply);
  expect(turns.take(world)).toBeNull();
});

it("discards a stale result after replanning and sends stable terrain only once", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  const changed = setMoveOrder(world, {
    kind: "stopAt",
    dest: { x: 38, y: 31 },
  });
  turns.prepare(changed, drive);
  const worker = TestWorker.latest;
  expect(worker?.requests).toHaveLength(2);
  expect(worker.requests[0].terrain).toBe(world.terrain);
  expect(worker.requests[1].terrain).toBeNull();
  worker.respond({ id: worker.requests[0].id, turn: reply, perf: {} });
  expect(turns.take(changed)).toBeNull();
  worker.respond({ id: worker.requests[1].id, turn: reply, perf: {} });
  expect(turns.take(world)).toBeNull();
  expect(turns.take(changed)).toBe(reply);
});

it("throws a calculation failure once, then prepares again", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  const worker = TestWorker.latest;
  worker.respond({ id: worker.requests[0].id, error: "physics failed" });
  expect(() => turns.take(world)).toThrow("physics failed");
  expect(turns.take(world)).toBeNull();
  turns.prepare(world, drive);
  expect(worker.requests).toHaveLength(2);
});

it("fails the pending turn on a worker error event", () => {
  const turns = new TurnPreparation();
  turns.prepare(world, drive);
  TestWorker.latest.onerror?.({ message: "boom" } as ErrorEvent);
  expect(() => turns.take(world)).toThrow("Turn worker failed: boom");
});

it("does not fail the pending turn when the warm-up fails", () => {
  const turns = new TurnPreparation();
  turns.warm(world, drive);
  const worker = TestWorker.latest;
  turns.prepare(world, drive);
  worker.respond({ id: worker.requests[0].id, error: "warm failed" });
  expect(turns.take(world)).toBeNull();
  expect(reportError).toHaveBeenCalledOnce();
});

it("posts a copy of a snapshot in hand and leaves that snapshot attached", () => {
  const turns = new TurnPreparation();
  const saved = captureDrive(drive);
  const bytes = saved.snapshot.slice();
  const spy = vi.spyOn(drive.world, "takeSnapshot");
  turns.prepareFrom(world, saved);
  const posted = TestWorker.latest.requests[0].drive;
  // A deep toEqual walks the 1.8 MB snapshot element by element and takes over 30 s on a loaded machine.
  expect(Buffer.from(posted.snapshot).equals(Buffer.from(bytes))).toBe(true);
  expect(saved.snapshot.byteLength).toBe(bytes.byteLength);
  expect(spy).not.toHaveBeenCalled();
}, 90_000); // takes 10-25s alone and over 30s when the whole suite shares the cores

it("prepares from a snapshot once per world", () => {
  const turns = new TurnPreparation();
  const saved = captureDrive(drive);
  turns.prepareFrom(world, saved);
  turns.prepareFrom(world, saved);
  turns.prepare(world, drive);
  expect(TestWorker.latest.requests).toHaveLength(1);
});

it("steps a turn the same from the worker's bytes as from a restored and re-captured world", () => {
  const moving = setMoveOrder(world, { kind: "stopAt", dest: { x: 38, y: 31 } });
  const { terrain, ...state } = moving;
  const first = captureDrive(drive);
  const restored = restoreDrive(first);
  const again = captureDrive(restored);
  const a = computeTurn({ world: state, drive: first }, terrain);
  const b = computeTurn({ world: state, drive: again }, terrain);
  restored.world.free();
  const last = (t: typeof a) => t.world.vehicles.find((v) => v.id === world.player.vehicleId)!;
  expect(last(b).pos).toEqual(last(a).pos);
  expect(last(b).speed).toEqual(last(a).speed);
});
