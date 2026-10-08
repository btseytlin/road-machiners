// NPC vehicle templates and how often they appear.

import type { Faction, StateKindId } from '../sim/types';
import { RULES } from './rules';
import { START_KITS } from './start';

// NPCs begin with the player's upkeep budget. Their fuel is capped by their chassis. A spawned driver's wallet is its
// template's money instead; this one is for trucks made outside spawning, like test and harness trucks.
export const NPC_RESOURCES = {
  money: START_KITS.standard.money,
  fuel: START_KITS.standard.fuel,
  supplies: START_KITS.standard.supplies,
};

export type TraitId = 'trader' | 'scavenger' | 'raider' | 'scumbag' | 'coward' | 'lawman' | 'courier' | 'roamer' | 'vulture' | 'supplier' | 'guard' | 'merc' | 'brave';

export type Weighted<T> = { value: T; weight: number };
export type CargoRoll = { good: string; count: number };
// Spare parts a driver carries loose, not mounted. `count` rolls how many it tries to fit, and each roll of
// `pool` picks a part or null for an empty slot. Grid room and rated mass cap how many actually fit.
export type SpareTable = { pool: Weighted<string | null>[]; count: Weighted<number>[] };
// How well a driver is equipped. Each NPC rolls one at spawn from its template's `levels`; see GEAR_LEVELS.
export type GearLevel = 'poor' | 'light' | 'standard' | 'heavy' | 'loaded';
export const GEAR_LEVEL_IDS: readonly GearLevel[] = ['poor', 'light', 'standard', 'heavy', 'loaded'];
export type NpcLoadoutTable = {
  budget: number; // chassis and mounted parts at the standard level, separate from the driver's upkeep wallet
  levels: Weighted<GearLevel>[];
  chassis: Weighted<string>[];
  engine: Weighted<string>[];
  weapon: Weighted<string>[]; // the main gun, which every driver gets
  extraGun: Weighted<string>[]; // guns the driver may add past the main one
  priorities: LoadoutPriorities;
  armor: Weighted<string>[]; // armor the driver may cover a side with, one type per side
  cargoPart: Weighted<string | null>[];
  goods: Weighted<CargoRoll | null>[];
  spares: SpareTable | null; // loose parts a driver carries to sell; null for none
  // Bands the averages over many rolls must stay in: guns per truck, and the share of chassis edge cells armored.
  targets: { guns: [number, number]; armor: [number, number] };
};

// What a template's spawn gear favours, each weight from 0 to PRIORITY_TOP. speed sets the share of its unloaded speed
// the truck keeps after guns, armor and cargo: SPEED_SHARE.low at 0, SPEED_SHARE.high at the top weight. An NPC takes
// no loot, purchase or spare part past that share either. firepower and armor weigh the guns and the toughness in the
// driver's judgement of a fight, and cargo how much it needs room for its biggest load. See src/sim/npc-gear-score.ts.
export type LoadoutPriorities = { speed: number; firepower: number; armor: number; cargo: number };
export const PRIORITY_TOP = 3;
export const SPEED_SHARE = { low: 0.4, high: 0.6 };

// Every NPC truck spawns at least this fast on its worn engine with its gear: twice a crawl. A gunwagon is a slow
// fortress, but a truck barely faster than a crawl could not patrol, chase or reach a stranded driver. The engine and
// its wear are rolled first, and the build keeps to the engines and guns that hold this speed.
export const MIN_NPC_SPEED = RULES.limpSpeed * 2;

// A spawning driver picks gear one step at a time: it keeps the first GEAR_DRAWS steps, in a random order weighted by
// pool weight, that improve its truck, and takes the one that gains the most for the money and mass it uses, or with
// GEAR_WHIM odds a random one of them. See pickGear() in src/sim/npc-loadout.ts.
export const GEAR_DRAWS = 3;
export const GEAR_WHIM = 0.1;
// Extra guns stop before their power draw slows the truck by more than this share, see gunDrag() in
// src/sim/stats.ts. A stronger engine carries more guns.
export const MAX_GUN_SLOWDOWN = 0.35;
// The top speed, in crawls, of the attacker a spawning driver expects. At this speed the driver and the attacker are
// even odds to be the faster. NPC trucks spawn at a median of about 4 crawls. See gearScore() in
// src/sim/npc-gear-score.ts.
export const GEAR_THREAT_SPEED = 4;

// What each gear level gets. budget multiplies the template budget. wearShift moves every wear roll, clamped to
// CONDITION.maxWear. cargo multiplies the goods and spares counts. Passes stop early when the budget, mass or grid
// room runs out, so a poor truck carries less of everything.
export const GEAR_LEVELS: Record<GearLevel, { budget: number; wearShift: number; cargo: number }> = {
  poor: { budget: 0.6, wearShift: 1, cargo: 0.5 },
  light: { budget: 0.85, wearShift: 0, cargo: 0.75 },
  standard: { budget: 1.15, wearShift: 0, cargo: 1 },
  heavy: { budget: 1.6, wearShift: 0, cargo: 1 },
  loaded: { budget: 2.4, wearShift: 0, cargo: 1.5 },
};

// Light guns a driver may add past its main gun. The mgs and the gatling turn all round, so they cover the rear.
const LIGHT_GUNS: Weighted<string>[] = [
  { value: "mg", weight: 3 },
  { value: "heavyMg", weight: 2 },
  { value: "gatling", weight: 1 },
  { value: "shotgun", weight: 2 },
  { value: "flamer", weight: 1 },
  { value: "longRifle", weight: 1 },
  { value: "slugCannon", weight: 1 },
];

// Long-range guns for drivers who keep their distance.
const LONG_GUNS: Weighted<string>[] = [
  { value: "longRifle", weight: 3 },
  { value: "slugCannon", weight: 2 },
  { value: "battleRifle", weight: 1 },
];

// The wear step of every part an NPC spawns with, mounted or spare, before its gear level's shift. Three parts in four
// are one step from junk and none are better than two steps worn, so loot off a beaten truck sells near scrap and good
// gear is bought. Values stay within CONDITION.maxWear, so a freshly spawned NPC never carries junk.
// The armor any driver can bolt on, one cell at a time. It covers the edge cells a template's own armor leaves bare.
export const SCRAP_ARMOR = 'scrapSheet';

export const NPC_WEAR: Weighted<number>[] = [
  { value: 2, weight: 1 },
  { value: 3, weight: 3 },
  { value: 4, weight: 12 },
];

// A trader's spare stock: mostly nothing, sometimes a gun, some armor plate or a rack it picked up cheap.
const TRADER_SPARES: SpareTable = {
  pool: [
    { value: null, weight: 3 },
    { value: "mg", weight: 2 },
    { value: "shotgun", weight: 1 },
    { value: "longRifle", weight: 1 },
    { value: "scrapPanels", weight: 2 },
    { value: "flatFour", weight: 1 },
    { value: "rack", weight: 1 },
  ],
  count: [
    { value: 0, weight: 2 },
    { value: 1, weight: 4 },
    { value: 2, weight: 3 },
    { value: 3, weight: 1 },
  ],
};

// Where a template's drivers appear. camp: a gate of a camp its traits know. town: a gate of any town or non-camp
// location. sites: a gate of one of the listed sites. escort: beside a new driver of the template `of`, never on
// its own timer.
export type SpawnPlace = { kind: 'camp' } | { kind: 'town' } | { kind: 'sites'; ids: string[] } | { kind: 'escort'; of: string };

export type NpcTemplate = {
  id: string;
  name: string;
  profession: string; // the noun texts put before the driver's name
  faction: Faction;
  traits: TraitId[]; // every NPC of the template has these
  extraTraits: { trait: TraitId; chance: number }[]; // each rolled once at spawn
  loadout: NpcLoadoutTable;
  aggroRange: number; // raiders pick targets inside this range
  // hold: drives to the best spot and parks there while the target stays parked. circle: keeps driving around the
  // target. See the fight driving in src/sim/ai.ts.
  fightStyle: 'hold' | 'circle';
  money: number; // the starting wallet
  cap: number; // max alive at once
  interval: number; // turns between spawn attempts
  spawn: SpawnPlace;
};

// Patrol cars carry heavy guns and always some armor, a step above traders and close to a raider gunwagon.
const LAW_ENGINES: Weighted<string>[] = [
  { value: "stockEngine", weight: 4 },
  { value: "tunedEngine", weight: 3 },
  { value: "workhorseDiesel", weight: 2 },
];
const LAW_WEAPONS: Weighted<string>[] = [
  { value: "cannon", weight: 5 },
  { value: "autocannon", weight: 4 },
  { value: "tankGun", weight: 2 },
  { value: "rocketRack", weight: 1 },
  { value: "heavyMg", weight: 3 },
  { value: "battleRifle", weight: 2 },
  { value: "recoilless", weight: 1 },
  { value: "amRifle", weight: 1 },
];
const LAW_ARMOR: Weighted<string>[] = [
  { value: "plates", weight: 6 },
  { value: "spacedArmor", weight: 3 },
  { value: "reinforcedCage", weight: 2 },
  { value: "ceramicPlates", weight: 1 },
];
const NO_GOODS: Weighted<CargoRoll | null>[] = [{ value: null, weight: 1 }];
const MOSTLY_NO_CARGO_PART: Weighted<string | null>[] = [
  { value: null, weight: 6 },
  { value: "rack", weight: 1 },
];

const LOADOUTS: Record<string, NpcLoadoutTable> = {
  outrider: {
    budget: 4100,
    levels: [{ value: "standard", weight: 4 }, { value: "heavy", weight: 2 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "buggy", weight: 6 },
      { value: "courier", weight: 3 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 1 },
      { value: "jeep", weight: 3 }, { value: "niva", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 6 },
      { value: "flatFour", weight: 4 },
      { value: "tunedEngine", weight: 2 },
      { value: "racingV6", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 6 },
      { value: "shotgun", weight: 5 },
      { value: "autocannon", weight: 2 },
      { value: "rocketRack", weight: 1 },
      { value: "cannon", weight: 2 },
      { value: "flamer", weight: 2 },
      { value: "pneumobolter", weight: 1 },
      { value: "slugCannon", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 3, firepower: 3, armor: 3, cargo: 1 },
    armor: [
      { value: "cage", weight: 5 },
      { value: "ceramicTile", weight: 2 },
      { value: "scrapPanels", weight: 2 },
      { value: "ram", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 6 },
      { value: "panniers", weight: 2 },
      { value: "rack", weight: 1 },
    ],
    goods: [
      { value: null, weight: 4 },
      { value: { good: "scrap", count: 1 }, weight: 4 },
      { value: { good: "textiles", count: 2 }, weight: 2 },
      { value: { good: "electronics", count: 1 }, weight: 1 },
    ],
    targets: { guns: [1.85, 2.85], armor: [0.2, 0.35] },
    spares: null,
  },
  // No tractor: it has no spot where a second gun covers behind the truck. The scout has one beside its cab, but no room for the heavy guns.
  gunwagon: {
    budget: 6900,
    levels: [{ value: "standard", weight: 4 }, { value: "heavy", weight: 2 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "wagon", weight: 6 },
      { value: "carrier", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "loader", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 5 },
      { value: "tunedEngine", weight: 4 },
      { value: "workhorseDiesel", weight: 1 },
      { value: "heavyDiesel", weight: 1 },
      { value: "turbine", weight: 1 },
    ],
    weapon: [
      { value: "cannon", weight: 6 },
      { value: "tankGun", weight: 3 },
      { value: "autocannon", weight: 3 },
      { value: "rocketRack", weight: 2 },
      { value: "sniperCannon", weight: 1 },
      { value: "grenadeLauncher", weight: 2 },
      { value: "recoilless", weight: 2 },
      { value: "gatling", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 0, firepower: 3, armor: 3, cargo: 0 },
    armor: [
      { value: "plates", weight: 6 },
      { value: "spacedArmor", weight: 3 },
      { value: "reinforcedCage", weight: 3 },
      { value: "plowRam", weight: 2 }, { value: "claymoreRam", weight: 1 }, // the claymore is a ram with a charge
      { value: "ceramicPlates", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 6 },
      { value: "rack", weight: 2 },
      { value: "flatbed", weight: 1 },
    ],
    goods: [
      { value: null, weight: 3 },
      { value: { good: "scrap", count: 3 }, weight: 4 },
      { value: { good: "tools", count: 2 }, weight: 2 },
      { value: { good: "batteries", count: 2 }, weight: 2 },
      { value: { good: "electronics", count: 2 }, weight: 1 },
    ],
    targets: { guns: [2.15, 3.25], armor: [0.4, 0.7] },
    spares: null,
  },
  trader: {
    budget: 7300,
    levels: [{ value: "poor", weight: 1 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "hauler", weight: 6 },
      { value: "longbed", weight: 3 },
      { value: "van", weight: 4 },
      { value: "tractor", weight: 1 },
      { value: "scout", weight: 2 },
      { value: "bus", weight: 2 }, { value: "bukhanka", weight: 2 },
    ],
    engine: [
      { value: "stockEngine", weight: 4 },
      { value: "workhorseDiesel", weight: 6 },
      { value: "heavyDiesel", weight: 2 },
      { value: "flatFour", weight: 2 },
      { value: "racingV6", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 6 },
      { value: "shotgun", weight: 4 },
      { value: "autocannon", weight: 1 },
      { value: "slugCannon", weight: 1 },
      { value: "heavyMg", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
    armor: [
      { value: "plates", weight: 4 },
      { value: "cage", weight: 3 },
      { value: "scrapPanels", weight: 3 },
      { value: "ceramicPlates", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 1 },
      { value: "trailerBox", weight: 6 },
      { value: "flatbed", weight: 4 },
      { value: "lightFrame", weight: 2 },
      { value: "enclosedFrame", weight: 2 },
      { value: "heavyFrame", weight: 1 },
    ],
    goods: [
      { value: null, weight: 1 },
      { value: { good: "grain", count: 10 }, weight: 5 },
      { value: { good: "salt", count: 10 }, weight: 4 },
      { value: { good: "textiles", count: 8 }, weight: 4 },
      { value: { good: "tools", count: 6 }, weight: 2 },
      { value: { good: "batteries", count: 6 }, weight: 2 },
      { value: { good: "meds", count: 4 }, weight: 2 },
      { value: { good: "electronics", count: 4 }, weight: 1 },
    ],
    targets: { guns: [2.65, 4.05], armor: [0.4, 0.7] },
    spares: TRADER_SPARES,
  },
  scavenger: {
    budget: 4700,
    levels: [{ value: "poor", weight: 2 }, { value: "light", weight: 4 }, { value: "standard", weight: 2 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "scout", weight: 6 },
      { value: "van", weight: 3 },
      { value: "courier", weight: 2 },
      { value: "buggy", weight: 2 },
      { value: "hauler", weight: 1 },
      { value: "jeep", weight: 2 }, { value: "niva", weight: 2 }, { value: "bukhanka", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 6 },
      { value: "flatFour", weight: 5 },
      { value: "workhorseDiesel", weight: 3 },
      { value: "tunedEngine", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 5 },
      { value: "shotgun", weight: 6 },
      { value: "autocannon", weight: 1 },
      { value: "cannon", weight: 1 },
      { value: "longRifle", weight: 2 },
      { value: "flamer", weight: 1 },
      { value: "slugCannon", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
    armor: [
      { value: "scrapPanels", weight: 5 },
      { value: "cage", weight: 4 },
      { value: "reinforcedCage", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 1 },
      { value: "rack", weight: 5 },
      { value: "panniers", weight: 4 },
      { value: "flatbed", weight: 3 },
      { value: "lightFrame", weight: 1 },
    ],
    goods: [
      { value: null, weight: 2 },
      { value: { good: "scrap", count: 3 }, weight: 6 },
      { value: { good: "tools", count: 1 }, weight: 2 },
      { value: { good: "batteries", count: 1 }, weight: 2 },
      { value: { good: "electronics", count: 1 }, weight: 1 },
    ],
    targets: { guns: [2, 3.1], armor: [0.2, 0.4] },
    spares: null,
  },
  // Bowl Farmers drive farm chassis.
  bowlPatrol: {
    budget: 7700,
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 1 }],
    chassis: [
      { value: "tractor", weight: 5 },
      { value: "hauler", weight: 4 },
      { value: "loader", weight: 2 },
    ],
    engine: LAW_ENGINES,
    weapon: LAW_WEAPONS,
    extraGun: LIGHT_GUNS,
    priorities: { speed: 0, firepower: 3, armor: 3, cargo: 0 },
    armor: LAW_ARMOR,
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    targets: { guns: [2.5, 3.8], armor: [0.5, 0.85] },
    spares: null,
  },
  // The Nose Army drives wagons and carriers.
  nosePatrol: {
    budget: 7900,
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 1 }],
    chassis: [
      { value: "wagon", weight: 5 },
      { value: "carrier", weight: 4 },
    ],
    engine: LAW_ENGINES,
    weapon: LAW_WEAPONS,
    extraGun: LIGHT_GUNS,
    priorities: { speed: 0, firepower: 3, armor: 3, cargo: 0 },
    armor: LAW_ARMOR,
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    targets: { guns: [2.55, 3.85], armor: [0.5, 0.85] },
    spares: null,
  },
  // Light and fast. A courier carries a few small valuables and little armor.
  courier: {
    budget: 4000,
    levels: [{ value: "poor", weight: 3 }, { value: "light", weight: 4 }, { value: "standard", weight: 2 }],
    chassis: [
      { value: "courier", weight: 5 },
      { value: "buggy", weight: 4 },
      { value: "scout", weight: 3 },
      { value: "convertible", weight: 3 },
    ],
    engine: [
      { value: "flatFour", weight: 5 },
      { value: "tunedEngine", weight: 3 },
      { value: "stockEngine", weight: 3 },
      { value: "racingV6", weight: 1 },
    ],
    weapon: [
      { value: "mg", weight: 6 },
      { value: "shotgun", weight: 3 },
      { value: "longRifle", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 3, firepower: 1, armor: 3, cargo: 2 },
    armor: [
      { value: "cage", weight: 4 },
      { value: "ceramicTile", weight: 1 },
      { value: "scrapPanels", weight: 1 },
    ],
    cargoPart: [
      { value: null, weight: 2 },
      { value: "panniers", weight: 4 },
      { value: "rack", weight: 2 },
    ],
    goods: [
      { value: null, weight: 3 },
      { value: { good: "electronics", count: 2 }, weight: 2 },
      { value: { good: "meds", count: 2 }, weight: 2 },
    ],
    targets: { guns: [2.05, 3.1], armor: [0.15, 0.3] },
    spares: null,
  },
  // A roamer's rig is a scavenger's, a bit better kept.
  roamer: {
    budget: 4600,
    levels: [{ value: "poor", weight: 2 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "scout", weight: 5 },
      { value: "van", weight: 3 },
      { value: "buggy", weight: 2 },
      { value: "courier", weight: 1 },
      { value: "convertible", weight: 1 },
      { value: "jeep", weight: 1 }, { value: "niva", weight: 2 },
    ],
    engine: [
      { value: "stockEngine", weight: 5 },
      { value: "flatFour", weight: 4 },
      { value: "workhorseDiesel", weight: 2 },
    ],
    weapon: [
      { value: "mg", weight: 5 },
      { value: "shotgun", weight: 5 },
      { value: "autocannon", weight: 1 },
      { value: "longRifle", weight: 1 },
      { value: "pneumobolter", weight: 1 },
      { value: "battleRifle", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 2, firepower: 1, armor: 3, cargo: 2 },
    armor: [
      { value: "scrapPanels", weight: 4 },
      { value: "cage", weight: 3 },
    ],
    cargoPart: [
      { value: null, weight: 1 },
      { value: "rack", weight: 4 },
      { value: "panniers", weight: 3 },
      { value: "flatbed", weight: 2 },
    ],
    goods: [
      { value: null, weight: 3 },
      { value: { good: "scrap", count: 2 }, weight: 4 },
      { value: { good: "textiles", count: 2 }, weight: 2 },
      { value: { good: "tools", count: 1 }, weight: 1 },
    ],
    targets: { guns: [2.05, 3.15], armor: [0.2, 0.35] },
    spares: null,
  },
  // A vulture picks its way along lonely roads with a long gun, plates and cargo packs, and never rolls without a
  // cargo part. Its guns all reach 15 tiles or more, so it shoots from beyond most drivers' range.
  vulture: {
    budget: 7500,
    levels: [{ value: "poor", weight: 1 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "scout", weight: 4 },
      { value: "van", weight: 4 },
      { value: "jeep", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "longbed", weight: 1 }, { value: "bukhanka", weight: 2 },
    ],
    engine: [
      { value: "stockEngine", weight: 5 },
      { value: "flatFour", weight: 4 },
      { value: "workhorseDiesel", weight: 3 },
    ],
    weapon: [
      { value: "longRifle", weight: 6 },
      { value: "slugCannon", weight: 3 },
      { value: "battleRifle", weight: 2 },
      { value: "recoilless", weight: 1 },
      { value: "amRifle", weight: 1 },
      { value: "sniperCannon", weight: 0.3 },
    ],
    extraGun: [...LONG_GUNS, { value: "mg", weight: 1 }, { value: "shotgun", weight: 1 }],
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
    armor: [
      { value: "plates", weight: 4 },
      { value: "scrapPanels", weight: 4 },
      { value: "cage", weight: 2 },
    ],
    cargoPart: [
      { value: "panniers", weight: 5 },
      { value: "rack", weight: 3 },
      { value: "flatbed", weight: 2 },
      { value: "lightFrame", weight: 1 },
      { value: "trailerBox", weight: 1 },
    ],
    goods: [
      { value: null, weight: 2 },
      { value: { good: "scrap", count: 3 }, weight: 6 },
      { value: { good: "parts", count: 1 }, weight: 2 },
      { value: { good: "tools", count: 1 }, weight: 2 },
      { value: { good: "batteries", count: 1 }, weight: 2 },
    ],
    targets: { guns: [2.25, 3.4], armor: [0.5, 0.8] },
    spares: null,
  },
  // A convoy is a big truck that always carries a cargo part, since it hauls for a living. Its guard does the
  // fighting, so its own gun stays light.
  convoy: {
    budget: 7500,
    levels: [{ value: "light", weight: 2 }, { value: "standard", weight: 4 }, { value: "heavy", weight: 2 }],
    chassis: [
      { value: "hauler", weight: 6 },
      { value: "longbed", weight: 3 },
      { value: "bus", weight: 2 },
    ],
    engine: [
      { value: "workhorseDiesel", weight: 6 },
      { value: "heavyDiesel", weight: 3 },
      { value: "stockEngine", weight: 2 },
    ],
    weapon: [
      { value: "mg", weight: 6 },
      { value: "shotgun", weight: 3 },
      { value: "heavyMg", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
    armor: [
      { value: "plates", weight: 3 },
      { value: "cage", weight: 2 },
      { value: "scrapPanels", weight: 2 },
    ],
    cargoPart: [
      { value: "trailerBox", weight: 5 },
      { value: "flatbed", weight: 3 },
      { value: "enclosedFrame", weight: 2 },
      { value: "heavyFrame", weight: 1 },
    ],
    goods: [
      { value: null, weight: 3 },
      { value: { good: "fuelDrums", count: 6 }, weight: 1 },
      { value: { good: "water", count: 6 }, weight: 1 },
    ],
    targets: { guns: [3.65, 5.55], armor: [0.55, 0.85] },
    spares: null,
  },
  // A guard is quick enough to keep up with its convoy and armed to fight for it.
  convoyGuard: {
    budget: 5200,
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 3 }, { value: "loaded", weight: 1 }],
    chassis: [
      { value: "scout", weight: 4 },
      { value: "van", weight: 3 },
      { value: "wagon", weight: 2 },
      { value: "buggy", weight: 2 },
    ],
    engine: [
      { value: "stockEngine", weight: 4 },
      { value: "tunedEngine", weight: 3 },
      { value: "workhorseDiesel", weight: 2 },
      { value: "flatFour", weight: 2 },
    ],
    weapon: [
      { value: "autocannon", weight: 4 },
      { value: "mg", weight: 4 },
      { value: "cannon", weight: 2 },
      { value: "shotgun", weight: 2 },
      { value: "heavyMg", weight: 3 },
      { value: "battleRifle", weight: 2 },
      { value: "recoilless", weight: 1 },
    ],
    extraGun: LIGHT_GUNS,
    priorities: { speed: 1, firepower: 3, armor: 2, cargo: 0 },
    armor: [
      { value: "plates", weight: 4 },
      { value: "cage", weight: 3 },
      { value: "scrapPanels", weight: 2 },
      { value: "reinforcedCage", weight: 1 },
    ],
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    targets: { guns: [2.6, 3.9], armor: [0.4, 0.65] },
    spares: null,
  },
  // A merc sells its guns, so it spends its budget on weapons and armor, not cargo.
  merc: {
    budget: 6900,
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 2 }],
    chassis: [
      { value: "wagon", weight: 4 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 2 },
      { value: "carrier", weight: 1 }, { value: "lincoln", weight: 2 },
    ],
    engine: [
      { value: "tunedEngine", weight: 3 },
      { value: "workhorseDiesel", weight: 3 },
      { value: "heavyDiesel", weight: 2 },
      { value: "stockEngine", weight: 2 },
      { value: "racingV6", weight: 1 },
    ],
    weapon: [
      { value: "cannon", weight: 4 },
      { value: "autocannon", weight: 4 },
      { value: "rocketRack", weight: 2 },
      { value: "sniperCannon", weight: 1 },
      { value: "tankGun", weight: 1 },
      { value: "heavyMg", weight: 3 },
      { value: "battleRifle", weight: 2 },
      { value: "amRifle", weight: 1 },
      { value: "gatling", weight: 1 },
      { value: "flechette", weight: 1 },
      { value: "grenadeLauncher", weight: 1 },
    ],
    // The rare empty outcome covers a wagon whose heavy gun leaves no rated mass for plates.
    extraGun: LIGHT_GUNS,
    priorities: { speed: 1, firepower: 3, armor: 2, cargo: 0 },
    armor: [
      { value: "plates", weight: 5 },
      { value: "spacedArmor", weight: 3 },
      { value: "reinforcedCage", weight: 3 },
      { value: "ram", weight: 1 },
      { value: "ceramicPlates", weight: 1 },
    ],
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    targets: { guns: [2.8, 4.3], armor: [0.5, 0.85] },
    spares: null,
  },
};

// Traits rolled on top of a template's own. One neutral driver in four is a scumbag, and one in four a coward. Both
// can meet in one driver. One neutral driver or raider in seven is brave, unless it rolled coward. Lawmen and
// convoy guards are always brave. A convoy or its guard can be a scumbag, which makes it bold and quick to retaliate,
// but its trait still forbids robbing. Lawmen roll no extras, since they keep the peace.
const NEUTRAL_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'scumbag', chance: 0.25 }, { trait: 'coward', chance: 0.25 }, { trait: 'brave', chance: 0.15 }];
// Most vultures run from a fight, and a few are scumbags who rob a weak truck.
const VULTURE_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'coward', chance: 0.6 }, { trait: 'scumbag', chance: 0.35 }, { trait: 'brave', chance: 0.1 }];
const RAIDER_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'brave', chance: 0.15 }];
const GUARD_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'scumbag', chance: 0.25 }];

// Pairs of traits one driver never holds together. A rolled extra that opposes a trait the driver already holds
// is dropped.
export const OPPOSED_TRAITS: readonly [TraitId, TraitId][] = [['coward', 'brave']];

export const NPCS: Record<string, NpcTemplate> = {
  buggy: {
    id: 'buggy', name: 'Raider outrider', profession: 'Raider', faction: 'raiders', traits: ['raider'], extraTraits: RAIDER_EXTRAS,
    loadout: LOADOUTS.outrider,
    aggroRange: 11,
    fightStyle: 'circle',
    money: NPC_RESOURCES.money,
    cap: 6,
    // A camp regains one buggy every 50 turns, so a fully cleared camp is back to its cap of 6 in
    // about 300 turns, one full day (TIME.turnsPerDay), not the few minutes 8 turns gave.
    interval: 50,
    spawn: { kind: "camp" },
  },
  gunwagon: {
    id: 'gunwagon', name: 'Gunwagon', profession: 'Raider', faction: 'raiders', traits: ['raider'], extraTraits: RAIDER_EXTRAS,
    loadout: LOADOUTS.gunwagon,
    aggroRange: 12,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 2,
    // Same day-long refill as the outrider camp: cap 2 at 150 turns apart is back to full in 300 turns.
    interval: 150,
    spawn: { kind: "camp" },
  },
  trader: {
    id: 'trader', name: 'Trader caravan', profession: 'Trader', faction: 'traders', traits: ['trader'],
    // One trader in four is a scumbag, and one in four a coward, as with every neutral driver.
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.trader,
    aggroRange: 0,
    fightStyle: 'hold',
    // Traders start with working capital, so a load is worth robbing. Their trade stake keeps a reserve, so one
    // robbery does not ruin them. Eight traders keep the roads busy enough that a robber meets a target every few
    // hours.
    money: 4000,
    cap: 8,
    interval: 12,
    spawn: { kind: "town" },
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', profession: 'Scavenger', faction: 'scavengers', traits: ['scavenger'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.scavenger,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 4,
    interval: 12,
    spawn: { kind: "town" },
  },
  bowlFarmer: {
    id: 'bowlFarmer', name: 'Bowl Farmers patrol', profession: 'Bowl Farmer', faction: 'bowl', traits: ['lawman', 'brave'], extraTraits: [],
    loadout: LOADOUTS.bowlPatrol,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // Three cars keep the Bowl approaches watched. A lost car comes back in 70 turns, so a full patrol is back in
    // about one day.
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["bowl"] },
  },
  noseArmy: {
    id: 'noseArmy', name: 'Nose Army patrol', profession: 'Nose soldier', faction: 'nose', traits: ['lawman', 'brave'], extraTraits: [],
    loadout: LOADOUTS.nosePatrol,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // Same size and refill as the Bowl patrol.
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["nose"] },
  },
  courier: {
    id: 'courier', name: 'Courier', profession: 'Courier', faction: 'couriers', traits: ['courier'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.courier,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // Couriers are cheap, fast traffic. A lost one is replaced in 30 turns, a few hours of the day.
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  roamer: {
    id: 'roamer', name: 'Roamer', profession: 'Roamer', faction: 'roamers', traits: ['roamer'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.roamer,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // Same count and refill as couriers.
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  vulture: {
    id: 'vulture', name: 'Vulture', profession: 'Vulture', faction: 'vultures', traits: ['vulture'],
    extraTraits: VULTURE_EXTRAS,
    loadout: LOADOUTS.vulture,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // Same count and refill as couriers and roamers.
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  convoy: {
    id: 'convoy', name: 'Supply convoy', profession: 'Convoy driver', faction: 'convoys', traits: ['supplier'], extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.convoy,
    aggroRange: 0,
    fightStyle: 'hold',
    // Convoys carry the supply runs' takings. A side trade spends their trade stake.
    money: 4000,
    // Two big trucks with a guard each. A lost convoy is replaced in 100 turns, half a day.
    cap: 2,
    interval: 100,
    spawn: { kind: "sites", ids: ["bowl", "nose"] },
  },
  convoyGuard: {
    id: 'convoyGuard', name: 'Convoy guard', profession: 'Convoy guard', faction: 'convoys', traits: ['guard', 'brave'], extraTraits: GUARD_EXTRAS,
    loadout: LOADOUTS.convoyGuard,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // One guard per convoy. It spawns only beside a new convoy, so its interval never runs.
    cap: 2,
    interval: 100,
    spawn: { kind: "escort", of: "convoy" },
  },
  merc: {
    id: 'merc', name: 'Merc', profession: 'Merc', faction: 'mercs', traits: ['merc'], extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.merc,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    // A few mercs wait for hire at the towns. A lost one comes back in 70 turns, like a patrol car.
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["bowl", "nose"] },
  },
};

export const SPAWN = {
  initial: [
    "buggy",
    "buggy",
    "buggy",
    "buggy",
    "gunwagon",
    "trader",
    "trader",
    "trader",
    "scavenger",
    "scavenger",
    "bowlFarmer",
    "noseArmy",
    "courier",
    "roamer",
    "vulture",
    "convoy",
    "merc",
    "merc",
  ],
  // Two traders start at the gate nearest the player of the town the player's start road leaves. Traders head out
  // to other towns and sites, and every way out of that gate but the south road passes the player's start.
  startTraffic: { town: "bowl", templates: ["trader", "trader"] },
  // A respawn never lands closer to the player than this, so no truck pops up beside them. Initial spawns
  // skip it, so the start road has traffic.
  minPlayerDist: 16,
  gateSpread: 12, // distance beyond a gate for spawns; room for the start crowd at Bowl on every seed
  gateAngle: 0.3, // radians either side of the track leaving a gate
  tries: 40,
  escortGap: 1, // tiles between an escort and its leader at spawn; room to pull away without a crash
  neighborHelp: 10, // same-faction vehicles in this range join a feud, witness attacks and count as one group in danger
};

// A decision point is a moment when an NPC may change goals. See src/sim/npc-decisions.ts.
export type DecisionOptions = {
  hostileSeen: 'keep' | 'fight' | 'flee'; // a new hostile comes in sight
  contactHeard: 'keep' | 'investigate' | 'flee'; // a new hostile contact beyond sight
  attacked: 'keep' | 'flee' | 'fightBack'; // a shot at the driver or a nearby visible faction mate, hit or miss
  preySeen: 'keep' | 'rob'; // a new robbery target comes in sight
  strandedSeen: 'keep' | 'tow'; // a stranded truck comes in sight
  salvageSeen: 'keep' | 'loot'; // a wreck or pile comes in sight on the way to a goal
  patchDeal: 'paid' | 'ownParts' | 'free'; // the terms a driver names for a roadside patch; see src/sim/patch.ts
  ramChance: 'keep' | 'ram'; // the fight target lies ahead within reach of a damaging ram
  // Every NPC_BEHAVIOR.fight.whimTurns turns of a fight: go on, or do something rash until the next roll. Rush
  // drives straight through the target, halt brakes and sits, veer turns the other way round to a random spot.
  fightWhim: 'keep' | 'rush' | 'halt' | 'veer';
  crashed: 'forgive' | 'retaliate'; // a truck at peace with the driver damaged it in a crash
  parley: 'keep' | 'truce' | 'beg' | 'flee'; // a foe hurt the driver this turn
  truceOffered: 'accept' | 'refuse'; // a foe asks for a truce
  mercyBegged: 'spare' | 'finish'; // a foe gives up and asks to be let go
  // A driver that takes nothing fights a stranded foe alone: offer it a way out, or judge it not worth the trouble and
  // leave.
  strandedFoe: 'offer' | 'spare';
  surrenderOffered: 'accept' | 'refuse'; // a weak NPC is offered a way out by the foe that beat it, NPC or player
  threatened: 'comply' | 'fightBack' | 'flee'; // a driver demands the cargo, or a claimant warns the driver off its pile
  warnedOff: 'comply' | 'refuse' | 'fightBack'; // the player tells a looting driver to back off its wreck
  mugging: 'demand' | 'attack'; // the driver sets out to fight the player: radio for the cargo first, or just open fire
  resume: 'resume' | 'new'; // an interruption popped and uncovered the long-term goal
  // The goal stack is empty. Escort joins a leader that no escort guards yet.
  idle: 'trade' | 'scavenge' | 'raid' | 'prowl' | 'wait' | 'patrol' | 'travel' | 'explore' | 'haul' | 'escort';
  escortSeen: 'keep' | 'hire'; // a free merc comes in sight while the driver travels to a site
  hireOffered: 'take' | 'decline'; // a driver asks this merc to escort it for a fee
  aidAsked: 'give' | 'refuse'; // the player asks the driver for fuel or supplies; see src/sim/aid.ts
  needySeen: 'keep' | 'aid'; // a poor player low on fuel or supplies comes in sight
};
export type DecisionId = keyof DecisionOptions;

// The user's rule: "0 only for can't. For something you physically can, never go below 1% probability."
// Every option a driver can take now gets at least this chance, and shares the rest by its weight.
export const MIN_CHANCE = 0.01;

// Base weight per option. The final weight is (base + adds) x muls x situation factor. A base of 0 leaves an
// available option at MIN_CHANCE unless a trait adds weight.
export const DECISIONS: { [D in DecisionId]: Record<DecisionOptions[D], number> } = {
  // Without traits a driver ignores, fights or avoids a new hostile about equally, fighting a bit more.
  hostileSeen: { keep: 1, fight: 1.8, flee: 1 },
  // Most drivers steer away from a hostile they only hear. Investigating more than rarely needs a trait.
  contactHeard: { keep: 1, investigate: 0, flee: 3 },
  // A shot mostly prompts defense or retreat. Shooting back is twice as likely as running from a miss, and keeping
  // on is rare. Damage, a stronger shooter group and local force scale flee and fight back.
  attacked: { keep: 0.5, flee: 1, fightBack: 2 },
  // Robbing more than rarely needs a trait.
  preySeen: { keep: 1, rob: 0 },
  // Towing more than rarely needs a trait.
  strandedSeen: { keep: 1, tow: 0 },
  // Stopping for salvage on the way more than rarely needs a trait.
  salvageSeen: { keep: 1, loot: 0 },
  // Most drivers want paying for a patch, some only charge for the work, and one in ten helps for free.
  patchDeal: { paid: 6, ownParts: 3, free: 1 },
  // A fighter takes 9 in 10 rams that look worth it. Otherwise it keeps shooting from its range.
  ramChance: { keep: 1, ram: 9 },
  // About one roll in eight is rash, so a driver does something odd about once in 30 turns of fighting.
  fightWhim: { keep: 20, rush: 1, halt: 1, veer: 1 },
  // Most crashes between trucks at peace are accidents. Four drivers in five shrug one off.
  crashed: { forgive: 4, retaliate: 1 },
  // A hurt driver mostly fights on. Asking for a truce is rare unless the foe is a threat, and begging is rare
  // unless the driver is weak. Breaking off is rare unless the foe turns out a threat the driver can outrun, or the
  // driver is weak.
  parley: { keep: 8, truce: 0.5, beg: 0.1, flee: 0.1 },
  // Two drivers in three take a truce. A threat on the other side makes it more likely.
  truceOffered: { accept: 2, refuse: 1 },
  // Three drivers in four let a beaten foe go. The beggar leaves its cargo.
  mercyBegged: { spare: 3, finish: 1 },
  // About one driver in ten leaves a stranded foe alone.
  strandedFoe: { offer: 9, spare: 1 },
  // A stranded driver mostly takes the way out. The accept factor for weak drivers raises it further.
  surrenderOffered: { accept: 3, refuse: 1 },
  // A threatened driver gives up its cargo, fights or runs about equally, and one warned off its wreck backs off,
  // keeps looting or fights about equally. The two sides' strength decides most.
  threatened: { comply: 1, fightBack: 1, flee: 1 }, warnedOff: { comply: 1, refuse: 1, fightBack: 1 },
  // A driver about to attack the player radios for the cargo first a bit more often than it opens fire unwarned.
  mugging: { demand: 3, attack: 2 },
  // After an interruption a driver goes back to its work 9 times in 10.
  resume: { resume: 9, new: 1 },
  // Anyone collects salvage in sight. Trading, raiding, prowling, patrols, trips, exploring, hauls and escorts more than
  // rarely need a trait. Waiting is the small fallback.
  idle: { trade: 0, scavenge: 1, raid: 0, prowl: 0, wait: 0.1, patrol: 0, travel: 0, explore: 0, haul: 0, escort: 0 },
  // Hiring a merc more than rarely needs a trait.
  escortSeen: { keep: 1, hire: 0 },
  // Three mercs in four take a job they are offered. A weak merc mostly declines.
  hireOffered: { take: 3, decline: 1 },
  // About one driver in ten gives a little fuel or supplies to a player who asks. With MIN_CHANCE give is about 11%.
  aidAsked: { give: 1, refuse: 9 },
  // Offering aid unprompted to a poor, low player more than rarely needs a trait.
  needySeen: { keep: 1, aid: 0 },
};

// A weight change: `add` raises an option with zero base weight above MIN_CHANCE, and `mul` tunes an option.
// A mul is always above 0. A small mul makes an option rare, never impossible.
export type WeightChange = { add?: number; mul?: number };
export type TraitWeights = { [D in DecisionId]?: Partial<Record<DecisionOptions[D], WeightChange>> };

// Weight changes of a state, applied only to decisions about the state's other party.
export const STATE_WEIGHTS: Record<StateKindId, TraitWeights> = {
  // A driver in a feud mostly fights that party when it comes into sight.
  feud: { hostileSeen: { fight: { add: 4 } } },
  // A failed robber mostly leaves the same target alone. A scumbag's rob weight of 0.5 drops to 0.0025, about 1%.
  backedOff: { preySeen: { rob: { mul: 0.005 } } },
  tow: {}, patch: {}, trade: {}, aid: {}, combat: {},
  // A driver rarely robs a truck it holds a truce with. A scumbag's rob weight of 0.5 drops to 0.0025, about 1%.
  truce: { preySeen: { rob: { mul: 0.005 } } },
  grievance: {},
  strayFire: {},
  // A driver that pleaded with a foe rarely pleads with it again soon. A truce weight of 2.5 drops to 0.025.
  plea: { parley: { truce: { mul: 0.01 }, beg: { mul: 0.01 } } },
  // A driver the player turned down rarely offers that player a tow again. A tow weight of 9 drops to 0.009,
  // about 2%.
  turnedDown: { strandedSeen: { tow: { mul: 0.001 } } },
  // A driver that dropped a tow for danger comes back for the player: tow outweighs keep 20 to 1.
  towPromise: { strandedSeen: { tow: { add: 20 } } },
  answering: {},
  // An escort tows its stranded leader: tow outweighs keep 99 to 1.
  escort: { strandedSeen: { tow: { add: 99 } } },
  // A driver the player knocked out, or a partner a truck betrayed, wants revenge: every hostile choice about that
  // truck gets more likely.
  // Robbing and closing in on a heard contact no longer need a trait.
  revenge: {
    hostileSeen: { fight: { add: 4 } },
    contactHeard: { investigate: { add: 2 } },
    attacked: { fightBack: { mul: 2 } },
    preySeen: { rob: { add: 2 } },
    ramChance: { ram: { mul: 2 } },
    crashed: { retaliate: { mul: 4 } },
    parley: { keep: { mul: 2 } },
    truceOffered: { refuse: { mul: 3 } },
    mercyBegged: { finish: { mul: 3 } },
    threatened: { fightBack: { mul: 2 } }, warnedOff: { fightBack: { mul: 2 } },
  },
};

// State durations in turns. See src/sim/states.ts. null means the state has no timer and ends only by its checks.
export const STATE_TURNS: Record<StateKindId, number | null> = {
  // Sight or shots between the two parties reset it. 10 turns lets a chase lose sight behind a ridge or a
  // wreck for a while and pick the fight up again. A pursuer that stays out of sight longer gives up.
  feud: 10,
  // A failed robber leaves the same target alone for 30 turns. At 300 turns a day that is a few hours,
  // long enough for the target to drive well away before the robber may try again.
  backedOff: 30,
  // A tow lasts until the tower reaches town, the player lets go, or the tower is gone or in danger.
  tow: null,
  // Work on a patch keeps it going. Without work it lapses after 40 turns, a fifth of a day, so a client
  // stops waiting for a patcher who never comes.
  patch: 40,
  // Being parked in reach keeps a trade meeting going. Without that it lapses after 20 turns, so a driver stops
  // chasing a player who drove off, and the player stops waiting for a driver who cannot get through.
  trade: 20,
  // An aid deal is a trade meeting: the same 20 turns to get parked side by side, or it lapses with nothing moved.
  aid: 20,
  // A truck that handed over its cargo is left alone for 60 turns: time for the raiders to search the stock and the
  // truck to drive well away. Shots start a feud, which ends the truce's effect at once.
  truce: 60,
  // A crash victim decides on the crash the first turn it sees the other truck. It lets the crash go after 5
  // turns out of sight.
  grievance: 5,
  // Stray hits from the same shooter add up for 60 turns after the last one, long enough to cover one fight.
  strayFire: 60,
  // A driver waits 20 turns before it pleads with the same foe again. The player answers within that time too.
  plea: 20,
  // A driver the player turned down holds it until it offers that player a tow again.
  turnedDown: null,
  // A tower that dropped a hitched tow for danger keeps its terms until its next offer to that truck, or until the
  // truck drives again.
  towPromise: null,
  // A grudge against the player fades after 10 days, unless the driver settles it first.
  revenge: 2000,
  // A driver on its way to a stranded player holds the job until it offers, its tow goal pops, or it is gone. A tower
  // that has its client in sight and out of combat for 20 turns without hitching cannot get through and gives up the
  // job, so another driver can answer.
  answering: 20,
  // An escort lasts until the leader reaches its destination, or either party is gone, beaten or hostile.
  escort: null,
  // Hostile acts between two trucks reset it. 10 turns, like a feud, covers reloads and a chase out of sight behind a
  // ridge, and is short enough that a raider that drove off stops blocking work soon.
  combat: 10,
};


export { FIRST_NAMES, HUNT, MEMORY, NPC_BEHAVIOR, NPC_UPKEEP, SURNAMES, TRADE_TIP } from './npc-behavior';
export { TRAITS, type Trait } from './npc-traits';
