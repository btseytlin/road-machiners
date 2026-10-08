// NPC goals: the goal stack, the fixed survival rule, the decision points that push and pop goals, and each goal's
// work. See src/sim/npc-decisions.ts for the weighted rolls.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, type DecisionOptions } from '../data/npcs';
import { SHOPS, shopDef } from '../data/market';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { TOW } from '../data/tow';
import type { PartHit } from './armor';
import { callLawmen, inCombat, isHostile, shotDamage, startFeuds } from './combat';
import { affordableBuyCount, cargoSaleValue, sellAtCamp, sellVehicleCargo, serviceAtCamp, serviceAtStall, serviceVehicle, tradeGoods } from './economy';
import { isJunk, maxHp } from './wear';
import { corePart, goodsCount, mountedParts } from './grid';
import { addGoods, cargoRoom } from './inventory';
import { cancelJob } from './jobs';
import { isFree } from './spawn';
import { route } from './path';
import {
  tradeOffers, canRob, decide, bodyCondition, keepsWord, offersChoice, perceiveDanger, getKnownSite, getUpkeepReserve, haulGoods, patrolPoints, patrolSite, travelSitesAway,
  huntingGroundsAway, raiderGroundsAway, isHostileContact, isWeak, npcProfile, salvageSitesAway, usefulContacts, visibleDowned, visibleHostiles, visibleSalvage, type NpcProfile,
  lootTaken, stockLootInvalid, truckLootInvalid, worksOnLoot,
} from './npc-decisions';
import { chooseNpcRepair, continueNpcRepair, repairsHere, resolveNpcRepair } from './npc-repair';
import { getResources } from './resources';
import { hashRandom, randInt, randRange } from './rng';
import { sampleWeighted } from './npc-loadout';
import { canLootTruck, canReachSalvage, canTakeAny, hasSalvage, isSiteStock, lootClaimedBy, lootTruckTurn, wreckStockId } from './salvage';
import { beginSearch } from './search';
import { onNeedySeen } from './aid';
import { vehicleById } from './damage';
import { judgeStrandedFoe, plead, warnedOff } from './parley';
import { addState, endState, stateOf, statesHeld } from './states';
import { isStranded, suppliesCap, vehicleStats } from './stats';
import type { Contact, GameEvent, Job, NpcActivity, NpcBrain, NpcState, RefitJob, SalvageStock, Vehicle, World } from './types';
import { canUseSite, nearestPad, type Site } from './sites';
import { clamp, dist, type Vec } from './vec';
import { heatAt } from './sun';
import { canVehicleSee } from './vision';
import { dropTow, follows, isOnRope, joinLeader, mercsInSight, npcHomeSite, offerEscort, runTow, steerFollow, strandedAt, towGoal, towHeldBy } from './tow';
import { isDefeated, isKnockedOut, refitAtHome } from './defeat';

export const INTERRUPTIONS: readonly NpcActivity['kind'][] = ['fight', 'flee', 'investigate', 'resupply', 'tow', 'loot', 'repair', 'patch', 'meet', 'retreat', 'follow'];

function goalsOf(v: Vehicle): NpcActivity[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain`);
  if (!v.brain.goals) throw new Error(`${v.id} has no goals`);
  return v.brain.goals;
}

export function topGoal(v: Vehicle): NpcActivity | null {
  const goals = goalsOf(v);
  return goals[goals.length - 1] ?? null;
}

function jobBelongs(job: Job, v: Vehicle): boolean {
  if (job.kind === 'repair') return goalsOf(v).some((g) => g.kind === 'repair');
  if (job.kind === 'refit') return refitBelongs(job, topGoal(v));
  return searchBelongs(job, topGoal(v));
}

function searchBelongs(job: Job, goal: NpcActivity | null): boolean {
  return job.kind === 'search' && (goal?.kind === 'scavenge' || goal?.kind === 'loot') && goal.targetId === job.stockId;
}

function refitBelongs(job: RefitJob, goal: NpcActivity | null): boolean {
  return goal?.kind === 'loot' && job.pickup?.from === 'truck' && goal.targetId === job.pickup.vehicleId;
}

function goalKind(goal: NpcActivity | null): NpcActivity['kind'] | null {
  return goal?.kind ?? null;
}

function logChange(w: World, v: Vehicle, previous: NpcActivity | null, reason: string): void {
  const top = topGoal(v);
  w.events.push({ t: 'activity', vehicle: v.id, previous: goalKind(previous), activity: goalKind(top), reason });
  if (top !== previous && v.job && !jobBelongs(v.job, v)) cancelJob(w, v);
}

export function pushGoal(w: World, v: Vehicle, goal: NpcActivity): void {
  const previous = topGoal(v);
  v.brain!.goals = [...goalsOf(v).filter((g) => g.kind !== goal.kind), goal];
  logChange(w, v, previous, goal.reason);
}

export function popGoal(w: World, v: Vehicle, reason: string): NpcActivity {
  const goals = goalsOf(v);
  const popped = goals.pop();
  if (!popped) throw new Error(`${v.id} has no goal to pop`);
  logChange(w, v, popped, reason);
  return popped;
}

function dropGoal(w: World, v: Vehicle, goal: NpcActivity, reason: string): void {
  const previous = topGoal(v);
  v.brain!.goals = goalsOf(v).filter((g) => g !== goal);
  logChange(w, v, previous, reason);
}

export function replaceBase(w: World, v: Vehicle, goal: NpcActivity): void {
  const goals = goalsOf(v);
  if (goals.length === 0) throw new Error(`${v.id} has no long-term goal to replace`);
  const previous = topGoal(v);
  v.brain!.goals = [goal, ...goals.slice(1).filter((g) => g.kind !== goal.kind)];
  logChange(w, v, previous, goal.reason);
}

export function placeBase(w: World, v: Vehicle, goal: NpcActivity): void {
  const previous = topGoal(v);
  const kept = goalsOf(v).filter((g, i) => g.kind !== goal.kind && (i > 0 || INTERRUPTIONS.includes(g.kind)));
  v.brain!.goals = [goal, ...kept];
  logChange(w, v, previous, goal.reason);
}

function createActivity(kind: NpcActivity['kind'], targetId: string | null, destination: Vec | null, reason: string): NpcActivity {
  return { kind, targetId, destination, reason, phase: destination ? 'travel' : 'act' };
}

function chooseNearestSite(vehicle: Vehicle, ids: string[]) {
  return ids.map(getKnownSite).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos))[0];
}

function createSiteActivity(kind: NpcActivity['kind'], id: string, reason: string): NpcActivity {
  return createActivity(kind, id, { ...getKnownSite(id).pos }, reason);
}

function hasSaleCargo(vehicle: Vehicle): boolean {
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  const goods = Object.entries(goodsCount(vehicle)).some(([good, count]) => count > (good === 'parts' ? NPC_UPKEEP.repairParts : 0));
  return goods || vehicle.items.some((item) => item.kind === 'part' && !mounted.has(item.part.id));
}

function fleeDestination(world: World, vehicle: Vehicle, profile: NpcProfile, threatPos: Vec): Vec {
  const safe = [...profile.towns, ...profile.bases].map(getKnownSite).filter((site) => pointsAway(vehicle.pos, site.pos, threatPos));
  safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const away = { x: vehicle.pos.x + (vehicle.pos.x - threatPos.x), y: vehicle.pos.y + (vehicle.pos.y - threatPos.y) };
  const destination = safe[0] ? siteSpot(world, vehicle, safe[0], vehicleStats(world, vehicle).radius + RULES.arriveRadius, 0) : away;
  return { x: clamp(destination.x, 1, world.size - 1), y: clamp(destination.y, 1, world.size - 1) };
}

function pointsAway(from: Vec, to: Vec, threat: Vec): boolean {
  return (to.x - from.x) * (threat.x - from.x) + (to.y - from.y) * (threat.y - from.y) < 0;
}

type ServiceNeed = { reason: string; suppliesOnly: boolean; damaged: boolean };

function isStrandedForGood(vehicle: Vehicle): boolean {
  const engine = mountedParts(vehicle, 'engine')[0];
  return !engine || isJunk(engine);
}

function isDamaged(vehicle: Vehicle): boolean {
  const drivingPartWorn = [...mountedParts(vehicle, 'core'), ...mountedParts(vehicle, 'engine')]
    .some((part) => !isJunk(part) && part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition);
  return isStrandedForGood(vehicle) || drivingPartWorn || bodyCondition(vehicle) <= NPC_BEHAVIOR.fleeCondition;
}

function serviceReason(lowFuel: boolean, lowSupplies: boolean): string {
  return lowFuel ? 'low fuel' : lowSupplies ? 'low supplies' : 'needs repairs';
}

function pumpsOf(vehicle: Vehicle, profile: NpcProfile): string[] {
  if (profile.bases.length > 0) return profile.bases;
  if (profile.towns.length === 0) throw new Error(`${vehicle.id} knows no pump`);
  return [...profile.towns, ...FUEL_STALLS];
}

const FUEL_STALLS: readonly string[] = Object.values(SHOPS).filter((s) => s.kind === 'stall' && s.supplies.includes('fuel')).map((s) => s.id);

function fuelToPump(world: World, vehicle: Vehicle, profile: NpcProfile): number {
  const pump = chooseNearestSite(vehicle, pumpsOf(vehicle, profile));
  return dist(vehicle.pos, pump.pos) * vehicleStats(world, vehicle).fuelPerTile * heatAt(world, vehicle.pos);
}

function fuelSense(world: World, vehicle: Vehicle): number {
  const roll = hashRandom(world.seed, ...charCodes(vehicle.id), ...charCodes('fuel'));
  return 1 + NPC_UPKEEP.fuelSense * (2 * roll - 1);
}

export function fuelReserveFor(world: World, vehicle: Vehicle, profile: NpcProfile = npcProfile(vehicle)): number {
  return fuelToPump(world, vehicle, profile) * NPC_UPKEEP.fuelReserve * profile.fuelMargin * fuelSense(world, vehicle);
}

const isLowOnFuel = (world: World, vehicle: Vehicle, profile: NpcProfile): boolean => getResources(world, vehicle).fuel <= fuelReserveFor(world, vehicle, profile);

function serviceNeed(world: World, vehicle: Vehicle, profile: NpcProfile): ServiceNeed | null {
  const resources = getResources(world, vehicle);
  const lowFuel = isLowOnFuel(world, vehicle, profile);
  const lowSupplies = resources.supplies <= suppliesCap(vehicle) * NPC_UPKEEP.lowSupplies;
  const damaged = isDamaged(vehicle);
  if (!lowFuel && !lowSupplies && !damaged) return null;
  return { reason: serviceReason(lowFuel, lowSupplies), suppliesOnly: lowSupplies && !lowFuel && !damaged, damaged };
}

function isBroke(world: World, vehicle: Vehicle): boolean {
  return getResources(world, vehicle).money < Math.min(ECONOMY.supplyPrice.fuel, ECONOMY.supplyPrice.supplies);
}

function serviceGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  const need = serviceNeed(world, vehicle, profile);
  if (!need) return null;
  const oasis = need.suppliesOnly ? chooseNearestSite(vehicle, profile.supplySites) : undefined;
  if (oasis) return createSiteActivity('resupply', oasis.id, 'low supplies');
  if (isBroke(world, vehicle)) return brokeServiceGoal(world, vehicle, profile, need);
  return serviceTrip(vehicle, profile, need);
}

function brokeServiceGoal(world: World, vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed): NpcActivity | null {
  if (hasSaleCargo(vehicle)) return saleGoal(world, vehicle, profile);
  return isStranded(world, vehicle) ? serviceTrip(vehicle, profile, need) : null;
}

function serviceTrip(vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed): NpcActivity {
  const stop = chooseNearestSite(vehicle, serviceStops(vehicle, profile, need));
  if (!stop) throw new Error(`${vehicle.id} knows no service stop`);
  return createSiteActivity('resupply', stop.id, need.reason);
}

function serviceStops(vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed): string[] {
  if (profile.bases.length > 0) return profile.bases;
  return need.damaged ? profile.towns : pumpsOf(vehicle, profile);
}

function saleGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const buyers = profile.markets.map(getKnownSite);
  buyers.sort((a, b) => cargoSaleValue(world, vehicle, b.id) - cargoSaleValue(world, vehicle, a.id) || dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  if (!buyers[0]) throw new Error(`${vehicle.id} knows no buyer`);
  return createSiteActivity('sell', buyers[0].id, 'sell carried cargo');
}

function tradeGoal(world: World, vehicle: Vehicle): NpcActivity {
  const offers = tradeOffers(world, vehicle);
  if (offers.length === 0) throw new Error(`${vehicle.id} chose to trade with no affordable profitable trade`);
  const plan = sampleWeighted(world, offers);
  return { ...createSiteActivity('trade', plan.source, 'buy profitable cargo'), purchase: { good: plan.good, sellShop: plan.sellShop } };
}

function scavengeGoal(world: World, vehicle: Vehicle): NpcActivity {
  const stock = visibleSalvage(world, vehicle)[0];
  const truck = visibleDowned(world, vehicle)[0];
  if (truck && (!stock || dist(vehicle.pos, truck.pos) < dist(vehicle.pos, stock.pos))) return createActivity('loot', truck.id, { ...truck.pos }, 'loot a knocked-out truck');
  if (stock) return createActivity('scavenge', stock.id, { ...stock.pos }, 'collect visible salvage');
  const sites = salvageSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose to scavenge with no salvage known`);
  return createSiteActivity('scavenge', sites[randInt(world, 0, sites.length - 1)].id, 'search a known salvage site');
}

type IdleGoal = (world: World, vehicle: Vehicle) => NpcActivity;

function huntingGoal(kind: 'raid' | 'prowl', reason: string, grounds: (vehicle: Vehicle) => Vec[]): IdleGoal {
  return (world, vehicle) => {
    const places = grounds(vehicle);
    if (places.length === 0) throw new Error(`${vehicle.id} chose to ${kind} with no hunting ground away`);
    return createActivity(kind, null, { ...places[randInt(world, 0, places.length - 1)] }, reason);
  };
}

function patrolGoal(world: World, vehicle: Vehicle): NpcActivity {
  const site = patrolSite(vehicle);
  const points = patrolPoints(site);
  if (points.length === 0) throw new Error(`${vehicle.id} chose to patrol ${site.id} with no road near it`);
  return createActivity('patrol', site.id, { ...points[randInt(world, 0, points.length - 1)] }, `patrol the roads near ${'kind' in site && site.kind === 'camp' ? 'camp' : 'town'}`);
}

function travelGoal(world: World, vehicle: Vehicle): NpcActivity {
  const sites = travelSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose a trip with no known site away`);
  return createSiteActivity('travel', sites[randInt(world, 0, sites.length - 1)].id, 'make a trip to another site');
}

function exploreGoal(world: World, vehicle: Vehicle): NpcActivity {
  const radius = vehicleStats(world, vehicle).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const point = { x: randRange(world, radius, world.size - radius), y: randRange(world, radius, world.size - radius) };
    if (isFree(world, point, radius, vehicle.id)) return createActivity('explore', null, point, 'Explore');
  }
  return createActivity('wait', null, null, 'no free point to explore');
}

function haulGoal(world: World, vehicle: Vehicle): NpcActivity {
  const sites = npcProfile(vehicle).haulSites;
  if (sites.length === 0) throw new Error(`${vehicle.id} chose to haul with no known source`);
  const site = sites[randInt(world, 0, sites.length - 1)];
  const goods = haulGoods(site);
  return { ...createSiteActivity('haul', site, 'load cargo at its source'), load: { good: goods[randInt(world, 0, goods.length - 1)] } };
}

const IDLE_GOALS: Record<Exclude<DecisionOptions['idle'], 'wait'>, IdleGoal> = {
  trade: tradeGoal,
  scavenge: scavengeGoal,
  raid: huntingGoal('raid', 'look for prey at known hunting grounds', raiderGroundsAway),
  prowl: huntingGoal('prowl', 'prowl the roads for wrecks', huntingGroundsAway),
  patrol: patrolGoal,
  travel: travelGoal,
  explore: exploreGoal,
  haul: haulGoal,
  escort: joinLeader,
};

function idleGoal(world: World, vehicle: Vehicle): NpcActivity {
  if (keepsWord(world, vehicle, 'idle', null)) return createActivity('wait', null, null, 'keep its word');
  const option = decide(world, vehicle, 'idle', null, null);
  if (option === 'wait') return createActivity('wait', null, null, 'nothing worth doing');
  return IDLE_GOALS[option](world, vehicle);
}

export function finishGoal(world: World, vehicle: Vehicle, reason: string): void {
  const done = popGoal(world, vehicle, reason);
  const goals = vehicle.brain!.goals;
  if (!INTERRUPTIONS.includes(done.kind) || goals.length !== 1 || INTERRUPTIONS.includes(goals[0].kind)) return;
  if (decide(world, vehicle, 'resume', null, null) === 'new') popGoal(world, vehicle, 'chose something new');
}

function heldTow(world: World, vehicle: Vehicle): NpcState | null {
  return towHeldBy(world, vehicle.id);
}

type GoalCheck = (world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]) => string | null;

function fightInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  if (!target || !isHostile(world, vehicle, target)) return 'lost the target';
  if (vehicleStats(world, vehicle).weapons.length === 0) return 'no gun left to fight with';
  return fightTargetLost(world, vehicle, goal, target, contacts) ? 'lost the target' : null;
}

function fightTargetLost(world: World, vehicle: Vehicle, goal: NpcActivity, target: Vehicle, contacts: Contact[]): boolean {
  if (fightTargetAt(world, vehicle, target, contacts)) return false;
  if (goal.perceived === undefined) throw new Error(`${vehicle.id} fights ${target.id} with no turn it last perceived it`);
  return world.turn - goal.perceived > NPC_BEHAVIOR.fightSearchTurns;
}

function fightTargetAt(world: World, vehicle: Vehicle, target: Vehicle, contacts: Contact[]): Vec | undefined {
  if (canVehicleSee(world, vehicle, target.pos)) return target.pos;
  return contacts.find((c) => c.vehicleId === target.id)?.center;
}

function steerFight(world: World, vehicle: Vehicle, goal: NpcActivity, _profile: NpcProfile, contacts: Contact[]): void {
  const at = fightTargetAt(world, vehicle, vehicleById(world, goal.targetId!), contacts);
  if (!at) return;
  goal.destination = { ...at };
  goal.perceived = world.turn;
}

function fightGoal(world: World, vehicle: Vehicle, target: Vehicle, reason: string): NpcActivity {
  const goal: NpcActivity = { ...createActivity('fight', target.id, { ...target.pos }, reason), perceived: world.turn };
  if (target.id === world.player.vehicleId) goal.demands = decide(world, vehicle, 'mugging', target.id, null) === 'demand';
  return goal;
}

function fleeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (visibleHostiles(world, vehicle).length > 0 || contacts.some((c) => c.vehicleId === goal.targetId)) return null;
  return 'no hostile in sight';
}

function investigateInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  return target && isHostile(world, vehicle, target) ? null : 'the contact is gone';
}

function scavengeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (goal.targetId === null || [...REGION.towns, ...REGION.locations].some((site) => site.id === goal.targetId)) return null;
  const seen = world.salvage.some((stock) => stock.id === goal.targetId && canVehicleSee(world, vehicle, stock.pos));
  return lootTaken(world, vehicle, goal.targetId) ?? (seen ? null : 'lost sight of the salvage');
}

function lootInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const truck = world.vehicles.find((v) => v.id === goal.targetId);
  return lootTaken(world, vehicle, goal.targetId) ?? (truck ? truckLootInvalid(vehicle, truck) : stockLootInvalid(world, vehicle, goal));
}

function towInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (heldTow(world, vehicle)) return null;
  const client = world.vehicles.find((v) => v.id === goal.targetId);
  if (!client || stateOf(world, 'turnedDown', vehicle.id, client.id)) return 'the tow is off';
  return strandedAt(world, vehicle, client) ? null : 'the tow is off';
}

function patchInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const other = goal.targetId;
  const held = world.states.some((s) => s.kind === 'patch' && ((s.holder === vehicle.id && s.other === other) || (s.holder === other && s.other === vehicle.id)));
  return held ? null : 'the patch is off';
}

export function patchGoal(world: World, npc: Vehicle, other: Vehicle, patcher: boolean): void {
  const goal = patcher
    ? createActivity('patch', other.id, { ...other.pos }, 'patch a stranded truck')
    : createActivity('patch', other.id, null, 'wait for a patch');
  pushGoal(world, npc, goal);
}

export function meetGoal(world: World, npc: Vehicle, other: Vehicle, reason: string): void {
  pushGoal(world, npc, createActivity('meet', other.id, isStranded(world, npc) ? null : { ...other.pos }, reason));
}

const GOAL_CHECKS: Partial<Record<NpcActivity['kind'], GoalCheck>> = {
  fight: fightInvalid,
  flee: fleeInvalid,
  investigate: investigateInvalid,
  scavenge: scavengeInvalid,
  loot: lootInvalid,
  tow: towInvalid,
  patch: patchInvalid,
  meet: (world, vehicle, goal) => (world.states.some((s) => (s.kind === 'trade' || s.kind === 'aid') && s.holder === vehicle.id && s.other === goal.targetId) ? null : 'the meeting is off'),
  follow: (world, vehicle, goal) => (follows(world, vehicle, goal.targetId!) ? null : 'no longer follows its leader'),
};

const EXPOSED: readonly NpcActivity['kind'][] = ['repair', 'patch', 'meet', 'tow', 'loot'];
const BROKEN_OFF: readonly NpcState['kind'][] = ['patch', 'trade', 'aid'];

function breakOffDeals(world: World, vehicle: Vehicle): void {
  if (!inCombat(world, vehicle)) return;
  const tow = heldTow(world, vehicle);
  if (tow) dropTow(world, tow, 'danger');
  for (const s of world.states.filter((x) => BROKEN_OFF.includes(x.kind) && (x.holder === vehicle.id || x.other === vehicle.id))) endState(world, s, 'broken');
}

export function goalHolds(world: World, vehicle: Vehicle, goal: NpcActivity): boolean {
  return invalidReason(world, vehicle, goal, usefulContacts(world, vehicle)) === null;
}

function invalidReason(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (EXPOSED.includes(goal.kind) && inCombat(world, vehicle)) return 'in combat';
  const check = GOAL_CHECKS[goal.kind];
  return check ? check(world, vehicle, goal, contacts) : null;
}

function forget(world: World, vehicle: Vehicle, contacts: Contact[]): void {
  const brain = vehicle.brain!;
  for (const [key, last] of Object.entries(brain.noticed)) {
    const [decision, id] = key.split(':');
    if (perceives(world, vehicle, decision, id, contacts)) brain.noticed[key] = world.turn;
    else if (!heldByGoal(brain, decision, id) && world.turn - last > NPC_BEHAVIOR.noticeMemory) unnotice(brain, key, id);
  }
}

function heldByGoal(brain: NpcBrain, decision: string, id: string): boolean {
  return decision !== 'ramChance' && brain.goals.some((g) => g.targetId === id);
}

function unnotice(brain: NpcBrain, key: string, id: string): void {
  delete brain.noticed[key];
  if (key.startsWith('ramChance:') && brain.ramChoice === id) delete brain.ramChoice;
}

function perceives(world: World, vehicle: Vehicle, decision: string, id: string, contacts: Contact[]): boolean {
  if (!Object.hasOwn(PERCEIVES, decision)) throw new Error(`Unknown noticed decision ${decision}`);
  return PERCEIVES[decision as NoticedDecision](world, vehicle, id, contacts);
}

export type NoticedDecision = 'hostileSeen' | 'contactHeard' | 'preySeen' | 'strandedSeen' | 'salvageSeen' | 'ramChance' | 'escortSeen' | 'strandedFoe' | 'surrenderOffered' | 'needySeen';

type Perception = (world: World, vehicle: Vehicle, id: string, contacts: Contact[]) => boolean;

function seesVehicle(world: World, vehicle: Vehicle, id: string): boolean {
  const other = world.vehicles.find((v) => v.id === id);
  return other !== undefined && canVehicleSee(world, vehicle, other.pos);
}

function hearsVehicle(_world: World, _vehicle: Vehicle, id: string, contacts: Contact[]): boolean {
  return contacts.some((c) => c.vehicleId === id);
}

function seesStock(world: World, vehicle: Vehicle, id: string): boolean {
  const stock = world.salvage.find((s) => s.id === id) ?? world.vehicles.find((v) => v.id === id && isKnockedOut(v));
  return stock !== undefined && canVehicleSee(world, vehicle, stock.pos);
}

function hasRamChance(world: World, vehicle: Vehicle, id: string): boolean {
  return world.vehicles.some((v) => v.id === id) && offersChoice(world, vehicle, 'ramChance', id);
}

const PERCEIVES: Record<NoticedDecision, Perception> = {
  hostileSeen: seesVehicle,
  contactHeard: hearsVehicle,
  preySeen: seesVehicle,
  strandedSeen: seesVehicle,
  salvageSeen: seesStock,
  ramChance: hasRamChance,
  escortSeen: seesVehicle,
  strandedFoe: seesVehicle,
  surrenderOffered: seesVehicle,
  needySeen: seesVehicle,
};

export function react<D extends NoticedDecision>(world: World, vehicle: Vehicle, decision: D, id: string): DecisionOptions[D] | null {
  const key = `${decision}:${id}`;
  if (key in vehicle.brain!.noticed) return null;
  if (!offersChoice(world, vehicle, decision, id)) return 'keep' as DecisionOptions[D];
  vehicle.brain!.noticed[key] = world.turn;
  const seen = decision === 'hostileSeen' || decision === 'preySeen';
  return decide(world, vehicle, decision, id, seen ? perceiveDanger(world, vehicle, vehicleById(world, id)) : null);
}

function interrupt(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const tow = heldTow(world, vehicle);
  if (tow) {
    dropTow(world, tow, 'danger');
    if (popGoal(world, vehicle, 'dropped the tow').kind !== 'tow') throw new Error(`${vehicle.id} held a tow without a tow goal on top`);
  }
  pushGoal(world, vehicle, goal);
}

function fleeFrom(world: World, vehicle: Vehicle, profile: NpcProfile, threatId: string, threatPos: Vec, reason: string): NpcActivity {
  return createActivity('flee', threatId, fleeDestination(world, vehicle, profile, threatPos), reason);
}

function onHostilesSeen(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  for (const enemy of visibleHostiles(world, vehicle)) {
    const option = react(world, vehicle, 'hostileSeen', enemy.id);
    if (option === null || option === 'keep') continue;
    if (option === 'fight') interrupt(world, vehicle, fightGoal(world, vehicle, enemy, 'fight a hostile in sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, enemy.id, enemy.pos, isWeak(world, vehicle) ? 'damaged and threatened' : 'avoid a costly fight'));
    return;
  }
}

function onContactsHeard(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  for (const contact of hostileContacts(world, vehicle, contacts)) {
    const option = react(world, vehicle, 'contactHeard', contact.vehicleId);
    if (option === null || option === 'keep') continue;
    if (option === 'investigate') interrupt(world, vehicle, createActivity('investigate', contact.vehicleId, { ...contact.center }, 'heard a hostile beyond sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, contact.vehicleId, contact.center, 'heard a hostile beyond sight'));
    return;
  }
}

function hostileContacts(world: World, vehicle: Vehicle, contacts: Contact[]): Contact[] {
  return inDanger(vehicle) ? [] : contacts.filter((contact) => isHostileContact(world, vehicle, contact));
}

function pruneAttackers(world: World, vehicle: Vehicle): void {
  const attackers = vehicle.brain!.attackers;
  if (!attackers) throw new Error(`${vehicle.id} has no attackers`);
  for (const id of Object.keys(attackers)) {
    const other = world.vehicles.find((v) => v.id === id);
    if (!other || !isHostile(world, vehicle, other) || !canVehicleSee(world, vehicle, other.pos)) delete attackers[id];
  }
}

function newAttackers(world: World, vehicle: Vehicle): Vehicle[] {
  const ids = Object.entries(vehicle.brain!.attackers).flatMap(([id, answered]) => (answered ? [] : [id]));
  return ids.map((id) => vehicleById(world, id)).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

function isFighting(vehicle: Vehicle, id: string): boolean {
  const top = topGoal(vehicle);
  return top?.kind === 'fight' && top.targetId === id;
}

function onAttacked(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  const brain = vehicle.brain!;
  for (const shooter of newAttackers(world, vehicle)) {
    brain.attackers[shooter.id] = true;
    brain.noticed[`hostileSeen:${shooter.id}`] = world.turn;
    if (isFighting(vehicle, shooter.id)) continue;
    const option = decide(world, vehicle, 'attacked', shooter.id, perceiveDanger(world, vehicle, shooter));
    if (option === 'keep') continue;
    if (option === 'fightBack') interrupt(world, vehicle, fightGoal(world, vehicle, shooter, 'fight back'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, shooter.id, shooter.pos, 'escape an attacker'));
    return;
  }
}

function onGrievances(world: World, vehicle: Vehicle): void {
  for (const s of statesHeld(world, vehicle.id).filter((x) => x.kind === 'grievance')) {
    const other = world.vehicles.find((v) => v.id === s.other);
    if (!other) continue;
    if (isHostile(world, vehicle, other)) {
      endState(world, s, 'broken');
      continue;
    }
    if (!canVehicleSee(world, vehicle, other.pos)) continue;
    endState(world, s, 'fulfilled');
    if (decide(world, vehicle, 'crashed', other.id, null) !== 'retaliate') continue;
    startFeuds(world, other, vehicle);
    vehicle.brain!.attackers[other.id] = false;
  }
}

function onParley(world: World, vehicle: Vehicle): void {
  const foe = hurtingFoe(world, vehicle);
  if (!foe) return;
  const option = decide(world, vehicle, 'parley', foe.id, perceiveDanger(world, vehicle, foe));
  if (option !== 'keep') plead(world, vehicle, foe, option === 'truce' ? 'truce' : 'mercy');
}

function hurtingFoe(world: World, vehicle: Vehicle): Vehicle | null {
  if (vehicle.brain!.hurt <= 0) return null;
  const foe = world.vehicles.find((v) => v.id === vehicle.lastHitBy);
  return foe && isHostile(world, vehicle, foe) && canVehicleSee(world, vehicle, foe.pos) ? foe : null;
}

export function defyThreat(world: World, vehicle: Vehicle, threatener: Vehicle, answer: Exclude<DecisionOptions['threatened'], 'comply'>, reason = answer === 'fightBack' ? 'refuse a threat' : 'escape a threat'): void {
  startFeuds(world, threatener, vehicle);
  vehicle.brain!.noticed[`hostileSeen:${threatener.id}`] = world.turn;
  if (answer === 'fightBack') interrupt(world, vehicle, fightGoal(world, vehicle, threatener, reason));
  else interrupt(world, vehicle, fleeFrom(world, vehicle, npcProfile(vehicle), threatener.id, threatener.pos, reason));
}

export function backOffLoot(world: World, vehicle: Vehicle): void {
  const target = lootClaimedBy(world, vehicle);
  if (target === null) throw new Error(`${vehicle.id} holds no loot claim to back off from`);
  if (worksOnLoot(vehicle, target)) cancelJob(world, vehicle);
  vehicle.brain!.noticed[`salvageSeen:${target}`] = world.turn;
  const goal = topGoal(vehicle);
  if (goal && ['loot', 'scavenge'].includes(goal.kind) && goal.targetId === target) finishGoal(world, vehicle, 'warned off the loot');
}

function onPreySeen(world: World, vehicle: Vehicle): void {
  const prey = world.vehicles
    .filter((other) => !(`preySeen:${other.id}` in vehicle.brain!.noticed) && canRob(world, vehicle, other))
    .sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  for (const target of prey) {
    if (react(world, vehicle, 'preySeen', target.id) !== 'rob') continue;
    addState(world, 'feud', vehicle.id, target.id, { kind: 'feud', robbery: true });
    vehicle.brain!.noticed[`hostileSeen:${target.id}`] = world.turn;
    world.events.push({ t: 'hostile', vehicle: vehicle.id, against: target.id });
    callLawmen(world, vehicle, target);
    interrupt(world, vehicle, fightGoal(world, vehicle, target, 'rob cargo'));
    return;
  }
}

function onStrandedSeen(world: World, vehicle: Vehicle): void {
  if (inDanger(vehicle) || inCombat(world, vehicle)) return;
  const clients = world.vehicles
    .filter((client) => client.id !== world.player.vehicleId || !inCombat(world, client))
    .map((client) => ({ client, at: strandedAt(world, vehicle, client) }))
    .filter((c): c is { client: Vehicle; at: Vec } => c.at !== null)
    .sort((a, b) => dist(vehicle.pos, a.at) - dist(vehicle.pos, b.at));
  const chosen = clients.find((c) => react(world, vehicle, 'strandedSeen', c.client.id) === 'tow');
  if (chosen) startTow(world, vehicle, chosen.client, chosen.at);
}

function onSalvageSeen(world: World, vehicle: Vehicle): void {
  const top = topGoal(vehicle);
  if (inCombat(world, vehicle) || !top || top.phase !== 'travel' || INTERRUPTIONS.includes(top.kind)) return;
  const stocks = visibleSalvage(world, vehicle).filter((stock) => !isSiteStock(stock));
  const passed = [...stocks, ...visibleDowned(world, vehicle)].filter((s) => s.id !== top.targetId).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const loot = passed.find((s) => react(world, vehicle, 'salvageSeen', s.id) === 'loot');
  if (loot) pushGoal(world, vehicle, createActivity('loot', loot.id, { ...loot.pos }, 'loot salvage on the way'));
}

function onEscortSeen(world: World, vehicle: Vehicle): void {
  if (inDanger(vehicle)) return;
  const merc = mercsInSight(world, vehicle).find((m) => react(world, vehicle, 'escortSeen', m.id) === 'hire');
  if (merc) offerEscort(world, vehicle, merc);
}

function onRamChance(world: World, vehicle: Vehicle): void {
  const brain = vehicle.brain!;
  const target = fightTarget(vehicle);
  if (brain.ramChoice !== target) delete brain.ramChoice;
  if (target !== null && react(world, vehicle, 'ramChance', target) === 'ram') brain.ramChoice = target;
}

function onFightWhim(world: World, vehicle: Vehicle): void {
  const brain = vehicle.brain!;
  const target = fightTarget(vehicle);
  if (target === null) return void delete brain.whim;
  if (!brain.whim || world.turn >= brain.whim.until) rollWhim(world, vehicle, target);
}

function rollWhim(world: World, vehicle: Vehicle, target: string): void {
  const brain = vehicle.brain!;
  const kind = decide(world, vehicle, 'fightWhim', target, null);
  if (kind === 'veer') brain.fightTurn = brain.fightTurn === 1 ? -1 : 1;
  const angle = kind === 'veer' ? randRange(world, -Math.PI, Math.PI) : 0;
  brain.whim = { kind, until: world.turn + NPC_BEHAVIOR.fight.whimTurns, angle };
}

export function inDanger(vehicle: Vehicle): boolean {
  const top = topGoal(vehicle)?.kind;
  return top === 'fight' || top === 'flee';
}

function fightTarget(vehicle: Vehicle): string | null {
  const top = topGoal(vehicle);
  return top?.kind === 'fight' ? top.targetId : null;
}

export function startTow(world: World, vehicle: Vehicle, client: Vehicle, at: Vec): void {
  const turnedDown = stateOf(world, 'turnedDown', vehicle.id, client.id);
  if (turnedDown) endState(world, turnedDown, 'fulfilled');
  vehicle.brain!.noticed[`preySeen:${client.id}`] = world.turn;
  addState(world, 'answering', vehicle.id, client.id, { kind: 'none' });
  pushGoal(world, vehicle, createActivity('tow', client.id, { ...at }, 'help a stranded truck'));
}

function steer(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  const top = topGoal(vehicle);
  if (top) STEERS[top.kind]?.(world, vehicle, top, profile, contacts);
}

type Steer = (world: World, vehicle: Vehicle, goal: NpcActivity, profile: NpcProfile, contacts: Contact[]) => void;

const STEERS: Partial<Record<NpcActivity['kind'], Steer>> = {
  fight: steerFight,
  flee: (world, vehicle, goal, profile, contacts) => steerFlee(world, vehicle, profile, contacts, goal),
  tow: (world, vehicle, goal) => { if (!heldTow(world, vehicle)) steerToStranded(world, vehicle, goal); },
  meet: (world, _vehicle, goal) => steerToMeet(world, goal),
  follow: steerFollow,
};

function steerToMeet(world: World, goal: NpcActivity): void {
  if (goal.destination) goal.destination = { ...vehicleById(world, goal.targetId!).pos };
}

function steerToStranded(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const at = strandedAt(world, vehicle, vehicleById(world, goal.targetId!));
  if (!at) throw new Error(`${vehicle.id} heads for a tow with no stranded client perceived`);
  goal.destination = { ...at };
}

function steerFlee(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[], goal: NpcActivity): void {
  const threat = fleeThreat(world, vehicle, contacts, goal);
  if (!threat) throw new Error(`${vehicle.id} flees with no threat perceived`);
  goal.destination = fleeDestination(world, vehicle, profile, threat);
}

function fleeThreat(world: World, vehicle: Vehicle, contacts: Contact[], goal: NpcActivity): Vec | undefined {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  if (target && canVehicleSee(world, vehicle, target.pos)) return target.pos;
  return visibleHostiles(world, vehicle)[0]?.pos ?? contacts.find((c) => c.vehicleId === goal.targetId)?.center;
}

export function thinkNpc(world: World, vehicle: Vehicle): NpcActivity {
  const brain = vehicle.brain;
  if (!brain) throw new Error(`${vehicle.id} has no NPC brain`);
  if (!brain.noticed) throw new Error(`${vehicle.id} has no noticed list`);
  const profile = npcProfile(vehicle);
  const contacts = usefulContacts(world, vehicle);
  forget(world, vehicle, contacts);
  pruneAttackers(world, vehicle);
  breakOffDeals(world, vehicle);
  dropInvalidGoals(world, vehicle, contacts);
  serveStranded(world, vehicle, profile);
  if (isDefeated(vehicle)) return retreatHome(world, vehicle);
  applyFixedRules(world, vehicle, profile);
  onGrievances(world, vehicle);
  onParley(world, vehicle);
  dropInvalidGoals(world, vehicle, contacts);
  onAttacked(world, vehicle, profile);
  onHostilesSeen(world, vehicle, profile);
  onContactsHeard(world, vehicle, profile, contacts);
  onPreySeen(world, vehicle);
  onStrandedSeen(world, vehicle);
  onNeedySeen(world, vehicle);
  onSalvageSeen(world, vehicle);
  onEscortSeen(world, vehicle);
  onRamChance(world, vehicle);
  onFightWhim(world, vehicle);
  judgeStrandedFoe(world, vehicle);
  steer(world, vehicle, profile, contacts);
  return currentActivity(world, vehicle, profile);
}

function servingSiteIds(profile: NpcProfile): string[] {
  return profile.bases.length > 0 ? profile.bases : REGION.towns.map((t) => t.id);
}

function serveStranded(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  if (!isStranded(world, vehicle) || isOnRope(world, vehicle.id) || vehicle.speed > RULES.parkedSpeed) return;
  const site = servingSiteIds(profile).map(getKnownSite).find((s) => canUseSite(vehicle.pos, s));
  if (!site) return;
  serviceAt(world, vehicle, site);
  if (isStranded(world, vehicle)) refitAtHome(world, vehicle);
}

function retreatHome(world: World, vehicle: Vehicle): NpcActivity {
  if (topGoal(vehicle)?.kind !== 'retreat') {
    const home = npcHomeSite(vehicle);
    if (!home) throw new Error(`${vehicle.id} knows no home to retreat to`);
    pushGoal(world, vehicle, createSiteActivity('retreat', home.id, 'retreat home after a defeat'));
  }
  if (awaitsTower(world, vehicle)) return createActivity('wait', null, null, 'wait for a tow');
  return topGoal(vehicle)!;
}

function dropInvalidGoals(world: World, vehicle: Vehicle, contacts: Contact[]): void {
  for (let top = topGoal(vehicle); top; top = topGoal(vehicle)) {
    const reason = invalidReason(world, vehicle, top, contacts);
    if (!reason) break;
    finishGoal(world, vehicle, reason);
  }
}

function applyFixedRules(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  if (heldTow(world, vehicle)) {
    keepTowGoal(world, vehicle);
    return;
  }
  const top = topGoal(vehicle)?.kind;
  if (top === 'tow' || top === 'patch' || top === 'meet') return;
  pushService(world, vehicle, profile);
}

function keepTowGoal(world: World, vehicle: Vehicle): void {
  const goal = towGoal(world, vehicle);
  const top = topGoal(vehicle);
  if (top?.kind !== 'tow' || top.targetId !== goal.targetId || top.reason !== goal.reason) pushGoal(world, vehicle, goal);
}

function pushService(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  const service = serviceGoal(world, vehicle, profile);
  const urgent = service !== null && needsUrgentSupplies(world, vehicle, profile);
  if (!urgent && keepRepairing(world, vehicle)) return;
  if (service && !vehicle.brain!.goals.some((g) => g.kind === service.kind)) pushGoal(world, vehicle, service);
}

function needsUrgentSupplies(world: World, vehicle: Vehicle, profile: NpcProfile): boolean {
  const resources = getResources(world, vehicle);
  if (resources.supplies <= suppliesCap(vehicle) * NPC_UPKEEP.lowSupplies) return true;
  return resources.fuel > 0 && isLowOnFuel(world, vehicle, profile);
}

function keepRepairing(world: World, vehicle: Vehicle): boolean {
  if (holdRepair(world, vehicle)) return true;
  if (inCombat(world, vehicle) || inDanger(vehicle)) return false;
  const repair = chooseNpcRepair(world, vehicle, NPC_BEHAVIOR.recoverCondition);
  if (repair) pushGoal(world, vehicle, repair);
  return repair !== null;
}

function holdRepair(world: World, vehicle: Vehicle): boolean {
  const current = goalsOf(vehicle).find((g) => g.kind === 'repair');
  if (!current) return false;
  if (inCombat(world, vehicle) && vehicle.job?.kind !== 'repair') {
    dropGoal(world, vehicle, current, 'combat stops the repair');
    return false;
  }
  continueNpcRepair(world, vehicle, current);
  return true;
}

function currentActivity(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  if (awaitsTower(world, vehicle)) return createActivity('wait', null, null, 'wait for a tow');
  return topGoal(vehicle) ?? nextGoal(world, vehicle, profile);
}

function awaitsTower(world: World, vehicle: Vehicle): boolean {
  return !inDanger(vehicle) && world.states.some((s) => s.kind === 'answering' && s.other === vehicle.id);
}

function nextGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const next = hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : idleGoal(world, vehicle);
  if (next.kind !== 'wait' && topGoal(vehicle) !== next) pushGoal(world, vehicle, next);
  return next;
}

export function noteHurt(world: World): void {
  const hurt = new Map<string, number>();
  for (const e of world.events) addEventHurt(hurt, e);
  for (const v of world.vehicles) if (v.brain) v.brain.hurt = hurt.get(v.id) ?? 0;
}

function addEventHurt(hurt: Map<string, number>, e: GameEvent): void {
  if (e.t === 'shot' || e.t === 'guardShot') for (const [id, hits] of shotDamage(e)) addHurt(hurt, id, hits);
  else if (e.t === 'collision') {
    addHurt(hurt, e.a, e.hitsA);
    addHurt(hurt, e.b, e.hitsB);
  }
}

function addHurt(hurt: Map<string, number>, id: string, hits: PartHit[]): void {
  hurt.set(id, (hurt.get(id) ?? 0) + hits.reduce((sum, hit) => sum + hit.damage, 0));
}

export function watchStalls(world: World): void {
  for (const v of world.vehicles) {
    if (!v.brain) continue;
    if (madeProgress(world, v)) v.brain.progress = { key: progressKey(v), since: world.turn };
    else if (world.turn - v.brain.progress!.since >= NPC_BEHAVIOR.stallTurns) giveUp(world, v);
  }
}

function madeProgress(world: World, v: Vehicle): boolean {
  if (isKnockedOut(v) || isOnRope(world, v.id) || awaitsTower(world, v)) return true;
  return v.brain!.progress?.key !== progressKey(v);
}

function progressKey(v: Vehicle): string {
  const top = topGoal(v);
  const goal = top ? `${top.kind}:${top.targetId}:${top.reason}` : 'idle';
  return `${Math.round(v.pos.x)},${Math.round(v.pos.y)} ${goal} ${v.job ? `${v.job.kind}:${v.job.turnsLeft}` : '-'}`;
}

function giveUp(world: World, v: Vehicle): void {
  const top = topGoal(v);
  world.events.push({ t: 'stall', vehicle: v.id, goal: top?.kind ?? null, reason: top?.reason ?? 'idle' });
  v.brain!.goals = [];
  logChange(world, v, top, 'no progress for too long');
  jumpClear(world, v);
  freshGoal(world, v);
  v.brain!.progress = { key: progressKey(v), since: world.turn };
}

function freshGoal(world: World, v: Vehicle): void {
  const next = hasSaleCargo(v) ? saleGoal(world, v, npcProfile(v)) : idleGoal(world, v);
  const goal = next.kind === 'wait' ? exploreGoal(world, v) : next;
  if (goal.kind !== 'wait') pushGoal(world, v, goal);
}

function jumpClear(world: World, v: Vehicle): void {
  const player = vehicleById(world, world.player.vehicleId);
  const home = npcHomeSite(v);
  if (!home || canVehicleSee(world, player, v.pos)) return;
  const spot = jumpSpot(world, v, player, nearestPad(home, v.pos));
  if (!spot) return;
  v.pos = spot;
  v.speed = 0;
  v.order = null;
  v.trail = [];
  delete v.brain!.farRoute;
}

function jumpSpot(world: World, v: Vehicle, player: Vehicle, pad: Vec): Vec | null {
  const radius = vehicleStats(world, v).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const angle = randRange(world, 0, Math.PI * 2);
    const d = randRange(world, radius * 2, NPC_BEHAVIOR.stallJump);
    const spot = { x: v.pos.x + Math.cos(angle) * d, y: v.pos.y + Math.sin(angle) * d };
    if (!isFree(world, spot, radius, v.id) || canVehicleSee(world, player, spot)) continue;
    const end = route(world, spot, pad, radius, [], v).at(-1) ?? spot;
    if (dist(end, pad) <= RULES.arriveRadius * 2) return spot;
  }
  return null;
}

export function getActivityDestination(world: World, vehicle: Vehicle, activity: NpcActivity): Vec | null {
  if (!activity.destination) return null;
  if (activity.kind === 'repair') return repairsHere(vehicle, activity) ? null : activity.destination;
  if (['fight', 'flee', 'raid', 'prowl', 'investigate', 'patrol', 'explore', 'follow'].includes(activity.kind)) return activity.destination;
  return siteStop(world, vehicle, activity, activity.destination);
}

function siteStop(world: World, vehicle: Vehicle, activity: NpcActivity, destination: Vec): Vec {
  const out = vehicleStats(world, vehicle).radius + RULES.arriveRadius;
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === activity.targetId);
  if (site) return parkedOn(vehicle, site) ? { ...vehicle.pos } : siteSpot(world, vehicle, site, out, activity.kind === 'tow' ? TOW.gap / 2 : 0);
  const radius = stockRadius(world, activity) ?? towedRadius(world, activity);
  if (radius === undefined) throw new Error(`Missing activity destination ${activity.targetId}`);
  const angle = Math.atan2(vehicle.pos.y - destination.y, vehicle.pos.x - destination.x);
  return { x: destination.x + Math.cos(angle) * (radius + out), y: destination.y + Math.sin(angle) * (radius + out) };
}

function parkedOn(vehicle: Vehicle, site: Site): boolean {
  return vehicle.speed <= RULES.parkedSpeed && canUseSite(vehicle.pos, site);
}

function siteSpot(world: World, vehicle: Vehicle, site: ReturnType<typeof getKnownSite>, out: number, inward: number): Vec {
  const spot = hashRandom(world.seed, ...charCodes(vehicle.id), ...charCodes(site.id));
  const pad = nearestPad(site, vehicle.pos);
  const angle = Math.atan2(pad.y - site.pos.y, pad.x - site.pos.x);
  const side = (REGION.sites.pad.width / 2 - out) * (2 * spot - 1);
  return { x: pad.x - Math.sin(angle) * side - Math.cos(angle) * inward, y: pad.y + Math.cos(angle) * side - Math.sin(angle) * inward };
}

function charCodes(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function stockRadius(world: World, activity: NpcActivity): number | undefined {
  if (activity.kind !== 'scavenge' && activity.kind !== 'loot') return undefined;
  return world.salvage.find((entry) => entry.id === activity.targetId)?.radius;
}

function towedRadius(world: World, activity: NpcActivity): number | undefined {
  if (!['tow', 'patch', 'meet', 'loot'].includes(activity.kind)) return undefined;
  const towed = world.vehicles.find((entry) => entry.id === activity.targetId);
  return towed && chassisDef(towed.chassisId).radius;
}

type Resolver = (world: World, vehicle: Vehicle, activity: NpcActivity) => void;

function resolveTow(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const ended = runTow(world, vehicle, activity);
  if (ended) finishGoal(world, vehicle, ended);
}

function resolveSearch(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const taken = lootTaken(world, vehicle, activity.targetId);
  if (taken) { finishGoal(world, vehicle, taken); return; }
  const truck = world.vehicles.find((v) => v.id === activity.targetId);
  if (truck) { resolveTruckLoot(world, vehicle, activity, truck); return; }
  const stock = world.salvage.find((entry) => entry.id === activity.targetId);
  if (!stock) { finishGoal(world, vehicle, 'salvage no longer available'); return; }
  if (worksOnLoot(vehicle, stock.id)) { activity.phase = 'act'; return; }
  if (!canReachSalvage(vehicle, stock)) return;
  activity.phase = 'act';
  searchStock(world, vehicle, stock);
}

function resolveTruckLoot(world: World, vehicle: Vehicle, activity: NpcActivity, truck: Vehicle): void {
  if (!canLootTruck(vehicle, truck)) return;
  activity.phase = 'act';
  const ended = lootTruckTurn(world, vehicle, truck);
  if (ended) finishGoal(world, vehicle, ended);
}

function searchStock(world: World, vehicle: Vehicle, stock: SalvageStock): void {
  if (!canTakeAny(world, vehicle, stock)) {
    finishGoal(world, vehicle, !hasSalvage(stock) ? 'salvage exhausted' : 'cargo cannot hold salvage');
    return;
  }
  if (vehicle.job) return;
  if (inCombat(world, vehicle)) finishGoal(world, vehicle, 'combat stops the search');
  else if (!warnedOff(world, vehicle, stock)) beginSearch(world, vehicle, stock.id);
}

export function withinReach(vehicle: Vehicle, activity: NpcActivity): boolean {
  return activity.destination !== null && dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2;
}

function reachedDestination(world: World, vehicle: Vehicle, activity: NpcActivity): boolean {
  return withinReach(vehicle, activity) || world.events.some((e) => e.t === 'arrived' && e.vehicle === vehicle.id);
}

function resolveRaid(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'reached hunting ground');
}

function resolveFlee(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'nowhere farther to run');
}

function resolveInvestigate(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'found nothing at the contact');
}

function reachSite(vehicle: Vehicle, activity: NpcActivity): ReturnType<typeof getKnownSite> | null {
  const site = getKnownSite(activity.targetId!);
  if (!canUseSite(vehicle.pos, site)) return null;
  activity.phase = 'act';
  return site;
}

function noteTown(vehicle: Vehicle, siteId: string): void {
  if (REGION.towns.some((t) => t.id === siteId)) vehicle.brain!.lastTown = siteId;
}

function resolveResupply(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  noteTown(vehicle, site.id);
  serviceAt(world, vehicle, site);
  finishGoal(world, vehicle, 'finished service');
}

function serviceAt(world: World, vehicle: Vehicle, site: Site): void {
  const kind = 'kind' in site ? site.kind : null;
  if (kind === 'oasis') getResources(world, vehicle).supplies = suppliesCap(vehicle);
  else if (kind === 'camp') serviceAtCamp(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else if (shopDef(site.id).kind === 'stall') serviceAtStall(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else serviceVehicle(world, vehicle, site.id, NPC_UPKEEP.repairParts);
}

function resolveSell(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if ('kind' in site && site.kind === 'camp') sellAtCamp(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else sellVehicleCargo(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  noteTown(vehicle, site.id);
  finishGoal(world, vehicle, 'sold cargo');
}

function resolveTrade(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if (!activity.purchase) throw new Error('Trade activity missing purchase');
  noteTown(vehicle, site.id);
  const budget = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  const count = affordableBuyCount(world, vehicle, site.id, activity.purchase.good, cargoRoom(vehicle, activity.purchase.good), budget);
  if (count > 0) {
    tradeGoods(world, vehicle, site.id, activity.purchase.good, count, 'buy');
    if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} trades above its long-term goal`);
    replaceBase(world, vehicle, createSiteActivity('sell', activity.purchase.sellShop, 'deliver purchased cargo'));
    return;
  }
  finishGoal(world, vehicle, 'cannot afford trade cargo');
}

function resolveHaul(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if (!activity.load) throw new Error('Haul activity missing load');
  if (addGoods(world, vehicle, activity.load.good, cargoRoom(vehicle, activity.load.good)) === 0) {
    finishGoal(world, vehicle, 'cargo cannot hold the load');
    return;
  }
  if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} hauls above its long-term goal`);
  replaceBase(world, vehicle, saleGoal(world, vehicle, npcProfile(vehicle)));
}

function resolveTravel(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachSite(vehicle, activity)) finishGoal(world, vehicle, 'arrived');
}

function arrivalResolver(reason: string): Resolver {
  return (world, vehicle, activity) => {
    if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, reason);
  };
}

function resolveRetreat(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (!reachSite(vehicle, activity)) return;
  refitAtHome(world, vehicle);
  finishGoal(world, vehicle, 'refitted at home');
}

function resolveRepair(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (resolveNpcRepair(world, vehicle, activity)) finishGoal(world, vehicle, 'finished field repairs');
}

const RESOLVERS: Partial<Record<NpcActivity['kind'], Resolver>> = {
  tow: resolveTow,
  repair: resolveRepair,
  retreat: resolveRetreat,
  scavenge: resolveSearch,
  loot: resolveSearch,
  raid: resolveRaid,
  investigate: resolveInvestigate,
  flee: resolveFlee,
  resupply: resolveResupply,
  sell: resolveSell,
  trade: resolveTrade,
  haul: resolveHaul,
  travel: resolveTravel,
  prowl: arrivalResolver('prowled the road'),
  patrol: arrivalResolver('patrolled the road'),
  explore: arrivalResolver('explored the spot'),
};

function resolveActivity(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  RESOLVERS[activity.kind]?.(world, vehicle, activity);
}

function canAct(world: World, vehicle: Vehicle): boolean {
  if (corePart(vehicle, 'cab').hp <= 0 || getResources(world, vehicle).health <= 0) return false;
  return vehicle.speed <= RULES.parkedSpeed && !isOnRope(world, vehicle.id);
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (!vehicle.brain || !canAct(world, vehicle)) continue;
    const top = topGoal(vehicle);
    if (top) resolveActivity(world, vehicle, top);
  }
}

function robbedLoot(w: World, victimId: string): Vehicle | SalvageStock | undefined {
  const victim = w.vehicles.find((v) => v.id === victimId);
  if (victim && isKnockedOut(victim)) return victim;
  return w.salvage.find((s) => s.id === wreckStockId(victimId));
}

export function lootRobbed(w: World, robberId: string, victimId: string): void {
  const robber = w.vehicles.find((v) => v.id === robberId);
  if (!robber) return;
  const stock = robbedLoot(w, victimId);
  if (!stock) throw new Error(`${robberId} won a robbery, but ${victimId} left no stock`);
  pushGoal(w, robber, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'loot the robbed truck' });
}
