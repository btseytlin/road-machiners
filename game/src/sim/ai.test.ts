import { describe, expect, it } from 'vitest';
import { PERF } from '../data/perf';
import { RULES } from '../data/rules';
import { TERRAIN } from '../data/terrain';
import { planNpcOrders, routeBlockers, trafficStops } from './ai';
import { topGoal } from './npc-activities';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { startEscort } from './tow';
import type { Vehicle, World } from './types';
import { dist } from './vec';

describe('NPC driving', () => {
  it('uses the obstacle-aware driver on every turn', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    planNpcOrders(w);
    expect(npc.direct).toBe(false);
  });

  it('a parked truck ahead whose loot is gone before it thinks gives no face off', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const first = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
    first.brain = npcBrain('trader', first.pos, ['trader']);
    first.heading = 0;
    const second = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 103, y: 100 });
    second.brain = npcBrain('trader', second.pos, ['trader']);
    second.heading = Math.PI;
    second.brain.goals.push({ kind: 'loot', targetId: 'cargo-gone', destination: { x: 130, y: 100 }, phase: 'travel', reason: 'take the handed-over cargo' });
    expect(first.id < second.id).toBe(true);
    planNpcOrders(w);
    expect(topGoal(second)?.kind).not.toBe('loot');
  });
});

describe('face offs', () => {
  function noseToNose(): { w: World; first: Vehicle; second: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    const first = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
    first.brain = npcBrain('trader', first.pos, ['trader']);
    first.heading = 0;
    first.brain.goals.push({ kind: 'explore', targetId: null, destination: { x: 150, y: 100 }, phase: 'travel', reason: 'test trip east' });
    const second = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 104, y: 100 });
    second.brain = npcBrain('trader', second.pos, ['trader']);
    second.heading = Math.PI;
    expect(first.id < second.id).toBe(true);
    return { w, first, second };
  }

  it('of two parked trucks that both set off, only the higher id drives on the first turn', () => {
    const { w, first, second } = noseToNose();
    second.brain!.goals.push({ kind: 'explore', targetId: null, destination: { x: 40, y: 100 }, phase: 'travel', reason: 'test trip west' });
    planNpcOrders(w);
    expect(first.order?.kind).toBe('brake');
    expect(second.order?.kind).toBe('stopAt');
  });

  it('a driver waits for a parked truck ahead that holds a move order', () => {
    const { w, first, second } = noseToNose();
    second.order = { kind: 'stopAt', dest: { x: 60, y: 100 } };
    expect(trafficStops(w, first, { x: 150, y: 100 })).toBe(true);
  });

  it('a driver does not wait for a parked truck ahead that holds no move order, like one waiting for a tow', () => {
    const { w, first, second } = noseToNose();
    second.brain!.goals.push({ kind: 'resupply', targetId: 'bowl', destination: { x: 60, y: 100 }, phase: 'travel', reason: 'low fuel' });
    second.order = null;
    expect(trafficStops(w, first, { x: 150, y: 100 })).toBe(false);
  });
});

function scene(x: number, y: number, heading: number, speed: number): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x, y });
  const me = w.vehicles[0];
  me.heading = heading;
  me.speed = speed;
  const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  npc.heading = 0;
  npc.speed = 4;
  return { w, npc };
}

const DEST = { x: 130, y: 100 };

function corridor(w: World): void {
  for (let x = 90; x <= 140; x++) {
    w.obstacles.push({ id: `n${x}`, kind: 'rock', pos: { x, y: 97 }, r: 1 });
    w.obstacles.push({ id: `s${x}`, kind: 'rock', pos: { x, y: 103 }, r: 1 });
  }
}

describe('NPC traffic', () => {
  it.each([
    ['oncoming in its lane', 118, 100, Math.PI, 7, true],
    ['crossing into its path', 108, 94, Math.PI / 2, 4, true],
    ['oncoming 4 tiles to the side', 118, 104, Math.PI, 7, false],
    ['crossing ahead and driving off to the side', 110, 104, Math.PI / 2, 7, false],
    ['ahead in the next lane, slower', 106, 103, 0, 2, false],
  ])('routes around a moving truck only when their paths meet: %s', (_name, x, y, heading, speed, avoids) => {
    const { w, npc } = scene(x, y, heading, speed);
    expect(routeBlockers(w, npc).length > 0).toBe(avoids);
  });

  it.each([
    ['oncoming in its lane', 118, 100, Math.PI, 7],
    ['crossing into its path', 108, 94, Math.PI / 2, 4],
  ])('keeps driving on open ground: %s', (_name, x, y, heading, speed) => {
    const { w, npc } = scene(x, y, heading, speed);
    expect(trafficStops(w, npc, DEST)).toBe(false);
  });

  it('stops when an oncoming truck fills its only lane', () => {
    const { w, npc } = scene(112, 100, Math.PI, 5);
    corridor(w);
    expect(trafficStops(w, npc, DEST)).toBe(true);
  });

  it('stops behind a slower truck in its only lane', () => {
    const { w, npc } = scene(106, 100, 0, 2);
    corridor(w);
    expect(trafficStops(w, npc, DEST)).toBe(true);
  });

  it('overtakes a slower truck ahead on open ground', () => {
    const { w, npc } = scene(106, 100, 0, 2);
    expect(routeBlockers(w, npc).length).toBeGreaterThan(0);
    expect(trafficStops(w, npc, DEST)).toBe(false);
  });

  it('a far driver does not stop for a moving truck, since far travel stops short of any truck in its way', () => {
    const oncoming = (playerAt: { x: number; y: number }) => {
      const { w, npc } = scene(playerAt.x, playerAt.y, 0, 0);
      corridor(w);
      const other = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 112, y: 100 }, Math.PI);
      other.brain = npcBrain('trader', other.pos, ['trader']);
      other.speed = 5;
      return trafficStops(w, npc, DEST);
    };
    expect(oncoming({ x: 100, y: 110 })).toBe(true);
    expect(oncoming({ x: 100, y: 100 + TERRAIN.vision.radius + PERF.liveMargin + 10 })).toBe(false);
  });

  it('the player routes around parked vehicles only', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    me.speed = 4;
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 118, y: 100 }, Math.PI);
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.speed = 7;
    expect(routeBlockers(w, me)).toEqual([]);
  });
});

describe('oncoming NPCs', () => {
  function headOn(): { w: World; first: Vehicle; second: Vehicle } {
    const w = emptyWorld({ x: 100, y: 130 });
    const first = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
    first.brain = npcBrain('trader', first.pos, ['trader']);
    first.heading = 0;
    first.speed = 4;
    first.brain.goals.push({ kind: 'explore', targetId: null, destination: { x: 150, y: 100 }, phase: 'travel', reason: 'test trip east' });
    const second = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 114, y: 100.5 }, Math.PI);
    second.brain = npcBrain('trader', second.pos, ['trader']);
    second.speed = 4;
    second.brain.goals.push({ kind: 'explore', targetId: null, destination: { x: 50, y: 100 }, phase: 'travel', reason: 'test trip west' });
    expect(first.id < second.id).toBe(true);
    return { w, first, second };
  }

  it('of two NPCs closing head-on, the lower id brakes and the higher drives on', () => {
    const { w, first, second } = headOn();
    planNpcOrders(w);
    expect(first.order?.kind).toBe('brake');
    expect(second.order?.kind).toBe('stopAt');
  });

  it.each(['first', 'second'] as const)('a fleeing truck is not yielded to and does not yield: %s flees', (who) => {
    const { w, first, second } = headOn();
    const fleer = who === 'first' ? first : second;
    fleer.brain!.goals.push({ kind: 'flee', targetId: null, destination: { x: 100, y: 60 }, phase: 'travel', reason: 'test flight' });
    expect(trafficStops(w, first, DEST)).toBe(false);
  });

  it('a far pair does not use the rule', () => {
    const { w, first } = headOn();
    w.vehicles[0].pos = { x: 100, y: 100 + TERRAIN.vision.radius + PERF.liveMargin + 10 };
    expect(trafficStops(w, first, DEST)).toBe(false);
  });

  it('a truck behind on the same heading does not make the leader brake', () => {
    const { w, first, second } = headOn();
    second.pos = { x: 94, y: 100 };
    second.heading = 0;
    second.speed = 5;
    expect(trafficStops(w, first, DEST)).toBe(false);
  });
});

describe('getting unstuck', () => {
  function waitingLeader(): { w: World; leader: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    const leader = addVehicle(w, 'convoys', 'hauler', ['mg', 'workhorseDiesel'], { x: 100, y: 100 });
    leader.brain = npcBrain('convoy', leader.pos, ['supplier']);
    leader.brain.goals = [{ kind: 'explore', targetId: null, destination: { x: 170, y: 100 }, phase: 'travel', reason: 'test trip east' }];
    const guard = addVehicle(w, 'convoys', 'scout', ['mg', 'stockEngine'], { x: 60, y: 100 });
    guard.brain = npcBrain('convoyGuard', guard.pos, ['guard']);
    startEscort(w, guard, leader, null, 0);
    return { w, leader };
  }

  it('a driver held in place drives to a free spot nearby after the unstick wait', () => {
    const { w, leader } = waitingLeader();
    for (let i = 0; i < RULES.unstick.turns; i++) {
      planNpcOrders(w);
      expect(leader.order?.kind).toBe('brake');
    }
    planNpcOrders(w);
    expect(leader.order?.kind).toBe('stopAt');
    const spot = leader.order!.kind === 'stopAt' ? leader.order!.dest : null;
    expect(dist(spot!, leader.pos)).toBeLessThanOrEqual(RULES.unstick.reach);
  });

  it('a driver parked on its goal point never counts as stuck', () => {
    const { w, leader } = waitingLeader();
    leader.brain!.goals[0].destination = { ...leader.pos };
    for (let i = 0; i < RULES.unstick.turns * 2; i++) planNpcOrders(w);
    expect(leader.brain!.recovery ?? 0).toBe(0);
  });
});
