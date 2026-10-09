import type { GearLevel } from './npcs';
import type { LandmarkLook } from '../sim/types';

export type GroupPlan = { from: 'ahead' | 'behind'; templates: string[]; level: GearLevel };
export type RowLook = { kind: 'wreck' } | { kind: 'landmark'; look: Extract<LandmarkLook, 'barrier' | 'tankTrap' | 'drums'> };

export const GAUNTLET = {
  stretches: 4,
  roads: [0, 1],
  townMargin: 24,
  startGap: 24,
  stretchJitter: 0.12,
  rowGap: 14,
  outpostGap: 16,
  rowsPerStretch: [2, 3, 3, 4],
  maxBlocked: [1, 1, 2, 2],
  laneOffsets: [-2.25, -0.75, 0.75, 2.25],
  startLane: 1,
  rowRadius: [0.55, 0.7] as [number, number],
  rowLooks: [
    { kind: 'wreck' },
    { kind: 'landmark', look: 'barrier' },
    { kind: 'landmark', look: 'tankTrap' },
    { kind: 'landmark', look: 'drums' },
  ] as RowLook[],
  outpost: {
    padOffset: 7,
    padRadius: 3,
    props: [
      { look: 'guardPost', along: -2.5, across: 2.5, r: 0.8 },
      { look: 'shack', along: 1, across: 3.5, r: 0.9 },
      { look: 'drums', along: 3.5, across: 1.5, r: 0.45 },
      { look: 'barrier', along: -3.5, across: -0.5, r: 0.5 },
    ] as { look: LandmarkLook; along: number; across: number; r: number }[],
  },
  stockSize: [2, 3, 4, 5],
  groups: [
    [{ from: 'ahead', templates: ['buggy', 'buggy'], level: 'poor' }],
    [
      { from: 'ahead', templates: ['buggy', 'buggy'], level: 'light' },
      { from: 'behind', templates: ['buggy', 'buggy'], level: 'light' },
    ],
    [
      { from: 'ahead', templates: ['buggy', 'gunwagon', 'buggy'], level: 'standard' },
      { from: 'behind', templates: ['buggy', 'buggy', 'buggy'], level: 'standard' },
    ],
    [
      { from: 'ahead', templates: ['gunwagon', 'buggy', 'buggy'], level: 'heavy' },
      { from: 'behind', templates: ['buggy', 'buggy', 'gunwagon'], level: 'heavy' },
      { from: 'ahead', templates: ['gunwagon', 'gunwagon', 'buggy'], level: 'heavy' },
    ],
  ] as GroupPlan[][],
  groupSpread: [0.2, 0.85] as [number, number],
  spawnLead: 32,
  aheadGap: 22,
  behindGap: 24,
  spawnStagger: 3,
  maxAlive: 8,
  spawnRetryTurns: 20,
  pay: { base: [15000, 25000, 35000, 50000], perWreck: [3000, 4000, 5000, 6000] },
  goodsMarkup: 1.5,
  maxTries: 400,
};
