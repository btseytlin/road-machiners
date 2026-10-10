import { beforeAll, expect, it } from 'vitest';
import { outpostPad } from '../sim/fury-road';
import { canUseSite } from '../sim/sites';
import { HIGHWAY } from '../data/modes';
import { acrossOf, alongOf, bendPlan, milestoneAt, outpostFort, toRoad } from '../sim/highway';
import { furyRoadWorld } from '../sim/testkit';
import { dist, type Vec } from '../sim/vec';
import { endTurn, setMoveOrder } from '../sim/world';
import type { World } from '../sim/types';
import { budget } from '../test/budget';
import { buildDrive, freeDrive, initPhysics, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const TURNS = 160;

type FortDrive = { w: World; turns: number; stalls: number; startGap: number; path: Vec[] };

function arrived(w: World): boolean {
  return w.furyRoad!.outposts[0].paid;
}

function driveToFirstFort(seed: number): FortDrive {
  let w = furyRoadWorld(seed);
  w.furyRoad!.groups = [];
  w.player.fuel = 999;
  const pad = outpostPad(w, 1);
  const startGap = dist(w.vehicles[0].pos, pad);
  let drive: Drive = buildDrive(w);
  let stalls = 0;
  let turns = 0;
  const path: Vec[] = [];
  for (; turns < TURNS && !arrived(w); turns++) {
    if (w.vehicles[0].order === null) w = setMoveOrder(w, { kind: 'stopAt', dest: pad });
    let result: TurnResult | null = null;
    w = endTurn(w, physicsMove(drive, (next) => (result = next)));
    stalls += w.events.filter((e) => e.t === 'stall').length;
    freeDrive(drive);
    drive = result!.next;
    path.push({ ...w.vehicles[0].pos });
  }
  freeDrive(drive);
  return { w, turns, stalls, startGap, path };
}

it('drives a kit truck in physics along the highway, through the scenes, to the first fort pad', () => {
  for (const seed of [1, 2, 3]) {
    const { w, turns, stalls, startGap } = driveToFirstFort(seed);
    console.info(`seed ${seed}: ${turns} turns to the fort from ${startGap.toFixed(0)} tiles`);
    expect(stalls, `seed ${seed}`).toBe(0);
    expect(arrived(w), `seed ${seed} after ${turns} turns`).toBe(true);
    expect(canUseSite(w.vehicles.find((v) => v.id === w.player.vehicleId)!.pos, outpostFort(seed, 0, 1))).toBe(true);
  }
}, budget(900_000));

it('keeps auto travel on the road and its verge through the widest bend of ten seeds, with no stall', () => {
  const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
  const seed = seeds.reduce((best, s) => (Math.abs(bendPlan(s, 1)[1]) > Math.abs(bendPlan(best, 1)[1]) ? s : best));
  const { w, stalls, path } = driveToFirstFort(seed);
  const ends = HIGHWAY.road.bend.ends;
  const onBend = path.map((p) => toRoad(0, p)).filter((at) => alongOf(seed, at) > milestoneAt(0) + ends && alongOf(seed, at) < milestoneAt(1) - ends);
  const widest = Math.max(...onBend.map((at) => Math.abs(acrossOf(seed, at))));
  console.info(`seed ${seed} swings ${bendPlan(seed, 1)[1].toFixed(1)} tiles; the truck kept within ${widest.toFixed(2)} tiles of the center over ${onBend.length} turns`);

  expect(stalls).toBe(0);
  expect(arrived(w)).toBe(true);
  expect(onBend.length).toBeGreaterThan(5);
  expect(widest).toBeLessThan(HIGHWAY.road.verge);
}, budget(900_000));
