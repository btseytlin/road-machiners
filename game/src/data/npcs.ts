// NPC vehicle templates and how often they appear.

import type { Faction, StateKindId } from '../sim/types';
import { RULES } from './rules';
import { START_KITS } from './start';

export const NPC_RESOURCES = {
  money: START_KITS.standard.money,
  fuel: START_KITS.standard.fuel,
  supplies: START_KITS.standard.supplies,
};

export type TraitId = 'trader' | 'scavenger' | 'raider' | 'scumbag' | 'coward' | 'lawman' | 'courier' | 'roamer' | 'vulture' | 'supplier' | 'guard' | 'merc' | 'brave';

export type Weighted<T> = { value: T; weight: number };
export type Load = { kg: number; cells: number };
export type CargoRoll = { good: string; count: number };
export type SpareTable = { pool: Weighted<string | null>[]; count: Weighted<number>[] };
export type GearLevel = 'poor' | 'light' | 'standard' | 'heavy' | 'loaded';
export const GEAR_LEVEL_IDS: readonly GearLevel[] = ['poor', 'light', 'standard', 'heavy', 'loaded'];
export type NpcLoadoutTable = {
  levels: Weighted<GearLevel>[];
  chassis: Weighted<string>[];
  priorities: LoadoutPriorities;
  cargoPart: Weighted<string | null>[];
  goods: Weighted<CargoRoll | null>[];
  spares: SpareTable | null;
  haul: Load;
};

export type LoadoutPriorities = { speed: number; firepower: number; armor: number; cargo: number };
export const PRIORITY_TOP = 3;
export const SPEED_SHARE = { low: 0.4, high: 0.6 };

export const MIN_NPC_SPEED = RULES.limpSpeed * 2;

export const GEAR_DRAWS = 3;
export const GEAR_WHIM = 0.1;

export const GEAR_SCORE = { armorQualityScale: 28, armorCurvePower: 2, gunSaturation: 2, gunCurvePower: 0.5, speedWeight: 0.75, cargoCurvePower: 2 };

const GOOD_WEAR: Weighted<number>[] = [{ value: 2, weight: 1 }, { value: 3, weight: 3 }, { value: 4, weight: 12 }];

export const GEAR_LEVELS: Record<GearLevel, { money: number; wear: Weighted<number>[]; cargo: number }> = {
  poor: { money: 125000, wear: [{ value: 3, weight: 1 }, { value: 4, weight: 15 }], cargo: 0.5 },
  light: { money: 146000, wear: GOOD_WEAR, cargo: 0.75 },
  standard: { money: 171000, wear: GOOD_WEAR, cargo: 1 },
  heavy: { money: 208000, wear: GOOD_WEAR, cargo: 1 },
  loaded: { money: 275000, wear: GOOD_WEAR, cargo: 1.5 },
};

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

export type SpawnPlace = { kind: 'camp' } | { kind: 'town' } | { kind: 'sites'; ids: string[] } | { kind: 'escort'; of: string };

export type NpcTemplate = {
  id: string;
  faction: Faction;
  traits: TraitId[];
  extraTraits: { trait: TraitId; chance: number }[];
  loadout: NpcLoadoutTable;
  aggroRange: number;
  fightStyle: 'hold' | 'circle';
  money: number;
  cap: number;
  interval: number;
  spawn: SpawnPlace;
};

const NO_GOODS: Weighted<CargoRoll | null>[] = [{ value: null, weight: 1 }];
const MOSTLY_NO_CARGO_PART: Weighted<string | null>[] = [
  { value: null, weight: 6 },
  { value: "rack", weight: 1 },
];

const LOADOUTS: Record<string, NpcLoadoutTable> = {
  outrider: {
    levels: [{ value: "standard", weight: 4 }, { value: "heavy", weight: 2 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "buggy", weight: 6 },
      { value: "courier", weight: 3 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 1 },
      { value: "jeep", weight: 3 }, { value: "niva", weight: 1 },
    ],
    priorities: { speed: 3, firepower: 3, armor: 3, cargo: 1 },
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
    haul: { kg: 200, cells: 3 },
    spares: null,
  },
  gunwagon: {
    levels: [{ value: "standard", weight: 4 }, { value: "heavy", weight: 2 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "wagon", weight: 6 },
      { value: "carrier", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "loader", weight: 1 },
    ],
    priorities: { speed: 0.1, firepower: 3, armor: 3, cargo: 0 },
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
    haul: { kg: 400, cells: 5 },
    spares: null,
  },
  trader: {
    levels: [{ value: "poor", weight: 1 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "hauler", weight: 6 },
      { value: "longbed", weight: 3 },
      { value: "van", weight: 4 },
      { value: "tractor", weight: 1 },
      { value: "scout", weight: 2 },
      { value: "bus", weight: 2 }, { value: "bukhanka", weight: 2 },
    ],
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
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
    haul: { kg: 0, cells: 0 },
    spares: TRADER_SPARES,
  },
  scavenger: {
    levels: [{ value: "poor", weight: 2 }, { value: "light", weight: 4 }, { value: "standard", weight: 2 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "scout", weight: 6 },
      { value: "van", weight: 3 },
      { value: "courier", weight: 2 },
      { value: "buggy", weight: 2 },
      { value: "hauler", weight: 1 },
      { value: "jeep", weight: 2 }, { value: "niva", weight: 2 }, { value: "bukhanka", weight: 1 },
    ],
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
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
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  bowlPatrol: {
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 1 }],
    chassis: [
      { value: "tractor", weight: 5 },
      { value: "hauler", weight: 4 },
      { value: "loader", weight: 2 },
    ],
    priorities: { speed: 0.1, firepower: 3, armor: 3, cargo: 0 },
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  nosePatrol: {
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 1 }],
    chassis: [
      { value: "wagon", weight: 5 },
      { value: "carrier", weight: 4 },
    ],
    priorities: { speed: 0.1, firepower: 3, armor: 3, cargo: 0 },
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  courier: {
    levels: [{ value: "poor", weight: 3 }, { value: "light", weight: 4 }, { value: "standard", weight: 2 }],
    chassis: [
      { value: "courier", weight: 5 },
      { value: "buggy", weight: 4 },
      { value: "scout", weight: 3 },
      { value: "convertible", weight: 3 },
    ],
    priorities: { speed: 3, firepower: 1, armor: 3, cargo: 2 },
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
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  roamer: {
    levels: [{ value: "poor", weight: 2 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "scout", weight: 5 },
      { value: "van", weight: 3 },
      { value: "buggy", weight: 2 },
      { value: "courier", weight: 1 },
      { value: "convertible", weight: 1 },
      { value: "jeep", weight: 1 }, { value: "niva", weight: 2 },
    ],
    priorities: { speed: 2, firepower: 1, armor: 3, cargo: 2 },
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
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  vulture: {
    levels: [{ value: "poor", weight: 1 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "scout", weight: 4 },
      { value: "van", weight: 4 },
      { value: "jeep", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "longbed", weight: 1 }, { value: "bukhanka", weight: 2 },
    ],
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
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
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  convoy: {
    levels: [{ value: "light", weight: 2 }, { value: "standard", weight: 4 }, { value: "heavy", weight: 2 }],
    chassis: [
      { value: "hauler", weight: 6 },
      { value: "longbed", weight: 3 },
      { value: "bus", weight: 2 },
    ],
    priorities: { speed: 1, firepower: 1, armor: 3, cargo: 3 },
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
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  convoyGuard: {
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 3 }, { value: "loaded", weight: 1 }],
    chassis: [
      { value: "scout", weight: 4 },
      { value: "van", weight: 3 },
      { value: "wagon", weight: 2 },
      { value: "buggy", weight: 2 },
    ],
    priorities: { speed: 1, firepower: 3, armor: 2, cargo: 0 },
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
  merc: {
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 2 }],
    chassis: [
      { value: "wagon", weight: 4 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 2 },
      { value: "carrier", weight: 1 }, { value: "lincoln", weight: 2 },
    ],
    priorities: { speed: 1, firepower: 3, armor: 2, cargo: 0 },
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    haul: { kg: 0, cells: 0 },
    spares: null,
  },
};

const NEUTRAL_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'scumbag', chance: 0.25 }, { trait: 'coward', chance: 0.25 }, { trait: 'brave', chance: 0.15 }];
const VULTURE_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'coward', chance: 0.6 }, { trait: 'scumbag', chance: 0.35 }, { trait: 'brave', chance: 0.1 }];
const RAIDER_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'brave', chance: 0.15 }];
const GUARD_EXTRAS: NpcTemplate['extraTraits'] = [{ trait: 'scumbag', chance: 0.25 }];

export const OPPOSED_TRAITS: readonly [TraitId, TraitId][] = [['coward', 'brave']];

export const NPCS: Record<string, NpcTemplate> = {
  buggy: {
    id: 'buggy', faction: 'raiders', traits: ['raider'], extraTraits: RAIDER_EXTRAS,
    loadout: LOADOUTS.outrider,
    aggroRange: 11,
    fightStyle: 'circle',
    money: NPC_RESOURCES.money,
    cap: 6,
    interval: 50,
    spawn: { kind: "camp" },
  },
  gunwagon: {
    id: 'gunwagon', faction: 'raiders', traits: ['raider'], extraTraits: RAIDER_EXTRAS,
    loadout: LOADOUTS.gunwagon,
    aggroRange: 12,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 2,
    interval: 150,
    spawn: { kind: "camp" },
  },
  trader: {
    id: 'trader', faction: 'traders', traits: ['trader'],
    // One trader in four is a scumbag, and one in four a coward, as with every neutral driver.
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.trader,
    aggroRange: 0,
    fightStyle: 'hold',
    money: 133300,
    cap: 8,
    interval: 12,
    spawn: { kind: "town" },
  },
  scavenger: {
    id: 'scavenger', faction: 'scavengers', traits: ['scavenger'],
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
    id: 'bowlFarmer', faction: 'bowl', traits: ['lawman', 'brave'], extraTraits: [],
    loadout: LOADOUTS.bowlPatrol,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["bowl"] },
  },
  noseArmy: {
    id: 'noseArmy', faction: 'nose', traits: ['lawman', 'brave'], extraTraits: [],
    loadout: LOADOUTS.nosePatrol,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["nose"] },
  },
  courier: {
    id: 'courier', faction: 'couriers', traits: ['courier'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.courier,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  roamer: {
    id: 'roamer', faction: 'roamers', traits: ['roamer'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.roamer,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  vulture: {
    id: 'vulture', faction: 'vultures', traits: ['vulture'],
    extraTraits: VULTURE_EXTRAS,
    loadout: LOADOUTS.vulture,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  convoy: {
    id: 'convoy', faction: 'convoys', traits: ['supplier'], extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.convoy,
    aggroRange: 0,
    fightStyle: 'hold',
    money: 133300,
    cap: 2,
    interval: 100,
    spawn: { kind: "sites", ids: ["bowl", "nose"] },
  },
  convoyGuard: {
    id: 'convoyGuard', faction: 'convoys', traits: ['guard', 'brave'], extraTraits: GUARD_EXTRAS,
    loadout: LOADOUTS.convoyGuard,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
    cap: 2,
    interval: 100,
    spawn: { kind: "escort", of: "convoy" },
  },
  merc: {
    id: 'merc', faction: 'mercs', traits: ['merc'], extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.merc,
    aggroRange: 0,
    fightStyle: 'hold',
    money: NPC_RESOURCES.money,
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
  startTraffic: { town: "bowl", templates: ["trader", "trader"] },
  minPlayerDist: 16,
  gateSpread: 12,
  gateAngle: 0.3,
  tries: 40,
  escortGap: 1,
  neighborHelp: 10,
};

export type DecisionOptions = {
  hostileSeen: 'keep' | 'fight' | 'flee';
  contactHeard: 'keep' | 'investigate' | 'flee';
  attacked: 'keep' | 'flee' | 'fightBack';
  preySeen: 'keep' | 'rob';
  strandedSeen: 'keep' | 'tow';
  salvageSeen: 'keep' | 'loot';
  patchDeal: 'paid' | 'ownParts' | 'free';
  ramChance: 'keep' | 'ram';
  fightWhim: 'keep' | 'rush' | 'halt' | 'veer';
  crashed: 'forgive' | 'retaliate';
  parley: 'keep' | 'truce' | 'beg' | 'flee';
  truceOffered: 'accept' | 'refuse';
  mercyBegged: 'spare' | 'finish';
  strandedFoe: 'offer' | 'spare';
  surrenderOffered: 'accept' | 'refuse';
  threatened: 'comply' | 'fightBack' | 'flee';
  warnedOff: 'comply' | 'refuse' | 'fightBack';
  lootContested: 'warn' | 'leave' | 'fight';
  warnRefused: 'leave' | 'fight';
  mugging: 'demand' | 'attack';
  resume: 'resume' | 'new';
  idle: 'trade' | 'scavenge' | 'raid' | 'prowl' | 'wait' | 'patrol' | 'travel' | 'explore' | 'haul' | 'escort';
  escortSeen: 'keep' | 'hire';
  hireOffered: 'take' | 'decline';
  aidAsked: 'give' | 'refuse';
  needySeen: 'keep' | 'aid';
};
export type DecisionId = keyof DecisionOptions;

export const MIN_CHANCE = 0.01;

export const DECISIONS: { [D in DecisionId]: Record<DecisionOptions[D], number> } = {
  hostileSeen: { keep: 1, fight: 1.8, flee: 1 },
  contactHeard: { keep: 1, investigate: 0, flee: 3 },
  attacked: { keep: 0.5, flee: 1, fightBack: 2 },
  preySeen: { keep: 1, rob: 0 },
  strandedSeen: { keep: 1, tow: 0 },
  salvageSeen: { keep: 1, loot: 0 },
  patchDeal: { paid: 6, ownParts: 3, free: 1 },
  ramChance: { keep: 1, ram: 9 },
  fightWhim: { keep: 20, rush: 1, halt: 1, veer: 1 },
  crashed: { forgive: 4, retaliate: 1 },
  parley: { keep: 8, truce: 0.5, beg: 0.1, flee: 0.1 },
  truceOffered: { accept: 2, refuse: 1 },
  mercyBegged: { spare: 3, finish: 1 },
  strandedFoe: { offer: 9, spare: 1 },
  surrenderOffered: { accept: 3, refuse: 1 },
  threatened: { comply: 1, fightBack: 1, flee: 1 }, warnedOff: { comply: 1, refuse: 1, fightBack: 1 },
  lootContested: { warn: 4, leave: 5.7, fight: 0.2 },
  warnRefused: { leave: 3, fight: 1 },
  mugging: { demand: 3, attack: 2 },
  resume: { resume: 9, new: 1 },
  idle: { trade: 0, scavenge: 1, raid: 0, prowl: 0, wait: 0.1, patrol: 0, travel: 0, explore: 0, haul: 0, escort: 0 },
  escortSeen: { keep: 1, hire: 0 },
  hireOffered: { take: 3, decline: 1 },
  aidAsked: { give: 1, refuse: 9 },
  needySeen: { keep: 1, aid: 0 },
};

export type WeightChange = { add?: number; mul?: number };
export type TraitWeights = { [D in DecisionId]?: Partial<Record<DecisionOptions[D], WeightChange>> };

export const STATE_WEIGHTS: Record<StateKindId, TraitWeights> = {
  feud: { hostileSeen: { fight: { add: 4 } } },
  backedOff: { preySeen: { rob: { mul: 0.005 } } },
  tow: {}, patch: {}, trade: {}, aid: {}, combat: {}, lootWarning: {},
  truce: { preySeen: { rob: { mul: 0.005 } } },
  grievance: {},
  strayFire: {},
  plea: { parley: { truce: { mul: 0.01 }, beg: { mul: 0.01 } } },
  turnedDown: { strandedSeen: { tow: { mul: 0.001 } } },
  towPromise: { strandedSeen: { tow: { add: 20 } } },
  answering: {},
  escort: { strandedSeen: { tow: { add: 99 } } },
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
    lootContested: { fight: { mul: 2 } }, warnRefused: { fight: { mul: 2 } },
  },
};

export const STATE_TURNS: Record<StateKindId, number | null> = {
  feud: 10,
  backedOff: 30,
  tow: null,
  patch: 40,
  trade: 20,
  aid: 20,
  truce: 60,
  grievance: 5,
  strayFire: 60,
  plea: 20,
  turnedDown: null,
  towPromise: null,
  revenge: 2000,
  answering: 20,
  escort: null,
  combat: 10,
  lootWarning: 30,
};


export { FEMALE_NAMES, FIRST_NAMES, HUNT, MEMORY, NPC_BEHAVIOR, NPC_UPKEEP, SURNAMES, TRADE_TIP } from './npc-behavior';
export { TRAITS, type Trait } from './npc-traits';
