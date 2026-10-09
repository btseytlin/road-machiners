import { describe, expect, it } from 'vitest';
import { FURY_ROAD, HIGHWAY } from '../data/fury-road';
import { playerVehicle } from './damage';
import { abandonRun, advanceFuryRoad, canAbandonRun, furyRoadReadout, moveWindow, outpostPad, payOf, reachedOutpostAt, runEarnings, stockSizeOf, waveOf, WINDOW_MOVE } from './fury-road';
import { highwayHash, milestoneAt, roadPoint, STRIDE } from './highway';
import { topGoal } from './npc-activities';
import { addState, stateOf } from './states';
import { furyRoadWorld } from './testkit';
import type { FuryRoadRun, World } from './types';
import { heightAt } from './terrain';
import { endTurn } from './world';

function runOf(w: World): FuryRoadRun {
  if (!w.furyRoad) throw new Error('No run');
  return w.furyRoad;
}

function moveTo(w: World, n: number): void {
  const me = playerVehicle(w);
  me.pos = roadPoint(w.seed, runOf(w).window, n, HIGHWAY.road.lanes[1]);
  me.speed = 0;
}

function parkOnNext(w: World): void {
  const me = playerVehicle(w);
  me.pos = outpostPad(w, runOf(w).window + 1);
  me.speed = 0;
  me.order = null;
}

function arrive(w: World): World {
  parkOnNext(w);
  return endTurn(w, still);
}

function groupTrucks(w: World): string[] {
  return runOf(w).groups.flatMap((g) => g.vehicles);
}

const still = () => {};

describe('Fury Road groups', () => {
  it('spawn only once the player comes within the lead of their anchor', () => {
    const w = furyRoadWorld();
    const group = runOf(w).groups[0];

    moveTo(w, group.at - FURY_ROAD.spawnLead - 4);
    advanceFuryRoad(w);
    expect(group.spawned).toBe(false);

    moveTo(w, group.at - FURY_ROAD.spawnLead + 1);
    advanceFuryRoad(w);
    expect(group.spawned).toBe(true);
    expect(group.vehicles).toHaveLength(group.templates.length);
  });

  it('spawn hostile, hunting the player, inside the window', () => {
    const w = furyRoadWorld();
    const group = runOf(w).groups[0];
    moveTo(w, group.at);

    advanceFuryRoad(w);

    for (const id of group.vehicles) {
      const v = w.vehicles.find((x) => x.id === id)!;
      expect(stateOf(w, 'feud', id, w.player.vehicleId)).not.toBeNull();
      expect(topGoal(v)).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
      expect(Math.min(v.pos.x, v.pos.y)).toBeGreaterThan(0);
      expect(Math.max(v.pos.x, v.pos.y)).toBeLessThan(w.size);
    }
  });

  it('never put more than the cap of trucks on the road at once', () => {
    let w = furyRoadWorld();
    for (let k = 0; k < 7; k++) w = arrive(w);
    const run = runOf(w);
    moveTo(w, Math.max(...run.groups.map((g) => g.at)) + 1);
    advanceFuryRoad(w);
    const late = { ...run.groups[0], id: 'late', spawned: false, vehicles: [], templates: ['buggy'] };
    run.groups.push(late);

    advanceFuryRoad(w);

    expect(groupTrucks(w).length).toBe(FURY_ROAD.maxAlive);
    expect(late.spawned).toBe(false);
  });

  it('keep hunting a player they meet long after they spawn', () => {
    let w = furyRoadWorld();
    const group = runOf(w).groups[0];
    moveTo(w, group.at - FURY_ROAD.spawnLead + 1);
    advanceFuryRoad(w);
    for (let i = 0; i < 15; i++) w = endTurn(w, still);

    for (const id of runOf(w).groups[0].vehicles.filter((id) => w.vehicles.some((v) => v.id === id))) {
      expect(stateOf(w, 'feud', id, w.player.vehicleId)).not.toBeNull();
      expect(topGoal(w.vehicles.find((v) => v.id === id)!)?.kind).toBe('fight');
    }
  });
});

describe('arriving at an outpost', () => {
  it('pays once, moves the window north and keeps the player on the same pad and ground', () => {
    const w = furyRoadWorld();
    const money = w.player.money;
    parkOnNext(w);
    const before = playerVehicle(w).pos;
    const ground = w.terrain.types[Math.floor(before.y) * w.size + Math.floor(before.x)];

    const after = endTurn(w, still);
    const me = playerVehicle(after);

    expect(runOf(after).window).toBe(1);
    expect(after.mapHash).toBe(highwayHash(w.seed, 1));
    expect(after.player.money).toBe(money + payOf(1, 0));
    expect(after.events).toContainEqual({ t: 'outpostReached', milestone: 1, pay: payOf(1, 0), wrecks: 0 });
    expect(me.pos).toEqual({ x: before.x + STRIDE, y: before.y + STRIDE });
    expect(after.terrain.types[Math.floor(me.pos.y) * after.size + Math.floor(me.pos.x)]).toBe(ground);
    expect(runOf(after).outposts.map((o) => [o.milestone, o.paid])).toEqual([[1, true], [2, false]]);
    expect(runOf(after).groups.every((g) => g.stretch === 2)).toBe(true);
    expect(reachedOutpostAt(after)?.name).toBe('Outpost 1');
  });

  it('shifts the player, the ground under it and the explored overlap one stride up the diagonal', () => {
    const w = furyRoadWorld();
    parkOnNext(w);
    const before = playerVehicle(w).pos;
    w.player.explored[95 * w.size + 5] = 1;

    const after = endTurn(w, still);
    const me = playerVehicle(after);
    const shifted = (95 + STRIDE) * after.size + 5 + STRIDE;

    expect(heightAt(after.terrain, me.pos.x, me.pos.y)).toBeCloseTo(heightAt(w.terrain, before.x, before.y), 9);
    expect(after.player.explored[shifted]).toBe(1);
    expect(after.vehicles.every((v) => v.pos.x > 0 && v.pos.y > 0 && v.pos.x < after.size && v.pos.y < after.size)).toBe(true);
  });

  it('pays nothing more on the next turns or after moving off and back', () => {
    let w = arrive(furyRoadWorld());
    const money = w.player.money;
    w = endTurn(w, still);
    moveTo(w, milestoneAt(1) + 20);
    w = endTurn(w, still);
    playerVehicle(w).pos = outpostPad(w, 1);
    w = endTurn(w, still);

    expect(w.player.money).toBe(money);
    expect(runOf(w).window).toBe(1);
  });

  it('does not complete on the move, off the pad or in combat', () => {
    const moving = furyRoadWorld();
    parkOnNext(moving);
    playerVehicle(moving).speed = 2;
    const off = furyRoadWorld();
    moveTo(off, milestoneAt(1) - 20);
    const fighting = furyRoadWorld();
    parkOnNext(fighting);
    const foe = { ...playerVehicle(fighting), id: 'v-foe' };
    fighting.vehicles.push(foe);
    addState(fighting, 'combat', foe.id, fighting.player.vehicleId, { kind: 'none' });

    for (const w of [moving, off, fighting]) advanceFuryRoad(w);

    expect([moving, off, fighting].map((w) => runOf(w).window)).toEqual([0, 0, 0]);
  });

  it('pays the base and a bonus for each wreck of the stretch, and keeps the run totals', () => {
    const w = furyRoadWorld();
    runOf(w).groups[0].wrecked = 2;
    const money = w.player.money;

    const after = arrive(w);

    expect(after.player.money).toBe(money + payOf(1, 2));
    expect(runOf(after).earned).toBe(payOf(1, 2));
    expect(runOf(after).wrecks).toBe(2);
    expect(runEarnings(after)).toMatchObject({ pay: payOf(1, 2), wrecks: 2, reached: 1 });
  });

  it('counts a wreck of a group truck toward the stretch', () => {
    const w = furyRoadWorld();
    const group = runOf(w).groups[0];
    moveTo(w, group.at);
    advanceFuryRoad(w);
    w.events = [{ t: 'destroyed', vehicle: group.vehicles[0], by: w.player.vehicleId }];

    advanceFuryRoad(w);

    expect(group.wrecked).toBe(1);
  });

  it('removes the trucks of a finished stretch and awards no XP for it', () => {
    const w = furyRoadWorld();
    const group = runOf(w).groups[0];
    moveTo(w, group.at);
    advanceFuryRoad(w);
    for (const v of w.vehicles) if (group.vehicles.includes(v.id)) v.pos = { x: v.pos.x + 100, y: v.pos.y };
    w.states = w.states.filter((s) => s.kind !== 'combat');
    const passing = structuredClone(w);
    moveTo(passing, milestoneAt(1) - 10);

    const after = arrive(w);
    const passed = endTurn(passing, still);

    expect(after.vehicles.map((v) => v.id)).toEqual([after.player.vehicleId]);
    expect(passed.vehicles.some((v) => group.vehicles.includes(v.id))).toBe(true);
    expect(after.player.xp).toBe(passed.player.xp);
  });

  it('refuses to move the window with a group truck alive or the player off the pad', () => {
    const off = furyRoadWorld();
    expect(() => moveWindow(off)).toThrow(/parked/);

    const alive = furyRoadWorld();
    const group = runOf(alive).groups[0];
    moveTo(alive, group.at);
    advanceFuryRoad(alive);
    parkOnNext(alive);
    expect(() => moveWindow(alive)).toThrow(/alive/);
  });

  it('discovers the outpost fort as any site, with its line and its XP', () => {
    const w = furyRoadWorld();
    parkOnNext(w);
    const xp = w.player.xp;

    const after = endTurn(w, still);

    expect(after.player.discovered).toContain('outpost-1');
    expect(after.events).toContainEqual({ t: 'discover', location: 'outpost-1' });
    expect(after.player.xp).toBeGreaterThan(xp);
  });

  it('names a move for every world field', () => {
    expect(Object.keys(WINDOW_MOVE).sort()).toEqual(Object.keys(furyRoadWorld()).sort());
  });
});

describe('the endless run', () => {
  it('stays bounded over thirty stretches', () => {
    let w = furyRoadWorld();
    const sizes: number[] = [];
    for (let k = 0; k < 30; k++) {
      w = arrive(w);
      sizes.push(JSON.stringify({ ...w, terrain: null, player: { ...w.player, explored: null } }).length);
    }

    expect(runOf(w).window).toBe(30);
    expect(w.size).toBe(HIGHWAY.size);
    expect(runOf(w).outposts).toHaveLength(2);
    expect(runOf(w).groups).toHaveLength(waveOf(32).length);
    expect(w.vehicles).toHaveLength(1);
    expect(w.obstacles.every((o) => o.pos.x >= 0 && o.pos.y >= 0 && o.pos.x <= w.size && o.pos.y <= w.size)).toBe(true);
    expect(Math.max(...sizes.slice(10))).toBeLessThan(Math.max(...sizes.slice(0, 10)) * 1.5);
  });

  it('escalates for eight stretches and then holds at the hardest row and the pay caps', () => {
    expect(waveOf(9)).toBe(waveOf(8));
    expect(waveOf(40)).toBe(FURY_ROAD.waves[FURY_ROAD.waves.length - 1]);
    expect(payOf(1, 0)).toBe(FURY_ROAD.pay.base.first);
    expect(payOf(2, 1)).toBe(FURY_ROAD.pay.base.first + FURY_ROAD.pay.base.step + FURY_ROAD.pay.perWreck.first + FURY_ROAD.pay.perWreck.step);
    expect(payOf(100, 0)).toBe(FURY_ROAD.pay.base.max);
    expect(payOf(100, 1) - payOf(100, 0)).toBe(FURY_ROAD.pay.perWreck.max);
    expect(stockSizeOf(1)).toBe(2);
    expect(stockSizeOf(100)).toBe(FURY_ROAD.stock.max);
    expect(() => waveOf(0)).toThrow(/no wave/);
  });

  it('reads the stretch and the distance to the next outpost, with no total', () => {
    const w = furyRoadWorld();
    moveTo(w, milestoneAt(1) - 50);

    const readout = furyRoadReadout(w)!;

    expect(readout).toMatchObject({ stretch: 1, outpost: 'Outpost 1' });
    expect(readout.toOutpost).toBeCloseTo(50, 0);
  });
});

describe('a Fury Road world on the highway', () => {
  it('shows no Icarus place in three hundred turns of the run', () => {
    let w = furyRoadWorld(5);
    const ids = w.obstacles.map((o) => o.id);
    for (let i = 0; i < 300 && w.player.state === 'active'; i++) {
      const me = playerVehicle(w);
      if (me.order === null) me.order = { kind: 'stopAt', dest: outpostPad(w, runOf(w).window + 1) };
      w = endTurn(w, still);
    }

    expect(ids.some((id) => /^(site|pond|cw)-/.test(id))).toBe(false);
    expect(w.player.discovered.every((id) => /^outpost-\d+$/.test(id))).toBe(true);
    expect(w.salvage).toEqual([]);
  }, 120_000);
});

describe('ending a Fury Road run', () => {
  it('lets only a stranded truck end the run', () => {
    const w = furyRoadWorld();

    expect(canAbandonRun(w)).toBe(false);
    expect(() => abandonRun(w)).toThrow(/stranded/);

    w.player.fuel = 0;
    const ended = abandonRun(w);

    expect(ended.player.state).toBe('dead');
    expect(ended.events).toEqual([{ t: 'runLost', stretch: 1, cause: 'abandoned' }]);
  });

  it('runs no more turns once the run is lost', () => {
    const w = furyRoadWorld();
    w.player.fuel = 0;
    const ended = abandonRun(w);

    expect(() => endTurn(ended, still)).toThrow(/dead/);
  });
});
