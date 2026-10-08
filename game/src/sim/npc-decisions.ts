// Weighted NPC decisions. A decision point offers options. An option is available when the driver physically can
// take it now. Each available option's final weight is (base + adds) x muls x situation factor. Bases live in
// DECISIONS. Adds and muls come from the NPC's traits, and from the states it holds toward the decision's subject.

import { dealAvailable } from './patch';
import { canSpareFor } from './aid';
import { ECONOMY } from '../data/goods';
import { GOOD_SOURCES, SHOPS, type ShopDef } from '../data/market';
import {
  DECISIONS, HUNT, MIN_CHANCE, NPCS, NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, STATE_WEIGHTS, TRAITS,
  type DecisionId, type DecisionOptions, type Trait, type TraitId, type TraitWeights, type Weighted, type WeightChange,
} from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { huntsForLoot, inCombatWithOther, isHostile } from './combat';
import { ramFactor, ramImpact } from './crash-contact';
import { isKnockedOut } from './defeat';
import { vehicleById } from './damage';
import { contactsOf } from './detect';
import { getTradePrice } from './economy';
import { cargoValue } from './market';
import { maxHp } from './wear';
import { corePart, freeCells, hasLoot, mountedParts } from './grid';
import { isTownGuarded } from './guards';
import { topGoal } from './npc-activities';
import { sampleWeighted } from './npc-loadout';
import { getResources } from './resources';
import { skillEffect } from './progress';
import { randRange } from './rng';
import { backedOff, canReachSalvage, canTakeAny, canTakeFromTruck, hasSalvage, holdsClaim, jobTarget, lootBlocker, siteLootTable } from './salvage';
import { canUseSite, siteGates, sitePads, siteUnder, type Site } from './sites';
import { boundTo, givesWord, stateOf, statesHeld } from './states';
import { fuelCap, isStranded, suppliesCap, vehicleStats } from './stats';
import { canHire, canTakeEscort, declineFactor, inTowReach, isOnRope, strandedAt, towSite, unguardedLeader } from './tow';
import type { Contact, NpcActivity, SalvageStock, Vehicle, World } from './types';
import { clamp, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

export type NpcProfile = {
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
  robs: Trait['robs'];
};

export function npcTraits(v: Vehicle): TraitId[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain`);
  const traits = v.brain.traits;
  if (!traits) throw new Error(`${v.id} has no traits`);
  for (const id of traits) if (!Object.hasOwn(TRAITS, id)) throw new Error(`${v.id} has unknown trait ${id}`);
  return traits;
}

export function hasTrait(v: Vehicle, id: TraitId): boolean {
  return npcTraits(v).includes(id);
}

export function profileOf(traits: TraitId[]): NpcProfile {
  if (traits.length === 0) throw new Error('A profile needs at least one trait');
  const defs = traits.map((id) => {
    if (!Object.hasOwn(TRAITS, id)) throw new Error(`Unknown trait ${id}`);
    return TRAITS[id];
  });
  const union = (key: 'towns' | 'bases' | 'markets' | 'salvageSites' | 'supplySites' | 'travelSites' | 'haulSites') => [...new Set(defs.flatMap((t) => t[key]))];
  return {
    towns: union('towns'),
    bases: union('bases'),
    markets: union('markets'),
    salvageSites: union('salvageSites'),
    supplySites: union('supplySites'),
    travelSites: union('travelSites'),
    haulSites: union('haulSites'),
    contactReactRadius: Math.max(...defs.map((t) => t.contactReactRadius)),
    boldness: defs.reduce((product, t) => product * t.boldness, 1),
    fuelMargin: defs.reduce((product, t) => product * t.fuelMargin, 1),
    robs: defs.some((t) => t.robs === 'never') ? 'never' : 'offDuty',
  };
}

export function npcProfile(v: Vehicle): NpcProfile {
  return profileOf(npcTraits(v));
}

export function getKnownSite(id: string) {
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site;
}

export function getCombatCondition(world: World, vehicle: Vehicle): number {
  return isStranded(world, vehicle) ? 0 : bodyCondition(vehicle);
}

export function bodyCondition(vehicle: Vehicle): number {
  const cab = corePart(vehicle, 'cab');
  const parts = mountedParts(vehicle);
  const overall = parts.reduce((sum, part) => sum + part.hp / maxHp(part), 0) / parts.length;
  return Math.min(cab.hp / maxHp(cab), overall);
}

export function firepower(world: World, vehicle: Vehicle): number {
  return vehicleStats(world, vehicle).weapons.filter((weapon) => weapon.part.hp > 0).reduce((sum, weapon) => sum + weapon.def.round.damage * weapon.def.rounds, 0);
}

export function vehicleDanger(world: World, vehicle: Vehicle): number {
  const toughness = [...mountedParts(vehicle, 'core'), ...mountedParts(vehicle, 'armor')].reduce((sum, part) => sum + part.hp, 0);
  return firepower(world, vehicle) * toughness;
}

function localGroup(world: World, observer: Vehicle, member: Vehicle): Vehicle[] {
  return world.vehicles.filter((v) => v.id === member.id || (v.id !== observer.id && v.faction === member.faction
    && dist(v.pos, member.pos) <= SPAWN.neighborHelp && canVehicleSee(world, observer, v.pos)));
}

export function perceiveDanger(world: World, observer: Vehicle, other: Vehicle): number {
  const spread = NPC_BEHAVIOR.dangerSpread;
  const danger = localGroup(world, observer, other).reduce((sum, v) => sum + vehicleDanger(world, v), 0);
  return danger * randRange(world, 1 - spread, 1 + spread);
}

export function ownDanger(world: World, vehicle: Vehicle): number {
  const group = localGroup(world, vehicle, vehicle).filter((v) => v.id === vehicle.id || !isHostile(world, vehicle, v));
  return group.reduce((sum, v) => sum + vehicleDanger(world, v), 0);
}

function isManageable(world: World, vehicle: Vehicle, danger: number): boolean {
  return danger <= ownDanger(world, vehicle) * NPC_BEHAVIOR.threatRatio * npcProfile(vehicle).boldness;
}

export function isWeak(world: World, vehicle: Vehicle): boolean {
  const threshold = topGoal(vehicle)?.kind === 'flee' ? NPC_BEHAVIOR.recoverCondition : NPC_BEHAVIOR.fleeCondition;
  return getCombatCondition(world, vehicle) <= threshold || getResources(world, vehicle).health / RULES.maxHealth <= threshold;
}

export function visibleHostiles(world: World, vehicle: Vehicle): Vehicle[] {
  const enemies = world.vehicles.filter((other) => other.id !== vehicle.id && isHostile(world, vehicle, other) && canVehicleSee(world, vehicle, other.pos));
  return enemies.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

export function usefulContacts(world: World, vehicle: Vehicle): Contact[] {
  const radius = npcProfile(vehicle).contactReactRadius;
  const useful = contactsOf(world, vehicle, Infinity).filter((contact) => contact.radius <= radius);
  return useful.sort((a, b) => dist(vehicle.pos, a.center) - dist(vehicle.pos, b.center));
}

const WORK: readonly NpcActivity['kind'][] = ['scavenge', 'sell', 'trade', 'resupply', 'loot', 'repair', 'travel', 'haul'];

function isBusy(vehicle: Vehicle): boolean {
  const kind = topGoal(vehicle)?.kind;
  return kind !== undefined && WORK.includes(kind);
}

function threatens(world: World, vehicle: Vehicle, other: Vehicle): boolean {
  if (other.id in vehicle.brain!.attackers) return true;
  return aimsOf(other).some((id) => id === vehicle.id || isNearbyMate(world, vehicle, id));
}

function aimsOf(other: Vehicle): string[] {
  const aims = Object.values(other.weaponOrders).map((order) => order.targetId);
  const fight = other.brain ? topGoal(other) : null;
  return fight?.kind === 'fight' && fight.targetId ? [...aims, fight.targetId] : aims;
}

function isNearbyMate(world: World, vehicle: Vehicle, id: string): boolean {
  const mate = world.vehicles.find((v) => v.id === id);
  if (!mate || mate.faction !== vehicle.faction) return false;
  return dist(mate.pos, vehicle.pos) <= SPAWN.neighborHelp && canVehicleSee(world, vehicle, mate.pos);
}

export function isHostileContact(world: World, vehicle: Vehicle, contact: Contact): boolean {
  return world.vehicles.some((other) => other.id === contact.vehicleId && isHostile(world, vehicle, other));
}

export function getUpkeepReserve(vehicle: Vehicle): number {
  return (fuelCap(vehicle) * ECONOMY.supplyPrice.fuel + suppliesCap(vehicle) * ECONOMY.supplyPrice.supplies) * NPC_UPKEEP.reserveLoads;
}

export type TradePlan = { source: string; good: string; sellShop: string };

export function tradeOffers(world: World, vehicle: Vehicle): Weighted<TradePlan>[] {
  const spend = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  const shops = Object.values(SHOPS);
  return shops.flatMap((source) => shops.filter((buyer) => buyer.id !== source.id).flatMap((buyer) => runOffers(world, vehicle, source, buyer, spend)));
}

function runOffers(world: World, vehicle: Vehicle, source: ShopDef, buyer: ShopDef, spend: number): Weighted<TradePlan>[] {
  const sourcePos = getKnownSite(source.id).pos;
  const trip = dist(vehicle.pos, sourcePos) + dist(sourcePos, getKnownSite(buyer.id).pos);
  return source.goods.filter((good) => buyer.goods.includes(good)).flatMap((good) => {
    const buy = getTradePrice(world, vehicle, source.id, good, 'buy');
    const profit = getTradePrice(world, vehicle, buyer.id, good, 'sell') - buy;
    return spend >= buy && profit > 0 ? [{ value: { source: source.id, good, sellShop: buyer.id }, weight: profit / trip }] : [];
  });
}

export function visibleSalvage(world: World, vehicle: Vehicle): SalvageStock[] {
  const visible = world.salvage.filter((stock) => seesSalvage(world, vehicle, stock));
  return visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

export function visibleDowned(world: World, vehicle: Vehicle): Vehicle[] {
  const visible = world.vehicles.filter((v) => seesDowned(world, vehicle, v));
  return visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

function seesDowned(world: World, vehicle: Vehicle, target: Vehicle): boolean {
  if (target.id === vehicle.id || !isKnockedOut(target) || !canVehicleSee(world, vehicle, target.pos)) return false;
  return (!inTowReach(vehicle, target) || canTakeFromTruck(vehicle, target)) && lootTaken(world, vehicle, target.id) === null;
}

function seesSalvage(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  if (backedOff(stock, vehicle.id) || !canVehicleSee(world, vehicle, stock.pos)) return false;
  return (!canReachSalvage(vehicle, stock) || canTakeAny(world, vehicle, stock)) && lootTaken(world, vehicle, stock.id) === null;
}

export function lootTaken(world: World, vehicle: Vehicle, targetId: string | null): string | null {
  if (targetId === null || worksOnLoot(vehicle, targetId)) return null;
  return lootBlocker(world, vehicle, targetId) ? 'someone else is looting it' : null;
}

export function worksOnLoot(vehicle: Vehicle, targetId: string): boolean {
  return jobTarget(vehicle) === targetId;
}

export function stockLootInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const stock = world.salvage.find((s) => s.id === goal.targetId);
  if (!stock) return 'the loot is gone';
  if (!canReachSalvage(vehicle, stock)) return freeCells(vehicle) === 0 ? 'cargo cannot hold the loot' : null;
  if (!hasSalvage(stock)) return 'nothing left to loot';
  return canTakeAny(world, vehicle, stock) ? null : 'cargo cannot hold the loot';
}

export function truckLootInvalid(vehicle: Vehicle, truck: Vehicle): string | null {
  if (!isKnockedOut(truck)) return 'the truck got away';
  if (vehicle.job?.kind === 'refit' || !inTowReach(vehicle, truck)) return null;
  return canTakeFromTruck(vehicle, truck) ? null : 'cargo cannot hold the loot';
}

export function salvageSitesAway(vehicle: Vehicle) {
  return npcProfile(vehicle).salvageSites.map(getKnownSite).filter((site) => !canUseSite(vehicle.pos, site));
}

let grounds: readonly Vec[] | null = null;

export function huntingGrounds(): readonly Vec[] {
  if (grounds) return grounds;
  const sites = [...REGION.towns, ...REGION.locations];
  const lonely = (p: Vec) => sites.every((site) => dist(p, site.pos) - site.radius >= HUNT.siteDistance);
  const roadPoints = REGION.roads.flatMap((road) => pointsAlong(road, HUNT.roadSpacing)).filter(lonely);
  const lootPads = REGION.locations.filter((site) => site.kind !== 'camp' && siteLootTable(site)).flatMap((site) => sitePads(site));
  grounds = [...roadPoints, ...lootPads];
  return grounds;
}

function pointsAlong(line: readonly Vec[], spacing: number): Vec[] {
  const points: Vec[] = [];
  let next = spacing / 2;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = dist(a, b);
    for (; next <= walked + length; next += spacing) {
      const t = (next - walked) / length;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    walked += length;
  }
  return points;
}

export function huntingGroundsAway(vehicle: Vehicle): Vec[] {
  return huntingGrounds().filter((point) => dist(vehicle.pos, point) > RULES.arriveRadius * 2);
}

const raiderStops = new Map<string, readonly Vec[]>();

export function lawmanTowns(): readonly Site[] {
  const ids = new Set(Object.values(NPCS).filter((t) => t.traits.includes('lawman') && t.spawn.kind === 'sites').flatMap((t) => (t.spawn.kind === 'sites' ? t.spawn.ids : [])));
  return [...ids].map(getKnownSite);
}

export function raiderGrounds(camp: Site): readonly Vec[] {
  const cached = raiderStops.get(camp.id);
  if (cached) return cached;
  const camps = REGION.locations.filter((site) => site.kind === 'camp');
  const nearestCamp = (p: Vec) => camps.reduce((best, c) => (dist(p, c.pos) < dist(p, best.pos) ? c : best));
  const gates = lawmanTowns().flatMap((town) => siteGates(town));
  const points = huntingGrounds().filter((p) => nearestCamp(p).id === camp.id && gates.every((gate) => dist(gate, p) > HUNT.lawReach));
  raiderStops.set(camp.id, points);
  return points;
}

export function raiderGroundsAway(vehicle: Vehicle): Vec[] {
  return raiderGrounds(homeCamp(vehicle)).filter((point) => dist(vehicle.pos, point) > RULES.arriveRadius * 2);
}

function nearestHome(vehicle: Vehicle, ids: readonly string[]): Site {
  const home = vehicle.brain!.home;
  return ids.map(getKnownSite).sort((a, b) => dist(home, a.pos) - dist(home, b.pos))[0];
}

export function homeCamp(vehicle: Vehicle): Site {
  const { bases } = npcProfile(vehicle);
  if (bases.length === 0) throw new Error(`${vehicle.id} knows no camp`);
  return nearestHome(vehicle, bases);
}

export function patrolSite(vehicle: Vehicle): Site {
  return npcProfile(vehicle).bases.length > 0 ? homeCamp(vehicle) : nearestHome(vehicle, npcProfile(vehicle).towns);
}

const patrolStops = new Map<string, readonly Vec[]>();

export function patrolPoints(site: Site): readonly Vec[] {
  const cached = patrolStops.get(site.id);
  if (cached) return cached;
  const gates = siteGates(site);
  const near = (p: Vec) => gates.some((gate) => dist(gate, p) <= NPC_BEHAVIOR.patrolRadius);
  const points = REGION.roads.flatMap((road) => pointsAlong(road, NPC_BEHAVIOR.patrolSpacing)).filter((p) => near(p) && siteUnder(p) === null);
  patrolStops.set(site.id, points);
  return points;
}

export function travelSitesAway(vehicle: Vehicle) {
  return npcProfile(vehicle).travelSites.map(getKnownSite).filter((site) => !canUseSite(vehicle.pos, site));
}

export function haulGoods(siteId: string): string[] {
  const goods = Object.entries(GOOD_SOURCES).flatMap(([good, sites]) => (sites.includes(siteId) ? [good] : []));
  if (goods.length === 0) throw new Error(`${siteId} is no source of any good`);
  return goods;
}

export function canRob(w: World, robber: Vehicle, target: Vehicle): boolean {
  if (robber.id === target.id || !isRobbable(w, target) || inCombatWithOther(w, target, robber.id)) return false;
  return isFairGame(w, robber, target) && canVehicleSee(w, robber, target.pos);
}

function isFairGame(w: World, robber: Vehicle, target: Vehicle): boolean {
  return !isHostile(w, robber, target) && !boundTo(w, robber.id, target.id);
}

function isRobbable(w: World, target: Vehicle): boolean {
  return hasLoot(target) && !isKnockedOut(target) && !isOnRope(w, target.id);
}

type Availability = (world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null) => boolean;

const always = (): boolean => true;

function canSpareSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  if (subjectOf(world, decision, subject).id !== world.player.vehicleId) throw new Error(`${decision} gives aid only to the player`);
  return canSpareFor(world, vehicle);
}

function canHireSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return canHire(world, vehicle, subjectOf(world, decision, subject));
}

function canTakeSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return canTakeEscort(world, vehicle, subjectOf(world, decision, subject));
}

function subjectOf(world: World, decision: DecisionId, subject: string | null): Vehicle {
  if (subject === null) throw new Error(`${decision} needs a subject`);
  return vehicleById(world, subject);
}

function canFight(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return firepower(world, vehicle) > 0 && canVehicleSee(world, vehicle, subjectOf(world, decision, subject).pos);
}

function canDrive(world: World, vehicle: Vehicle): boolean {
  return getResources(world, vehicle).fuel > 0;
}

function canRobSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  if (!traitsAllowRobbing(vehicle)) return false;
  return firepower(world, vehicle) > 0 && canRob(world, vehicle, subjectOf(world, decision, subject));
}

function traitsAllowRobbing(vehicle: Vehicle): boolean {
  const robs = npcProfile(vehicle).robs;
  return robs === 'offDuty' && !vehicle.brain!.goals.some((goal) => goal.kind === 'follow');
}

function canRamSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  const target = subjectOf(world, decision, subject);
  const top = topGoal(vehicle);
  return top?.kind === 'fight' && top.targetId === target.id && ramImpact(world, vehicle, target) !== null;
}

function canTow(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return strandedAt(world, vehicle, subjectOf(world, decision, subject)) !== null;
}

function canResume(_world: World, vehicle: Vehicle): boolean {
  return topGoal(vehicle) !== null;
}

function canTrade(world: World, vehicle: Vehicle): boolean {
  return tradeOffers(world, vehicle).length > 0;
}

function canScavenge(world: World, vehicle: Vehicle): boolean {
  if (freeCells(vehicle) === 0) return false;
  return visibleSalvage(world, vehicle).length > 0 || visibleDowned(world, vehicle).length > 0 || salvageSitesAway(vehicle).length > 0;
}

function canLootSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  if (subject === null) throw new Error(`${decision} needs a subject`);
  if (freeCells(vehicle) === 0) return false;
  const stock = world.salvage.find((entry) => entry.id === subject);
  if (stock) return seesSalvage(world, vehicle, stock);
  const truck = world.vehicles.find((v) => v.id === subject);
  return truck !== undefined && seesDowned(world, vehicle, truck);
}

function canRaid(_world: World, vehicle: Vehicle): boolean {
  return vehicle.faction === 'raiders' && raiderGroundsAway(vehicle).length > 0;
}

function canProwl(world: World, vehicle: Vehicle): boolean {
  return canDrive(world, vehicle) && huntingGroundsAway(vehicle).length > 0;
}

function canPatrol(_world: World, vehicle: Vehicle): boolean {
  return (hasTrait(vehicle, 'lawman') || hasTrait(vehicle, 'raider')) && patrolPoints(patrolSite(vehicle)).length > 0;
}

function canTravel(_world: World, vehicle: Vehicle): boolean {
  return travelSitesAway(vehicle).length > 0;
}

function canHaul(_world: World, vehicle: Vehicle): boolean {
  return freeCells(vehicle) > 0 && npcProfile(vehicle).haulSites.length > 0;
}

function canEscort(world: World, vehicle: Vehicle): boolean {
  return hasTrait(vehicle, 'guard') && unguardedLeader(world, vehicle) !== null;
}

type OptionName = DecisionOptions[DecisionId];

const AVAILABLE: Record<OptionName, Availability> = {
  keep: always,
  fight: canFight,
  fightBack: canFight,
  flee: canDrive,
  investigate: canDrive,
  rob: canRobSubject,
  ram: canRamSubject,
  tow: canTow,
  resume: canResume,
  new: always,
  trade: canTrade,
  scavenge: canScavenge,
  raid: canRaid,
  prowl: canProwl,
  loot: canLootSubject,
  wait: always,
  patrol: canPatrol,
  travel: canTravel,
  explore: canDrive,
  haul: canHaul,
  escort: canEscort,
  paid: dealAvailable('paid'),
  ownParts: dealAvailable('ownParts'),
  free: dealAvailable('free'),
  forgive: always,
  retaliate: always,
  truce: always,
  beg: always,
  accept: always,
  refuse: always,
  spare: always,
  offer: always,
  finish: always,
  rush: canDrive,
  halt: always,
  veer: canDrive,
  comply: always,
  demand: always,
  attack: always,
  hire: canHireSubject,
  take: canTakeSubject,
  decline: always,
  give: canSpareSubject,
  aid: canSpareSubject,
};

type SituationFactor = (world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null) => number;

const neutral = (): number => 1;

function weakFlee(world: World, vehicle: Vehicle): number {
  return isWeak(world, vehicle) ? NPC_BEHAVIOR.weakFlee : 1;
}

function threatFlee(world: World, vehicle: Vehicle, danger: number | null): number {
  return danger !== null && !isManageable(world, vehicle, danger) ? NPC_BEHAVIOR.threatFlee : 1;
}

function fleeSeenFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return threatFlee(world, vehicle, danger) * weakFlee(world, vehicle);
}

function fleeHeardFactor(world: World, vehicle: Vehicle): number {
  return weakFlee(world, vehicle);
}

function fleeAttackedFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  const cabMax = maxHp(corePart(vehicle, 'cab'));
  const hit = NPC_BEHAVIOR.missFlee + vehicle.brain!.hurt / cabMax / NPC_BEHAVIOR.hurtFullFlee;
  return hit * weakFlee(world, vehicle) * threatFlee(world, vehicle, danger);
}

const FLEE_FACTORS: Partial<Record<DecisionId, SituationFactor>> = { hostileSeen: fleeSeenFactor, contactHeard: fleeHeardFactor, attacked: fleeAttackedFactor, threatened: fleeSeenFactor };

function fleeFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const factor = FLEE_FACTORS[decision];
  if (!factor) throw new Error(`No flee option at ${decision}`);
  return factor(world, vehicle, decision, subject, danger);
}

type AppealCurve = { poor: number; rich: number; poorMul: number };

export function lootAppeal(value: number, curve: AppealCurve): number {
  if (value <= curve.poor) return curve.poorMul;
  if (value >= curve.rich) return 1;
  return curve.poorMul ** (1 - (value - curve.poor) / (curve.rich - curve.poor));
}

function appealOf(world: World, vehicle: Vehicle, target: Vehicle, curve: AppealCurve): number {
  return stateOf(world, 'revenge', vehicle.id, target.id) ? 1 : lootAppeal(cargoValue(target), curve);
}

function robFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const target = subjectOf(world, decision, subject);
  const seen = danger === null ? null : danger * (1 + skillEffect(world, target, 'social', 'robberyDanger'));
  const stronger = seen !== null && seen >= ownDanger(world, vehicle) * npcProfile(vehicle).boldness;
  const appeal = appealOf(world, vehicle, target, NPC_BEHAVIOR.lootAppeal.rob);
  return (stronger ? NPC_BEHAVIOR.robStronger : 1) * appeal * guardFactor(vehicle, target, NPC_BEHAVIOR.robNearGuards);
}

function guardFactor(vehicle: Vehicle, subject: Vehicle, nearGuards: number): number {
  if (hasTrait(vehicle, 'lawman')) return 1;
  return isTownGuarded(vehicle.pos) || isTownGuarded(subject.pos) ? nearGuards : 1;
}

function fightFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const target = subjectOf(world, decision, subject);
  const eager = !isBusy(vehicle) && danger !== null && isManageable(world, vehicle, danger);
  const lootOnly = decision === 'hostileSeen' && huntsForLoot(world, vehicle, target);
  const appeal = lootOnly ? appealOf(world, vehicle, target, NPC_BEHAVIOR.lootAppeal.raid) : 1;
  return (eager ? NPC_BEHAVIOR.manageableFight : 1) * appeal * guardFactor(vehicle, target, NPC_BEHAVIOR.fightNearGuards);
}

function fightBackFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return danger !== null && isManageable(world, vehicle, danger) ? NPC_BEHAVIOR.manageableFight : 1;
}

function keepFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  if (decision !== 'hostileSeen' && decision !== 'contactHeard') return 1;
  const other = subjectOf(world, decision, subject);
  const restrained = isBusy(vehicle) && !isWeak(world, vehicle) && !threatens(world, vehicle, other);
  return restrained ? NPC_BEHAVIOR.keepWork : 1;
}

function ramWeight(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  return ramFactor(world, vehicle, subjectOf(world, decision, subject));
}

function retaliateFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  return subjectOf(world, decision, subject).faction === vehicle.faction ? NPC_BEHAVIOR.mateRetaliate : 1;
}

function truceFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  if (danger !== null && !isManageable(world, vehicle, danger)) return NPC_BEHAVIOR.threatTruce;
  return isWeak(world, vehicle) ? 1 : NPC_BEHAVIOR.winningTruce;
}

function begFactor(world: World, vehicle: Vehicle): number {
  return isWeak(world, vehicle) ? NPC_BEHAVIOR.weakBeg : 1;
}

function wantsPeace(world: World, vehicle: Vehicle, danger: number | null): boolean {
  return (danger !== null && !isManageable(world, vehicle, danger)) || isWeak(world, vehicle);
}

function acceptFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return wantsPeace(world, vehicle, danger) ? NPC_BEHAVIOR.threatAccept : 1;
}

function refuseFactor(world: World, vehicle: Vehicle, _decision: DecisionId, subject: string | null, danger: number | null): number {
  return robs(world, vehicle, subject) && !wantsPeace(world, vehicle, danger) ? NPC_BEHAVIOR.robberRefuse : 1;
}

function robs(world: World, vehicle: Vehicle, subject: string | null): boolean {
  if (subject === null) return false;
  const target = vehicleById(world, subject);
  return robbingFeud(world, vehicle, target) || (vehicle.faction === 'raiders' && target.faction !== 'raiders' && hasLoot(target));
}

export function wantsLoot(world: World, vehicle: Vehicle, target: Vehicle): boolean {
  return traitsAllowRobbing(vehicle) && robs(world, vehicle, target.id);
}

function robbingFeud(world: World, vehicle: Vehicle, target: Vehicle): boolean {
  const feud = stateOf(world, 'feud', vehicle.id, target.id);
  return feud?.data.kind === 'feud' && feud.data.robbery;
}

function complyFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return danger !== null && !isManageable(world, vehicle, danger) ? NPC_BEHAVIOR.threatComply : 1;
}

function towFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  const client = subjectOf(world, decision, subject);
  const at = strandedAt(world, vehicle, client);
  if (!at) throw new Error(`${vehicle.id} weighs a tow with no stranded ${client.id} perceived`);
  const player = client.id === world.player.vehicleId;
  const sites = player ? REGION.towns : [towSite(world, vehicle, client)];
  const { factor, crawl, far } = NPC_BEHAVIOR.towNearTown;
  const gate = Math.min(...sites.flatMap((site) => siteGates(site).map((g) => dist(at, g))));
  return factor + (1 - factor) * clamp((gate - crawl) / (far - crawl), 0, 1);
}

function investigateFactor(world: World, vehicle: Vehicle): number {
  return getCombatCondition(world, vehicle) <= NPC_BEHAVIOR.recoverCondition ? NPC_BEHAVIOR.crippledInvestigate : 1;
}

function scavengeFactor(world: World, vehicle: Vehicle): number {
  return visibleSalvage(world, vehicle).length > 0 ? NPC_BEHAVIOR.visibleSalvage : 1;
}

const SITUATION: Record<OptionName, SituationFactor> = {
  keep: keepFactor,
  fight: fightFactor,
  fightBack: fightBackFactor,
  flee: fleeFactor,
  investigate: investigateFactor,
  rob: robFactor,
  ram: ramWeight,
  tow: towFactor,
  demand: neutral,
  attack: neutral,
  resume: neutral,
  new: neutral,
  trade: neutral,
  scavenge: scavengeFactor,
  raid: neutral,
  prowl: neutral,
  loot: neutral,
  wait: neutral,
  patrol: neutral,
  travel: neutral,
  explore: neutral,
  haul: neutral,
  escort: neutral,
  paid: neutral,
  ownParts: neutral,
  free: neutral,
  forgive: neutral,
  retaliate: retaliateFactor,
  truce: truceFactor,
  beg: begFactor,
  accept: acceptFactor,
  refuse: refuseFactor,
  spare: neutral,
  offer: neutral,
  finish: neutral,
  rush: neutral,
  halt: neutral,
  veer: neutral,
  comply: complyFactor,
  hire: neutral,
  take: neutral,
  decline: (world, vehicle) => declineFactor(world, vehicle),
  give: neutral,
  aid: neutral,
};

function changeTables(world: World, vehicle: Vehicle, subject: string | null): TraitWeights[] {
  const tables = npcTraits(vehicle).map((id) => TRAITS[id].weights);
  if (subject === null) return tables;
  for (const s of statesHeld(world, vehicle.id)) {
    if (s.other !== subject) continue;
    const table = STATE_WEIGHTS[s.kind];
    if (!table) throw new Error(`Unknown state kind ${s.kind}`);
    tables.push(table);
  }
  return tables;
}

export function optionWeights<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null, danger: number | null): Partial<Record<DecisionOptions[D], number>> {
  const base = DECISIONS[decision] as Record<OptionName, number>;
  const tables = changeTables(world, vehicle, subject);
  const out: Partial<Record<OptionName, number>> = {};
  for (const option of Object.keys(base) as OptionName[]) {
    if (!AVAILABLE[option](world, vehicle, decision, subject)) continue;
    const { add, mul } = sumChanges(tables, decision, option);
    const factor = SITUATION[option](world, vehicle, decision, subject, danger);
    if (!(factor > 0)) throw new Error(`${vehicle.id} has situation factor ${factor} for ${option} at ${decision}`);
    out[option] = (base[option] + add) * mul * factor;
  }
  return out as Partial<Record<DecisionOptions[D], number>>;
}

export function ramsReadily(world: World, vehicle: Vehicle, subject: string): boolean {
  const tables = changeTables(world, vehicle, subject);
  const weight = (option: 'ram' | 'keep') => {
    const { add, mul } = sumChanges(tables, 'ramChance', option);
    return (DECISIONS.ramChance[option] + add) * mul;
  };
  return weight('ram') >= weight('keep');
}

function sumChanges(tables: TraitWeights[], decision: DecisionId, option: OptionName): Required<WeightChange> {
  let add = 0;
  let mul = 1;
  for (const table of tables) {
    const change = (table[decision] as Partial<Record<OptionName, WeightChange>> | undefined)?.[option];
    if (!change) continue;
    add += change.add ?? 0;
    mul *= positiveMul(change, decision, option);
  }
  return { add, mul };
}

function positiveMul(change: WeightChange, decision: DecisionId, option: OptionName): number {
  if (change.mul === undefined) return 1;
  if (!(change.mul > 0)) throw new Error(`Multiplier ${change.mul} for ${option} at ${decision} must be above 0`);
  return change.mul;
}

export function hasChoice(weights: Partial<Record<OptionName, number>>): boolean {
  return !('keep' in weights) || Object.keys(weights).some((option) => option !== 'keep');
}

const DECISION_KINDS: Record<DecisionId, 'venture' | 'response'> = {
  hostileSeen: 'response',
  contactHeard: 'response',
  attacked: 'response',
  preySeen: 'venture',
  strandedSeen: 'venture',
  salvageSeen: 'venture',
  patchDeal: 'response',
  ramChance: 'response',
  fightWhim: 'response',
  crashed: 'response',
  parley: 'response',
  truceOffered: 'response',
  mercyBegged: 'response',
  threatened: 'response',
  warnedOff: 'response',
  mugging: 'response',
  strandedFoe: 'response',
  surrenderOffered: 'response',
  resume: 'response',
  idle: 'venture',
  escortSeen: 'venture',
  hireOffered: 'response',
  aidAsked: 'response',
  needySeen: 'venture',
};

export function keepsWord(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  if (DECISION_KINDS[decision] !== 'venture') return false;
  if (holdsClaim(world, vehicle.id)) return true;
  if (!givesWord(world, vehicle.id)) return false;
  return subject === null || !boundTo(world, vehicle.id, subject);
}

export function offersChoice(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  if (keepsWord(world, vehicle, decision, subject)) return false;
  const options = Object.keys(DECISIONS[decision]) as OptionName[];
  if (!options.includes('keep')) return true;
  return options.some((option) => option !== 'keep' && AVAILABLE[option](world, vehicle, decision, subject));
}

export function optionChances<O extends string>(weights: Partial<Record<O, number>>): Partial<Record<O, number>> {
  const entries = Object.entries(weights) as [O, number][];
  const rest = 1 - entries.length * MIN_CHANCE;
  if (entries.length === 0 || rest < 0) throw new Error(`Cannot give ${entries.length} options their chances`);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const out: Partial<Record<O, number>> = {};
  for (const [option, weight] of entries) out[option] = MIN_CHANCE + rest * (total > 0 ? weight / total : 1 / entries.length);
  return out;
}

export function decide<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null, danger: number | null): DecisionOptions[D] {
  const weights = optionWeights(world, vehicle, decision, subject, danger);
  checkWeights(vehicle, decision, weights);
  if (!hasChoice(weights)) return 'keep' as DecisionOptions[D];
  const chances = Object.entries(optionChances(weights)) as [DecisionOptions[D], number][];
  return sampleWeighted(world, chances.map(([value, weight]) => ({ value, weight })));
}

function checkWeights(vehicle: Vehicle, decision: DecisionId, weights: Partial<Record<OptionName, number>>): void {
  for (const [option, weight] of Object.entries(weights) as [OptionName, number][]) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`${vehicle.id} has weight ${weight} for ${option} at ${decision}`);
  }
}
