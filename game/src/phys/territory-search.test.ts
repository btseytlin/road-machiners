// A scavenger drives to a hull bay in the Fallen Sun's ribcage tube, a cargo pod in its field and an engine section in the
// Glass Flats nozzle on the committed map, played through the real physics turn pipeline, then searches it. The player
// parks at the hatch-side cell, searches the same kind of stock and takes its loot. src/sim/territory-reach.test.ts proves
// the routes and the parking cells exist; this proves trucks and scavengers use them.

import { defaultSetup } from '../sim/settings';
import { beforeAll, describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION, type TerritoryDef } from '../data/region';
import { RULES } from '../data/rules';
import { hangUp } from '../sim/dialogue';
import { propReach } from '../sim/mapgen';
import { topGoal } from '../sim/npc-activities';
import { collectSalvage, salvageInRange } from '../sim/salvage';
import { startSearch } from '../sim/search';
import { spotGoal, territoryCaches, territoryEntries, territorySpots } from '../sim/territory';
import { addVehicle, forceOption, npcBrain, PLAIN_KIT } from '../sim/testkit';
import { CLEARANCE } from '../sim/nav/layer';
import type { SalvageStock, Vehicle, World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const SCAVENGE_TURNS = 80;
const SEARCH_TURNS = 30;
const TARGETS = [
  { territory: 'fallen-sun', look: 'hullCache', near: 'shipCage' },
  { territory: 'fallen-sun', look: 'shipCache', near: null },
  { territory: 'glass-flats', look: 'engineCache', near: 'engineNozzle' },
] as const;

function baseWorld(): World {
  const w = newWorld(1337, PLAIN_KIT, TEST_MAP, defaultSetup('roaming'));
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  return w;
}

function player(w: World): Vehicle {
  return w.vehicles.find((v) => v.id === w.player.vehicleId)!;
}

function turn(w: World, d: Drive): { w: World; d: Drive } {
  if (w.player.call) w = hangUp(w);
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  expect(w.events.filter((e) => e.t === 'stall')).toEqual([]);
  return { w, d: next! };
}

function stockOf(w: World, territory: TerritoryDef, look: string, near: string | null): SalvageStock {
  const anchor = near ? (TEST_MAP.props.find((p) => p.kind === near && dist(p.pos, territory.pos) < territory.radius)?.pos ?? territory.pos) : territory.pos;
  const stocks = territorySpots(w, territory.id).filter((s) => s.id.startsWith(`${look}-`));
  expect(stocks.length, look).toBeGreaterThan(0);
  return stocks.reduce((a, b) => (dist(b.pos, anchor) < dist(a.pos, anchor) ? b : a));
}

describe.each(TARGETS)('$look in $territory', ({ territory, look, near }) => {
  const site = REGION.locations.find((l) => l.id === territory) as TerritoryDef;

  it('a scavenger drives to it and searches it without a stall', async () => {
    let w = baseWorld();
    const stock = stockOf(w, site, look, near);
    const entry = territoryEntries(site).reduce((a, b) => (dist(b, stock.pos) < dist(a, stock.pos) ? b : a));
    const me = player(w);
    me.pos = { x: site.pos.x + site.radius * 2, y: site.pos.y + site.radius * 2 };
    me.speed = 0;
    me.order = null;
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { ...entry }, Math.atan2(stock.pos.y - entry.y, stock.pos.x - entry.x));
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    let goal = spotGoal(w, territory);
    while (goal.targetId !== stock.id) goal = spotGoal(w, territory);
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
      if (scavenger.job?.kind === 'search' && scavenger.job.stockId === stock.id) searcher = scavenger;
      else expect(topGoal(scavenger)?.targetId, `turn ${turns}`).toBe(stock.id);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    freeDrive(d);
    expect(searcher).not.toBeNull();
    expect(salvageInRange(searcher!, stock)).toBe(true);
    expect(maxStuck).toBeLessThan(RULES.unstick.turns);
  }, 240_000);

  it('the player parks at the hatch side, searches it and takes what the search reveals', async () => {
    let w = baseWorld();
    const stock = stockOf(w, site, look, near);
    const cache = territoryCaches(site).find((c) => dist(c.pos, stock.pos) < 1e-3);
    const spot = w.obstacles.find((o) => o.id === stock.id)!;
    const ahead = propReach(spot) + 0.6 + CLEARANCE;
    const heading = cache ? cache.yaw : 0;
    const me = player(w);
    me.pos = { x: stock.pos.x + Math.cos(heading) * ahead, y: stock.pos.y + Math.sin(heading) * ahead };
    me.speed = 0;
    me.order = null;
    expect(salvageInRange(me, stock)).toBe(true);
    w = startSearch(w, stock.id);
    let d = buildDrive(w);
    let turns = 0;
    while (player(w).job?.kind === 'search' && turns < SEARCH_TURNS) {
      ({ w, d } = turn(w, d));
      turns++;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    freeDrive(d);
    expect(player(w).job).toBeFalsy();
    expect(w.player.scavenged).toContain(stock.id);
    const moved = collectSalvage(w, player(w), stock.id, Infinity);
    expect(moved).toBeGreaterThan(0);
  }, 240_000);
});
