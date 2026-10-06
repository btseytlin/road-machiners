import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { playerVehicle } from '../../sim/damage';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { setHeadlights } from '../../sim/world';
import { daylightAt, lampsOn, nightLightsWanted, vehicleLampsOn, VehicleLights, type LitVehicle } from './daylight';

const turnAt = (hour: number) => 1 + ((hour - TIME.startHour + 24) % 24) * (TIME.turnsPerDay / 24);

describe('daylightAt', () => {
  it('holds the same dim moonlight through deep night', () => {
    const late = daylightAt(turnAt(23.5));
    const small = daylightAt(turnAt(2));
    expect(late.sunIntensity).toBeGreaterThan(0);
    expect(late.skyIntensity).toBeGreaterThan(0);
    expect(late.sunIntensity).toBe(small.sunIntensity);
    expect(late.sky.getHex()).toBe(small.sky.getHex());
    expect(late.sunIntensity).toBeLessThan(daylightAt(turnAt(12)).sunIntensity);
  });
});

describe('vehicleLampsOn', () => {
  const world = emptyWorld();
  const npc = addVehicle(world, 'traders', 'scout', ['stockEngine'], { x: 40, y: 30 });
  const truck = playerVehicle(world);
  const night = turnAt(23);
  const noon = turnAt(12);

  it("follows the player's switch at night and at noon", () => {
    const lit = setHeadlights(world, true);
    for (const turn of [night, noon]) {
      expect(vehicleLampsOn(lit, playerVehicle(lit), turn)).toBe(true);
      expect(vehicleLampsOn(world, truck, turn)).toBe(false);
    }
  });

  it('keeps an NPC on the clock', () => {
    for (const turn of [night, noon]) expect(vehicleLampsOn(world, npc, turn)).toBe(lampsOn(npc.id, turn));
    expect(vehicleLampsOn(world, npc, night)).toBe(true);
    expect(vehicleLampsOn(world, npc, noon)).toBe(false);
  });
});

describe('nightLightsWanted', () => {
  it("leaves the night lights off at noon when only the player's lamps are on", () => {
    expect(nightLightsWanted(turnAt(12), [{ player: true, on: true }])).toBe(false);
  });

  it('keeps them while an NPC lamp is still on at dawn', () => {
    expect(nightLightsWanted(turnAt(12), [{ player: true, on: false }, { player: false, on: true }])).toBe(true);
  });

  it('keeps them at night with every lamp off', () => {
    expect(nightLightsWanted(turnAt(23), [{ player: true, on: false }])).toBe(true);
  });
});

describe('daylightAt beam share', () => {
  it('is full from sunset through the night', () => {
    for (const h of [20, 20.5, 23, 5.9]) expect(daylightAt(turnAt(h)).beam).toBe(1);
  });

  it('shows less under a high sun', () => {
    for (const h of [8, 12]) {
      const beam = daylightAt(turnAt(h)).beam;
      expect(beam).toBeGreaterThan(0);
      expect(beam).toBeLessThan(1);
    }
    expect(daylightAt(turnAt(12)).beam).toBeLessThan(daylightAt(turnAt(19.5)).beam);
  });
});

describe('VehicleLights', () => {
  const frame = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } } as LitVehicle['frame'];
  const chassisId = playerVehicle(emptyWorld()).chassisId;
  const car = (_id: string, on: boolean, player = false): LitVehicle => ({ chassisId, frame, on, player });
  const truck = { x: 0, y: 0, z: 0 };
  const spots = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.SpotLight => c instanceof THREE.SpotLight);
  const points = (scene: THREE.Scene) => scene.children.filter((c) => c instanceof THREE.PointLight);

  it('lights one beam by day for the player and no glow', () => {
    const scene = new THREE.Scene();
    new VehicleLights(scene).update(false, 0.3, truck, [car('p', true, true)]);
    expect(spots(scene)).toHaveLength(1);
    expect(spots(scene)[0].intensity).toBeGreaterThan(0);
    expect(spots(scene)[0].position.x).toBeGreaterThan(0);
    expect(points(scene)).toHaveLength(0);
  });

  it('removes the beam by day when the switch is off', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    lights.update(false, 0.3, truck, [car('p', true, true)]);
    lights.update(false, 0.3, truck, [car('p', false, true)]);
    expect(spots(scene)).toHaveLength(0);
    expect(points(scene)).toHaveLength(0);
  });

  it('builds no pool for vehicles with lamps off by day', () => {
    const scene = new THREE.Scene();
    new VehicleLights(scene).update(false, 0.3, truck, [car('p', true, true), car('n', false)]);
    expect(spots(scene)).toHaveLength(1);
  });

  it('keeps the pool growing only at night, with a glow', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    lights.update(true, 1, truck, [car('p', true, true), car('a', false), car('b', false)]);
    expect(spots(scene)).toHaveLength(3);
    expect(spots(scene).filter((b) => b.intensity > 0)).toHaveLength(1);
    expect(points(scene)).toHaveLength(1);
    lights.update(true, 1, truck, [car('p', true, true), car('a', false)]);
    expect(spots(scene)).toHaveLength(3);
  });

  it('shrinks to the lit beams at dawn and grows back at dusk', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    const all = [car('p', true, true), car('a', false), car('b', false)];
    lights.update(true, 1, truck, all);
    lights.update(false, 0.5, truck, all);
    expect(spots(scene)).toHaveLength(1);
    expect(points(scene)).toHaveLength(0);
    lights.update(true, 1, truck, all);
    expect(spots(scene)).toHaveLength(3);
    expect(points(scene)).toHaveLength(1);
  });

  it('scales beam intensity by the daylight share', () => {
    for (const share of [0.3, 1]) {
      const scene = new THREE.Scene();
      new VehicleLights(scene).update(false, share, truck, [car('p', true, true)]);
      expect(spots(scene)[0].intensity).toBeCloseTo(25 * share);
    }
  });
});
