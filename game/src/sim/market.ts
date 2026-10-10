// Shops: goods price pressure, finite random part stock and contract boards. Pure functions on an
// explicit ShopState.
// IV1: every price here derives from a good's base value through goodBasePrice/goodPrice.

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
import { isDefeated } from './defeat';
import { playerCommand } from './world';
import type { GameEvent, PartInstance, Vehicle, World } from './types';
import { isJunk, partValue } from './wear';
import { dist, type Vec } from './vec';

export type ShopState = {
  contracts: Contract[];
  pressure: Record<string, number>;
  stock: PartInstance[];
  restockAt: number;
};

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

export function initShop(world: World, shopId: string): ShopState {
  const def = shopDef(shopId);
  const pressure: Record<string, number> = {};
  for (const good of def.goods) pressure[good] = 0;
  const count = randInt(world.marketRng, def.stockSize[0], def.stockSize[1]);
  return { contracts: [], pressure, stock: rollStock(world, def, count), restockAt: world.turn + def.restockTurns };
}

export function advanceShop(world: World, shopId: string, state: ShopState): void {
  const def = shopDef(shopId);
  for (const good of def.goods) state.pressure[good] = (state.pressure[good] ?? 0) * (1 - def.driftPerTurn);
  if (world.turn >= state.restockAt) {
    const count = randInt(world.marketRng, def.stockSize[0], def.stockSize[1]);
    state.stock = rollStock(world, def, count);
    state.restockAt = world.turn + def.restockTurns;
  }
}

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

export function goodBasePrice(shopId: string, good: string): number {
  const def = shopDef(shopId);
  if (!def.goods.includes(good)) throw new Error(`${shopId} does not trade ${good}`);
  return goodValue(good) * priceFactorFor(def, good);
}

export function standingPrice(shopId: string, good: string, pressure: number): number {
  return goodBasePrice(shopId, good) * (1 + pressure);
}

export function priceAtPressure(shopId: string, good: string, pressure: number, direction: 'buy' | 'sell', spread: number): number {
  if (!(spread >= 0)) throw new Error(`Bad spread ${spread}`);
  const pressured = standingPrice(shopId, good, pressure);
  const buy = Math.max(1, Math.ceil(pressured * (1 + spread)));
  const sell = Math.min(buy - 1, Math.floor(pressured * (1 - spread)));
  return direction === 'buy' ? buy : Math.max(0, sell);
}

export function goodPrice(shopId: string, state: ShopState, good: string, direction: 'buy' | 'sell', spread: number): number {
  return priceAtPressure(shopId, good, state.pressure[good] ?? 0, direction, spread);
}

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

export function recordTrade(shopId: string, state: ShopState, good: string, units: number, direction: 'buy' | 'sell'): void {
  const def = shopDef(shopId);
  if (!def.goods.includes(good)) throw new Error(`${shopId} does not trade ${good}`);
  if (!(units >= 0)) throw new Error(`Bad trade unit count ${units}`);
  const delta = def.pressurePerUnit * units * (direction === 'buy' ? 1 : -1);
  const next = (state.pressure[good] ?? 0) + delta;
  state.pressure[good] = Math.max(-PRESSURE_MAX, Math.min(PRESSURE_MAX, next));
}

export function takeStockPart(state: ShopState, partId: string): PartInstance {
  const index = state.stock.findIndex((part) => part.id === partId);
  if (index < 0) throw new Error(`No part ${partId} in stock`);
  const [part] = state.stock.splice(index, 1);
  return part;
}

export function addStockPart(state: ShopState, part: PartInstance): void {
  state.stock.push(part);
}

export type Contract =
  | { id: string; shop: string; kind: 'haul'; good: string; units: number; to: string; reward: number; deadline: number; window: number; rush: boolean; tier: Tier }
  | { id: string; shop: string; kind: 'fetch'; defId: string; reward: number; deadline: number; window: number; tier: Tier }
  | { id: string; shop: string; kind: 'bounty'; template: string; reward: number; deadline: number; window: number; tier: Tier; fulfilled: boolean };

export function estimateTurns(from: Vec, to: Vec): number {
  return (dist(from, to) * EFFORT.routeFactor) / EFFORT.refSpeed + EFFORT.handlingTurns;
}

// A haul's reward: turns of estimated travel at the salvage wage, whatever the good, times the haul's
// reward factor, plus a small cut of the hauled goods' value. The good's value pays through the cut, not
// through a tier wage. A rush haul pays the rush premium on top.
export function contractReward(turns: number, cargoValue: number, rush: boolean): number {
  requireNonNegative('turns', turns);
  requireNonNegative('cargo value', cargoValue);
  const commission = cargoValue * CONTRACTS.haul.valueShare;
  const standard = turns * EFFORT.wage[1] * CONTRACTS.haul.rewardFactor + commission;
  return Math.round(rush ? standard * CONTRACTS.haul.rush.premium : standard);
}

// Turns a haul allows from acceptance. A standard haul gets room on top of the drive plus a fixed slack
// for one stop. A rush haul gets the drive with a margin and no slack.
export function haulWindow(turns: number, rush: boolean): number {
  requireNonNegative('turns', turns);
  const haul = CONTRACTS.haul;
  return Math.round(rush ? turns * haul.rush.durationFactor : turns * haul.durationFactor + haul.slackTurns);
}

function requireNonNegative(what: string, n: number): void {
  if (!Number.isFinite(n) || n < 0) throw new Error(`A haul needs a finite ${what} of at least 0, got ${n}`);
}

export function vehicleValue(v: Vehicle): number {
  const parts = v.items.flatMap((it) => (it.kind === 'part' ? [it.part] : []));
  return chassisDef(v.chassisId).value + parts.reduce((a, p) => a + partValue(p), 0);
}

export function cargoValue(v: Vehicle): number {
  const goods = Object.entries(goodsCount(v)).reduce((a, [good, n]) => a + n * goodValue(good), 0);
  return goods + spareParts(v).reduce((a, p) => a + partValue(p), 0);
}

export function bountyReward(templateId: string): number {
  const turns = CONTRACTS.bounty.rewardTurns[templateId];
  if (turns === undefined) throw new Error(`No bounty reward for template ${templateId}`);
  return Math.round(turns * EFFORT.wage[1]);
}

export function partPristineBuyPrice(defId: string): number {
  return Math.round(PARTS[defId].value * (1 + ECONOMY.spread));
}

export function fetchReward(defId: string, tier: Tier): number {
  return partPristineBuyPrice(defId) + Math.round(CONTRACTS.fetch.searchFeeTurns * EFFORT.wage[tier]);
}

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

function rollHaul(world: World, input: RollInput, id: string): Contract {
  const to = pick(world, input.places);
  const good = pick(world, input.goods);
  const tier = GOODS[good].tier;
  const units = randInt(world.marketRng, CONTRACTS.haul.units[0], CONTRACTS.haul.units[1]);
  const turns = estimateTurns(input.shop.pos, to.pos);
  const rush = chance(world.marketRng, CONTRACTS.haul.rush.chance);
  const reward = contractReward(turns, units * goodValue(good), rush);
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
  const reward = bountyReward(target.brain.templateId);
  return { id, shop: input.shop.id, kind: 'bounty', template: target.brain.templateId, reward, deadline: world.turn + turns, window: turns, tier, fulfilled: false };
}

const ROLLS = { haul: rollHaul, fetch: rollFetch, bounty: rollBounty };

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

export function playerDefeats(world: World): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of world.events) {
    const template = playerDefeatOf(world, e);
    if (template) out.set(template, (out.get(template) ?? 0) + 1);
  }
  return out;
}

function playerDefeatOf(world: World, e: GameEvent): string | null {
  if (!isPlayerBlow(world, e)) return null;
  const v = beatenTruck(world, e.vehicle);
  if (e.t === 'destroyed' && isDefeated(v)) return null;
  return v.brain?.templateId ?? null;
}

function isPlayerBlow(world: World, e: GameEvent): e is Extract<GameEvent, { t: 'destroyed' | 'npcKnockout' }> {
  return (e.t === 'destroyed' || e.t === 'npcKnockout') && e.by === world.player.vehicleId;
}

function beatenTruck(world: World, id: string): Vehicle {
  const v = world.removed.find((x) => x.id === id) ?? world.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`No truck ${id} for a defeat this turn`);
  return v;
}

export function fulfilBounty(world: World, template: string): void {
  const c = world.player.contracts.find((x): x is Extract<Contract, { kind: 'bounty' }> => x.kind === 'bounty' && x.template === template && !x.fulfilled);
  if (!c) return;
  c.fulfilled = true;
  world.events.push({ t: 'contract', contract: { ...c }, outcome: 'fulfilled' });
}

export function creditBounty(world: World, npc: Vehicle): void {
  if (!npc.brain) throw new Error(`${npc.id} has no driver to name in a bounty`);
  fulfilBounty(world, npc.brain.templateId);
}

export function bountyLapsed(world: World, c: Contract): boolean {
  if (c.kind !== 'bounty') throw new Error(`${c.kind} contract has no bounty target`);
  return !world.vehicles.some((v) => v.brain?.templateId === c.template);
}

export function haulPenalty(c: Extract<Contract, { kind: 'haul' }>, goodValue: number): number {
  return Math.round(c.units * goodValue * CONTRACTS.haul.penaltyShare);
}

function shopPos(shopId: string): Vec {
  return siteOf(shopId).pos;
}

export function shopState(world: World, shopId: string): ShopState {
  const state = world.shops[shopId];
  if (!state) throw new Error(`Unknown shop ${shopId}`);
  return state;
}

export function standingPressures(world: World, shopId: string): Record<string, number> {
  const live = shopState(world, shopId).pressure;
  return Object.fromEntries(shopDef(shopId).goods.map((good) => [good, live[good] ?? 0]));
}

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

export function shopAt(world: World): string | null {
  return playerVehicle(world).speed > RULES.parkedSpeed ? null : shopNear(world);
}

export function shopNear(world: World): string | null {
  const pos = playerVehicle(world).pos;
  return Object.keys(SHOPS).find((id) => canUseSite(pos, siteOf(id))) ?? null;
}

export function siteOf(siteId: string): Site {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === siteId);
  if (!site) throw new Error(`No site ${siteId} in the region`);
  return site;
}

export function requireShop(world: World): string {
  const shopId = shopAt(world);
  if (!shopId) throw new Error('Not parked at a shop');
  return shopId;
}

function requireParkedAt(world: World, shopId: string): void {
  if (shopAt(world) !== shopId) throw new Error(`Not parked at ${shopId}`);
}

export function acceptContract(world: World, contractId: string): World {
  return playerCommand(world, (w) => takeContract(w, contractId));
}

export function takeContract(w: World, contractId: string): void {
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
}

export function haulBlocked(world: World, c: Contract): boolean {
  return c.kind === 'haul' && (world.player.money < 0 || freeCells(playerVehicle(world)) < c.units);
}

function loadHaul(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  if (world.player.money < 0) throw new Error('Cannot take on a haul while in debt');
  const v = playerVehicle(world);
  if (freeCells(v) < c.units) throw new Error(`Needs ${c.units} free cells for the cargo`);
  const held = goodsCount(v)[c.good] ?? 0;
  if (addGoods(world, v, c.good, c.units) !== c.units) throw new Error('Cargo capacity invariant failed');
  const paid = world.player.costBasis[c.good] ?? 0;
  world.player.costBasis[c.good] = (paid * held + goodValue(c.good) * c.units) / (held + c.units);
}

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
  requireParkedAt(world, c.shop);
  if (!c.fulfilled) throw new Error('The bounty is not met yet');
}

function handInHaul(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  requireParkedAt(world, c.to);
  const v = playerVehicle(world);
  if ((goodsCount(v)[c.good] ?? 0) < c.units) throw new Error(`Needs ${c.units} ${c.good}`);
  removeGoods(v, c.good, c.units);
}

export function fitsFetch(c: Extract<Contract, { kind: 'fetch' }>, p: PartInstance): boolean {
  return p.defId === c.defId && p.hp > 0 && !isJunk(p) && p.wear <= CONTRACTS.fetch.maxWear;
}

function handInFetch(world: World, c: Extract<Contract, { kind: 'fetch' }>): void {
  requireParkedAt(world, c.shop);
  const v = playerVehicle(world);
  const spare = spareParts(v).find((p) => fitsFetch(c, p));
  if (spare) {
    v.items = v.items.filter((it) => it.kind !== 'part' || it.part.id !== spare.id);
    return;
  }
  const stored = world.player.storage.findIndex((p) => fitsFetch(c, p));
  if (stored < 0) throw new Error(`Needs a spare ${c.defId}, working and rebuilt at most ${CONTRACTS.fetch.maxWear} time${CONTRACTS.fetch.maxWear === 1 ? '' : 's'}`);
  world.player.storage.splice(stored, 1);
}

export function contractXp(c: Contract): number {
  const effort = c.kind === 'fetch' ? c.reward - partPristineBuyPrice(c.defId) : c.reward;
  return Math.round(effort * CONTRACTS[c.kind].xpPerEffort);
}

function finishContract(world: World, c: Contract, outcome: 'done' | 'failed' | 'lapsed'): void {
  if (outcome !== 'done' && isMetBounty(c)) throw new Error(`A fulfilled bounty cannot be ${outcome}`);
  world.player.contracts = world.player.contracts.filter((x) => x.id !== c.id);
  world.events.push({ t: 'contract', contract: { ...c }, outcome });
  if (outcome === 'done') payContract(world, c);
  if (outcome === 'failed' && c.kind === 'haul') chargeHaulPenalty(world, c);
}

function payContract(world: World, c: Contract): void {
  world.player.money += c.reward;
  world.events.push({ t: 'money', amount: c.reward, reason: { kind: 'contract' } });
  practice(world, 'contract', contractXp(c), null, c.shop);
}

function chargeHaulPenalty(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  const penalty = haulPenalty(c, goodValue(c.good));
  world.player.money -= penalty;
  world.events.push({ t: 'money', amount: -penalty, reason: { kind: 'failedHaul' } });
}

function isMetBounty(c: Contract): boolean {
  return c.kind === 'bounty' && c.fulfilled;
}

export function advanceContracts(world: World): void {
  for (const [template, count] of playerDefeats(world)) for (let i = 0; i < count; i++) fulfilBounty(world, template);
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
