import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { basin, elevationAt } from './elevation';
import { heightFromElevation } from './terrain';
import { DEG, polylineDist, type Vec } from './vec';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { defaultSetup } from './settings';

describe('elevationAt', () => {
  it('is deterministic for the same seed and coordinates', () => {
    expect(elevationAt(7, 12.3, 40.1)).toBe(elevationAt(7, 12.3, 40.1));
  });

  it('differs between seeds', () => {
    expect(elevationAt(1, 30, 30)).not.toBe(elevationAt(2, 30, 30));
  });

  it('does not touch world.rngState', () => {
    const w = newWorld(3, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const before = w.rngState;
    elevationAt(w.seed, 20, 20);
    expect(w.rngState).toBe(before);
  });

  it('levels town floors at their local terrain height', () => {
    for (const town of REGION.towns) {
      const floor = elevationAt(5, town.pos.x, town.pos.y);
      expect(elevationAt(5, town.pos.x + 1, town.pos.y)).toBeCloseTo(floor);
      expect(elevationAt(5, town.pos.x, town.pos.y + 1)).toBeCloseTo(floor);
    }
  });

  it('retains broad rises and falls along roads', () => {
    const samples = REGION.roads[0].map((p) => elevationAt(5, p.x, p.y));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
  });
});

// The Fallen Sun's basin, measured on the base land the bake starts from, at the map's seed. These read the elevation
// functions, not the baked map, which PH5 rebakes. Geology runs after them: slump only moves slopes above its rest
// slope of 0.9, so it cannot soften a cliff below maxSlope, while rain, wind and dunes are measured on the baked map.
describe('the Fallen Sun basin', () => {
  const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
  const sunBasin = TERRAIN.features.basins.find((b) => b.center.x === sun.pos.x && b.center.y === sun.pos.y)!;
  const height = (p: Vec) => heightFromElevation(elevationAt(MAPGEN.seed, p.x, p.y));
  const at = (bearing: number, r: number): Vec => ({ x: sunBasin.center.x + r * Math.cos(bearing * DEG), y: sunBasin.center.y + r * Math.sin(bearing * DEG) });
  const bearingOf = (k: number) => Math.atan2(sunBasin.floor[k].y, sunBasin.floor[k].x) / DEG;
  // Radius of the floor edge on a bearing: the last point out from the centre still at the full depth.
  const floorRadius = (bearing: number) => {
    let r = 0;
    while (basin(sunBasin, at(bearing, r + 0.25).x, at(bearing, r + 0.25).y).cut === sunBasin.depth) r += 0.25;
    return r;
  };
  // Steepest height change per tile between samples a tile apart along a bearing, from r0 out to r1.
  const steepest = (bearing: number, r0: number, r1: number) => {
    let most = 0;
    for (let r = r0; r < r1; r++) most = Math.max(most, Math.abs(height(at(bearing, r + 1)) - height(at(bearing, r))));
    return most;
  };
  const { maxSlope } = TERRAIN.drive;

  it('has a floor edge that is not a circle', () => {
    const radii = Array.from({ length: 10 }, (_, k) => floorRadius(-180 + k * 36));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    expect((Math.max(...radii) - Math.min(...radii)) / mean).toBeGreaterThanOrEqual(0.15);
  });

  it('walls the north arc with cliffs and leaves the south bank drivable', () => {
    for (const k of [2, 3, 4, 7, 8, 9, 10]) {
      const r = Math.hypot(sunBasin.floor[k].x, sunBasin.floor[k].y);
      expect(steepest(bearingOf(k), r - 1, r + sunBasin.bank[k] + 1), `vertex ${k}`).toBeGreaterThan(maxSlope);
    }
    for (const k of [15, 16, 17, 18]) {
      const r = Math.hypot(sunBasin.floor[k].x, sunBasin.floor[k].y);
      expect(steepest(bearingOf(k), r - 3, r + sunBasin.bank[k] + 3), `vertex ${k}`).toBeLessThan(maxSlope);
    }
  });

  it('opens a drivable notch between the two crag walls', () => {
    const notch = (bearingOf(5) + bearingOf(6)) / 2;
    const r = floorRadius(notch);
    // Out to where the north spur ends, past the bank's steepest part.
    expect(steepest(notch, r - 3, r + 13)).toBeLessThan(maxSlope);
    // The crag walls on both sides of it are cliffs.
    expect(steepest(bearingOf(4), r - 4, r + 4)).toBeGreaterThan(maxSlope);
    expect(steepest(bearingOf(7), r - 4, r + 4)).toBeGreaterThan(maxSlope);
  });

  // The land east of the crater already holds a hill, whose own west face is a cliff about 10 tiles out from the floor
  // edge. The basin lifts its lip into that hill, and its own share of the inner face stays under maxSlope.
  it('raises a hill on the east rim whose inner face stays drivable', () => {
    // In height units on land below the mountains, where an elevation unit is TERRAIN.height.hill height units.
    const own = (p: Vec) => {
      const shape = basin(sunBasin, p.x, p.y);
      return shape.rise - shape.cut * TERRAIN.height.hill;
    };
    for (const k of [12, 13]) {
      const r = Math.hypot(sunBasin.floor[k].x, sunBasin.floor[k].y);
      const bank = sunBasin.bank[k];
      let face = 0;
      for (let s = r - 3; s < r + bank; s += 0.5) face = Math.max(face, 2 * Math.abs(own(at(bearingOf(k), s + 0.5)) - own(at(bearingOf(k), s))));
      expect(face, `vertex ${k}`).toBeLessThan(maxSlope);
      const crest = basin(sunBasin, at(bearingOf(k), r + bank).x, at(bearingOf(k), r + bank).y);
      expect(crest.rise, `vertex ${k}`).toBeCloseTo(sunBasin.rim[k], 6);
      // The crest stands over the land just outside the hill.
      expect(height(at(bearingOf(k), r + bank)), `vertex ${k}`).toBeGreaterThan(height(at(bearingOf(k), r + 2 * bank + 2)));
    }
  });

  it('rolls the floor with swells', () => {
    const rises: number[] = [];
    for (let y = -40; y <= 40; y += 2) for (let x = -40; x <= 40; x += 2) {
      const shape = basin(sunBasin, sunBasin.center.x + x, sunBasin.center.y + y);
      if (shape.cut === sunBasin.depth) rises.push(shape.rise);
    }
    expect(rises.length).toBeGreaterThan(500);
    expect(Math.max(...rises) - Math.min(...rises)).toBeGreaterThanOrEqual(sunBasin.floorRelief.amplitude * 0.5);
  });

  it('owns its floor: one level plus its swells, whatever hills the land held there', () => {
    const heights: number[] = [];
    for (let y = -50; y <= 50; y += 2) for (let x = -50; x <= 50; x += 2) {
      const p = { x: sunBasin.center.x + x, y: sunBasin.center.y + y };
      // The crash furrow's head cuts into the south of the floor on purpose.
      const furrow = TERRAIN.features.furrow;
      if (basin(sunBasin, p.x, p.y).cut === sunBasin.depth && polylineDist(p, furrow.path) >= furrow.width + furrow.bank) heights.push(height(p));
    }
    expect(heights.length).toBeGreaterThan(500);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(sunBasin.floorRelief.amplitude + 1e-6);
  });

  it('leaves land far outside the basin untouched', () => {
    expect(basin(sunBasin, sunBasin.center.x + 200, sunBasin.center.y)).toEqual({ cut: 0, rise: 0 });
  });
});
