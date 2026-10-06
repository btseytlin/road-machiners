import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { playerVehicle } from '../../sim/damage';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { setHeadlights } from '../../sim/world';
import { daylightAt, lampsOn, nightLightsWanted, vehicleLampsOn } from './daylight';

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
