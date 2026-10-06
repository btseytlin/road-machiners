import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { corePart, mountedParts } from './grid';
import { fitToHunt } from './npc-decisions';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { getResources } from './resources';
import { siteGates } from './sites';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { PartInstance, Vehicle, World } from './types';
import { maxHp } from './wear';
import type { Vec } from './vec';

const kiln = REGION.locations.find((l) => l.id === 'kiln')!;
const gate = siteGates(kiln)[0];

// A point `d` tiles out from the kiln gate, away from the camp. One tile out stands on its pad.
function outside(d: number): Vec {
  return { x: gate.x + ((gate.x - kiln.pos.x) / kiln.radius) * d, y: gate.y + ((gate.y - kiln.pos.y) / kiln.radius) * d };
}

// A raider buggy far from the player, out on the road from the kiln, with a gun and armor plates.
function raider(): { w: World; v: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine', 'plates'], outside(20));
  v.brain = npcBrain('buggy', v.pos, NPCS.buggy.traits);
  return { w, v };
}

const gunsOf = (v: Vehicle): PartInstance[] => mountedParts(v, 'weapon');
const armorOf = (v: Vehicle): PartInstance[] => mountedParts(v, 'armor');

// Breaks every gun and wears the armor down, leaving the cab, engine and drive sound.
function crippleGear(v: Vehicle): void {
  for (const gun of gunsOf(v)) gun.hp = 0;
  for (const plate of armorOf(v)) plate.hp = Math.floor(maxHp(plate) * 0.2);
}

function parkAtCamp(v: Vehicle): void {
  v.pos = outside(1);
  v.speed = 0;
}

describe('a raider unfit to hunt', () => {
  it('drives to its camp for service when broke, with no cargo and a sound core, instead of raiding', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 0;
    forceOption('idle', 'raid');
    expect(corePart(v, 'cab').hp).toBe(maxHp(corePart(v, 'cab')));
    expect(fitToHunt(w, v)).toBe(false);
    expect(thinkNpc(w, v)).toMatchObject({ kind: 'resupply', targetId: 'kiln', reason: 'unfit to hunt' });
    expect(v.brain!.goals.map((g) => g.kind)).toEqual(['resupply']);
  });

  it('is repaired at camp, guns and armor included, when it can pay, and then may raid again', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 5000;
    expect(thinkNpc(w, v)).toMatchObject({ kind: 'resupply', targetId: 'kiln' });
    parkAtCamp(v);
    resolveNpcActivities(w);
    for (const part of [...gunsOf(v), ...armorOf(v)]) expect(part.hp).toBe(maxHp(part));
    expect(getResources(w, v).money).toBeLessThan(5000);
    expect(topGoal(v)).toBeNull();
    expect(fitToHunt(w, v)).toBe(true);
    forceOption('idle', 'raid');
    expect(thinkNpc(w, v).kind).toBe('raid');
  });
});
