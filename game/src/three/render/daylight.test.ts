import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TIME } from '../../data/time';
import type { VehicleFrame } from '../../phys/frames';
import { bodyOf } from '../../sim/body';
import { beamOrder, daylightAt, NightLights, sunLight, type LitVehicle } from './daylight';

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
const litAt = (x: number, on = true): LitVehicle => ({ chassisId: 'scout', frame: frameAt(x), on });
const spots = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.SpotLight => c instanceof THREE.SpotLight);
const origin = { x: 0, y: 0, z: 0 };

describe('beamOrder', () => {
  it('drops lamp-off vehicles and puts the nearest first', () => {
    const order = beamOrder([litAt(30), litAt(5, false), litAt(0), litAt(10)], origin);
    expect(order.map((v) => v.frame.pos.x)).toEqual([0, 10, 30]);
  });
});

describe('NightLights', () => {
  it('casts shadows from only the four nearest beams, and reassigns them as trucks move', () => {
    const scene = new THREE.Scene();
    const lights = new NightLights(scene);
    const xs = [60, 10, 50, 20, 40, 30];
    lights.update(true, origin, xs.map((x) => litAt(x)));
    const shadowed = () => spots(scene).filter((b) => b.castShadow);
    expect(shadowed()).toHaveLength(4);
    expect(shadowed().every((b) => b.shadow.autoUpdate)).toBe(true);
    const nearNoses = shadowed().map((b) => Math.round(b.position.x)).sort((a, b) => a - b);
    const nose = bodyOf('scout').half.x;
    expect(nearNoses).toEqual([10, 20, 30, 40].map((x) => Math.round(x + nose)));

    lights.update(true, { x: 60, y: 0, z: 0 }, xs.map((x) => litAt(x)));
    expect(shadowed()).toHaveLength(4);
    const moved = shadowed().map((b) => Math.round(b.position.x)).sort((a, b) => a - b);
    expect(moved).toEqual([60, 50, 40, 30].sort((a, b) => a - b).map((x) => Math.round(x + nose)));
  });

  it('zeroes idle beams and stops their shadow passes', () => {
    const scene = new THREE.Scene();
    const lights = new NightLights(scene);
    lights.update(true, origin, [litAt(0), litAt(10), litAt(20)]);
    lights.update(true, origin, [litAt(0, false), litAt(10, false), litAt(20, false)]);
    const beams = spots(scene);
    expect(beams.length).toBeGreaterThan(0);
    expect(beams.every((b) => b.intensity === 0)).toBe(true);
    expect(beams.filter((b) => b.castShadow).every((b) => !b.shadow.autoUpdate)).toBe(true);
  });

  it('removes every beam and frees shadow maps at dawn', () => {
    const scene = new THREE.Scene();
    const lights = new NightLights(scene);
    lights.update(true, origin, [0, 10, 20, 30, 40, 50].map((x) => litAt(x)));
    const maps = spots(scene)
      .filter((b) => b.castShadow)
      .map((b) => vi.spyOn(b.shadow, 'dispose'));
    expect(maps).toHaveLength(4);
    lights.update(false, origin, []);
    expect(spots(scene)).toHaveLength(0);
    expect(maps.every((d) => d.mock.calls.length === 1)).toBe(true);
  });

  it('leaves the sun shadow settings alone', () => {
    const sun = sunLight();
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.normalBias).toBe(0.3);
  });
});
