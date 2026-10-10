// Scavengers at old-world loot spots on the committed map: the off-road pick, the drive from the road, the search and
// the take, an emptied spot and a spot the player is searching. src/three/old-spot-reload.test.ts reloads on the way.

import { hangUp } from './dialogue';
import { describe, expect, it, onTestFinished } from 'vitest';
import { NPCS } from '../data/npcs';
import { OLD_PLACES, OLD_TABLES } from '../data/salvage';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { planNpcOrders } from './ai';
import { advanceFar } from './far';
import { goodsCount } from './grid';
import { topGoal } from './npc-activities';
import { nearestRoadPoint, oldSpotOf, oldSpotPicks, oldStockId, type OldSpotPick, canReachSalvage, isRoadWreck } from './salvage';
import { beginSearch } from './search';
import { isFree } from './spawn';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { SalvageStock, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { defaultSetup } from './settings';
import { endTurn, newWorld } from './world';

const picks = oldSpotPicks(TEST_MAP);
// The building spot nearest its road, and the hulk spot nearest its road, for the shortest drives.
const roadGap = (p: OldSpotPick): number => dist(p.pos, nearestRoadPoint(p.pos));
const nearest = (list: OldSpotPick[]): OldSpotPick => list.reduce((a, b) => (roadGap(b) < roadGap(a) ? b : a));
const building = nearest(picks.filter((p) => p.type !== 'hulks'));
const hulks = nearest(picks.filter((p) => p.type === 'hulks'));
const DRIVE_TURNS = 60;

function setShare(share: number): void {
  const saved = OLD_PLACES.npcShare;
  OLD_PLACES.npcShare = share;
  onTestFinished(() => void (OLD_PLACES.npcShare = saved));
}

// The real map with no other NPCs and no spawns, the player parked at its start, far from the old spots under test.
function roadWorld(pick: OldSpotPick): { w: World; npc: Vehicle; stock: SalvageStock } {
  const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], freeNear(w, nearestRoadPoint(pick.pos)));
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  // Other loot seen on the way, like a hulk group beside a hamlet, would pull the driver off this spot.
  forceOption('salvageSeen', 'keep');
  const stock = w.salvage.find((s) => s.id === oldStockId(pick))!;
  stock.goods = { ...Object.fromEntries(Object.keys(OLD_TABLES[pick.type].goods).map((g) => [g, 0])), scrap: 2, parts: 1 };
  stock.parts = [];
  return { w, npc, stock };
}

function freeNear(w: World, p: Vec): Vec {
  for (let r = 0; r < 6; r += 0.5)
    for (let k = 0; k < 8; k++) {
      const at = { x: p.x + Math.cos((k / 8) * 2 * Math.PI) * r, y: p.y + Math.sin((k / 8) * 2 * Math.PI) * r };
      if (isFree(w, at, 1, null)) return at;
    }
  throw new Error(`No free ground near ${p.x},${p.y}`);
}

const moveFar = (w: World): void => w.vehicles.forEach((v) => v.brain && advanceFar(w, v));
const scavengeGoal = (pick: OldSpotPick) => ({ kind: 'scavenge' as const, targetId: oldStockId(pick), destination: { ...pick.pos }, phase: 'travel' as const, reason: 'searchOldRuin' as const });

// Scrap and the parts good across the stock and every truck, which loot moves but never makes.
function held(w: World, stockId: string): number {
  const stock = w.salvage.find((s) => s.id === stockId)!;
  const trucks = w.vehicles.reduce((n, v) => n + (goodsCount(v).scrap ?? 0) + (goodsCount(v).parts ?? 0), 0);
  return (stock.goods.scrap ?? 0) + (stock.goods.parts ?? 0) + (stock.hidden.goods.scrap ?? 0) + (stock.hidden.goods.parts ?? 0) + trucks;
}

function vehicle(w: World, id: string): Vehicle {
  return w.vehicles.find((v) => v.id === id)!;
}

// Turns until the NPC's goal on the stock ends, failing on any stall.
function runGoal(start: World, npcId: string, stockId: string, turns = DRIVE_TURNS, each: (w: World) => World = (w) => w): { w: World; searched: boolean; reasons: string[] } {
  let w = start;
  let searched = false;
  const reasons: string[] = [];
  for (let turn = 0; turn < turns; turn++) {
    w = each(endTurn(w, moveFar));
    expect(w.events.filter((e) => e.t === 'stall'), `turn ${turn}`).toEqual([]);
    const me = vehicle(w, npcId);
    if (me.job?.kind === 'search' && me.job.stockId === stockId) searched = true;
    for (const e of w.events) if (e.t === 'activity' && e.vehicle === npcId) reasons.push(e.reason);
    if (topGoal(me)?.targetId !== stockId) break;
  }
  return { w, searched, reasons };
}

describe('scavengers pick old-world loot spots', () => {
  // A scavenger on flat open ground at pos that will choose to scavenge.
  function scavengerAt(pos: Vec) {
    const w = emptyWorld({ x: 50, y: 50 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], pos);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    forceOption('idle', 'scavenge');
    forceOption('salvageSeen', 'keep');
    w.salvage = w.salvage.filter((stock) => !isRoadWreck(stock));
    return { w, npc };
  }

  it('heads for an old spot within range at the off-road share', () => {
    setShare(1);
    const { w, npc } = scavengerAt({ x: building.pos.x + 30, y: building.pos.y });
    planNpcOrders(w);
    const goal = topGoal(npc)!;
    expect(goal.kind).toBe('scavenge');
    const pick = picks.find((p) => oldStockId(p) === goal.targetId)!;
    expect(pick).toBeDefined();
    expect(goal.destination).toEqual(pick.pos);
    expect(dist(pick.pos, npc.pos)).toBeLessThanOrEqual(OLD_PLACES.npcRange);
  });

  it('keeps to its salvage sites when the share does not land', () => {
    setShare(0);
    const { w, npc } = scavengerAt({ x: building.pos.x + 30, y: building.pos.y });
    planNpcOrders(w);
    expect(oldSpotOf({ id: topGoal(npc)!.targetId ?? '' })).toBeNull();
  });

  it('never heads for an old spot out of range', () => {
    setShare(1);
    const far = [{ x: 5, y: 5 }, { x: 595, y: 5 }, { x: 5, y: 595 }, { x: 595, y: 595 }].find((p) => picks.every((q) => dist(p, q.pos) > OLD_PLACES.npcRange));
    expect(far).toBeDefined();
    const { w, npc } = scavengerAt(far!);
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('scavenge');
    expect(oldSpotOf({ id: topGoal(npc)!.targetId ?? '' })).toBeNull();
  });
});

describe('a scavenger at an old-world loot spot', () => {
  for (const pick of [building, hulks]) {
    it(`leaves the road for the ${pick.type} spot, searches it and takes its loot`, () => {
      const { w, npc, stock } = roadWorld(pick);
      npc.brain!.goals = [scavengeGoal(pick)];
      const before = held(w, stock.id);
      const { w: after, searched } = runGoal(w, npc.id, stock.id);
      const me = vehicle(after, npc.id);
      expect(searched).toBe(true);
      expect((goodsCount(me).scrap ?? 0) + (goodsCount(me).parts ?? 0)).toBeGreaterThan(0);
      expect(held(after, stock.id)).toBe(before);
      expect(canReachSalvage(me, after.salvage.find((s) => s.id === stock.id)!)).toBe(true);
    }, 120_000);
  }

  it('gives up an emptied spot on arrival', () => {
    const { w, npc, stock } = roadWorld(building);
    for (const good of Object.keys(stock.goods)) stock.goods[good] = 0;
    stock.fuel = 0;
    stock.supplies = 0;
    stock.hidden = { goods: {}, parts: [], fuel: 0, supplies: 0 };
    npc.brain!.goals = [scavengeGoal(building)];
    const { w: after, reasons } = runGoal(w, npc.id, stock.id);
    expect(reasons).toContain('salvageExhausted');
    expect(dist(vehicle(after, npc.id).pos, stock.pos)).toBeLessThan(stock.radius + 6);
  }, 120_000);

  it('leaves a spot the player is searching to the player, and the loot adds up', () => {
    const { w, npc, stock } = roadWorld(building);
    const me = vehicle(w, w.player.vehicleId);
    me.pos = parkingSpot(w, me, stock);
    me.speed = 0;
    me.order = null;
    beginSearch(w, me, stock.id);
    npc.brain!.goals = [scavengeGoal(building)];
    const before = held(w, stock.id);
    // The player keeps searching, as a player does when an NPC pulls up.
    const keepSearching = (open: World): World => {
      const next = open.player.call ? hangUp(open) : open;
      const player = vehicle(next, next.player.vehicleId);
      if (!player.job && (next.salvage.find((s) => s.id === stock.id)!.goods.scrap ?? 0) > 0) beginSearch(next, player, stock.id);
      return next;
    };
    const { w: after, searched, reasons } = runGoal(w, npc.id, stock.id, DRIVE_TURNS, keepSearching);
    expect(searched).toBe(false);
    expect(['lootTaken', 'looterWontLeave', 'fightOverLoot']).toContain(reasons[0]);
    expect(held(after, stock.id)).toBe(before);
  }, 120_000);
});

// A free point in salvage reach of the stock for the player's truck.
function parkingSpot(w: World, me: Vehicle, stock: SalvageStock): Vec {
  const radius = vehicleStats(w, me).radius;
  for (let r = stock.radius + radius + 0.5; r < stock.radius + 4; r += 0.25)
    for (let k = 0; k < 24; k++) {
      const at = { x: stock.pos.x + Math.cos((k / 24) * 2 * Math.PI) * r, y: stock.pos.y + Math.sin((k / 24) * 2 * Math.PI) * r };
      if (isFree(w, at, radius, me.id) && canReachSalvage({ ...me, pos: at, speed: 0 }, stock)) return at;
    }
  throw new Error(`No parking spot beside ${stock.id}`);
}
