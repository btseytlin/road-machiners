// Game settings. Change these values to configure a new game and playback.

// The version from the save format and git, worked out by src/version.ts at build time in vite.config.ts and vitest.config.ts.
declare const __GAME_VERSION__: string;
export const GAME_VERSION = __GAME_VERSION__;

export const CONFIG = {
  startKit: 'standard',
  seed: null as number | null,
  combatShotMs: 450,
  combatReadMs: 1100,
  saveTurns: 20,
  saveSlots: 3,
  autoTurnMs: 250,
  travelHoldMs: 250,
  travelFastSpeed: 4,
  playbackFrameMs: 50,
};
