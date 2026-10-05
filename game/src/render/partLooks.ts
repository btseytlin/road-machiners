// Which Blender model draws each grid item. Pure, so Node tests can check coverage.
// Weapons are assembled from sub-part models. Each slot picks from its def's pool, seeded by the part id.

import type { ModelName } from '../three/render/models';
import { PARTS, type PartDef } from '../data/parts';
import { hashStr } from './noise';
import type { PartInstance } from '../sim/types';
import { maxHp } from '../sim/wear';

// The base model each chassis is drawn from. Kit parts stand on its row surfaces.
const BASE_MODELS: Record<string, ModelName> = {
  scout: 'base_scout',
  hauler: 'base_hauler',
  buggy: 'base_buggy',
  wagon: 'base_wagon',
  courier: 'base_courier',
  van: 'base_van',
  longbed: 'base_longbed',
  carrier: 'base_carrier',
  tractor: 'base_tractor',
  jeep: 'base_jeep',
  convertible: 'base_convertible',
  bus: 'base_bus',
  loader: 'base_loader',
  niva: 'base_niva',
  bukhanka: 'base_bukhanka',
  lincoln: 'base_lincoln',
};

export function baseModel(chassisId: string): ModelName {
  const base = BASE_MODELS[chassisId];
  if (!base) throw new Error(`Chassis ${chassisId} has no base model in BASE_MODELS`);
  return base;
}

// Parts with no model of their own. The base model draws them: every cab.
export const BODY_PARTS: ReadonlySet<string> = new Set(
  Object.values(PARTS).flatMap((p) => (p.kind === 'core' && p.role === 'cab' ? [p.id] : [])),
);

export const PART_MODELS: Record<string, ModelName> = {
  transmission: 'transmission',
  transmissionMid: 'transmission',
  transmissionHeavy: 'transmission',
  wheel: 'wheel',
  wheelMid: 'wheel',
  wheelHeavy: 'wheel',
  tank: 'fuel_tank',
  tankLong: 'fuel_tank',
  tankMid: 'fuel_tank',
  tankHeavy: 'fuel_tank',

  stockEngine: 'eng_stock',
  tunedEngine: 'eng_tuned_v8',
  flatFour: 'eng_flat_four',
  workhorseDiesel: 'eng_workhorse_diesel',
  racingV6: 'eng_racing_v6',
  heavyDiesel: 'eng_heavy_diesel',
  turbine: 'eng_turbine',

  plates: 'arm_plates',
  cage: 'arm_cage',
  ram: 'arm_ram',
  scrapPanels: 'arm_scrap_panels',
  ceramicPlates: 'arm_ceramic_plates',
  spacedArmor: 'arm_spaced',
  reinforcedCage: 'arm_reinforced_cage',
  plowRam: 'arm_plow_ram',
  steelPlate: 'arm_plate',
  scrapSheet: 'arm_scrap_sheet',
  ceramicTile: 'arm_ceramic_tile',

  rack: 'cargo_rack',
  trailerBox: 'cargo_trailer_box',
  panniers: 'cargo_panniers',
  flatbed: 'cargo_flatbed',
  lightFrame: 'cargo_light_frame',
  enclosedFrame: 'cargo_enclosed_frame',
  heavyFrame: 'cargo_heavy_frame',

  scanner: 'scanner',

  jerrycans: 'store_jerrycans',
  supplyLocker: 'store_locker',

  scrap: 'good_scrap',
  salt: 'good_salt',
  meds: 'good_meds',
  grain: 'good_grain',
  textiles: 'good_textiles',
  tools: 'good_tools',
  batteries: 'good_batteries',
  electronics: 'good_electronics',
  parts: 'good_parts',
  fuelDrums: 'good_fuel_drums',
  water: 'good_water',
};

export type WeaponPool = { mount: ModelName[]; receiver: ModelName[]; barrel: ModelName[]; extra: ModelName[] };

// An empty extra pool means the weapon has no extra.
export const WEAPON_POOLS: Record<string, WeaponPool> = {
  mg: {
    mount: ['wmount_ring_small', 'wmount_pintle'],
    receiver: ['wrec_mg_a', 'wrec_mg_b'],
    barrel: ['wbar_mg_short', 'wbar_mg_long', 'wbar_twin'],
    extra: ['wext_shield', 'wext_drum'],
  },
  shotgun: {
    mount: ['wmount_ring_small', 'wmount_pintle'],
    receiver: ['wrec_shotgun'],
    barrel: ['wbar_shotgun', 'wbar_twin'],
    extra: ['wext_shield', 'wext_drum'],
  },
  autocannon: {
    mount: ['wmount_ring_wide'],
    receiver: ['wrec_autocannon'],
    barrel: ['wbar_autocannon', 'wbar_twin'],
    extra: ['wext_drum', 'wext_shield'],
  },
  cannon: {
    mount: ['wmount_cradle'],
    receiver: ['wrec_cannon'],
    barrel: ['wbar_cannon'],
    extra: ['wext_shield', 'wext_scope'],
  },
  tankGun: {
    mount: ['wmount_cradle'],
    receiver: ['wrec_tank'],
    barrel: ['wbar_tank'],
    extra: ['wext_shield'],
  },
  rocketRack: {
    mount: ['wmount_ring_wide'],
    receiver: ['wrec_rocket_pod'],
    barrel: ['wbar_rocket_tubes'],
    extra: [],
  },
  sniperCannon: {
    mount: ['wmount_cradle'],
    receiver: ['wrec_sniper'],
    barrel: ['wbar_sniper'],
    extra: ['wext_scope'],
  },
  longRifle: {
    mount: ['wmount_pintle'],
    receiver: ['wrec_mg_b'],
    barrel: ['wbar_mg_long'],
    extra: ['wext_scope'],
  },
  flamer: {
    mount: ['wmount_ring_small'],
    receiver: ['wrec_shotgun'],
    barrel: ['wbar_shotgun'],
    extra: ['wext_drum'],
  },
  pneumobolter: {
    mount: ['wmount_ring_small', 'wmount_pintle'],
    receiver: ['wrec_autocannon'],
    barrel: ['wbar_autocannon'],
    extra: ['wext_drum', 'wext_shield'],
  },
  slugCannon: {
    mount: ['wmount_ring_wide'],
    receiver: ['wrec_autocannon'],
    barrel: ['wbar_cannon'],
    extra: ['wext_shield'],
  },
  heavyMg: {
    mount: ['wmount_ring_small'],
    receiver: ['wrec_mg_a', 'wrec_mg_b'],
    barrel: ['wbar_mg_long', 'wbar_twin'],
    extra: ['wext_shield', 'wext_drum'],
  },
  amRifle: {
    mount: ['wmount_cradle'],
    receiver: ['wrec_sniper'],
    barrel: ['wbar_sniper'],
    extra: ['wext_scope'],
  },
  recoilless: {
    mount: ['wmount_ring_wide'],
    receiver: ['wrec_cannon'],
    barrel: ['wbar_cannon'],
    extra: ['wext_shield'],
  },
  battleRifle: {
    mount: ['wmount_pintle'],
    receiver: ['wrec_mg_b'],
    barrel: ['wbar_mg_long'],
    extra: ['wext_scope', 'wext_drum'],
  },
  gatling: {
    mount: ['wmount_ring_wide'],
    receiver: ['wrec_autocannon'],
    barrel: ['wbar_twin'],
    extra: ['wext_drum'],
  },
  grenadeLauncher: {
    mount: ['wmount_ring_wide'],
    receiver: ['wrec_shotgun'],
    barrel: ['wbar_autocannon'],
    extra: ['wext_drum'],
  },
  flechette: {
    mount: ['wmount_ring_small'],
    receiver: ['wrec_mg_a'],
    barrel: ['wbar_mg_long'],
    extra: ['wext_scope'],
  },
};

export type WeaponLook = { mount: ModelName; receiver: ModelName; barrel: ModelName; extra: ModelName | null };

export function partModel(defId: string): ModelName {
  if (BODY_PARTS.has(defId)) throw new Error(`Part ${defId} is drawn by the truck body and has no model`);
  const name = PART_MODELS[defId];
  if (!name) throw new Error(`No model for part or good ${defId}. Add it to PART_MODELS.`);
  return name;
}

export function weaponLook(partId: string, defId: string): WeaponLook {
  const pool = WEAPON_POOLS[defId];
  if (!pool) throw new Error(`No weapon pool for ${defId}. Add it to WEAPON_POOLS.`);
  // Each slot hashes with its own suffix, so slot picks do not move together.
  const pick = (slot: keyof WeaponPool): ModelName => {
    const options = pool[slot];
    return options[Math.floor(hashStr(`${partId}:${slot}`) * options.length)];
  };
  return {
    mount: pick('mount'),
    receiver: pick('receiver'),
    barrel: pick('barrel'),
    extra: pool.extra.length === 0 ? null : pick('extra'),
  };
}

// How worn a part looks, and what its break throws. A part's look moves in steps so a truck only rebuilds when a part
// crosses one. These are render constants, not balance.

export const WEAR_LOOK_STEPS = 4;
// The dusty gray worn colors fade toward.
export const WORN_GRAY = 0x8c8a84;
// Share of the fade toward WORN_GRAY at the last step.
export const GRAY_MAX = 0.7;
// Meters a model-space vertex moves at the last step.
export const JAG_MAX = 0.14;
// Share of a model's smallest extent its jag may reach, so thin parts bend but stay whole.
export const JAG_THIN = 0.25;
// A hulk, the chassis a dead truck leaves, is fully gray, then darkened by this factor so it reads burnt, not worn.
export const HULK_TONE = 0.45;
// Radians a hulk may lean in roll or pitch, seeded by its id, so it lies slumped. Its collision boxes stay level.
export const HULK_TILT = 0.06;
// Same weld as debris.ts: corners within a millimeter move together.
const WELD = 1000;

export type BreakSignature = 'ammo' | 'air' | 'fire';

// 0 at full HP, WEAR_LOOK_STEPS only at 0 HP. Lower HP never gives a lower step.
export function wearLookStep(part: PartInstance): number {
  const max = maxHp(part);
  if (max <= 0) throw new Error(`Part ${part.id} has max HP ${max}`);
  if (part.hp <= 0) return WEAR_LOOK_STEPS;
  const share = Math.min(1, Math.max(0, 1 - part.hp / max));
  return Math.min(WEAR_LOOK_STEPS - 1, Math.ceil(share * (WEAR_LOOK_STEPS - 1)));
}

export function grayShare(step: number): number {
  return (GRAY_MAX * step) / WEAR_LOOK_STEPS;
}

// The color faded toward WORN_GRAY by share.
export function grayed(hex: number, share: number): number {
  const mix = (shift: number): number => {
    const c = (hex >> shift) & 255;
    const w = (WORN_GRAY >> shift) & 255;
    return Math.round(c + (w - c) * share);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

// thinnest is the model's smallest model-space extent.
export function jagOffset(
  partId: string, x: number, y: number, z: number, step: number, thinnest: number,
): { x: number; y: number; z: number } {
  if (step <= 0) return { x: 0, y: 0, z: 0 };
  const key = `${partId}:${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
  const size = (Math.min(JAG_MAX, JAG_THIN * thinnest) * step) / WEAR_LOOK_STEPS;
  const axis = (n: number): number => (hashStr(`${key}:${n}`) * 2 - 1) * size;
  return { x: axis(0), y: axis(1), z: axis(2) };
}

const CORE_BREAKS: Partial<Record<string, BreakSignature>> = { wheel: 'air', tank: 'fire' };

export function breakSignature(def: PartDef): BreakSignature | null {
  if (def.kind === 'weapon') return 'ammo';
  if (def.kind === 'core') return CORE_BREAKS[def.role] ?? null;
  return def.kind === 'store' && def.holds === 'fuel' ? 'fire' : null;
}
