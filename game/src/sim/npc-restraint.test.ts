import { describe, expect, it } from 'vitest';
import { NPCS, type TraitId } from '../data/npcs';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { partDef } from '../data/parts';
import { planNpcOrders } from './ai';
import { assignAutoOrders } from './combat';
import { corePart, goodsCount, mountedParts } from './grid';
import { addGoods } from './inventory';
import { advanceJobs } from './jobs';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { getKnownSite } from './npc-decisions';
import { spawnInitial } from './spawn';
import { inShade, sunAt } from './sun';
import { straightClear } from './path';
import { vehicleStats } from './stats';
import { cloneWorld, endTurn } from './world';
import { addVehicle, emptyWorld, npcBrain, testDrive  } from './testkit';
import { siteGates, sitePads } from './sites';
import { budget } from '../test/budget';
import type { NpcActivity, Vehicle, World } from './types';

const TRAITS_OF: Record<string, TraitId[]> = { scavenger: ['scavenger'], buggy: ['raider'], trader: ['trader'] };

function createNpc(templateId = 'scavenger') {
  const world = emptyWorld({ x: 200, y: 200 });
  const npc = addVehicle(world, NPCS[templateId].faction, 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  return { world, npc };
}

const scavengeGoal: NpcActivity = { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'searchSite' };

// Runs `check` on a copy of the world for each seed and returns the share of seeds where it holds. Seeds are
// spread over the RNG state, since neighboring states give correlated first draws.
function shareOfSeeds(world: World, npcId: string, check: (x: World, npc: Vehicle) => boolean, seeds = 200): number {
  let held = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const x = cloneWorld(world);
    x.rngState = Math.imul(seed, 2654435761);
    if (check(x, x.vehicles.find((v) => v.id === npcId)!)) held++;
  }
  return held / seeds;
}

describe('NPC restraint', () => {
  it('preserves normal raider cargo alongside available repair supplies', () => {
    // Loadouts are random, so look across a few spawns.
    const raiders = [0, 1, 2, 3, 4].flatMap((seed) => {
      const world = emptyWorld();
      world.rngState = seed;
      spawnInitial(world);
      return world.vehicles.filter((v) => v.faction === 'raiders');
    });
    expect(raiders.some((npc) => Object.entries(goodsCount(npc)).some(([good, count]) => good !== 'parts' && count > 0))).toBe(true);
    expect(raiders.some((npc) => (goodsCount(npc).parts ?? 0) > 0)).toBe(true);
  }, 90_000); // takes 10-25s alone and over 30s when the whole suite shares the cores

  it('mostly keeps civilian work and never opens fire at an uninvolved hostile', () => {
    const { world, npc } = createNpc();
    npc.brain!.goals = [{ ...scavengeGoal }];
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    const kept = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      assignAutoOrders(x);
      const keeps = topGoal(me)?.kind === 'scavenge';
      if (keeps) expect(me.weaponOrders).toEqual({});
      return keeps;
    });
    expect(kept).toBeGreaterThan(0.9);
  });

  it('judges the nearby hostile faction group before attacking', () => {
    const { world, npc } = createNpc('buggy');
    addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 30 });
    const alone = shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'flee');
    addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 32 });
    const grouped = shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'flee');
    expect(grouped).toBeGreaterThan(0.5);
    expect(grouped).toBeGreaterThan(alone + 0.2);
  });

  it('mostly attacks an isolated manageable target', () => {
    const { world, npc } = createNpc('buggy');
    const prey = addVehicle(world, 'traders', 'scout', [], { x: 33, y: 30 });
    addGoods(world, prey, 'electronics', 3);
    const fought = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      assignAutoOrders(x);
      const fights = topGoal(me)?.kind === 'fight';
      if (fights) expect(Object.keys(me.weaponOrders)).toHaveLength(1);
      return fights;
    });
    expect(fought).toBeGreaterThan(0.9);
  }, budget(90_000)); // many seeds of planning take a few seconds alone and near 30s when the whole suite shares the cores

  it('rarely attacks prey at a guarded town gate, and holds fire when it does not', () => {
    const { world, npc } = createNpc('buggy');
    const gate = siteGates(REGION.towns[0])[0];
    npc.pos = { x: gate.x + 3, y: gate.y };
    const prey = addVehicle(world, 'traders', 'scout', [], gate);
    addGoods(world, prey, 'scrap', 1);
    const fought = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      assignAutoOrders(x);
      const fights = topGoal(me)?.kind === 'fight';
      if (!fights) expect(me.weaponOrders).toEqual({});
      return fights;
    });
    expect(fought).toBeLessThan(0.05);
  });
});

describe('NPC field repairs', () => {
  it('parks in nearby reachable shade and spends carried parts to patch damage', () => {
    const { world, npc } = createNpc();
    world.vehicles[0].pos = { x: 60, y: 60 }; // inside the live range, so shade counts
    addGoods(world, npc, 'parts', 2);
    const cab = corePart(npc, 'cab');
    cab.hp = partDef(cab.defId).hp * 0.2;
    const before = cab.hp;
    const sun = sunAt(world.turn)!;
    world.obstacles.push({ id: 'shade-rock', kind: 'rock', pos: { x: 34, y: 33 }, r: 1 });
    expect(inShade(world, npc.pos, sun)).toBe(false);
    planNpcOrders(world);
    const activity = topGoal(npc)!;
    expect(activity.kind).toBe('repair');
    expect(inShade(world, activity.destination!, sun)).toBe(true);
    expect(straightClear(world, npc.pos, activity.destination!, vehicleStats(world, npc).radius, [])).toBe(true);
    npc.pos = { ...activity.destination! };
    npc.speed = 0;
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
    const turns = npc.job!.total;
    for (let turn = 0; turn < turns; turn++) {
      planNpcOrders(world);
      expect(npc.order?.kind).toBe('brake');
      advanceJobs(world);
    }
    expect(npc.job).toBeNull();
    expect(cab.hp).toBeGreaterThan(before);
    expect(goodsCount(npc).parts ?? 0).toBeLessThan(2);
  });

  it('keeps repairing where it stands after drifting off its shade spot', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    // Each part is one carried part short of the field cap.
    const cab = corePart(npc, 'cab');
    cab.hp = partDef(cab.defId).hp * 0.4;
    const engine = mountedParts(npc, 'engine')[0];
    engine.hp = partDef(engine.defId).hp * 0.45;
    const before = { cab: cab.hp, engine: engine.hp };
    world.obstacles.push({ id: 'shade-rock', kind: 'rock', pos: { x: 34, y: 33 }, r: 1 });
    planNpcOrders(world);
    const spot = { ...topGoal(npc)!.destination! };
    npc.pos = { ...spot };
    npc.speed = 0;
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
    while (npc.job) advanceJobs(world);
    npc.pos = { x: spot.x + 0.7, y: spot.y };
    for (let turn = 0; turn < 6 && npc.job === null && (goodsCount(npc).parts ?? 0) > 0; turn++) {
      planNpcOrders(world);
      expect(npc.order?.kind).toBe('brake');
      resolveNpcActivities(world);
      while (npc.job) advanceJobs(world);
    }
    expect(goodsCount(npc).parts ?? 0).toBe(0);
    expect(cab.hp).toBeGreaterThan(before.cab);
    expect(engine.hp).toBeGreaterThan(before.engine);
  });

  it('repairs where it stands when no shade was found, even after rolling on', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    planNpcOrders(world);
    expect(topGoal(npc)!.kind).toBe('repair');
    npc.pos = { x: npc.pos.x + 3, y: npc.pos.y };
    npc.speed = 0;
    planNpcOrders(world);
    expect(npc.order?.kind).toBe('brake');
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
  });

  it('parks to repair when no shade is reachable', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    planNpcOrders(world);
    expect(topGoal(npc)!.kind).toBe('repair');
    expect(npc.order?.kind).toBe('brake');
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
  });

  it.each([false, true])('repairs where it stopped with no fuel, detour already chosen: %s', (started) => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    world.obstacles.push({ id: 'shade-rock', kind: 'rock', pos: { x: 34, y: 33 }, r: 1 });
    if (started) planNpcOrders(world);
    npc.resources!.fuel = 0;
    planNpcOrders(world);
    expect(topGoal(npc)!.kind).toBe('repair');
    expect(npc.order?.kind).toBe('brake');
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
  });

  it('mostly flees instead of repairing under visible threat, and never starts the repair then', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    const fled = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      resolveNpcActivities(x);
      const flees = topGoal(me)!.kind === 'flee';
      if (flees) expect(me.job).toBeNull();
      return flees;
    });
    expect(fled).toBeGreaterThan(0.9);
  });

  it.each([false, true])('orders escape during a repair and obeys parked-job rules, pinned: %s', (pinned) => {
    const { world, npc } = createNpc();
    for (const id of Object.keys(NPCS)) world.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 12;
    planNpcOrders(world);
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });

    // Exercise both movement outcomes at the public turn boundary, without depending on steering startup.
    const turn = (seed: number) => {
      const start = cloneWorld(world);
      start.rngState = seed;
      return endTurn(start, (draft) => {
        const moved = draft.vehicles.find((vehicle) => vehicle.id === npc.id);
        if (!moved) throw new Error('Missing repair NPC');
        const before = { ...moved.pos, heading: moved.heading };
        moved.speed = pinned ? 0 : RULES.parkedSpeed * 2;
        moved.pos = { x: moved.pos.x + moved.speed, y: moved.pos.y };
        moved.trail = [before, { ...moved.pos, heading: moved.heading }];
      });
    };
    const actorIn = (w: World) => w.vehicles.find((vehicle) => vehicle.id === npc.id)!;
    // The escape is a weighted choice, so take the first seed on which the driver flees.
    const seed = Array.from({ length: 20 }, (_, i) => i).find((s) => topGoal(actorIn(turn(s)))?.kind === 'flee');
    if (seed === undefined) throw new Error('No seed in 20 flees');
    const next = turn(seed);
    const actor = actorIn(next);
    expect(actor.brain!.goals.map((g) => g.kind)).toEqual(['repair', 'flee']);
    expect(actor.order?.kind).toBe('stopAt');
    expect(goodsCount(actor).parts).toBe(2);
    // A hostile that only passes by does not stop the repair, so a parked truck keeps at it and a moving one loses it.
    if (pinned) {
      expect(actor.speed).toBe(0);
      expect(actor.job?.kind).toBe('repair');
      return;
    }
    expect(actor.speed).toBeGreaterThan(0);
    expect(actor.job).toBeNull();
    expect(next.events.some((event) => event.t === 'job' && event.vehicle === actor.id && event.outcome === 'cancelled')).toBe(true);
  });

  it('seeks service for a badly damaged mounted part without repair supplies', () => {
    const { world, npc } = createNpc();
    const engine = npc.items.find((item) => item.kind === 'part' && item.part.defId === 'stockEngine');
    if (!engine || engine.kind !== 'part') throw new Error('Missing test engine');
    engine.part.hp = 1;
    expect(thinkNpc(world, npc).kind).toBe('resupply');
  });

  it('sends a truck with no engine on a service stall to a town, since only a town refits it', () => {
    const { world, npc } = createNpc();
    npc.items = npc.items.filter((item) => !(item.kind === 'part' && item.part.defId === 'stockEngine'));
    npc.resources!.money = 900;
    npc.pos = { ...sitePads(getKnownSite('granary'))[0] };
    const goal = thinkNpc(world, npc);
    expect(goal.kind).toBe('resupply');
    expect(REGION.towns.map((t) => t.id)).toContain(goal.targetId);
  });

  it('does not seek service for a broken gun', () => {
    const { world, npc } = createNpc();
    const gun = npc.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!gun || gun.kind !== 'part') throw new Error('Missing test gun');
    gun.part.hp = 1;
    expect(thinkNpc(world, npc).kind).not.toBe('resupply');
  });

  it('preserves repair supplies during a town service visit', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    // A dry tank strands the truck, and a stranded driver at a town gets a fresh loadout. A low tank only needs a visit.
    npc.resources!.fuel = 0.3;
    npc.resources!.money = 500;
    npc.pos = { ...sitePads(REGION.towns[0])[0] };
    planNpcOrders(world);
    expect(topGoal(npc)!.kind).toBe('resupply');
    resolveNpcActivities(world);
    expect(goodsCount(npc).parts).toBe(2);
    expect(npc.resources!.fuel).toBeGreaterThan(0);
  });

  it('finishes field repairs through the turn pipeline and resumes work', () => {
    let { world, npc } = createNpc();
    for (const id of Object.keys(NPCS)) world.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(world, npc, 'parts', 2);
    npc.brain!.goals = [{ ...scavengeGoal }];
    const cab = corePart(npc, 'cab');
    cab.hp = partDef(cab.defId).hp * 0.2;
    const initialHp = cab.hp;
    const npcId = npc.id;
    let started = false;
    let completed = false;
    for (let turn = 0; turn < 8; turn++) {
      world = endTurn(world, testDrive);
      npc = world.vehicles.find((v) => v.id === npcId)!;
      started ||= world.events.some((e) => e.t === 'job' && e.vehicle === npcId && e.outcome === 'started');
      completed ||= world.events.some((e) => e.t === 'job' && e.vehicle === npcId && e.outcome === 'done');
    }
    expect(started).toBe(true);
    expect(completed).toBe(true);
    expect(corePart(npc, 'cab').hp).toBeGreaterThan(initialHp);
    expect(topGoal(npc)!.kind).toBe('scavenge');
    expect(goodsCount(npc).parts ?? 0).toBe(0);
  });

  it('does not sell its repair reserve or treat it as trade cargo', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    expect(thinkNpc(world, npc).kind).not.toBe('sell');
    addGoods(world, npc, 'scrap', 1);
    npc.pos = { ...sitePads(REGION.towns[0])[0] };
    npc.brain!.goals = [{ kind: 'sell', targetId: REGION.towns[0].id, destination: REGION.towns[0].pos, phase: 'act', reason: 'sellCargo' }];
    resolveNpcActivities(world);
    expect(goodsCount(npc).scrap ?? 0).toBe(0);
    expect(goodsCount(npc).parts).toBe(2);
  });
});
