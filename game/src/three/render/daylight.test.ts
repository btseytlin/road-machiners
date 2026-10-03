import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { daylightAt } from './daylight';

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
