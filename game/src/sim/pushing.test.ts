import { chassisDef } from '../data/chassis';
import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { soundRange } from './detect';
import { advanceFar, isNear } from './far';
import { corePart, mountedParts } from './grid';
import { isStranded, vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle, World } from './types';
import { weatherOn } from './weather';

function removeEngines(v: Vehicle): void {
  v.items = v.items.filter((it) => it.kind !== 'part' || partDef(it.part.defId).kind !== 'engine');
}

function engineless(): World {
  const w = emptyWorld();
  removeEngines(w.vehicles[0]);
  expect(mountedParts(w.vehicles[0], 'engine')).toHaveLength(0);
  return w;
}

describe('pushing a truck without a working engine', () => {
  it('gives limp speed, limp accel and no fuel use without an engine', () => {
    const w = engineless();
    const s = vehicleStats(w, w.vehicles[0]);
    expect(s.maxSpeed).toBe(RULES.limpSpeed * weatherOn(w, w.vehicles[0]).speed);
    expect(s.accel).toBe(RULES.limpSpeed * chassisDef(w.vehicles[0].chassisId).accel);
    expect(s.fuelPerTile).toBe(0);
  });

  it('gives the same numbers with a broken engine', () => {
    const w = emptyWorld();
    mountedParts(w.vehicles[0], 'engine')[0].hp = 0;
    const s = vehicleStats(w, w.vehicles[0]);
    expect(s.maxSpeed).toBe(RULES.limpSpeed * weatherOn(w, w.vehicles[0]).speed);
    expect(s.accel).toBe(RULES.limpSpeed * chassisDef(w.vehicles[0].chassisId).accel);
    expect(s.fuelPerTile).toBe(0);
  });

  it('keeps fuel use with a working engine and a broken transmission', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'transmission').hp = 0;
    const s = vehicleStats(w, w.vehicles[0]);
    expect(s.maxSpeed).toBeLessThanOrEqual(RULES.limpSpeed);
    expect(s.fuelPerTile).toBeGreaterThan(0);
  });

  it('pushes a far NPC along its route at limp speed without fuel', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 30, y: 150 });
    removeEngines(v);
    v.order = { kind: 'stopAt', dest: { x: 45, y: 150 } };
    expect(isNear(w, v)).toBe(false);
    const fuel = v.resources!.fuel;
    for (let i = 0; i < 3; i++) advanceFar(w, v);
    expect(v.pos.x).toBeGreaterThan(30 + RULES.limpSpeed);
    expect(v.speed).toBeCloseTo(vehicleStats(w, v).maxSpeed);
    expect(v.resources!.fuel).toBe(fuel);
  });

  it('an engine at 0 HP is silent while moving', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = RULES.limpSpeed;
    expect(soundRange(w, v)).toBeGreaterThan(0);
    mountedParts(v, 'engine')[0].hp = 0;
    expect(soundRange(w, v)).toBe(0);
  });
});

describe('isStranded', () => {
  it('is false for a healthy truck with fuel', () => {
    const w = emptyWorld();
    expect(w.player.fuel).toBeGreaterThan(0);
    expect(isStranded(w, w.vehicles[0])).toBe(false);
  });

  it('is true without an engine', () => {
    const w = engineless();
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('is true with a broken engine', () => {
    const w = emptyWorld();
    mountedParts(w.vehicles[0], 'engine')[0].hp = 0;
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('is true with a broken transmission', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'transmission').hp = 0;
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('is true with an empty tank', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('reads NPC fuel from the NPC', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 40, y: 30 });
    expect(isStranded(w, v)).toBe(false);
    v.resources!.fuel = 0;
    expect(isStranded(w, v)).toBe(true);
  });
});
