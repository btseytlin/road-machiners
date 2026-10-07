import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TIME } from '../../data/time';
import type { VehicleFrame } from '../../phys/frames';
import { bodyOf } from '../../sim/body';
import { playerVehicle } from '../../sim/damage';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { setHeadlights } from '../../sim/world';
import { beamOrder, daylightAt, lampsOn, VehicleLights, nightLightsWanted, sunLight, vehicleLampsOn, type LitVehicle } from './daylight';

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

const frameAt = (x: number): VehicleFrame => ({
  pos: { x, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0, w: 1 },
  acc: { x: 0, y: 0, z: 0 },
  wheels: [],
});
const litAt = (x: number, on = true): LitVehicle => ({ chassisId: 'scout', frame: frameAt(x), on, player: false });
const spots = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.SpotLight => c instanceof THREE.SpotLight);
const origin = { x: 0, y: 0, z: 0 };

describe('daylight beam share', () => {
  it('is 1 from sunset through the night and between 0 and 1 by day', () => {
    for (const h of [20, 20.5, 23, 5.9]) expect(daylightAt(turnAt(h)).beam).toBe(1);
    for (const h of [8, 12]) expect(daylightAt(turnAt(h)).beam).toBeLessThan(1);
    expect(daylightAt(turnAt(12)).beam).toBeGreaterThan(0);
    expect(daylightAt(turnAt(12)).beam).toBeLessThan(daylightAt(turnAt(19.5)).beam);
  });
});

describe('beamOrder', () => {
  it('drops lamp-off vehicles and puts the nearest first', () => {
    const order = beamOrder([litAt(30), litAt(5, false), litAt(0), litAt(10)], origin);
    expect(order.map((v) => v.frame.pos.x)).toEqual([0, 10, 30]);
  });
});

describe('VehicleLights', () => {
  it('casts shadows from only the four nearest beams, and reassigns them as trucks move', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    const xs = [60, 10, 50, 20, 40, 30];
    lights.update(true, 1, origin, xs.map((x) => litAt(x)));
    const shadowed = () => spots(scene).filter((b) => b.castShadow);
    expect(shadowed()).toHaveLength(4);
    expect(shadowed().every((b) => b.shadow.autoUpdate)).toBe(true);
    const nearNoses = shadowed().map((b) => Math.round(b.position.x)).sort((a, b) => a - b);
    const nose = bodyOf('scout').half.x;
    expect(nearNoses).toEqual([10, 20, 30, 40].map((x) => Math.round(x + nose)));

    lights.update(true, 1, { x: 60, y: 0, z: 0 }, xs.map((x) => litAt(x)));
    expect(shadowed()).toHaveLength(4);
    const moved = shadowed().map((b) => Math.round(b.position.x)).sort((a, b) => a - b);
    expect(moved).toEqual([60, 50, 40, 30].sort((a, b) => a - b).map((x) => Math.round(x + nose)));
  });

  it('zeroes idle beams and stops their shadow passes', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    lights.update(true, 1, origin, [litAt(0), litAt(10), litAt(20)]);
    lights.update(true, 1, origin, [litAt(0, false), litAt(10, false), litAt(20, false)]);
    const beams = spots(scene);
    expect(beams.length).toBeGreaterThan(0);
    expect(beams.every((b) => b.intensity === 0)).toBe(true);
    expect(beams.filter((b) => b.castShadow).every((b) => !b.shadow.autoUpdate)).toBe(true);
  });

  it('removes every beam and frees shadow maps at dawn', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    lights.update(true, 1, origin, [0, 10, 20, 30, 40, 50].map((x) => litAt(x)));
    const maps = spots(scene)
      .filter((b) => b.castShadow)
      .map((b) => vi.spyOn(b.shadow, 'dispose'));
    expect(maps).toHaveLength(4);
    lights.update(false, 1, origin, []);
    expect(spots(scene)).toHaveLength(0);
    expect(maps.every((d) => d.mock.calls.length === 1)).toBe(true);
  });

  it('lights the ground ahead of the player by day whenever the switch is on, and nothing else', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    const player = { ...litAt(0), player: true };
    lights.update(false, 0.3, origin, [player, litAt(30, false)]);
    expect(spots(scene)).toHaveLength(1);
    expect(spots(scene)[0].intensity).toBeCloseTo(25 * 0.3);
    expect(spots(scene)[0].position.x).toBeGreaterThan(bodyOf('scout').half.x - 0.01);
    expect(scene.children.some((c) => c instanceof THREE.PointLight)).toBe(false);
    lights.update(false, 0.3, origin, [{ ...player, on: false }, litAt(30, false)]);
    expect(spots(scene)).toHaveLength(0);
  });

  it('swaps between the day pool and the night pool and glow at the handovers', () => {
    const scene = new THREE.Scene();
    const lights = new VehicleLights(scene);
    const all = [{ ...litAt(0), player: true }, litAt(10), litAt(20)];
    const glow = () => scene.children.some((c) => c instanceof THREE.PointLight);
    lights.update(true, 1, origin, all);
    expect(spots(scene)).toHaveLength(3);
    expect(glow()).toBe(true);
    lights.update(false, 0.5, origin, [all[0], litAt(10, false), litAt(20, false)]);
    expect(spots(scene)).toHaveLength(1);
    expect(glow()).toBe(false);
    lights.update(true, 1, origin, all);
    expect(spots(scene)).toHaveLength(3);
    expect(glow()).toBe(true);
  });

  it('leaves the sun shadow settings alone', () => {
    const sun = sunLight();
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.normalBias).toBe(0.3);
  });
});

describe('noon light', () => {
  it('lets the sun outweigh the sky, so shadow sides read darker than lit sides', () => {
    const noon = daylightAt(turnAt(12));
    expect(noon.sunIntensity / noon.skyIntensity).toBeGreaterThan(2.5);
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
