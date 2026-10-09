import { ECONOMY, GOODS } from '../../data/goods';
import { partDef, type PartKind } from '../../data/parts';
import { freeCells, mountedItems, mountedParts, type Spot } from '../grid';
import { getLayoutError, installSpot } from '../inventory';
import { firepower, getUpkeepReserve } from '../npc-decisions';
import { getResources } from '../resources';
import { vehicleStats } from '../stats';
import type { GridItem, PartInstance, Vehicle, World } from '../types';
import { isJunk, maxHp, partValue } from '../wear';

export type GearJob = 'fighter' | 'trader' | 'courier' | 'carrier';

export type PartItem = Extract<GridItem, { kind: 'part' }>;

export type Offer = { part: PartInstance; price: number };

export type Plan<O extends Offer = Offer> = { offer: O; replaces: PartItem | null; cost: number; spot: Spot; jobGain: number; worthGain: number };

const NEVER: readonly PartKind[] = ['core', 'scanner'];

export function goodsRoom(v: Vehicle): number {
  return freeCells({ ...v, items: v.items.filter((it) => it.kind === 'part') });
}

function fighterStrength(world: World, v: Vehicle): number {
  const toughness = [...mountedParts(v, 'core'), ...mountedParts(v, 'armor')].reduce((sum, part) => sum + part.hp, 0);
  return firepower(world, v) * toughness;
}

export function jobScore(world: World, v: Vehicle, job: GearJob): number {
  if (job === 'fighter') return fighterStrength(world, v);
  if (job === 'courier') return vehicleStats(world, v).maxSpeed;
  return goodsRoom(v) * vehicleStats(world, v).maxSpeed;
}

function tradeCapital(v: Vehicle): number {
  const values = Object.values(GOODS).map((g) => g.value);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return goodsRoom(v) * average * (1 + ECONOMY.spread);
}

export function gearBudget(world: World, v: Vehicle, job: GearJob): number {
  const spendable = getResources(world, v).money - getUpkeepReserve(v);
  return job === 'trader' ? spendable - tradeCapital(v) : spendable;
}

export function quality(part: PartInstance): number {
  return partValue(part) * (part.hp / maxHp(part));
}

export function probe(part: PartInstance): PartItem {
  return { id: 'gear-probe', x: 0, y: 0, rot: 0, kind: 'part', part };
}

function weakestOfKind(v: Vehicle, kind: PartKind): PartItem | null {
  return mountedItems(v, kind).reduce<PartItem | null>((weak, it) => (!weak || quality(it.part) < quality(weak.part) ? it : weak), null);
}

function after(v: Vehicle, offer: Offer, replaces: PartItem | null, spot: Spot): Vehicle {
  const kept = v.items.filter((it) => it.id !== replaces?.id && !(it.kind === 'part' && it.part.id === offer.part.id));
  return { ...v, items: [...kept, { ...probe(offer.part), ...spot }] };
}

function placement(v: Vehicle, offer: Offer): { replaces: PartItem | null; spot: Spot } | null {
  const free = installSpot(v, probe(offer.part));
  if (free) return { replaces: null, spot: free };
  const weakest = weakestOfKind(v, partDef(offer.part.defId).kind);
  if (!weakest || quality(offer.part) <= quality(weakest.part)) return null;
  const rest = { ...v, items: v.items.filter((it) => it.id !== weakest.id) };
  const spot = installSpot(rest, probe(offer.part));
  return spot && getLayoutError(v, rest.items) === null ? { replaces: weakest, spot } : null;
}

export type Buyer = { job: GearJob; skip: readonly PartKind[]; resale: (part: PartInstance) => number; lootRoom?: number; minSpeed?: number };

function keepsRoomAndSpeed(world: World, before: Vehicle, result: Vehicle, buyer: Buyer): boolean {
  const room = buyer.lootRoom === undefined || freeCells(result) >= Math.min(buyer.lootRoom, freeCells(before));
  const speed = buyer.minSpeed === undefined || vehicleStats(world, result).maxSpeed >= Math.min(buyer.minSpeed, vehicleStats(world, before).maxSpeed);
  return room && speed;
}

export function gearPlans<O extends Offer>(world: World, v: Vehicle, offers: readonly O[], buyer: Buyer): Plan<O>[] {
  const now = jobScore(world, v, buyer.job);
  return offers.filter((o) => !isJunk(o.part) && ![...NEVER, ...buyer.skip].includes(partDef(o.part.defId).kind)).flatMap((offer) => {
    const place = placement(v, offer);
    if (!place) return [];
    const result = after(v, offer, place.replaces, place.spot);
    if (!keepsRoomAndSpeed(world, v, result, buyer)) return [];
    const jobGain = jobScore(world, result, buyer.job) - now;
    if (jobGain < 0) return [];
    const resale = place.replaces ? buyer.resale(place.replaces.part) : 0;
    const given = place.replaces ? quality(place.replaces.part) : 0;
    return [{ offer, ...place, cost: offer.price - resale, jobGain, worthGain: quality(offer.part) - given }];
  });
}

export function bestPlan<O extends Offer>(plans: readonly Plan<O>[], budget: number): Plan<O> | null {
  const gains = plans.filter((p) => p.cost <= budget && p.jobGain > 0);
  return gains.reduce<Plan<O> | null>((best, p) => (!best || p.jobGain > best.jobGain || (p.jobGain === best.jobGain && p.worthGain > best.worthGain) ? p : best), null);
}
