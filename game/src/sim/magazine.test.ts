import { describe, expect, it } from 'vitest';
import { fireWeapons, gunOf } from './combat';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { vehicleStats } from './stats';
import { reloadWeapon } from './world';
import type { World } from './types';

function duel() {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
  buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
  const mg = vehicleStats(w, me).weapons[0];
  me.weaponOrders[mg.part.id] = { targetId: buggy.id, aim: 'body' };
  return { w, me, buggy, mg };
}

function turn(w: World): number {
  w.events = [];
  fireWeapons(w);
  return w.events.filter((e) => e.t === 'shot' && e.shooter === w.player.vehicleId).length;
}

describe('magazines', () => {
  it('a gun fires its magazine, then holds fire for its reload, then fires again', () => {
    const { w, mg } = duel();
    const { magazine, reload } = mg.def;
    const fired = Array.from({ length: magazine + reload + 1 }, () => turn(w));
    expect(fired).toEqual([...Array(magazine).fill(1), ...Array(reload).fill(0), 1]);
  });

  it('the last round pushes an empty event', () => {
    const { w, me, mg } = duel();
    for (let i = 0; i < mg.def.magazine - 1; i++) turn(w);
    expect(w.events.some((e) => e.t === 'empty')).toBe(false);
    turn(w);
    expect(w.events).toContainEqual({ t: 'empty', vehicle: me.id, weapon: mg.part.id });
    expect(gunOf(mg.part).ammo).toBe(0);
  });

  it('a gun that holds fire for its reload refills a half magazine', () => {
    const { w, me, mg } = duel();
    turn(w);
    turn(w);
    me.weaponOrders = {};
    for (let i = 0; i < mg.def.reload - 1; i++) turn(w);
    expect(gunOf(mg.part).ammo).toBe(mg.def.magazine - 2);
    turn(w);
    expect(gunOf(mg.part).ammo).toBe(mg.def.magazine);
  });

  it('firing resets reload work', () => {
    const { w, me, buggy, mg } = duel();
    turn(w);
    me.weaponOrders = {};
    turn(w);
    expect(gunOf(mg.part).reloadWork).toBe(1);
    me.weaponOrders[mg.part.id] = { targetId: buggy.id, aim: 'body' };
    turn(w);
    expect(gunOf(mg.part).reloadWork).toBe(0);
    expect(gunOf(mg.part).ammo).toBe(mg.def.magazine - 2);
  });

  it('turns spent cooling down do not count toward a reload', () => {
    const w = emptyWorld();
    const t = addVehicle(w, 'raiders', 'hauler', ['cannon', 'stockEngine'], { x: 35, y: 30 }, Math.PI);
    const gun = vehicleStats(w, t).weapons[0];
    gun.part.gun = { cooldown: 2, ammo: 1, reloadWork: 0 };
    t.weaponOrders = {};
    fireWeapons(w);
    expect(gunOf(gun.part).reloadWork).toBe(0);
  });

  it('a forced reload drops the magazine and blocks fire until the reload is done', () => {
    const start = duel();
    const w = reloadWeapon(start.w, start.mg.part.id);
    const mg = vehicleStats(w, w.vehicles[0]).weapons[0];
    expect(gunOf(mg.part).ammo).toBe(0);
    const fired = Array.from({ length: mg.def.reload + 1 }, () => turn(w));
    expect(fired).toEqual([...Array(mg.def.reload).fill(0), 1]);
  });

  it('ammo never goes below zero or above the magazine', () => {
    const { w, mg } = duel();
    for (let i = 0; i < 40; i++) {
      turn(w);
      const ammo = gunOf(mg.part).ammo;
      expect(ammo).toBeGreaterThanOrEqual(0);
      expect(ammo).toBeLessThanOrEqual(mg.def.magazine);
    }
  });
});
