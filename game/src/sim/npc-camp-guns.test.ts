import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOR } from '../data/npc-behavior';
import { RULES } from '../data/rules';
import { campGunning, nearestGate } from './camp-guns';
import { corePart } from './grid';
import { addGoods } from './inventory';
import { noteHurt, thinkNpc, topGoal } from './npc-activities';
import { siteGates } from './sites';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { REGION } from '../data/region';
import { visibleSalvage } from './npc-decisions';
import { canVehicleSee, refreshVision } from './vision';
import type { Vec } from './vec';
import type { Vehicle, World } from './types';

const kiln = REGION.locations.find((l) => l.id === 'kiln')!;
const gate = siteGates(kiln)[0];

// A point `d` tiles from the kiln gate, straight away from the camp center.
function outside(d: number): Vec {
  const away = { x: gate.x - kiln.pos.x, y: gate.y - kiln.pos.y };
  const len = Math.hypot(away.x, away.y);
  return { x: gate.x + (away.x / len) * d, y: gate.y + (away.y / len) * d };
}

function scavengerAt(w: World, pos: Vec): Vehicle {
  const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], pos);
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  npc.speed = 0;
  return npc;
}

function shotBy(w: World, npc: Vehicle): void {
  w.events.push({ t: 'guardShot', site: 'kiln', from: { ...gate }, target: npc.id, rounds: [] });
  noteHurt(w);
}

describe('camp gate guns as a danger', () => {
  it('a driver shot by a camp gate gun flees from the camp, with no roll', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = scavengerAt(w, outside(5));
    shotBy(w, npc);
    expect(npc.brain!.gunnedBy).toBe('kiln');
    w.events = [];
    thinkNpc(w, npc);
    expect(topGoal(npc)).toMatchObject({ kind: 'flee', targetId: 'kiln', reason: 'shot by camp guns' });
    expect(npc.brain!.gunnedBy).toBeUndefined();
    expect(dist2(topGoal(npc)!.destination!, gate)).toBeGreaterThan(dist2(npc.pos, gate));
  });

  it('keeps fleeing while inside the gun range plus the margin, and stops outside it', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = scavengerAt(w, outside(5));
    shotBy(w, npc);
    thinkNpc(w, npc);
    npc.pos = outside(RULES.guards.range + NPC_BEHAVIOR.campGunMargin - 1);
    thinkNpc(w, npc);
    expect(topGoal(npc)?.kind).toBe('flee');
    npc.pos = outside(RULES.guards.range + NPC_BEHAVIOR.campGunMargin + 1);
    w.events = [];
    thinkNpc(w, npc);
    expect(w.events).toContainEqual(expect.objectContaining({ previous: 'flee', reason: 'out of the camp gun range' }));
    expect(topGoal(npc)?.kind).not.toBe('flee');
  });

  it('a town gate shot at a driver does not start a camp flee', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = scavengerAt(w, outside(5));
    w.events.push({ t: 'guardShot', site: 'bowl', from: { ...gate }, target: npc.id, rounds: [] });
    noteHurt(w);
    expect(npc.brain!.gunnedBy).toBeUndefined();
  });

  it('a raider is never in a camp gun range', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], outside(3));
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], outside(3));
    expect(campGunning(raider, raider.pos)).toBeNull();
    expect(campGunning(trader, trader.pos)?.id).toBe('kiln');
    expect(campGunning(trader, outside(RULES.guards.range + 1))).toBeNull();
    expect(nearestGate(kiln, outside(2))).toEqual(gate);
  });

  it('starts no repair inside the gun range and starts one outside it', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = scavengerAt(w, outside(5));
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'podfield', destination: { x: 200, y: 200 }, phase: 'travel', reason: 'search a known salvage site' }];
    addGoods(w, npc, 'parts', 4);
    corePart(npc, 'cab').hp = 1;
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'repair')).toBe(false);
    expect(npc.job).toBeNull();
    npc.pos = outside(RULES.guards.range + 3);
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'repair')).toBe(true);
  });

  it('does not see salvage inside the gun range as loot', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = scavengerAt(w, outside(14));
    w.salvage = [];
    w.salvage.push({ id: 'wreck-near-gate', pos: outside(4), radius: 0.6, goods: { scrap: 3 }, parts: [] });
    w.salvage.push({ id: 'wreck-clear', pos: outside(14), radius: 0.6, goods: { scrap: 3 }, parts: [] });
    refreshVision(w);
    expect(canVehicleSee(w, npc, outside(4))).toBe(true);
    expect(visibleSalvage(w, npc).map((s) => s.id)).toEqual(['wreck-clear']);
  });
});

function dist2(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
