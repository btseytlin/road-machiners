// NPC goals: the goal stack, the fixed survival rule, the decision points that push and pop goals, and each goal's
// work. See src/sim/npc-decisions.ts for the weighted rolls.

import { ECONOMY } from '../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, type DecisionOptions } from '../data/npcs';
import { SHOPS } from '../data/market';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { TOW } from '../data/tow';
import { callLawmen, inCombat, isHostile, startFeuds, turnPartHits } from './combat';
import { affordableBuyCount, buyFuel, cargoSaleValue, sellAtCamp, sellVehicleCargo, tradeGoods } from './economy';
import { corePart } from './grid';
import { addGoods, cargoRoom } from './inventory';
import { cancelJob } from './jobs';
import { businessBelongs, dealDue } from './npc-business';
import { isFree } from './spawn';
import { bodyStop } from './meeting-stop';
import {
  tradeOffers, tradeSpend, canRob, decide, keepsWord, offersChoice, perceiveDanger, getKnownSite, haulGoods, patrolStopsOf, patrolSite, travelSitesAway,
  huntingGroundsAway, raiderGroundsAway, isHostileContact, isWeak, fitToHunt, huntsPrey, npcProfile, salvageSitesAway, npcSenses, usefulContacts, visibleDowned, visibleHostiles, visibleSalvage, type NpcProfile,
  lootTaken, stockLootInvalid, truckLootInvalid, worksOnLoot, holdsOffRobbery, giveUpStrandedRobberies, forgetFullHold, noteCannotHold, hasSaleCargo, lootPassedUp, holdsUp, robbedFor, bodyCondition, firepower,
} from './npc-decisions';
import { chooseNpcRepair, continueNpcRepair, isDamaged, isStrandedForGood, repairsHere, resolveNpcRepair } from './npc-repair';
import { getResources } from './resources';
import { standingPressures } from './market';
import { remember } from './memory';
import { hashRandom, randInt, randRange } from './rng';
import { sampleWeighted } from './npc-loadout';
import { canLootTruck, canReachSalvage, canTakeAny, CANNOT_HOLD, hasSalvage, isSiteStock, lootClaimedBy, lootTruckTurn, searchTarget } from './salvage';
import { beginSearch } from './search';
import { onNeedySeen } from './aid';
import { vehicleById } from './damage';
import { answersHoldUp, judgeStrandedFoe, plead, warnedOff } from './parley';
import { addState, endState, stateOf, statesHeld } from './states';
import { isStranded, suppliesCap, vehicleStats } from './stats';
import type { Contact, Job, NpcActivity, NpcBrain, NpcState, RefitJob, SalvageStock, Track, Vehicle, World } from './types';
import { canUseSite, isTerritory, nearestPad, type Site } from './sites';
import { spotGoal, territoryOfStock, tripGoal } from './territory';
import { clamp, dist, pointsAway, type Vec } from './vec';
import { heatAt } from './sun';
import { canVehicleSee } from './vision';
import { isWatching, startWatch, watchOver } from './watch-posts';
import { chooseOn, comesInSight, sensedAt, senseTracks, trackOf } from './tracks';
import { dropTow, follows, isOnRope, joinLeader, mercsInSight, npcHomeSite, offerEscort, runTow, steerFollow, steerToStranded, strandedAt, towGoal, towHeldBy } from './tow';
import { isDefeated, isKnockedOut } from './defeat';
import { beginRearm, holdsRearm, rearmInvalid, resolveRearm, resolveResupply, serveStranded, servingSiteIds } from './npc-service';

export const INTERRUPTIONS: readonly NpcActivity['kind'][] = ['fight', 'flee', 'investigate', 'resupply', 'tow', 'loot', 'repair', 'patch', 'meet', 'retreat', 'rearm', 'follow'];

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
  if (job.kind === 'business') return businessBelongs(job, topGoal(v));
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

export function logChange(w: World, v: Vehicle, previous: NpcActivity | null, reason: string): void {
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
  reconsider(v, popped);
  logChange(w, v, popped, reason);
  return popped;
}

export function dropGoal(w: World, v: Vehicle, goal: NpcActivity, reason: string): void {
  const previous = topGoal(v);
  v.brain!.goals = goalsOf(v).filter((g) => g !== goal);
  reconsider(v, goal);
  logChange(w, v, previous, reason);
}

function reconsider(v: Vehicle, goal: NpcActivity): void {
  if ((goal.kind === 'fight' || goal.kind === 'flee') && goal.targetId) delete v.brain!.noticed[`hostileSeen:${goal.targetId}`];
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

function fleeDestination(world: World, vehicle: Vehicle, profile: NpcProfile, threatPos: Vec): Vec {
  const safe = [...profile.towns, ...profile.bases].map(getKnownSite).filter((site) => pointsAway(vehicle.pos, site.pos, threatPos));
  safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const away = { x: vehicle.pos.x + (vehicle.pos.x - threatPos.x), y: vehicle.pos.y + (vehicle.pos.y - threatPos.y) };
  const destination = safe[0] ? siteSpot(world, vehicle, safe[0], vehicleStats(world, vehicle).radius + RULES.arriveRadius, 0) : away;
  return { x: clamp(destination.x, 1, world.size - 1), y: clamp(destination.y, 1, world.size - 1) };
}

type ServiceNeed = { reason: string; suppliesOnly: boolean };

function unfitHunter(world: World, vehicle: Vehicle): boolean {
  return huntsPrey(vehicle) && !fitToHunt(world, vehicle);
}

function pumpsOf(vehicle: Vehicle, profile: NpcProfile, broke: boolean): string[] {
  if (broke) return servingSiteIds(profile);
  if (profile.bases.length > 0) return profile.bases;
  if (profile.towns.length === 0) throw new Error(`${vehicle.id} knows no pump`);
  return [...profile.towns, ...SERVICE_STALLS];
}

const SERVICE_STALLS: readonly string[] = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);

function fuelToPump(world: World, vehicle: Vehicle, profile: NpcProfile): number {
  const pump = chooseNearestSite(vehicle, pumpsOf(vehicle, profile, isBroke(world, vehicle)));
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
  if (holdsRearm(vehicle)) return null;
  const needs: [string, boolean][] = [
    ['low fuel', isLowOnFuel(world, vehicle, profile)],
    ['low supplies', getResources(world, vehicle).supplies <= suppliesCap(vehicle) * NPC_UPKEEP.lowSupplies],
    ['needs repairs', isDamaged(vehicle)],
    ['unfit to hunt', unfitHunter(world, vehicle)],
  ];
  const held = needs.filter(([, need]) => need).map(([reason]) => reason);
  if (held.length === 0) return null;
  return { reason: held[0], suppliesOnly: held.length === 1 && held[0] === 'low supplies' };
}

export function isBroke(world: World, vehicle: Vehicle): boolean {
  return getResources(world, vehicle).money < Math.min(ECONOMY.supplyPrice.fuel, ECONOMY.supplyPrice.supplies);
}

function serviceGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  const need = serviceNeed(world, vehicle, profile);
  if (!need) return null;
  const oasis = need.suppliesOnly ? chooseNearestSite(vehicle, profile.supplySites) : undefined;
  if (oasis) return createSiteActivity('resupply', oasis.id, 'low supplies');
  if (isBroke(world, vehicle)) return brokeServiceGoal(world, vehicle, profile, need);
  return serviceTrip(world, vehicle, profile, need);
}

function brokeServiceGoal(world: World, vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed): NpcActivity | null {
  if (hasSaleCargo(vehicle)) return saleGoal(world, vehicle, profile);
  const trip = isStranded(world, vehicle) || isLowOnFuel(world, vehicle, profile) || unfitHunter(world, vehicle);
  return trip ? serviceTrip(world, vehicle, profile, need) : null;
}

function serviceTrip(world: World, vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed): NpcActivity {
  const stop = chooseNearestSite(vehicle, serviceStops(world, vehicle, profile));
  if (!stop) throw new Error(`${vehicle.id} knows no service stop`);
  return createSiteActivity('resupply', stop.id, need.reason);
}

function serviceStops(world: World, vehicle: Vehicle, profile: NpcProfile): string[] {
  if (profile.bases.length > 0) return profile.bases;
  if (isStrandedForGood(vehicle)) return servingSiteIds(profile);
  return pumpsOf(vehicle, profile, isBroke(world, vehicle));
}

export function saleGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
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
  return siteGoal(world, vehicle);
}

function siteGoal(world: World, vehicle: Vehicle): NpcActivity {
  const sites = salvageSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose to scavenge with no salvage known`);
  const site = sites[randInt(world, 0, sites.length - 1)];
  return isTerritory(site) ? spotGoal(world, site.id) : createSiteActivity('scavenge', site.id, 'search a known salvage site');
}

type IdleGoal = (world: World, vehicle: Vehicle) => NpcActivity;

function huntingGoal(kind: 'raid' | 'prowl', reason: string, grounds: (world: World, vehicle: Vehicle) => Vec[]): IdleGoal {
  return (world, vehicle) => {
    const places = grounds(world, vehicle);
    if (places.length === 0) throw new Error(`${vehicle.id} chose to ${kind} with no hunting ground away`);
    return createActivity(kind, null, { ...places[randInt(world, 0, places.length - 1)] }, reason);
  };
}

function patrolGoal(world: World, vehicle: Vehicle): NpcActivity {
  const site = patrolSite(vehicle);
  const points = patrolStopsOf(world, vehicle);
  if (points.length === 0) throw new Error(`${vehicle.id} chose to patrol ${site.id} with no road near it`);
  return createActivity('patrol', site.id, { ...points[randInt(world, 0, points.length - 1)] }, `patrol the roads near ${'kind' in site && site.kind === 'camp' ? 'camp' : 'town'}`);
}

function travelGoal(world: World, vehicle: Vehicle): NpcActivity {
  const sites = travelSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose a trip with no known site away`);
  const site = sites[randInt(world, 0, sites.length - 1)];
  return isTerritory(site) ? tripGoal(vehicle, site) : createSiteActivity('travel', site.id, 'make a trip to another site');
}

export function exploreGoal(world: World, vehicle: Vehicle): NpcActivity {
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
  raid: huntingGoal('raid', 'watch the road for prey', raiderGroundsAway),
  prowl: huntingGoal('prowl', 'prowl the roads for wrecks', (_world, vehicle) => huntingGroundsAway(vehicle)),
  patrol: patrolGoal,
  travel: travelGoal,
  explore: exploreGoal,
  haul: haulGoal,
  escort: joinLeader,
};

export function idleGoal(world: World, vehicle: Vehicle): NpcActivity {
  if (keepsWord(world, vehicle, 'idle', null)) return createActivity('wait', null, null, 'keep its word');
  const option = decide(world, vehicle, 'idle', null, null);
  if (option === 'wait') return createActivity('wait', null, null, 'nothing worth doing');
  return IDLE_GOALS[option](world, vehicle);
}

export function finishGoal(world: World, vehicle: Vehicle, reason: string): void {
  const done = popGoal(world, vehicle, reason);
  if (reason === CANNOT_HOLD) noteCannotHold(world, vehicle, done.targetId);
  const goals = vehicle.brain!.goals;
  if (!INTERRUPTIONS.includes(done.kind) || goals.length !== 1 || INTERRUPTIONS.includes(goals[0].kind)) return;
  resumeOrDrop(world, vehicle);
}

function resumeOrDrop(world: World, vehicle: Vehicle): void {
  if (decide(world, vehicle, 'resume', null, null) === 'new') return void popGoal(world, vehicle, 'chose something new');
  if (isWatching(vehicle)) popGoal(world, vehicle, 'left its post');
}

function heldTow(world: World, vehicle: Vehicle): NpcState | null {
  return towHeldBy(world, vehicle.id);
}

type GoalCheck = (world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]) => string | null;

const GAVE_UP_ROBBERY = 'stranded, gave up the robbery';

function fightInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  if (!target || !isHostile(world, vehicle, target)) return 'lost the target';
  if (holdsOffRobbery(world, vehicle, target)) return GAVE_UP_ROBBERY;
  if (firepower(world, vehicle) <= 0) return 'no gun left to fight with';
  return fightTargetLost(world, vehicle, target, contacts) ? 'lost the target' : null;
}

function fightTargetLost(world: World, vehicle: Vehicle, target: Vehicle, contacts: Contact[]): boolean {
  if (sensedAt(world, vehicle, target.id, contacts)) return false;
  const track = trackOf(vehicle, target.id);
  if (!track) throw new Error(`${vehicle.id} fights ${target.id} with no track of it`);
  return world.turn - track.turn > NPC_BEHAVIOR.fightSearchTurns;
}

function steerFight(_world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const track = trackOf(vehicle, goal.targetId!);
  if (!track) throw new Error(`${vehicle.id} fights ${goal.targetId} with no track of it`);
  goal.destination = { ...track.at };
}

function fightGoal(world: World, vehicle: Vehicle, target: Vehicle, reason: string): NpcActivity {
  chooseOn(world, vehicle, target.id, target.pos, 'fight', true);
  const worn = { turn: world.turn, condition: bodyCondition(target) };
  const goal: NpcActivity = { ...createActivity('fight', target.id, { ...target.pos }, reason), worn };
  if (target.id === world.player.vehicleId || robbedFor(world, vehicle, target)) goal.demands = decide(world, vehicle, 'mugging', target.id, null) === 'demand';
  return goal;
}

function giveUpStalledFight(world: World, vehicle: Vehicle): void {
  const goal = topGoal(vehicle);
  const target = goal?.kind === 'fight' ? world.vehicles.find((v) => v.id === goal.targetId) : undefined;
  if (!target || !stalls(world, goal!, target)) return;
  for (const s of statesHeld(world, vehicle.id).filter((x) => x.kind === 'feud' && x.other === target.id)) endState(world, s, 'broken');
  addState(world, 'backedOff', vehicle.id, target.id, { kind: 'none' });
  chooseOn(world, vehicle, target.id, target.pos, 'keep', true);
  finishGoal(world, vehicle, 'cannot wear the target down');
}

function stalls(world: World, goal: NpcActivity, target: Vehicle): boolean {
  if (!goal.worn) throw new Error(`A fight on ${goal.targetId} has no record of wearing it down`);
  const condition = bodyCondition(target);
  if (goal.worn.condition - condition >= NPC_BEHAVIOR.fightWearShare) goal.worn = { turn: world.turn, condition };
  return world.turn - goal.worn.turn > NPC_BEHAVIOR.fightStallTurns;
}

function onHoldUp(world: World, vehicle: Vehicle): void {
  const goal = topGoal(vehicle);
  const prey = goal ? preyToAsk(world, vehicle, goal) : null;
  if (!goal || !prey) return;
  goal.demands = false;
  answersHoldUp(world, prey, vehicle, decide(world, prey, 'threatened', vehicle.id, perceiveDanger(world, prey, vehicle)));
}

function preyToAsk(world: World, vehicle: Vehicle, goal: NpcActivity): Vehicle | null {
  if (goal.kind !== 'fight' || !goal.demands || goal.targetId === world.player.vehicleId) return null;
  const prey = vehicleById(world, goal.targetId!);
  return canVehicleSee(world, vehicle, prey.pos) && holdsUp(world, vehicle, prey, null) ? prey : null;
}

function fleeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (visibleHostiles(world, vehicle).length > 0 || contacts.some((c) => c.vehicleId === goal.targetId)) return null;
  if (goal.perceived === undefined) throw new Error(`${vehicle.id} flees from ${goal.targetId} with no turn it last perceived it`);
  return world.turn - goal.perceived > NPC_BEHAVIOR.fleeCalmTurns ? 'no hostile in sight' : null;
}

function investigateInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  if (!target || !isHostile(world, vehicle, target)) return 'the contact is gone';
  return holdsOffRobbery(world, vehicle, target) ? GAVE_UP_ROBBERY : null;
}

function scavengeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  return lootPassedUp(vehicle, goal.targetId) ?? scavengeTargetInvalid(world, vehicle, goal);
}

function scavengeTargetInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (goal.targetId === null || [...REGION.towns, ...REGION.locations].some((site) => site.id === goal.targetId)) return null;
  const known = world.salvage.some((stock) => stock.id === goal.targetId && territoryOfStock(stock));
  if (known) return lootTaken(world, vehicle, goal.targetId);
  const seen = world.salvage.some((stock) => stock.id === goal.targetId && canVehicleSee(world, vehicle, stock.pos));
  return lootTaken(world, vehicle, goal.targetId) ?? (seen ? null : 'lost sight of the salvage');
}

function lootInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const truck = world.vehicles.find((v) => v.id === goal.targetId);
  return lootPassedUp(vehicle, goal.targetId) ?? lootTaken(world, vehicle, goal.targetId) ?? (truck ? truckLootInvalid(vehicle, truck) : stockLootInvalid(world, vehicle, goal));
}

function towInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (heldTow(world, vehicle)) return null;
  const client = world.vehicles.find((v) => v.id === goal.targetId);
  if (!client || stateOf(world, 'turnedDown', vehicle.id, client.id)) return 'the tow is off';
  if (!stateOf(world, 'answering', vehicle.id, client.id)) return 'could not get through to the truck';
  return strandedAt(world, vehicle, client) ? null : 'the tow is off';
}

function patchInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const other = goal.targetId;
  const held = world.states.some((s) => s.kind === 'patch' && ((s.holder === vehicle.id && s.other === other) || (s.holder === other && s.other === vehicle.id)));
  return held ? null : 'the patch is off';
}

export function patchGoal(world: World, npc: Vehicle, other: Vehicle, patcher: boolean): void {
  const goal = patcher
    ? createActivity('patch', other.id, { ...other.pos }, 'patch a truck')
    : createActivity('patch', other.id, null, 'wait for a patch');
  pushGoal(world, npc, goal);
}

export function meetGoal(world: World, npc: Vehicle, other: Vehicle, reason: string): void {
  pushGoal(world, npc, createActivity('meet', other.id, isStranded(world, npc) ? null : { ...other.pos }, reason));
}

const GOAL_CHECKS: Partial<Record<NpcActivity['kind'], GoalCheck>> = {
  fight: fightInvalid,
  rearm: rearmInvalid,
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
const DEAL_GOALS: readonly NpcActivity['kind'][] = ['meet', 'patch'];

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
  return watchOver(world, goal) ?? GOAL_CHECKS[goal.kind]?.(world, vehicle, goal, contacts) ?? null;
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

export type NoticedDecision = 'preySeen' | 'strandedSeen' | 'salvageSeen' | 'ramChance' | 'escortSeen' | 'strandedFoe' | 'surrenderOffered' | 'needySeen';

type Perception = (world: World, vehicle: Vehicle, id: string, contacts: Contact[]) => boolean;

function seesVehicle(world: World, vehicle: Vehicle, id: string): boolean {
  const other = world.vehicles.find((v) => v.id === id);
  return other !== undefined && canVehicleSee(world, vehicle, other.pos);
}

function seesStock(world: World, vehicle: Vehicle, id: string): boolean {
  const stock = world.salvage.find((s) => s.id === id) ?? world.vehicles.find((v) => v.id === id && isKnockedOut(v));
  return stock !== undefined && canVehicleSee(world, vehicle, stock.pos);
}

function hasRamChance(world: World, vehicle: Vehicle, id: string): boolean {
  return world.vehicles.some((v) => v.id === id) && offersChoice(world, vehicle, 'ramChance', id);
}

const PERCEIVES: Record<NoticedDecision, Perception> = {
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
  const seen = decision === 'preySeen';
  return decide(world, vehicle, decision, id, seen ? perceiveDanger(world, vehicle, vehicleById(world, id)) : null);
}

export function fightCornered(world: World, vehicle: Vehicle, foe: Vehicle): void {
  interrupt(world, vehicle, fightGoal(world, vehicle, foe, 'cornered'));
}

type HostileDecision = 'hostileSeen' | 'contactHeard';

function rollOnHostile<D extends HostileDecision>(world: World, vehicle: Vehicle, decision: D, id: string, at: Vec): DecisionOptions[D] {
  if (!offersChoice(world, vehicle, decision, id)) return 'keep' as DecisionOptions[D];
  const seen = decision === 'hostileSeen';
  const option = decide(world, vehicle, decision, id, seen ? perceiveDanger(world, vehicle, vehicleById(world, id)) : null);
  chooseOn(world, vehicle, id, at, option, seen);
  return option;
}

function reactSeen(world: World, vehicle: Vehicle, enemy: Vehicle): DecisionOptions['hostileSeen'] | null {
  const track = trackOf(vehicle, enemy.id);
  if (track?.choice === 'flee') return runsAgain(world, vehicle, track);
  if (track?.chosenInSight) return null;
  return rollOnHostile(world, vehicle, 'hostileSeen', enemy.id, enemy.pos);
}

function runsAgain(world: World, vehicle: Vehicle, track: Track): 'flee' | null {
  return comesInSight(world, track) && topGoal(vehicle)?.kind !== 'flee' ? 'flee' : null;
}

function reactHeard(world: World, vehicle: Vehicle, contact: Contact): DecisionOptions['contactHeard'] | null {
  if (trackOf(vehicle, contact.vehicleId)?.choice) return null;
  return rollOnHostile(world, vehicle, 'contactHeard', contact.vehicleId, contact.center);
}

function seenFleeReason(world: World, vehicle: Vehicle, enemy: Vehicle): string {
  if (trackOf(vehicle, enemy.id)?.choice === 'flee') return 'avoid a truck it ran from';
  return isWeak(world, vehicle) ? 'damaged and threatened' : 'avoid a costly fight';
}

function interrupt(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const tow = heldTow(world, vehicle);
  if (tow) {
    dropTow(world, tow, 'danger');
    if (popGoal(world, vehicle, 'dropped the tow').kind !== 'tow') throw new Error(`${vehicle.id} held a tow without a tow goal on top`);
  }
  if (goal.kind === 'flee') dropChases(world, vehicle, goal.targetId);
  pushGoal(world, vehicle, goal);
}

function dropChases(world: World, vehicle: Vehicle, threatId: string | null): void {
  for (const goal of goalsOf(vehicle).filter((g) => g.kind === 'investigate' && g.targetId === threatId)) dropGoal(world, vehicle, goal, 'ran from it');
}

function fleeFrom(world: World, vehicle: Vehicle, profile: NpcProfile, threatId: string, threatPos: Vec, reason: string): NpcActivity {
  chooseOn(world, vehicle, threatId, threatPos, 'flee', true);
  return { ...createActivity('flee', threatId, fleeDestination(world, vehicle, profile, threatPos), reason), perceived: world.turn };
}

function onHostilesSeen(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  for (const enemy of visibleHostiles(world, vehicle)) {
    const reason = seenFleeReason(world, vehicle, enemy);
    const option = reactSeen(world, vehicle, enemy);
    if (option === null || option === 'keep') continue;
    if (option === 'fight') interrupt(world, vehicle, fightGoal(world, vehicle, enemy, 'fight a hostile in sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, enemy.id, enemy.pos, reason));
    return;
  }
}

function onContactsHeard(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  if (heldTow(world, vehicle)) return;
  for (const contact of hostileContacts(world, vehicle, contacts)) {
    const option = reactHeard(world, vehicle, contact);
    if (option === null || option === 'keep') continue;
    if (option === 'investigate') interrupt(world, vehicle, createActivity('investigate', contact.vehicleId, { ...contact.center }, 'heard a hostile beyond sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, contact.vehicleId, contact.center, 'heard a hostile beyond sight'));
    return;
  }
}

function onContactSpotted(world: World, vehicle: Vehicle): void {
  const goal = topGoal(vehicle);
  if (goal?.kind !== 'investigate') return;
  if (!canVehicleSee(world, vehicle, vehicleById(world, goal.targetId!).pos)) return;
  finishGoal(world, vehicle, 'spotted the truck it heard');
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
    if (isFighting(vehicle, shooter.id)) continue;
    const option = decide(world, vehicle, 'attacked', shooter.id, perceiveDanger(world, vehicle, shooter));
    if (keepsOn(vehicle, option)) {
      letBe(world, vehicle, shooter);
      continue;
    }
    if (option === 'fightBack') interrupt(world, vehicle, fightGoal(world, vehicle, shooter, 'fight back'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, shooter.id, shooter.pos, 'escape an attacker'));
    return;
  }
}

function keepsOn(vehicle: Vehicle, option: DecisionOptions['attacked']): boolean {
  return option === 'keep' || (option === 'fightBack' && topGoal(vehicle)?.kind === 'fight');
}

function letBe(world: World, vehicle: Vehicle, shooter: Vehicle): void {
  if (trackOf(vehicle, shooter.id)?.choice !== 'flee') chooseOn(world, vehicle, shooter.id, shooter.pos, 'keep', true);
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
  if (option === 'flee') interrupt(world, vehicle, fleeFrom(world, vehicle, npcProfile(vehicle), foe.id, foe.pos, 'break off a losing fight'));
  else if (option !== 'keep') plead(world, vehicle, foe, option === 'truce' ? 'truce' : 'mercy');
}

function hurtingFoe(world: World, vehicle: Vehicle): Vehicle | null {
  if (vehicle.brain!.hurt <= 0) return null;
  const foe = world.vehicles.find((v) => v.id === vehicle.lastHitBy);
  return foe && isHostile(world, vehicle, foe) && canVehicleSee(world, vehicle, foe.pos) ? foe : null;
}

export function defyThreat(world: World, vehicle: Vehicle, threatener: Vehicle, answer: Exclude<DecisionOptions['threatened'], 'comply'>, reason = answer === 'fightBack' ? 'refuse a threat' : 'escape a threat'): void {
  startFeuds(world, threatener, vehicle);
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
  meet: (world, _vehicle, goal) => { if (goal.destination) goal.destination = { ...vehicleById(world, goal.targetId!).pos }; },
  follow: steerFollow,
};

function steerFlee(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[], goal: NpcActivity): void {
  const threat = fleeThreat(world, vehicle, contacts, goal);
  if (threat) goal.destination = fleeDestination(world, vehicle, profile, threat);
  if (threat || vehicle.brain!.hurt > 0) goal.perceived = world.turn;
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
  const { seen, contacts } = npcSenses(world, vehicle);
  forget(world, vehicle, contacts);
  senseTracks(world, vehicle, seen, contacts);
  pruneAttackers(world, vehicle);
  forgetFullHold(world, vehicle);
  breakOffDeals(world, vehicle);
  giveUpStrandedRobberies(world, vehicle);
  giveUpStalledFight(world, vehicle);
  dropInvalidGoals(world, vehicle, contacts);
  serveStranded(world, vehicle, profile);
  if (isDefeated(vehicle)) return defeatedActivity(world, vehicle, profile, contacts);
  applyFixedRules(world, vehicle, profile);
  onGrievances(world, vehicle);
  onParley(world, vehicle);
  dropInvalidGoals(world, vehicle, contacts);
  onContactSpotted(world, vehicle);
  onAttacked(world, vehicle, profile);
  onHostilesSeen(world, vehicle, profile);
  onContactsHeard(world, vehicle, profile, contacts);
  onPreySeen(world, vehicle);
  onHoldUp(world, vehicle);
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

function defeatedActivity(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): NpcActivity {
  const top = topGoal(vehicle);
  if (!top || !DEAL_GOALS.includes(top.kind)) return retreatHome(world, vehicle);
  steer(world, vehicle, profile, contacts);
  return currentActivity(world, vehicle, profile);
}

function retreatHome(world: World, vehicle: Vehicle): NpcActivity {
  const top = topGoal(vehicle)?.kind;
  if (top !== 'retreat' && top !== 'rearm') {
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
  if (!urgent && staysOnWork(world, vehicle)) return;
  if (service && !vehicle.brain!.goals.some((g) => g.kind === service.kind)) pushGoal(world, vehicle, service);
}

function staysOnWork(world: World, vehicle: Vehicle): boolean {
  if (vehicle.job?.kind === 'refit' && jobBelongs(vehicle.job, vehicle)) return true;
  return keepRepairing(world, vehicle);
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

export function awaitsTower(world: World, vehicle: Vehicle): boolean {
  return !inDanger(vehicle) && world.states.some((s) => s.kind === 'answering' && s.other === vehicle.id);
}

function nextGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const next = hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : idleGoal(world, vehicle);
  if (next.kind !== 'wait' && topGoal(vehicle) !== next) pushGoal(world, vehicle, next);
  return next;
}

export function noteHurt(world: World): void {
  const hits = turnPartHits(world);
  for (const v of world.vehicles) {
    if (v.brain) v.brain.hurt = (hits.get(v.id) ?? []).reduce((sum, hit) => sum + hit.damage, 0);
  }
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
  if (site) return padStop(world, vehicle, activity, site, out);
  return bodyStop(world, vehicle, activity, destination, out);
}

function padStop(world: World, vehicle: Vehicle, activity: NpcActivity, site: Site, out: number): Vec {
  if (isTerritory(site)) return activity.destination!;
  return parkedOn(vehicle, site) ? { ...vehicle.pos } : siteSpot(world, vehicle, site, out, activity.kind === 'tow' ? TOW.gap / 2 : 0);
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
  const found = searchTarget(world, vehicle, activity.targetId);
  if ('ended' in found) { finishGoal(world, vehicle, found.ended); return; }
  const { stock } = found;
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
  if (!hasSalvage(stock)) return void finishGoal(world, vehicle, 'salvage exhausted');
  if (!canTakeAny(world, vehicle, stock)) return void finishGoal(world, vehicle, CANNOT_HOLD);
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
  if (activity.phase === 'travel' && reachedDestination(world, vehicle, activity)) startWatch(world, activity);
}

function resolveFlee(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'nowhere farther to run');
}

function resolveInvestigate(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'found nothing at the contact');
}

export function reachSite(vehicle: Vehicle, activity: NpcActivity): ReturnType<typeof getKnownSite> | null {
  const site = getKnownSite(activity.targetId!);
  if (!canUseSite(vehicle.pos, site)) return null;
  activity.phase = 'act';
  return site;
}

export function noteShop(world: World, vehicle: Vehicle, siteId: string): void {
  if (siteId in SHOPS) remember(world, vehicle, { kind: 'prices', shop: siteId, pressure: standingPressures(world, siteId) });
}

function topUpAtPump(world: World, vehicle: Vehicle, siteId: string): void {
  noteShop(world, vehicle, siteId);
  if (pumpsOf(vehicle, npcProfile(vehicle), isBroke(world, vehicle)).includes(siteId)) buyFuel(world, vehicle);
}

function resolveSell(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!dealDue(world, vehicle, activity, site)) return;
  if ('kind' in site && site.kind === 'camp') sellAtCamp(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else sellVehicleCargo(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  topUpAtPump(world, vehicle, site.id);
  finishGoal(world, vehicle, 'sold cargo');
}

function resolveTrade(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!dealDue(world, vehicle, activity, site)) return;
  if (!activity.purchase) throw new Error('Trade activity missing purchase');
  noteShop(world, vehicle, site.id);
  const count = affordableBuyCount(world, vehicle, site.id, activity.purchase.good, cargoRoom(vehicle, activity.purchase.good), tradeSpend(world, vehicle));
  if (count > 0) {
    tradeGoods(world, vehicle, site.id, activity.purchase.good, count, 'buy');
    topUpAtPump(world, vehicle, site.id);
    if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} trades above its long-term goal`);
    replaceBase(world, vehicle, createSiteActivity('sell', activity.purchase.sellShop, 'deliver purchased cargo'));
    return;
  }
  topUpAtPump(world, vehicle, site.id);
  finishGoal(world, vehicle, 'cannot afford trade cargo');
}

function resolveHaul(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!dealDue(world, vehicle, activity, site)) return;
  if (!activity.load) throw new Error('Haul activity missing load');
  if (addGoods(world, vehicle, activity.load.good, cargoRoom(vehicle, activity.load.good)) === 0) {
    finishGoal(world, vehicle, 'cargo cannot hold the load');
    return;
  }
  if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} hauls above its long-term goal`);
  replaceBase(world, vehicle, saleGoal(world, vehicle, npcProfile(vehicle)));
}

function resolveTravel(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const arrived = isTerritory(getKnownSite(activity.targetId!)) ? reachedDestination(world, vehicle, activity) : reachSite(vehicle, activity);
  if (arrived) finishGoal(world, vehicle, 'arrived');
}

function arrivalResolver(reason: string): Resolver {
  return (world, vehicle, activity) => {
    if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, reason);
  };
}

function resolveRetreat(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (site) beginRearm(world, vehicle, site);
}

function resolveRepair(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (resolveNpcRepair(world, vehicle, activity)) finishGoal(world, vehicle, 'finished field repairs');
}

const RESOLVERS: Partial<Record<NpcActivity['kind'], Resolver>> = {
  tow: resolveTow,
  repair: resolveRepair,
  retreat: resolveRetreat,
  rearm: resolveRearm,
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
  if (isKnockedOut(vehicle) || corePart(vehicle, 'cab').hp <= 0 || getResources(world, vehicle).health <= 0) return false;
  return vehicle.speed <= RULES.parkedSpeed && !isOnRope(world, vehicle.id);
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (!vehicle.brain || !canAct(world, vehicle)) continue;
    const top = topGoal(vehicle);
    if (top) resolveActivity(world, vehicle, top);
  }
}
