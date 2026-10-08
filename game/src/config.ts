// Game settings. Change these values to configure a new game and playback.

// The version from the save format and git, worked out by src/version.ts at build time in vite.config.ts and vitest.config.ts.
declare const __GAME_VERSION__: string;
export const GAME_VERSION = __GAME_VERSION__;

// Where error reports go and which factory build sends them, from ERROR_REPORT_URL and ERROR_REPORT_BUILD at build time.
// Only the factory's release, dev and candidate builds set them. An empty URL sends no reports.
declare const __ERROR_REPORT_URL__: string;
declare const __ERROR_REPORT_BUILD__: string;
export const ERROR_REPORT_URL = __ERROR_REPORT_URL__;
export const ERROR_REPORT_BUILD = __ERROR_REPORT_BUILD__;

export const CONFIG = {
  startKit: 'standard',
  // A fixed world seed replays the same game. Null rolls a new seed for each new game.
  seed: null as number | null,
  combatShotMs: 1000, // the band after movement in which every volley leaves and lands
  combatFireSpreadMs: 300, // latest start of a volley in the band
  combatBurstMaxMs: 450, // longest a burst of rounds spans
  combatReadMs: 1100,
  saveTurns: 20,
  saveSlots: 3, // manual save slots
  autoTurnMs: 250,
  travelHoldMs: 250,
  travelFastSpeed: 4,
  // A slow frame advances turn playback by at most this, so it stretches the turn instead of skipping the trucks ahead.
  playbackFrameMs: 50,
};
