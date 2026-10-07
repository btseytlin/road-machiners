import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOR, NPCS, SPAWN, type TraitId } from '../data/npcs';
import { REGION } from '../data/region';
import { planNpcOrders } from './ai';
import { assignAutoOrders, fireWeapons } from './combat';
import { corePart, mountedParts } from './grid';
import { addGoods } from './inventory';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { ownDanger, perceiveDanger } from './npc-decisions';
import { siteGates } from './sites';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import { cloneWorld } from './world';

const TRAITS_OF: Record<string, TraitId[]> = { scavenger: ['scavenger'], buggy: ['raider'], trader: ['trader'] };

function createScenario(templateId = 'scavenger') {
  const world = emptyWorld({ x: 200, y: 200 });
  const npc = addVehicle(world, NPCS[templateId].faction, 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  return { world, npc };
}

// Long-term work for each template, far from the test area.
function workGoal(templateId: string): NpcActivity {
  if (templateId === 'trader') return { kind: 'sell', targetId: REGION.towns[0].id, destination: { ...REGION.towns[0].pos }, phase: 'travel', reason: 'deliverCargo' };
  return { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'searchSite' };
}

function fireAt(world: World, shooter: Vehicle, target: Vehicle) {
  for (const part of mountedParts(shooter, 'weapon')) shooter.weaponOrders[part.id] = { targetId: target.id, aim: 'body' };
  fireWeapons(world);
  expect(world.events.some((event) => event.t === 'shot' && event.shooter === shooter.id && event.target === target.id)).toBe(true);
}

function expectReturnFire(world: World, npc: Vehicle, enemy: Vehicle) {
  assignAutoOrders(world);
  expect(Object.values(npc.weaponOrders).some((order) => order.targetId === enemy.id)).toBe(true);
}

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

const byId = (world: World, id: string) => world.vehicles.find((v) => v.id === id)!;

describe('NPC gameplay recovery', () => {
  it('lets an idle healthy scavenger attack a manageable hostile', () => {
    const { world, npc } = createScenario();
    const raider = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    // An equal truck looks manageable on about half of the sightings.
    expect(shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'fight')).toBeGreaterThan(0.4);
    corePart(raider, 'cab').hp = 1;
    expect(shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'fight')).toBeGreaterThan(0.8);
  });

  it('a busy scavenger rarely starts a fight with a manageable hostile', () => {
    const { world, npc } = createScenario();
    npc.brain!.goals = [workGoal('scavenger')];
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    expect(shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'fight')).toBeLessThan(0.1);
  });

  it.each(['scavenger', 'trader'])('keeps a working %s out of an unrelated battle', (template) => {
    const { world, npc } = createScenario(template);
    npc.brain!.goals = [workGoal(template)];
    const work = structuredClone(npc.brain!.goals[0]);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    const outsider = addVehicle(world, 'player', 'scout', [], { x: 35, y: 30 });
    fireAt(world, enemy, outsider);
    const kept = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      assignAutoOrders(x);
      const keeps = topGoal(me)?.kind === work.kind;
      if (keeps) {
        expect(topGoal(me)).toEqual(work);
        expect(me.weaponOrders).toEqual({});
      }
      return keeps;
    });
    expect(kept).toBeGreaterThan(0.9);
  });

  it('interrupts work to fight its attacker and resumes the same destination after escape', () => {
    const { world, npc } = createScenario();
    npc.brain!.goals = [workGoal('scavenger')];
    const work = structuredClone(npc.brain!.goals[0]);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, npc);
    // Shots prompt defense or retreat. Against an equal truck, fighting back wins on about half of the rolls.
    const reactions = (kind: string) => shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      return topGoal(me)?.kind === kind && topGoal(me)?.targetId === enemy.id;
    });
    const fought = reactions('fight');
    expect(fought + reactions('flee')).toBeGreaterThan(0.9);
    expect(fought).toBeGreaterThan(0.3);
    const seed = Array.from({ length: 20 }, (_, i) => i).find((s) => {
      const x = cloneWorld(world);
      x.rngState = s;
      planNpcOrders(x);
      return topGoal(byId(x, npc.id))?.kind === 'fight';
    });
    if (seed === undefined) throw new Error('No seed in 20 fights back');
    world.rngState = seed;
    planNpcOrders(world);
    expectReturnFire(world, npc, enemy);
    enemy.pos = { x: 200, y: 100 };
    enemy.speed = 0;
    // The driver hunts a lost foe for a while before it gives up.
    world.turn += NPC_BEHAVIOR.fightSearchTurns + 1;
    // The resume roll goes back to the interrupted work about nine times in ten.
    const resumed = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      return JSON.stringify(topGoal(me)) === JSON.stringify(work);
    });
    expect(resumed).toBeGreaterThan(0.8);
  }, 90_000); // takes 10-25s alone and over 30s when the whole suite shares the cores

  it.each(['scavenger', 'trader'])('allows a retreating %s to return fire', (template) => {
    const { world, npc } = createScenario(template);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, npc);
    corePart(npc, 'cab').hp = 1;
    const fled = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      const flees = topGoal(me)?.kind === 'flee';
      if (flees) expectReturnFire(x, me, byId(x, enemy.id));
      return flees;
    });
    expect(fled).toBeGreaterThan(0.9);
  });

  it('allows a scavenger to help a nearby faction mate under attack', () => {
    const { world, npc } = createScenario();
    npc.brain!.goals = [workGoal('scavenger')];
    const ally = addVehicle(world, 'scavengers', 'scout', [], { x: 32, y: 32 });
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 });
    fireAt(world, enemy, ally);
    const reacted = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      expectReturnFire(x, me, byId(x, enemy.id));
      return topGoal(me)?.kind === 'fight' || topGoal(me)?.kind === 'flee';
    });
    expect(reacted).toBeGreaterThan(0.9);
  });

  it('does not use guard protection to silence a victim defending itself', () => {
    const { world, npc } = createScenario();
    const gate = siteGates(REGION.towns[0])[0];
    npc.pos = { ...gate };
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: gate.x + 3, y: gate.y });
    fireAt(world, enemy, npc);
    const fought = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      expectReturnFire(x, me, byId(x, enemy.id));
      return topGoal(me)?.kind === 'fight';
    });
    // Guard caution lowers starting a fight, never fighting back. An equal attacker is fought about half the time.
    expect(fought).toBeGreaterThan(0.3);
  });

  it('does not treat unrelated visible factions as one army', () => {
    const { world, npc } = createScenario('buggy');
    const trader = addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 30 });
    const judged = () => {
      world.rngState = 7;
      return perceiveDanger(world, npc, trader);
    };
    const alone = judged();
    addVehicle(world, 'scavengers', 'scout', ['mg'], { x: 30, y: 42 });
    expect(judged()).toBe(alone);
    addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 33 });
    expect(judged()).toBeCloseTo(alone * 2);
  });

  it('counts visible faction mates nearby in its own strength', () => {
    const { world, npc } = createScenario('buggy');
    const alone = ownDanger(world, npc);
    addVehicle(world, 'raiders', 'scout', ['mg'], { x: 32, y: 30 });
    addVehicle(world, 'raiders', 'scout', ['mg'], { x: 30 + SPAWN.neighborHelp + 5, y: 30 });
    expect(ownDanger(world, npc)).toBe(alone * 2);
  });

  it('mostly withdraws from a locally stronger enemy group', () => {
    const { world, npc } = createScenario('buggy');
    addVehicle(world, 'scavengers', 'scout', ['mg'], { x: 33, y: 30 });
    addVehicle(world, 'scavengers', 'scout', ['mg'], { x: 34, y: 32 });
    expect(shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'flee')).toBeGreaterThan(0.5);
  });

  it('investigates a useful contact once instead of chasing its moving center forever', () => {
    const { world, npc } = createScenario('buggy');
    const prey = addVehicle(world, 'traders', 'scout', ['stockEngine'], { x: 55, y: 30 });
    prey.speed = 4;
    expect(shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'investigate')).toBeGreaterThan(0.6);
    const seed = Array.from({ length: 20 }, (_, i) => i).find((s) => {
      const x = cloneWorld(world);
      x.rngState = s;
      return thinkNpc(x, byId(x, npc.id)).kind === 'investigate';
    });
    if (seed === undefined) throw new Error('No seed in 20 investigates');
    world.rngState = seed;
    planNpcOrders(world);
    expect(topGoal(npc)?.kind).toBe('investigate');
    const destination = { ...topGoal(npc)!.destination! };
    prey.pos.x += 1;
    planNpcOrders(world);
    expect(topGoal(npc)?.destination).toEqual(destination);
    npc.pos = destination;
    prey.pos = { x: destination.x + 25, y: destination.y };
    resolveNpcActivities(world);
    planNpcOrders(world);
    expect(topGoal(npc)?.kind).not.toBe('investigate');
  });

  it('investigates an accurate scanner contact far beyond hearing', () => {
    const world = emptyWorld({ x: 200, y: 200 });
    const npc = addVehicle(world, 'raiders', 'scout', ['mg', 'scanner', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    const prey = addVehicle(world, 'traders', 'scout', ['stockEngine'], { x: 150, y: 30 });
    prey.speed = 4;
    expect(shareOfSeeds(world, npc.id, (x, me) => thinkNpc(x, me).kind === 'investigate')).toBeGreaterThan(0.6);
  });

  it('drops a field repair and starts none while a hostile in sight shoots at it', () => {
    const { world, npc } = createScenario();
    npc.brain!.goals = [workGoal('scavenger')];
    addGoods(world, npc, 'parts', 4);
    corePart(npc, 'cab').hp = 1;
    const calm = cloneWorld(world);
    expect(thinkNpc(calm, byId(calm, npc.id)).kind).toBe('repair');
    npc.brain!.goals.push({ kind: 'repair', targetId: null, destination: null, phase: 'act', reason: 'patchParts' });
    const raider = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, raider, npc);
    const repairs = shareOfSeeds(world, npc.id, (x, me) => {
      thinkNpc(x, me);
      return me.brain!.goals.some((g) => g.kind === 'repair');
    });
    expect(repairs).toBe(0);
  });

  it('services low fuel instead of pursuing a contact or taking a shade detour', () => {
    const { world, npc } = createScenario('buggy');
    npc.resources!.fuel = 0;
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    const prey = addVehicle(world, 'traders', 'scout', ['stockEngine'], { x: 55, y: 30 });
    prey.speed = 4;
    const activity = thinkNpc(world, npc);
    expect(['resupply', 'repair']).toContain(activity.kind);
    if (activity.kind === 'repair') expect(activity.destination).toBeNull();
  });
});
