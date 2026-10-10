// Game modes and the world settings a new game can pick. A setting is a multiplier on base numbers in RULES, where 1
// is the standard game. The mode picker lists GAME_MODES, so a new mode is a new row here and a new GameModeId.
// docs/wiki/mechanics/world-settings.md says which rules are settings and why the others stay fixed.

import type { GameModeId, ModeRules, WorldSettings } from '../sim/types';

export type GameMode = { rules: ModeRules; kit: string | null };

const OPEN_WORLD: ModeRules = { traffic: true, salvage: true, knockouts: true, yielding: true, radio: true, rescue: true, roadWrecks: true };
const RUN: ModeRules = { traffic: false, salvage: false, knockouts: false, yielding: false, radio: false, rescue: false, roadWrecks: false };

export const GAME_MODES: Record<GameModeId, GameMode> = {
  roaming: { rules: OPEN_WORLD, kit: null },
  furyRoad: { rules: RUN, kit: 'furyRoad' },
};

export type WorldSettingDef = { default: number; min: number; max: number; step: number };

export const WORLD_SETTINGS: Record<keyof WorldSettings, WorldSettingDef> = {
  damage: { default: 1, min: 0.5, max: 2, step: 0.25 },
  fuelUse: { default: 1, min: 0.5, max: 2, step: 0.25 },
  supplyUse: { default: 1, min: 0.5, max: 2, step: 0.25 },
};
