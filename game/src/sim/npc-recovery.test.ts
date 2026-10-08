import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOR, NPCS, SPAWN, type TraitId } from '../data/npcs';
import { REGION } from '../data/region';
import { planNpcOrders } from './ai';
import { assignAutoOrders, fireWeapons } from './combat';
import { corePart, mountedParts } from './grid';
import { addGoods } from './inventory';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { chooseOn } from './tracks';
import { fightOddsAgainst, judgeDanger, perceiveDanger } from './npc-decisions';
import { siteGates } from './sites';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import { cloneWorld } from './world';
import { addState, stateOf } from './states';

const TRAITS_OF: Record<string, TraitId[]> = { scavenger: ['scavenger'], buggy: ['raider'], trader: ['trader'] };

function createScenario(templateId = 'scavenger') {
  const world = emptyWorld({ x: 200, y: 200 });
  const npc = addVehicle(world, NPCS[templateId].faction, 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  return { world, npc };
}

function workGoal(templateId: string): NpcActivity {
  if (templateId === 'trader') return { kind: 'sell', targetId: REGION.towns[0].id, destination: { ...REGION.towns[0].pos }, phase: 'travel', reason: 'deliver purchased cargo' };
  return { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' };
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
    world.turn += NPC_BEHAVIOR.fightSearchTurns + 1;
    const resumed = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      return JSON.stringify(topGoal(me)) === JSON.stringify(work);
    });
    expect(resumed).toBeGreaterThan(0.8);
  }, 90_000);

  it.each(['scavenger', 'trader'])('allows a retreating %s to return fire', (template) => {
    const { world, npc } = createScenario(template);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, npc);
    npc.brain!.goals = [{ kind: 'flee', targetId: enemy.id, destination: { x: 10, y: 30 }, phase: 'travel', reason: 'test flight', perceived: world.turn }];
    npc.brain!.attackers[enemy.id] = true;
    chooseOn(world, npc, enemy.id, enemy.pos, 'flee', true);
    npc.brain!.hurt = 0;
    planNpcOrders(world);
    expect(topGoal(npc)?.kind).toBe('flee');
    expectReturnFire(world, npc, enemy);
  });

  it('turns on an attacker it cannot get away from rather than run', () => {
    const { world, npc } = createScenario('scavenger');
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, npc);
    corePart(npc, 'cab').hp = 1;
    const odds = fightOddsAgainst(world, npc, enemy);
    expect(odds.getaway).toBeLessThan(odds.win);
    const fled = shareOfSeeds(world, npc.id, (x, me) => {
      planNpcOrders(x);
      return topGoal(me)?.kind === 'flee';
    });
    expect(fled).toBeLessThan(0.6);
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
    expect(judged()).toBeGreaterThan(alone * 1.5);
  });

  it('counts visible faction mates nearby in its own strength', () => {
    const { world, npc } = createScenario('buggy');
    const trader = addVehicle(world, 'traders', 'scout', ['mg'], { x: 36, y: 30 });
    const alone = judgeDanger(world, npc, trader);
    addVehicle(world, 'raiders', 'scout', ['mg'], { x: 30 + SPAWN.neighborHelp + 5, y: 30 });
    expect(judgeDanger(world, npc, trader)).toBe(alone);
    addVehicle(world, 'raiders', 'scout', ['mg'], { x: 32, y: 30 });
    expect(judgeDanger(world, npc, trader)).toBeLessThan(alone / 1.5);
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
    npc.brain!.goals.push({ kind: 'repair', targetId: null, destination: null, phase: 'act', reason: 'patch damaged parts' });
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

  it('keeps running from a threat out of sight until it has been calm a while', () => {
    const { world, npc } = createScenario('buggy');
    const shooter = addVehicle(world, 'vultures', 'van', ['mg', 'stockEngine'], { x: 190, y: 190 });
    const flee: NpcActivity = { kind: 'flee', targetId: shooter.id, destination: { x: 5, y: 5 }, phase: 'travel', reason: 'escape an attacker', perceived: world.turn };
    npc.brain!.goals = [workGoal('buggy'), flee];

    world.turn += NPC_BEHAVIOR.fleeCalmTurns;
    thinkNpc(world, npc);
    expect(topGoal(npc)).toBe(flee);

    npc.brain!.hurt = 5;
    planNpcOrders(world);
    npc.brain!.hurt = 0;
    world.turn += NPC_BEHAVIOR.fleeCalmTurns;
    thinkNpc(world, npc);
    expect(topGoal(npc)?.kind).toBe('flee');

    world.turn += 1;
    thinkNpc(world, npc);
    expect(npc.brain!.goals.map((g) => g.kind)).not.toContain('flee');
  });

  it('stops looking for a truck it runs from', () => {
    const { world, npc } = createScenario('scavenger');
    const enemy = addVehicle(world, 'raiders', 'wagon', ['heavyMg', 'mg', 'stockEngine'], { x: 36, y: 30 });
    enemy.brain = npcBrain('gunwagon', enemy.pos, ['raider']);
    const look: NpcActivity = { kind: 'investigate', targetId: enemy.id, destination: { ...enemy.pos }, phase: 'travel', reason: 'heard a hostile beyond sight' };
    npc.brain!.goals = [workGoal('scavenger'), look];
    fireAt(world, enemy, npc);
    let fled = 0;
    shareOfSeeds(world, npc.id, (x, me) => {
      thinkNpc(x, me);
      if (topGoal(me)?.kind !== 'flee') return false;
      fled++;
      expect(me.brain!.goals.map((g) => g.kind)).not.toContain('investigate');
      return true;
    });
    expect(fled).toBeGreaterThan(0);
  });

  it('keeps its target when a second attacker shoots, so its fire finishes one truck', () => {
    const { world, npc } = createScenario('buggy');
    const first = addVehicle(world, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 36, y: 30 });
    const second = addVehicle(world, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 30, y: 36 });
    const fight: NpcActivity = { kind: 'fight', targetId: first.id, destination: { ...first.pos }, phase: 'travel', reason: 'fight a hostile in sight', worn: { turn: world.turn, condition: 1 } };
    npc.brain!.goals = [workGoal('buggy'), fight];
    chooseOn(world, npc, first.id, first.pos, 'fight', true);
    fireAt(world, second, npc);
    const kept = shareOfSeeds(world, npc.id, (x, me) => {
      thinkNpc(x, me);
      return !me.brain!.goals.some((g) => g.kind === 'fight' && g.targetId === second.id);
    });
    expect(kept).toBe(1);
  });

  describe('a stalled fight', () => {
    const stalled = (worn: number) => {
      const { world, npc } = createScenario('buggy');
      const target = addVehicle(world, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 36, y: 30 });
      addState(world, 'feud', npc.id, target.id, { kind: 'feud', robbery: false });
      const fight: NpcActivity = { kind: 'fight', targetId: target.id, destination: { ...target.pos }, phase: 'travel', reason: 'fight a hostile in sight', worn: { turn: world.turn, condition: worn } };
      npc.brain!.goals = [workGoal('buggy'), fight];
      chooseOn(world, npc, target.id, target.pos, 'fight', true);
      world.turn += NPC_BEHAVIOR.fightStallTurns + 1;
      thinkNpc(world, npc);
      return { world, npc, target };
    };

    it('is given up when the target wore down too little, with the feud ended and the target backed off', () => {
      const { world, npc, target } = stalled(1);
      expect(npc.brain!.goals.some((g) => g.kind === 'fight' && g.targetId === target.id)).toBe(false);
      expect(stateOf(world, 'feud', npc.id, target.id)).toBeNull();
      expect(stateOf(world, 'backedOff', npc.id, target.id)).not.toBeNull();
    });

    it('holds while the target keeps wearing down', () => {
      const { npc, target } = stalled(1 + NPC_BEHAVIOR.fightWearShare);
      expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: target.id });
    });
  });
});
