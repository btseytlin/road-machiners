import type { GearLevel } from './npcs';
import type { PropKind } from '../sim/terrain';
import type { TerrainTypeId } from './terrain';

export type GroupPlan = { from: 'ahead' | 'behind'; templates: string[]; level: GearLevel };
export type Curve = { first: number; step: number; max: number };

export const FURY_ROAD = {
  spawnOffsets: [-3, -1, 1, 3, -9, 9, -13, 13],
  outpost: {
    look: 'salvage-yard',
    radius: 6,
    across: 19.5,
    spur: { from: 3, half: 1.5 },
    flat: { back: 6, half: 8, blend: 4 },
  },
  waves: [
    [{ from: 'ahead', templates: ['buggy'], level: 'light' }],
    [
      { from: 'ahead', templates: ['buggy'], level: 'light' },
      { from: 'behind', templates: ['buggy'], level: 'light' },
    ],
    [
      { from: 'ahead', templates: ['buggy'], level: 'light' },
      { from: 'behind', templates: ['buggy'], level: 'light' },
    ],
    [
      { from: 'ahead', templates: ['buggy'], level: 'standard' },
      { from: 'behind', templates: ['buggy'], level: 'standard' },
    ],
    [
      { from: 'ahead', templates: ['buggy', 'buggy'], level: 'standard' },
      { from: 'behind', templates: ['buggy'], level: 'standard' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'buggy'], level: 'standard' },
      { from: 'behind', templates: ['buggy', 'buggy'], level: 'standard' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'buggy', 'buggy'], level: 'heavy' },
      { from: 'behind', templates: ['gunwagon', 'buggy'], level: 'heavy' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'loaded' },
      { from: 'behind', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'loaded' },
      { from: 'ahead', templates: ['gunwagon', 'gunwagon'], level: 'loaded' },
    ],
  ] as GroupPlan[][],
  groupSpread: [0.2, 0.85] as [number, number],
  spawnLead: 32,
  aheadGap: 22,
  behindGap: 24,
  spawnStagger: 3,
  maxAlive: 8,
  spawnRetryTurns: 20,
  pay: { base: { first: 30000, step: 15000, max: 120000 } as Curve, perWreck: { first: 6000, step: 1500, max: 15000 } as Curve },
  stock: { base: 2, every: 2, max: 6 },
  goodsMarkup: 1.5,
  maxTries: 400,
};

export type BandRule = { kind: PropKind; count: [number, number]; r: [number, number]; across: [number, number] };
export type GroundBand = { below: number; type: TerrainTypeId };

export const HIGHWAY = {
  version: 2,
  size: 320,
  stride: 220,
  milestoneInset: 50,
  road: {
    lanes: [-3, -1, 1, 3],
    laneWidth: 2,
    asphalt: 5,
    verge: 18,
    badlands: 26,
    flatTo: 15,
    blend: 7,
    ridge: { rise: 10, run: 10 },
    bend: { amplitude: 8, wavelength: 520, seedOffset: 101 },
    profile: { amplitude: 1.5, wavelength: 300, seedOffset: 103 },
    sample: 2,
    paint: { dash: 3, gap: 3, line: 0.22, wear: 0.12 },
  },
  relief: { amplitude: 2.4, octaves: [{ freq: 1 / 56, amp: 1, seedOffset: 201 }, { freq: 1 / 17, amp: 0.3, seedOffset: 202 }] },
  ground: {
    scale: 1 / 22,
    seedOffset: 301,
    verge: [{ below: 0.32, type: 'sand' }, { below: 1, type: 'hardpan' }] as GroundBand[],
    badlands: [{ below: 0.45, type: 'gravel' }, { below: 0.7, type: 'scrub' }, { below: 1, type: 'scree' }] as GroundBand[],
    ridge: 'scree' as TerrainTypeId,
  },
  chunk: 16,
  chunkEdge: 1.8,
  badlands: [
    { kind: 'rock', count: [3, 6], r: [0.6, 1.5], across: [19.5, 40] },
    { kind: 'crag', count: [0, 2], r: [1.6, 2.4], across: [22, 44] },
    { kind: 'deadTree', count: [0, 2], r: [0.35, 0.35], across: [18.5, 34] },
  ] as BandRule[],
  powerLine: { spacing: 12, across: 14, r: 0.3 },
  billboard: { chance: 0.14, r: 1.6, across: [17.6, 21] as [number, number] },
  ditched: { chance: 0.4, kinds: ['carWreck', 'deadTruck'] as PropKind[], r: [0.6, 0.75] as [number, number], across: [12.8, 16.2] as [number, number], yaw: 25 },
  milestoneClear: { south: 34, north: 24, across: 34 },
  propGap: 0.3,
  startLane: 2,
};
