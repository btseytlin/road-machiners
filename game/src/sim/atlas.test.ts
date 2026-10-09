import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TEST_MAP } from '../test/map';
import { atlasOf, atlasSites, icarusAtlas, roadEdgeGap } from './atlas';
import { DECKS, ICARUS_DECKS } from './bridge';
import { ROAD_INDEX } from './road-index';
import { hazardZones } from './territory';
import type { AtlasKey } from './atlas';

describe('the Icarus atlas', () => {
  it('holds the static Icarus features', () => {
    const atlas = atlasOf(TEST_MAP.terrain);

    expect(atlas).toBe(icarusAtlas());
    expect(atlas.roads.map((r) => r.points)).toEqual(REGION.roads);
    expect(atlas.roads.every((r) => r.lanes === 0 && r.width === REGION.roadWidth)).toBe(true);
    expect(atlas.roadIndex).toBe(ROAD_INDEX);
    expect(atlas.towns).toBe(REGION.towns);
    expect(atlas.locations).toBe(REGION.locations);
    expect(atlas.decks).toBe(ICARUS_DECKS);
    expect(atlas.decks.decks).toBe(DECKS);
    expect(atlas.hazards).toEqual(hazardZones());
    expect(atlas.oldSpots && atlas.landforms).toBe(true);
    expect(atlasSites(atlas)).toHaveLength(REGION.towns.length + REGION.locations.length);
  });

  it('measures the gap to a road edge', () => {
    const on = REGION.roads[0][1];

    expect(roadEdgeGap(icarusAtlas(), on, 1)).toBe(-REGION.roadWidth / 2);
    expect(roadEdgeGap(icarusAtlas(), { x: -500, y: -500 }, 1)).toBe(Infinity);
  });

  it('throws on a map kind it does not know', () => {
    expect(() => atlasOf({ atlas: { kind: 'moon' } as unknown as AtlasKey })).toThrow(/Unknown map kind/);
  });
});
