import { RULES } from '../data/rules';
import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { CRATE_MASS, GOODS } from '../data/goods';
import { PARTS } from '../data/parts';
import { makePart } from './factory';
import { mountedParts } from './grid';
import { addGoods, stowPart } from './inventory';
import { itemMass, loadFactor, vehicleMass } from './mass';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

const coreMass = (id: string) => CHASSIS[id].core.reduce((a, c) => a + PARTS[c.defId].mass, 0);

describe('vehicle mass', () => {
  it('a bare chassis weighs its frame plus its built-in parts', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', [], { x: 40, y: 40 });
    expect(vehicleMass(v)).toBe(CHASSIS.hauler.mass + coreMass('hauler'));
  });

  it('sums mounted parts, spare parts and goods', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['mg', 'stockEngine'], { x: 40, y: 40 });
    expect(vehicleMass(v)).toBe(CHASSIS.hauler.mass + coreMass('hauler') + PARTS.mg.mass + PARTS.stockEngine.mass);
    expect(stowPart(w, v, makePart(w, 'plates', 0))).toBe(true);
    expect(addGoods(w, v, 'scrap', 3)).toBe(3);
    expect(vehicleMass(v)).toBe(CHASSIS.hauler.mass + coreMass('hauler') + PARTS.mg.mass + PARTS.stockEngine.mass + PARTS.plates.mass + 3 * CRATE_MASS);
  });

  it('load factor is sqrt(handling / mass) up to the rated mass, and falls hard over it', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'trailerBox'], { x: 40, y: 40 });
    const ch = CHASSIS.hauler;
    expect(vehicleMass(v)).toBeLessThan(ch.handlingMass);
    expect(loadFactor(v)).toBeCloseTo(Math.sqrt(ch.handlingMass / vehicleMass(v)), 10);
    expect(loadFactor(v)).toBeGreaterThan(1);
    addGoods(w, v, 'scrap', 999);
    const extra = ch.ratedMass - vehicleMass(v) + 500;
    const m = vehicleMass(v) + extra;
    expect(m).toBeGreaterThan(ch.ratedMass);
    expect(loadFactor(v, extra)).toBeCloseTo(Math.sqrt(ch.handlingMass / m) * (ch.ratedMass / m) ** RULES.overloadExponent, 10);
  });

  it.each(Object.keys(CHASSIS))('a %s with armor on every armor cell and guns on half the deck is not overloaded', (id) => {
    const w = emptyWorld();
    const layout = CHASSIS[id].layout.join('');
    const armorCells = [...layout].filter((c) => 'FBLR'.includes(c)).length;
    const guns = Math.ceil([...layout].filter((c) => c === 'D').length / 2);
    const kit = ['stockEngine', ...Array<string>(armorCells).fill('scrapSheet'), ...Array<string>(guns).fill('mg')];
    const v = addVehicle(w, 'raiders', id, kit, { x: 40, y: 40 });
    expect(mountedParts(v, 'armor')).toHaveLength(armorCells);
    expect(mountedParts(v, 'weapon')).toHaveLength(guns);
    expect(vehicleMass(v)).toBeLessThanOrEqual(CHASSIS[id].ratedMass);
  });

  it('a cell of any trade good is one crate of the same mass', () => {
    const scrap = itemMass({ id: 'a', x: 0, y: 0, rot: 0, kind: 'good', good: 'scrap' });
    const electronics = itemMass({ id: 'b', x: 0, y: 0, rot: 0, kind: 'good', good: 'electronics' });
    expect(scrap).toBe(CRATE_MASS);
    expect(electronics).toBe(CRATE_MASS);
    expect(() => itemMass({ id: 'c', x: 0, y: 0, rot: 0, kind: 'good', good: 'unobtainium' })).toThrow('Unknown good unobtainium');
  });

  it('every chassis, part and the crate state a positive mass', () => {
    for (const c of Object.values(CHASSIS)) {
      expect(c.mass).toBeGreaterThan(0);
      expect(c.ratedMass).toBeGreaterThan(c.mass);
    }
    for (const p of Object.values(PARTS)) expect(p.mass).toBeGreaterThan(0);
    expect(CRATE_MASS).toBeGreaterThan(0);
    for (const g of Object.values(GOODS)) expect(g).not.toHaveProperty('mass');
  });
});

describe('load in stats', () => {
  it('a heavy load lowers top speed, turning, acceleration and braking', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'trailerBox'], { x: 40, y: 40 });
    const light = vehicleStats(w, v);
    addGoods(w, v, 'scrap', 999);
    const heavy = vehicleStats(w, v);
    expect(heavy.maxSpeed).toBeLessThan(light.maxSpeed);
    expect(heavy.turnSlow).toBeLessThan(light.turnSlow);
    expect(heavy.turnFast).toBeLessThan(light.turnFast);
    expect(heavy.reverseTurn).toBeLessThan(light.reverseTurn);
    expect(heavy.accel).toBeLessThan(light.accel);
    expect(heavy.brake).toBeLessThan(light.brake);
  });

  it('a part on a truck below its rated mass still costs top speed and turning', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine', 'panniers'], { x: 40, y: 40 });
    const before = vehicleStats(w, v);
    expect(stowPart(w, v, makePart(w, 'plates', 0))).toBe(true);
    const after = vehicleStats(w, v);
    expect(vehicleMass(v)).toBeLessThan(CHASSIS.scout.ratedMass);
    expect(after.maxSpeed).toBeLessThan(before.maxSpeed);
    expect(after.turnSlow).toBeLessThan(before.turnSlow);
  });

  it('stats mass is the vehicle mass in kg', () => {
    const w = emptyWorld();
    const v = w.vehicles[0];
    expect(vehicleStats(w, v).mass).toBe(vehicleMass(v));
  });

  it('acceleration scales by rated mass over mass', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    const a = vehicleStats(w, v).accel * vehicleMass(v);
    addGoods(w, v, 'scrap', 10);
    expect(vehicleStats(w, v).accel * vehicleMass(v)).toBeCloseTo(a, 6);
  });
});
