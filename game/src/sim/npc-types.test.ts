import { describe, expect, it } from 'vitest';
import { GOOD_SOURCES } from '../data/market';
import { partDef } from '../data/parts';
import { MIN_CHANCE, NPC_BEHAVIOR, NPCS, SPAWN, TRAITS, type TraitId } from '../data/npcs';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { chassisDef } from '../data/chassis';
import { makePart } from './factory';
import { freeCells, goodsCount, mountedParts } from './grid';
import { addGoods } from './inventory';
import { huntingGrounds, optionChances, optionWeights, patrolPoints, raiderGrounds } from './npc-decisions';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { siteGates, sitePads } from './sites';
import { spawnInitial, spawnNpcs } from './spawn';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import { TEST_MAP } from '../test/map';
import { tileAt } from './terrain';
import type { NpcActivity, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { cloneWorld } from './world';

function siteById(id: string) {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
  if (!site) throw new Error(`No site ${id}`);
  return site;
}

function createNpc(w: World, templateId: string, traits: TraitId[], chassis: string, parts: string[], pos: Vec): Vehicle {
  const npc = addVehicle(w, NPCS[templateId].faction, chassis, parts, pos);
  npc.brain = npcBrain(templateId, pos, traits);
  return npc;
}

function idleGoals(w: World, npcId: string, seeds: number): NpcActivity[] {
  const goals: NpcActivity[] = [];
  for (let seed = 0; seed < seeds; seed++) {
    const x = cloneWorld(w);
    x.rngState = Math.imul(seed + 1, 2654435761);
    goals.push(thinkNpc(x, x.vehicles.find((v) => v.id === npcId)!));
  }
  return goals;
}

describe('patrols', () => {
  it('keeps every patrol point within the patrol radius of the town gate, outside the town', () => {
    const bowl = siteById('bowl');
    const w = emptyWorld({ x: 300, y: 300 });
    const pad = sitePads(bowl)[0];
    const npc = createNpc(w, 'bowlFarmer', ['lawman'], 'tractor', ['cannon', 'workhorseDiesel'], pad);
    forceOption('idle', 'patrol');
    const goals = idleGoals(w, npc.id, 60).filter((g) => g.kind === 'patrol');
    expect(goals.length).toBeGreaterThan(50);
    for (const goal of goals) {
      const nearestGate = Math.min(...siteGates(bowl).map((gate) => dist(gate, goal.destination!)));
      expect(nearestGate).toBeLessThanOrEqual(NPC_BEHAVIOR.patrolRadius);
      expect(dist(goal.destination!, bowl.pos)).toBeGreaterThan(bowl.radius);
    }
    expect(new Set(goals.map((g) => `${g.destination!.x},${g.destination!.y}`)).size).toBeGreaterThan(3);
  });

  it('patrols around the town nearest home, not the nearest town now', () => {
    const nose = siteById('nose');
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'noseArmy', ['lawman'], 'hauler', ['cannon', 'workhorseDiesel'], sitePads(siteById('bowl'))[0]);
    npc.brain!.home = { ...sitePads(nose)[0] };
    forceOption('idle', 'patrol');
    const goal = idleGoals(w, npc.id, 1)[0];
    expect(goal.kind).toBe('patrol');
    expect(Math.min(...siteGates(nose).map((gate) => dist(gate, goal.destination!)))).toBeLessThanOrEqual(NPC_BEHAVIOR.patrolRadius);
  });

  it('finishes a patrol parked on its point', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'bowlFarmer', ['lawman'], 'tractor', ['cannon', 'workhorseDiesel'], { x: 60, y: 60 });
    npc.brain!.goals = [{ kind: 'patrol', targetId: 'bowl', destination: { x: 60.2, y: 60 }, phase: 'travel', reason: 'test patrol' }];
    npc.speed = 0;
    resolveNpcActivities(w);
    expect(topGoal(npc)).toBeNull();
  });

  it('never offers patrol to a courier', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'courier', ['courier'], 'courier', ['mg', 'flatFour'], sitePads(siteById('bowl'))[0]);
    expect(optionWeights(w, npc, 'idle', null, null)).not.toHaveProperty('patrol');
  });

  it('offers raiders a patrol of their camp, within the patrol radius of its gates', () => {
    forceOption('idle', 'patrol');
    for (const id of ['scrapjaw', 'kiln']) {
      const camp = siteById(id);
      expect(patrolPoints(camp).length).toBeGreaterThanOrEqual(1);
      const w = emptyWorld({ x: 600, y: 600 });
      const npc = createNpc(w, 'buggy', ['raider'], 'buggy', ['mg', 'stockEngine'], sitePads(camp)[0]);
      expect(optionWeights(w, npc, 'idle', null, null)).toHaveProperty('patrol');
      const goals = idleGoals(w, npc.id, 30).filter((g) => g.kind === 'patrol');
      expect(goals.length).toBeGreaterThan(25);
      for (const goal of goals) {
        expect(goal.targetId).toBe(id);
        expect(goal.reason).toBe('patrol the roads near camp');
        expect(Math.min(...siteGates(camp).map((gate) => dist(gate, goal.destination!)))).toBeLessThanOrEqual(NPC_BEHAVIOR.patrolRadius);
      }
    }
  });

  it('sends a raider to raid only the grounds of its own camp', () => {
    forceOption('idle', 'raid');
    for (const id of ['scrapjaw', 'kiln']) {
      const camp = siteById(id);
      const w = emptyWorld({ x: 600, y: 600 });
      const npc = createNpc(w, 'buggy', ['raider'], 'buggy', ['mg', 'stockEngine'], sitePads(camp)[0]);
      const goals = idleGoals(w, npc.id, 30).filter((g) => g.kind === 'raid');
      expect(goals.length).toBeGreaterThan(25);
      for (const goal of goals) {
        expect(raiderGrounds(camp)).toContainEqual(goal.destination);
      }
    }
  });
});

describe('couriers', () => {
  it('mostly travel to another known site when idle', () => {
    const bowl = siteById('bowl');
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'courier', ['courier'], 'courier', ['mg', 'flatFour'], sitePads(bowl)[0]);
    const goals = idleGoals(w, npc.id, 50);
    const travels = goals.filter((g) => g.kind === 'travel');
    expect(travels.length / goals.length).toBeGreaterThan(0.9);
    for (const goal of travels) {
      expect(TRAITS.courier.travelSites).toContain(goal.targetId);
      expect(goal.targetId).not.toBe('bowl');
    }
  });

  it('stop for salvage on the way only at about the minimum chance', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'courier', ['courier'], 'courier', ['mg', 'flatFour'], { x: 30, y: 30 });
    npc.brain!.goals = [{ kind: 'travel', targetId: 'nose', destination: { ...siteById('nose').pos }, phase: 'travel', reason: 'test travel' }];
    w.salvage = [{ id: 'wreck-test', pos: { x: 34, y: 30 }, radius: 0.6, goods: { scrap: 2 }, parts: [makePart(w, 'plates', 0)] }];
    const chances = optionChances(optionWeights(w, npc, 'salvageSeen', 'wreck-test', null));
    expect(chances.loot).toBeCloseTo(MIN_CHANCE, 4);
  });

  it('finish a trip at the site', () => {
    const nose = siteById('nose');
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'courier', ['courier'], 'courier', ['mg', 'flatFour'], sitePads(nose)[0]);
    npc.brain!.goals = [{ kind: 'travel', targetId: 'nose', destination: { ...nose.pos }, phase: 'travel', reason: 'test travel' }];
    npc.speed = 0;
    resolveNpcActivities(w);
    expect(topGoal(npc)).toBeNull();
  });
});

describe('mercs', () => {
  it('scavenge and trade only at about the minimum chance, even beside salvage', () => {
    const bowl = siteById('bowl');
    const w = emptyWorld({ x: 300, y: 300 });
    const pad = sitePads(bowl)[0];
    const npc = createNpc(w, 'merc', ['merc'], 'hauler', ['cannon', 'workhorseDiesel'], pad);
    w.salvage = [{ id: 'wreck-test', pos: { x: pad.x + 4, y: pad.y }, radius: 0.6, goods: { scrap: 2 }, parts: [] }];
    const chances = optionChances(optionWeights(w, npc, 'idle', null, null));
    expect(chances.scavenge).toBeCloseTo(MIN_CHANCE, 2);
    expect(chances.trade ?? MIN_CHANCE).toBeCloseTo(MIN_CHANCE, 2);
    expect(chances.wait).toBeGreaterThan(0.8);
  });
});

describe('roamers', () => {
  it('explore free map points, some of them off road', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    w.terrain = TEST_MAP.terrain;
    const npc = createNpc(w, 'roamer', ['roamer'], 'scout', ['mg', 'stockEngine'], { x: 300, y: 310 });
    forceOption('idle', 'explore');
    const goals = idleGoals(w, npc.id, 30).filter((g) => g.kind === 'explore');
    expect(goals.length).toBeGreaterThan(25);
    for (const goal of goals) {
      expect(goal.destination!.x).toBeGreaterThan(0);
      expect(goal.destination!.y).toBeLessThan(w.size);
    }
    expect(goals.some((g) => w.terrain.types[tileAt(w.terrain, g.destination!)] !== 'road')).toBe(true);
  });

  it('explore more often than anything else when idle', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'roamer', ['roamer'], 'scout', ['mg', 'stockEngine'], sitePads(siteById('bowl'))[0]);
    const chances = optionChances(optionWeights(w, npc, 'idle', null, null));
    const best = Object.entries(chances).sort((a, b) => b[1] - a[1])[0][0];
    expect(best).toBe('explore');
  });
});

describe('supply convoys', () => {
  it('load fuel drums free at the pump station, then sell them in a town', () => {
    const pump = siteById('pump-station');
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'convoy', ['supplier'], 'hauler', ['mg', 'workhorseDiesel', 'trailerBox'], sitePads(pump)[0]);
    const money = npc.resources!.money;
    npc.brain!.goals = [{ kind: 'haul', targetId: pump.id, destination: { ...pump.pos }, phase: 'travel', reason: 'test haul', load: { good: 'fuelDrums' } }];
    npc.speed = 0;
    resolveNpcActivities(w);
    const loaded = goodsCount(npc).fuelDrums ?? 0;
    expect(loaded).toBeGreaterThan(0);
    expect(npc.resources!.money).toBe(money);
    const sale = topGoal(npc)!;
    expect(sale.kind).toBe('sell');
    expect(REGION.towns.map((t) => t.id)).toContain(sale.targetId);
    npc.pos = { ...sitePads(siteById(sale.targetId!))[0] };
    resolveNpcActivities(w);
    expect(goodsCount(npc).fuelDrums ?? 0).toBe(0);
    expect(npc.resources!.money).toBeGreaterThan(money);
  });

  it('pick a haul at a known source with the good that source gives', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'convoy', ['supplier'], 'hauler', ['mg', 'workhorseDiesel', 'trailerBox'], sitePads(siteById('bowl'))[0]);
    forceOption('idle', 'haul');
    const goals = idleGoals(w, npc.id, 20).filter((g) => g.kind === 'haul');
    expect(goals.length).toBeGreaterThan(15);
    for (const goal of goals) expect(GOOD_SOURCES[goal.load!.good]).toContain(goal.targetId);
  });

  it('cannot haul with a full grid', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'convoy', ['supplier'], 'scout', ['mg', 'stockEngine'], sitePads(siteById('bowl'))[0]);
    addGoods(w, npc, 'scrap', freeCells(npc));
    expect(freeCells(npc)).toBe(0);
    expect(optionWeights(w, npc, 'idle', null, null)).not.toHaveProperty('haul');
  });

  it('know only haul sources that give a good', () => {
    const sources = new Set(Object.values(GOOD_SOURCES).flat());
    for (const trait of Object.values(TRAITS)) for (const id of trait.haulSites) expect(sources.has(id), id).toBe(true);
  });
});

describe('spawns of the new templates', () => {
  it('put patrols at their own town and mercs at a town', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    spawnInitial(w);
    const gateNear = (v: Vehicle, id: string) => siteGates(siteById(id)).some((g) => dist(g, v.pos) <= SPAWN.gateSpread + 3);
    const of = (id: string) => w.vehicles.filter((v) => v.brain?.templateId === id);
    expect(of('bowlFarmer').length).toBeGreaterThan(0);
    for (const v of of('bowlFarmer')) expect(gateNear(v, 'bowl')).toBe(true);
    expect(of('noseArmy').length).toBeGreaterThan(0);
    for (const v of of('noseArmy')) expect(gateNear(v, 'nose')).toBe(true);
    expect(of('merc').length).toBe(2);
    for (const v of of('merc')) expect(gateNear(v, 'bowl') || gateNear(v, 'nose')).toBe(true);
  });

  it('spawns a guard beside each new convoy', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    spawnInitial(w);
    const convoys = w.vehicles.filter((v) => v.brain?.templateId === 'convoy');
    const guards = w.vehicles.filter((v) => v.brain?.templateId === 'convoyGuard');
    expect(convoys.length).toBeGreaterThan(0);
    expect(guards.length).toBe(convoys.length);
    for (const guard of guards) {
      const gap = Math.min(...convoys.map((c) => dist(c.pos, guard.pos) - chassisDef(c.chassisId).radius - chassisDef(guard.chassisId).radius));
      expect(gap).toBeLessThanOrEqual(SPAWN.escortGap + 0.01);
    }
  });

  it('never spawns a convoy guard on its own timer', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = id === 'convoyGuard' ? 1 : Number.MAX_SAFE_INTEGER;
    spawnNpcs(w);
    expect(w.vehicles.filter((v) => v.brain)).toHaveLength(0);
  });

  it('respawns a convoy with its guard while the guards are under their cap', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = id === 'convoy' ? 1 : Number.MAX_SAFE_INTEGER;
    spawnNpcs(w);
    expect(w.vehicles.filter((v) => v.brain?.templateId === 'convoy')).toHaveLength(1);
    expect(w.vehicles.filter((v) => v.brain?.templateId === 'convoyGuard')).toHaveLength(1);
  });
});

describe('vultures', () => {
  it('always carry a cargo part and only long-range guns', () => {
    let seen = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const x = emptyWorld({ x: 300, y: 300 });
      x.rngState = seed;
      spawnInitial(x);
      for (const v of x.vehicles.filter((n) => n.brain?.templateId === 'vulture')) {
        seen++;
        const defs = mountedParts(v).map((p) => partDef(p.defId));
        expect(defs.some((d) => d.kind === 'cargo')).toBe(true);
        for (const d of defs) if (d.kind === 'weapon') expect(d.range).toBeGreaterThanOrEqual(15);
      }
    }
    expect(seen).toBeGreaterThan(10);
  }, 60_000);

  it('stop for a wreck they pass nearly every time', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'vulture', ['vulture'], 'scout', ['longRifle', 'stockEngine'], { x: 30, y: 30 });
    npc.brain!.goals = [{ kind: 'prowl', targetId: null, destination: { x: 200, y: 200 }, phase: 'travel', reason: 'test prowl' }];
    w.salvage = [{ id: 'wreck-test', pos: { x: 34, y: 30 }, radius: 0.6, goods: { scrap: 2 }, parts: [makePart(w, 'plates', 0)] }];
    const chances = optionChances(optionWeights(w, npc, 'salvageSeen', 'wreck-test', null));
    expect(chances.loot).toBeGreaterThanOrEqual(0.9);
  });

  it('prowl more often than anything else and drive to hunting grounds away from them', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const start = huntingGrounds()[0];
    const npc = createNpc(w, 'vulture', ['vulture'], 'scout', ['longRifle', 'stockEngine'], { ...start });
    const chances = optionChances(optionWeights(w, npc, 'idle', null, null));
    expect(Object.entries(chances).sort((a, b) => b[1] - a[1])[0][0]).toBe('prowl');
    forceOption('idle', 'prowl');
    const goals = idleGoals(w, npc.id, 20).filter((g) => g.kind === 'prowl');
    expect(goals.length).toBe(20);
    for (const goal of goals) {
      expect(huntingGrounds().some((p) => p.x === goal.destination!.x && p.y === goal.destination!.y)).toBe(true);
      expect(dist(goal.destination!, start)).toBeGreaterThan(RULES.arriveRadius * 2);
      expect(goal.reason).toBe('prowl the roads for wrecks');
    }
  });

  it('leave prowling to the minimum chance for other drivers, and finish a prowl at the point', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const other = createNpc(w, 'scavenger', ['scavenger'], 'scout', ['mg', 'stockEngine'], sitePads(siteById('bowl'))[0]);
    expect(optionChances(optionWeights(w, other, 'idle', null, null)).prowl).toBeCloseTo(MIN_CHANCE, 2);
    const point = huntingGrounds()[0];
    const npc = createNpc(w, 'vulture', ['vulture'], 'scout', ['longRifle', 'stockEngine'], { ...point });
    npc.brain!.goals = [{ kind: 'prowl', targetId: null, destination: { ...point }, phase: 'travel', reason: 'test prowl' }];
    npc.speed = 0;
    resolveNpcActivities(w);
    expect(topGoal(npc)).toBeNull();
  });

  it('cannot prowl without fuel', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const npc = createNpc(w, 'vulture', ['vulture'], 'scout', ['longRifle', 'stockEngine'], { ...huntingGrounds()[0] });
    npc.resources!.fuel = 0;
    expect(optionChances(optionWeights(w, npc, 'idle', null, null)).prowl).toBeUndefined();
  });
});
