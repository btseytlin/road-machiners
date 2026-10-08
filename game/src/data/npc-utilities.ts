// The utility part each NPC template may roll at spawn, one roll per truck after its cargo part. The harpoon is a gun,
// but drivers carry it as gear, so it rolls here and not with the guns. See chooseVehicle() in src/sim/npc-loadout.ts.
// Every template has an entry, and every pool has an empty outcome.

import type { Weighted } from './npcs';

// Lawmen light up the night and hook runners.
const LAW_UTILITY: Weighted<string | null>[] = [
  { value: null, weight: 1.5 },
  { value: 'flareCannon', weight: 3 },
  { value: 'harpoon', weight: 3 },
];

// Keyed by NPC template id. A utility is the usual outcome. The drivers who patch and tow others, scavengers, roamers
// and convoys, favor the crane. Where a deck often has no room for a 1x2 part, a 1x1 utility is weighted up, so the
// template still carries one.
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
  // Ship tech: few merc decks keep a 2x2 spot beside the main gun. When one does, the emitter is the likely pick.
  merc: [
    { value: null, weight: 1.5 },
    { value: 'harpoon', weight: 2 },
    { value: 'smokeMortar', weight: 2 },
    { value: 'emitter', weight: 6 },
  ],
};
