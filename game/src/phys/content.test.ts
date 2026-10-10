import { beforeAll, expect, it } from 'vitest';
import { makeVehicle } from '../sim/factory';
import { emptyWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import { buildDrive, freeDrive, initPhysics, simulateTurn } from './drive';

let fixture: World;
beforeAll(async () => {
  await initPhysics();
  fixture = emptyWorld();
});

it.each(['courier', 'van', 'longbed', 'carrier', 'tractor', 'jeep', 'convertible', 'bus', 'loader', 'niva', 'bukhanka', 'lincoln'])('%s drives upright with repeatable physics', (chassisId) => {
  const world = structuredClone(fixture);
  const vehicle = makeVehicle(world, { faction: 'player', chassisId, parts: [{ defId: 'stockEngine', wear: 0 }, { defId: 'mg', wear: 0 }], spares: [], cargo: {}, pos: { x: 30, y: 30 }, heading: 0, brain: null });
  world.vehicles = [vehicle];
  world.player.vehicleId = vehicle.id;
  vehicle.order = { kind: 'through', dest: { x: 45, y: 30 } };
  const drive = buildDrive(world);
  try {
    const a = simulateTurn(drive, world);
    const b = simulateTurn(drive, world);
    try {
      const frames = a.frames[vehicle.id];
      expect(frames.at(-1)).toEqual(b.frames[vehicle.id].at(-1));
      expect(frames.at(-1)!.pos.x).toBeGreaterThan(frames[0].pos.x);
      for (const frame of frames) {
        expect(frame.wheels).toHaveLength(4);
        expect(Number.isFinite(frame.pos.x + frame.pos.y + frame.pos.z)).toBe(true);
        expect(1 - 2 * (frame.rot.x ** 2 + frame.rot.z ** 2)).toBeGreaterThan(Math.cos(Math.PI / 6));
      }
    } finally {
      freeDrive(a.next);
      freeDrive(b.next);
    }
  } finally {
    freeDrive(drive);
  }
});
