// A scripted player for the progression recorder. Each turn it picks the player's commands for one archetype and
// applies them through the public command functions, like the UI would. It keeps no state of its own: every choice
// follows from the world, so the same world always gets the same commands. The bot is a policy, not the NPC brain.

import { chassisDef } from '../../data/chassis';
import { ECONOMY, GOOD_IDS } from '../../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, TRAITS } from '../../data/npcs';
import { partDef } from '../../data/parts';
import { REGION, type TownDef } from '../../data/region';
import { RULES } from '../../data/rules';
import { TERRAIN } from '../../data/terrain';
import { ENGINE_HEAT } from '../../data/wear';
import { TOPICS, type LineId, type TopicId } from '../../data/dialogue';
import { isJunk, maxHp, partValue } from '../wear';
import { inCombat, isHostile } from '../combat';
import { startStrip, stripYield } from '../jobs';
import { aimGuns, isSoftTarget } from './aim';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder, setWeaponOrder } from '../world';
import { playerVehicle, vehicleById } from '../damage';
import { isDefeated, isKnockedOut } from '../defeat';
import { callVehicle, chooseOption, currentOptions, hangUp } from '../dialogue';
import { offeredSurrenderBy, type ThreatAnswer } from '../parley';
import { hashRandom } from '../rng';
import { affordableBuyCount, basicsRepairCost, buyGood, buyStockPart, buySupply, canRebuild, driveRepairCost, partRepairCost, partTradePrice, getLotTradePrice, getTradePrice, repairBasics, repairCost, repairDrive, repairPart, sellGood, sellPart, supplyRoom } from '../economy';
import { corePart, findSpot, freeCells, goodsCount, gridOf, isMounted, itemCells, MOUNT_CELLS, mountedItems, mountedParts, type Spot } from '../grid';
import { cargoMassRoom, cargoRoom, getLayoutError, stowSpot, storePart } from '../inventory';
import { itemMass } from '../mass';
import { acceptContract, deliverContract, estimateTurns, shopAt, shopState, siteOf, type Contract } from '../market';
import { CONTRACTS, shopDef, SHOPS } from '../../data/market';
import { heatAt } from '../sun';
import { canLoot, downedHere, downedNear, needsSearch, salvageHere, takeAllLoot } from '../locations';
import { topGoal } from '../npc-activities';
import { firepower, getUpkeepReserve, isWeak, judgeDanger, getKnownSite, strengthRatio, tripFuelCost } from '../npc-decisions';
import { fightOdds } from '../fight-odds';
import { warnedOffTarget } from '../loot-warning';
import { canLootTruck, canReachSalvage, hasSalvage, isSiteStock, lootBlocker, takeError, takeFromTruck } from '../salvage';
import { startSearch } from '../search';
import { canUseSite, nearestPad, nearestTown, siteGates, sitePads, townAt, type Site } from '../sites';
import { fuelCap, hasWorkingEngine, isStranded, isWorking, suppliesCap, vehicleStats } from '../stats';
import { escortsOf, inTowReach, playerTow, setBeacon } from '../tow';
import { towData } from '../states';
import type { Call, Faction, GoalReason, GridItem, NpcState, PartInstance, SalvageStock, Vehicle, World } from '../types';
import { dist, pointsAway, type Vec } from '../vec';
import { canVehicleSee, playerExplored, playerSees } from '../vision';
import { reachedOutpostAt } from '../fury-road';
import { runnerOrders } from './runner';
import { BIGGEST_PART_CELLS, mountBought, Orders, rearm, REPAIR_PARTS, upgradeGear, type BotTurn, type UpgradeStyle } from './orders';

export type Archetype = 'trader' | 'scavenger' | 'hunter' | 'fastTrader' | 'hauler' | 'climber' | 'markov' | 'runner';
export const ARCHETYPES: readonly Archetype[] = ['trader', 'scavenger', 'hunter', 'fastTrader', 'hauler', 'climber', 'markov', 'runner'];
export type Policy = Archetype | 'robber' | 'convoyRobber';
export const POLICIES: readonly Policy[] = [...ARCHETYPES, 'robber', 'convoyRobber'];
type Goal = Exclude<Policy, 'markov' | 'climber' | 'runner'>;

const CLIMB_GUNS = 3;
const GOALS_PLAYED: readonly Goal[] = ['trader', 'scavenger', 'hunter', 'fastTrader'];

const CARGO_GEAR: UpgradeStyle = { skip: [], chassis: 'value', job: 'carrier' };
const GEAR_STYLES: Record<Goal, UpgradeStyle> = {
  trader: { skip: [], chassis: 'value', job: 'trader' },
  scavenger: { skip: [], chassis: 'value', job: 'carrier' },
  hunter: { skip: [], chassis: 'keep', job: 'fighter' },
  fastTrader: { skip: ['armor'], chassis: 'speed', job: 'courier' },
  hauler: CARGO_GEAR,
  robber: CARGO_GEAR,
  convoyRobber: CARGO_GEAR,
};

const CLIMBER_GEAR: UpgradeStyle = { skip: [], chassis: 'keep', job: 'fighter', budgetJob: 'trader' };

function gearStyle(o: Orders, goal: Goal, archetype: Policy): UpgradeStyle {
  if (archetype === 'climber') return CLIMBER_GEAR;
  if (goal !== 'hunter') return GEAR_STYLES[goal];
  return { ...GEAR_STYLES.hunter, lootRoom: BIGGEST_PART_CELLS, minSpeed: huntedSpeed(o.world) };
}

function huntedSpeed(world: World): number | undefined {
  const foes = world.vehicles.filter((v) => v.faction === 'raiders' && v.brain !== null && !isKnockedOut(v) && huntable(world, v));
  return foes.length === 0 ? undefined : Math.max(...foes.map((v) => vehicleStats(world, v).maxSpeed));
}

export type BotOptions = { markovTurns?: number; tolerateStalls?: boolean; kit?: string; noGear?: boolean; settings?: Record<string, number> };

const MARKOV_SALT = 0x6d61726b;

export function isPolicy(value: string): value is Policy {
  return (POLICIES as readonly string[]).includes(value);
}

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

export function botOrders(world: World, archetype: Policy, options: BotOptions = {}): BotTurn {
  return archetype === 'runner' ? runnerOrders(world) : policyOrders(world, archetype, options);
}

function policyOrders(world: World, archetype: Exclude<Policy, 'runner'>, options: BotOptions): BotTurn {
  const o = new Orders(world);
  const goal = goalOf(world, archetype, options);
  o.fieldRepair = goal === 'hunter';
  o.buysGear = options.noGear !== true;
  const replies = goal === 'hunter' && archetype !== 'climber' ? HUNTER_REPLIES : DEFENDER_REPLIES;
  answerCall(o, takesTowOffer(world) ? replies : { ...replies, ...REFUSE_TOW });
  if (playerCanAct(o.world)) {
    keepSwitches(o);
    act(o, goal, archetype);
  }
  return { world: o.world, events: o.events, ledger: o.ledger, notes: o.notes };
}

function act(o: Orders, goal: Goal, archetype: Policy): void {
  if (holds(o) || collectNearbyKnockout(o, goal, archetype)) return;
  if (serviceTrip(o, gearStyle(o, goal, archetype)) || defend(o, goal)) return;
  followGoal(o, goal, archetype);
}

function collectNearbyKnockout(o: Orders, goal: Goal, archetype: Policy): boolean {
  if (archetype !== 'climber' || goal !== 'hunter') return false;
  if (isStranded(o.world, o.me) || inCombat(o.world, o.me)) return false;
  return downedNear(o.world) !== null && stripDowned(o);
}

function followGoal(o: Orders, goal: Goal, archetype: Policy): void {
  if (archetype === 'climber' && goal === 'hunter') hunterGoal(o, true);
  else GOALS[goal](o);
}

export function parkedOnPurpose(world: World): boolean {
  if (world.player.state === 'knockedOut') return true;
  return playerVehicle(world).job !== null || patchDeal(world) !== null || shopAt(world) !== null || reachedOutpostAt(world) !== null;
}

function climberGoal(world: World): Goal {
  return vehicleStats(world, playerVehicle(world)).weapons.length >= CLIMB_GUNS ? 'hunter' : 'trader';
}

function goalOf(world: World, archetype: Exclude<Policy, 'runner'>, options: BotOptions): Goal {
  if (archetype === 'climber') return climberGoal(world);
  if (archetype !== 'markov') return archetype;
  const { markovTurns } = options;
  if (markovTurns === undefined || !Number.isInteger(markovTurns) || markovTurns <= 0) throw new Error(`The markov bot needs markovTurns as a positive whole number, got ${markovTurns}`);
  const stretch = Math.floor((world.turn - 1) / markovTurns);
  return GOALS_PLAYED[Math.floor(hashRandom(world.seed ^ MARKOV_SALT, stretch) * GOALS_PLAYED.length)];
}

// ---- Calls and switches.

// Replies that differ from the first one of a topic. Every bot defends against a demand for its cargo. The hunter also
// refuses a truce and answers a plea for mercy with a demand to be stripped.
const DEFENDER_REPLIES: Partial<Record<TopicId, LineId>> = { demand: 'comeAndGetIt', surrender: 'comeAndGetIt' };
const HUNTER_REPLIES: Partial<Record<TopicId, LineId>> = { ...DEFENDER_REPLIES, truceOffer: 'noWeFinishThis', mercyPlea: 'standDownAndLet' };
const REFUSE_TOW: Partial<Record<TopicId, LineId>> = { tow: 'noThanks', towFree: 'noThanks' };
const YIELD_CARGO: LineId = 'fineTakeIt';

// Every open call gets the first reply of each topic, unless the bot's replies name another. Every bot hands its
// cargo to a demand from a foe that outmatches it. On the hub, the bot hangs up, which is the last option.
function answerCall(o: Orders, replies: Partial<Record<TopicId, LineId>> = DEFENDER_REPLIES): void {
  const seen = new Set<string>();
  for (let call = o.world.player.call; call; call = o.world.player.call) {
    const at = `${call.with}:${call.topic}:${call.node}`;
    if (seen.has(at)) throw new Error(`Bot call loops back to ${at}`);
    seen.add(at);
    const pick = call.topic ? Math.max(0, currentOptions(o.world).findIndex((option) => option.line === replyTo(o.world, call, replies))) : currentOptions(o.world).length - 1;
    o.run((w) => chooseOption(w, pick));
  }
}

function keepsOff(world: World, targetId: string): boolean {
  return warnedOffTarget(world, playerVehicle(world), targetId) !== null;
}

const OUTMATCHED_REPLIES: Partial<Record<TopicId, [LineId, LineId | undefined]>> = {
  demand: [YIELD_CARGO, undefined], surrender: [YIELD_CARGO, undefined], lootWarning: ['rollingOn', 'findYourOwn'],
};

function replyTo(world: World, call: Call, replies: Partial<Record<TopicId, LineId>>): LineId | undefined {
  if (!call.topic) return undefined;
  const pair = OUTMATCHED_REPLIES[call.topic];
  if (pair) return (outmatchedBy(world, vehicleById(world, call.with)) ? pair[0] : pair[1]) ?? replies[call.topic];
  return replies[call.topic];
}

function keepSwitches(o: Orders): void {
  if (!o.world.player.autoRepair) o.run((w) => setAutoRepair(w, true));
  setFire(o, underFire(o.world, o.me));
}

function underFire(world: World, me: Vehicle): boolean {
  return inCombat(world, me);
}

function setFire(o: Orders, on: boolean): void {
  if (o.world.player.autoFire !== on) o.run((w) => setAutoFire(w, on));
  if (!on) for (const id of Object.keys(o.me.weaponOrders)) o.run((w) => setWeaponOrder(w, id, null));
}

function holds(o: Orders): boolean {
  if (o.me.job) return true;
  if (coolsEngine(o)) {
    if (o.me.order) o.run((w) => setMoveOrder(w, null));
    return true;
  }
  const deal = patchDeal(o.world);
  if (!deal) return false;
  workPatch(o, deal);
  return true;
}

const HEAT_RESUME = ENGINE_HEAT.warnAt / 2;

function coolsEngine(o: Orders): boolean {
  if (inCombat(o.world, o.me) || seenHostiles(o.world).length > 0) return false;
  const heat = o.world.player.engineHeat;
  return heat >= ENGINE_HEAT.warnAt || (heat >= HEAT_RESUME && o.me.order === null);
}

function patchDeal(world: World): NpcState | null {
  const id = world.player.vehicleId;
  return world.states.find((s) => s.kind === 'patch' && (s.holder === id || s.other === id)) ?? null;
}

function workPatch(o: Orders, deal: NpcState): void {
  const client = vehicleById(o.world, deal.other);
  if (deal.holder === o.me.id && !inTowReach(o.me, client)) driveTo(o, besideStop(o.world, client.pos, chassisDef(client.chassisId).radius));
  else if (o.me.order) o.run((w) => setMoveOrder(w, null));
}

function serviceTrip(o: Orders, style: UpgradeStyle): boolean {
  const beacon = callsForTow(o);
  if (beacon !== o.world.player.beacon) o.run((w) => setBeacon(w, beacon));
  const shop = shopAt(o.world);
  if (shop) serviceInTown(o, style, shop);
  const target = serviceStop(o);
  if (!target || target.id === shop) return false;
  driveToSite(o, target);
  return true;
}

function callsForTow(o: Orders): boolean {
  return isStranded(o.world, o.me) && wantsTow(o.world) && !inCombat(o.world, o.me);
}

function wantsTow(world: World): boolean {
  return SHOP_SITES.some((s) => towFixes(world, s.id));
}

function takesTowOffer(world: World): boolean {
  const offer = playerTow(world);
  return offer === null || towFixes(world, towData(offer).site);
}

function towFixes(world: World, siteId: string): boolean {
  if (!(siteId in SHOPS) || shopAt(world) === siteId) return false;
  const budget = saleBudget(world);
  if (mountedParts(playerVehicle(world), 'engine').length === 0) return stockEngine(world, siteId, budget) !== null;
  return repairFits(world, siteId, budget);
}

function repairFits(world: World, siteId: string, budget: number): boolean {
  const me = playerVehicle(world);
  const broken = !hasWorkingEngine(me) || !isWorking(corePart(me, 'transmission'));
  if (!broken) return budget >= ECONOMY.supplyPrice.fuel;
  const fix = hasWorkingEngine(me) ? basicsRepairCost(world) : repairCost(world);
  return shopDef(siteId).kind === 'garage' && fix <= budget;
}

function serviceStop(o: Orders): Site | null {
  if (mountedParts(o.me, 'engine').length === 0) {
    const engineShop = nearestEngineShop(o.world);
    if (engineShop) return engineShop;
  }
  return !shopAt(o.world) && needsService(o) ? nearestShop(o.world) : null;
}

function serviceInTown(o: Orders, style: UpgradeStyle, shop: string): void {
  if (o.world.player.money < 0) {
    sellCargo(o);
    sellGearFor(o, shop, 0);
  }
  restoreEngine(o, shop);
  restoreBasics(o, shop);
  serviceHere(o);
  if (needsService(o)) throw new Error(`Town service left a need the bot can pay for, with ${o.world.player.money} money: ${needsOf(o.world)}`);
  stockRepairParts(o, shop);
  if (mountedParts(o.me, 'engine').length === 0) return;
  rearm(o);
  upgradeGear(o, style);
}

function needsOf(world: World): string {
  const p = world.player;
  const me = playerVehicle(world);
  return `shop ${shopAt(world)}, fuel ${p.fuel}/${fuelCap(me)} for way ${fuelForWayToShop(world).toFixed(1)}, supplies ${p.supplies}/${suppliesCap(me)}, repair ${repairCost(world)}, badly damaged ${mountedParts(me).filter(isBadlyDamaged).map((part) => part.defId).join(' ')}, combat ${inCombat(world, me)}, exposed ${underFire(world, me)}, engine ${mountedParts(me, 'engine').length}`;
}

function nearestEngineShop(world: World): Site | null {
  const pos = playerVehicle(world).pos;
  const stocked = SHOP_SITES.filter((s) => stockEngine(world, s.id, saleBudget(world)) !== null);
  return stocked.reduce<Site | null>((best, s) => (!best || dist(pos, s.pos) < dist(pos, best.pos) ? s : best), null);
}

function stockEngine(world: World, shopId: string, budget: number): { part: PartInstance; price: number } | null {
  const me = playerVehicle(world);
  const engines = shopState(world, shopId).stock.filter((p) => partDef(p.defId).kind === 'engine')
    .map((part) => ({ part, price: partTradePrice(world, me, part, 'buy') }))
    .filter((e) => e.price <= budget)
    .sort((a, b) => a.price - b.price);
  return engines[0] ?? null;
}

function saleBudget(world: World): number {
  return world.player.money + gearForSale(world).reduce((sum, g) => sum + g.price, 0);
}

type GearSale = { part: PartInstance; mountedItem: string | null; price: number };

function gearForSale(world: World): GearSale[] {
  const me = playerVehicle(world);
  const sale = (part: PartInstance, mountedItem: string | null) => ({ part, mountedItem, price: partTradePrice(world, me, part, 'sell') });
  const byPrice = (a: GearSale, b: GearSale) => a.price - b.price;
  const spares = spareItems(me).map((s) => sale(partOf(me, s.partId), null)).sort(byPrice);
  const stored = world.player.storage.map((part) => sale(part, null)).sort(byPrice);
  const mounted = mountedItems(me).filter((it) => !['core', 'engine'].includes(partDef(it.part.defId).kind) && removable(me, it)).map((it) => sale(it.part, it.id)).sort(byPrice);
  return [...spares, ...stored, ...mounted];
}

function removable(v: Vehicle, item: GridItem): boolean {
  return getLayoutError(v, v.items.filter((it) => it.id !== item.id)) === null;
}

function partOf(v: Vehicle, partId: string): PartInstance {
  const item = v.items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item || item.kind !== 'part') throw new Error(`Part ${partId} is not on ${v.id}`);
  return item.part;
}

function restoreEngine(o: Orders, shopId: string): void {
  if (mountedParts(o.me, 'engine').length > 0) return;
  const engine = stockEngine(o.world, shopId, saleBudget(o.world));
  if (!engine) return;
  if (o.world.player.money < engine.price || !engineSpot(o.me, engine.part.defId)) sellCargo(o);
  sellGearFor(o, shopId, engine.price);
  const spot = engineSpot(o.me, engine.part.defId);
  if (!spot) throw new Error(`No free engine mount for a new engine. On the engine cells: ${onEngineCells(o.me)}`);
  o.run((w) => buyStockPart(w, engine.part.id), 'gear');
  mountBought(o, engine.part.id, spot);
}

function restoreBasics(o: Orders, shopId: string): void {
  if (underFire(o.world, o.me) || !mountedParts(o.me, 'core').some(isBadlyDamaged)) return;
  const cost = basicsRepairCost(o.world);
  if (o.world.player.money < cost) sellCargo(o);
  if (saleBudget(o.world) >= cost) payRepair(o, shopId, cost, repairBasics);
  else if (isStranded(o.world, o.me)) restoreDrive(o, shopId);
}

function restoreDrive(o: Orders, shopId: string): void {
  const cost = driveRepairCost(o.world);
  if (saleBudget(o.world) >= cost) payRepair(o, shopId, cost, repairDrive);
}

function payRepair(o: Orders, shopId: string, cost: number, repair: (w: World) => World): void {
  sellGearFor(o, shopId, cost);
  o.run(repair, 'repairs');
}

function sellGearFor(o: Orders, shopId: string, price: number): void {
  while (o.world.player.money < price) {
    const g = gearForSale(o.world)[0];
    if (!g) return;
    const mounted = g.mountedItem;
    if (mounted) o.run((w) => storePart(w, mounted));
    o.run((w) => sellPart(w, g.part.id), 'gear');
  }
}

function onEngineCells(v: Vehicle): string {
  const g = gridOf(v);
  const onEngine = (it: GridItem) => itemCells(it).some((c) => MOUNT_CELLS.engine.includes(g.cells[c.y]?.[c.x] ?? '.'));
  const names = v.items.filter(onEngine).map((it) => (it.kind === 'part' ? `${it.part.defId} hp ${it.part.hp}${isMounted(v.chassisId, it) ? ' mounted' : ''}` : `good ${it.good}`));
  return names.length > 0 ? names.join(', ') : 'nothing';
}

function engineSpot(v: Vehicle, defId: string): Spot | null {
  const probe: GridItem = { id: 'engine-probe', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'engine-probe', defId, hp: 0, wear: 0 } };
  return findSpot(gridOf(v), v.items, probe, MOUNT_CELLS.engine, null);
}

const SHOP_SITES: readonly Site[] = Object.keys(SHOPS).map(siteOf);

function nearestShop(world: World): Site {
  const pos = playerVehicle(world).pos;
  return [...SHOP_SITES].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}

function fuelForWayToShop(world: World): number {
  return fuelForWay(world, dist(playerVehicle(world).pos, nearestShop(world).pos));
}

function fuelForWay(world: World, tiles: number): number {
  const me = playerVehicle(world);
  return tiles * vehicleStats(world, me).fuelPerTile * heatAt(world, me.pos) * NPC_UPKEEP.fuelReserve;
}

export function fuelReaches(world: World, site: Site, from?: { pos: Vec; fuel: number }): boolean {
  const full = fuelCap(playerVehicle(world));
  let at = from ?? { pos: playerVehicle(world).pos, fuel: world.player.fuel };
  for (let step = 0; step <= SHOP_SITES.length; step++) {
    if (fuelForWay(world, dist(at.pos, site.pos)) <= at.fuel) return true;
    const stops = SHOP_SITES.filter((s) => fuelForWay(world, dist(at.pos, s.pos)) <= at.fuel && dist(s.pos, site.pos) < dist(at.pos, site.pos));
    const next = stops.reduce<Site | null>((best, s) => (!best || dist(s.pos, site.pos) < dist(best.pos, site.pos) ? s : best), null);
    if (!next) return false;
    at = { pos: next.pos, fuel: full };
  }
  return false;
}

function reachable<T extends Site>(world: World, sites: readonly T[]): T[] {
  return sites.filter((s) => fuelReaches(world, s));
}

function needsService(o: Orders): boolean {
  const world = o.world;
  const p = world.player;
  const me = o.me;
  const lowFuel = p.fuel <= Math.max(fuelCap(me) * RULES.lowFuelThreshold, fuelForWayToShop(world)) && p.money >= ECONOMY.supplyPrice.fuel;
  const lowSupplies = p.supplies <= suppliesCap(me) * NPC_UPKEEP.lowSupplies && p.money >= ECONOMY.supplyPrice.supplies;
  return lowFuel || lowSupplies || needsRepair(o);
}

function needsRepair(o: Orders): boolean {
  return !underFire(o.world, o.me) && garageFixes(o).some(isBadlyDamaged);
}

function garageFixes(o: Orders): PartInstance[] {
  const fixable = (part: PartInstance) => !isJunk(part) || canRebuild(o.world, part);
  const share = (part: PartInstance) => part.hp / maxHp(part);
  return mountedParts(o.me).filter(fixable).filter((part) => affordsRepair(o, part)).sort((a, b) => share(a) - share(b));
}

function affordsRepair(o: Orders, part: PartInstance): boolean {
  const cost = partRepairCost(o.world, part);
  return cost > 0 && cost <= o.world.player.money;
}

function isBadlyDamaged(part: PartInstance): boolean {
  return part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition;
}

function serviceHere(o: Orders): void {
  for (const kind of ['fuel', 'supplies'] as const) {
    const n = Math.min(supplyRoom(o.world, kind), Math.floor(o.world.player.money / ECONOMY.supplyPrice[kind]));
    if (n > 0) o.run((w) => buySupply(w, kind, n), kind);
  }
  repairAtGarage(o);
}

function stockRepairParts(o: Orders, shop: string): void {
  if (!shopDef(shop).goods.includes('parts')) return;
  const want = Math.min(REPAIR_PARTS - (goodsCount(o.me).parts ?? 0), cargoRoom(o.me, 'parts'));
  if (want <= 0) return;
  const n = affordableBuyCount(o.world, o.me, shop, 'parts', want, o.world.player.money);
  if (n > 0) o.run((w) => buyGood(w, 'parts', n), 'repairs');
}

function repairAtGarage(o: Orders): void {
  if (underFire(o.world, o.me)) return;
  const basics = basicsRepairCost(o.world);
  if (basics > 0 && basics <= o.world.player.money) o.run(repairBasics, 'repairs');
  for (const part of garageFixes(o)) if (affordsRepair(o, part)) o.run((w) => repairPart(w, part.id), 'repairs');
}

const GOALS: Record<Goal, (o: Orders) => void> = { trader: traderGoal, scavenger: scavengerGoal, hunter: hunterGoal, fastTrader: traderGoal, hauler: haulerGoal, robber: (o) => robberGoal(o, false), convoyRobber: (o) => robberGoal(o, true) };

function traderGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!trade(o) && !takeHaul(o) && !scavenge(o, false)) checkNextBoard(o);
}

function haulerGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!takeHaul(o) && !trade(o) && !scavenge(o, false)) checkNextBoard(o);
}

type Haul = Extract<Contract, { kind: 'haul' }>;

function heldHaul(world: World): Haul | null {
  const goods = goodsCount(playerVehicle(world));
  return world.player.contracts.find((c): c is Haul => c.kind === 'haul' && (goods[c.good] ?? 0) >= c.units) ?? null;
}

function carryHaul(o: Orders, haul: Haul): void {
  if (shopAt(o.world) === haul.to) o.run((w) => deliverContract(w, haul.id), 'contracts');
  else driveToSite(o, siteOf(haul.to));
}

function takeHaul(o: Orders): boolean {
  const shop = shopAt(o.world);
  if (!shop || o.world.player.money < 0) return false;
  const here = siteOf(shop).pos;
  const pay = (c: Haul) => c.reward / estimateTurns(here, siteOf(c.to).pos);
  const offers = shopState(o.world, shop).contracts.filter((c): c is Haul => c.kind === 'haul' && c.deadline > o.world.turn && c.units <= freeCells(o.me) && fuelReaches(o.world, siteOf(c.to)));
  const best = offers.reduce<Haul | null>((top, c) => (!top || pay(c) > pay(top) ? c : top), null);
  if (best) o.run((w) => acceptContract(w, best.id));
  return best !== null;
}

function checkNextBoard(o: Orders): void {
  const here = shopAt(o.world);
  const others = reachable(o.world, SHOP_SITES.filter((s) => s.id !== here));
  const pos = o.me.pos;
  const next = others.reduce<Site | null>((best, s) => (!best || dist(pos, s.pos) < dist(pos, best.pos) ? s : best), null);
  if (next) driveToSite(o, next);
}

function scavengerGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!scavenge(o, false) && !trade(o) && !takeHaul(o)) checkNextBoard(o);
}

type Purchase = { town: TownDef; good: string; count: number; profit: number; perTurn: number };

function trade(o: Orders): boolean {
  const selling = sellCargoFirst(o);
  if (selling !== null) return selling;
  const buy = bestPurchase(o.world);
  if (buy) return buyThere(o, buy);
  const town = nearestUndiscovered(o.world, reachable(o.world, REGION.towns));
  if (!town) return false;
  driveToSite(o, town);
  return true;
}

function sellCargoFirst(o: Orders): boolean | null {
  if (!hasCargo(o.world, o.me)) return null;
  if (!marketFor(o.world)) return false;
  return sellAtMarket(o) ? null : true;
}

function buyThere(o: Orders, buy: Purchase): true {
  if (townAt(o.world)?.id !== buy.town.id) driveToSite(o, buy.town);
  else o.run((w) => buyGood(w, buy.good, buy.count), 'goodsBought');
  return true;
}

function marketFor(world: World): TownDef | null {
  return knownTowns(world).length > 0 ? bestMarket(world) : nearestUndiscovered(world, reachable(world, REGION.towns));
}

function sellAtMarket(o: Orders): boolean {
  const market = marketFor(o.world);
  if (!market) return false;
  if (townAt(o.world)?.id !== market.id) {
    driveToSite(o, market);
    return false;
  }
  sellCargo(o);
  return true;
}

function bestMarket(world: World): TownDef | null {
  const cargo = Object.entries(cargoForSale(world, playerVehicle(world)));
  const profit = (town: TownDef) => cargo.reduce((sum, [good, n]) => sum + n * (sellAt(world, town, good) - (world.player.costBasis[good] ?? 0)), 0);
  return byDistance(world, reachable(world, knownTowns(world))).reduce<TownDef | null>((best, town) => (!best || profit(town) > profit(best) ? town : best), null);
}

function bestPurchase(world: World): Purchase | null {
  const spend = world.player.money - getUpkeepReserve(playerVehicle(world)) - repairCost(world);
  const towns = knownTowns(world);
  const full = fuelCap(playerVehicle(world));
  const room = freeCells(playerVehicle(world));
  const options = reachable(world, towns).flatMap((source) => towns.filter((t) => t.id !== source.id && fuelReaches(world, t, { pos: source.pos, fuel: full })).flatMap((market) => GOOD_IDS.map((good) => purchase(world, { source, market, good, spend, room }))));
  return options.reduce<Purchase | null>((best, p) => (p.count > 0 && p.perTurn > (best?.perTurn ?? 0) ? p : best), null);
}

export function haulMarginAt(world: World, spend: number, room: number): number {
  const me = playerVehicle(world);
  const pairs = REGION.towns.flatMap((source) => REGION.towns.filter((t) => t.id !== source.id).map((market) => ({ source, market })));
  return Math.max(...pairs.flatMap(({ source, market }) => {
    const fuel = tripFuelCost(world, me, dist(source.pos, market.pos));
    return GOOD_IDS.map((good) => purchase(world, { source, market, good, spend, room }).profit - fuel);
  }));
}

function purchase(world: World, { source, market, good, spend, room }: { source: TownDef; market: TownDef; good: string; spend: number; room: number }): Purchase {
  const me = playerVehicle(world);
  const none = { town: source, good, count: 0, profit: 0, perTurn: 0 };
  if (sellAt(world, market, good) <= getTradePrice(world, me, source.id, good, 'buy')) return none;
  const lotProfit = (count: number) => (count === 0 ? 0 : getLotTradePrice(world, me, market.id, good, count, 'sell') - getLotTradePrice(world, me, source.id, good, count, 'buy'));
  let low = 0;
  let high = affordableBuyCount(world, me, source.id, good, room, spend);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lotProfit(mid) > lotProfit(mid - 1)) low = mid;
    else high = mid - 1;
  }
  if (low === 0 || lotProfit(low) <= 0) return none;
  const trip = estimateTurns(me.pos, source.pos) + estimateTurns(source.pos, market.pos);
  return { ...none, count: low, profit: lotProfit(low), perTurn: lotProfit(low) / trip };
}

function sellAt(world: World, town: TownDef, good: string): number {
  return getTradePrice(world, playerVehicle(world), town.id, good, 'sell');
}

function scavenge(o: Orders, stripping: boolean): boolean {
  if (sellInTown(o, stripping)) return true;
  lootHere(o);
  const stock = freeCells(o.me) > 0 ? nearestStock(o.world, knownStocks(o.world)) : null;
  if (stock) visitStock(o, stock);
  else if (cargoToTown(o, stripping)) driveToSite(o, nearestTown(o.world));
  else return findSalvageSite(o);
  return true;
}

function cargoToTown(o: Orders, stripping: boolean): boolean {
  return sellsCargo(o, stripping) && !townAt(o.world);
}

function findSalvageSite(o: Orders): boolean {
  const site = nearestUndiscovered(o.world, REGION.locations.filter((l) => l.kind === 'convoy' || l.kind === 'landmark'));
  if (!site) return false;
  driveToSite(o, site);
  return true;
}

function hunterGoal(o: Orders, tradeWhenIdle = false): void {
  if (firepower(o.world, o.me) === 0) return scavengerGoal(o);
  if (sellsFirst(o, tradeWhenIdle)) return;
  takeBounties(o);
  if (stripDowned(o) || engageFoe(o)) return;
  lootHere(o);
  earnAfterHunt(o, tradeWhenIdle);
}

function sellsFirst(o: Orders, tradeWhenIdle: boolean): boolean {
  return !tradeWhenIdle && sellInTown(o, true);
}

function earnAfterHunt(o: Orders, tradeWhenIdle: boolean): void {
  if (tradeWhenIdle) traderGoal(o);
  else scavengeOrHunt(o);
}

function scavengeOrHunt(o: Orders): void {
  if (huntedSpeed(o.world) === undefined && scavenge(o, true)) return;
  collectOrHunt(o);
}

function takeBounties(o: Orders): void {
  const shop = shopAt(o.world);
  if (!shop) return;
  claimBounties(o, shop);
  for (const c of shopState(o.world, shop).contracts) if (wantsBounty(o.world, c)) o.run((w) => acceptContract(w, c.id));
}

function claimBounties(o: Orders, shop: string): void {
  for (const c of o.world.player.contracts) if (c.kind === 'bounty' && c.fulfilled && c.shop === shop) o.run((w) => deliverContract(w, c.id), 'contracts');
}

function wantsBounty(world: World, c: Contract): boolean {
  const held = world.player.contracts;
  if (c.kind !== 'bounty' || c.deadline <= world.turn || held.length >= CONTRACTS.maxActive) return false;
  if (held.some((h) => h.kind === 'bounty' && h.template === c.template)) return false;
  return world.vehicles.some((v) => v.brain?.templateId === c.template && !isKnockedOut(v) && huntable(world, v));
}

function engageFoe(o: Orders): boolean {
  const seen = weakestFoe(o.world);
  if (seen) return engageSeen(o, seen);
  const heard = heardFoe(o.world, (v) => huntable(o.world, v));
  if (heard) driveTo(o, heard);
  return heard !== null;
}

const HUNT_MARGIN = 4;

function huntable(world: World, foe: Vehicle): boolean {
  const group = world.vehicles.filter((v) => v.id === foe.id || (v.faction === foe.faction && !isKnockedOut(v) && dist(v.pos, foe.pos) <= SPAWN.neighborHelp));
  const danger = strengthRatio(fightOdds(world, [playerVehicle(world)], group)) * (1 + NPC_BEHAVIOR.dangerSpread);
  return danger * HUNT_MARGIN <= 1;
}

function engageSeen(o: Orders, foe: Vehicle): boolean {
  if (dangerOf(o.world, foe) * HUNT_MARGIN > 1 || !isSoftTarget(o.world, foe)) return false;
  setFire(o, true);
  aimGuns(o, foe);
  if (!demandYield(o, foe)) driveTo(o, foe.pos);
  return true;
}

function nextLoot(me: Vehicle, target: Vehicle): { item: GridItem; spot: Spot } | null {
  const worth = (it: GridItem) => (it.kind === 'part' ? partValue(it.part) : 0);
  for (const item of [...target.items].sort((a, b) => worth(b) - worth(a))) {
    const spot = takeError(target, item) === null ? stowSpot(me, item) : null;
    if (spot) return { item, spot };
  }
  return null;
}

function canStripNow(o: Orders, target: Vehicle): boolean {
  return !inCombat(o.world, o.me) && !lootBlocker(o.world, o.me, target.id);
}

function stripDowned(o: Orders): boolean {
  const here = downedHere(o.world);
  const pick = here && canStripNow(o, here) ? nextLoot(o.me, here) : null;
  if (here && pick) {
    o.run((w) => takeFromTruck(w, here.id, pick.item.id, pick.spot));
    return true;
  }
  const seen = o.world.vehicles.filter((v) => v.id !== o.me.id && isKnockedOut(v) && playerSees(o.world, v.pos) && nextLoot(o.me, v) !== null);
  const target = nearestVehicle(o.me.pos, seen);
  if (target) driveTo(o, besideStop(o.world, target.pos, chassisDef(target.chassisId).radius));
  return target !== null;
}

function weakestFoe(world: World): Vehicle | null {
  const seen = seenHostiles(world);
  const danger = new Map(seen.map((v) => [v.id, dangerOf(world, v)]));
  return seen.reduce<Vehicle | null>((best, v) => (!best || (danger.get(v.id) ?? 0) < (danger.get(best.id) ?? 0) ? v : best), null);
}

function seenHostiles(world: World): Vehicle[] {
  const me = playerVehicle(world);
  return world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v) && !isKnockedOut(v) && playerSees(world, v.pos));
}

function dangerOf(world: World, foe: Vehicle): number {
  const spread = NPC_BEHAVIOR.dangerSpread;
  const roll = hashRandom(world.seed ^ JUDGE_SALT, ...[...foe.id].map((c) => c.charCodeAt(0)));
  return judgeDanger(world, playerVehicle(world), foe) * (1 - spread + 2 * spread * roll);
}

const JUDGE_SALT = 0x6a756467;

function defend(o: Orders, goal: Goal): boolean {
  if (!inCombat(o.world, o.me)) return avoid(o, goal);
  const foe = weakestFoe(o.world);
  if (!foe) {
    if (!(goal === 'hunter' && engageFoe(o))) flee(o);
    return true;
  }
  if (fights(o, foe, goal)) charge(o, foe, goal);
  else flee(o);
  return true;
}

function avoid(o: Orders, goal: Goal): boolean {
  if (shopAt(o.world) || o.me.job || isStranded(o.world, o.me) || !runsFrom(o, goal)) return false;
  flee(o);
  return true;
}

function runsFrom(o: Orders, goal: Goal): boolean {
  const foe = weakestFoe(o.world);
  if (foe) return !beats(o, foe, goal);
  return heardHostiles(o.world).some((v) => !beats(o, v, goal));
}

function heardHostiles(world: World): Vehicle[] {
  const heard = new Set(world.player.contacts.map((c) => c.vehicleId));
  return world.vehicles.filter((v) => heard.has(v.id) && hostileToPlayer(world, v) && !isKnockedOut(v));
}

function flee(o: Orders): void {
  const seen = seenHostiles(o.world).map((v) => v.pos);
  if (keepsCourse(o.me, seen)) return;
  const threats = seen.length > 0 ? seen : heardThreat(o.world);
  if (threats.length === 0) return driveToSite(o, nearestTown(o.world));
  const safe = REGION.towns.filter((town) => threats.every((foe) => pointsAway(o.me.pos, town.pos, foe))).sort((a, b) => dist(o.me.pos, a.pos) - dist(o.me.pos, b.pos));
  if (safe[0]) return driveToSite(o, safe[0]);
  driveTo(o, awayFrom(o.me.pos, threats, o.world.size));
}

function keepsCourse(me: Vehicle, seen: Vec[]): boolean {
  const order = me.order;
  return order !== null && order.kind !== 'brake' && !seen.some((foe) => closesOn(me.pos, order.dest, foe));
}

function heardThreat(world: World): Vec[] {
  const heard = heardFoe(world);
  return heard ? [heard] : [];
}

function closesOn(from: Vec, to: Vec, foe: Vec): boolean {
  return (to.x - from.x) * (foe.x - from.x) + (to.y - from.y) * (foe.y - from.y) > 0;
}

function awayFrom(pos: Vec, threats: Vec[], size: number): Vec {
  const unit = (foe: Vec) => ({ x: (pos.x - foe.x) / Math.max(dist(pos, foe), 1e-6), y: (pos.y - foe.y) / Math.max(dist(pos, foe), 1e-6) });
  const sum = threats.map(unit).reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }));
  const near = nearest(pos, threats)!;
  const len = Math.hypot(sum.x, sum.y);
  const way = len > 1e-6 ? { x: sum.x / len, y: sum.y / len } : { x: -unit(near).y, y: unit(near).x };
  return edgeAlong(pos, way, size);
}

function edgeAlong(pos: Vec, way: Vec, size: number): Vec {
  const reach = (p: number, d: number) => (d > 1e-6 ? (size - 1 - p) / d : d < -1e-6 ? (1 - p) / d : Infinity);
  const t = Math.max(0, Math.min(reach(pos.x, way.x), reach(pos.y, way.y)));
  return { x: pos.x + way.x * t, y: pos.y + way.y * t };
}

function charge(o: Orders, foe: Vehicle, goal: Goal): void {
  if (goal === 'hunter') aimGuns(o, foe);
  driveTo(o, foe.pos);
}

function fights(o: Orders, foe: Vehicle, goal: Goal): boolean {
  return beats(o, foe, goal) && (goal === 'hunter' || !outruns(o.world, o.me, foe));
}

function beats(o: Orders, foe: Vehicle, goal: Goal): boolean {
  const margin = goal === 'hunter' ? HUNT_MARGIN : 1;
  return dangerOf(o.world, foe) * margin <= 1;
}

function outmatchedBy(world: World, foe: Vehicle): boolean {
  return dangerOf(world, foe) > 1 && !outruns(world, playerVehicle(world), foe);
}

function outruns(world: World, me: Vehicle, foe: Vehicle): boolean {
  return currentTopSpeed(world, me) > currentTopSpeed(world, foe);
}

function currentTopSpeed(world: World, v: Vehicle): number {
  const stats = vehicleStats(world, v);
  return isStranded(world, v) ? Math.min(stats.maxSpeed, stats.limpSpeed) : stats.maxSpeed;
}

function demandYield(o: Orders, foe: Vehicle): boolean {
  const asks = foe.brain !== null && isHostile(o.world, foe, o.me) && isWeak(o.world, foe) && !offeredSurrenderBy(o.world, foe, o.me);
  if (!asks) return false;
  o.run((w) => callVehicle(w, foe.id));
  const ask = currentOptions(o.world).findIndex((option) => option.line === TOPICS.yieldDemand.ask?.say);
  if (ask >= 0) o.run((w) => chooseOption(w, ask));
  answerCall(o, HUNTER_REPLIES);
  return true;
}

function heardFoe(world: World, wanted: (v: Vehicle) => boolean = () => true): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v) && wanted(v));
  return nearest(me.pos, world.player.contacts.filter((c) => hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center));
}

function nearestVehicle(from: Vec, vehicles: readonly Vehicle[]): Vehicle | null {
  return vehicles.reduce<Vehicle | null>((best, v) => (!best || dist(from, v.pos) < dist(from, best.pos) ? v : best), null);
}

function collectOrHunt(o: Orders): void {
  if (freeCells(o.me) === 0) {
    if (townAt(o.world) || !sellsCargo(o, true)) return hunt(o);
    return driveToSite(o, nearestTown(o.world));
  }
  const wreck = nearestStock(o.world, knownStocks(o.world).filter((s) => s.id.startsWith('wreck-') && playerSees(o.world, s.pos)));
  if (wreck) return visitStock(o, wreck);
  hunt(o);
}

type Post = { pos: Vec; shop: Site | null };

const CAMP_STANDOFF = 18;

function campPosts(): { post: Post; near: Site }[] {
  return REGION.locations.filter((l) => l.kind === 'camp').flatMap((camp) => siteGates(camp).map((gate) => {
    const near = SHOP_SITES.reduce((best, s) => (dist(gate, s.pos) < dist(gate, best.pos) ? s : best));
    const gap = dist(gate, near.pos);
    const at = { x: gate.x + ((near.pos.x - gate.x) / gap) * CAMP_STANDOFF, y: gate.y + ((near.pos.y - gate.y) / gap) * CAMP_STANDOFF };
    return { post: { pos: at, shop: null }, near };
  }));
}

const PATROL: readonly Post[] = SHOP_SITES.flatMap((s) => [{ pos: s.pos, shop: s }, ...campPosts().filter((c) => c.near === s).map((c) => c.post)]);

function postDests(post: Post): Vec[] {
  return post.shop ? sitePads(post.shop) : [post.pos];
}

function hunt(o: Orders): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && PATROL.some((p) => postDests(p).some((d) => d.x === order.dest.x && d.y === order.dest.y))) return;
  const next = nextPost(o.me);
  driveTo(o, next.shop ? nearestPad(next.shop, o.me.pos) : next.pos);
}

function nextPost(me: Vehicle): Post {
  return (atPost(me.pos) ? null : postAhead(me)) ?? postAfterNearest(me.pos);
}

function atPost(pos: Vec): boolean {
  return PATROL.some((p) => (p.shop ? canUseSite(pos, p.shop) : dist(pos, p.pos) <= RULES.arriveRadius));
}

function postAhead(me: Vehicle): Post | null {
  const ahead = PATROL.filter((p) => (p.pos.x - me.pos.x) * Math.cos(me.heading) + (p.pos.y - me.pos.y) * Math.sin(me.heading) > 0);
  return ahead.reduce<Post | null>((best, p) => (!best || dist(me.pos, p.pos) < dist(me.pos, best.pos) ? p : best), null);
}

function postAfterNearest(pos: Vec): Post {
  const here = PATROL.reduce((best, p, i) => (dist(pos, p.pos) < dist(pos, PATROL[best].pos) ? i : best), 0);
  return PATROL[(here + 1) % PATROL.length];
}

const CAMP_WATCH = TERRAIN.vision.radius;
const CAMP_GATES: readonly Vec[] = REGION.locations.filter((l) => l.kind === 'camp').flatMap((camp) => siteGates(camp));

function knownStocks(world: World): SalvageStock[] {
  return world.salvage.filter((stock) => {
    if (!hasSalvage(stock) || !needsSearch(world, stock) || keepsOff(world, stock.id)) return false;
    if (CAMP_GATES.some((gate) => dist(gate, stock.pos) <= CAMP_WATCH)) return false;
    const site = REGION.locations.find((l) => l.id === stock.id);
    return site ? world.player.discovered.includes(site.id) : playerExplored(world, stock.pos);
  });
}

function nearestStock(world: World, stocks: SalvageStock[]): SalvageStock | null {
  const pos = playerVehicle(world).pos;
  return stocks.reduce<SalvageStock | null>((best, s) => (!best || dist(pos, s.pos) < dist(pos, best.pos) ? s : best), null);
}

function lootHere(o: Orders): void {
  const stock = salvageHere(o.world);
  if (!stock || !canLoot(o.world, stock.id) || freeCells(o.me) === 0) return;
  if (lootBlocker(o.world, o.me, stock.id) || keepsOff(o.world, stock.id)) return;
  o.loot(stock.id, (w) => takeAllLoot(w, stock.id));
}

function visitStock(o: Orders, stock: SalvageStock): void {
  if (canReachSalvage(o.me, stock)) {
    if (!inCombat(o.world, o.me) && !lootBlocker(o.world, o.me, stock.id)) o.run((w) => startSearch(w, stock.id));
    return;
  }
  const site = REGION.locations.find((l) => l.id === stock.id);
  driveTo(o, site ? nearestPad(site, o.me.pos) : besideStop(o.world, stock.pos, stock.radius));
}

// ---- Robbery.

// The goal lines under a seen driver that say it carries cargo or goes to load it. They are the reasons
// src/sim/npc-activities.ts gives the trade, sell and haul goals.
export const CARGO_REASONS: readonly GoalReason[] = ['deliverCargo', 'sellCargo', 'buyCargo', 'loadCargo'];
// The factions a robber demands cargo from.
const ROB_FACTIONS: readonly Faction[] = ['traders', 'convoys'];
function robPatrol(guarded: boolean): readonly string[] {
  return guarded ? [...TRAITS.supplier.haulSites, ...TRAITS.supplier.towns] : ['bowl', 'nose'];
}

function robberGoal(o: Orders, guarded: boolean): void {
  if (freeCells(o.me) === 0 && hasCargo(o.world, o.me)) {
    sellAtMarket(o);
    return;
  }
  sellInTown(o, false);
  lootHere(o);
  const foe = engagedFoe(o.world);
  if (foe) return driveTo(o, foe);
  demandInSight(o, guarded);
  if (freeCells(o.me) > 0) collectOrPatrol(o, guarded);
}

function demandInSight(o: Orders, guarded: boolean): void {
  const target = inCombat(o.world, o.me) ? null : robTarget(o.world, guarded);
  if (target) demand(o, target);
  if (o.world.player.call) throw new Error(`The robber left a call with ${o.world.player.call.with} open`);
}

function collectOrPatrol(o: Orders, guarded: boolean): void {
  const downed = downedTarget(o.world);
  if (downed) return takeFromTarget(o, downed);
  const stock = nearestStock(o.world, knownStocks(o.world).filter((s) => !isSiteStock(s) && playerSees(o.world, s.pos)));
  if (stock) return visitStock(o, stock);
  patrol(o, robPatrol(guarded));
}

function engagedFoe(world: World): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && !isDefeated(v) && hostileToPlayer(world, v));
  const seen = hostile.filter((v) => playerSees(world, v.pos)).map((v) => v.pos);
  const fighting = new Set(world.states.filter((s) => s.kind === 'combat' && (s.holder === me.id || s.other === me.id)).map((s) => (s.holder === me.id ? s.other : s.holder)));
  const heard = world.player.contacts.filter((c) => fighting.has(c.vehicleId) && hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center);
  return nearest(me.pos, seen) ?? nearest(me.pos, heard);
}

export function robTarget(world: World, guarded: boolean): Vehicle | null {
  const me = playerVehicle(world);
  const targets = world.vehicles.filter((v) => isRobberyPrey(world, v) && (guarded || !guardedInSight(world, v)));
  return targets.reduce<Vehicle | null>((best, v) => (!best || dist(me.pos, v.pos) < dist(me.pos, best.pos) ? v : best), null);
}

function isRobberyPrey(world: World, v: Vehicle): boolean {
  return inRadioSight(world, v) && wouldRob(world, v);
}

export function wouldRob(world: World, v: Vehicle): boolean {
  if (!isAwakeDriverOf(world, v, ROB_FACTIONS) || hostileToPlayer(world, v) || world.player.talked[v.id]?.rob !== undefined) return false;
  return saysCarriesCargo(v) && mountedParts(v, 'weapon').length <= mountedParts(playerVehicle(world), 'weapon').length;
}

function isAwakeDriverOf(world: World, v: Vehicle, factions: readonly Faction[]): boolean {
  return v.id !== world.player.vehicleId && v.brain !== null && !isDefeated(v) && factions.includes(v.faction);
}

function inRadioSight(world: World, v: Vehicle): boolean {
  return playerSees(world, v.pos) && canVehicleSee(world, playerVehicle(world), v.pos);
}

function saysCarriesCargo(v: Vehicle): boolean {
  const reason = topGoal(v)?.reason;
  return reason !== undefined && CARGO_REASONS.includes(reason);
}

function guardedInSight(world: World, v: Vehicle): boolean {
  return escortsOf(world, v.id).some((e) => !isDefeated(e) && playerSees(world, e.pos));
}

function demand(o: Orders, target: Vehicle): void {
  o.run((w) => callVehicle(w, target.id));
  const rob = currentOptions(o.world).findIndex((opt) => opt.topic === 'rob' && opt.option === null);
  if (rob < 0) {
    o.run(hangUp);
    return;
  }
  o.run((w) => chooseOption(w, rob));
  const replies = currentOptions(o.world).filter((opt) => opt.option !== null);
  if (replies.length !== 1) throw new Error(`A demand on ${target.id} offers ${replies.length} replies, not one`);
  o.run((w) => chooseOption(w, 0));
  const call = o.world.player.call;
  if (call?.topic !== 'rob') throw new Error(`A demand on ${target.id} left the rob topic`);
  const answer = threatAnswerOf(call.node);
  o.notes.push({ kind: 'demand', target: target.id, answer, guarded: guardedInSight(o.world, target) });
  answerCall(o);
}

function threatAnswerOf(node: string): ThreatAnswer {
  if (node === 'comply' || node === 'fightBack' || node === 'flee') return node;
  throw new Error(`Unknown rob call node ${node}`);
}

function downedTarget(world: World): Vehicle | null {
  const me = playerVehicle(world);
  const downed = world.vehicles.filter((v) => ROB_FACTIONS.includes(v.faction) && isKnockedOut(v) && playerSees(world, v.pos) && hasLooseItems(v) && !lootBlocker(world, me, v.id) && !keepsOff(world, v.id));
  return downed.reduce<Vehicle | null>((best, v) => (!best || dist(me.pos, v.pos) < dist(me.pos, best.pos) ? v : best), null);
}

function hasLooseItems(v: Vehicle): boolean {
  return v.items.some((it) => !isMounted(v.chassisId, it));
}

function takeFromTarget(o: Orders, target: Vehicle): void {
  if (!canLootTruck(o.me, target)) return driveTo(o, besideStop(o.world, target.pos, chassisDef(target.chassisId).radius));
  for (const item of target.items.filter((it) => !isMounted(target.chassisId, it))) {
    const spot = looseSpot(o.me, item);
    if (spot) o.loot(target.id, (w) => takeFromTruck(w, target.id, item.id, spot));
  }
}

function looseSpot(me: Vehicle, item: GridItem): Spot | null {
  if (itemMass(item) > cargoMassRoom(me)) return null;
  const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
  return findSpot(gridOf(me), me.items, { ...item, id: 'loot-probe' }, null, avoid);
}

function patrol(o: Orders, ids: readonly string[]): void {
  const sites = ids.map(getKnownSite);
  const order = o.me.order;
  if (order?.kind === 'stopAt' && sites.some((t) => canUseSite(order.dest, t))) return;
  const at = sites.findIndex((t) => canUseSite(o.me.pos, t));
  driveToSite(o, at >= 0 ? sites[(at + 1) % sites.length] : byDistance(o.world, sites)[0]);
}

export const CONVOY_ROB_PATROL: readonly string[] = robPatrol(true);

function cargoForSale(world: World, v: Vehicle): Record<string, number> {
  const goods = { ...goodsCount(v) };
  for (const c of world.player.contracts) if (c.kind === 'haul') goods[c.good] = (goods[c.good] ?? 0) - c.units;
  const parts = Math.max(0, (goods.parts ?? 0) - NPC_UPKEEP.repairParts);
  const forSale = { ...goods, parts };
  return Object.fromEntries(Object.entries(forSale).filter(([, n]) => n > 0));
}

function spareItems(v: Vehicle): { itemId: string; partId: string }[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [{ itemId: it.id, partId: it.part.id }] : []));
}

function hasCargo(world: World, v: Vehicle): boolean {
  return Object.keys(cargoForSale(world, v)).length > 0 || spareItems(v).length > 0;
}

function sellCargo(o: Orders, stripping = false): void {
  for (const [good, n] of goodsToSell(o, stripping)) o.run((w) => sellGood(w, good, n), 'goodsSold');
  sellSpares(o, stripping && o.fieldRepair);
}

function sellInTown(o: Orders, stripping: boolean): boolean {
  if (townAt(o.world) && sellsCargo(o, stripping)) sellCargo(o, stripping);
  return o.me.job !== null;
}

function goodsToSell(o: Orders, stripping: boolean): [string, number][] {
  const keep = stripping && o.fieldRepair;
  return Object.entries(cargoForSale(o.world, o.me)).filter(([good]) => !keep || good !== 'parts');
}

function sellsCargo(o: Orders, stripping: boolean): boolean {
  return goodsToSell(o, stripping).length > 0 || spareItems(o.me).length > 0;
}

function sellSpares(o: Orders, keep: boolean): void {
  for (const { partId } of spareItems(o.me)) if (!(keep && stripForRepair(o, partId))) o.run((w) => sellPart(w, partId), 'lootSales');
}

function stripForRepair(o: Orders, partId: string): boolean {
  if (o.me.job) return true;
  if (!canStrip(o, partId)) return false;
  o.run((w) => startStrip(w, partId));
  return true;
}

function canStrip(o: Orders, partId: string): boolean {
  const item = o.me.items.find((it) => it.kind === 'part' && it.part.id === partId);
  return item?.kind === 'part' && !inCombat(o.world, o.me) && freeCells(o.me) >= stripYield(o.me, item.part);
}

function knownTowns(world: World): TownDef[] {
  return REGION.towns.filter((t) => world.player.discovered.includes(t.id));
}

function byDistance<T extends Site>(world: World, sites: T[]): T[] {
  const pos = playerVehicle(world).pos;
  return [...sites].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos));
}

function nearest(from: Vec, points: readonly Vec[]): Vec | null {
  return points.reduce<Vec | null>((best, p) => (!best || dist(from, p) < dist(from, best) ? p : best), null);
}

function nearestUndiscovered<T extends Site>(world: World, sites: readonly T[]): T | null {
  return byDistance(world, sites.filter((s) => !world.player.discovered.includes(s.id)))[0] ?? null;
}

function driveToSite(o: Orders, site: Site): void {
  if (canUseSite(o.me.pos, site)) return;
  driveTo(o, nearestPad(site, o.me.pos));
}

function besideStop(world: World, center: Vec, radius: number): Vec {
  const me = playerVehicle(world);
  const out = radius + vehicleStats(world, me).radius + RULES.arriveRadius;
  const angle = Math.atan2(me.pos.y - center.y, me.pos.x - center.x);
  return { x: center.x + Math.cos(angle) * out, y: center.y + Math.sin(angle) * out };
}

function driveTo(o: Orders, dest: Vec): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && order.dest.x === dest.x && order.dest.y === dest.y) return;
  o.run((w) => setMoveOrder(w, { kind: 'stopAt', dest }));
}
