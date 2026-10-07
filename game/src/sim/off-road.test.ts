import { describe, expect, it } from 'vitest';
import { corePart, mountedParts } from './grid';
import { keepsOffRoads } from './off-road';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { Faction, NpcActivity, Vehicle, World } from './types';

function driver(w: World, faction: Faction, goal: NpcActivity['kind'] | null): Vehicle {
  const v = addVehicle(w, faction, 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
  v.brain = npcBrain('test', { x: 60, y: 60 }, []);
  if (goal) v.brain.goals = [{ kind: goal, targetId: null, destination: { x: 60, y: 60 }, phase: 'travel', reason: 'test' }];
  return v;
}

describe('keepsOffRoads', () => {
  it('holds for a raider that retreats or flees', () => {
    const w = emptyWorld();
    expect(keepsOffRoads(w, driver(w, 'raiders', 'retreat'))).toBe(true);
    expect(keepsOffRoads(w, driver(w, 'raiders', 'flee'))).toBe(true);
  });

  it('holds for a stranded raider whatever its goal', () => {
    const w = emptyWorld();
    const dry = driver(w, 'raiders', 'patrol');
    dry.resources!.fuel = 0;
    const geared = driver(w, 'raiders', 'fight');
    corePart(geared, 'transmission').hp = 0;
    const engineless = driver(w, 'raiders', null);
    mountedParts(engineless, 'engine')[0].hp = 0;
    expect([dry, geared, engineless].map((v) => keepsOffRoads(w, v))).toEqual([true, true, true]);
  });

  it('leaves a healthy raider on patrol, raid or fight on the roads', () => {
    const w = emptyWorld();
    for (const goal of ['patrol', 'raid', 'fight', null] as const) expect(keepsOffRoads(w, driver(w, 'raiders', goal))).toBe(false);
  });

  it('leaves other factions and the player on the roads', () => {
    const w = emptyWorld();
    const trader = driver(w, 'traders', 'travel');
    trader.resources!.fuel = 0;
    expect(keepsOffRoads(w, trader)).toBe(false);
    expect(keepsOffRoads(w, driver(w, 'nose', 'flee'))).toBe(false);
    w.player.fuel = 0;
    expect(keepsOffRoads(w, w.vehicles[0])).toBe(false);
  });
});
