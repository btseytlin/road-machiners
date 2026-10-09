// Which Blender model draws each grid item. Pure, so Node tests can check coverage.
// Weapons are assembled from sub-part models. Each slot picks from its def's pool, seeded by the part id.
// Item icons draw from the same mappings, see iconCatalog().

import type { ModelName } from '../three/render/models';
import type { ChassisDef } from '../data/chassis';
import { GOODS, type GoodDef } from '../data/goods';
import { PARTS, type PartDef, type PartKind } from '../data/parts';
import { hashStr } from './noise';
import type { PartInstance } from '../sim/types';
import { maxHp } from '../sim/wear';

export const PLAN_PAD = 0.5;

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

export const BODY_PARTS: ReadonlySet<string> = new Set(
  Object.values(PARTS).flatMap((p) => (p.kind === 'core' && p.role === 'cab' ? [p.id] : [])),
);

export type ItemTone = 'weapon' | 'armor' | 'cargo' | 'other';

const KIND_TONES: Record<PartKind, ItemTone> = {
  weapon: 'weapon',
  armor: 'armor',
  cargo: 'cargo',
  engine: 'other',
  core: 'other',
  scanner: 'other',
  store: 'other',
  utility: 'other',
};

export function itemTone(id: string): ItemTone {
  const part = PARTS[id];
  if (part) return KIND_TONES[part.kind];
  if (id in GOODS) return 'cargo';
  throw new Error(`No item ${id}, so it has no tone`);
}

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
  claymoreRam: 'arm_claymore_ram',

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

  sprout: 'util_sprout',
  caltrops: 'util_caltrops',
  oilSpiller: 'util_oil',
  patcherCrane: 'util_crane',
  smokeMortar: 'util_mortar',
  flareCannon: 'util_flare',
  scrapersKnife: 'util_scraper',
  emitter: 'util_emitter',

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
  harpoon: {
    mount: ['wmount_pintle', 'wmount_ring_small'],
    receiver: ['wrec_harpoon'],
    barrel: ['wbar_harpoon'],
    extra: [],
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

export const WEAR_LOOK_STEPS = 4;
export const WORN_GRAY = 0x8c8a84;
export const GRAY_MAX = 0.7;
export const JAG_MAX = 0.14;
export const JAG_THIN = 0.25;
export const HULK_TONE = 0.45;
export const HULK_TILT = 0.06;
const WELD = 1000;

export type BreakSignature = 'ammo' | 'air' | 'fire';

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

export function grayed(hex: number, share: number): number {
  const mix = (shift: number): number => {
    const c = (hex >> shift) & 255;
    const w = (WORN_GRAY >> shift) & 255;
    return Math.round(c + (w - c) * share);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

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

export type IconSection = 'weapon' | 'engine' | 'armor' | 'cargo' | 'store' | 'core' | 'good' | 'chassis';

export const ICON_SECTIONS: readonly IconSection[] = ['weapon', 'engine', 'armor', 'cargo', 'store', 'core', 'good', 'chassis'];

export type IconEntry = {
  id: string;
  section: IconSection;
  label: string;
  models: ModelName[];
  footprint: { w: number; h: number };
  rank: number;
  weapon: WeaponLook | null;
};

export const ICON_WEAPON_PICKS: Record<string, WeaponLook> = {
  mg: { mount: 'wmount_ring_small', receiver: 'wrec_mg_a', barrel: 'wbar_mg_short', extra: 'wext_drum' },
  shotgun: { mount: 'wmount_pintle', receiver: 'wrec_shotgun', barrel: 'wbar_shotgun', extra: 'wext_shield' },
  longRifle: { mount: 'wmount_pintle', receiver: 'wrec_mg_b', barrel: 'wbar_mg_long', extra: 'wext_scope' },
  flamer: { mount: 'wmount_ring_small', receiver: 'wrec_shotgun', barrel: 'wbar_shotgun', extra: 'wext_drum' },
  pneumobolter: { mount: 'wmount_ring_small', receiver: 'wrec_autocannon', barrel: 'wbar_autocannon', extra: 'wext_drum' },
  slugCannon: { mount: 'wmount_ring_wide', receiver: 'wrec_autocannon', barrel: 'wbar_cannon', extra: 'wext_shield' },
  heavyMg: { mount: 'wmount_ring_small', receiver: 'wrec_mg_a', barrel: 'wbar_twin', extra: 'wext_drum' },
  cannon: { mount: 'wmount_cradle', receiver: 'wrec_cannon', barrel: 'wbar_cannon', extra: 'wext_scope' },
  amRifle: { mount: 'wmount_cradle', receiver: 'wrec_sniper', barrel: 'wbar_sniper', extra: 'wext_scope' },
  autocannon: { mount: 'wmount_ring_wide', receiver: 'wrec_autocannon', barrel: 'wbar_autocannon', extra: 'wext_shield' },
  recoilless: { mount: 'wmount_ring_wide', receiver: 'wrec_cannon', barrel: 'wbar_cannon', extra: 'wext_shield' },
  battleRifle: { mount: 'wmount_pintle', receiver: 'wrec_mg_b', barrel: 'wbar_mg_long', extra: 'wext_drum' },
  gatling: { mount: 'wmount_ring_wide', receiver: 'wrec_autocannon', barrel: 'wbar_twin', extra: 'wext_drum' },
  rocketRack: { mount: 'wmount_ring_wide', receiver: 'wrec_rocket_pod', barrel: 'wbar_rocket_tubes', extra: null },
  sniperCannon: { mount: 'wmount_cradle', receiver: 'wrec_sniper', barrel: 'wbar_sniper', extra: 'wext_scope' },
  grenadeLauncher: { mount: 'wmount_ring_wide', receiver: 'wrec_shotgun', barrel: 'wbar_autocannon', extra: 'wext_drum' },
  tankGun: { mount: 'wmount_cradle', receiver: 'wrec_tank', barrel: 'wbar_tank', extra: 'wext_shield' },
  flechette: { mount: 'wmount_ring_small', receiver: 'wrec_mg_a', barrel: 'wbar_mg_long', extra: 'wext_scope' },
  harpoon: { mount: 'wmount_pintle', receiver: 'wrec_harpoon', barrel: 'wbar_harpoon', extra: null },
};

const PART_SECTION: Record<PartDef['kind'], IconSection> = {
  weapon: 'weapon',
  engine: 'engine',
  armor: 'armor',
  cargo: 'cargo',
  store: 'store',
  scanner: 'store',
  utility: 'store',
  core: 'core',
};

export function iconCatalog(
  parts: Record<string, PartDef>,
  goods: Record<string, GoodDef>,
  chassis: Record<string, ChassisDef>,
  picks: Record<string, WeaponLook>,
): IconEntry[] {
  const drafts: IconDraft[] = [
    ...Object.values(parts).map((def) => partDraft(def, picks)),
    ...Object.values(goods).map(goodDraft),
    ...Object.values(chassis).map(chassisDraft),
  ];
  checkUniqueIds(drafts);
  return withRanks(drafts);
}

type IconDraft = { entry: Omit<IconEntry, 'rank'>; hp: number };

const CAB_ICON_MODELS: Record<string, ModelName> = { cab: 'cab_seat', cabPickup: 'cab_pickup', cabHardtop: 'cab_hardtop' };

function iconModel(defId: string): ModelName {
  if (!BODY_PARTS.has(defId)) return partModel(defId);
  const name = CAB_ICON_MODELS[defId];
  if (!name) throw new Error(`No icon model for cab ${defId}. Add it to CAB_ICON_MODELS.`);
  return name;
}

function partDraft(def: PartDef, picks: Record<string, WeaponLook>): IconDraft {
  const base = { id: def.id, section: PART_SECTION[def.kind], label: def.name, footprint: { w: def.w, h: def.h } };
  if (def.kind !== 'weapon') return { entry: { ...base, models: [iconModel(def.id)], weapon: null }, hp: def.hp };
  const weapon = picks[def.id] ?? weaponLook(`icon:${def.id}`, def.id);
  return { entry: { ...base, models: weaponModels(weapon), weapon }, hp: def.hp };
}

function goodDraft(def: GoodDef): IconDraft {
  return { entry: { id: def.id, section: 'good', label: def.name, models: [partModel(def.id)], footprint: { w: 1, h: 1 }, weapon: null }, hp: 0 };
}

const PORTRAIT_MODELS: readonly ModelName[] = ['coilover', 'axle', 'antenna', 'tow_chain'];

function chassisDraft(def: ChassisDef): IconDraft {
  const footprint = { w: def.layout[0].length, h: def.layout.length };
  const cores = def.core.filter((c) => !BODY_PARTS.has(c.defId)).map((c) => partModel(c.defId));
  const models = [...new Set([baseModel(def.id), ...cores, ...PORTRAIT_MODELS])];
  return { entry: { id: def.id, section: 'chassis', label: def.name, models, footprint, weapon: null }, hp: 0 };
}

function checkUniqueIds(drafts: readonly IconDraft[]): void {
  const ids = new Set<string>();
  for (const { entry } of drafts) {
    if (ids.has(entry.id)) throw new Error(`Icon id ${entry.id} is used twice across parts, goods and chassis`);
    ids.add(entry.id);
  }
}

function weaponModels(look: WeaponLook): ModelName[] {
  return look.extra ? [look.mount, look.receiver, look.barrel, look.extra] : [look.mount, look.receiver, look.barrel];
}

function withRanks(drafts: readonly IconDraft[]): IconEntry[] {
  const groups = new Map<string, IconDraft[]>();
  for (const d of drafts) {
    const key = d.entry.models.join('+');
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const ranks = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    group.sort((a, b) => a.hp - b.hp || a.entry.id.localeCompare(b.entry.id)).forEach((d, i) => ranks.set(d.entry.id, i + 1));
  }
  return drafts.map((d) => ({ ...d.entry, rank: ranks.get(d.entry.id) ?? 0 }));
}

export function renderKey(e: IconEntry): string {
  const footprint = e.weapon ? `@${e.footprint.w}x${e.footprint.h}` : '';
  return `${e.models.join('+')}${footprint}#${e.rank}`;
}
