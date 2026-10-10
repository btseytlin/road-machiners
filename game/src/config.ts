// Game settings. Change these values to configure a new game and playback.

// The version from the save format and git, worked out by src/version.ts at build time in vite.config.ts and vitest.config.ts.
declare const __GAME_VERSION__: string;
export const GAME_VERSION = __GAME_VERSION__;

declare const __ERROR_REPORT_URL__: string;
declare const __ERROR_REPORT_BUILD__: string;
export const ERROR_REPORT_URL = __ERROR_REPORT_URL__;
export const ERROR_REPORT_BUILD = __ERROR_REPORT_BUILD__;

export const CONFIG = {
  startKit: 'standard',
  seed: null as number | null,
  combatShotMs: 1000,
  combatFireSpreadMs: 300,
  combatBurstMaxMs: 450,
  combatReadMs: 1100,
  saveTurns: 20,
  saveSlots: 3,
  travelHoldMs: 250,
  travelFastSpeed: 4,
  playbackFrameMs: 50,
  questCharMs: 18,
  questWordMs: 70,
};
