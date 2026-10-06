import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { playerVehicle } from '../../sim/damage';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { setHeadlights } from '../../sim/world';
import { daylightAt, lampsOn, lightScene, nightLightsWanted, snapToShadowTexels, sunLight, vehicleLampsOn } from './daylight';

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

describe('lightScene shadow box', () => {
  const light = daylightAt(turnAt(17));
  const sky = new THREE.HemisphereLight();
  const texel = 160 / 2048;
  const place = (x: number, z: number) => {
    const sun = sunLight();
    lightScene(sun, sky, { x, y: 1.2, z }, light);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
    return sun;
  };
  const texelOf = (sun: THREE.DirectionalLight, p: THREE.Vector3) => {
    const c = p.clone().applyMatrix4(sun.shadow.matrix);
    return [c.x * 2048, c.y * 2048];
  };

  it('keeps one texel grid on the ground wherever the truck is', () => {
    const point = new THREE.Vector3(105.3, 2, 291.7);
    const a = texelOf(place(100.013, 290.02), point);
    const b = texelOf(place(117.3, 285.77), point);
    for (let i = 0; i < 2; i++) {
      const d = a[i] - b[i];
      expect(Math.abs(d - Math.round(d))).toBeLessThan(1e-3);
    }
  });

  it('moves the focus by at most half a texel and not along the light', () => {
    const sun = place(100.013, 290.02);
    const t = sun.target.position;
    const toLight = sun.position.clone().sub(t).normalize();
    const moved = t.clone().sub(new THREE.Vector3(100.013, 1.2, 290.02));
    expect(Math.abs(moved.dot(toLight))).toBeLessThan(1e-6);
    expect(moved.length()).toBeLessThan(texel * Math.SQRT1_2 + 1e-6);
  });

  it('rejects a bad texel size', () => {
    expect(() => snapToShadowTexels({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }, 0)).toThrow();
  });
});
