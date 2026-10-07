import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { corePart } from './grid';
import { noteHurt, popGoal, pushGoal, replaceBase, resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { sitePads } from './sites';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls } from './testkit';
import type { NpcActivity, World } from './types';

function scavengerWorld() {
  const w = emptyWorld({ x: 80, y: 80 });
  const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  return { w, npc };
}

const goal = (kind: NpcActivity['kind'], targetId: string | null, reason = 'test goal'): NpcActivity => ({ kind, targetId, destination: null, phase: 'act', reason });
const activityEvents = (w: World) => w.events.filter((e) => e.t === 'activity');

describe('goal stack', () => {
  it('a goal change cancels a job that does not belong to the new top goal', () => {
    const { w, npc } = scavengerWorld();
    pushGoal(w, npc, goal('scavenge', 'podfield'));
    npc.job = { kind: 'search', stockId: 'podfield', turnsLeft: 3, total: 3 };
    // A goal on the same stock keeps the search.
    pushGoal(w, npc, goal('loot', 'podfield'));
    expect(npc.job).not.toBeNull();
    pushGoal(w, npc, goal('resupply', 'bowl'));
    expect(npc.job).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', vehicle: npc.id, outcome: 'cancelled' }));
  });


  it('pushes on top, replaces a goal of the same kind, and pops back to the one below', () => {
    const { w, npc } = scavengerWorld();
    pushGoal(w, npc, goal('scavenge', 'podfield'));
    pushGoal(w, npc, goal('flee', 'a'));
    pushGoal(w, npc, goal('resupply', 'bowl'));
    pushGoal(w, npc, goal('flee', 'b'));
    expect(npc.brain!.goals.map((g) => `${g.kind}:${g.targetId}`)).toEqual(['scavenge:podfield', 'resupply:bowl', 'flee:b']);
    expect(popGoal(w, npc, 'safe').kind).toBe('flee');
    expect(topGoal(npc)?.kind).toBe('resupply');
    expect(activityEvents(w).at(-1)).toMatchObject({ previous: 'flee', activity: 'resupply', reason: 'safe' });
    expect(activityEvents(w)).toHaveLength(5);
  });

  it('replaces the bottom goal in place', () => {
    const { w, npc } = scavengerWorld();
    pushGoal(w, npc, goal('trade', 'bowl'));
    replaceBase(w, npc, goal('sell', 'nose'));
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['sell']);
  });

  it('throws on a missing stack, and on popping an empty one', () => {
    const { w, npc } = scavengerWorld();
    expect(() => popGoal(w, npc, 'nothing')).toThrow(/no goal/);
    delete (npc.brain as { goals?: NpcActivity[] }).goals;
    expect(() => topGoal(npc)).toThrow(/goals/);
  });

  it('an interrupted scavenge goal is active again after flee and service pop', () => {
    const { w, npc } = scavengerWorld();
    w.vehicles[0].pos = { x: 50, y: 50 }; // inside the live range, so the cover rock hides the raider
    forceOption('hostileSeen', 'flee');
    forceOption('resume', 'resume');
    const site = REGION.locations.find((l) => l.id === 'podfield')!;
    pushGoal(w, npc, { kind: 'scavenge', targetId: site.id, destination: { ...site.pos }, phase: 'travel', reason: 'search a known salvage site' });
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    corePart(npc, 'cab').hp = 1;
    thinkNpc(w, npc);
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['scavenge', 'resupply', 'flee']);
    w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: 12, y: 10 }, r: 1 });
    expect(thinkNpc(w, npc).kind).toBe('resupply');
    const stop = [...REGION.towns, ...REGION.locations].find((s) => s.id === topGoal(npc)!.targetId)!;
    npc.pos = { ...sitePads(stop)[0] };
    npc.speed = 0;
    resolveNpcActivities(w);
    expect(corePart(npc, 'cab').hp).toBeGreaterThan(1);
    expect(topGoal(npc)).toMatchObject({ kind: 'scavenge', targetId: site.id });
    expect(npc.brain!.goals).toHaveLength(1);
  });

  it('a resume roll of new drops the uncovered goal', () => {
    const { w, npc } = scavengerWorld();
    forceOption('hostileSeen', 'flee');
    forceOption('resume', 'new');
    pushGoal(w, npc, goal('raid', null));
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    thinkNpc(w, npc);
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['raid', 'flee']);
    raider.pos = { x: 70, y: 10 };
    raider.speed = 0;
    w.rngState = rngStateForForcedRolls(6);
    expect(thinkNpc(w, npc).kind).not.toBe('raid');
    expect(npc.brain!.goals.some((g) => g.kind === 'raid')).toBe(false);
  });
});

describe('damage taken', () => {
  it('sums part damage from shots and collisions this turn', () => {
    const { w, npc } = scavengerWorld();
    const other = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    const round = (damage: number[]) => ({ hit: true, crit: false, offset: 0, struck: npc.id, hits: damage.map((d) => ({ part: 'x', damage: d })), blast: [] });
    npc.brain!.hurt = 7;
    w.events = [
      { t: 'shot', shooter: other.id, weapon: 'w', target: npc.id, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [round([3, 2]), round([])] },
      { t: 'shot', shooter: other.id, weapon: 'w2', target: npc.id, aim: 'body', chance: 1, damageChance: 1, side: 'left', rounds: [round([4])] },
      { t: 'collision', a: npc.id, b: 'rock-1', hitsA: [{ part: 'x', damage: 1 }], hitsB: [] },
      { t: 'collision', a: other.id, b: npc.id, hitsA: [{ part: 'y', damage: 9 }], hitsB: [{ part: 'x', damage: 5 }] },
    ];
    noteHurt(w);
    expect(npc.brain!.hurt).toBe(15);
    w.events = [];
    noteHurt(w);
    expect(npc.brain!.hurt).toBe(0);
  });

});
