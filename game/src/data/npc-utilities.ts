// The utility part each NPC template may roll at spawn, one roll per truck after its cargo part. The harpoon is a gun,
// but drivers carry it as gear, so it rolls here and not with the guns. See chooseVehicle() in src/sim/npc-loadout.ts.
// Every template has an entry, and every pool has an empty outcome.

import type { Weighted } from './npcs';

const LAW_UTILITY: Weighted<string | null>[] = [
  { value: null, weight: 1.5 },
  { value: 'flareCannon', weight: 3 },
  { value: 'harpoon', weight: 3 },
];

export const NPC_UTILITY_PARTS: Record<string, Weighted<string | null>[]> = {
  buggy: [{ value: null, weight: 1.5 }, { value: 'caltrops', weight: 3 }, { value: 'oilSpiller', weight: 1 }, { value: 'harpoon', weight: 1 }],
  gunwagon: [{ value: null, weight: 1.5 }, { value: 'harpoon', weight: 2 }, { value: 'caltrops', weight: 2 }],
  trader: [{ value: null, weight: 1.5 }, { value: 'sprout', weight: 2 }, { value: 'oilSpiller', weight: 2 }],
  scavenger: [{ value: null, weight: 1.5 }, { value: 'patcherCrane', weight: 4 }, { value: 'scrapersKnife', weight: 2 }],
  bowlFarmer: LAW_UTILITY,
  noseArmy: LAW_UTILITY,
  courier: [{ value: null, weight: 1.5 }, { value: 'oilSpiller', weight: 3 }, { value: 'sprout', weight: 2 }],
  roamer: [{ value: null, weight: 1.5 }, { value: 'patcherCrane', weight: 3 }, { value: 'sprout', weight: 1 }],
  vulture: [{ value: null, weight: 1.5 }, { value: 'harpoon', weight: 2 }, { value: 'caltrops', weight: 3 }, { value: 'scrapersKnife', weight: 1 }],
  convoy: [{ value: null, weight: 1.5 }, { value: 'patcherCrane', weight: 3 }, { value: 'sprout', weight: 1 }],
  convoyGuard: [{ value: null, weight: 1.5 }, { value: 'smokeMortar', weight: 2 }, { value: 'flareCannon', weight: 2 }, { value: 'sprout', weight: 1 }],
  merc: [
    { value: null, weight: 1.5 },
    { value: 'harpoon', weight: 2 },
    { value: 'smokeMortar', weight: 2 },
    { value: 'emitter', weight: 6 },
  ],
};
