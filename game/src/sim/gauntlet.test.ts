import { describe, expect, it } from 'vitest';
import { GAUNTLET } from '../data/gauntlet';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { abandonRun, advanceGauntlet, canAbandonRun, gauntletReadout, reachedOutpostAt } from './gauntlet';
import { courseLine, pointAt } from './gauntlet-layout';
import { topGoal } from './npc-activities';
import { defaultSetup } from './settings';
import { addState, stateOf } from './states';
import type { GauntletRun, World } from './types';
import { endTurn, newWorld } from './world';

function gauntletWorld(seed = 3): World {
  return newWorld(seed, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
}

function runOf(w: World): GauntletRun {
  if (!w.gauntlet) throw new Error('No run');
  return w.gauntlet;
}

function moveAlong(w: World, along: number): void {
  const me = playerVehicle(w);
  me.pos = pointAt(courseLine(runOf(w).course), along, GAUNTLET.laneOffsets[1]);
  me.speed = 0;
}

function parkOnPad(w: World, k: number): void {
  const me = playerVehicle(w);
  me.pos = { ...runOf(w).outposts[k].pad };
  me.speed = 0;
  me.order = null;
}

function groupTrucks(w: World, k: number): string[] {
  return runOf(w).groups.filter((g) => g.stretch === k).flatMap((g) => g.vehicles);
}

const still = () => {};

describe('Gauntlet groups', () => {
  it('spawn only once the player comes within the lead of their anchor', () => {
    const w = gauntletWorld();
    const group = runOf(w).groups[0];

    moveAlong(w, group.at - GAUNTLET.spawnLead - 4);
    advanceGauntlet(w);
    expect(group.spawned).toBe(false);

    moveAlong(w, group.at - GAUNTLET.spawnLead + 1);
    advanceGauntlet(w);
    expect(group.spawned).toBe(true);
    expect(group.vehicles).toHaveLength(group.templates.length);
  });

  it('spawn hostile, hunting the player', () => {
    const w = gauntletWorld();
    const group = runOf(w).groups[0];
    moveAlong(w, group.at);

    advanceGauntlet(w);

    for (const id of group.vehicles) {
      const v = w.vehicles.find((x) => x.id === id)!;
      expect(stateOf(w, 'feud', id, w.player.vehicleId)).not.toBeNull();
      expect(topGoal(v)).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
    }
  });

  it('never put more than the cap of trucks on the road at once', () => {
    const w = gauntletWorld();
    const run = runOf(w);
    run.stretch = 3;
    const last = run.groups.filter((g) => g.stretch === 3);
    moveAlong(w, last[last.length - 1].at + 1);

    advanceGauntlet(w);

    expect(groupTrucks(w, 3).length).toBeLessThanOrEqual(GAUNTLET.maxAlive);
    expect(last.some((g) => !g.spawned)).toBe(true);
  });

  it('keep hunting a player they meet long after they spawn', () => {
    let w = gauntletWorld();
    const group = runOf(w).groups[0];
    moveAlong(w, group.at - GAUNTLET.spawnLead + 1);
    advanceGauntlet(w);
    for (let i = 0; i < 15; i++) w = endTurn(w, still);

    for (const id of runOf(w).groups[0].vehicles.filter((id) => w.vehicles.some((v) => v.id === id))) {
      expect(stateOf(w, 'feud', id, w.player.vehicleId)).not.toBeNull();
      expect(topGoal(w.vehicles.find((v) => v.id === id)!)?.kind).toBe('fight');
    }
  });
});

describe('a Gauntlet stretch', () => {
  it('completes when the player parks on the next pad out of combat', () => {
    let w = gauntletWorld();
    const money = w.player.money;
    parkOnPad(w, 0);

    w = endTurn(w, still);

    expect(runOf(w).stretch).toBe(1);
    expect(runOf(w).outposts[0].paid).toBe(true);
    expect(w.player.money).toBe(money + GAUNTLET.pay.base[0]);
    expect(w.events).toContainEqual({ t: 'outpostReached', outpost: 'outpost-0', stretch: 1, pay: GAUNTLET.pay.base[0], wrecks: 0 });
  });

  it('does not complete on the move, off the pad or in combat', () => {
    const moving = gauntletWorld();
    parkOnPad(moving, 0);
    playerVehicle(moving).speed = 2;
    const off = gauntletWorld();
    moveAlong(off, runOf(off).outposts[0].at);
    const fighting = gauntletWorld();
    parkOnPad(fighting, 0);
    const foe = { ...playerVehicle(fighting), id: 'v-foe' };
    fighting.vehicles.push(foe);
    addState(fighting, 'combat', foe.id, fighting.player.vehicleId, { kind: 'none' });

    for (const w of [moving, off, fighting]) advanceGauntlet(w);

    expect([moving, off, fighting].map((w) => runOf(w).stretch)).toEqual([0, 0, 0]);
  });

  it('pays the base and a bonus for each wreck of the stretch, once', () => {
    let w = gauntletWorld();
    const group = runOf(w).groups[0];
    group.wrecked = 2;
    const money = w.player.money;
    parkOnPad(w, 0);

    w = endTurn(w, still);
    const after = endTurn(w, still);

    const pay = GAUNTLET.pay.base[0] + GAUNTLET.pay.perWreck[0] * 2;
    expect(w.player.money).toBe(money + pay);
    expect(after.player.money).toBe(money + pay);
    expect(after.events.some((e) => e.t === 'outpostReached' || e.t === 'money')).toBe(false);
  });

  it('counts a wreck of a group truck toward the stretch', () => {
    const w = gauntletWorld();
    const group = runOf(w).groups[0];
    moveAlong(w, group.at);
    advanceGauntlet(w);
    w.events = [{ t: 'destroyed', vehicle: group.vehicles[0], by: w.player.vehicleId }];

    advanceGauntlet(w);

    expect(group.wrecked).toBe(1);
  });

  it('removes the trucks of a finished stretch and awards no XP for it', () => {
    let w = gauntletWorld();
    const group = runOf(w).groups[0];
    moveAlong(w, group.at);
    advanceGauntlet(w);
    for (const v of w.vehicles) if (group.vehicles.includes(v.id)) v.pos = { x: v.pos.x + 200, y: v.pos.y };
    w.states = w.states.filter((s) => s.kind !== 'combat');
    parkOnPad(w, 0);
    const passing = structuredClone(w);
    passing.gauntlet!.outposts[0].pad = { x: 1, y: 1 };

    w = endTurn(w, still);
    const passed = endTurn(passing, still);

    expect(w.vehicles.some((v) => group.vehicles.includes(v.id))).toBe(false);
    expect(passed.vehicles.some((v) => group.vehicles.includes(v.id))).toBe(true);
    expect(w.player.xp).toBe(passed.player.xp);
  });

  it('finishes the run after the last outpost and spawns no more groups', () => {
    let w = gauntletWorld();
    for (let k = 0; k < GAUNTLET.stretches; k++) {
      parkOnPad(w, k);
      w = endTurn(w, still);
    }
    const vehicles = w.vehicles.length;
    w = endTurn(w, still);

    expect(runOf(w).complete).toBe(true);
    expect(runOf(w).outposts.every((o) => o.paid)).toBe(true);
    expect(w.vehicles).toHaveLength(vehicles);
    expect(gauntletReadout(w)).toMatchObject({ stretch: GAUNTLET.stretches, total: GAUNTLET.stretches, complete: true });
  });

  it('shows the reached outpost only while parked on its pad', () => {
    let w = gauntletWorld();
    parkOnPad(w, 0);
    expect(reachedOutpostAt(w)).toBeNull();

    w = endTurn(w, still);

    expect(reachedOutpostAt(w)?.name).toBe('Outpost 1');
    moveAlong(w, runOf(w).outposts[0].at + 10);
    expect(reachedOutpostAt(w)).toBeNull();
  });

  it('reads the stretch and the distance to the next outpost', () => {
    const w = gauntletWorld();
    const run = runOf(w);
    moveAlong(w, run.outposts[0].at - 50);

    const readout = gauntletReadout(w)!;

    expect(readout.stretch).toBe(1);
    expect(readout.total).toBe(4);
    expect(readout.toOutpost).toBeCloseTo(50, 0);
  });
});

describe('ending a Gauntlet run', () => {
  it('lets only a stranded truck end the run', () => {
    const w = gauntletWorld();

    expect(canAbandonRun(w)).toBe(false);
    expect(() => abandonRun(w)).toThrow(/stranded/);

    w.player.fuel = 0;
    const ended = abandonRun(w);

    expect(ended.player.state).toBe('dead');
    expect(ended.events).toEqual([{ t: 'runLost', stretch: 1, cause: 'abandoned' }]);
  });

  it('runs no more turns once the run is lost', () => {
    const w = gauntletWorld();
    w.player.fuel = 0;
    const ended = abandonRun(w);

    expect(() => endTurn(ended, still)).toThrow(/dead/);
  });
});
