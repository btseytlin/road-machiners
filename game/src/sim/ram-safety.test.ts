import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import { ramValue } from './crash-contact';
import { corePart, mountedParts } from './grid';
import { planNpcOrders } from './ai';
import { addGoods, mountPart } from './inventory';
import { makePart } from './factory';
import { partDef } from '../data/parts';
import { DECISIONS, NPC_BEHAVIOR, NPCS, TRAITS } from '../data/npcs';
import { dist } from './vec';
import { thinkNpc } from './npc-activities';
import { isWeak, optionWeights } from './npc-decisions';
import type { Vehicle, World } from './types';

function fighting(world: World, raider: Vehicle): Vehicle {
  const me = world.player.vehicleId;
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  raider.brain.noticed[`hostileSeen:${me}`] = world.turn;
  raider.brain.goals.push({ kind: 'fight', targetId: me, destination: { x: 35, y: 30 }, phase: 'travel', reason: 'test' });
  return raider;
}

function createFight() {
  const world = emptyWorld({ x: 35, y: 30 });
  const raider = fighting(world, addVehicle(world, 'raiders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 30, y: 30 }));
  return { world, raider };
}

describe('ram chances', () => {
  const BASE_RAM = DECISIONS.ramChance.ram;
  const ramWeight = (world: World, v: Vehicle) => optionWeights(world, v, 'ramChance', world.player.vehicleId, null).ram;
  const valueOf = (world: World, v: Vehicle) => ramValue(world, v, world.vehicles[0]);

  it('rams a heavier target less readily', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    const light = ramWeight(world, raider)!;
    addGoods(world, world.vehicles[0], 'scrap', 60);
    const heavy = ramWeight(world, raider)!;
    expect(heavy).toBeLessThan(light);
  });

  it('rams a ram bar facing it less readily', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    const me = world.vehicles[0];
    me.heading = Math.PI;
    me.items = me.items.filter((it) => it.kind !== 'part' || partDef(it.part.defId).kind !== 'armor');
    const bare = valueOf(world, raider);
    expect(mountPart(world, me, makePart(world, 'plowRam', 0), ['F'])).toBe(true);
    expect(valueOf(world, raider)).toBeLessThan(bare);
  });

  it('offers a ram only on the fight target ahead within reach', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    expect(ramWeight(world, raider)).toBeDefined();
    raider.heading = Math.PI;
    expect(ramWeight(world, raider)).toBeUndefined();
    raider.heading = 0;
    raider.brain!.goals = [];
    expect(ramWeight(world, raider)).toBeUndefined();
  });

  it('weighs a worthwhile ram by its value against firing', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    const value = valueOf(world, raider);
    expect(value).toBeGreaterThan(0);
    expect(ramWeight(world, raider)).toBeCloseTo(BASE_RAM * value * NPC_BEHAVIOR.ram.valueScale);
  });

  it('makes a costly ram rare against a heavier armored target', () => {
    const world = emptyWorld({ x: 35, y: 30 });
    const raider = fighting(world, addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 }));
    raider.speed = 5;
    expect(ramWeight(world, raider)).toBeCloseTo(BASE_RAM * NPC_BEHAVIOR.ram.riskyRam);
  });

  it('makes a ram rare with a nearly broken engine', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    mountedParts(raider, 'engine')[0].hp = 1;
    expect(ramWeight(world, raider)).toBeCloseTo(BASE_RAM * NPC_BEHAVIOR.ram.riskyRam);
    expect(corePart(raider, 'cab').hp).toBeGreaterThan(0);
  });

  it('makes a trader ram rarely even when the ram looks gainful', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    raider.brain!.traits = ['trader'];
    expect(ramWeight(world, raider)).toBeCloseTo(BASE_RAM * TRAITS.trader.weights.ramChance!.ram!.mul! * valueOf(world, raider) * NPC_BEHAVIOR.ram.valueScale);
  });

  it('rolls once per ram chance and drives through while it chose to ram', () => {
    const { world, raider } = createFight();
    const me = world.player.vehicleId;
    raider.speed = 5;
    forceOption('ramChance', 'ram');
    planNpcOrders(world);
    expect(raider.brain!.noticed[`ramChance:${me}`]).toBe(world.turn);
    expect(raider.brain!.ramChoice).toBe(me);
    expect(raider.brain!.ramTarget).toBe(me);
    expect(raider.order?.kind).toBe('through');
    const rng = world.rngState;
    planNpcOrders(world);
    expect(world.rngState).toBe(rng);
    expect(raider.brain!.ramChoice).toBe(me);
  });

  it('holds its range when it chose to keep', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    forceOption('ramChance', 'keep');
    planNpcOrders(world);
    expect(raider.brain!.ramChoice).toBeUndefined();
    expect(raider.brain!.ramTarget).toBeUndefined();
    const order = raider.order!;
    if (order.kind === 'brake') throw new Error('A fighter with its target in sight drives');
    expect(dist(order.dest, world.vehicles[0].pos)).toBeGreaterThanOrEqual(NPCS.buggy.preferredRange - 0.01);
  });

  it('rams only while the target stays within reach', () => {
    const { world, raider } = createFight();
    const me = world.player.vehicleId;
    raider.brain!.ramChoice = me;
    raider.brain!.noticed[`ramChance:${me}`] = world.turn;
    raider.heading = Math.PI;
    planNpcOrders(world);
    expect(raider.brain!.ramChoice).toBe(me);
    expect(raider.brain!.ramTarget).toBeUndefined();
  });

  it('forgets the choice once the chance is gone past the notice memory, so a new chance rolls again', () => {
    const { world, raider } = createFight();
    const me = world.player.vehicleId;
    raider.brain!.ramChoice = me;
    raider.brain!.noticed[`ramChance:${me}`] = world.turn;
    raider.heading = Math.PI;
    world.turn += NPC_BEHAVIOR.noticeMemory + 1;
    thinkNpc(world, raider);
    expect(raider.brain!.noticed).not.toHaveProperty(`ramChance:${me}`);
    expect(raider.brain!.ramChoice).toBeUndefined();
  });

  it('drops the choice when the fight ends', () => {
    const { world, raider } = createFight();
    const me = world.player.vehicleId;
    raider.brain!.ramChoice = me;
    raider.brain!.goals = [];
    thinkNpc(world, raider);
    expect(raider.brain!.ramChoice).toBeUndefined();
  });
});

describe('crippled drivers', () => {
  function createListener() {
    const world = emptyWorld({ x: 1, y: 1 });
    const raider = addVehicle(world, 'raiders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 30, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    return { world, raider, me: world.player.vehicleId };
  }

  it('counts a dead engine as weak even while its cab and gun work, so fleeing a new hostile rises', () => {
    const { world, raider } = createFight();
    const me = world.player.vehicleId;
    const intact = optionWeights(world, raider, 'hostileSeen', me, 0).flee!;
    mountedParts(raider, 'engine')[0].hp = 0;
    expect(isWeak(world, raider)).toBe(true);
    expect(optionWeights(world, raider, 'hostileSeen', me, 0).flee).toBeCloseTo(intact * NPC_BEHAVIOR.weakFlee);
  });

  it('rarely closes in on a heard contact when crippled, and heads for repairs', () => {
    const { world, raider, me } = createListener();
    const intact = optionWeights(world, raider, 'contactHeard', me, null).investigate!;
    mountedParts(raider, 'engine')[0].hp = 0;
    expect(optionWeights(world, raider, 'contactHeard', me, null).investigate).toBeCloseTo(intact * NPC_BEHAVIOR.crippledInvestigate);
    thinkNpc(world, raider);
    expect(raider.brain!.goals.some((g) => g.kind === 'resupply')).toBe(true);
  });
});
