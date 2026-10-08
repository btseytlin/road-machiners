// Rescue of a save that cannot load: reads what the player cannot get back from its raw JSON and carries it to
// a new world on the current map. It checks JSON shapes only. What the ids mean is known by carriedWorld().

import type { StartKit } from '../data/start';
import type { BakedMap } from '../sim/terrain';
import { carriedWorld, type Carried, type CarriedItem, type CarriedPart, type CarryReport } from '../sim/world';
import type { World } from '../sim/types';
import type { SlotId } from './save-slots';
import { CENTS_PER_MONEY_29_30, pooledSkills_9_10 } from './save-migrations';
import { storedSave, tryWriteSave } from './save';

type Json = Record<string, unknown>;

function objectOf(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function flagOf(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

// Each own entry with a finite non-negative number.
function countsOf(value: unknown): Record<string, number> {
  const entries = Object.entries(objectOf(value) ?? {}).map(([key, n]) => [key, countOf(n)] as const);
  return Object.fromEntries(entries.filter((e): e is [string, number] => e[1] !== null));
}

function partOf(value: unknown): CarriedPart | null {
  const part = objectOf(value);
  const defId = idOf(part?.defId);
  if (!part || defId === null) return null;
  return { defId, wear: countOf(part.wear) ?? 0, hp: countOf(part.hp) ?? 0, rebuilt: part.rebuilt === true };
}

function isGridInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function spotOf(item: Json): { x: number; y: number; rot: 0 | 1 } | null {
  return isGridInt(item.x) && isGridInt(item.y) ? { x: item.x, y: item.y, rot: item.rot === 1 ? 1 : 0 } : null;
}

function itemOf(value: unknown): CarriedItem | null {
  const item = objectOf(value);
  const spot = item && spotOf(item);
  if (!item || !spot) return null;
  return item.kind === 'part' ? partItemOf(item, spot) : goodItemOf(item, spot);
}

function partItemOf(item: Json, spot: NonNullable<ReturnType<typeof spotOf>>): CarriedItem | null {
  const part = partOf(item.part);
  return part && { ...spot, kind: 'part', part };
}

function goodItemOf(item: Json, spot: NonNullable<ReturnType<typeof spotOf>>): CarriedItem | null {
  const good = idOf(item.good);
  return item.kind === 'good' && good !== null ? { ...spot, kind: 'good', good } : null;
}

function truckOf(world: Json, player: Json): Carried['truck'] {
  const vehicle = listOf(world.vehicles).map(objectOf).find((v) => v !== null && v.id === player.vehicleId);
  const chassisId = idOf(vehicle?.chassisId);
  if (!vehicle || chassisId === null) return null;
  const items = listOf(vehicle.items).map(itemOf).filter((it): it is CarriedItem => it !== null);
  return { chassisId, name: idOf(vehicle.name), items };
}

const NO_CARRIED: Carried = {
  seed: null, money: null, xp: null, ranks: {}, xpBySource: {}, perks: [], discovered: [], knockouts: null, autoFire: null,
  autoRepair: null, fuel: null, supplies: null, costBasis: {}, truck: null, storage: [], setup: undefined,
};

// What a save holds of the player's progression. Never throws: anything of the wrong type reads as missing.
export function readCarried(raw: unknown): Carried {
  const world = objectOf(objectOf(raw)?.world);
  const player = objectOf(world?.player);
  if (!world || !player) return NO_CARRIED;
  const scale = moneyScale_29_30(raw);
  return {
    seed: isGridInt(world.seed) ? world.seed : null,
    money: centsOf(player.money, scale),
    ...pooledOf(player),
    xpBySource: countsOf(player.xpBySource),
    perks: listOf(player.perks).flatMap((id) => idOf(id) ?? []),
    discovered: listOf(player.discovered).flatMap((id) => idOf(id) ?? []),
    knockouts: countOf(player.knockouts),
    autoFire: flagOf(player.autoFire),
    autoRepair: flagOf(player.autoRepair),
    fuel: countOf(player.fuel),
    supplies: countOf(player.supplies),
    costBasis: Object.fromEntries(Object.entries(countsOf(player.costBasis)).map(([good, basis]) => [good, basis * scale])),
    truck: truckOf(world, player),
    storage: listOf(player.storage).flatMap((p) => partOf(p) ?? []),
    setup: world.setup, // carriedWorld() checks and repairs it
  };
}

// Money in a save from before format 2.30 is in the old unit, a third of an M per fuel unit, as the 29 to 30 step
// reads it. A save with no format is older still. A newer major format is not old money.
function moneyScale_29_30(raw: unknown): number {
  const format = objectOf(objectOf(raw)?.format);
  const part = (key: 'major' | 'minor'): number => (typeof format?.[key] === 'number' ? format[key] : 0);
  return part('major') * 1000 + part('minor') < 2030 ? CENTS_PER_MONEY_29_30 : 1;
}

function centsOf(value: unknown, scale: number): number | null {
  const money = countOf(value);
  return money === null ? null : Math.round(money * scale);
}

// The XP pool and skill ranks. A save from before format 2.10 holds XP per skill, which reads as the 2.9 to 2.10 step
// reads it.
function pooledOf(player: Json): Pick<Carried, 'xp' | 'ranks'> {
  if (objectOf(player.ranks)) return { xp: countOf(player.xp), ranks: countsOf(player.ranks) };
  return pooledSkills_9_10(countsOf(player.skills));
}

// Builds a new world from the stored save and stores it, so the next boot loads it. Null when the stored
// save is not a JSON object, which leaves nothing to carry.
export function rescueSave(storage: Storage, slot: SlotId, map: BakedMap, kit: StartKit, freshSeed: () => number, savedAt: number): { world: World; report: CarryReport } | null {
  const parsed = storedSave(storage, slot);
  if (objectOf(parsed) === null) return null;
  const rescued = carriedWorld(readCarried(parsed), kit, map, freshSeed);
  tryWriteSave(storage, slot, rescued.world, savedAt);
  return rescued;
}
