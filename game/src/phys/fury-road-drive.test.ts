import { beforeAll, expect, it } from 'vitest';
import { outpostPad } from '../sim/fury-road';
import { canUseSite } from '../sim/sites';
import { outpostFort } from '../sim/highway';
import { furyRoadWorld } from '../sim/testkit';
import { dist } from '../sim/vec';
import { endTurn, setMoveOrder } from '../sim/world';
import type { World } from '../sim/types';
import { budget } from '../test/budget';
import { buildDrive, freeDrive, initPhysics, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const TURNS = 160;

function driveToFirstFort(seed: number): { w: World; turns: number; stalls: number; startGap: number } {
  let w = furyRoadWorld(seed);
  w.furyRoad!.groups = [];
  w.player.fuel = 999;
  const pad = outpostPad(w, 1);
  const startGap = dist(w.vehicles[0].pos, pad);
  let drive: Drive = buildDrive(w);
  let stalls = 0;
  let turns = 0;
  for (; turns < TURNS && w.furyRoad!.window === 0; turns++) {
    if (w.vehicles[0].order === null) w = setMoveOrder(w, { kind: 'stopAt', dest: pad });
    let result: TurnResult | null = null;
    w = endTurn(w, physicsMove(drive, (next) => (result = next)));
    stalls += w.events.filter((e) => e.t === 'stall').length;
    freeDrive(drive);
    drive = result!.next;
    if (w.furyRoad!.window !== 0) break;
  }
  freeDrive(drive);
  return { w, turns, stalls, startGap };
}

it('drives a kit truck in physics along the highway, through the scenes, to the first fort pad', () => {
  for (const seed of [1, 2, 3]) {
    const { w, turns, stalls, startGap } = driveToFirstFort(seed);
    console.info(`seed ${seed}: ${turns} turns to the fort from ${startGap.toFixed(0)} tiles`);
    expect(stalls, `seed ${seed}`).toBe(0);
    expect(w.furyRoad!.window, `seed ${seed} after ${turns} turns`).toBe(1);
    expect(canUseSite(w.vehicles.find((v) => v.id === w.player.vehicleId)!.pos, outpostFort(seed, 1, 1))).toBe(true);
  }
}, budget(900_000));
