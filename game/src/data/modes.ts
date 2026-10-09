// Game modes and the world settings a new game can pick. A setting is a multiplier on base numbers in RULES, where 1
// is the standard game. The mode picker lists GAME_MODES, so a new mode is a new row here and a new GameModeId.
// docs/wiki/mechanics/world-settings.md says which rules are settings and why the others stay fixed.

import type { GameModeId, ModeRules, WorldSettings } from '../sim/types';

export type GameMode = { name: string; description: string; rules: ModeRules; kit: string | null };

const OPEN_WORLD: ModeRules = { traffic: true, salvage: true, knockouts: true, yielding: true, radio: true, rescue: true, roadWrecks: true };
const RUN: ModeRules = { traffic: false, salvage: false, knockouts: false, yielding: false, radio: false, rescue: false, roadWrecks: false };

export const GAME_MODES: Record<GameModeId, GameMode> = {
  roaming: { name: 'Roaming', description: 'The open wasteland. Drive, trade, scavenge and fight as you like.', rules: OPEN_WORLD, kit: null },
  furyRoad: { name: 'Fury Road', description: 'An endless highway north between forts. Every fight is to the wreck.', rules: RUN, kit: 'furyRoad' },
};

export type WorldSettingDef = { name: string; description: string; default: number; min: number; max: number; step: number };

export const WORLD_SETTINGS: Record<keyof WorldSettings, WorldSettingDef> = {
  damage: { name: 'Damage', description: 'Damage of every gun and crash, for every truck.', default: 1, min: 0.5, max: 2, step: 0.25 },
  fuelUse: { name: 'Fuel use', description: 'Fuel every truck burns per tile driven.', default: 1, min: 0.5, max: 2, step: 0.25 },
  supplyUse: { name: 'Supply use', description: 'Supplies every crew eats per turn.', default: 1, min: 0.5, max: 2, step: 0.25 },
};
