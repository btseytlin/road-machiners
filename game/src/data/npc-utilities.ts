// The utility part each NPC template may roll at spawn, one roll per truck after its cargo part. The harpoon is a gun,
// but drivers carry it as gear, so it rolls here and not with the guns. See chooseVehicle() in src/sim/npc-loadout.ts.
// Every template has an entry, and every pool has an empty outcome.

import type { GearLevel, Weighted } from './npcs';

export type UtilityRoll = Weighted<string | null> & { levels?: GearLevel[] };

const NOT_POOR: GearLevel[] = ['light', 'standard', 'heavy', 'loaded'];

const LAW_UTILITY: UtilityRoll[] = [
  { value: null, weight: 1.5 },
  { value: 'flareCannon', weight: 3, levels: NOT_POOR },
  { value: 'harpoon', weight: 3, levels: NOT_POOR },
];

export const NPC_UTILITY_PARTS: Record<string, UtilityRoll[]> = {
  buggy: [{ value: null, weight: 1.5 }, { value: 'caltrops', weight: 3 }, { value: 'oilSpiller', weight: 1 }, { value: 'harpoon', weight: 1, levels: NOT_POOR }],
  gunwagon: [{ value: null, weight: 1.5 }, { value: 'harpoon', weight: 2, levels: NOT_POOR }, { value: 'caltrops', weight: 2 }],
  trader: [{ value: null, weight: 1.5 }, { value: 'sprout', weight: 2 }, { value: 'oilSpiller', weight: 2 }],
  scavenger: [{ value: null, weight: 1.5 }, { value: 'patcherCrane', weight: 4 }, { value: 'scrapersKnife', weight: 2, levels: NOT_POOR }],
  bowlFarmer: LAW_UTILITY,
  noseArmy: LAW_UTILITY,
  courier: [{ value: null, weight: 1.5 }, { value: 'oilSpiller', weight: 3 }, { value: 'sprout', weight: 2 }],
  roamer: [{ value: null, weight: 1.5 }, { value: 'patcherCrane', weight: 3 }, { value: 'sprout', weight: 1 }],
  vulture: [{ value: null, weight: 1.5 }, { value: 'harpoon', weight: 2, levels: NOT_POOR }, { value: 'caltrops', weight: 3 }, { value: 'scrapersKnife', weight: 1, levels: NOT_POOR }],
  convoy: [{ value: null, weight: 1.5 }, { value: 'patcherCrane', weight: 3 }, { value: 'sprout', weight: 1 }],
  convoyGuard: [{ value: null, weight: 1.5 }, { value: 'smokeMortar', weight: 2, levels: NOT_POOR }, { value: 'flareCannon', weight: 2, levels: NOT_POOR }, { value: 'sprout', weight: 1 }],
  merc: [
    { value: null, weight: 1.5 },
    { value: 'harpoon', weight: 2, levels: NOT_POOR },
    { value: 'smokeMortar', weight: 2, levels: NOT_POOR },
    { value: 'emitter', weight: 6, levels: ['heavy', 'loaded'] },
  ],
};
