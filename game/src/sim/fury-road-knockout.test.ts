import { describe, expect, it } from 'vitest';
import { FURY_ROAD } from '../data/modes';
import { resolveDestroyed } from './combat';
import { playerVehicle } from './damage';
import { advanceNpcKnockouts, checkKnockout, isKnockedOut, knockOutNpc } from './defeat';
import { advanceFuryRoad, outpostPad, waitForRoad } from './fury-road';
import { corePart } from './grid';
import { downedListNear, downedHere } from './locations';
import { topGoal } from './npc-activities';
import { getResources } from './resources';
import { canLootTruck, takeFromTruck } from './salvage';
import { furyRoadWorld } from './testkit';
import type { FuryRoadRun, Vehicle, WaveGroup, World } from './types';
import { endTurn } from './world';

const still = () => {};

function runOf(w: World): FuryRoadRun {
  if (!w.furyRoad) throw new Error('No run');
  return w.furyRoad;
}

function spawnGroup(w: World, i = 0): WaveGroup {
  w.turn = runOf(w).quietFrom + FURY_ROAD.pacing.quiet;
  advanceFuryRoad(w);
  const group = runOf(w).groups[i];
  if (!group.spawned) throw new Error(`Group ${i} did not spawn`);
  return group;
}

function trucksOf(w: World, g: WaveGroup): Vehicle[] {
  return w.vehicles.filter((v) => g.vehicles.includes(v.id));
}

function beside(w: World, v: Vehicle): void {
  const me = playerVehicle(w);
  v.pos = { x: me.pos.x + 4, y: me.pos.y };
  v.speed = 0;
}

function knockOut(w: World, v: Vehicle): void {
  corePart(v, 'cab').hp = 0;
  knockOutNpc(w, v);
}

function wreck(w: World, v: Vehicle): void {
  w.events = [];
  getResources(w, v).health = 0;
  resolveDestroyed(w);
}

function nextLevel(w: World): World {
  const me = playerVehicle(w);
  me.pos = outpostPad(w, runOf(w).window + 1);
  me.speed = 0;
  me.order = null;
  return waitForRoad(endTurn(w, still));
}

describe('a knocked-out Fury Road truck', () => {
  it('can be looted by nobody', () => {
    const w = furyRoadWorld();
    const v = trucksOf(w, spawnGroup(w))[0];
    beside(w, v);
    knockOut(w, v);

    expect(isKnockedOut(v)).toBe(true);
    expect(canLootTruck(w, playerVehicle(w), v)).toBe(false);
    expect(downedListNear(w)).toEqual([]);
    expect(downedHere(w)).toBeNull();
    const item = v.items[0];
    expect(() => takeFromTruck(w, v.id, item.id, { x: 0, y: 0, rot: 0 })).toThrow(/loot/);
  });

  it('counts once when knocked out and then shot to a wreck', () => {
    const w = furyRoadWorld();
    const group = spawnGroup(w);
    const v = trucksOf(w, group)[0];
    knockOut(w, v);
    advanceFuryRoad(w);
    expect(group.wrecked).toBe(1);
    expect(group.counted).toEqual([v.id]);

    wreck(w, v);
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'destroyed', vehicle: v.id }));
    advanceFuryRoad(w);

    expect(group.wrecked).toBe(1);
  });

  it('counts a plain wreck once', () => {
    const w = furyRoadWorld();
    const group = spawnGroup(w);
    wreck(w, trucksOf(w, group)[0]);
    advanceFuryRoad(w);

    expect(group.wrecked).toBe(1);
  });

  it('is not hunted back into the fight', () => {
    const w = furyRoadWorld();
    const v = trucksOf(w, spawnGroup(w))[0];
    beside(w, v);
    knockOut(w, v);

    advanceFuryRoad(w);

    expect(topGoal(v)?.kind).not.toBe('fight');
  });

  it('holds no encounter on, so the next group comes after the quiet', () => {
    let w = furyRoadWorld(4);
    w = nextLevel(w);
    const first = spawnGroup(w);
    for (const v of trucksOf(w, first)) {
      beside(w, v);
      knockOut(w, v);
    }
    const from = w.turn;
    while (w.turn < from + FURY_ROAD.pacing.quiet + 1 && !runOf(w).groups[1].spawned) {
      w.turn++;
      advanceFuryRoad(w);
    }

    expect(runOf(w).groups[1].spawned).toBe(true);
  });

  it('leaves the road when it wakes, and the run plays on', () => {
    let w = furyRoadWorld();
    const group = spawnGroup(w);
    const v = trucksOf(w, group)[0];
    knockOut(w, v);
    v.pos = { x: playerVehicle(w).pos.x + 200, y: playerVehicle(w).pos.y };
    advanceFuryRoad(w);

    advanceNpcKnockouts(w);
    expect(v.defeat?.phase).toBe('retreat');
    advanceFuryRoad(w);

    expect(w.vehicles.some((x) => x.id === v.id)).toBe(false);
    expect(w.removed.some((x) => x.id === v.id)).toBe(true);
    expect(w.states.some((s) => s.holder === v.id || s.other === v.id)).toBe(false);
    expect(group.wrecked).toBe(1);
    for (let t = 0; t < 50; t++) w = endTurn(w, still);
    expect(group.wrecked).toBe(1);
  });

  it('ends the run when the player is the one knocked out', () => {
    const w = furyRoadWorld();
    corePart(playerVehicle(w), 'cab').hp = 0;

    checkKnockout(w);

    expect(w.player.state).toBe('dead');
  });
});
