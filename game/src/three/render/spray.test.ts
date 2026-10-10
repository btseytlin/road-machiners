import { describe, expect, it } from 'vitest';
import { TERRAIN_TYPES } from '../../data/terrain';
import { sprayShare } from './fx';

describe('wheel spray by surface', () => {
  it('throws almost nothing on roads and the most on loose sand', () => {
    expect(sprayShare(TERRAIN_TYPES.road)).toBeLessThan(0.1);
    expect(sprayShare(TERRAIN_TYPES.asphalt)).toBeLessThan(0.1);
    expect(sprayShare(TERRAIN_TYPES.hardpan)).toBe(1);
    expect(sprayShare(TERRAIN_TYPES.sand)).toBeGreaterThan(1.5);
  });

  it('keeps the order of the ground dust values the sim uses for sighting', () => {
    const types = Object.values(TERRAIN_TYPES).sort((a, b) => a.dust - b.dust);
    const shares = types.map(sprayShare);
    expect(shares).toEqual([...shares].sort((a, b) => a - b));
  });
});
