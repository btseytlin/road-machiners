import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { blastLanes, laneCount, lanePoint } from './armor';
import { fireWeapons, inFeud, shotDamage, startFeuds } from './combat';
import { gunFor } from './factory';
import { mountedParts } from './grid';
import { addState, stateOf, strayData } from './states';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { Vehicle, World } from './types';

function range(): { w: World; me: Vehicle; target: Vehicle; onLine: Vehicle; offLine: Vehicle } {
  const w = emptyWorld();
  const me = addVehicle(w, 'player', 'scout', ['shotgun', 'stockEngine'], { x: 30, y: 30 });
  me.id = w.vehicles[0].id;
  w.vehicles = [me, ...w.vehicles.slice(1, -1)];
  const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI / 2);
  target.brain = npcBrain('buggy', target.pos, ['raider']);
  const onLine = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 37, y: 30.3 }, Math.PI / 2);
  onLine.brain = npcBrain('trader', onLine.pos, ['trader']);
  const offLine = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 36, y: 38 }, Math.PI / 2);
  offLine.brain = npcBrain('trader', offLine.pos, ['trader']);
  const gun = mountedParts(me, 'weapon')[0];
  me.weaponOrders[gun.id] = { targetId: target.id, aim: 'body' };
  return { w, me, target, onLine, offLine };
}

function fire(w: World, me: Vehicle, turns: number): Map<string, number> {
  const total = new Map<string, number>();
  for (let i = 0; i < turns; i++) {
    for (const p of mountedParts(me, 'weapon')) Object.assign(p, gunFor(p.defId));
    w.events = [];
    fireWeapons(w);
    for (const e of w.events) {
      if (e.t !== 'shot') continue;
      for (const [id, hits] of shotDamage(e)) total.set(id, (total.get(id) ?? 0) + hits.reduce((s, h) => s + h.damage, 0));
    }
  }
  return total;
}

describe('stray fire', () => {
  it('misses hit a truck near the line of fire and never one far off it', () => {
    const { w, me, onLine, offLine } = range();
    const dealt = fire(w, me, 20);
    expect(dealt.get(onLine.id) ?? 0).toBeGreaterThan(0);
    expect(dealt.has(offLine.id)).toBe(false);
  });

  it('stray damage below the threshold starts no feud and is summed in a stray fire state', () => {
    const { w, me, onLine } = range();
    let taken = 0;
    for (let i = 0; i < 20 && taken === 0; i++) taken = fire(w, me, 1).get(onLine.id) ?? 0;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(RULES.stray.feudDamage);
    expect(inFeud(w, onLine, me)).toBe(false);
    const held = stateOf(w, 'strayFire', onLine.id, me.id);
    expect(held && strayData(held).damage).toBeCloseTo(taken);
  });

  it('stray damage past the threshold starts a feud with the shooter', () => {
    const { w, me, onLine } = range();
    addState(w, 'strayFire', onLine.id, me.id, { kind: 'strayFire', damage: RULES.stray.feudDamage - 0.01 });
    for (let i = 0; i < 20 && !inFeud(w, onLine, me); i++) fire(w, me, 1);
    expect(inFeud(w, onLine, me)).toBe(true);
    expect(stateOf(w, 'strayFire', onLine.id, me.id)).toBeNull();
  });

  it('a faction mate or deal partner of the shooter forgives its stray fire', () => {
    for (const side of ['mate', 'partner'] as const) {
      const w = emptyWorld();
      const convoy = addVehicle(w, 'convoys', 'scout', ['shotgun', 'stockEngine'], { x: 30, y: 30 });
      convoy.brain = npcBrain('convoy', convoy.pos, ['trader']);
      const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI / 2);
      target.brain = npcBrain('buggy', target.pos, ['raider']);
      const guard = addVehicle(w, side === 'mate' ? 'convoys' : 'mercs', 'hauler', ['stockEngine'], { x: 37, y: 30.3 }, Math.PI / 2);
      guard.brain = npcBrain(side === 'mate' ? 'convoyGuard' : 'merc', guard.pos, ['trader']);
      if (side === 'partner') addState(w, 'escort', guard.id, convoy.id, { kind: 'escort', site: null, fee: 0 });
      convoy.weaponOrders[mountedParts(convoy, 'weapon')[0].id] = { targetId: target.id, aim: 'body' };
      const dealt = fire(w, convoy, 60);
      expect(dealt.get(guard.id) ?? 0).toBeGreaterThan(RULES.stray.feudDamage);
      expect(inFeud(w, guard, convoy)).toBe(false);
      expect(stateOf(w, 'strayFire', guard.id, convoy.id)).toBeNull();
    }
  });

  it('a shooter that attacks a faction mate never feuds itself', () => {
    const w = emptyWorld();
    const convoy = addVehicle(w, 'convoys', 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
    convoy.brain = npcBrain('convoy', convoy.pos, ['trader']);
    const guard = addVehicle(w, 'convoys', 'hauler', ['mg', 'stockEngine'], { x: 34, y: 30 });
    guard.brain = npcBrain('convoyGuard', guard.pos, ['trader']);
    startFeuds(w, convoy, guard);
    expect(inFeud(w, guard, convoy)).toBe(true);
    expect(stateOf(w, 'feud', convoy.id, convoy.id)).toBeNull();
    expect(w.events.some((e) => e.t === 'hostile' && e.vehicle === e.against)).toBe(false);
  });

  it('the player keeps no stray fire state', () => {
    const { w, me, target } = range();
    const gun = mountedParts(target, 'weapon')[0];
    me.pos = { x: 42, y: 30.2 };
    const aimed = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 41, y: 30 }, Math.PI / 2);
    target.weaponOrders = { [gun.id]: { targetId: aimed.id, aim: 'body' } };
    me.weaponOrders = {};
    let hurt = 0;
    for (let i = 0; i < 200; i++) {
      Object.assign(gun, gunFor(gun.defId));
      w.events = [];
      fireWeapons(w);
      for (const e of w.events) if (e.t === 'shot') hurt += (shotDamage(e).get(me.id) ?? []).reduce((sum, h) => sum + h.damage, 0);
    }
    expect(hurt).toBeGreaterThan(0);
    expect(w.states.some((s) => s.kind === 'strayFire' && s.holder === me.id)).toBe(false);
  });
});

describe('blasts', () => {
  it('reach the lanes whose face centers lie within the radius and no others', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    const lanes = laneCount(v, 'front');
    const mid = Math.floor(lanes / 2);
    const face = lanePoint(v, 'front', mid);
    const near = blastLanes(v, { x: face.x + 0.05, y: face.y }, 0.5);
    expect(near.side).toBe('front');
    expect(near.lanes).toContain(mid);
    expect(near.lanes.length).toBeLessThan(lanes);
    expect(blastLanes(v, { x: face.x + 3, y: face.y }, 2.5).lanes).toEqual([]);
  });

  it('a cannon round splashes a truck beside where it lands', () => {
    const w = emptyWorld();
    const me = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], { x: 30, y: 30 });
    me.id = w.vehicles[0].id;
    w.vehicles = [me, ...w.vehicles.slice(1, -1)];
    const target = addVehicle(w, 'raiders', 'wagon', ['stockEngine'], { x: 36, y: 30 }, Math.PI / 2);
    const beside = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 36, y: 30.8 }, Math.PI / 2);
    const far = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 36, y: 34 }, Math.PI / 2);
    const gun = mountedParts(me, 'weapon')[0];
    me.weaponOrders[gun.id] = { targetId: target.id, aim: 'body' };
    const dealt = fire(w, me, 12);
    expect(dealt.get(beside.id) ?? 0).toBeGreaterThan(0);
    expect(dealt.has(far.id)).toBe(false);
  });
});
