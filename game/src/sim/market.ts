// Shops: goods price pressure, finite random part stock and contract boards. Pure functions on an
// explicit ShopState.
// IV1: every price here derives from a good's base value through goodBasePrice/goodPrice.
// IV5: stock is finite; takeStockPart removes, addStockPart adds.
// IV6: stock, restock and contract rolls draw only from world.marketRng, the market's own stream in
// the world, so they replay from the seed without shifting the main stream combat and NPCs use.
// IV7: recordTrade is the one place pressure moves, for player and NPC trades alike.

import { ECONOMY, GOODS } from '../data/goods';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { CONTRACTS, DISTANCE_PREMIUM, EFFORT, GOOD_SOURCES, PRESSURE_MAX, SHOPS, shopDef, type ShopDef, type Tier } from '../data/market';
import { chassisDef } from '../data/chassis';
import { makePart, newId } from './factory';
import { sampleWeighted } from './npc-loadout';
import { playerVehicle } from './damage';
import { freeCells, goodsCount } from './grid';
import { addGoods, removeGoods, spareParts } from './inventory';
import { practice } from './progress';
import { chance, randInt, type Rng } from './rng';
import { canUseSite, type Site } from './sites';
import { playerCommand } from './world';
import type { PartInstance, Vehicle, World } from './types';
import { isJunk, partValue } from './wear';
import { dist, type Vec } from './vec';

export type ShopState = {
  contracts: Contract[]; // offers on the board, not yet taken
  pressure: Record<string, number>; // good id -> signed fraction of base price, clamped to PRESSURE_MAX
  stock: PartInstance[];
  restockAt: number; // world.turn at which the shop next restocks
};

// A good's base value before any shop's make/need profile or pressure. GOODS has no `value` field
// yet (PH2 adds one to GoodDef); GOOD_VALUE in src/data/shops.ts stands in until then. This is the
// only function that reads either source, so the switch to a real field touches one place.
export function goodValue(good: string): number {
  const def = GOODS[good];
  if (!def) throw new Error(`Unknown good ${good}`);
  return def.value;
}

function rollStock(world: World, def: ShopDef, count: number): PartInstance[] {
  const stock: PartInstance[] = [];
  for (let i = 0; i < count; i++) {
    const defId = sampleWeighted(world.marketRng, def.partStock.parts);
    const wear = sampleWeighted(world.marketRng, def.partStock.wear);
    if (!Number.isInteger(wear) || wear < 0 || wear > CONDITION.maxWear) {
      throw new Error(`Shop ${def.id} rolled a bad wear step ${wear} for ${defId}`);
    }
    stock.push(makePart(world, defId, wear));
  }
  return stock;
}

// Rolls a shop's opening stock and sets its first restock turn. Called once per shop at world
// creation by the phase that wires World.shops.
export function initShop(world: World, shopId: string): ShopState {
  const def = shopDef(shopId);
  const pressure: Record<string, number> = {};
  for (const good of def.goods) pressure[good] = 0;
  const count = randInt(world.marketRng, def.stockSize[0], def.stockSize[1]);
  return { contracts: [], pressure, stock: rollStock(world, def, count), restockAt: world.turn + def.restockTurns };
}

// Drifts pressure back toward 0 every turn, and replaces the whole stock on restock. Restocking
// keeps nothing of the old stock: the simplest rule, and it matches a shop taking in a fresh haul
// rather than the same shelf slowly refilling.
export function advanceShop(world: World, shopId: string, state: ShopState): void {
  const def = shopDef(shopId);
  for (const good of def.goods) state.pressure[good] = (state.pressure[good] ?? 0) * (1 - def.driftPerTurn);
  if (world.turn >= state.restockAt) {
    const count = randInt(world.marketRng, def.stockSize[0], def.stockSize[1]);
    state.stock = rollStock(world, def, count);
    state.restockAt = world.turn + def.restockTurns;
  }
}

// Straight distance from a shop to the nearest other shop that makes the good, or to the nearest
// source site in GOOD_SOURCES, so a haul's pay follows the miles it actually takes to move a good to
// where nobody makes it. Throws if the good has neither, since then no price for it could ever be
// grounded in a maker.
function nearestMakerDistance(shopId: string, good: string): number {
  const makers = Object.values(SHOPS).filter((s) => s.id !== shopId && s.makes.includes(good)).map((s) => s.id);
  const origins = [...makers, ...(GOOD_SOURCES[good] ?? [])];
  if (origins.length === 0) throw new Error(`No shop or source site makes ${good}`);
  return Math.min(...origins.map((id) => dist(shopPos(shopId), siteOf(id).pos)));
}

function priceFactorFor(def: ShopDef, good: string): number {
  if (def.makes.includes(good)) return def.priceFactor.make;
  return def.priceFactor.make + DISTANCE_PREMIUM.perTile * nearestMakerDistance(def.id, good);
}

// A good's price at a shop before pressure and spread: its base value times a factor that sits near
// `make` at a shop that makes it, and climbs with distance to the nearest maker anywhere else. Throws
// if the shop does not trade the good.
export function goodBasePrice(shopId: string, good: string): number {
  const def = shopDef(shopId);
  if (!def.goods.includes(good)) throw new Error(`${shopId} does not trade ${good}`);
  return goodValue(good) * priceFactorFor(def, good);
}

// A good's price at a shop at a given standing pressure, before spread.
export function standingPrice(shopId: string, good: string, pressure: number): number {
  return goodBasePrice(shopId, good) * (1 + pressure);
}

// The buy or sell price of one unit at a given standing pressure, from the good's base price and a
// spread fraction applied on top (buy up, sell down). Sell always rounds to strictly below buy (IV4).
export function priceAtPressure(shopId: string, good: string, pressure: number, direction: 'buy' | 'sell', spread: number): number {
  if (!(spread >= 0)) throw new Error(`Bad spread ${spread}`);
  const pressured = standingPrice(shopId, good, pressure);
  const buy = Math.max(1, Math.ceil(pressured * (1 + spread)));
  const sell = Math.min(buy - 1, Math.floor(pressured * (1 - spread)));
  return direction === 'buy' ? buy : Math.max(0, sell);
}

// The buy or sell price of one unit at a shop's standing pressure (IV1).
export function goodPrice(shopId: string, state: ShopState, good: string, direction: 'buy' | 'sell', spread: number): number {
  return priceAtPressure(shopId, good, state.pressure[good] ?? 0, direction, spread);
}

// The price of a whole lot: each unit priced at the pressure left by the unit before it, so a lot
// price always equals the sum of trading the same units one at a time. A round trip through
// tradeGoods, which prices every unit this way and moves pressure only after the whole lot, can
// never turn a profit at one shop.
export function lotPrice(shopId: string, state: ShopState, good: string, direction: 'buy' | 'sell', spread: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`Bad lot count ${count}`);
  const perUnit = shopDef(shopId).pressurePerUnit * (direction === 'buy' ? 1 : -1);
  let pressure = state.pressure[good] ?? 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += priceAtPressure(shopId, good, pressure, direction, spread);
    pressure = Math.max(-PRESSURE_MAX, Math.min(PRESSURE_MAX, pressure + perUnit));
  }
  return total;
}

// Moves standing pressure by the shop's pressurePerUnit per unit traded, clamped to PRESSURE_MAX
// either side of base price. Buying raises price, selling lowers it. The one function player and
// NPC trades both call, so both move prices the same way (IV7).
export function recordTrade(shopId: string, state: ShopState, good: string, units: number, direction: 'buy' | 'sell'): void {
  const def = shopDef(shopId);
  if (!def.goods.includes(good)) throw new Error(`${shopId} does not trade ${good}`);
  if (!(units >= 0)) throw new Error(`Bad trade unit count ${units}`);
  const delta = def.pressurePerUnit * units * (direction === 'buy' ? 1 : -1);
  const next = (state.pressure[good] ?? 0) + delta;
  state.pressure[good] = Math.max(-PRESSURE_MAX, Math.min(PRESSURE_MAX, next));
}

// Removes and returns a stocked part. Throws if the shop has none with that id (IV5).
export function takeStockPart(state: ShopState, partId: string): PartInstance {
  const index = state.stock.findIndex((part) => part.id === partId);
  if (index < 0) throw new Error(`No part ${partId} in stock`);
  const [part] = state.stock.splice(index, 1);
  return part;
}

// Adds a part to stock, as when a shop buys a spare from a seller (IV5).
export function addStockPart(state: ShopState, part: PartInstance): void {
  state.stock.push(part);
}

// Contracts. Shops post them; rewards follow the effort model.

// `window` is the turns a contract allows from acceptance. `deadline` is the withdrawal turn while
// the offer is posted and the due turn once it is held. A bounty's `fulfilled` is true once the
// player beat a truck of its template; a fulfilled bounty ignores its deadline until it is claimed.
export type Contract =
  | { id: string; shop: string; kind: 'haul'; good: string; units: number; to: string; reward: number; deadline: number; window: number; rush: boolean; tier: Tier }
  | { id: string; shop: string; kind: 'fetch'; defId: string; reward: number; deadline: number; window: number; tier: Tier }
  | { id: string; shop: string; kind: 'bounty'; template: string; targetName: string; reward: number; deadline: number; window: number; tier: Tier; fulfilled: boolean };

// Estimated turns to travel between two points: straight distance stretched to a road-like route,
// at cruise speed, plus the turns spent handling the stop.
export function estimateTurns(from: Vec, to: Vec): number {
  return (dist(from, to) * EFFORT.routeFactor) / EFFORT.refSpeed + EFFORT.handlingTurns;
}

// A haul's reward: turns of estimated travel at the good's tier wage, times the haul's reward
// factor, plus a small cut of the hauled goods' value. A rush haul pays the rush premium on top.
export function contractReward(turns: number, tier: Tier, cargoValue: number, rush: boolean): number {
  const commission = cargoValue * CONTRACTS.haul.valueShare;
  const standard = turns * EFFORT.wage[tier] * CONTRACTS.haul.rewardFactor + commission;
  return Math.round(rush ? standard * CONTRACTS.haul.rush.premium : standard);
}

// Turns a haul allows from acceptance.
export function haulWindow(turns: number, rush: boolean): number {
  return Math.round(turns * (rush ? CONTRACTS.haul.rush.durationFactor : CONTRACTS.haul.durationFactor));
}

// A vehicle's total worth: its chassis value plus every part it carries, mounted or spare, at each
// part's own current worth (junk counts at scrap value only).
export function vehicleValue(v: Vehicle): number {
  const parts = v.items.flatMap((it) => (it.kind === 'part' ? [it.part] : []));
  return chassisDef(v.chassisId).value + parts.reduce((a, p) => a + partValue(p), 0);
}

// What a robber gets without a refit: the goods at their price plus the spare parts at their worth.
// Mounted parts are the truck, not the load.
export function cargoValue(v: Vehicle): number {
  const goods = Object.entries(goodsCount(v)).reduce((a, [good, n]) => a + n * goodValue(good), 0);
  return goods + spareParts(v).reduce((a, p) => a + partValue(p), 0);
}

// A bounty's reward: a share of the target's own total worth, so a tougher, better-equipped truck
// pays more to put down. The deadline window is random and does not change the pay.
export function bountyReward(target: Vehicle): number {
  return Math.round(vehicleValue(target) * CONTRACTS.bounty.valueShare);
}

// The pristine buy price of a part def: its base value plus the shop spread, ignoring wear. A fetch
// reward is priced off this, not off any one stocked instance, since the contract does not name a
// condition.
export function partPristineBuyPrice(defId: string): number {
  return Math.round(PARTS[defId].value * (1 + ECONOMY.spread));
}

// A fetch's reward: the part's own pristine buy price, plus a flat search fee of turns at the
// fetch's tier wage. So the reward always covers the part's cost, whatever the part.
export function fetchReward(defId: string, tier: Tier): number {
  return partPristineBuyPrice(defId) + Math.round(CONTRACTS.fetch.searchFeeTurns * EFFORT.wage[tier]);
}

// Highest tier among a truck's mounted or spare non-core parts. A bare truck with none carries the
// lowest tier: there is nothing riskier to name on its bounty.
function highestPartTier(v: Vehicle): Tier {
  const tiers = v.items.flatMap((it) => (it.kind === 'part' && PARTS[it.part.defId].kind !== 'core' ? [PARTS[it.part.defId].tier] : []));
  return tiers.length ? (Math.max(...tiers) as Tier) : 1;
}

type RollInput = {
  shop: { id: string; pos: Vec };
  places: { id: string; pos: Vec }[];
  goods: string[];
  partDefIds: string[];
  raiders: Vehicle[];
};

function pick<T>(world: World, list: T[]): T {
  return list[randInt(world.marketRng, 0, list.length - 1)];
}

function possibleKinds(input: RollInput): Contract['kind'][] {
  const kinds: Contract['kind'][] = [];
  if (input.places.length > 0 && input.goods.length > 0) kinds.push('haul');
  if (input.partDefIds.length > 0) kinds.push('fetch');
  if (input.raiders.length > 0) kinds.push('bounty');
  return kinds;
}

// Tier follows the content on offer, not a random roll: a haul takes the good's own tier, a fetch
// the part's own tier, and a bounty the highest tier fitted to its target.

function rollHaul(world: World, input: RollInput, id: string): Contract {
  const to = pick(world, input.places);
  const good = pick(world, input.goods);
  const tier = GOODS[good].tier;
  const units = randInt(world.marketRng, CONTRACTS.haul.units[0], CONTRACTS.haul.units[1]);
  const turns = estimateTurns(input.shop.pos, to.pos);
  const rush = chance(world.marketRng, CONTRACTS.haul.rush.chance);
  const reward = contractReward(turns, tier, units * goodValue(good), rush);
  const window = haulWindow(turns, rush);
  return { id, shop: input.shop.id, kind: 'haul', good, units, to: to.id, reward, deadline: world.turn + window, window, rush, tier };
}

function rollFetch(world: World, input: RollInput, id: string): Contract {
  const defId = pick(world, input.partDefIds);
  const tier = PARTS[defId].tier;
  const turns = randInt(world.marketRng, CONTRACTS.fetch.durationTurns[0], CONTRACTS.fetch.durationTurns[1]);
  const reward = fetchReward(defId, tier);
  return { id, shop: input.shop.id, kind: 'fetch', defId, reward, deadline: world.turn + turns, window: turns, tier };
}

function rollBounty(world: World, input: RollInput, id: string): Contract {
  const target = pick(world, input.raiders);
  if (!target.brain) throw new Error(`Raider ${target.id} has no brain`);
  const tier = highestPartTier(target);
  const turns = randInt(world.marketRng, CONTRACTS.bounty.durationTurns[0], CONTRACTS.bounty.durationTurns[1]);
  const reward = bountyReward(target);
  return { id, shop: input.shop.id, kind: 'bounty', template: target.brain.templateId, targetName: target.name, reward, deadline: world.turn + turns, window: turns, tier, fulfilled: false };
}

const ROLLS = { haul: rollHaul, fetch: rollFetch, bounty: rollBounty };

// Draws one contract for a shop, from the kinds it can currently offer. A kind with nothing to draw
// from (no other places for a haul, no part defs for a fetch, no living raiders for a bounty) is
// skipped. Returns null when no kind is possible.
export function rollContract(
  world: World,
  shop: { id: string; pos: Vec },
  places: { id: string; pos: Vec }[],
  goods: string[],
  partDefIds: string[],
  raiders: Vehicle[],
): Contract | null {
  const input = { shop, places, goods, partDefIds, raiders };
  const kinds = possibleKinds(input);
  if (kinds.length === 0) return null;
  const kind = pick(world, kinds);
  return ROLLS[kind](world, input, newId(world, 'ct'));
}

export function isExpired(world: World, c: Contract): boolean {
  return world.turn > c.deadline;
}

// The templates of trucks the player destroyed or knocked out this turn. Any such truck counts for a bounty.
export function beatenTemplates(world: World): Set<string> {
  const beaten = new Set(world.events.flatMap((e) => ((e.t === 'destroyed' || e.t === 'npcKnockout') && e.by === world.player.vehicleId ? [e.vehicle] : [])));
  const templates = new Set<string>();
  if (beaten.size === 0) return templates;
  for (const v of [...world.removed, ...world.vehicles]) if (v.brain && beaten.has(v.id)) templates.add(v.brain.templateId);
  return templates;
}

// Marks the first held bounty on the template that is not yet fulfilled. It pays nothing: the player claims the
// reward at the shop that posted the bounty. The only writer of `fulfilled = true`.
export function fulfilBounty(world: World, template: string): void {
  const c = world.player.contracts.find((x): x is Extract<Contract, { kind: 'bounty' }> => x.kind === 'bounty' && x.template === template && !x.fulfilled);
  if (!c) return;
  c.fulfilled = true;
  world.events.push({ t: 'contract', contract: { ...c }, outcome: 'fulfilled' });
}

// A truck that gives up to the player counts as beaten: it fulfils one held bounty on its template, as a knockout
// does. Called outside the turn's event scan, since a dialogue command clears the events.
export function creditBounty(world: World, npc: Vehicle): void {
  if (!npc.brain) throw new Error(`${npc.id} has no driver to name in a bounty`);
  fulfilBounty(world, npc.brain.templateId);
}

// True once no truck of the bounty's template is left in the world. The caller skips fulfilled bounties, and
// fulfils this turn's bounties first, so a kill of the last truck of a template still counts.
export function bountyLapsed(world: World, c: Contract): boolean {
  if (c.kind !== 'bounty') throw new Error(`${c.kind} contract has no bounty target`);
  return !world.vehicles.some((v) => v.brain?.templateId === c.template);
}

// Owed share of the haul's goods value if its deadline passes.
export function haulPenalty(c: Extract<Contract, { kind: 'haul' }>, goodValue: number): number {
  return Math.round(c.units * goodValue * CONTRACTS.haul.penaltyShare);
}

// World wiring: every shop's state lives in world.shops, keyed by shop id.

function shopPos(shopId: string): Vec {
  return siteOf(shopId).pos;
}

export function shopState(world: World, shopId: string): ShopState {
  const state = world.shops[shopId];
  if (!state) throw new Error(`Unknown shop ${shopId}`);
  return state;
}

// A copy of a shop's standing pressure for every good it trades, read as goodPrice() reads it.
export function standingPressures(world: World, shopId: string): Record<string, number> {
  const live = shopState(world, shopId).pressure;
  return Object.fromEntries(shopDef(shopId).goods.map((good) => [good, live[good] ?? 0]));
}

// Tops a shop's board up to its contract slots. Haul targets are the other shops that trade the good.
// A fetch never asks for a part the shop has in stock. A board never names the same bounty template
// twice: raiders already posted on this board are dropped before each roll, so one kill can never be
// asked for by two offers on the same board.
function fillBoard(world: World, shopId: string, state: ShopState): void {
  const def = shopDef(shopId);
  const places = Object.keys(SHOPS).filter((id) => id !== shopId).map((id) => ({ id, pos: shopPos(id) }));
  const stocked = new Set(state.stock.map((p) => p.defId));
  const partDefIds = Object.keys(PARTS).filter((id) => PARTS[id].kind !== 'core' && !stocked.has(id));
  while (state.contracts.length < def.contractSlots) {
    const postedTemplates = new Set(state.contracts.filter((c) => c.kind === 'bounty').map((c) => c.template));
    const raiders = world.vehicles.filter((v) => v.faction === 'raiders' && v.brain && !postedTemplates.has(v.brain.templateId));
    const contract = rollContract(world, { id: shopId, pos: shopPos(shopId) }, places, def.goods, partDefIds, raiders);
    if (!contract) return;
    state.contracts.push(contract);
  }
}

// The market stream starts from the world seed mixed with a fixed salt, so it differs from the main stream.
const MARKET_SALT = 0x6d61726b;

export function marketStream(seed: number): Rng {
  return { rngState: seed ^ MARKET_SALT };
}

export function initializeShops(world: World): void {
  world.shops = {};
  for (const shopId of Object.keys(SHOPS)) {
    const state = initShop(world, shopId);
    world.shops[shopId] = state;
    fillBoard(world, shopId, state);
  }
}

// Drift and restock every shop. Expired offers drop from every board every turn, so an accepted
// offer is never past its deadline. A restock also drops offers whose target has lapsed and refills
// the board.
export function advanceShops(world: World): void {
  for (const [shopId, state] of Object.entries(world.shops)) {
    const restockAt = state.restockAt;
    advanceShop(world, shopId, state);
    state.contracts = state.contracts.filter((c) => !isExpired(world, c));
    if (state.restockAt === restockAt) continue;
    state.contracts = state.contracts.filter((c) => offerStillValid(world, c));
    fillBoard(world, shopId, state);
  }
}

function offerStillValid(world: World, c: Contract): boolean {
  return c.kind !== 'bounty' || !bountyLapsed(world, c);
}

// The shop the parked player truck can use, or null.
export function shopAt(world: World): string | null {
  return playerVehicle(world).speed > RULES.parkedSpeed ? null : shopNear(world);
}

// The shop in reach of the player truck at any speed, or null.
export function shopNear(world: World): string | null {
  const pos = playerVehicle(world).pos;
  return Object.keys(SHOPS).find((id) => canUseSite(pos, siteOf(id))) ?? null;
}

export function siteOf(siteId: string): Site {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === siteId);
  if (!site) throw new Error(`No site ${siteId} in the region`);
  return site;
}

function requireShop(world: World, shopId: string): void {
  if (shopAt(world) !== shopId) throw new Error(`Not parked at ${shopId}`);
}

// Takes an offer from the board of the shop the player is parked at. A haul loads its goods now.
export function acceptContract(world: World, contractId: string): World {
  return playerCommand(world, (w) => {
    const shopId = shopAt(w);
    if (!shopId) throw new Error('Not parked at a shop');
    const board = shopState(w, shopId).contracts;
    const contract = board.find((c) => c.id === contractId);
    if (!contract) throw new Error(`No contract ${contractId} at ${shopId}`);
    if (isExpired(w, contract)) throw new Error(`Offer ${contractId} has expired`);
    if (w.player.contracts.length >= CONTRACTS.maxActive) throw new Error(`You already hold ${CONTRACTS.maxActive} contracts`);
    if (contract.kind === 'haul') loadHaul(w, contract);
    contract.deadline = w.turn + contract.window;
    board.splice(board.indexOf(contract), 1);
    w.player.contracts.push(contract);
    w.events.push({ t: 'contract', contract: { ...contract }, outcome: 'accepted' });
  });
}

// A haul loads its goods for free, so a player in debt could otherwise stock up on cargo it never
// paid for. Refused outright: pay off the debt before taking on more work.
// Hauled goods count as paid at the value a missed deadline charges, so selling them teaches no trade.
function loadHaul(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  if (world.player.money < 0) throw new Error('Cannot take on a haul while in debt');
  const v = playerVehicle(world);
  if (freeCells(v) < c.units) throw new Error(`Needs ${c.units} free cells for the cargo`);
  const held = goodsCount(v)[c.good] ?? 0;
  if (addGoods(world, v, c.good, c.units) !== c.units) throw new Error('Cargo capacity invariant failed');
  const paid = world.player.costBasis[c.good] ?? 0;
  world.player.costBasis[c.good] = (paid * held + goodValue(c.good) * c.units) / (held + c.units);
}

// Hands in a haul at its destination, and a fetch or a met bounty at the shop that posted it.
export function deliverContract(world: World, contractId: string): World {
  return playerCommand(world, (w) => {
    const contract = w.player.contracts.find((c) => c.id === contractId);
    if (!contract) throw new Error(`No active contract ${contractId}`);
    if (contract.kind === 'haul') handInHaul(w, contract);
    else if (contract.kind === 'fetch') handInFetch(w, contract);
    else handInBounty(w, contract);
    finishContract(w, contract, 'done');
  });
}

function handInBounty(world: World, c: Extract<Contract, { kind: 'bounty' }>): void {
  requireShop(world, c.shop);
  if (!c.fulfilled) throw new Error('The bounty is not met yet');
}

function handInHaul(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  requireShop(world, c.to);
  const v = playerVehicle(world);
  if ((goodsCount(v)[c.good] ?? 0) < c.units) throw new Error(`Needs ${c.units} ${GOODS[c.good].name}`);
  removeGoods(v, c.good, c.units);
}

// A fetch takes a part that still does its job: working, not junk, and rebuilt at most
// CONTRACTS.fetch.maxWear times.
export function fitsFetch(c: Extract<Contract, { kind: 'fetch' }>, p: PartInstance): boolean {
  return p.defId === c.defId && p.hp > 0 && !isJunk(p) && p.wear <= CONTRACTS.fetch.maxWear;
}

function handInFetch(world: World, c: Extract<Contract, { kind: 'fetch' }>): void {
  requireShop(world, c.shop);
  const v = playerVehicle(world);
  const spare = spareParts(v).find((p) => fitsFetch(c, p));
  if (spare) {
    v.items = v.items.filter((it) => it.kind !== 'part' || it.part.id !== spare.id);
    return;
  }
  const stored = world.player.storage.findIndex((p) => fitsFetch(c, p));
  if (stored < 0) throw new Error(`Needs a spare ${PARTS[c.defId].name}, working and rebuilt at most ${CONTRACTS.fetch.maxWear} time${CONTRACTS.fetch.maxWear === 1 ? '' : 's'}`);
  world.player.storage.splice(stored, 1);
}

// Social XP for a done contract, from the money that paid for work. A fetch's part price is a purchase, so only
// its search fee counts.
export function contractXp(c: Contract): number {
  const effort = c.kind === 'fetch' ? c.reward - partPristineBuyPrice(c.defId) : c.reward;
  return Math.round(effort * CONTRACTS[c.kind].xpPerEffort);
}

// Ends an active contract. Done pays the reward and the contract's XP to Social; failed charges the haul penalty, debt allowed.
function finishContract(world: World, c: Contract, outcome: 'done' | 'failed' | 'lapsed'): void {
  if (outcome !== 'done' && isMetBounty(c)) throw new Error(`A fulfilled bounty cannot be ${outcome}`);
  world.player.contracts = world.player.contracts.filter((x) => x.id !== c.id);
  world.events.push({ t: 'contract', contract: { ...c }, outcome });
  if (outcome === 'done') payContract(world, c);
  if (outcome === 'failed' && c.kind === 'haul') chargeHaulPenalty(world, c);
}

function payContract(world: World, c: Contract): void {
  world.player.money += c.reward;
  world.events.push({ t: 'money', amount: c.reward, reason: 'contract' });
  practice(world, 'contract', contractXp(c), null, c.shop);
}

function chargeHaulPenalty(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  const penalty = haulPenalty(c, goodValue(c.good));
  world.player.money -= penalty;
  world.events.push({ t: 'money', amount: -penalty, reason: 'failed haul contract' });
}

function isMetBounty(c: Contract): boolean {
  return c.kind === 'bounty' && c.fulfilled;
}

// Fulfils bounties from this turn's kills, then ends contracts past their deadline or target. One beaten
// template fulfils at most one held bounty, so one kill never meets several bounties on the same template.
// A fulfilled bounty is settled: it waits for its claim and never fails, lapses or warns.
export function advanceContracts(world: World): void {
  for (const template of beatenTemplates(world)) fulfilBounty(world, template);
  for (const c of world.player.contracts.filter((x) => !isMetBounty(x))) settleContract(world, c);
}

function settleContract(world: World, c: Contract): void {
  const outcome = contractOutcome(world, c);
  if (outcome) finishContract(world, c, outcome);
  else if (c.deadline - world.turn === CONTRACTS.warnTurns) world.events.push({ t: 'contract', contract: { ...c }, outcome: 'expiring' });
}

function contractOutcome(world: World, c: Contract): 'failed' | 'lapsed' | null {
  if (c.kind === 'bounty' && bountyLapsed(world, c)) return 'lapsed';
  return isExpired(world, c) ? 'failed' : null;
}
