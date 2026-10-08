import { ECONOMY, GOODS } from '../../data/goods';
import { partDef, type PartKind } from '../../data/parts';
import { freeCells, mountedItems, mountedParts, type Spot } from '../grid';
import { getLayoutError, installSpot } from '../inventory';
import { firepower, getUpkeepReserve } from '../npc-decisions';
import { getResources } from '../resources';
import { vehicleStats } from '../stats';
import type { GridItem, PartInstance, Vehicle, World } from '../types';
import { isJunk, maxHp, partValue } from '../wear';

// How a progression bot chooses what to buy at a garage. It takes the offers the truck can mount, scores each by what
// it adds to the bot's job, and picks the one that adds most within the budget. Only the bots use it, since no NPC
// buys parts. Executing the purchase is the caller's.
//
// A job is what the truck earns by: a fighter by its fight strength, guns times armor, a trader and a carrier by cargo room, a courier by
// speed. A carrier hauls or salvages and needs no goods money. A driver takes only parts that raise its job's score.

// What a driver earns by, which decides the gear it wants.
export type GearJob = 'fighter' | 'trader' | 'courier' | 'carrier';

export type PartItem = Extract<GridItem, { kind: 'part' }>;

// A part a driver could take and what it costs: a shop's stock at its price, or a spare the driver holds at 0.
export type Offer = { part: PartInstance; price: number };

// What taking an offer does. replaces is the mounted part sold first when no mount is free. cost is the price less
// that sale. jobGain is the change in the job's score, and worthGain the change in the parts' worth.
export type Plan<O extends Offer = Offer> = { offer: O; replaces: PartItem | null; cost: number; spot: Spot; jobGain: number; worthGain: number };

// Kinds no driver buys: built-in parts cannot be traded, and no driver reads a scanner.
const NEVER: readonly PartKind[] = ['core', 'scanner'];

// The cells goods could use if the truck carried none.
export function goodsRoom(v: Vehicle): number {
  return freeCells({ ...v, items: v.items.filter((it) => it.kind === 'part') });
}

// How strong a fighter is as it stands: firepower times toughness, the current HP of the chassis core parts and the
// mounted armor.
function fighterStrength(world: World, v: Vehicle): number {
  const toughness = [...mountedParts(v, 'core'), ...mountedParts(v, 'armor')].reduce((sum, part) => sum + part.hp, 0);
  return firepower(world, v) * toughness;
}

// The number a job grows by. A fighter's score is its danger, firepower times toughness, so it buys a gun first and
// then whichever of gun and armor adds more strength. A trader or carrier moves cargo, so its score is room times speed.
export function jobScore(world: World, v: Vehicle, job: GearJob): number {
  if (job === 'fighter') return fighterStrength(world, v);
  if (job === 'courier') return vehicleStats(world, v).maxSpeed;
  return goodsRoom(v) * vehicleStats(world, v).maxSpeed;
}

// The money a trader keeps to buy a load, one unit of an average good per free cell at the buy price. Gear comes from
// money above it. Every other job earns without goods money.
function tradeCapital(v: Vehicle): number {
  const values = Object.values(GOODS).map((g) => g.value);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return goodsRoom(v) * average * (1 + ECONOMY.spread);
}

// What a driver may spend on gear: its money above the upkeep reserve, and above the trade capital for a trader.
export function gearBudget(world: World, v: Vehicle, job: GearJob): number {
  const spendable = getResources(world, v).money - getUpkeepReserve(v);
  return job === 'trader' ? spendable - tradeCapital(v) : spendable;
}

// A part's worth at its wear and health.
export function quality(part: PartInstance): number {
  return partValue(part) * (part.hp / maxHp(part));
}

// A part as a grid item, to ask where it would mount.
export function probe(part: PartInstance): PartItem {
  return { id: 'gear-probe', x: 0, y: 0, rot: 0, kind: 'part', part };
}

function weakestOfKind(v: Vehicle, kind: PartKind): PartItem | null {
  return mountedItems(v, kind).reduce<PartItem | null>((weak, it) => (!weak || quality(it.part) < quality(weak.part) ? it : weak), null);
}

// The truck as it stands after the plan: the replaced part gone, the offered part on its spot.
function after(v: Vehicle, offer: Offer, replaces: PartItem | null, spot: Spot): Vehicle {
  const kept = v.items.filter((it) => it.id !== replaces?.id && !(it.kind === 'part' && it.part.id === offer.part.id));
  return { ...v, items: [...kept, { ...probe(offer.part), ...spot }] };
}

// Where the offer goes and what it replaces: a free mount, or else the weakest mounted part of its kind when the offer
// is better than it and the truck holds together without it. Goods stowed on cells a replaced part provides, like a
// cargo rack, would fall off the grid.
function placement(v: Vehicle, offer: Offer): { replaces: PartItem | null; spot: Spot } | null {
  const free = installSpot(v, probe(offer.part));
  if (free) return { replaces: null, spot: free };
  const weakest = weakestOfKind(v, partDef(offer.part.defId).kind);
  if (!weakest || quality(offer.part) <= quality(weakest.part)) return null;
  const rest = { ...v, items: v.items.filter((it) => it.id !== weakest.id) };
  const spot = installSpot(rest, probe(offer.part));
  return spot && getLayoutError(v, rest.items) === null ? { replaces: weakest, spot } : null;
}

// How a driver buys: `skip` names part kinds it also leaves alone, and `resale` is what the shop pays for the part a
// plan replaces. A plan that leaves fewer free cells than the lower of `lootRoom` and the free cells now, or a top speed
// below the lower of `minSpeed` and the speed now, is left out.
export type Buyer = { job: GearJob; skip: readonly PartKind[]; resale: (part: PartInstance) => number; lootRoom?: number; minSpeed?: number };

// Whether the truck after a plan keeps the free cells and the top speed the buyer asks to keep.
function keepsRoomAndSpeed(world: World, before: Vehicle, result: Vehicle, buyer: Buyer): boolean {
  const room = buyer.lootRoom === undefined || freeCells(result) >= Math.min(buyer.lootRoom, freeCells(before));
  const speed = buyer.minSpeed === undefined || vehicleStats(world, result).maxSpeed >= Math.min(buyer.minSpeed, vehicleStats(world, before).maxSpeed);
  return room && speed;
}

// Every plan that does not lower the job's score.
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

// The plan with the most job gain within the budget, ties broken by worth gained. Nothing when no plan gains in the
// job, so a driver saving for a gun does not spend its money on a part that does not help it.
export function bestPlan<O extends Offer>(plans: readonly Plan<O>[], budget: number): Plan<O> | null {
  const gains = plans.filter((p) => p.cost <= budget && p.jobGain > 0);
  return gains.reduce<Plan<O> | null>((best, p) => (!best || p.jobGain > best.jobGain || (p.jobGain === best.jobGain && p.worthGain > best.worthGain) ? p : best), null);
}
