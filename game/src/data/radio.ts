// Waste Of Time Radio: the topics and pacing of J.J.'s broadcasts. Her lines live in src/text/. See docs/lore.md for her voice and
// src/ui/radio.ts for what she reports.

export type RadioTopic =
  | 'ident'
  | 'dawn'
  | 'noon'
  | 'dusk'
  | 'midnight'
  | 'heatwaveStart'
  | 'heatwaveEnd'
  | 'overcastStart'
  | 'stormStart'
  | 'stormEnd'
  | 'haul'
  | 'fetch'
  | 'bounty'
  | 'raid'
  | 'raidKnockout'
  | 'wisdom';

export const RADIO = {
  minGapTurns: 35, // minimum turns between broadcasts
  gapJitterTurns: 45, // add a random 0..45 turns so J.J. never broadcasts on a metronome
  clockChance: 0.25, // a clock crossing is occasional color, not an hourly announcement
  queueCap: 3, // broadcasts waiting at once; the oldest filler goes first when full
  staleTurns: 65, // old news and clock calls expire instead of playing in a burst
  placeCooldownTurns: 150, // turns before a second raid report at the same place
  idleTurns: 240, // quiet turns before J.J. fills the air with banter
  charsPerSecond: 24, // real-time typing speed of the pager screen
  nearTiles: 60, // a place farther than this from the news is named by basin direction instead
  maxChars: 90, // a filled line fits the three-line screen
};

// Hours of the clock calls. Dawn and dusk follow TIME.sunrise and TIME.sunset.
export const RADIO_HOURS = { noon: 12, midnight: 0 };

// How many lines J.J. has for each topic. Their words live in src/text/ as radio.<topic>.<variant>, the same count in
// every language.
export const RADIO_VARIANTS: Record<RadioTopic, number> = {
  ident: 2,
  dawn: 3,
  noon: 2,
  dusk: 2,
  midnight: 2,
  heatwaveStart: 2,
  heatwaveEnd: 2,
  overcastStart: 2,
  stormStart: 2,
  stormEnd: 2,
  haul: 2,
  fetch: 2,
  bounty: 2,
  raid: 3,
  raidKnockout: 2,
  wisdom: 20,
};

// The eight directions clockwise from east, for the basin a place lies in and the way a storm drifts. North is -y
// on the map. Their words live in src/text/.
export const DIRECTIONS = ['east', 'southEast', 'south', 'southWest', 'west', 'northWest', 'north', 'northEast'] as const;
export type Direction = (typeof DIRECTIONS)[number];
