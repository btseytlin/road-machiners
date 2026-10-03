// A scripted player for the progression recorder. Each turn it picks the player's commands for one archetype and
// applies them through the public command functions, like the UI would. It keeps no state of its own: every choice
// follows from the world, so the same world always gets the same commands. The bot is a policy, not the NPC brain.
// It reuses the NPC upkeep thresholds, so it services when an NPC driver would.

import { chassisDef } from '../../data/chassis';
import { ECONOMY, GOOD_IDS } from '../../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP } from '../../data/npcs';
import { PARTS, partDef } from '../../data/parts';
import { REGION, type TownDef } from '../../data/region';
import { RULES } from '../../data/rules';
import { CONDITION, ENGINE_HEAT } from '../../data/wear';
import { maxHp } from '../wear';
import { inCombat } from '../combat';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder } from '../world';
import { playerVehicle, vehicleById } from '../damage';
import { isDefeated, isKnockedOut } from '../defeat';
import { callVehicle, chooseOption, currentOptions, hangUp } from '../dialogue';
import { affordableBuyCount, buyGood, buyStockPart, buySupply, partTradePrice, getTradePrice, repairAll, repairCost, sellGood, sellPart, supplyRoom } from '../economy';
import { findSpot, freeCells, goodsCount, gridOf, isMounted, MOUNT_CELLS, mountedParts, type Spot } from '../grid';
import { cargoMassRoom, moveItem, storePart, takeFromStorage } from '../inventory';
import { itemMass } from '../mass';
import { shopAt, shopState } from '../market';
import { canLoot, salvageHere, takeAllLoot } from '../locations';
import { topGoal } from '../npc-activities';
import { getUpkeepReserve, raiderGrounds } from '../npc-decisions';
import type { ThreatAnswer } from '../parley';
import { canLootTruck, canReachSalvage, hasSalvage, isSiteStock, lootBlocker, takeFromTruck } from '../salvage';
import { startSearch } from '../search';
import { canUseSite, nearestPad, nearestTown, townAt, type Site } from '../sites';
import { fuelCap, isStranded, suppliesCap, vehicleStats } from '../stats';
import { clockOf } from '../sun';
import { escortsOf, inTowReach, setBeacon } from '../tow';
import type { Faction, GameEvent, GridItem, NpcState, PartInstance, SalvageStock, Vehicle, World } from '../types';
import { dist, type Vec } from '../vec';
import { canVehicleSee, playerExplored, playerSees } from '../vision';

export type Archetype = 'trader' | 'scavenger' | 'fighter' | 'mixed';
export const ARCHETYPES: readonly Archetype[] = ['trader', 'scavenger', 'fighter', 'mixed'];
// A policy is an archetype of the progression recorder or a robber of the income harness. The selective robber skips
// guarded targets, and the convoy robber demands from guarded convoys too.
export type Policy = Archetype | 'robber' | 'convoyRobber';
export const POLICIES: readonly Policy[] = [...ARCHETYPES, 'robber', 'convoyRobber'];
type Goal = Exclude<Policy, 'mixed'>;
// The mixed bot plays one goal per in-game day, in this order.
const MIXED_ROTATION: readonly Goal[] = ['trader', 'scavenger', 'fighter'];
// What the bot did that the events do not say: a demand and the driver's answer, and goods and spares it looted.
export type BotNote =
  | { kind: 'demand'; target: string; answer: ThreatAnswer; guarded: boolean }
  | { kind: 'took'; from: string; goods: Record<string, number>; parts: PartInstance[] };
// The money one command moved, named by what the command was.
export type MoneyEntry = { reason: string; amount: number };
// The world after the bot's commands, every event those commands raised, the bot's notes and the money each command
// moved.
export type BotTurn = { world: World; events: GameEvent[]; notes: BotNote[]; money: MoneyEntry[] };

// Applies commands one after another and keeps the events of each. A command that moves money must name why.
class Orders {
  readonly events: GameEvent[] = [];
  readonly notes: BotNote[] = [];
  readonly money: MoneyEntry[] = [];
  constructor(public world: World) {}

  run(command: (w: World) => World, reason: string | null = null): void {
    const before = this.world.player.money;
    this.world = command(this.world);
    this.events.push(...this.world.events);
    const amount = this.world.player.money - before;
    if (amount === 0) return;
    if (reason === null) throw new Error(`A bot command moved ${amount} money without a reason`);
    this.money.push({ reason, amount });
  }

  // Runs a loot command and notes the goods and spares it brought in from `from`.
  loot(from: string, command: (w: World) => World): void {
    const goods = goodsCount(this.me);
    const spares = new Set(spareItems(this.me).map((s) => s.partId));
    this.run(command);
    const gained = Object.entries(goodsCount(this.me)).flatMap(([good, n]) => (n > (goods[good] ?? 0) ? [[good, n - (goods[good] ?? 0)] as const] : []));
    const parts = this.me.items.flatMap((it) => (it.kind === 'part' && !isMounted(this.me.chassisId, it) && !spares.has(it.part.id) ? [structuredClone(it.part)] : []));
    if (gained.length > 0 || parts.length > 0) this.notes.push({ kind: 'took', from, goods: Object.fromEntries(gained), parts });
  }

  get me(): Vehicle {
    return playerVehicle(this.world);
  }
}

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

export function isPolicy(value: string): value is Policy {
  return (POLICIES as readonly string[]).includes(value);
}

// The player's commands for this turn. A knocked-out or towed player gets none, and turns still run.
export function botOrders(world: World, policy: Policy): BotTurn {
  const o = new Orders(world);
  answerCall(o);
  if (playerCanAct(o.world)) {
    const goal = goalOf(o.world, policy);
    keepSwitches(o);
    if (!holds(o) && !serviceTrip(o)) GOALS[goal](o);
  }
  return { world: o.world, events: o.events, notes: o.notes, money: o.money };
}

// Whether the truck stands still for a reason: a job or a patch deal under way, a stop at a town, or a knockout.
// The recorder does not count these turns as a stall.
export function parkedOnPurpose(world: World): boolean {
  if (world.player.state === 'knockedOut') return true;
  return playerVehicle(world).job !== null || patchDeal(world) !== null || townAt(world) !== null;
}

function goalOf(world: World, policy: Policy): Goal {
  if (policy !== 'mixed') return policy;
  return MIXED_ROTATION[(clockOf(world.turn).day - 1) % MIXED_ROTATION.length];
}

// ---- Calls and switches.

// Every open call gets the first reply of each topic. On the hub, the bot hangs up, which is the last option.
function answerCall(o: Orders): void {
  const seen = new Set<string>();
  for (let call = o.world.player.call; call; call = o.world.player.call) {
    const at = `${call.with}:${call.topic}:${call.node}`;
    if (seen.has(at)) throw new Error(`Bot call loops back to ${at}`);
    seen.add(at);
    const pick = call.topic ? 0 : currentOptions(o.world).length - 1;
    o.run((w) => chooseOption(w, pick), `call ${call.topic ?? 'hub'}`);
  }
}

// Auto patch and auto fire stay on for every bot, so every bot shoots back at hostiles like a player would. Only
// the fighter drives at them.
function keepSwitches(o: Orders): void {
  if (!o.world.player.autoRepair) o.run((w) => setAutoRepair(w, true));
  if (!o.world.player.autoFire) o.run((w) => setAutoFire(w, true));
}

// ---- Holding still: jobs, a hot engine and patch deals.

// True when the truck must not drive this turn, after any command the hold needs.
function holds(o: Orders): boolean {
  if (o.me.job) return true;
  // A hot engine cools while parked. The bot stops at the warning, as the warning tells the player to.
  if (o.world.player.engineHeat >= ENGINE_HEAT.warnAt) {
    if (o.me.order) o.run((w) => setMoveOrder(w, null));
    return true;
  }
  const deal = patchDeal(o.world);
  if (!deal) return false;
  workPatch(o, deal);
  return true;
}

function patchDeal(world: World): NpcState | null {
  const id = world.player.vehicleId;
  return world.states.find((s) => s.kind === 'patch' && (s.holder === id || s.other === id)) ?? null;
}

// The patcher drives up to its stranded client. Then both stay parked while the work runs.
function workPatch(o: Orders, deal: NpcState): void {
  const client = vehicleById(o.world, deal.other);
  if (deal.holder === o.me.id && !inTowReach(o.me, client)) driveTo(o, besideStop(o.world, client.pos, chassisDef(client.chassisId).radius));
  else if (o.me.order) o.run((w) => setMoveOrder(w, null));
}

// ---- Service.

// In town the bot tops up, repairs and buys an engine if a knockout stripped its own. Out of town with low fuel, low
// supplies, a badly damaged part or no engine, and the money to fix it, it drives to the nearest town. A need it
// cannot pay for does not send it to town, so a poor bot drives on to earn, crawling if it must. A stranded truck
// also turns its beacon on and takes the first tow offered on the radio. Returns true when the trip to town is this
// turn's order.
function serviceTrip(o: Orders): boolean {
  if (isStranded(o.world, o.me) && !o.world.player.beacon) o.run((w) => setBeacon(w, true));
  if (townAt(o.world)) {
    serviceInTown(o);
    return false;
  }
  if (!paidFixNeeded(o.world)) return false;
  driveToSite(o, nearestTown(o.world));
  return true;
}

function serviceInTown(o: Orders): void {
  serviceHere(o);
  restoreEngine(o);
  if (paidFixNeeded(o.world)) throw new Error(`Town service left a need the bot can pay for, with ${o.world.player.money} money`);
}

function paidFixNeeded(world: World): boolean {
  return needsService(world) || canRestoreEngine(world);
}

// In a shop, an engine it stocks must be affordable. Out of town, the bot knows no stock, so the money must cover
// the cheapest engine's price at its most worn.
function canRestoreEngine(world: World): boolean {
  if (mountedParts(playerVehicle(world), 'engine').length > 0) return false;
  return shopAt(world) ? stockEngine(world) !== null : world.player.money >= cheapestEngineValue();
}

function cheapestEngineValue(): number {
  return Math.min(...Object.values(PARTS).filter((d) => d.kind === 'engine').map((d) => d.value * CONDITION.valueFactor[CONDITION.maxWear]));
}

// The cheapest engine the parked garage stocks that the bot can afford.
function stockEngine(world: World): PartInstance | null {
  const shopId = shopAt(world);
  if (!shopId) return null;
  const me = playerVehicle(world);
  const engines = shopState(world, shopId).stock.filter((p) => partDef(p.defId).kind === 'engine')
    .map((part) => ({ part, price: partTradePrice(world, me, part, 'buy') }))
    .filter((e) => e.price <= world.player.money)
    .sort((a, b) => a.price - b.price);
  return engines[0]?.part ?? null;
}

// Buys and mounts the start kit's engine when the truck has none and the money covers it. Cargo on the engine mount
// is sold to make room.
function restoreEngine(o: Orders): void {
  const engine = canRestoreEngine(o.world) ? stockEngine(o.world) : null;
  if (!engine) return;
  if (!engineSpot(o.me, engine.defId) && hasCargo(o.me)) sellCargo(o);
  const spot = engineSpot(o.me, engine.defId);
  if (!spot) throw new Error('No free engine mount for a new engine');
  o.run((w) => buyStockPart(w, engine.id), 'buy engine');
  mountBought(o, engine.id, spot);
}

// A bought part lands in garage storage or loose in the grid; either way it moves onto the spot.
function mountBought(o: Orders, partId: string, spot: Spot): void {
  if (o.world.player.storage.some((p) => p.id === partId)) o.run((w) => takeFromStorage(w, partId, spot));
  else o.run((w) => moveItem(w, itemOf(w, partId), spot));
}

function itemOf(world: World, partId: string): string {
  const item = playerVehicle(world).items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item) throw new Error(`Bought part ${partId} is not on the truck`);
  return item.id;
}

function engineSpot(v: Vehicle, defId: string): Spot | null {
  const probe: GridItem = { id: 'engine-probe', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'engine-probe', defId, hp: 0, wear: 0 } };
  return findSpot(gridOf(v), v.items, probe, MOUNT_CELLS.engine, null);
}

function needsService(world: World): boolean {
  const p = world.player;
  const me = playerVehicle(world);
  const lowFuel = p.fuel <= fuelCap(me) * RULES.lowFuelThreshold && p.money >= ECONOMY.supplyPrice.fuel;
  const lowSupplies = p.supplies <= suppliesCap(me) * NPC_UPKEEP.lowSupplies && p.money >= ECONOMY.supplyPrice.supplies;
  const damaged = mountedParts(me).some(isBadlyDamaged) && repairCost(world) <= p.money;
  return lowFuel || lowSupplies || damaged;
}

function isBadlyDamaged(part: PartInstance): boolean {
  return part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition;
}

// Fills fuel and supplies as far as the money goes, then repairs everything if the money covers it.
function serviceHere(o: Orders): void {
  for (const kind of ['fuel', 'supplies'] as const) {
    const n = Math.min(supplyRoom(o.world, kind), Math.floor(o.world.player.money / ECONOMY.supplyPrice[kind]));
    if (n > 0) o.run((w) => buySupply(w, kind, n), `buy ${kind}`);
  }
  const cost = repairCost(o.world);
  if (cost > 0 && cost <= o.world.player.money) o.run(repairAll, 'repair');
}

// ---- Goals.

const GOALS: Record<Goal, (o: Orders) => void> = {
  trader: traderGoal,
  scavenger: scavengerGoal,
  fighter: fight,
  robber: (o) => robberGoal(o, false),
  convoyRobber: (o) => robberGoal(o, true),
};

// A trader with too little money for a load, and every town known, scavenges until it can buy one. Salvage never
// grows back, so a bot with neither left waits in the nearest town.
function traderGoal(o: Orders): void {
  if (!trade(o) && !scavenge(o)) driveToSite(o, nearestTown(o.world));
}

// A scavenger with no stock left to search and no salvage site left to find trades instead, or waits in town.
function scavengerGoal(o: Orders): void {
  if (!scavenge(o) && !trade(o)) driveToSite(o, nearestTown(o.world));
}

type Purchase = { town: TownDef; good: string; count: number; profit: number };

// The trader sells what it carries in the known town that pays most for it, then buys the good with the most profit
// between known towns that it can afford above its upkeep reserve. With no such trade it drives to find a new town.
// Returns false when it has nothing to do: no affordable trade and every town known.
function trade(o: Orders): boolean {
  if (hasCargo(o.me) && !sellAtMarket(o)) return true;
  const buy = bestPurchase(o.world);
  if (buy) return buyThere(o, buy);
  const town = nearestUndiscovered(o.world, REGION.towns);
  if (!town) return false;
  driveToSite(o, town);
  return true;
}

function buyThere(o: Orders, buy: Purchase): true {
  if (townAt(o.world)?.id !== buy.town.id) driveToSite(o, buy.town);
  else o.run((w) => buyGood(w, buy.good, buy.count), 'buy goods');
  return true;
}

// Sells the cargo in its best market, or drives there. True once the cargo is sold.
function sellAtMarket(o: Orders): boolean {
  // The player starts knowing no town, so the first market is the nearest town it finds.
  const market = knownTowns(o.world).length > 0 ? bestMarket(o.world) : nearestUndiscovered(o.world, REGION.towns)!;
  if (townAt(o.world)?.id !== market.id) {
    driveToSite(o, market);
    return false;
  }
  sellCargo(o);
  return true;
}

// The known town where the cargo for sale brings the most profit over what it cost. Nearest first on a tie.
function bestMarket(world: World): TownDef {
  const cargo = Object.entries(cargoForSale(playerVehicle(world)));
  const profit = (town: TownDef) => cargo.reduce((sum, [good, n]) => sum + n * (sellAt(world, town, good) - (world.player.costBasis[good] ?? 0)), 0);
  return byDistance(world, knownTowns(world)).reduce((best, town) => (profit(town) > profit(best) ? town : best));
}

function bestPurchase(world: World): Purchase | null {
  const spend = world.player.money - getUpkeepReserve(playerVehicle(world));
  const towns = knownTowns(world);
  const options = towns.flatMap((source) => towns.filter((t) => t.id !== source.id).flatMap((market) => GOOD_IDS.map((good) => purchase(world, { source, market, good, spend }))));
  return options.reduce<Purchase | null>((best, p) => (p.count > 0 && p.profit > (best?.profit ?? 0) ? p : best), null);
}

// Buying as much of a good at the source as fits and the money allows, to sell at the market.
function purchase(world: World, { source, market, good, spend }: { source: TownDef; market: TownDef; good: string; spend: number }): Purchase {
  const me = playerVehicle(world);
  const buy = getTradePrice(world, me, source.id, good, 'buy');
  const count = affordableBuyCount(world, me, source.id, good, freeCells(me), spend);
  return { town: source, good, count, profit: (sellAt(world, market, good) - buy) * count };
}

function sellAt(world: World, town: TownDef, good: string): number {
  return getTradePrice(world, playerVehicle(world), town.id, good, 'sell');
}

// The scavenger loots what it searched, searches the nearest known stock it has not searched, and sells in the
// nearest town when its cargo is full or no stock is left. With nothing left to search it drives to find a new
// salvage site. Returns false when it has nothing to do: no stock, no cargo and no site left to find.
function scavenge(o: Orders): boolean {
  if (townAt(o.world) && hasCargo(o.me)) sellCargo(o);
  lootHere(o);
  const stock = freeCells(o.me) > 0 ? nearestStock(o.world, knownStocks(o.world)) : null;
  if (stock) visitStock(o, stock);
  else if (hasCargo(o.me)) driveToSite(o, nearestTown(o.world));
  else return findSalvageSite(o);
  return true;
}

function findSalvageSite(o: Orders): boolean {
  const site = nearestUndiscovered(o.world, REGION.locations.filter((l) => l.kind === 'convoy' || l.kind === 'landmark'));
  if (!site) return false;
  driveToSite(o, site);
  return true;
}

// The fighter drives at the nearest hostile it sees or hears, loots the wrecks it sees, sells in town when full and
// otherwise drives to the nearest raider hunting ground.
function fight(o: Orders): void {
  if (townAt(o.world) && hasCargo(o.me)) sellCargo(o);
  const foe = nearestFoe(o.world);
  if (foe) return driveTo(o, foe);
  lootHere(o);
  collectOrHunt(o);
}

function collectOrHunt(o: Orders): void {
  if (freeCells(o.me) === 0) return driveToSite(o, nearestTown(o.world));
  const wreck = nearestStock(o.world, knownStocks(o.world).filter((s) => s.id.startsWith('wreck-') && playerSees(o.world, s.pos)));
  if (wreck) return visitStock(o, wreck);
  hunt(o);
}

// Where raiders hunt: the grounds of every camp, in data order.
export function raiderHuntGrounds(): Vec[] {
  return REGION.locations.filter((site) => site.kind === 'camp').flatMap((camp) => raiderGrounds(camp));
}

// The fighter keeps driving to the hunting ground it is bound for. Without one, it goes to the ground after the one
// nearest it, in data order. A ground the truck cannot quite reach, like one a parked truck stands on, counts as
// visited once its stop order ends.
function hunt(o: Orders): void {
  const order = o.me.order;
  const grounds = raiderHuntGrounds();
  if (grounds.length === 0) throw new Error('no raider hunting ground to hunt on');
  if (order?.kind === 'stopAt' && grounds.some((g) => g.x === order.dest.x && g.y === order.dest.y)) return;
  const here = grounds.indexOf(nearest(o.me.pos, grounds) ?? grounds[0]);
  driveTo(o, grounds[(here + 1) % grounds.length]);
}

// Where a hostile truck is: in sight, or at the center of its contact circle. Nearest first.
function nearestFoe(world: World): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v));
  const seen = hostile.filter((v) => playerSees(world, v.pos)).map((v) => v.pos);
  const heard = world.player.contacts.filter((c) => hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center);
  return nearest(me.pos, seen) ?? nearest(me.pos, heard);
}

// ---- Salvage.

// Stocks the player knows of that hold loot and that it has not searched: at a discovered site, or a wreck on
// explored ground.
function knownStocks(world: World): SalvageStock[] {
  return world.salvage.filter((stock) => {
    if (!hasSalvage(stock) || world.player.scavenged.includes(stock.id)) return false;
    const site = REGION.locations.find((l) => l.id === stock.id);
    return site ? world.player.discovered.includes(site.id) : playerExplored(world, stock.pos);
  });
}

function nearestStock(world: World, stocks: SalvageStock[]): SalvageStock | null {
  const pos = playerVehicle(world).pos;
  return stocks.reduce<SalvageStock | null>((best, s) => (!best || dist(pos, s.pos) < dist(pos, best.pos) ? s : best), null);
}

// Takes all that fits from a searched stock in reach.
function lootHere(o: Orders): void {
  const stock = salvageHere(o.world);
  if (!stock || !canLoot(o.world, stock.id) || freeCells(o.me) === 0) return;
  if (lootBlocker(o.world, o.me, stock.id)) return;
  o.loot(stock.id, (w) => takeAllLoot(w, stock.id));
}

// A player cannot start a search with a hostile in sight or while another truck loots the stock, so the bot waits
// beside the stock and lets auto fire or the other looter finish.
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
export const CARGO_REASONS: readonly string[] = ['deliver purchased cargo', 'buy profitable cargo', 'load cargo at its source'];
// The factions a robber demands cargo from.
const ROB_FACTIONS: readonly Faction[] = ['traders', 'convoys'];
// The towns a robber drives between while it looks for a target.
const PATROL: readonly string[] = ['bowl', 'nose'];

// A careful robber. It sells at its best market once its cells are full, and in any town it stops at. Otherwise it
// takes what lies in reach, fights a foe it is engaged with, demands cargo from a target in sight, goes for a pile, a
// wreck or a knocked-out target it sees, or drives between the towns. With `guarded`, it also demands from targets
// whose escort is in sight.
function robberGoal(o: Orders, guarded: boolean): void {
  if (freeCells(o.me) === 0 && hasCargo(o.me)) {
    sellAtMarket(o);
    return;
  }
  sellInTown(o);
  lootHere(o);
  const foe = engagedFoe(o.world);
  if (foe) return driveTo(o, foe);
  demandInSight(o, guarded);
  if (freeCells(o.me) > 0) collectOrPatrol(o);
}

function sellInTown(o: Orders): void {
  if (townAt(o.world) && hasCargo(o.me)) sellCargo(o);
}

// Demands cargo from the nearest target in sight, unless the player is in a fight.
function demandInSight(o: Orders, guarded: boolean): void {
  const target = inCombat(o.world, o.me) ? null : robTarget(o.world, guarded);
  if (target) demand(o, target);
  if (o.world.player.call) throw new Error(`The robber left a call with ${o.world.player.call.with} open`);
}

// Strips a knocked-out target in sight, or goes for a pile or wreck in sight, or drives on between the towns.
function collectOrPatrol(o: Orders): void {
  const downed = downedTarget(o.world);
  if (downed) return takeFromTarget(o, downed);
  const stock = nearestStock(o.world, knownStocks(o.world).filter((s) => !isSiteStock(s) && playerSees(o.world, s.pos)));
  if (stock) return visitStock(o, stock);
  patrol(o);
}

// The nearest truck in a fight with the player: a hostile in sight, or one heard while their combat lasts. Combat
// lapses after STATE_TURNS.combat turns with no hostile act, so a target that got out of sight is given up then.
function engagedFoe(world: World): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && !isDefeated(v) && hostileToPlayer(world, v));
  const seen = hostile.filter((v) => playerSees(world, v.pos)).map((v) => v.pos);
  const fighting = new Set(world.states.filter((s) => s.kind === 'combat' && (s.holder === me.id || s.other === me.id)).map((s) => (s.holder === me.id ? s.other : s.holder)));
  const heard = world.player.contacts.filter((c) => fighting.has(c.vehicleId) && hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center);
  return nearest(me.pos, seen) ?? nearest(me.pos, heard);
}

// The nearest truck the robber would demand cargo from. It reads only what the player sees: a driver in sight, at
// peace and awake, of a trader or convoy faction, whose goal line says it carries cargo, with no more mounted guns
// than the player's truck, that the player has not robbed before. Without `guarded`, a target with an awake escort
// in sight is skipped.
export function robTarget(world: World, guarded: boolean): Vehicle | null {
  const me = playerVehicle(world);
  const guns = mountedParts(me, 'weapon').length;
  const targets = world.vehicles.filter((v) => isRobberyPrey(world, v) && saysCarriesCargo(v) && mountedParts(v, 'weapon').length <= guns && (guarded || !guardedInSight(world, v)));
  return targets.reduce<Vehicle | null>((best, v) => (!best || dist(me.pos, v.pos) < dist(me.pos, best.pos) ? v : best), null);
}

// An awake trader or convoy driver in sight and radio reach, at peace with the player, not robbed by it before.
function isRobberyPrey(world: World, v: Vehicle): boolean {
  if (!isAwakeDriverOf(world, v, ROB_FACTIONS)) return false;
  return inRadioSight(world, v) && !hostileToPlayer(world, v) && world.player.talked[v.id]?.rob === undefined;
}

function isAwakeDriverOf(world: World, v: Vehicle, factions: readonly Faction[]): boolean {
  return v.id !== world.player.vehicleId && v.brain !== null && !isDefeated(v) && factions.includes(v.faction);
}

function inRadioSight(world: World, v: Vehicle): boolean {
  return playerSees(world, v.pos) && canVehicleSee(world, playerVehicle(world), v.pos);
}

// The goal line under the driver says it carries cargo or goes to load it.
function saysCarriesCargo(v: Vehicle): boolean {
  const reason = topGoal(v)?.reason;
  return reason !== undefined && CARGO_REASONS.includes(reason);
}

function guardedInSight(world: World, v: Vehicle): boolean {
  return escortsOf(world, v.id).some((e) => !isDefeated(e) && playerSees(world, e.pos));
}

// Radios the target and demands its cargo. The driver answers with its one reply, which the bot notes. A driver whose
// hub offers no demand, like one with nothing on its grid or one busy fighting another truck, gets a hang up.
function demand(o: Orders, target: Vehicle): void {
  o.run((w) => callVehicle(w, target.id));
  const rob = currentOptions(o.world).findIndex((opt) => opt.topic === 'rob' && opt.option === null);
  if (rob < 0) {
    o.run(hangUp);
    return;
  }
  o.run((w) => chooseOption(w, rob), 'call rob');
  const replies = currentOptions(o.world).filter((opt) => opt.option !== null);
  if (replies.length !== 1) throw new Error(`A demand on ${target.id} offers ${replies.length} replies, not one`);
  o.run((w) => chooseOption(w, 0), 'call rob');
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

// A knocked-out trader or convoy in sight with loose items on its grid, which the player strips on the loot grid.
function downedTarget(world: World): Vehicle | null {
  const me = playerVehicle(world);
  const downed = world.vehicles.filter((v) => ROB_FACTIONS.includes(v.faction) && isKnockedOut(v) && playerSees(world, v.pos) && hasLooseItems(v) && !lootBlocker(world, me, v.id));
  return downed.reduce<Vehicle | null>((best, v) => (!best || dist(me.pos, v.pos) < dist(me.pos, best.pos) ? v : best), null);
}

function hasLooseItems(v: Vehicle): boolean {
  return v.items.some((it) => !isMounted(v.chassisId, it));
}

// Parks beside a knocked-out target, then takes each loose good and spare that fits, one command each.
function takeFromTarget(o: Orders, target: Vehicle): void {
  if (!canLootTruck(o.me, target)) return driveTo(o, besideStop(o.world, target.pos, chassisDef(target.chassisId).radius));
  for (const item of target.items.filter((it) => !isMounted(target.chassisId, it))) {
    const spot = looseSpot(o.me, item);
    if (spot) o.loot(target.id, (w) => takeFromTruck(w, target.id, item.id, spot));
  }
}

// A free spot off the mounts for a looted item, or null when it does not fit by cells or mass.
function looseSpot(me: Vehicle, item: GridItem): Spot | null {
  if (itemMass(item) > cargoMassRoom(me)) return null;
  const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
  return findSpot(gridOf(me), me.items, { ...item, id: 'loot-probe' }, null, avoid);
}

// Drives between the patrol towns: on to the next one from a town, to the nearest one from the road, and on with an
// order already bound for one of them.
function patrol(o: Orders): void {
  const towns = PATROL.map((id) => {
    const town = REGION.towns.find((t) => t.id === id);
    if (!town) throw new Error(`No patrol town ${id}`);
    return town;
  });
  const order = o.me.order;
  if (order?.kind === 'stopAt' && towns.some((t) => canUseSite(order.dest, t))) return;
  const here = townAt(o.world);
  const at = here ? towns.findIndex((t) => t.id === here.id) : -1;
  driveToSite(o, at >= 0 ? towns[(at + 1) % towns.length] : byDistance(o.world, towns)[0]);
}

// ---- Cargo.

// Goods to sell: all but the parts kept for field repairs, as an NPC keeps them.
function cargoForSale(v: Vehicle): Record<string, number> {
  const goods = goodsCount(v);
  const parts = Math.max(0, (goods.parts ?? 0) - NPC_UPKEEP.repairParts);
  const forSale = { ...goods, parts };
  return Object.fromEntries(Object.entries(forSale).filter(([, n]) => n > 0));
}

function spareItems(v: Vehicle): { itemId: string; partId: string }[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [{ itemId: it.id, partId: it.part.id }] : []));
}

function hasCargo(v: Vehicle): boolean {
  return Object.keys(cargoForSale(v)).length > 0 || spareItems(v).length > 0;
}

// Sells the goods for sale, and sells spare parts through garage storage.
function sellCargo(o: Orders): void {
  for (const [good, n] of Object.entries(cargoForSale(o.me))) o.run((w) => sellGood(w, good, n), 'sell goods');
  for (const { itemId, partId } of spareItems(o.me)) {
    o.run((w) => storePart(w, itemId));
    o.run((w) => sellPart(w, partId), 'sell parts');
  }
}

// ---- Driving.

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

// A stop just outside something round, on the side the truck comes from, like an NPC parks beside a stock.
function besideStop(world: World, center: Vec, radius: number): Vec {
  const me = playerVehicle(world);
  const out = radius + vehicleStats(world, me).radius + RULES.arriveRadius;
  const angle = Math.atan2(me.pos.y - center.y, me.pos.x - center.x);
  return { x: center.x + Math.cos(angle) * out, y: center.y + Math.sin(angle) * out };
}

// Gives a stop order unless the truck already has this one.
function driveTo(o: Orders, dest: Vec): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && order.dest.x === dest.x && order.dest.y === dest.y) return;
  o.run((w) => setMoveOrder(w, { kind: 'stopAt', dest }));
}
