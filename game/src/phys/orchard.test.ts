// Drives through Old Orchard on the committed map, played through the real physics turn pipeline: a scavenger from the
// south entry to the north-west pocket's barn, and the player's truck up the old highway to that barn and up the dozer
// track to the ridge shelf's crate stack. src/sim/territory-reach.test.ts proves the routes exist; this proves trucks

import { defaultSetup } from '../sim/settings';
import { beforeAll, describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION, type TerritoryDef } from '../data/region';
import { RULES } from '../data/rules';
import { onOrchardRoad } from '../data/territory';
import { hangUp } from '../sim/dialogue';
import { topGoal } from '../sim/npc-activities';
import { salvageInRange } from '../sim/salvage';
import { spotGoal, territoryEntries, territorySpots } from '../sim/territory';
import { forceOption, addVehicle, npcBrain, PLAIN_KIT } from '../sim/testkit';
import { isFree } from '../sim/spawn';
import { vehicleStats } from '../sim/stats';
import type { MoveOrder, SalvageStock, Vehicle, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const orchard = REGION.locations.find((l) => l.id === 'orchard') as TerritoryDef;
const at = (s: number, c: number): Vec => {
  const p = onOrchardRoad(s, c);
  return { x: orchard.pos.x + p.x, y: orchard.pos.y + p.y };
};
const UP_ROAD = Math.atan2(onOrchardRoad(1, 0).y, onOrchardRoad(1, 0).x);

const SCAVENGE_TURNS = 36;
const BARN_LEG_TURNS = 26;
const SHELF_LEG_TURNS = 15;

function orchardWorld(): World {
  const w = newWorld(1337, PLAIN_KIT, TEST_MAP, defaultSetup('roaming'));
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  return w;
}

function player(w: World): Vehicle {
  return w.vehicles.find((v) => v.id === w.player.vehicleId)!;
}

function stockNear(w: World, look: string, p: Vec): SalvageStock {
  const stocks = territorySpots(w, 'orchard').filter((s) => s.id.startsWith(`${look}-`));
  return stocks.reduce((a, b) => (dist(b.pos, p) < dist(a.pos, p) ? b : a));
}

function turn(w: World, d: Drive): { w: World; d: Drive } {
  if (w.player.call) w = hangUp(w);
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  expect(w.events.filter((e) => e.t === 'stall')).toEqual([]);
  return { w, d: next! };
}

async function driveLegs(start: World, legs: MoveOrder[], budget: number, atEach: (w: World, leg: number) => void): Promise<void> {
  let w = start;
  let d = buildDrive(w);
  for (const [leg, order] of legs.entries()) {
    w = setMoveOrder(w, order);
    let taken = 0;
    let arrived = false;
    while (!arrived && taken < budget) {
      ({ w, d } = turn(w, d));
      taken++;
      expect(player(w).strandedTurns ?? 0, `leg ${leg}, turn ${taken}`).toBe(0);
      arrived = w.events.some((e) => e.t === 'arrived' && e.vehicle === w.player.vehicleId);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(arrived, `leg ${leg} to ${'dest' in order ? `${order.dest.x.toFixed(1)},${order.dest.y.toFixed(1)}` : order.kind}`).toBe(true);
    atEach(w, leg);
  }
  freeDrive(d);
}

const stopAt = (p: Vec): MoveOrder => ({ kind: 'stopAt', dest: p });

describe('driving through Old Orchard', () => {
  it('a scavenger from the south entry parks at the north pocket barn and searches it', async () => {
    let w = orchardWorld();
    const south = territoryEntries(orchard).reduce((a, b) => (dist(b, at(-32, 0)) < dist(a, at(-32, 0)) ? b : a));
    const barn = stockNear(w, 'barn', at(54.5, 32));
    const me = player(w);
    const parking = [10, 12, 14, 8, 16].flatMap((c) => [20, 22, 18, 24, 16].map((s) => at(s, c))).find((p) => isFree(w, p, vehicleStats(w, me).radius, me.id));
    if (!parking) throw new Error('No free ground beside the highway to park the player');
    me.pos = parking;
    me.speed = 0;
    me.order = null;
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { ...south }, UP_ROAD);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    let goal = spotGoal(w, 'orchard');
    while (goal.targetId !== barn.id) goal = spotGoal(w, 'orchard');
    npc.brain.goals = [goal];
    forceOption('salvageSeen', 'keep');

    let d = buildDrive(w);
    let turns = 0;
    let searcher: Vehicle | null = null;
    let maxStuck = 0;
    while (!searcher && turns < SCAVENGE_TURNS) {
      ({ w, d } = turn(w, d));
      turns++;
      const scavenger = w.vehicles.find((v) => v.id === npc.id)!;
      maxStuck = Math.max(maxStuck, scavenger.brain!.stuck ?? 0);
      if (scavenger.job?.kind === 'search' && scavenger.job.stockId === barn.id) searcher = scavenger;
      else expect(topGoal(scavenger)?.targetId, `turn ${turns}`).toBe(barn.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    freeDrive(d);
    expect(searcher).not.toBeNull();
    expect(salvageInRange(searcher!, barn)).toBe(true);
    expect(maxStuck).toBeLessThan(RULES.unstick.turns);
  }, 180_000);

  it('the player drives up the old highway to the north pocket barn and back', async () => {
    const w = orchardWorld();
    const me = player(w);
    me.pos = at(-30, 0);
    me.heading = UP_ROAD;
    const yard = at(60, 32);
    const up = [at(0, 0), at(30, 0), at(46, 0), at(52, 6), at(60, 6.6), at(61, 22)];
    const legs = [...up, yard, ...up.slice().reverse(), at(-30, 0)].map(stopAt);
    await driveLegs(w, legs, BARN_LEG_TURNS, (x, leg) => {
      if (leg === up.length) expect(dist(player(x).pos, yard)).toBeLessThan(RULES.arriveRadius + 1);
    });
  }, 180_000);

  it('the player drives up the dozer track to the ridge shelf crate stack and back', async () => {
    const w = orchardWorld();
    const me = player(w);
    me.pos = at(30, 0);
    me.heading = UP_ROAD;
    const cache = stockNear(w, 'armyCache', at(32.5, 7.5));
    const up = [at(42, 1), at(39, 5.5), at(36, 7)];
    const legs = [...up, at(33.5, 10), at(32, 11), ...up.slice(0, -1).reverse(), at(30, 0)].map(stopAt);
    await driveLegs(w, legs, SHELF_LEG_TURNS, (x, leg) => {
      if (leg === up.length) expect(salvageInRange(player(x), cache)).toBe(true);
    });
  }, 180_000);
});
