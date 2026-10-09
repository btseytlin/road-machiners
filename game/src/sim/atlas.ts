import { REGION, type LocationDef, type TownDef } from '../data/region';
import { decksOf, type DeckSet } from './bridge';
import { ICARUS_KEY, type AtlasKey } from './terrain';

export { ICARUS_KEY, type AtlasKey };
import { ROAD_INDEX, type RoadIndex } from './road-index';
import { hazardZones, type HazardZone } from './territory';
import type { Vec } from './vec';

export type AtlasRoad = { points: readonly Vec[]; width: number; lanes: number };

export type Atlas = {
  roads: readonly AtlasRoad[];
  roadWidth: number;
  roadIndex: RoadIndex;
  towns: readonly TownDef[];
  locations: readonly LocationDef[];
  decks: DeckSet;
  hazards: readonly HazardZone[];
  oldSpots: boolean;
  landforms: boolean;
};


const HIGHWAYS_KEPT = 2;
const highways = new Map<string, Atlas>();
let icarus: Atlas | null = null;

export function atlasKeyString(key: AtlasKey): string {
  if (key.kind === 'icarus') return 'icarus';
  if (key.kind === 'highway') return `highway:${key.seed}:${key.window}`;
  throw new Error(`Unknown map kind ${JSON.stringify(key)}`);
}

export function atlasOf(t: { atlas: AtlasKey }): Atlas {
  const key = t.atlas;
  if (key.kind === 'icarus') return icarusAtlas();
  if (key.kind !== 'highway') throw new Error(`Unknown map kind ${JSON.stringify(key)}`);
  const name = atlasKeyString(key);
  let atlas = highways.get(name);
  if (!atlas) {
    atlas = highwayAtlasOf(key.seed, key.window);
    highways.set(name, atlas);
    while (highways.size > HIGHWAYS_KEPT) highways.delete(highways.keys().next().value as string);
  }
  return atlas;
}

export function icarusAtlas(): Atlas {
  return (icarus ??= {
    roads: REGION.roads.map((points) => ({ points, width: REGION.roadWidth, lanes: 0 })),
    roadWidth: REGION.roadWidth,
    roadIndex: ROAD_INDEX,
    towns: REGION.towns,
    locations: REGION.locations,
    decks: decksOf(ICARUS_KEY),
    hazards: hazardZones(),
    oldSpots: true,
    landforms: true,
  });
}

export function atlasSites(atlas: Atlas): readonly (TownDef | LocationDef)[] {
  return [...atlas.towns, ...atlas.locations];
}

export function roadEdgeGap(atlas: Atlas, p: Vec, reach: number): number {
  return atlas.roadIndex.nearestWithin(p.x, p.y, reach + atlas.roadWidth / 2) - atlas.roadWidth / 2;
}

function highwayAtlasOf(seed: number, window: number): Atlas {
  throw new Error(`No highway generator yet for seed ${seed} window ${window}`);
}
