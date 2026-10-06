import type { ClaymoreDef, UtilityDef } from './parts';

// Utility parts: yellow deck parts with one job each. Active ones act once on an explicit order and then recharge
// for their reload in turns. The crane and the scraper are passive and work while mounted. Prices come from base plus
// the stat modifier in src/data/parts.ts, and each value sits in its tier's effort band. See src/sim/utility.ts.
export const UNPRICED_UTILITIES: Record<string, Omit<UtilityDef, 'value'>> = {
  sprout: {
    id: 'sprout',
    kind: 'utility',
    name: 'Sprout',
    hp: 25,
    base: 130,
    tier: 1,
    w: 1,
    h: 1,
    mass: 60,
    armor: 2,
    tall: false,
    reload: 10,
    effect: { type: 'sprout', radius: 5, turns: 6 }, // black smoke around the truck
  },
  caltrops: {
    id: 'caltrops',
    kind: 'utility',
    name: 'Caltrops',
    hp: 30,
    base: 87,
    tier: 1,
    w: 1,
    h: 1,
    mass: 70,
    armor: 3,
    tall: false,
    reload: 10,
    effect: { type: 'caltrops', radius: 1.25, turns: 10, behind: 1 },
  },
  oilSpiller: {
    id: 'oilSpiller',
    kind: 'utility',
    name: 'Oil spiller',
    hp: 30,
    base: 118,
    tier: 1,
    w: 1,
    h: 1,
    mass: 90,
    armor: 3,
    tall: false,
    reload: 6,
    effect: { type: 'oil', turns: 8, behind: 1, fuel: 2 }, // a streak of OIL.blobs patches, see OIL
  },
  patcherCrane: {
    id: 'patcherCrane',
    kind: 'utility',
    name: 'Patcher crane',
    hp: 50,
    base: 180,
    tier: 1,
    w: 1,
    h: 2,
    mass: 150,
    armor: 4,
    tall: false,
    reload: null,
    effect: { type: 'crane' }, // refits and roadside patches go faster, see WORK
  },
  smokeMortar: {
    id: 'smokeMortar',
    kind: 'utility',
    name: 'Smoke mortar',
    hp: 36,
    base: 263,
    tier: 2,
    w: 1,
    h: 2,
    mass: 110,
    armor: 3,
    tall: false,
    reload: 8,
    effect: { type: 'mortar', radius: 4, turns: 5, minRange: 5, maxRange: 16 },
  },
  flareCannon: {
    id: 'flareCannon',
    kind: 'utility',
    name: 'Flare cannon',
    hp: 28,
    base: 142,
    tier: 2,
    w: 1,
    h: 1,
    mass: 50,
    armor: 2,
    tall: false,
    reload: 10,
    effect: { type: 'flare', radius: 10, turns: 6, minRange: 4, maxRange: 24 }, // radius: the ground it lights
  },
  scrapersKnife: {
    id: 'scrapersKnife',
    kind: 'utility',
    name: "Scraper's knife",
    hp: 50,
    base: 280,
    tier: 2,
    w: 1,
    h: 2,
    mass: 170,
    armor: 4,
    tall: false,
    reload: null,
    effect: { type: 'scraper' }, // searches reveal more and strips yield more, see SEARCH and WORK
  },
  emitter: {
    id: 'emitter',
    kind: 'utility',
    name: 'Emitter',
    hp: 44,
    base: 728,
    tier: 3,
    w: 2,
    h: 2,
    mass: 200,
    armor: 4,
    tall: false,
    reload: 10,
    effect: { type: 'emitter', radius: 6, turns: 2 }, // every other truck in the radius shuts down for the turns
  },
};

// Smoke clouds. A shot whose line from shooter to target touches any cloud gets this spread cause, once.
export const SMOKE = {
  spread: 0.1, // radians
};

export const CALTROPS = {
  damage: 8, // to each of the four wheels of a truck that drives through, once per field
};

// One spill is a streak of `blobs` oil fields along the path behind the truck, `spacing` apart, so they overlap.
// Grip and kick were swept in src/phys/drive.test.ts with a scout crossing a real streak straight under its route
// driver, its heading off its dry run at the end of the turn. Kick 0.35 turned it under 1° at 10 tiles per turn, 0.7
// about 12° and 1.0 only 15-27° by where the streak lay. Kick 1.2 turns it 27-49° at 10 and 25-30° at 9; the cap of
// 1.6 is reached from 9.3 tiles per turn. Grip 0.3 barely let the swing grow, and grip 0.06 moved a 3 tiles per turn
// crossing 1 m off its line, against 0.38 m at 0.12. No kick rolled a truck: its up vector stayed level.
export const OIL = {
  blobs: 6, // oil fields per spill
  blobR: 0.9, // tiles, the radius of each field
  spacing: 0.8, // tiles along the path between field centers
  grip: 0.12, // share of friction slip and side friction stiffness left to a wheel on oil
  safeSpeed: 4, // tiles per turn; at or below it oil gives no tail kick
  kick: 1.2, // rad/s of yaw rate change for each safeSpeed of speed above safeSpeed, when a rear wheel first reaches oil
  maxKick: 1.6, // rad/s, the cap on one tail kick
};

// Tiles from one end of a spill's streak to the other, on a straight path.
export function oilSlickLength(): number {
  return (OIL.blobs - 1) * OIL.spacing + 2 * OIL.blobR;
}

// The harpoon line: a one-sided spring between the two anchors once they are farther apart than the line's length.
// Settled in src/phys/line.test.ts at 60 steps per second. Only the stretch pull counts toward a tear. The peak
// stretch pull over 3 turns: a scout fleeing at full throttle from a parked scout 15 kN, the same scout already at
// speed when the line goes taut 26 kN, and from a parked hauler 31 kN; a hauler dragging a braking scout 38 kN and
// more at speed. So a line holds a truck of the target's own size for its turns, and a much stronger truck tears it.
// Stiffer 10000 with damping 2000 jerked a scout at speed to 72 kN, so no tear force held a fleeing truck.
export const HARPOON = {
  stiffness: 5000, // N per meter of stretch
  damping: 4000, // N·s per meter on the separating speed
  tearForce: 36000, // N; a stretch pull above it tears the line
  tearDamage: 12, // to the part the line held on the torn truck
};

export const EMITTER = {
  startsAfter: 1, // turns after the pulse the shutdown starts, so no shot fired with the pulse is lost
};

export const FLARE = {
  seenRange: 80, // tiles; how far a flare and its launch show at night, gray vision at day sight
};

// The claymore ram's charge. See ClaymoreDef in src/data/parts.ts.
export const CLAYMORE: ClaymoreDef = {
  minImpact: 3, // tiles per turn
  blast: { damage: 60, pen: 12, radius: 2 }, // radius in meters
  selfBlast: { damage: 25, pen: 6 },
  reload: 20,
};

// Field work. Refits and roadside patches take noCraneTime times as long as before, and a working crane speeds that
// work up by craneSpeed. A working scraper pays scraperStripShare of a stripped part's value.
export const WORK = {
  noCraneTime: 2,
  craneSpeed: 1.5,
  scraperStripShare: 0.65,
};

// Hidden salvage. Each search turn, each hidden unit is revealed with this chance, or scraperReveal with a working
// scraper.
export const SEARCH = {
  reveal: 0.35,
  scraperReveal: 0.55,
};
