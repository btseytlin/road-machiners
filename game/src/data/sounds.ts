// Sound catalog and mix numbers. A cue's files are public/sfx/<cue>-<n>.ogg, written by scripts/sfx-import.mjs.
// Deleting a file drops that variant.
// Generated cues carry prompt subjects; scripts/sfx-gen.mjs puts the SOUND_STYLE of the cue's setup in front.
// A cue with several prompts is a family of different sounds, one prompt per variant.

export type Bus = "ui" | "sfx" | "ambient" | "music";

export type CueDef = {
  bus: Bus;
  volume: number; // gain on top of the bus
  pitchJitter: number; // playback rate varies by up to this share either way
  maxVoices: number; // plays of this cue sounding at once
  loop: boolean;
  setup?: Setup; // recording setup for generation; free music has none
  beat?: Beat; // a bar-exact loop on the score grid
  prompts?: readonly string[]; // generation subjects, for cues made with ElevenLabs
  seconds?: number; // generated length
};

export type Cue = CueDef & { files: string[] }; // variants; one is picked per play

export type Setup = "field" | "cab" | "score" | "stinger";

// A beat loop lasts exactly bars * BEATS_PER_BAR beats at bpm, so its beat grid holds across repeats.
export type Beat = { bpm: number; bars: number };
export const BEATS_PER_BAR = 4;

export function beatLoopSeconds(b: Beat): number {
  return (b.bars * BEATS_PER_BAR * 60) / b.bpm;
}

// Shared prompt start per recording setup, so generated sounds share one microphone and place.
export const SOUND_STYLE: Record<Setup, string> = {
  field: "Realistic sound effect, one field microphone about 10 meters away, outdoors in a dry desert, natural and unprocessed, full frequency range, no cinematic whoosh, no sub-bass boom, no music, no voices.",
  cab: "Realistic foley, one close microphone inside an old truck cab, natural and unprocessed, dry, no reverb, no electronic sounds, no music, no voices.",
  stinger: "Tribal power metal stinger for a wasteland battle, 90 BPM, D minor. Big tribal war drums, heavy distorted electric guitar, deep Mongolian throat singing. Punchy, fierce and energetic, short, no screams, no synths.",
  score: "Wasteland war soundtrack in the style of Mad Max, D minor. Raw dry recording in one room: tribal war drums and a gritty overdriven electric bass. Driving, fierce and steady, no vocals, no synths.",
};

const DEFS = {
  // UI: physical truck cab controls, never digital beeps.
  "ui-click": { bus: "ui", setup: "cab", pitchJitter: 0.04, maxVoices: 2, volume: 0.6, loop: false, prompts: ["Single click of an old metal toggle switch on a truck dashboard."], seconds: 0.5 },
  "ui-open": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.7, loop: false, prompts: ["Rusty metal glovebox latch opening with a short creak."], seconds: 0.8 },
  "ui-close": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.7, loop: false, prompts: ["Heavy metal lid shutting with a dull latch clack."], seconds: 0.6 },
  "ui-confirm": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.8, loop: false, prompts: ["Heavy steel ratchet clicking tight, a deal sealed."], seconds: 0.6 },
  "radio": { bus: "ui", setup: "cab", pitchJitter: 0.03, maxVoices: 1, volume: 0.8, loop: false, prompts: ["Old CB radio in a truck cab: the handset key clicks, then a short burst of analog static squelch crackles from the dashboard speaker."], seconds: 1.2 },
  "ui-error": { bus: "ui", setup: "cab", pitchJitter: 0, maxVoices: 1, volume: 0.8, loop: false, prompts: ["Dull thud of a jammed metal lever that will not move."], seconds: 0.5 },

  // Turn results.
  "money": { bus: "ui", setup: "cab", volume: 0.8, pitchJitter: 0.03, maxVoices: 1, loop: false, prompts: ["A few old metal coins and bottle caps dropped into a tin box."], seconds: 1 },
  "level-up": { bus: "ui", setup: "cab", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompts: ["Heavy steel lever slams and locks into place with a deep satisfying clunk, then a short bright ring of struck metal."], seconds: 2 },
  "discover": { bus: "ui", setup: "cab", volume: 0.9, pitchJitter: 0, maxVoices: 1, loop: false, prompts: ["Short low mysterious metallic swell with distant wind, a place revealed."], seconds: 2 },
  "air-brake": { bus: "sfx", setup: "field", volume: 0.5, pitchJitter: 0.03, maxVoices: 1, loop: false, prompts: ["Heavy truck air brakes hiss as it stops on gravel."], seconds: 1.5 },
  "defeat": { bus: "ui", setup: "cab", volume: 1, pitchJitter: 0, maxVoices: 1, loop: false, prompts: ["Low ominous boom fading into a dying engine and silence."], seconds: 3 },

  // Combat.
  "mg-fire": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0.06, maxVoices: 6, loop: false, prompts: ["Single heavy machine gun shot outdoors, sharp crack with a short echo."], seconds: 0.6 },
  "cannon-fire": { bus: "sfx", setup: "field", volume: 0.9, pitchJitter: 0.04, maxVoices: 3, loop: false, prompts: ["One loud 30mm autocannon shot fired close by, sharp supersonic crack, powerful punchy boom, metallic breech clank, short echo off rocks."], seconds: 1.5 },
  "gun-empty": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0.05, maxVoices: 3, loop: false, prompts: ["A mounted heavy machine gun runs dry: two dry metallic clicks of the bolt, then a steel ammo box latch snaps open and the empty box drops onto a truck deck with a hollow clunk."], seconds: 1.2 },
  "hit-metal": { bus: "sfx", setup: "field", volume: 0.55, pitchJitter: 0.08, maxVoices: 6, loop: false, prompts: ["Bullet slams into a thick steel truck plate, hard metallic clang."], seconds: 0.6 },
  "miss": { bus: "sfx", setup: "field", volume: 0.4, pitchJitter: 0.1, maxVoices: 6, loop: false, prompts: ["Bullet ricochet whizzing off rocks and kicking up dirt."], seconds: 0.8 },
  "part-broken": { bus: "sfx", setup: "field", volume: 0.7, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["Truck part breaks apart, snapping metal, sparks and a short hiss of steam."], seconds: 1.2 },
  "explosion": { bus: "sfx", setup: "field", volume: 1, pitchJitter: 0.04, maxVoices: 2, loop: false, prompts: ["Truck fuel tank explodes, big fiery blast with falling metal debris."], seconds: 3 },
  // Generated horns come out thin and high. The files are generated takes run through ffmpeg
  // "asetrate=44100*0.55,aresample=44100,bass=g=8:f=120,volume=8dB,asoftclip=type=tanh" before import.
  // Air brakes are the one approved take, arrive-1790459643829.mp3, run through ffmpeg
  // "asetrate=44100*<rate>,aresample=44100,lowpass=f=1400:p=1,highpass=f=60,afade=t=in:d=0.12" at rates 0.88, 0.8 and 0.95 before import.
  "horn": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0, maxVoices: 4, loop: false, prompts: ["Mad Max war rig horn: a huge rusted diesel truck blasts its twin air horns once, a deep booming low chord, brassy, gritty and overdriven, heavy as a freight train. Vehicle horn only, no music."], seconds: 1.5 },
  "crash": { bus: "sfx", setup: "field", volume: 0.9, pitchJitter: 0.06, maxVoices: 2, loop: false, prompts: ["Two heavy steel trucks ram each other at speed: one hard, deep crunch of thick metal, a short scrape, then debris settling. Single impact."], seconds: 1.5 },

  // The harpoon. Generated takes came out thin, with a high whine. Fire takes are run through ffmpeg
  // "asetrate=44100*0.85,aresample=44100,lowpass=f=6000,lowpass=f=6000,bass=g=6:f=120", hook takes through
  // "lowpass=f=8000:p=1,bass=g=4:f=150" and tear takes through
  // "asetrate=44100*0.85,aresample=44100,lowpass=f=5000,lowpass=f=5000,bass=g=4:f=150" before import.
  "harpoon-fire": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["A heavy spring-loaded harpoon gun on a truck fires: a deep mechanical thunk and clank of steel, then a thick rope whipping out fast."], seconds: 1.2 },
  "harpoon-hook": { bus: "sfx", setup: "field", volume: 0.7, pitchJitter: 0.06, maxVoices: 2, loop: false, prompts: ["A heavy barbed steel harpoon bolt slams into a truck's steel plate: a hard punching clank and a short metallic scrape."], seconds: 0.8 },
  "line-tear": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["A thick steel tow cable under huge tension snaps: a sharp loud twang and whip, then the loose cable slapping on metal."], seconds: 1.2 },

  // Other utilities. A smoke shell landing and a Sprout both play smoke-burst. Generated oil takes came out as bright
  // hiss; they are run through ffmpeg "asetrate=44100*0.8,aresample=44100,lowpass=f=3000,lowpass=f=3000,bass=g=4:f=150"
  // before import, so they glug.
  "mortar-fire": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["A small smoke mortar fires from a truck deck: one deep hollow tube thoomp and a short metallic ring."], seconds: 1.2 },
  "smoke-burst": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["A smoke grenade canister bursts open: a short pop, then a loud rushing hiss of thick smoke pouring out."], seconds: 2 },
  "flare-fire": { bus: "sfx", setup: "field", volume: 0.7, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["A flare cannon fires a signal flare: a sharp hollow pop, then a fizzing hiss rising quickly into the sky."], seconds: 1.5 },
  "flare-burst": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0.04, maxVoices: 2, loop: false, prompts: ["A magnesium illumination flare ignites high in the air: a dull crack, then a steady crackling, sizzling burn."], seconds: 2 },
  "caltrops-drop": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0.06, maxVoices: 2, loop: false, prompts: ["A handful of heavy steel spikes dumped from a truck clatter and bounce onto hard gravel."], seconds: 1.2 },
  "caltrops-hit": { bus: "sfx", setup: "field", volume: 0.7, pitchJitter: 0.06, maxVoices: 3, loop: false, prompts: ["A truck tire runs over steel spikes and bursts: a loud pop and a fast rushing hiss of escaping air."], seconds: 1.2 },
  "oil-spill": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0.05, maxVoices: 2, loop: false, prompts: ["A valve opens under a truck and thick motor oil glugs and splashes onto dry dirt."], seconds: 2 },
  "emitter-pulse": { bus: "sfx", setup: "field", volume: 0.8, pitchJitter: 0.04, maxVoices: 2, loop: false, prompts: ["A huge electrical capacitor discharges outdoors: a violent arc crack and buzz, then nearby diesel engines sputter and die."], seconds: 2 },

  // Loops.
  // Engine recordings are assigned by chassis; pitch and level follow the truck's speed.
  "engine": { bus: "sfx", setup: "field", volume: 0.6, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Old heavy diesel truck engine running at steady medium revs, recorded close to the engine bay: clear exhaust note, mechanical clatter and valve tick, full and present, not muffled, seamless loop."], seconds: 4 },
  "wind": { bus: "ambient", setup: "field", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Dry desert wind blowing over open sand and rocks, steady, seamless loop."], seconds: 12 },
  "music-calm": { bus: "music", volume: 1, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Slow sparse post-apocalyptic desert road music, lonely twangy baritone guitar and low drone, 80 bpm, instrumental, seamless loop.", "Slow sparse desert ambient, dusty harmonica and distant slide guitar over a low drone, 70 bpm, instrumental, seamless loop.", "Quiet post-apocalyptic road ambient, soft muted electric guitar arpeggios and a low cello drone, 75 bpm, instrumental, seamless loop."], seconds: 90 },

  // Combat score: base loops, one per battle, and accents on the base beat grid. See SoundDesigner.
  "score-drums": { bus: "music", setup: "score", beat: { bpm: 90, bars: 8 }, volume: 0.9, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Seamless tribal war drum loop, 90 BPM in 4/4: huge pounding taiko and floor toms, heavy kick on every beat, rattling snare accents, relentless and even, no fills, no cymbals, drums only."] },
  "score-bass": { bus: "music", setup: "score", beat: { bpm: 110, bars: 8 }, volume: 0.8, pitchJitter: 0, maxVoices: 1, loop: true, prompts: ["Seamless bass guitar loop, 110 BPM in 4/4: fast driving eighth-note riff on D, gritty overdriven tone, chugging and relentless, even level, bass only, no drums."] },
  "accent-sighted": { bus: "music", setup: "stinger", volume: 0.85, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["Three heavy tribal war drum hits, boom boom boom, with a low Mongolian throat singing growl rising under them."], seconds: 1.5 },
  "accent-struck": { bus: "music", setup: "stinger", volume: 0.85, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["One distorted electric guitar power chord on D slammed with a big tribal drum hit, then a short falling throat singing groan."], seconds: 1.5 },
  "accent-miss": { bus: "music", setup: "stinger", volume: 0.75, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["A quick palm-muted distorted electric guitar chug and a tight snare flam, then silence."], seconds: 1 },
  "accent-hit": { bus: "music", setup: "stinger", volume: 1.3, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["One punchy distorted electric guitar power chord stab on D with a big tribal floor tom hit."], seconds: 1.5 },
  "accent-crit": { bus: "music", setup: "stinger", volume: 0.95, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["Two massive tribal war drum hits, a soaring distorted electric guitar power chord on D and a deep Mongolian throat singing shout."], seconds: 1.5 },
  "accent-crash": { bus: "music", setup: "stinger", volume: 1, pitchJitter: 0, maxVoices: 3, loop: false, prompts: ["A thundering tribal drum fill into a huge distorted electric guitar power chord on D ringing out, with a deep Mongolian throat singing drone swelling under it."], seconds: 1.5 },
} as const satisfies Record<string, CueDef>;

export type CueId = keyof typeof DEFS;

const ON_DISK = Object.keys(import.meta.glob("/public/sfx/*.ogg")).map((p) => p.split("/").pop()!);

export function filesOf(id: string, onDisk: string[]): string[] {
  return onDisk.filter((f) => new RegExp(`^${id}-\\d+\\.ogg$`).test(f)).sort((a, b) => variantNumber(a) - variantNumber(b));
}

function variantNumber(file: string): number {
  return Number(file.match(/-(\d+)\.ogg$/)![1]);
}

function withFiles(): Record<CueId, Cue> {
  const out = {} as Record<CueId, Cue>;
  for (const id of Object.keys(DEFS) as CueId[]) out[id] = { ...DEFS[id], files: filesOf(id, ON_DISK) };
  return out;
}

export const SOUNDS = withFiles();

// The three recordings cover light, medium and heavy chassis. A chassis keeps its note across turns.
const ENGINE_FILES: Record<string, string> = {
  scout: "engine-2.ogg",
  hauler: "engine-3.ogg",
  buggy: "engine-1.ogg",
  wagon: "engine-2.ogg",
  courier: "engine-1.ogg",
  van: "engine-2.ogg",
  longbed: "engine-3.ogg",
  carrier: "engine-3.ogg",
  tractor: "engine-3.ogg",
  jeep: "engine-1.ogg",
  convertible: "engine-2.ogg",
  bus: "engine-3.ogg",
  loader: "engine-3.ogg",
  lincoln: "engine-2.ogg",
  niva: "engine-1.ogg",
  bukhanka: "engine-2.ogg",
};

// Two recordings with fixed pitch profiles give each chassis a recognizable horn.
const HORN_SOUNDS: Record<string, { file: string; rate: number }> = {
  scout: { file: "horn-1.ogg", rate: 1 },
  hauler: { file: "horn-2.ogg", rate: 0.82 },
  buggy: { file: "horn-1.ogg", rate: 1.18 },
  wagon: { file: "horn-2.ogg", rate: 0.92 },
  courier: { file: "horn-2.ogg", rate: 1.18 },
  van: { file: "horn-1.ogg", rate: 0.92 },
  longbed: { file: "horn-2.ogg", rate: 1 },
  carrier: { file: "horn-1.ogg", rate: 0.82 },
  tractor: { file: "horn-2.ogg", rate: 1.08 },
  jeep: { file: "horn-1.ogg", rate: 1.08 },
  convertible: { file: "horn-2.ogg", rate: 1.28 },
  bus: { file: "horn-2.ogg", rate: 0.72 },
  loader: { file: "horn-1.ogg", rate: 0.72 },
  lincoln: { file: "horn-2.ogg", rate: 0.88 },
  niva: { file: "horn-1.ogg", rate: 1.28 },
  bukhanka: { file: "horn-1.ogg", rate: 0.88 },
};

export function hornSoundFor(chassisId: string): { file: string; rate: number } {
  const sound = HORN_SOUNDS[chassisId];
  if (!sound) throw new Error(`Unknown chassis ${chassisId}`);
  return sound;
}

// First-beat offset of each beat loop file, from scripts/sfx-phase.py. Layers start at these offsets, so their beats meet.
const SCORE_PHASES: Record<string, number> = {
  "score-drums-1.ogg": 0.014,
  "score-bass-1.ogg": 0.232,
};

export function scorePhaseOf(file: string): number {
  const phase = SCORE_PHASES[file];
  if (phase === undefined) throw new Error(`Beat loop ${file} has no phase; run scripts/sfx-phase.py`);
  return phase;
}

export function engineFileFor(chassisId: string): string {
  const file = ENGINE_FILES[chassisId];
  if (!file) throw new Error(`Unknown chassis ${chassisId}`);
  return file;
}

export const MIX = {
  busVolume: { ui: 0.8, sfx: 0.75, ambient: 0.6, music: 0.65 } satisfies Record<Bus, number>,
  // Import loudness per bus: the loudest 400 ms moment, in LUFS. Cue volume then sets each cue's place in the mix.
  level: { ui: -18, sfx: -14, ambient: -24, music: -18 } satisfies Record<Bus, number>,
  compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.25 },
  // Short open-air tail on the effects bus, generated as decaying noise.
  reverb: { seconds: 1.2, decay: 3, wet: 0.12 },
  // Gain halves at this many meters from the camera focus; pan reaches this share at the screen edge.
  halfGainMeters: 40,
  panWidth: 0.7,
  // Engine over a turn: playback rate and level follow speed in m/s, plus a load term from the speed change,
  // so speeding up revs and slowing drops audibly. Load is full at loadMs of change in one turn. Under movingMs
  // at both ends it stays silent; a speed drop of brakeMs or more adds the air brake. 24 m/s is the fastest chassis.
  // Overdrive multiplies the engine level by overdriveGain.
  engine: { idleRate: 0.8, topRate: 1.3, topSpeedMs: 31.2, idleGain: 0.5, loadMs: 3, revUp: 0.3, revDown: 0.2, loadGain: 0.3, movingMs: 0.5, brakeMs: 4, fadeSeconds: 0.12, overdriveGain: 1.5 },
  // Overdrive switching on revs the engine loop once: playback rate and level at each point, seconds from the start.
  // It jumps from idle to high revs, holds, and falls back as the throttle lets go.
  rev: [
    { at: 0, rate: 0.8, gain: 0 },
    { at: 0.05, rate: 0.85, gain: 0.8 },
    { at: 0.35, rate: 1.7, gain: 1.6 },
    { at: 0.6, rate: 1.75, gain: 1.6 },
    { at: 1.2, rate: 1, gain: 0.6 },
    { at: 1.5, rate: 0.9, gain: 0 },
  ],
  // Wind bed: a base level, rising near dust storms.
  wind: { baseGain: 0.4, stormGain: 1, stormReachTiles: 12, fadeSeconds: 1 },
  // Music crossfades to combat while the player is in combat, as the sim's combat state defines it.
  // Between turns, once no turn has played for pauseDelayMs, music is muffled to pauseCutoffHz over toneSeconds.
  // The delay keeps the short gaps between automatic turns clear.
  music: { fadeSeconds: 3, pauseDelayMs: 300, pauseCutoffHz: 4000, openCutoffHz: 20000, toneSeconds: 0.6 },
  // Combat score. One random base plays while the player is in combat. Heat is a fading sum of
  // event weights, halving every heatHalfLifeSeconds; a busy fight adds about 1 per turn. It sets the base level
  // and muffle each bar, full at fullHeat. Each event stabs on the lead or secondary line with its peak on the
  // event, and its rhythm's tail follows on the grid; see SoundDesigner. Rhythms have one character per half beat,
  // eight to a bar, counted from the stab: x is a hit. The base dips to duckGain under each lead hit and recovers
  // over duckReleaseBeats.
  score: {
    subdivision: 2,
    humanizeMs: 10,
    gainJitter: 0.1,
    heatHalfLifeSeconds: 8,
    fullHeat: 3,
    hotHeat: 2,
    quietGain: 0.65,
    quietCutoffHz: 1500,
    openCutoffHz: 20000,
    pauseRepeats: 1,
    fillChance: 0.2,
    fillGain: 0.5,
    secondaryPan: 0.3,
    busyFactor: 0.7,
    stabGapSeconds: 1.5,
    duckGain: 0.6,
    duckAttackSeconds: 0.05,
    duckReleaseBeats: 2,
    lines: {
      lead: { gain: 1, calm: ["x......."], hot: ["x...x...", "x.....x."] },
      secondary: { gain: 0.7, calm: ["x......."], hot: ["x...x...", "x.....x."] },
    },
    accents: {
      "accent-crash": { line: "lead", weight: 1, bars: 2, chance: 1 },
      "accent-crit": { line: "lead", weight: 0.8, bars: 1, chance: 1 },
      "accent-sighted": { line: "lead", weight: 0.6, bars: 1, chance: 1 },
      "accent-struck": { line: "lead", weight: 0.5, bars: 1, chance: 1 },
      "accent-hit": { line: "secondary", weight: 0.4, bars: 1, chance: 0.5 },
      "accent-miss": { line: "secondary", weight: 0.2, bars: 1, chance: 0.3 },
    },
  },
  // Approved reference cue per bus. The sound board plays it beside each candidate.
  anchors: { sfx: "cannon-fire" } as Partial<Record<Bus, CueId>>,
} as const;
