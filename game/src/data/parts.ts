import type { Tier } from './market';
import { UNPRICED_WEAPONS } from './weapons';
import { CLAYMORE, oilSlickLength, UNPRICED_UTILITIES } from './utilities';
import { MASS_SCALE } from './mass-scale';


export type PartKind =
  | "weapon"
  | "engine"
  | "armor"
  | "cargo"
  | "core"
  | "scanner"
  | "store"
  | "utility";

type PartBase = {
  id: string;
  name: string;
  hp: number;
  base: number;
  value: number;
  tier: Tier;
  w: number;
  h: number;
  mass: number;
  armor: number;
  tall: boolean;
};

export type WeaponClass = "damager" | "chip" | "precision";

export type WeaponRound = {
  damage: number;
  pen: number;
  blast: boolean;
  speed: number;
  splashRadius: number;
  splashDamage: number;
  splashPen: number;
  armorShare: number;
  craterRadius: number;
};

export type WeaponDef = PartBase & {
  kind: "weapon";
  draw: number;
  range: number;
  cooldown: number;
  magazine: number;
  reload: number;
  arc: number;
  spread: number;
  rounds: number;
  recoil: number;
  shake: number;
  stray: number;
  round: WeaponRound;
  classes: WeaponClass[];
  look: "mg" | "cannon";
  line?: { turns: number };
};

export type EngineDef = PartBase & {
  kind: "engine";
  speedBonus: number;
  accelBonus: number;
  capacity: number;
  fuelMult: number;
  noise: number;
  heat: number;
};

export type ClaymoreDef = {
  minImpact: number;
  blast: { damage: number; pen: number; radius: number };
  selfBlast: { damage: number; pen: number };
  throw: { impulse: number; lift: number };
  reload: number;
};

export type FieldRepair = "full" | "capped" | "none";

export type ArmorDef = PartBase & {
  kind: "armor";
  blastArmor: number;
  fieldRepair: FieldRepair;
  ramMult: number;
  look: "plates" | "cage" | "ram";
  claymore?: ClaymoreDef;
};

export type CargoDef = PartBase & {
  kind: "cargo";
  extraRows: number;
  look: "rack" | "box";
};

export type CoreDef = PartBase & {
  kind: "core";
  role: "cab" | "transmission" | "wheel" | "tank";
};

export type ScannerDef = PartBase & {
  kind: "scanner";
  range: number;
};

export type StoreDef = PartBase & {
  kind: "store";
  holds: "fuel" | "supplies";
  amount: number;
};


export type UtilityEffect =
  | { type: 'sprout'; radius: number; turns: number }
  | { type: 'mortar'; radius: number; turns: number; minRange: number; maxRange: number }
  | { type: 'caltrops'; radius: number; turns: number; behind: number }
  | { type: 'oil'; turns: number; behind: number; fuel: number }
  | { type: 'emitter'; radius: number; turns: number }
  | { type: 'flare'; radius: number; turns: number; minRange: number; maxRange: number }
  | { type: 'crane' }
  | { type: 'scraper' };
export type UtilityEffectType = UtilityEffect['type'];

export type UtilityDef = PartBase & {
  kind: "utility";
  effect: UtilityEffect;
  reload: number | null;
};

export type PartDef =
  | WeaponDef
  | EngineDef
  | ArmorDef
  | CargoDef
  | CoreDef
  | ScannerDef
  | StoreDef
  | UtilityDef;

export type Unpriced<T> = T extends unknown ? Omit<T, 'value'> : never;

export const PART_PRICE_MODIFIERS = {
  weapon: { perDamagePerTurn: 66.67, perRange: 66.67 },
  engine: { perSpeedBonus: 2000, perAccelBonus: 1333.33 },
  armor: { perArmorCell: 66.67 },
  cargo: { perExtraRow: 1666.67 },
  store: { perAmount: 166.67 },
  scanner: { perRange: 33.33 },
  core: { perHp: 33.33 },
  utility: { perEffectTurn: 166.67, perReachTile: 66.67 },
};

type UnpricedByKind = {
  weapon: Omit<WeaponDef, 'value'>;
  engine: Omit<EngineDef, 'value'>;
  armor: Omit<ArmorDef, 'value'>;
  cargo: Omit<CargoDef, 'value'>;
  store: Omit<StoreDef, 'value'>;
  scanner: Omit<ScannerDef, 'value'>;
  core: Omit<CoreDef, 'value'>;
  utility: Omit<UtilityDef, 'value'>;
};
const m = PART_PRICE_MODIFIERS;
const MODIFIERS: { [K in PartKind]: (def: UnpricedByKind[K]) => number } = {
  weapon: (d) => m.weapon.perDamagePerTurn * sustainedDamage(d) + m.weapon.perRange * d.range,
  engine: (d) => m.engine.perSpeedBonus * d.speedBonus + m.engine.perAccelBonus * d.accelBonus,
  armor: (d) => m.armor.perArmorCell * (d.armor + d.blastArmor) * d.w * d.h,
  cargo: (d) => m.cargo.perExtraRow * d.extraRows,
  store: (d) => m.store.perAmount * d.amount,
  scanner: (d) => m.scanner.perRange * d.range,
  core: (d) => m.core.perHp * d.hp,
  utility: (d) => m.utility.perEffectTurn * effectTurns(d.effect) + m.utility.perReachTile * utilityReach(d),
};

function effectTurns(e: UtilityEffect): number {
  return 'turns' in e ? e.turns : 0;
}

function utilityReach(d: Omit<UtilityDef, 'value'>): number {
  const e = d.effect;
  if ('maxRange' in e) return e.maxRange;
  if (e.type === 'oil') return oilSlickLength();
  return 'radius' in e ? e.radius : 0;
}

export function sustainedDamage(d: Pick<WeaponDef, 'round' | 'rounds' | 'cooldown' | 'magazine' | 'reload'>): number {
  return (d.round.damage * d.rounds * d.magazine) / (d.magazine * d.cooldown + d.reload);
}

function kindModifier<K extends PartKind>(kind: K, def: UnpricedByKind[K]): number {
  return MODIFIERS[kind](def);
}

export function partModifier(def: Unpriced<PartDef>): number {
  return kindModifier(def.kind, def);
}

function pricePart(def: Unpriced<PartDef>): PartDef {
  const value = Math.round(def.base + partModifier(def));
  if (value <= 0) throw new Error(`Part ${def.id} prices at ${value}. Raise its base.`);
  return { ...def, value };
}

const UNPRICED_PARTS: Record<string, Unpriced<PartDef>> = {
  ...UNPRICED_WEAPONS,
  ...UNPRICED_UTILITIES,
  stockEngine: {
    id: "stockEngine",
    kind: "engine",
    name: "Stock engine",
    hp: 50,
    base: 5000,
    tier: 1,
    w: 2,
    h: 2,
    mass: 360,
    armor: 4,
    tall: false,
    speedBonus: 0,
    accelBonus: 0,
    capacity: 7,
    fuelMult: 1,
    noise: 1,
    heat: 1,
  },
  tunedEngine: {
    id: "tunedEngine",
    kind: "engine",
    name: "Tuned V8",
    hp: 40,
    base: 7667,
    tier: 2,
    w: 2,
    h: 2,
    mass: 300,
    armor: 4,
    tall: false,
    speedBonus: 1.3,
    accelBonus: 1,
    capacity: 10,
    fuelMult: 1.4,
    noise: 1.3,
    heat: 1.2,
  },
  flatFour: {
    id: "flatFour",
    kind: "engine",
    name: "Light flat-four",
    hp: 36,
    base: 6000,
    tier: 1,
    w: 2,
    h: 2,
    mass: 224,
    armor: 2,
    tall: false,
    speedBonus: -1.3,
    accelBonus: 0,
    capacity: 5,
    fuelMult: 0.75,
    noise: 0.7,
    heat: 0.7,
  },
  workhorseDiesel: {
    id: "workhorseDiesel",
    kind: "engine",
    name: "Workhorse diesel",
    hp: 80,
    base: 9000,
    tier: 2,
    w: 2,
    h: 2,
    mass: 320,
    armor: 6,
    tall: false,
    speedBonus: -0.65,
    accelBonus: 0.5,
    capacity: 10,
    fuelMult: 0.7,
    noise: 1.2,
    heat: 0.6,
  },
  racingV6: {
    id: "racingV6",
    kind: "engine",
    name: "Racing V6",
    hp: 32,
    base: 9333,
    tier: 2,
    w: 2,
    h: 2,
    mass: 240,
    armor: 2,
    tall: false,
    speedBonus: 1.95,
    accelBonus: 0.5,
    capacity: 8,
    fuelMult: 1.25,
    noise: 1.4,
    heat: 1.6,
  },
  heavyDiesel: {
    id: "heavyDiesel",
    kind: "engine",
    name: "Heavy diesel",
    hp: 110,
    base: 15667,
    tier: 3,
    w: 2,
    h: 2,
    mass: 280,
    armor: 8,
    tall: false,
    speedBonus: -1.3,
    accelBonus: 1.5,
    capacity: 16,
    fuelMult: 1.1,
    noise: 1.5,
    heat: 0.8,
  },
  turbine: {
    id: "turbine",
    kind: "engine",
    name: "Turbine",
    hp: 44,
    base: 17000,
    tier: 3,
    w: 2,
    h: 2,
    mass: 220,
    armor: 3,
    tall: false,
    speedBonus: 2.6,
    accelBonus: 2,
    capacity: 13,
    fuelMult: 2.2,
    noise: 1.8,
    heat: 2,
  },
  plates: {
    id: "plates",
    kind: "armor",
    name: "Steel plates",
    hp: 80,
    base: 5333,
    tier: 2,
    w: 1,
    h: 3,
    mass: 225,
    armor: 12,
    tall: false,
    blastArmor: 12,
    fieldRepair: "capped",
    ramMult: 1,
    look: "plates",
  },
  cage: {
    id: "cage",
    kind: "armor",
    name: "Rebar cage",
    hp: 60,
    base: 4333,
    tier: 1,
    w: 1,
    h: 2,
    mass: 110,
    armor: 2,
    tall: false,
    blastArmor: 20,
    fieldRepair: "capped",
    ramMult: 1,
    look: "cage",
  },
  ram: {
    id: "ram",
    kind: "armor",
    name: "Ram bar",
    hp: 100,
    base: 5333,
    tier: 2,
    w: 3,
    h: 1,
    mass: 480,
    armor: 20,
    tall: false,
    blastArmor: 8,
    fieldRepair: "capped",
    ramMult: 2,
    look: "ram",
  },
  scrapPanels: {
    id: "scrapPanels",
    kind: "armor",
    name: "Scrap panels",
    hp: 44,
    base: 3667,
    tier: 1,
    w: 1,
    h: 2,
    mass: 200,
    armor: 5,
    tall: false,
    blastArmor: 5,
    fieldRepair: "full",
    ramMult: 1,
    look: "plates",
  },
  ceramicPlates: {
    id: "ceramicPlates",
    kind: "armor",
    name: "Ceramic plates",
    hp: 36,
    base: 11000,
    tier: 2,
    w: 1,
    h: 2,
    mass: 100,
    armor: 22,
    tall: false,
    blastArmor: 8,
    fieldRepair: "none",
    ramMult: 1,
    look: "plates",
  },
  spacedArmor: {
    id: "spacedArmor",
    kind: "armor",
    name: "Spaced armor",
    hp: 110,
    base: 4000,
    tier: 2,
    w: 1,
    h: 4,
    mass: 260,
    armor: 10,
    tall: false,
    blastArmor: 28,
    fieldRepair: "capped",
    ramMult: 1,
    look: "plates",
  },
  reinforcedCage: {
    id: "reinforcedCage",
    kind: "armor",
    name: "Reinforced cage",
    hp: 130,
    base: 5667,
    tier: 2,
    w: 1,
    h: 3,
    mass: 180,
    armor: 4,
    tall: false,
    blastArmor: 26,
    fieldRepair: "capped",
    ramMult: 1.2,
    look: "cage",
  },
  plowRam: {
    id: "plowRam",
    kind: "armor",
    name: "Plow ram",
    hp: 170,
    base: 12667,
    tier: 3,
    w: 3,
    h: 1,
    mass: 420,
    armor: 25,
    tall: false,
    blastArmor: 12,
    fieldRepair: "none",
    ramMult: 2.8,
    look: "ram",
  },
  claymoreRam: {
    id: "claymoreRam",
    kind: "armor",
    name: "Claymore ram",
    hp: 60,
    base: 10000,
    tier: 2,
    w: 3,
    h: 1,
    mass: 380,
    armor: 10,
    tall: false,
    blastArmor: 6,
    fieldRepair: "capped",
    ramMult: 1.5,
    look: "ram",
    claymore: CLAYMORE,
  },
  steelPlate: {
    id: "steelPlate",
    kind: "armor",
    name: "Steel plate",
    hp: 28,
    base: 5000,
    tier: 2,
    w: 1,
    h: 1,
    mass: 80,
    armor: 12,
    tall: false,
    blastArmor: 12,
    fieldRepair: "capped",
    ramMult: 1,
    look: "plates",
  },
  scrapSheet: {
    id: "scrapSheet",
    kind: "armor",
    name: "Scrap sheet",
    hp: 22,
    base: 2667,
    tier: 1,
    w: 1,
    h: 1,
    mass: 100,
    armor: 5,
    tall: false,
    blastArmor: 5,
    fieldRepair: "full",
    ramMult: 1,
    look: "plates",
  },
  ceramicTile: {
    id: "ceramicTile",
    kind: "armor",
    name: "Ceramic tile",
    hp: 18,
    base: 6667,
    tier: 2,
    w: 1,
    h: 1,
    mass: 50,
    armor: 22,
    tall: false,
    blastArmor: 8,
    fieldRepair: "none",
    ramMult: 1,
    look: "plates",
  },
  rack: {
    id: "rack",
    kind: "cargo",
    name: "Roof rack",
    hp: 30,
    base: 2333,
    tier: 1,
    w: 2,
    h: 1,
    mass: 60,
    armor: 1,
    tall: false,
    extraRows: 1,
    look: "rack",
  },
  trailerBox: {
    id: "trailerBox",
    kind: "cargo",
    name: "Cargo box",
    hp: 60,
    base: 5000,
    tier: 2,
    w: 2,
    h: 2,
    mass: 135,
    armor: 1,
    tall: true,
    extraRows: 3,
    look: "box",
  },
  panniers: {
    id: "panniers",
    kind: "cargo",
    name: "Panniers",
    hp: 20,
    base: 1667,
    tier: 1,
    w: 1,
    h: 1,
    mass: 60,
    armor: 1,
    tall: false,
    extraRows: 1,
    look: "box",
  },
  flatbed: {
    id: "flatbed",
    kind: "cargo",
    name: "Flatbed extension",
    hp: 50,
    base: 3333,
    tier: 1,
    w: 2,
    h: 1,
    mass: 120,
    armor: 1,
    tall: false,
    extraRows: 2,
    look: "rack",
  },
  lightFrame: {
    id: "lightFrame",
    kind: "cargo",
    name: "Light cargo frame",
    hp: 24,
    base: 7667,
    tier: 2,
    w: 2,
    h: 2,
    mass: 90,
    armor: 1,
    tall: false,
    extraRows: 3,
    look: "rack",
  },
  enclosedFrame: {
    id: "enclosedFrame",
    kind: "cargo",
    name: "Enclosed cargo frame",
    hp: 110,
    base: 9667,
    tier: 2,
    w: 2,
    h: 2,
    mass: 165,
    armor: 8,
    tall: true,
    extraRows: 3,
    look: "box",
  },
  heavyFrame: {
    id: "heavyFrame",
    kind: "cargo",
    name: "Heavy cargo frame",
    hp: 90,
    base: 13333,
    tier: 3,
    w: 2,
    h: 2,
    mass: 175,
    armor: 3,
    tall: true,
    extraRows: 5,
    look: "box",
  },
  jerrycans: {
    id: "jerrycans",
    kind: "store",
    name: "Jerrycan rack",
    hp: 30,
    base: 2333,
    tier: 1,
    w: 1,
    h: 1,
    mass: 70,
    armor: 1,
    tall: false,
    holds: "fuel",
    amount: 12,
  },
  supplyLocker: {
    id: "supplyLocker",
    kind: "store",
    name: "Supply locker",
    hp: 30,
    base: 2667,
    tier: 1,
    w: 1,
    h: 1,
    mass: 60,
    armor: 2,
    tall: false,
    holds: "supplies",
    amount: 10,
  },
  cab: {
    id: "cab", kind: "core", name: "Driver seat", hp: 120, base: 2667, tier: 1, w: 1, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  cabPickup: {
    id: "cabPickup", kind: "core", name: "Cab", hp: 120, base: 2667, tier: 1, w: 3, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  cabHardtop: {
    id: "cabHardtop", kind: "core", name: "Hardtop cab", hp: 120, base: 2667, tier: 1, w: 3, h: 2, mass: 80, armor: 3, tall: true, role: "cab",
  },
  transmission: {
    id: "transmission", kind: "core", name: "Transmission", hp: 40, base: 3667, tier: 1, w: 2, h: 2, mass: 60, armor: 3, tall: false, role: "transmission",
  },
  transmissionMid: {
    id: "transmissionMid", kind: "core", name: "Truck transmission", hp: 60, base: 3667, tier: 1, w: 2, h: 2, mass: 60, armor: 4, tall: false, role: "transmission",
  },
  transmissionHeavy: {
    id: "transmissionHeavy", kind: "core", name: "Heavy transmission", hp: 90, base: 3667, tier: 1, w: 2, h: 2, mass: 60, armor: 6, tall: false, role: "transmission",
  },
  wheel: {
    id: "wheel", kind: "core", name: "Wheel", hp: 30, base: 333, tier: 1, w: 1, h: 2, mass: 25, armor: 2, tall: false, role: "wheel",
  },
  wheelMid: {
    id: "wheelMid", kind: "core", name: "Truck wheel", hp: 50, base: 333, tier: 1, w: 1, h: 2, mass: 25, armor: 3, tall: false, role: "wheel",
  },
  wheelHeavy: {
    id: "wheelHeavy", kind: "core", name: "Heavy wheel", hp: 80, base: 333, tier: 1, w: 1, h: 2, mass: 25, armor: 5, tall: false, role: "wheel",
  },
  tank: {
    id: "tank", kind: "core", name: "Small fuel tank", hp: 30, base: 1000, tier: 1, w: 1, h: 2, mass: 30, armor: 1, tall: false, role: "tank",
  },
  tankLong: {
    id: "tankLong", kind: "core", name: "Fuel tank", hp: 30, base: 1000, tier: 1, w: 1, h: 2, mass: 30, armor: 1, tall: false, role: "tank",
  },
  tankMid: {
    id: "tankMid", kind: "core", name: "Truck fuel tank", hp: 50, base: 1000, tier: 1, w: 1, h: 2, mass: 30, armor: 3, tall: false, role: "tank",
  },
  tankHeavy: {
    id: "tankHeavy", kind: "core", name: "Armored fuel tank", hp: 80, base: 1000, tier: 1, w: 1, h: 2, mass: 30, armor: 6, tall: false, role: "tank",
  },
  scanner: {
    id: "scanner",
    kind: "scanner",
    name: "Radio scanner",
    hp: 30,
    base: 6333,
    tier: 2,
    w: 1,
    h: 1,
    mass: 30,
    armor: 2,
    tall: false,
    range: 160,
  },
};

export const PARTS: Record<string, PartDef> = Object.fromEntries(
  Object.entries(UNPRICED_PARTS).map(([id, def]) => [id, pricePart(scaleMass(def))]),
);

function scaleMass(def: Unpriced<PartDef>): Unpriced<PartDef> {
  if (def.kind === "armor") return { ...def, mass: def.mass * MASS_SCALE.armor };
  if (def.kind === "weapon") return { ...def, mass: def.mass * MASS_SCALE.weapon };
  return def;
}

export function partDef(id: string): PartDef {
  const def = PARTS[id];
  if (!def) throw new Error(`Unknown part ${id}`);
  return def;
}
