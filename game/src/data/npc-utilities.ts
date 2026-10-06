// The utility part each NPC template may roll at spawn, one roll per truck after its cargo part. The harpoon is a gun,
// but drivers carry it as gear, so it rolls here and not with the guns. See chooseVehicle() in src/sim/npc-loadout.ts.
// Every template has an entry, and every pool has an empty outcome.

import type { GearLevel, Weighted } from './npcs';

// One roll of a template's utility part: a utility id, or null for none. `levels`, when set, are the only gear levels
// that may roll it, so rare gear stays with well-equipped drivers.
export type UtilityRoll = Weighted<string | null> & { levels?: GearLevel[] };

// Every gear level but poor, for tier-2 rolls: a poor driver makes do with tier-1 gear.
const NOT_POOR: GearLevel[] = ['light', 'standard', 'heavy', 'loaded'];

// Lawmen light up the night and hook runners.
const LAW_UTILITY: UtilityRoll[] = [
  { value: null, weight: 1.5 },
  { value: 'flareCannon', weight: 3, levels: NOT_POOR },
  { value: 'harpoon', weight: 3, levels: NOT_POOR },
];

// Keyed by NPC template id. A utility is the usual outcome. The drivers who patch and tow others, scavengers, roamers
// and convoys, favor the crane. Where a deck often has no room for a 1x2 part, a 1x1 utility is weighted up, so the
// template still carries one.
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
  // Ship tech: only a heavy or loaded merc rolls the emitter, and few merc decks keep a 2x2 spot beside the main gun.
  // When one does, the emitter is the likely pick.
  merc: [
    { value: null, weight: 1.5 },
    { value: 'harpoon', weight: 2, levels: NOT_POOR },
    { value: 'smokeMortar', weight: 2, levels: NOT_POOR },
    { value: 'emitter', weight: 6, levels: ['heavy', 'loaded'] },
  ],
};
