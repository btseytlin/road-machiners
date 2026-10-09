import type { GearLevel } from './npcs';
import type { LandmarkLook } from '../sim/types';
import type { PropKind } from '../sim/terrain';
import type { TerrainTypeId } from './terrain';

export type GroupPlan = { from: 'ahead' | 'behind'; templates: string[]; level: GearLevel };
export type Curve = { first: number; step: number; max: number };

export const GAUNTLET = {
  laneOffsets: [-2.25, -0.75, 0.75, 2.25],
  rowRadius: [0.55, 0.7] as [number, number],
  outpost: {
    padRadius: 3,
    props: [
      { look: 'guardPost', along: -2.5, across: 2.5, r: 0.8 },
      { look: 'shack', along: 1, across: 3.5, r: 0.9 },
      { look: 'drums', along: 3.5, across: 1.5, r: 0.45 },
      { look: 'barrier', along: -3.5, across: -0.5, r: 0.5 },
    ] as { look: LandmarkLook; along: number; across: number; r: number }[],
  },
  waves: [
    [{ from: 'ahead', templates: ['buggy'], level: 'light' }],
    [
      { from: 'ahead', templates: ['buggy'], level: 'light' },
      { from: 'behind', templates: ['buggy'], level: 'light' },
    ],
    [
      { from: 'ahead', templates: ['buggy', 'buggy'], level: 'standard' },
      { from: 'behind', templates: ['buggy'], level: 'standard' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'buggy', 'buggy'], level: 'heavy' },
      { from: 'behind', templates: ['buggy', 'buggy', 'gunwagon'], level: 'heavy' },
      { from: 'ahead', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'heavy' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'buggy', 'buggy'], level: 'heavy' },
      { from: 'behind', templates: ['gunwagon', 'buggy', 'buggy'], level: 'heavy' },
      { from: 'ahead', templates: ['gunwagon', 'gunwagon'], level: 'heavy' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'heavy' },
      { from: 'behind', templates: ['gunwagon', 'buggy', 'buggy'], level: 'heavy' },
      { from: 'ahead', templates: ['gunwagon', 'gunwagon'], level: 'loaded' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'loaded' },
      { from: 'behind', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'heavy' },
      { from: 'ahead', templates: ['gunwagon', 'gunwagon'], level: 'loaded' },
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
  pay: { base: { first: 15000, step: 10000, max: 80000 } as Curve, perWreck: { first: 3000, step: 1000, max: 10000 } as Curve },
  stock: { base: 2, every: 2, max: 6 },
  goodsMarkup: 1.5,
  maxTries: 400,
};

export type SceneryRule = { kind: PropKind; count: [number, number]; r: [number, number]; band: 'shoulder' | 'open' };
export type GroundBand = { below: number; type: TerrainTypeId };

export const HIGHWAY = {
  version: 1,
  size: 320,
  margin: 40,
  road: {
    halfWidth: 3,
    hardShoulder: 1.5,
    flat: 2,
    blend: 12,
    bends: [
      { amplitude: 34, wavelength: 420, seedOffset: 101 },
      { amplitude: 8, wavelength: 150, seedOffset: 102 },
    ],
    minBendRadius: 60,
    profile: { amplitude: 3, wavelength: 260, seedOffset: 103 },
    sample: 2,
    paint: { dash: 3, gap: 4, line: 0.22, edgeInset: 0.35 },
  },
  edge: { band: 28, height: 14 },
  relief: { amplitude: 2.4, octaves: [{ freq: 1 / 56, amp: 1, seedOffset: 201 }, { freq: 1 / 17, amp: 0.3, seedOffset: 202 }] },
  ground: { scale: 1 / 22, seedOffset: 301, ridgeRise: 2.5, bands: [{ below: 0.3, type: 'sand' }, { below: 0.6, type: 'hardpan' }, { below: 0.76, type: 'scrub' }, { below: 0.88, type: 'gravel' }, { below: 1, type: 'scree' }] as GroundBand[] },
  chunkRows: 16,
  chunkEdge: 1.8,
  shoulderBand: [1.4, 4.5] as [number, number],
  openFrom: 7,
  edgeKeep: 4,
  scenery: [
    { kind: 'rock', count: [3, 7], r: [0.6, 1.5], band: 'open' },
    { kind: 'crag', count: [0, 1], r: [1.6, 2.4], band: 'open' },
    { kind: 'deadTree', count: [0, 2], r: [0.35, 0.35], band: 'open' },
    { kind: 'carWreck', count: [0, 1], r: [0.6, 0.75], band: 'shoulder' },
    { kind: 'deadTruck', count: [0, 1], r: [0.65, 0.75], band: 'shoulder' },
    { kind: 'pole', count: [0, 1], r: [0.3, 0.3], band: 'shoulder' },
  ] as SceneryRule[],
  billboard: { chance: 0.12, r: 1.6, across: [9, 14] as [number, number] },
  rowKinds: ['carWreck', 'barrier', 'tankTrap', 'drums'] as PropKind[],
  propGap: 0.3,
  bandGap: 1.5,
  rowGap: 14,
  outpostGap: 16,
  gateGap: 9,
  gateReach: 9,
  gateStep: 1.3,
  endGap: 6,
  endReach: 5,
  endStep: 1.1,
  outpostZone: 14,
  startLane: 1,
  pad: { offset: 7, radius: 3, flatten: 3 },
  rows: { first: 2, every: 2, max: 5 },
  maxBlocked: { upTo: 2, early: 1, late: 2 },
  maxTries: 200,
};
