// Which Blender model draws each grid item. Pure, so Node tests can check coverage.
// Weapons are assembled from sub-part models. Each slot picks from its def's pool, seeded by the part id.

import type { ModelName } from '../three/render/models';
import { PARTS } from '../data/parts';
import { hashStr } from './noise';

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
};

export function baseModel(chassisId: string): ModelName {
  const base = BASE_MODELS[chassisId];
  if (!base) throw new Error(`Chassis ${chassisId} has no base model in BASE_MODELS`);
  return base;
}

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
