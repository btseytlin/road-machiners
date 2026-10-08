// NPC vehicle templates and how often they appear.

import type { Faction, StateKindId } from '../sim/types';
import { STALL_MARKETS, TOWN_MARKETS } from './market';
import { START_KITS } from './start';

export const NPC_RESOURCES = {
  money: START_KITS.standard.money,
  fuel: START_KITS.standard.fuel,
  supplies: START_KITS.standard.supplies,
};

export type TraitId = 'trader' | 'scavenger' | 'raider' | 'scumbag' | 'coward' | 'lawman' | 'courier' | 'roamer' | 'vulture' | 'supplier' | 'guard' | 'merc' | 'brave';

export type Weighted<T> = { value: T; weight: number };
export type CargoRoll = { good: string; count: number };
export type SpareTable = { pool: Weighted<string | null>[]; count: Weighted<number>[] };
export type GearLevel = 'poor' | 'light' | 'standard' | 'heavy' | 'loaded';
export const GEAR_LEVEL_IDS: readonly GearLevel[] = ['poor', 'light', 'standard', 'heavy', 'loaded'];
export type NpcLoadoutTable = {
  budget: number;
  levels: Weighted<GearLevel>[];
  chassis: Weighted<string>[];
  engine: Weighted<string>[];
  weapon: Weighted<string>[];
  extraGun: Weighted<string>[];
  minGuns: number;
  gunFill: number;
  armor: Weighted<string>[];
  cargoPart: Weighted<string | null>[];
  goods: Weighted<CargoRoll | null>[];
  wear: Weighted<number>[];
  spares: SpareTable | null;
  targets: { guns: [number, number]; armor: [number, number] };
};

export const MAX_GUN_SLOWDOWN = 0.35;

export const MIN_NPC_SPEED_SHARE = 0.6;

export const GEAR_LEVELS: Record<GearLevel, { fill: number; armor: number; budget: number; wearShift: number; cargo: number }> = {
  poor: { fill: 0, armor: 0.1, budget: 0.6, wearShift: 1, cargo: 0.5 },
  light: { fill: 0.1, armor: 0.3, budget: 0.85, wearShift: 0, cargo: 0.75 },
  standard: { fill: 0.25, armor: 0.5, budget: 1.15, wearShift: 0, cargo: 1 },
  heavy: { fill: 0.45, armor: 0.75, budget: 1.6, wearShift: -1, cargo: 1 },
  loaded: { fill: 0.8, armor: 1, budget: 2.4, wearShift: -2, cargo: 1.5 },
};

const LIGHT_GUNS: Weighted<string>[] = [
  { value: "mg", weight: 3 },
  { value: "shotgun", weight: 2 },
  { value: "flamer", weight: 1 },
  { value: "longRifle", weight: 1 },
  { value: "slugCannon", weight: 1 },
];

const LONG_GUNS: Weighted<string>[] = [
  { value: "longRifle", weight: 3 },
  { value: "slugCannon", weight: 2 },
  { value: "battleRifle", weight: 1 },
];

const WEAR_TRADER: Weighted<number>[] = [
  { value: 0, weight: 6 },
  { value: 1, weight: 3 },
  { value: 2, weight: 1 },
];
const WEAR_SCAVENGER: Weighted<number>[] = [
  { value: 0, weight: 3 },
  { value: 1, weight: 4 },
  { value: 2, weight: 2 },
  { value: 3, weight: 1 },
];
const WEAR_RAIDER: Weighted<number>[] = [
  { value: 0, weight: 2 },
  { value: 1, weight: 3 },
  { value: 2, weight: 3 },
  { value: 3, weight: 1 },
  { value: 4, weight: 1 },
];

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
  name: string;
  profession: string;
  faction: Faction;
  traits: TraitId[];
  extraTraits: { trait: TraitId; chance: number }[];
  loadout: NpcLoadoutTable;
  aggroRange: number;
  preferredRange: number;
  fightStyle: 'hold' | 'circle';
  cap: number;
  interval: number;
  spawn: SpawnPlace;
};

const LAW_ENGINES: Weighted<string>[] = [
  { value: "workhorseDiesel", weight: 5 },
  { value: "heavyDiesel", weight: 4 },
  { value: "stockEngine", weight: 2 },
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
    levels: [{ value: "light", weight: 4 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }, { value: "loaded", weight: 0.3 }],
    chassis: [
      { value: "buggy", weight: 6 },
      { value: "courier", weight: 3 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 1 },
      { value: "jeep", weight: 3 },
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
    minGuns: 1,
    gunFill: 0.25,
    armor: [
      { value: "scrapPanels", weight: 5 },
      { value: "cage", weight: 3 },
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
    wear: WEAR_RAIDER,
    targets: { guns: [0.8, 1.8], armor: [0.3, 0.6] },
    spares: null,
  },
  gunwagon: {
    budget: 6900,
    levels: [{ value: "light", weight: 2 }, { value: "standard", weight: 4 }, { value: "heavy", weight: 2 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "wagon", weight: 6 },
      { value: "carrier", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "loader", weight: 1 },
    ],
    engine: [
      { value: "stockEngine", weight: 5 },
      { value: "workhorseDiesel", weight: 4 },
      { value: "heavyDiesel", weight: 3 },
      { value: "tunedEngine", weight: 2 },
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
    minGuns: 2,
    gunFill: 1,
    armor: [
      { value: "plates", weight: 6 },
      { value: "spacedArmor", weight: 3 },
      { value: "reinforcedCage", weight: 3 },
      { value: "plowRam", weight: 2 },
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
    wear: WEAR_RAIDER,
    targets: { guns: [2.6, 5.1], armor: [0.5, 0.8] },
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
      { value: "bus", weight: 2 },
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
    minGuns: 1,
    gunFill: 0.2,
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
    wear: WEAR_TRADER,
    targets: { guns: [1.4, 2.2], armor: [0.3, 0.6] },
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
      { value: "jeep", weight: 2 },
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
    minGuns: 1,
    gunFill: 0.25,
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
    wear: WEAR_SCAVENGER,
    targets: { guns: [1.0, 1.6], armor: [0.2, 0.5] },
    spares: null,
  },
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
    minGuns: 1,
    gunFill: 1,
    armor: LAW_ARMOR,
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    wear: WEAR_TRADER,
    targets: { guns: [4.2, 6.5], armor: [0.5, 0.85] },
    spares: null,
  },
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
    minGuns: 1,
    gunFill: 1,
    armor: LAW_ARMOR,
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    wear: WEAR_TRADER,
    targets: { guns: [3.0, 5.2], armor: [0.5, 0.85] },
    spares: null,
  },
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
    minGuns: 1,
    gunFill: 0.5,
    armor: [
      { value: "scrapPanels", weight: 3 },
      { value: "cage", weight: 2 },
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
    wear: WEAR_TRADER,
    targets: { guns: [0.9, 1.7], armor: [0.15, 0.45] },
    spares: null,
  },
  roamer: {
    budget: 4600,
    levels: [{ value: "poor", weight: 2 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }, { value: "loaded", weight: 0.5 }],
    chassis: [
      { value: "scout", weight: 5 },
      { value: "van", weight: 3 },
      { value: "buggy", weight: 2 },
      { value: "courier", weight: 1 },
      { value: "convertible", weight: 1 },
      { value: "jeep", weight: 1 },
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
    minGuns: 1,
    gunFill: 0.25,
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
    wear: WEAR_SCAVENGER,
    targets: { guns: [1.05, 1.7], armor: [0.3, 0.6] },
    spares: null,
  },
  vulture: {
    budget: 7500,
    levels: [{ value: "poor", weight: 1 }, { value: "light", weight: 3 }, { value: "standard", weight: 3 }, { value: "heavy", weight: 1 }],
    chassis: [
      { value: "scout", weight: 4 },
      { value: "van", weight: 4 },
      { value: "jeep", weight: 2 },
      { value: "hauler", weight: 2 },
      { value: "longbed", weight: 1 },
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
    extraGun: LONG_GUNS,
    minGuns: 1,
    gunFill: 0.4,
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
    wear: WEAR_SCAVENGER,
    targets: { guns: [1.2, 2.0], armor: [0.35, 0.6] },
    spares: null,
  },
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
    minGuns: 1,
    gunFill: 0.25,
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
    wear: WEAR_TRADER,
    targets: { guns: [2.6, 3.9], armor: [0.4, 0.7] },
    spares: null,
  },
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
    minGuns: 1,
    gunFill: 1,
    armor: [
      { value: "plates", weight: 4 },
      { value: "cage", weight: 3 },
      { value: "scrapPanels", weight: 2 },
      { value: "reinforcedCage", weight: 1 },
    ],
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    wear: WEAR_TRADER,
    targets: { guns: [1.55, 3.5], armor: [0.5, 0.85] },
    spares: null,
  },
  merc: {
    budget: 6900,
    levels: [{ value: "standard", weight: 3 }, { value: "heavy", weight: 4 }, { value: "loaded", weight: 2 }],
    chassis: [
      { value: "wagon", weight: 4 },
      { value: "scout", weight: 3 },
      { value: "van", weight: 2 },
      { value: "carrier", weight: 1 },
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
    extraGun: LIGHT_GUNS,
    minGuns: 1,
    gunFill: 0.8,
    armor: [
      { value: "plates", weight: 5 },
      { value: "spacedArmor", weight: 3 },
      { value: "reinforcedCage", weight: 3 },
      { value: "ram", weight: 1 },
      { value: "ceramicPlates", weight: 1 },
    ],
    cargoPart: MOSTLY_NO_CARGO_PART,
    goods: NO_GOODS,
    wear: WEAR_SCAVENGER,
    targets: { guns: [1.85, 4.4], armor: [0.6, 0.9] },
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
    id: 'buggy', name: 'Raider outrider', profession: 'Raider', faction: 'raiders', traits: ['raider'], extraTraits: RAIDER_EXTRAS,
    loadout: LOADOUTS.outrider,
    aggroRange: 11,
    preferredRange: 3,
    fightStyle: 'circle',
    cap: 6,
    interval: 50,
    spawn: { kind: "camp" },
  },
  gunwagon: {
    id: 'gunwagon', name: 'Gunwagon', profession: 'Raider', faction: 'raiders', traits: ['raider'], extraTraits: RAIDER_EXTRAS,
    loadout: LOADOUTS.gunwagon,
    aggroRange: 12,
    preferredRange: 6,
    fightStyle: 'hold',
    cap: 2,
    interval: 150,
    spawn: { kind: "camp" },
  },
  trader: {
    id: 'trader', name: 'Trader caravan', profession: 'Trader', faction: 'traders', traits: ['trader'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.trader,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 5,
    interval: 12,
    spawn: { kind: "town" },
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', profession: 'Scavenger', faction: 'scavengers', traits: ['scavenger'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.scavenger,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 4,
    interval: 12,
    spawn: { kind: "town" },
  },
  bowlFarmer: {
    id: 'bowlFarmer', name: 'Bowl Farmers patrol', profession: 'Bowl Farmer', faction: 'bowl', traits: ['lawman', 'brave'], extraTraits: [],
    loadout: LOADOUTS.bowlPatrol,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["bowl"] },
  },
  noseArmy: {
    id: 'noseArmy', name: 'Nose Army patrol', profession: 'Nose soldier', faction: 'nose', traits: ['lawman', 'brave'], extraTraits: [],
    loadout: LOADOUTS.nosePatrol,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 3,
    interval: 70,
    spawn: { kind: "sites", ids: ["nose"] },
  },
  courier: {
    id: 'courier', name: 'Courier', profession: 'Courier', faction: 'couriers', traits: ['courier'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.courier,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  roamer: {
    id: 'roamer', name: 'Roamer', profession: 'Roamer', faction: 'roamers', traits: ['roamer'],
    extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.roamer,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  vulture: {
    id: 'vulture', name: 'Vulture', profession: 'Vulture', faction: 'vultures', traits: ['vulture'],
    extraTraits: VULTURE_EXTRAS,
    loadout: LOADOUTS.vulture,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 3,
    interval: 30,
    spawn: { kind: "town" },
  },
  convoy: {
    id: 'convoy', name: 'Supply convoy', profession: 'Convoy driver', faction: 'convoys', traits: ['supplier'], extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.convoy,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 2,
    interval: 100,
    spawn: { kind: "sites", ids: ["bowl", "nose"] },
  },
  convoyGuard: {
    id: 'convoyGuard', name: 'Convoy guard', profession: 'Convoy guard', faction: 'convoys', traits: ['guard', 'brave'], extraTraits: GUARD_EXTRAS,
    loadout: LOADOUTS.convoyGuard,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
    cap: 2,
    interval: 100,
    spawn: { kind: "escort", of: "convoy" },
  },
  merc: {
    id: 'merc', name: 'Merc', profession: 'Merc', faction: 'mercs', traits: ['merc'], extraTraits: NEUTRAL_EXTRAS,
    loadout: LOADOUTS.merc,
    aggroRange: 0,
    preferredRange: 0,
    fightStyle: 'hold',
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
  parley: 'keep' | 'truce' | 'beg';
  truceOffered: 'accept' | 'refuse';
  mercyBegged: 'spare' | 'finish';
  strandedFoe: 'offer' | 'spare';
  surrenderOffered: 'accept' | 'refuse';
  threatened: 'comply' | 'fightBack' | 'flee';
  warnedOff: 'comply' | 'refuse' | 'fightBack';
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
  parley: { keep: 8, truce: 0.5, beg: 0.1 },
  truceOffered: { accept: 2, refuse: 1 },
  mercyBegged: { spare: 3, finish: 1 },
  strandedFoe: { offer: 9, spare: 1 },
  surrenderOffered: { accept: 3, refuse: 1 },
  threatened: { comply: 1, fightBack: 1, flee: 1 }, warnedOff: { comply: 1, refuse: 1, fightBack: 1 },
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
  tow: {}, patch: {}, trade: {}, aid: {}, combat: {},
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
  answering: null,
  escort: null,
  combat: 10,
};

export type Trait = {
  towns: string[];
  bases: string[];
  markets: string[];
  salvageSites: string[];
  supplySites: string[];
  travelSites: string[];
  haulSites: string[];
  contactReactRadius: number;
  boldness: number;
  fuelMargin: number;
  robs: 'offDuty' | 'never';
  weights: TraitWeights;
};

export const TRAITS: Record<TraitId, Trait> = {
  scavenger: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks'], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty',
    weights: { idle: { scavenge: { add: 10 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 9 } }, hostileSeen: { fight: { add: 2 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } } },
  },
  trader: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: ['pump-station', 'dustwell', 'green-pit'], contactReactRadius: 12, boldness: 1, fuelMargin: 0.75, robs: 'offDuty',
    weights: {
      idle: { trade: { add: 30 }, haul: { add: 1 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, ramChance: { ram: { mul: 0.001 } },
      crashed: { retaliate: { mul: 0.2 } }, parley: { truce: { add: 2 } }, truceOffered: { accept: { add: 4 } },
      mercyBegged: { spare: { add: 3 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } }, warnedOff: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
      escortSeen: { hire: { add: 1 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } },
    },
  },
  raider: {
    towns: ['bowl', 'nose'], bases: ['scrapjaw', 'kiln'], markets: ['scrapjaw', 'kiln', 'salvage-yard'], salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty',
    weights: {
      idle: { raid: { add: 9 }, patrol: { add: 6 } }, contactHeard: { investigate: { add: 10.8 } }, hostileSeen: { fight: { add: 7.2 } }, strandedSeen: { tow: { add: 9 } },
      crashed: { retaliate: { add: 3 } }, parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, truceOffered: { refuse: { add: 2 } },
      mercyBegged: { finish: { add: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  scumbag: { towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 1.3, fuelMargin: 1, robs: 'offDuty', weights: { preySeen: { rob: { add: 0.45 } }, crashed: { retaliate: { add: 1 } } } },
  coward: {
    towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 0.6, fuelMargin: 1.4, robs: 'offDuty',
    weights: {
      hostileSeen: { flee: { mul: 3 }, fight: { mul: 0.5 } }, attacked: { flee: { mul: 3 }, fightBack: { mul: 0.3 } },
      parley: { truce: { mul: 2 }, beg: { mul: 3 } }, threatened: { flee: { mul: 3 }, comply: { add: 1 } }, warnedOff: { comply: { add: 1 } },
      escortSeen: { hire: { mul: 3 } }, fightWhim: { veer: { mul: 3 } },
    },
  },
  lawman: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never',
    weights: {
      idle: { patrol: { add: 20 }, wait: { add: 2 }, scavenge: { mul: 0.05 } },
      hostileSeen: { fight: { add: 8 } }, attacked: { fightBack: { mul: 2 } }, strandedSeen: { tow: { add: 9 } },
      parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  courier: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: ['bowl', 'nose', 'orchard', 'dustwell', 'granary', 'burnt-convoy', 'podfield', 'canyon-bridge', 'glass-flats', 'green-pit', 'south-lock', 'ridge-wrecks', 'pump-station', 'fallen-sun', 'salvage-yard'],
    haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty',
    weights: {
      idle: { travel: { add: 20 }, scavenge: { mul: 0.001 } }, strandedSeen: { tow: { add: 2 } },
      hostileSeen: { fight: { mul: 0.1 } }, threatened: { comply: { add: 1 } }, warnedOff: { comply: { add: 1 } }, escortSeen: { hire: { add: 0.5 } },
    },
  },
  roamer: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks'], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty',
    weights: { idle: { explore: { add: 10 }, trade: { add: 3 }, scavenge: { add: 2 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 3 } }, escortSeen: { hire: { add: 0.2 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } } },
  },
  vulture: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks'], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty',
    weights: { idle: { prowl: { add: 10 }, scavenge: { add: 2 } }, salvageSeen: { loot: { add: 20 } }, crashed: { retaliate: { add: 0.5 } } },
  },
  supplier: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: ['pump-station', 'dustwell', 'green-pit'], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never',
    weights: {
      idle: { haul: { add: 30 }, scavenge: { mul: 0.001 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } }, warnedOff: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
    },
  },
  guard: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: ['bowl', 'nose'], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never',
    weights: {
      idle: { escort: { add: 30 }, wait: { add: 5 }, travel: { add: 1 }, scavenge: { mul: 0.001 } },
      hostileSeen: { fight: { add: 8 } }, attacked: { fightBack: { mul: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  merc: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: ['bowl', 'nose'], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty',
    weights: {
      idle: { wait: { add: 10 }, travel: { add: 1 }, scavenge: { mul: 0.001 } },
      hostileSeen: { fight: { add: 4 } }, attacked: { fightBack: { mul: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  brave: {
    towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 1.5, fuelMargin: 1, robs: 'offDuty',
    weights: {
      hostileSeen: { flee: { mul: 0.05 } }, contactHeard: { flee: { mul: 0.05 } }, attacked: { flee: { mul: 0.05 } },
      parley: { truce: { mul: 0.05 }, beg: { mul: 0.05 } }, threatened: { flee: { mul: 0.05 }, comply: { mul: 0.05 } }, warnedOff: { comply: { mul: 0.05 } },
      fightWhim: { rush: { mul: 3 } },
    },
  },
};

export { FIRST_NAMES, HUNT, NPC_BEHAVIOR, NPC_UPKEEP, SURNAMES } from './npc-behavior';
