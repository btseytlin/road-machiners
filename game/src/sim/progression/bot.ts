// A scripted player for the progression recorder. Each turn it picks the player's commands for one archetype and
// applies them through the public command functions, like the UI would. It keeps no state of its own: every choice
// follows from the world, so the same world always gets the same commands. The bot is a policy, not the NPC brain.
// It reuses the NPC upkeep thresholds, so it services when an NPC driver would.

import { chassisDef } from '../../data/chassis';
import { ECONOMY, GOOD_IDS } from '../../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, SPAWN } from '../../data/npcs';
import { partDef } from '../../data/parts';
import { REGION, type TownDef } from '../../data/region';
import { RULES } from '../../data/rules';
import { ENGINE_HEAT } from '../../data/wear';
import { TOPICS, type TopicId } from '../../data/dialogue';
import { maxHp, partValue } from '../wear';
import { inCombat, isHostile } from '../combat';
import { startStrip, stripYield } from '../jobs';
import { aimGuns, isSoftTarget } from './aim';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder, setWeaponOrder } from '../world';
import { playerVehicle, vehicleById } from '../damage';
import { isKnockedOut } from '../defeat';
import { isTownGuarded } from '../guards';
import { campGunning, nearestGate } from '../camp-guns';
import { callVehicle, chooseOption, currentOptions } from '../dialogue';
import { offeredSurrenderBy } from '../parley';
import { hashRandom } from '../rng';
import { affordableBuyCount, basicsRepairCost, buyGood, buyStockPart, buySupply, partTradePrice, getTradePrice, repairAll, repairBasics, repairCost, sellGood, sellPart, supplyRoom } from '../economy';
import { corePart, findSpot, freeCells, goodsCount, gridOf, isMounted, itemCells, MOUNT_CELLS, mountedItems, mountedParts, type Spot } from '../grid';
import { cargoRoom, getLayoutError, stowSpot, storePart } from '../inventory';
import { acceptContract, deliverContract, estimateTurns, shopAt, shopState, siteOf, type Contract } from '../market';
import { CONTRACTS, shopDef, SHOPS } from '../../data/market';
import { heatAt } from '../sun';
import { canLoot, downedHere, salvageHere, takeAllLoot } from '../locations';
import { firepower, getUpkeepReserve, isWeak, ownDanger, perceiveDanger, vehicleDanger } from '../npc-decisions';
import { canReachSalvage, hasSalvage, lootBlocker, takeError, takeFromTruck } from '../salvage';
import { startSearch } from '../search';
import { canUseSite, nearestPad, nearestTown, siteGates, sitePads, townAt, type Site } from '../sites';
import { fuelCap, hasWorkingEngine, isStranded, isWorking, suppliesCap, vehicleStats } from '../stats';
import { inTowReach, playerTow, setBeacon } from '../tow';
import { towData } from '../states';
import type { Call, GridItem, NpcState, PartInstance, SalvageStock, Vehicle, World } from '../types';
import { clamp, dist, pointsAway, type Vec } from '../vec';
import { playerExplored, playerSees } from '../vision';
import { BIGGEST_PART_CELLS, mountBought, Orders, rearm, REPAIR_PARTS, upgradeGear, type BotTurn, type UpgradeStyle } from './orders';

// Every bot plays the base loop: earn money, pay upkeep, buy upgrades, and shoot back when attacked. Only the hunter
// goes looking for fights. The fast trader wants speed and mounts no armor. The hauler takes the best haul contract on
// every board it reads and trades only with none. The markov bot plays a random one of the others, but the hauler, for
// a stretch of turns, then draws again.
// The climber plays a player's snowball: it hauls and scavenges until the truck mounts CLIMB_GUNS guns, then hunts.
export type Archetype = 'trader' | 'scavenger' | 'hunter' | 'fastTrader' | 'hauler' | 'climber' | 'markov';
export const ARCHETYPES: readonly Archetype[] = ['trader', 'scavenger', 'hunter', 'fastTrader', 'hauler', 'climber', 'markov'];
type Goal = Exclude<Archetype, 'markov' | 'climber'>;

// A player who snowballed hunted raiders from a convertible with two machine guns, a slug cannon and a shotgun.
const CLIMB_GUNS = 3;
const GOALS_PLAYED: readonly Goal[] = ['trader', 'scavenger', 'hunter', 'fastTrader'];

// Traders and scavengers earn with cargo room, so their gear never takes it.
const CARGO_GEAR: UpgradeStyle = { skip: [], chassis: 'value', keepRoom: true };
const GEAR_STYLES: Record<Goal, UpgradeStyle> = {
  trader: CARGO_GEAR,
  scavenger: CARGO_GEAR,
  // A hunter keeps the chassis it starts with: a swap pays the shop's spread, and gear is where its edge comes from.
  hunter: { skip: [], chassis: 'keep', keepRoom: false },
  fastTrader: { skip: ['armor'], chassis: 'speed', keepRoom: true },
  hauler: CARGO_GEAR,
};

// A hunter's gear keeps room for the loot of a wreck and the speed to catch the foes it fights. Its gear bought once
// filled every free cell and left the truck slower than the raiders it hunts, so it could neither chase nor strip.
function gearStyle(o: Orders, goal: Goal): UpgradeStyle {
  if (goal !== 'hunter') return GEAR_STYLES[goal];
  return { ...GEAR_STYLES.hunter, lootRoom: BIGGEST_PART_CELLS, minSpeed: huntedSpeed(o.world) };
}

// The top speed of the fastest raider the hunter would fight, or nothing to hold when it would fight none.
function huntedSpeed(world: World): number | undefined {
  const foes = world.vehicles.filter((v) => v.faction === 'raiders' && v.brain !== null && !isKnockedOut(v) && huntable(world, v));
  return foes.length === 0 ? undefined : Math.max(...foes.map((v) => vehicleStats(world, v).maxSpeed));
}

// markovTurns is how many turns the markov bot keeps one goal. It is required for that bot and ignored by the others.
// tolerateStalls is for the recorder: NPC stalls count in the rows instead of failing the run. kit names the start kit
// the recorder begins from, standard when absent.
export type BotOptions = { markovTurns?: number; tolerateStalls?: boolean; kit?: string };

// The markov draws come from their own hash of the run seed, so they never shift the world's randomness.
const MARKOV_SALT = 0x6d61726b;

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

// The player's commands for this turn. A knocked-out or towed player gets none, and turns still run.
export function botOrders(world: World, archetype: Archetype, options: BotOptions = {}): BotTurn {
  const o = new Orders(world);
  const goal = goalOf(world, archetype, options);
  o.fieldRepair = goal === 'hunter';
  const replies = goal === 'hunter' ? HUNTER_REPLIES : DEFENDER_REPLIES;
  answerCall(o, takesTowOffer(world) ? replies : { ...replies, ...REFUSE_TOW });
  if (playerCanAct(o.world)) {
    keepSwitches(o);
    act(o, goal);
  }
  return { world: o.world, events: o.events, ledger: o.ledger };
}

// A hold, a service stop and a fight each take the turn's command before the goal does.
function act(o: Orders, goal: Goal): void {
  if (leaveCampGuns(o) || holds(o) || serviceTrip(o, gearStyle(o, goal)) || defend(o, goal)) return;
  GOALS[goal](o);
}

// A camp's gate guns shoot every outsider in range and no fight there can be won, so a bot inside the range drives
// straight out to the hunter's standoff distance, as a player would, unless a job holds the truck. True when it does.
function leaveCampGuns(o: Orders): boolean {
  const camp = campGunning(o.me, o.me.pos);
  if (!camp || o.me.job) return false;
  const gate = nearestGate(camp, o.me.pos);
  const gap = Math.max(dist(gate, o.me.pos), 1e-6);
  const out = { x: gate.x + ((o.me.pos.x - gate.x) / gap) * CAMP_STANDOFF, y: gate.y + ((o.me.pos.y - gate.y) / gap) * CAMP_STANDOFF };
  driveTo(o, { x: clamp(out.x, 1, o.world.size - 1), y: clamp(out.y, 1, o.world.size - 1) });
  return true;
}

// Whether the truck stands still for a reason: a job or a patch deal under way, a stop at a town, or a knockout.
// The recorder does not count these turns as a stall.
export function parkedOnPurpose(world: World): boolean {
  if (world.player.state === 'knockedOut') return true;
  return playerVehicle(world).job !== null || patchDeal(world) !== null || shopAt(world) !== null;
}

function climberGoal(world: World): Goal {
  return vehicleStats(world, playerVehicle(world)).weapons.length >= CLIMB_GUNS ? 'hunter' : 'hauler';
}

function goalOf(world: World, archetype: Archetype, options: BotOptions): Goal {
  if (archetype === 'climber') return climberGoal(world);
  if (archetype !== 'markov') return archetype;
  const { markovTurns } = options;
  if (markovTurns === undefined || !Number.isInteger(markovTurns) || markovTurns <= 0) throw new Error(`The markov bot needs markovTurns as a positive whole number, got ${markovTurns}`);
  const stretch = Math.floor((world.turn - 1) / markovTurns);
  return GOALS_PLAYED[Math.floor(hashRandom(world.seed ^ MARKOV_SALT, stretch) * GOALS_PLAYED.length)];
}

// ---- Calls and switches.

// Replies that differ from the first one of a topic. Every bot defends against a demand for its cargo and an offer to
// strip its stranded truck. The hunter also refuses a truce and answers a plea for mercy with a demand to be stripped.
const DEFENDER_REPLIES: Partial<Record<TopicId, string>> = { demand: 'Come and get it.', surrender: 'Come and get it.' };
const HUNTER_REPLIES: Partial<Record<TopicId, string>> = { ...DEFENDER_REPLIES, truceOffer: 'No. We finish this.', mercyPlea: 'Stand down and let me strip your truck.' };
const REFUSE_TOW: Partial<Record<TopicId, string>> = { tow: 'No thanks.', towFree: 'No thanks.' };
const YIELD_CARGO = 'Fine. Take it.';

// Every open call gets the first reply of each topic, unless the bot's replies name another. Every bot hands its
// cargo to a demand, and its truck to a strip offer, only from a foe that outmatches it. On the hub, the bot hangs
// up, which is the last option.
function answerCall(o: Orders, replies: Partial<Record<TopicId, string>> = DEFENDER_REPLIES): void {
  const seen = new Set<string>();
  for (let call = o.world.player.call; call; call = o.world.player.call) {
    const at = `${call.with}:${call.topic}:${call.node}`;
    if (seen.has(at)) throw new Error(`Bot call loops back to ${at}`);
    seen.add(at);
    const pick = call.topic ? Math.max(0, currentOptions(o.world).findIndex((option) => option.text === replyTo(o.world, call, replies))) : currentOptions(o.world).length - 1;
    o.run((w) => chooseOption(w, pick));
  }
}

function replyTo(world: World, call: Call, replies: Partial<Record<TopicId, string>>): string | undefined {
  if ((call.topic === 'demand' || call.topic === 'surrender') && outmatchedBy(world, vehicleById(world, call.with))) return YIELD_CARGO;
  return call.topic ? replies[call.topic] : undefined;
}

// Auto patch stays on for every bot. Auto fire shoots the nearest hostile in sight, and a raider is hostile to any
// truck with loot, so it stays on only in combat: a bot shoots back like a player would and never opens fire on a
// raider that left it alone. The hunter also turns it on at the foe it picks.
function keepSwitches(o: Orders): void {
  if (!o.world.player.autoRepair) o.run((w) => setAutoRepair(w, true));
  setFire(o, underFire(o.world, o.me));
}

// In combat and outside the guns of a town gate. Inside them a foe may camp at the gate for hundreds of turns: the
// guard shoots any truck that fires at a non-raider, so the bot holds its fire there and repairs as a player would.
function underFire(world: World, me: Vehicle): boolean {
  return inCombat(world, me) && !isTownGuarded(me.pos);
}

// Holding fire also drops the aim: an order set while auto fire was on keeps the guns shooting after the switch is off.
function setFire(o: Orders, on: boolean): void {
  if (o.world.player.autoFire !== on) o.run((w) => setAutoFire(w, on));
  if (!on) for (const id of Object.keys(o.me.weaponOrders)) o.run((w) => setWeaponOrder(w, id, null));
}

// ---- Holding still: jobs, a hot engine and patch deals.

// True when the truck must not drive this turn, after any command the hold needs.
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

// A parked truck cools 0.15 heat a turn in full sun heat 1 and a driving one gains up to 0.04 a turn at noon. Half the
// warning level is about 8 turns of rest at noon for about 10 turns of driving. Resuming just under the warning gave a
// stop-and-go every 1 to 3 turns that covered almost no ground.
const HEAT_RESUME = ENGINE_HEAT.warnAt / 2;

// A hot engine cools while parked. The bot stops at the warning, as the warning tells the player to, and stays parked
// until the engine is down to HEAT_RESUME. A truck without a move order is the one it parked, since a driving bot
// always holds one. With a hostile in sight it drives on: an overheated engine loses 2 HP a turn, and a parked truck
// loses its engine to the foe's guns.
function coolsEngine(o: Orders): boolean {
  if (inCombat(o.world, o.me) || seenHostiles(o.world).length > 0) return false;
  const heat = o.world.player.engineHeat;
  return heat >= ENGINE_HEAT.warnAt || (heat >= HEAT_RESUME && o.me.order === null);
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

// In town the bot tops up, repairs and buys an engine if a knockout or a robbery took its own. A truck without an
// engine heads for the nearest shop with an engine its money and sellable gear cover, crawling or towed. Out of town
// with low fuel, low supplies or a badly damaged part, and the money to fix it, it drives to the nearest shop. A need
// it cannot pay for does not send it to town, so a poor bot drives on to earn, crawling if it must. A stranded truck
// that wants a tow turns its beacon on and takes the first tow offered on the radio, but never in combat: the beacon
// draws raiders to a truck with cargo. Returns true when the trip to a shop is this turn's order.
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

// A stranded bot wants a tow only when some shop can get it going, and takes an offer only to such a shop. A broke bot
// that can crawl refuses tows and crawls on to earn, since a tow to a town that cannot fix it puts it in debt.
function wantsTow(world: World): boolean {
  return SHOP_SITES.some((s) => towFixes(world, s.id));
}

function takesTowOffer(world: World): boolean {
  const offer = playerTow(world);
  return offer === null || towFixes(world, towData(offer).site);
}

// A tow helps only to another shop that fixes what strands the truck, with the money and sellable gear for it. A
// truck without an engine needs a shop that stocks one. A broken engine or transmission needs a garage.
function towFixes(world: World, siteId: string): boolean {
  if (!(siteId in SHOPS) || shopAt(world) === siteId) return false;
  const budget = saleBudget(world, siteId);
  if (mountedParts(playerVehicle(world), 'engine').length === 0) return stockEngine(world, siteId, budget) !== null;
  return repairFits(world, siteId, budget);
}

// A truck stranded by a dry tank alone crawls on, so it wants a tow only to a shop where it can pay for fuel.
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

// A bot in debt can buy no fuel, supplies or load, so it sells cargo, then gear, to clear the debt. The engine
// comes next, since selling gear for it can leave money for fuel and supplies, then the built-in parts the truck
// drives on.
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

// The nearest shop that stocks an engine the money and the sellable gear cover. A guess from engine prices alone
// sent the bot back to a shop that had none, again and again.
function nearestEngineShop(world: World): Site | null {
  const pos = playerVehicle(world).pos;
  const stocked = SHOP_SITES.filter((s) => stockEngine(world, s.id, saleBudget(world, s.id)) !== null);
  return stocked.reduce<Site | null>((best, s) => (!best || dist(pos, s.pos) < dist(pos, best.pos) ? s : best), null);
}

// The cheapest engine a shop stocks within the budget. A stall hands a bought part over loose, so there it must fit
// the truck once the goods and spares are sold.
function stockEngine(world: World, shopId: string, budget: number): { part: PartInstance; price: number } | null {
  const me = playerVehicle(world);
  const stripped = { ...me, items: me.items.filter((it) => it.kind === 'part' && isMounted(me.chassisId, it)) };
  const takes = (part: PartInstance) => shopDef(shopId).kind === 'garage' || stowSpot(stripped, { id: 'engine-probe', x: 0, y: 0, rot: 0, kind: 'part', part }) !== null;
  const engines = shopState(world, shopId).stock.filter((p) => partDef(p.defId).kind === 'engine' && takes(p))
    .map((part) => ({ part, price: partTradePrice(world, me, part, 'buy') }))
    .filter((e) => e.price <= budget)
    .sort((a, b) => a.price - b.price);
  return engines[0] ?? null;
}

// The money, plus what the gear for sale at this shop brings.
function saleBudget(world: World, shopId: string): number {
  return world.player.money + gearForSale(world, shopId).reduce((sum, g) => sum + g.price, 0);
}

// A part the bot may sell at a shop, with its price: spares first, then stored parts, then mounted gear, each
// cheapest first. Every shop buys spares. Only a garage, which stands in a town, buys stored and mounted parts.
// Built-in parts never sell. A mounted part goes into garage storage before the sale, as a player unmounts it.
type GearSale = { part: PartInstance; mountedItem: string | null; price: number };

function gearForSale(world: World, shopId: string): GearSale[] {
  const me = playerVehicle(world);
  const sale = (part: PartInstance, mountedItem: string | null) => ({ part, mountedItem, price: partTradePrice(world, me, part, 'sell') });
  const byPrice = (a: GearSale, b: GearSale) => a.price - b.price;
  const spares = spareItems(me).map((s) => sale(partOf(me, s.partId), null)).sort(byPrice);
  if (shopDef(shopId).kind !== 'garage') return spares;
  const stored = world.player.storage.map((part) => sale(part, null)).sort(byPrice);
  const mounted = mountedItems(me).filter((it) => !['core', 'engine'].includes(partDef(it.part.defId).kind) && removable(me, it)).map((it) => sale(it.part, it.id)).sort(byPrice);
  return [...spares, ...stored, ...mounted];
}

// A part that carries other items, such as a rack, cannot come off while they ride on it.
function removable(v: Vehicle, item: GridItem): boolean {
  return getLayoutError(v, v.items.filter((it) => it.id !== item.id)) === null;
}

function partOf(v: Vehicle, partId: string): PartInstance {
  const item = v.items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item || item.kind !== 'part') throw new Error(`Part ${partId} is not on ${v.id}`);
  return item.part;
}

// Buys and mounts the cheapest engine the shop it stands at stocks, when the truck has none. It sells its cargo, then
// gear, cheapest first, until the money covers the engine.
function restoreEngine(o: Orders, shopId: string): void {
  if (mountedParts(o.me, 'engine').length > 0) return;
  const engine = stockEngine(o.world, shopId, saleBudget(o.world, shopId));
  if (!engine) return;
  if (o.world.player.money < engine.price || !engineSpot(o.me, engine.part.defId)) sellCargo(o);
  sellGearFor(o, shopId, engine.price);
  const spot = engineSpot(o.me, engine.part.defId);
  if (!spot) throw new Error(`No free engine mount for a new engine. On the engine cells: ${onEngineCells(o.me)}`);
  o.run((w) => buyStockPart(w, engine.part.id), 'gear');
  mountBought(o, engine.part.id, spot);
}

// Badly damaged built-in parts get fixed before fuel and supplies, with cargo and then gear sold for the bill, since
// the truck must drive to earn. Gear sells only when it covers the whole bill. The repair waits for the end of a fight.
function restoreBasics(o: Orders, shopId: string): void {
  if (underFire(o.world, o.me) || !mountedParts(o.me, 'core').some(isBadlyDamaged)) return;
  const cost = basicsRepairCost(o.world);
  if (o.world.player.money < cost) sellCargo(o);
  if (saleBudget(o.world, shopId) < cost) return;
  sellGearFor(o, shopId, cost);
  o.run(repairBasics, 'repairs');
}

// Each sale can change what else comes off, so the list is drawn again after every one.
function sellGearFor(o: Orders, shopId: string, price: number): void {
  while (o.world.player.money < price) {
    const g = gearForSale(o.world, shopId)[0];
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

// Every shop is a place to fuel, the two towns and the stalls between them: a tank holds only about 160 tiles, and the
// towns lie further apart than that.
const SHOP_SITES: readonly Site[] = Object.keys(SHOPS).map(siteOf);

function nearestShop(world: World): Site {
  const pos = playerVehicle(world).pos;
  return [...SHOP_SITES].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}

// The fuel the straight way to the nearest shop takes at the heat where the truck stands, times the reserve an NPC
// driver keeps for it. The bot heads for a shop once its tank holds no more.
function fuelForWayToShop(world: World): number {
  const me = playerVehicle(world);
  return dist(me.pos, nearestShop(world).pos) * vehicleStats(world, me).fuelPerTile * heatAt(world, me.pos) * NPC_UPKEEP.fuelReserve;
}

function needsService(o: Orders): boolean {
  const world = o.world;
  const p = world.player;
  const me = o.me;
  const lowFuel = p.fuel <= Math.max(fuelCap(me) * RULES.lowFuelThreshold, fuelForWayToShop(world)) && p.money >= ECONOMY.supplyPrice.fuel;
  const lowSupplies = p.supplies <= suppliesCap(me) * NPC_UPKEEP.lowSupplies && p.money >= ECONOMY.supplyPrice.supplies;
  return lowFuel || lowSupplies || needsRepair(o);
}

// A badly damaged part the money covers, once the fight is over: repairing under fire pays for the next hit. A junk
// part no garage can rebuild has no repair, so it adds nothing to the cost. A field repairer counts only the built-in
// parts and their bill.
function needsRepair(o: Orders): boolean {
  const cost = o.fieldRepair ? basicsRepairCost(o.world) : repairCost(o.world);
  const parts = o.fieldRepair ? mountedParts(o.me, 'core') : mountedParts(o.me);
  return parts.some(isBadlyDamaged) && cost > 0 && cost <= o.world.player.money && !underFire(o.world, o.me);
}

function isBadlyDamaged(part: PartInstance): boolean {
  return part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition;
}

// Fills fuel and supplies as far as the money goes, then repairs everything if the money covers it and no fight is on.
function serviceHere(o: Orders): void {
  for (const kind of ['fuel', 'supplies'] as const) {
    const n = Math.min(supplyRoom(o.world, kind), Math.floor(o.world.player.money / ECONOMY.supplyPrice[kind]));
    if (n > 0) o.run((w) => buySupply(w, kind, n), kind);
  }
  repairAtGarage(o);
}

// Tops up the parts good to REPAIR_PARTS, before any gear, so a breakdown on the road gets a field patch instead of a
// beacon. A shop that does not trade parts leaves the stock as it is.
function stockRepairParts(o: Orders, shop: string): void {
  if (!shopDef(shop).goods.includes('parts')) return;
  const want = Math.min(REPAIR_PARTS - (goodsCount(o.me).parts ?? 0), cargoRoom(o.me, 'parts'));
  if (want <= 0) return;
  const n = affordableBuyCount(o.world, o.me, shop, 'parts', want, o.world.player.money);
  if (n > 0) o.run((w) => buyGood(w, 'parts', n), 'repairs');
}

// A field repairer pays the garage for the built-in parts at every visit and leaves guns and armor to the field.
function repairAtGarage(o: Orders): void {
  const cost = o.fieldRepair ? basicsRepairCost(o.world) : repairCost(o.world);
  if (cost > 0 && cost <= o.world.player.money && !underFire(o.world, o.me)) o.run(o.fieldRepair ? repairBasics : repairAll, 'repairs');
}

// ---- Goals.

const GOALS: Record<Goal, (o: Orders) => void> = { trader: traderGoal, scavenger: scavengerGoal, hunter: hunterGoal, fastTrader: traderGoal, hauler: haulerGoal };

// A trader with too little money for a load, and every town known, scavenges until it can buy one. Salvage never
// grows back, so a bot with neither left waits in the nearest town.
function traderGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!trade(o) && !takeHaul(o) && !scavenge(o, false)) checkNextBoard(o);
}

// The hauler takes the best haul on the board it stands at before it looks at the market, so a contract pays the trip
// and the market only fills the turns between boards.
function haulerGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!takeHaul(o) && !trade(o) && !scavenge(o, false)) checkNextBoard(o);
}

// ---- Haul contracts: paid work for a trader too poor for a load. The contract loads its goods free.

type Haul = Extract<Contract, { kind: 'haul' }>;

// A haul whose goods a raider took cannot be handed in. It runs out at its deadline, and the trader works on.
function heldHaul(world: World): Haul | null {
  const goods = goodsCount(playerVehicle(world));
  return world.player.contracts.find((c): c is Haul => c.kind === 'haul' && (goods[c.good] ?? 0) >= c.units) ?? null;
}

// Drives the goods to the contract's shop and hands them in.
function carryHaul(o: Orders, haul: Haul): void {
  if (shopAt(o.world) === haul.to) o.run((w) => deliverContract(w, haul.id), 'contracts');
  else driveToSite(o, siteOf(haul.to));
}

// Takes the haul on the board here that pays most per estimated turn of the trip, if one fits the truck.
function takeHaul(o: Orders): boolean {
  const shop = shopAt(o.world);
  if (!shop || o.world.player.money < 0) return false;
  const here = siteOf(shop).pos;
  const pay = (c: Haul) => c.reward / estimateTurns(here, siteOf(c.to).pos);
  const offers = shopState(o.world, shop).contracts.filter((c): c is Haul => c.kind === 'haul' && c.deadline > o.world.turn && c.units <= freeCells(o.me));
  const best = offers.reduce<Haul | null>((top, c) => (!top || pay(c) > pay(top) ? c : top), null);
  if (best) o.run((w) => acceptContract(w, best.id));
  return best !== null;
}

// With nothing it can do here, a bot looks at the board of the nearest other shop.
function checkNextBoard(o: Orders): void {
  const here = shopAt(o.world);
  const others = SHOP_SITES.filter((s) => s.id !== here);
  const pos = o.me.pos;
  const next = others.reduce((best, s) => (dist(pos, s.pos) < dist(pos, best.pos) ? s : best));
  driveToSite(o, next);
}

// A scavenger with no stock left to search and no salvage site left to find trades instead. Too poor to trade, it
// takes a haul and otherwise reads the next board, like a trader: salvage never grows back, so waiting earns nothing.
function scavengerGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!scavenge(o, false) && !trade(o) && !takeHaul(o)) checkNextBoard(o);
}

type Purchase = { town: TownDef; good: string; count: number; profit: number };

// The trader sells what it carries in the known town that pays most for it, then buys the good with the most profit
// between known towns that it can afford above its upkeep reserve and repair bill. With no such trade it drives to find a new town.
// Returns false when it has nothing to do: no affordable trade and every town known.
function trade(o: Orders): boolean {
  if (hasCargo(o.world, o.me) && !sellAtMarket(o)) return true;
  const buy = bestPurchase(o.world);
  if (buy) return buyThere(o, buy);
  const town = nearestUndiscovered(o.world, REGION.towns);
  if (!town) return false;
  driveToSite(o, town);
  return true;
}

function buyThere(o: Orders, buy: Purchase): true {
  if (townAt(o.world)?.id !== buy.town.id) driveToSite(o, buy.town);
  else o.run((w) => buyGood(w, buy.good, buy.count), 'goodsBought');
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
  const cargo = Object.entries(cargoForSale(world, playerVehicle(world)));
  const profit = (town: TownDef) => cargo.reduce((sum, [good, n]) => sum + n * (sellAt(world, town, good) - (world.player.costBasis[good] ?? 0)), 0);
  return byDistance(world, knownTowns(world)).reduce((best, town) => (profit(town) > profit(best) ? town : best));
}

// The money for a full repair stays out of the load, so a trader leaves town with a sound truck.
function bestPurchase(world: World): Purchase | null {
  const spend = world.player.money - getUpkeepReserve(playerVehicle(world)) - repairCost(world);
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
// salvage site. Returns false when it has nothing to do: no stock, no cargo and no site left to find. Stripping is as in
// sellCargo.
function scavenge(o: Orders, stripping: boolean): boolean {
  if (townAt(o.world) && hasCargo(o.world, o.me)) sellCargo(o, stripping);
  lootHere(o);
  const stock = freeCells(o.me) > 0 ? nearestStock(o.world, knownStocks(o.world)) : null;
  if (stock) visitStock(o, stock);
  else if (cargoToTown(o)) driveToSite(o, nearestTown(o.world));
  else return findSalvageSite(o);
  return true;
}

// Cargo still to take to town. In town the sale already sold what the bot would sell, and a field repairer keeps its
// repair parts.
function cargoToTown(o: Orders): boolean {
  return hasCargo(o.world, o.me) && !townAt(o.world);
}

function findSalvageSite(o: Orders): boolean {
  const site = nearestUndiscovered(o.world, REGION.locations.filter((l) => l.kind === 'convoy' || l.kind === 'landmark'));
  if (!site) return false;
  driveToSite(o, site);
  return true;
}

// The hunter strips a knocked-out truck it sees of its parts and goods. It drives at the weakest hostile it sees and
// demands it stand down once it is badly broken. With no foe in sight it follows the nearest it hears, loots the wrecks
// it sees, sells in town when full and otherwise patrols the roads between the shops. While no raider in the world is weak enough to
// hunt, it scavenges instead, as a player too weak to hunt does.
function hunterGoal(o: Orders): void {
  // Without a working gun it scavenges, which needs no money, until a town sells it one it can pay for.
  if (firepower(o.world, o.me) === 0) return scavengerGoal(o);
  if (townAt(o.world) && hasCargo(o.world, o.me)) sellCargo(o, true);
  takeBounties(o);
  if (stripDowned(o) || engageFoe(o)) return;
  lootHere(o);
  scavengeOrHunt(o);
}

function scavengeOrHunt(o: Orders): void {
  if (huntedSpeed(o.world) === undefined && scavenge(o, true)) return;
  collectOrHunt(o);
}

// A raider kill pays its bounty besides the wreck's loot, so the hunter takes each bounty on the board it is parked
// at, one per raider template, up to the contract limit.
function takeBounties(o: Orders): void {
  const shop = shopAt(o.world);
  if (!shop) return;
  for (const c of shopState(o.world, shop).contracts) if (wantsBounty(o.world, c)) o.run((w) => acceptContract(w, c.id));
}

function wantsBounty(world: World, c: Contract): boolean {
  const held = world.player.contracts;
  if (c.kind !== 'bounty' || c.deadline <= world.turn || held.length >= CONTRACTS.maxActive) return false;
  if (held.some((h) => h.kind === 'bounty' && h.template === c.template)) return false;
  // Any truck of the template ends the bounty, so the weakest one the world holds is the one to judge.
  return world.vehicles.some((v) => v.brain?.templateId === c.template && !isKnockedOut(v) && huntable(world, v));
}

// Demands the weakest foe in sight stand down when it is broken, or else drives at it, or at the nearest one heard. A
// foe in sight more dangerous than the bot is left alone, as defend leaves it. True when this turn's command went to a
// foe.
function engageFoe(o: Orders): boolean {
  const seen = weakestFoe(o.world);
  if (seen) return engageSeen(o, seen);
  const heard = heardFoe(o.world, (v) => huntable(o.world, v) && !campGunning(o.me, v.pos));
  if (heard) driveTo(o, heard);
  return heard !== null;
}

// A hunter picks a fight only against a foe this many times less dangerous than itself. In the snowball runs, fights
// below a ratio of 2 cost about 700 net worth each, and fights at 4 or more cost next to nothing. A foe it will not
// fight it outruns, as a player does.
const HUNT_MARGIN = 4;

// Whether the hunter would fight the foe even if it read the foe at its worst: the foe and its faction mates near it,
// each at the top of the error a sighting rolls. A heard foe is chased only when it passes, so a sighting never turns
// the hunter away from a foe it drove at, which sent it round a strong raider for 100 turns. The bot keeps no memory,
// so the same judgement of the same foe holds on every turn.
function huntable(world: World, foe: Vehicle): boolean {
  const group = world.vehicles.filter((v) => v.id === foe.id || (v.faction === foe.faction && !isKnockedOut(v) && dist(v.pos, foe.pos) <= SPAWN.neighborHelp));
  const danger = group.reduce((sum, v) => sum + vehicleDanger(world, v), 0) * (1 + NPC_BEHAVIOR.dangerSpread);
  return danger * HUNT_MARGIN <= ownDanger(world, playerVehicle(world));
}

function engageSeen(o: Orders, foe: Vehicle): boolean {
  if (dangerOf(o.world, foe) * HUNT_MARGIN > ownDanger(o.world, o.me) || !isSoftTarget(o.world, foe) || campGunning(o.me, foe.pos)) return false;
  setFire(o, true);
  aimGuns(o, foe);
  if (!demandYield(o, foe)) driveTo(o, foe.pos);
  return true;
}

// ---- Stripping knocked-out trucks.

// The best thing on a knocked-out truck that the bot can take and has room for: parts first by value, then goods.
function nextLoot(me: Vehicle, target: Vehicle): { item: GridItem; spot: Spot } | null {
  const worth = (it: GridItem) => (it.kind === 'part' ? partValue(it.part) : 0);
  for (const item of [...target.items].sort((a, b) => worth(b) - worth(a))) {
    const spot = takeError(target, item) === null ? stowSpot(me, item) : null;
    if (spot) return { item, spot };
  }
  return null;
}

// A refit job cannot start in combat, and one truck loots a wreck at a time.
function canStripNow(o: Orders, target: Vehicle): boolean {
  return !inCombat(o.world, o.me) && !lootBlocker(o.world, o.me, target.id);
}

// Takes one item from the knocked-out truck beside it, or drives beside the nearest one in sight that has loot to take.
// True when this turn's command went to the strip.
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

// ---- Foes.

// The hostile truck it sees with the least danger, as the bot reads it. Reading danger rolls world randomness, so the
// roll is put back and the bot never shifts the NPCs' draws.
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
  const rng = world.rngState;
  const danger = perceiveDanger(world, playerVehicle(world), foe);
  world.rngState = rng;
  return danger;
}

// A bot under fire turns on a foe it judges no more dangerous than itself, as an NPC does, so its guns bear. From a
// stronger foe it runs as an NPC runs: for the nearest town away from the threat, where guards cover it. Only the
// hunter fights a foe it can outrun: a won fight still costs repairs, and broken wheels leave the truck for the next
// raider. A foe that drops out of sight for a turn is still on its tail, so the bot keeps running until the combat
// ends. The hunter instead follows its goal, which chases the foe it hears. True when the turn's command went to the
// fight.
function defend(o: Orders, goal: Goal): boolean {
  if (!inCombat(o.world, o.me)) return false;
  const foe = weakestFoe(o.world);
  if (!foe && goal === 'hunter') return false;
  if (foe && fights(o, foe, goal)) charge(o, foe, goal);
  else flee(o);
  return true;
}

// The nearest town whose direction is more than 90 degrees off the threat's, else straight away from the threat, as
// fleeDestination() in npc-activities.ts picks for an NPC. The threat is the nearest hostile in sight, else the nearest
// one heard. With no threat placed, it keeps running where it runs, since the nearest town may lie behind the foe it
// lost sight of. With no run under way either, the nearest town.
function flee(o: Orders): void {
  const seen = nearestVehicle(o.me.pos, seenHostiles(o.world));
  const threat = seen?.pos ?? heardFoe(o.world);
  if (!threat) return o.me.order ? undefined : driveToSite(o, nearestTown(o.world));
  const safe = REGION.towns.filter((town) => pointsAway(o.me.pos, town.pos, threat)).sort((a, b) => dist(o.me.pos, a.pos) - dist(o.me.pos, b.pos));
  if (safe[0]) return driveToSite(o, safe[0]);
  const away = { x: o.me.pos.x + (o.me.pos.x - threat.x), y: o.me.pos.y + (o.me.pos.y - threat.y) };
  driveTo(o, { x: clamp(away.x, 1, o.world.size - 1), y: clamp(away.y, 1, o.world.size - 1) });
}

// Drives at the foe. A hunter also aims its guns at the foe's critical parts.
function charge(o: Orders, foe: Vehicle, goal: Goal): void {
  if (goal === 'hunter') aimGuns(o, foe);
  driveTo(o, foe.pos);
}

function fights(o: Orders, foe: Vehicle, goal: Goal): boolean {
  const margin = goal === 'hunter' ? HUNT_MARGIN : 1;
  return dangerOf(o.world, foe) * margin <= ownDanger(o.world, o.me) && (goal === 'hunter' || !outruns(o.world, o.me, foe));
}

// A foe the bot can neither beat nor outrun takes the cargo anyway, and the gear with it after a knockout.
function outmatchedBy(world: World, foe: Vehicle): boolean {
  return dangerOf(world, foe) > ownDanger(world, playerVehicle(world)) && !outruns(world, playerVehicle(world), foe);
}

function outruns(world: World, me: Vehicle, foe: Vehicle): boolean {
  return currentTopSpeed(world, me) > currentTopSpeed(world, foe);
}

// The top speed the truck can reach as it stands, after damage. A stranded truck, with no engine, a broken
// transmission or a dry tank, only crawls.
function currentTopSpeed(world: World, v: Vehicle): number {
  const stats = vehicleStats(world, v);
  return isStranded(world, v) ? Math.min(stats.maxSpeed, stats.limpSpeed) : stats.maxSpeed;
}

// Calls a badly broken foe in sight and demands it stand down, once. A foe that agrees is knocked out where it stands
// and stripped like any knocked-out truck. True when the call was made.
function demandYield(o: Orders, foe: Vehicle): boolean {
  const asks = foe.brain !== null && isHostile(o.world, foe, o.me) && isWeak(o.world, foe) && !offeredSurrenderBy(o.world, foe, o.me);
  if (!asks) return false;
  o.run((w) => callVehicle(w, foe.id));
  const ask = currentOptions(o.world).findIndex((option) => option.text === TOPICS.yieldDemand.ask?.text);
  if (ask >= 0) o.run((w) => chooseOption(w, ask));
  answerCall(o, HUNTER_REPLIES);
  return true;
}

// Where an unseen hostile is: the center of its contact circle. Nearest first.
function heardFoe(world: World, wanted: (v: Vehicle) => boolean = () => true): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v) && wanted(v));
  return nearest(me.pos, world.player.contacts.filter((c) => hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center));
}

function nearestVehicle(from: Vec, vehicles: readonly Vehicle[]): Vehicle | null {
  return vehicles.reduce<Vehicle | null>((best, v) => (!best || dist(from, v.pos) < dist(from, best.pos) ? v : best), null);
}

// With a full grid the hunter drives to town to sell, unless it stands in town already or holds nothing to sell. Then
// the sale is done and it goes on with the hunt, since waiting frees no cell.
function collectOrHunt(o: Orders): void {
  if (freeCells(o.me) === 0) {
    if (townAt(o.world) || !hasCargo(o.world, o.me)) return hunt(o);
    return driveToSite(o, nearestTown(o.world));
  }
  const wreck = nearestStock(o.world, knownStocks(o.world).filter((s) => s.id.startsWith('wreck-') && playerSees(o.world, s.pos)));
  if (wreck) return visitStock(o, wreck);
  hunt(o);
}

// A place on the hunter's patrol: a shop, reached at its nearest pad, or a point on the road out of a raider camp.
type Post = { pos: Vec; shop: Site | null };

// A camp's gate guns shoot every outsider in range, so the hunter waits for raiders leaving it half a gun range
// beyond that, on the line to the nearest shop.
const CAMP_STANDOFF = RULES.guards.range * 1.5;

// The camp posts, each with the shop nearest to its gate.
function campPosts(): { post: Post; near: Site }[] {
  return REGION.locations.filter((l) => l.kind === 'camp').flatMap((camp) => siteGates(camp).map((gate) => {
    const near = SHOP_SITES.reduce((best, s) => (dist(gate, s.pos) < dist(gate, best.pos) ? s : best));
    const gap = dist(gate, near.pos);
    const at = { x: gate.x + ((near.pos.x - gate.x) / gap) * CAMP_STANDOFF, y: gate.y + ((near.pos.y - gate.y) / gap) * CAMP_STANDOFF };
    return { post: { pos: at, shop: null }, near };
  }));
}

// Each shop, then the camp posts whose nearest shop it is, in data order.
const PATROL: readonly Post[] = SHOP_SITES.flatMap((s) => [{ pos: s.pos, shop: s }, ...campPosts().filter((c) => c.near === s).map((c) => c.post)]);

function postDests(post: Post): Vec[] {
  return post.shop ? sitePads(post.shop) : [post.pos];
}

// The hunter patrols the shops and the roads out of the raider camps, where lone raiders prey on traders. It keeps
// driving to the post it is bound for. Without one, it goes to the post after the one nearest it.
function hunt(o: Orders): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && PATROL.some((p) => postDests(p).some((d) => d.x === order.dest.x && d.y === order.dest.y))) return;
  const here = PATROL.reduce((best, p, i) => (dist(o.me.pos, p.pos) < dist(o.me.pos, PATROL[best].pos) ? i : best), 0);
  const next = PATROL[(here + 1) % PATROL.length];
  driveTo(o, next.shop ? nearestPad(next.shop, o.me.pos) : next.pos);
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
  o.run((w) => takeAllLoot(w, stock.id));
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

// ---- Cargo.

// Goods to sell: all but the parts kept for field repairs, as an NPC keeps them, and the goods of a haul contract.
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

// Sells the goods for sale and the spare parts. Every shop buys both. A field repairer with stripping on keeps its
// repair parts and strips its spares instead of selling them. A bot that needs the money now sells everything.
function sellCargo(o: Orders, stripping = false): void {
  const keep = stripping && o.fieldRepair;
  for (const [good, n] of Object.entries(cargoForSale(o.world, o.me))) if (!keep || good !== 'parts') o.run((w) => sellGood(w, good, n), 'goodsSold');
  sellSpares(o, keep);
}

function sellSpares(o: Orders, keep: boolean): void {
  for (const { partId } of spareItems(o.me)) if (!(keep && stripForRepair(o, partId))) o.run((w) => sellPart(w, partId), 'lootSales');
}

// A field repairer turns a spare part into repair parts, one strip at a time, while the truck has room for the yield
// and no strip is running. The strip job holds the truck, so the bot sells the other spares on later visits.
function stripForRepair(o: Orders, partId: string): boolean {
  if (o.me.job) return true;
  if (!canStrip(o, partId)) return false;
  o.run((w) => startStrip(w, partId));
  return true;
}

function canStrip(o: Orders, partId: string): boolean {
  const item = o.me.items.find((it) => it.kind === 'part' && it.part.id === partId);
  return item?.kind === 'part' && !inCombat(o.world, o.me) && freeCells(o.me) >= stripYield(item.part);
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
