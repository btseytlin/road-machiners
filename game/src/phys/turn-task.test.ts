import { beforeAll, expect, it } from "vitest";
import type { Obstacle } from "../sim/types";
import { emptyWorld } from "../sim/testkit";
import { endTurn, setMoveOrder } from "../sim/world";
import {
  buildDrive,
  captureDrive,
  freeDrive,
  initPhysics,
  restoreDrive,
  syncDrive,
  type Drive,
} from "./drive";
import { computeTurn, physicsMove } from "./turn";

beforeAll(initPhysics);

it("restores frozen terrain after worker transfer so turn clones retain the route cache", () => {
  const world = emptyWorld();
  const drive = buildDrive(world);
  const { terrain, ...state } = structuredClone(world);
  expect(Object.isFrozen(terrain)).toBe(false);
  try {
    computeTurn({ world: state, drive: captureDrive(drive) }, terrain);
    expect(Object.isFrozen(terrain)).toBe(true);
    expect(Object.isFrozen(terrain.heights)).toBe(true);
    expect(Object.isFrozen(terrain.types)).toBe(true);
  } finally {
    freeDrive(drive);
  }
});

it("computes the same world and physics as a foreground turn without advancing the input", () => {
  const world = setMoveOrder(emptyWorld(), {
    kind: "stopAt",
    dest: { x: 38, y: 31 },
  });
  const original = structuredClone(world);
  const drive = buildDrive(world);
  let expectedDrive: Drive | null = null;
  let restored: Drive | null = null;
  try {
    const { terrain, ...state } = world;
    const prepared = computeTurn(
      { world: state, drive: captureDrive(drive) },
      terrain,
    );
    const expected = endTurn(
      world,
      physicsMove(drive, (result) => {
        expectedDrive = result.next;
      }),
    );
    expect({ ...prepared.world, terrain }).toEqual(expected);
    expect(world).toEqual(original);
    restored = restoreDrive(prepared.result.next);
    const nextPrepared = computeTurn(
      { world: prepared.world, drive: captureDrive(restored) },
      terrain,
    );
    const nextExpected = endTurn(
      expected,
      physicsMove(restored, (result) => freeDrive(result.next)),
    );
    expect({ ...nextPrepared.world, terrain }).toEqual(nextExpected);
  } finally {
    freeDrive(drive);
    if (expectedDrive) freeDrive(expectedDrive);
    if (restored) freeDrive(restored);
  }
}, 90_000);

function handoff(rockStays: boolean) {
  const world = setMoveOrder(emptyWorld(), { kind: "stopAt", dest: { x: 38, y: 31 } });
  const drive = buildDrive(world);
  const { terrain, ...state } = world;
  const first = computeTurn({ world: state, drive: captureDrive(drive) }, terrain);
  freeDrive(drive);
  const next = first.result.next;
  const pristine = structuredClone(next);
  const at = world.vehicles[0].pos;
  const rock: Obstacle = { id: "rock1", kind: "landmark", look: "shack", pos: { x: at.x + 3, y: at.y }, r: 0.9, yaw: 0 };
  const main = restoreDrive(next);
  try {
    syncDrive(main, { ...first.world, terrain, obstacles: [rock] });
  } finally {
    freeDrive(main);
  }
  const later = { ...first.world, obstacles: rockStays ? [rock] : [] };
  return { next, pristine, later, terrain };
}

it("a main-thread sync of the restored drive leaves the playback snapshot unchanged", () => {
  const { next, pristine } = handoff(false);
  expect(next.obstacles).toEqual(pristine.obstacles);
  expect(next.bodies).toEqual(pristine.bodies);
  expect(next.memory).toEqual(pristine.memory);
});

it.each([false, true])("a turn from the playback snapshot after a main-thread sync matches one from a copy taken before it (rock stays: %s)", (stays) => {
  const { next, pristine, later, terrain } = handoff(stays);
  const actual = computeTurn({ world: later, drive: next }, terrain);
  const expected = computeTurn({ world: structuredClone(later), drive: pristine }, terrain);
  expect(actual.world).toEqual(expected.world);
  expect(actual.result.next.obstacles).toEqual(expected.result.next.obstacles);
});
