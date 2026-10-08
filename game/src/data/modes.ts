// Game modes and the world settings a new game can pick. A setting is a multiplier on base numbers in RULES, where 1
// is the standard game. The mode picker lists GAME_MODES, so a new mode is a new row here and a new GameModeId.
// docs/wiki/mechanics/world-settings.md says which rules are settings and why the others stay fixed.

import type { GameModeId, WorldSettings } from '../sim/types';

export type GameMode = Record<never, never>;

export const GAME_MODES: Record<GameModeId, GameMode> = {
  roaming: {},
};

export type WorldSettingDef = { default: number; min: number; max: number; step: number };

export const WORLD_SETTINGS: Record<keyof WorldSettings, WorldSettingDef> = {
  damage: { default: 1, min: 0.5, max: 2, step: 0.25 },
  fuelUse: { default: 1, min: 0.5, max: 2, step: 0.25 },
  supplyUse: { default: 1, min: 0.5, max: 2, step: 0.25 },
};
