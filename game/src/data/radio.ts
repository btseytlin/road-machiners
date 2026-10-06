// Waste Of Time Radio: J.J.'s lines and the pacing of her broadcasts. See docs/lore.md for her voice and
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
  // Out-of-character words J.J. never says, matched at the start of a word.
  banned: ['turn', 'quest', 'xp', 'experience', 'level', 'hp', 'click', 'press', 'key', 'player', 'game', 'tile', 'save'],
};

// Hours of the clock calls. Dawn and dusk follow TIME.sunrise and TIME.sunset.
export const RADIO_HOURS = { noon: 12, midnight: 0 };

// Slots: {place} is "near X" for a found place or a basin direction, {heading} a compass word, {shop} and {to}
// found site names, {good} a good name, {part} a part name, {target} a driver name.
export const RADIO_LINES: Record<RadioTopic, readonly string[]> = {
  ident: [
    'This is J.J. on Waste Of Time Radio, wasting your time since the sky fell.',
    'Waste Of Time Radio, J.J. at the mic. Nobody asked, and here I am anyway.',
  ],
  dawn: [
    "Sun's up over the basin. The water sellers have beaten it to market.",
    'Morning, boys. Dew on the glass, sand in the gears. Same as yesterday.',
    'Dawn report: sky clear of anything worth eating. Rise and roll.',
  ],
  noon: [
    'High noon. The engines are singing a song I never learned to like.',
    'Noon on the basin. Even the lizards have the sense to stop.',
  ],
  dusk: [
    'Sun going down. Somewhere, somebody just became a landmark.',
    'Dusk report: the day crop came in dry again. Bring it home, boys.',
  ],
  midnight: [
    'Midnight. Only the engines know whose road this is.',
    'Midnight on Waste Of Time Radio. Still here. Still wasting it.',
  ],
  heatwaveStart: [
    'Heat wave coming. The radiator choir has begun its warm-up.',
    'Heat wave over the basin. Radiators will boil before the kettles do.',
  ],
  heatwaveEnd: [
    'Heat wave broke. The engine choir is mercifully quiet.',
    'That heat finally let go. Thank whoever you thank.',
  ],
  overcastStart: [
    "Clouds over the basin. The sun's taking the day off.",
    'Overcast and cool. The sky remembered how to be kind.',
  ],
  stormStart: [
    'Dust storm rolling {place}, heading {heading}.',
    'Dust wall {place}, drifting {heading}. The horizon just resigned.',
  ],
  stormEnd: [
    'That dust storm {place} has blown itself out.',
    'Storm {place} settled. Somebody go dig out the road.',
  ],
  haul: [
    'New haul posted at {shop}: {good} out to {to}.',
    '{shop} needs {good} carried to {to}. Honest work, for once.',
  ],
  fetch: [
    '{shop} is asking after a working {part}.',
    'Wanted at {shop}: one {part}, still breathing.',
  ],
  bounty: [
    '{shop} put a price on {target}. Business, not murder, they say.',
    'Paper up at {shop} for {target}. I just read the board, boys.',
  ],
  raid: [
    'Raider business {place}. Another busy day for the accountants.',
    'Raiders working the road {place}. Cargo changes hands out there.',
    'Word of a stickup {place}. Raiders, keeping regular hours.',
  ],
  raidKnockout: [
    'Another rig went quiet {place}. Raiders, by the sound of it.',
    'A rig sits dead {place}. Raiders took their cut. Nobody take more.',
  ],
  // Banter stays in-world; hints, where present, are oblique, never instructions.
  wisdom: [
    'The noon sun has opinions about engines. The shade keeps its own counsel.',
    "Town guns have a longer memory than the town clerk.",
    "After dark, you hear a neighbor long before you see one.",
    'A silent rig at the roadside has either good brakes or bad luck.',
    'Road dust has a way of introducing a driver before their name does.',
    'A heavy rig always gets the last word in an argument with a light one.',
    'Off-road miles have a habit of becoming repair bills.',
    'A stranded trader gets visitors. A stranded raider gets stories.',
    'The dust swallowed the horizon again. I never trusted it anyway.',
    "A fuel needle at the bottom tells the longest stories.",
    'Town beds are dear. A night without a wrench is dearer.',
    'Somebody honked at a trader. The trader honked back. Society survives.',
    'My producer says we need a sponsor. I told him we need a producer.',
    'Found an Old World weather report. It ended with “chance of rain.” Lovely fiction.',
    'The mast is still here. The coffee is not. One of us has priorities.',
    'Tonight the road has company. Tomorrow it will deny knowing any of them.',
    'A listener sent me a map. It had one mark: “not here.” Sensible cartography.',
    'I have been accused of talking to myself. You are the evidence against me.',
    'The static just requested a song. I said it was already playing one.',
    'Somewhere an honest mechanic has retired. The rest have raised their prices.',
  ],
};

// Basin directions for places the listener has not found, clockwise from east. North is -y on the map.
export const BASIN_DIRECTIONS = [
  'out east',
  'in the southeast basin',
  'down south',
  'in the southwest basin',
  'out west',
  'in the northwest basin',
  'up north',
  'in the northeast basin',
] as const;

// Compass words for which way a storm drifts, clockwise from east.
export const HEADINGS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const;
