// Economy harness: plays the real sim economy with simple bot policies. Travel is abstract (the bot
// teleports to a site's gate and the clock advances by estimated turns) and fights are abstract (a
// sampled raider loadout stands in for the shot-by-shot fight), but every trade, repair, contract,

import { chassisDef, PLAYER_CHASSIS } from '../data/chassis';
import { CONTRACTS } from '../data/market';
import { GOODS, GOOD_IDS } from '../data/goods';
import { REGION } from '../data/region';
import { EFFORT, HARNESS, SHOPS, shopDef, type ItemKind, type Tier } from '../data/market';
import { NPCS } from '../data/npcs';
import { PARTS, partDef, type PartKind } from '../data/parts';
import { START_KITS } from '../data/start';
import { TIME } from '../data/time';
import { WEAR } from '../data/wear';
import { playerVehicle } from '../sim/damage';
import {
  buyChassis,
  buyGood,
  buyPrice,
  buyStockPart,
  chassisTradeIn,
  partTradePrice,
  repairAll,
  repairCost,
  sellGood,
  sellPart,
  sellPrice,
  affordableBuyCount,
} from '../sim/economy';
import { makeVehicle } from '../sim/factory';
import { corePart, freeCells, goodsCount, mountedParts } from '../sim/grid';
import { mountPart, spareParts } from '../sim/inventory';
import { startStrip, stripYield } from '../sim/jobs';
import { generateNpcLoadout } from '../sim/npc-loadout';
import { skillLevel } from '../sim/progress';
import { chance, randInt } from '../sim/rng';
import {
  acceptContract,
  addStockPart,
  advanceContracts,
  advanceShops,
  deliverContract,
  fitsFetch,
  estimateTurns,
  goodValue,
  shopAt,
  shopState,
  siteOf,
  takeStockPart,
  type Contract,
} from '../sim/market';
import { advanceJobs } from '../sim/jobs';
import { burnFuel, consumeVehicleSupplies } from '../sim/resources';
import { collectSalvage, createWreckSalvage, renewSalvage, salvageUnits, wreckStockId } from '../sim/salvage';
import { siteGates, sitePads } from '../sim/sites';
import { vehicleStats } from '../sim/stats';
import type { PartInstance, SkillId, Vehicle, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { damagePart, isJunk, maxHp, partValue } from '../sim/wear';
import { newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';

export type PolicyName = 'idle' | 'haulOnly' | 'salvageOnly' | 'contractsOnly' | 'greedy';

const MONOTONOUS_POLICIES: PolicyName[] = ['idle', 'haulOnly'];

const GREEDY_RESERVE = 400;

export type Telemetry = {
  trades: number;
  fights: number;
  fightsWon: number;
  contractsAccepted: number;
  contractsDone: number;
  partsBroken: number;
  partsJunked: number;
  debtEvents: number;
  upgradesBought: number;
  partsStripped: number;
};

export type DayRecord = { day: number; money: number; netWorth: number; level: number; tier: Tier };
export type WishlistHit = { item: string; day: number; turn: number };
export type EffortRow = {
  id: string;
  kind: ItemKind;
  tier: Tier;
  value: number;
  wage: number;
  effort: number;
  band: [number, number];
  inBand: boolean;
  measured: boolean;
};

export type RunReport = {
  seed: number;
  policy: PolicyName;
  days: number;
  executionProfile: 'precise';
  perDay: DayRecord[];
  wagePerTier: Record<Tier, number | null>;
  wishlist: WishlistHit[];
  telemetry: Telemetry;
  effort: EffortRow[];
  finalMoney: number;
  finalNetWorth: number;
};

function nonCoreMountedValue(v: Vehicle): number {
  return mountedParts(v)
    .filter((p) => partDef(p.defId).kind !== 'core')
    .reduce((a, p) => a + partValue(p), 0);
}

function storageValue(world: World): number {
  return world.player.storage.reduce((a, p) => a + partValue(p), 0);
}

function cargoValue(v: Vehicle): number {
  return Object.entries(goodsCount(v)).reduce((a, [good, n]) => a + goodValue(good) * n, 0);
}

function netWorth(world: World): number {
  const v = playerVehicle(world);
  return world.player.money + storageValue(world) + cargoValue(v) + nonCoreMountedValue(v) + chassisTradeIn(world);
}

function currentTier(v: Vehicle): Tier {
  const tiers = mountedParts(v)
    .filter((p) => partDef(p.defId).kind !== 'core')
    .map((p) => partDef(p.defId).tier);
  return (tiers.length ? Math.max(...tiers) : 1) as Tier;
}

function passTurns(world: World, telemetry: Telemetry, turns: number, tilesPerTurn: number): void {
  for (let i = 0; i < turns; i++) stepOneTurn(world, telemetry, tilesPerTurn);
}

function stepOneTurn(world: World, telemetry: Telemetry, tilesPerTurn: number): void {
  world.turn++;
  world.events = [];
  advanceShops(world);
  advanceContracts(world);
  renewSalvage(world);
  telemetry.debtEvents += world.events.filter((e) => e.t === 'money' && e.amount < 0 && e.reason === 'failed haul contract').length;
  telemetry.contractsDone += world.events.filter((e) => e.t === 'contract' && e.outcome === 'done' && e.contract.kind === 'bounty').length;
  const v = playerVehicle(world);
  consumeVehicleSupplies(world, v);
  if (tilesPerTurn <= 0) advanceJobs(world);
  if (tilesPerTurn <= 0) return;
  burnFuel(world, v, tilesPerTurn);
  driveWear(world, v, tilesPerTurn, telemetry);
}

function driveWear(world: World, v: Vehicle, tiles: number, telemetry: Telemetry): void {
  const speedFactor = 1 + WEAR.speedWeight * vehicleStats(world, v).maxSpeed;
  const cabId = corePart(v, 'cab').id;
  for (const p of mountedParts(v).filter((part) => part.hp > 0)) {
    if (!chance(world, Math.min(1, WEAR.chancePerTile * tiles * speedFactor))) continue;
    hitPart(p, maxHp(p) * WEAR.hpShare, p.id === cabId ? 1 : 0, telemetry);
  }
  rollBreakdown(world, v, tiles, speedFactor, cabId, telemetry);
}

function rollBreakdown(world: World, v: Vehicle, tiles: number, speedFactor: number, cabId: string, telemetry: Telemetry): void {
  const working = mountedParts(v).filter((p) => p.hp > 0);
  if (working.length === 0 || !chance(world, Math.min(1, WEAR.breakdownChancePerTile * tiles * speedFactor))) return;
  const part = working[randInt(world, 0, working.length - 1)];
  hitPart(part, maxHp(part) * WEAR.breakdownHpShare, part.id === cabId ? 1 : 0, telemetry);
}

function hitPart(part: PartInstance, amount: number, floor: number, telemetry: Telemetry): void {
  const wasJunk = isJunk(part);
  damagePart(part, amount, floor);
  if (part.hp === 0) telemetry.partsBroken++;
  if (!wasJunk && isJunk(part)) telemetry.partsJunked++;
}

function nearestGate(pos: Vec, siteId: string): Vec {
  const gates = sitePads(siteOf(siteId));
  return [...gates].sort((a, b) => dist(pos, a) - dist(pos, b))[0];
}

function tilesPerTurnOf(world: World): number {
  return Math.max(0.1, vehicleStats(world, playerVehicle(world)).maxSpeed * HARNESS.cruiseShare);
}

function driveTo(world: World, telemetry: Telemetry, siteId: string): void {
  driveToPoint(world, telemetry, nearestGate(playerVehicle(world).pos, siteId));
}

function driveToPoint(world: World, telemetry: Telemetry, dest: Vec): void {
  let remaining = dist(playerVehicle(world).pos, dest) * EFFORT.routeFactor;
  while (remaining > 0) {
    const step = Math.min(tilesPerTurnOf(world), remaining);
    passTurns(world, telemetry, 1, step);
    remaining -= step;
    if (chance(world, Math.min(1, HARNESS.encounterRate * step))) fight(world, telemetry);
  }
  const v = playerVehicle(world);
  v.pos = { ...dest };
  v.speed = 0;
}

function fight(world: World, telemetry: Telemetry): void {
  resolveEncounter(world, telemetry, null);
}

function resolveEncounter(world: World, telemetry: Telemetry, target: Vehicle | null): void {
  telemetry.fights++;
  const v = playerVehicle(world);
  const armed = mountedParts(v, 'weapon').some((p) => p.hp > 0);
  const win = chance(world, armed ? HARNESS.fightWinOdds : HARNESS.fightWinOddsUnarmed);
  passTurns(world, telemetry, HARNESS.fightTurns, 0);
  damagePlayerInFight(world, v, telemetry);
  if (!win) return;
  telemetry.fightsWon++;
  if (target) killTarget(world, target);
  else lootRaider(world);
}

function killTarget(world: World, target: Vehicle): void {
  world.vehicles = world.vehicles.filter((v) => v.id !== target.id);
  world.events.push({ t: 'destroyed', vehicle: target.id, by: world.player.vehicleId });
  createWreckSalvage(world, target);
  const stockId = wreckStockId(target.id);
  const stock = world.salvage.find((s) => s.id === stockId);
  if (!stock) throw new Error(`Missing wreck stock ${stockId}`);
  collectSalvage(world, playerVehicle(world), stockId, salvageUnits(stock));
}

function damagePlayerInFight(world: World, v: Vehicle, telemetry: Telemetry): void {
  const cabId = corePart(v, 'cab').id;
  const hits = Math.max(1, Math.round(mountedParts(v).filter((p) => p.hp > 0).length * HARNESS.fightDamageShare));
  for (let i = 0; i < hits; i++) {
    const working = mountedParts(v).filter((p) => p.hp > 0);
    if (working.length === 0) return;
    const p = working[randInt(world, 0, working.length - 1)];
    hitPart(p, maxHp(p) * HARNESS.fightDamageShare, p.id === cabId ? 1 : 0, telemetry);
  }
}

const RAIDER_TEMPLATES = ['buggy', 'gunwagon'];

function lootRaider(world: World): void {
  const tpl = NPCS[RAIDER_TEMPLATES[randInt(world, 0, RAIDER_TEMPLATES.length - 1)]];
  const loadout = generateNpcLoadout(world, tpl);
  const raider = makeVehicle(world, { name: tpl.name, faction: tpl.faction, ...loadout, pos: playerVehicle(world).pos, heading: 0, brain: null });
  createWreckSalvage(world, raider);
  const stockId = wreckStockId(raider.id);
  const stock = world.salvage.find((s) => s.id === stockId);
  if (!stock) throw new Error(`Missing wreck stock ${stockId}`);
  collectSalvage(world, playerVehicle(world), stockId, salvageUnits(stock));
}

type Memory = {
  visited: Set<string>;
  prices: Record<string, Record<string, { buy: number; sell: number }>>;
  haul: { good: string; sellShop: string } | null;
  full: Set<string>;
};

function newMemory(): Memory {
  return { visited: new Set(), prices: {}, haul: null, full: new Set() };
}

function recordShopVisit(world: World, mem: Memory, shopId: string): void {
  mem.visited.add(shopId);
  const prices: Record<string, { buy: number; sell: number }> = {};
  for (const good of shopDef(shopId).goods) prices[good] = { buy: buyPrice(world, shopId, good), sell: sellPrice(world, shopId, good) };
  mem.prices[shopId] = prices;
}

const SHOP_IDS = Object.keys(SHOPS);

function unvisitedShop(world: World, mem: Memory): string | null {
  const unvisited = SHOP_IDS.filter((id) => !mem.visited.has(id));
  if (unvisited.length === 0) return null;
  const pos = playerVehicle(world).pos;
  return [...unvisited].sort((a, b) => dist(pos, siteOf(a).pos) - dist(pos, siteOf(b).pos))[0];
}

function hasLoot(id: string, world: World): boolean {
  const stock = world.salvage.find((s) => s.id === id);
  return !!stock && (stock.parts.length > 0 || Object.values(stock.goods).some((n) => n > 0));
}

function salvageReachable(stockId: string): boolean {
  const site = REGION.locations.find((l) => l.id === stockId);
  if (!site) return true;
  try {
    siteGates(site);
    return true;
  } catch {
    return false;
  }
}

function nearestStock(world: World, mem: Memory): string | null {
  const ids = world.salvage.filter((s) => !mem.full.has(s.id) && hasLoot(s.id, world) && salvageReachable(s.id)).map((s) => s.id);
  if (ids.length === 0) return null;
  const pos = playerVehicle(world).pos;
  const stocks = ids.map((id) => world.salvage.find((s) => s.id === id)!);
  return [...stocks].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0].id;
}

function driveToSalvage(world: World, telemetry: Telemetry, stockId: string): void {
  const isSite = REGION.locations.some((l) => l.id === stockId);
  if (isSite) driveTo(world, telemetry, stockId);
  else driveToPoint(world, telemetry, world.salvage.find((s) => s.id === stockId)!.pos);
}

function searchStock(world: World, telemetry: Telemetry, mem: Memory, stockId: string): void {
  driveToSalvage(world, telemetry, stockId);
  while (hasLoot(stockId, world) && freeCells(playerVehicle(world)) > 0) {
    const took = collectSalvage(world, playerVehicle(world), stockId, Math.min(HARNESS.searchRate, freeCells(playerVehicle(world))));
    passTurns(world, telemetry, 1, 0);
    if (took > 0) continue;
    mem.full.add(stockId);
    return;
  }
}

function sellEverything(world: World, telemetry: Telemetry): World {
  const shopId = shopAt(world);
  if (!shopId) throw new Error('sellEverything needs a parked shop');
  world = sellGoodsHeld(world, telemetry, shopId);
  return sellSpareParts(world, telemetry, shopId);
}

function sellGoodsHeld(world: World, telemetry: Telemetry, shopId: string): World {
  const held = goodsCount(playerVehicle(world));
  for (const good of shopDef(shopId).goods) {
    const n = held[good] ?? 0;
    if (n <= 0) continue;
    world = sellGood(world, good, n);
    telemetry.trades++;
  }
  return world;
}

function sellSpareParts(world: World, telemetry: Telemetry, shopId: string): World {
  const stored = shopDef(shopId).kind === 'garage' ? world.player.storage.map((p) => p.id) : [];
  const ids = spareParts(playerVehicle(world))
    .map((p) => p.id)
    .concat(stored);
  for (const id of ids) {
    world = sellPart(world, id);
    telemetry.trades++;
  }
  return world;
}

type Action = { site: string | null; run: (world: World, telemetry: Telemetry, mem: Memory) => World };

function haulOnlyAction(world: World, mem: Memory): Action {
  if (mem.haul) return { site: mem.haul.sellShop, run: runSell };
  if (freeCells(playerVehicle(world)) <= 0) return clearRoomAction(mem);
  const best = bestHaul(mem);
  if (best) return { site: best.buyShop, run: (w, t, m) => runBuy(w, t, m, best) };
  const next = unvisitedShop(world, mem);
  if (next) return { site: next, run: (w, _t, m) => { recordShopVisit(w, m, next); return w; } };
  return { site: null, run: (w) => w };
}

function clearRoomAction(mem: Memory): Action {
  const shopId = [...mem.visited][0] ?? SHOP_IDS[0];
  return { site: shopId, run: (w, t, m) => { recordShopVisit(w, m, shopId); return sellEverything(w, t); } };
}

type HaulPlan = { buyShop: string; sellShop: string; good: string; margin: number };

function bestHaul(mem: Memory): HaulPlan | null {
  let best: HaulPlan | null = null;
  for (const buyShop of mem.visited) {
    const plan = bestGoodFromShop(mem, buyShop);
    if (plan && (!best || plan.margin > best.margin)) best = plan;
  }
  return best;
}

function bestGoodFromShop(mem: Memory, buyShop: string): HaulPlan | null {
  let best: HaulPlan | null = null;
  for (const sellShop of mem.visited) {
    if (sellShop === buyShop) continue;
    const plan = bestGoodBetween(mem, buyShop, sellShop);
    if (plan && (!best || plan.margin > best.margin)) best = plan;
  }
  return best;
}

function bestGoodBetween(mem: Memory, buyShop: string, sellShop: string): HaulPlan | null {
  let best: HaulPlan | null = null;
  for (const good of shopDef(buyShop).goods) {
    if (!shopDef(sellShop).goods.includes(good)) continue;
    const margin = mem.prices[sellShop][good].sell - mem.prices[buyShop][good].buy;
    if (margin > 0 && (!best || margin > best.margin)) best = { buyShop, sellShop, good, margin };
  }
  return best;
}

function runBuy(world: World, telemetry: Telemetry, mem: Memory, plan: HaulPlan): World {
  recordShopVisit(world, mem, plan.buyShop);
  const me = playerVehicle(world);
  const units = affordableBuyCount(world, me, plan.buyShop, plan.good, freeCells(me), world.player.money);
  if (units <= 0) return world;
  world = buyGood(world, plan.good, units);
  telemetry.trades++;
  mem.haul = { good: plan.good, sellShop: plan.sellShop };
  return world;
}

function runSell(world: World, telemetry: Telemetry, mem: Memory): World {
  if (!mem.haul) return world;
  recordShopVisit(world, mem, mem.haul.sellShop);
  const held = goodsCount(playerVehicle(world))[mem.haul.good] ?? 0;
  if (held > 0) {
    world = sellGood(world, mem.haul.good, held);
    telemetry.trades++;
  }
  mem.haul = null;
  return world;
}

function salvageOnlyAction(world: World, mem: Memory): Action {
  const target = nearestStock(world, mem);
  if (target && freeCells(playerVehicle(world)) > 0) return { site: null, run: (w, t, m) => { searchStock(w, t, m, target); return w; } };
  return { site: SHOP_IDS[0], run: (w, t, m) => { recordShopVisit(w, m, SHOP_IDS[0]); m.full.clear(); return sellEverything(w, t); } };
}

function contractsOnlyAction(world: World, mem: Memory): Action {
  const actionable = world.player.contracts.find((c) => contractIsActionable(world, mem, c));
  if (actionable) return contractAction(actionable);
  const known = bestContractShop(world, mem);
  if (known) return { site: known, run: (w, t, m) => { recordShopVisit(w, m, known); return runAccept(w, t, known); } };
  const next = unvisitedShop(world, mem);
  if (next) return { site: next, run: (w, _t, m) => { recordShopVisit(w, m, next); return w; } };
  return { site: null, run: (w) => w };
}

function contractIsActionable(world: World, mem: Memory, c: Contract): boolean {
  if (c.kind === 'haul') return true;
  if (c.kind === 'bounty') return world.vehicles.some((v) => v.brain?.templateId === c.template);
  const v = playerVehicle(world);
  if (hasSpare(v, c) || hasStored(world, c)) return true;
  if (knownStockShop(world, mem, c)) return true;
  return unvisitedShop(world, mem) !== null;
}

function contractAction(c: Contract): Action {
  if (c.kind === 'haul') return { site: c.to, run: (w, t, m) => runDeliver(w, t, m, c.id) };
  if (c.kind === 'bounty') return { site: null, run: (w, t) => { pursueBounty(w, t, c); return w; } };
  return fetchAction(c);
}

function fetchAction(c: Extract<Contract, { kind: 'fetch' }>): Action {
  return { site: null, run: (w, t, m) => runFetch(w, t, m, c) };
}

function runFetch(world: World, telemetry: Telemetry, mem: Memory, c: Extract<Contract, { kind: 'fetch' }>): World {
  const v = playerVehicle(world);
  if (hasSpare(v, c) || hasStored(world, c)) {
    driveTo(world, telemetry, c.shop);
    return runDeliver(world, telemetry, mem, c.id);
  }
  const known = knownStockShop(world, mem, c);
  if (known) {
    driveTo(world, telemetry, known);
    recordShopVisit(world, mem, known);
    return buyFetchPart(world, c);
  }
  const next = unvisitedShop(world, mem);
  if (next) {
    driveTo(world, telemetry, next);
    recordShopVisit(world, mem, next);
  }
  return world;
}

type Fetch = Extract<Contract, { kind: 'fetch' }>;

function hasSpare(v: Vehicle, c: Fetch): boolean {
  return spareParts(v).some((p) => fitsFetch(c, p));
}

function hasStored(world: World, c: Fetch): boolean {
  return world.player.storage.some((p) => fitsFetch(c, p));
}

function knownStockShop(world: World, mem: Memory, c: Fetch): string | null {
  const pos = playerVehicle(world).pos;
  const found = [...mem.visited].filter((id) => world.shops[id].stock.some((p) => fitsFetch(c, p)));
  return found.length ? [...found].sort((a, b) => dist(pos, siteOf(a).pos) - dist(pos, siteOf(b).pos))[0] : null;
}

function affordableStockPart(world: World, shopId: string, c: Fetch): PartInstance | null {
  const part = world.shops[shopId].stock.find((p) => fitsFetch(c, p));
  if (!part) return null;
  return world.player.money >= partTradePrice(world, playerVehicle(world), part, 'buy') ? part : null;
}

function buyFetchPart(world: World, c: Fetch): World {
  const shopId = shopAt(world);
  const part = shopId ? affordableStockPart(world, shopId, c) : null;
  if (!part) return world;
  try {
    return buyStockPart(world, part.id);
  } catch (e) {
    if (e instanceof Error && e.message.includes('room')) return world;
    throw e;
  }
}

function pursueBounty(world: World, telemetry: Telemetry, c: Extract<Contract, { kind: 'bounty' }>): void {
  const target = world.vehicles.find((v) => v.brain?.templateId === c.template);
  if (!target) return;
  driveToPoint(world, telemetry, target.pos);
  resolveEncounter(world, telemetry, target);
}

function haulScore(world: World, shopId: string, c: { to: string; reward: number }): number {
  return c.reward / Math.max(1, estimateTurns(siteOf(shopId).pos, siteOf(c.to).pos));
}

function offerScore(world: World, shopId: string, c: Contract): number {
  return c.kind === 'haul' ? haulScore(world, shopId, c) : c.reward;
}

function fittingOffers(world: World, shopId: string): Contract[] {
  const v = playerVehicle(world);
  const room = freeCells(v);
  return shopState(world, shopId).contracts.filter((c) => {
    if (c.kind === 'haul') return c.units <= room && world.player.money >= 0;
    if (c.kind === 'bounty') return mountedParts(v, 'weapon').some((p) => p.hp > 0);
    return true;
  });
}

function bestContract(world: World, shopId: string): number | null {
  const board = fittingOffers(world, shopId);
  return board.length ? Math.max(...board.map((c) => offerScore(world, shopId, c))) : null;
}

function bestContractShop(world: World, mem: Memory): string | null {
  const scored = [...mem.visited]
    .map((id) => ({ id, score: bestContract(world, id) }))
    .filter((s): s is { id: string; score: number } => s.score !== null);
  return scored.length ? scored.sort((a, b) => b.score - a.score)[0].id : null;
}

function runAccept(world: World, telemetry: Telemetry, shopId: string): World {
  const board = fittingOffers(world, shopId);
  if (board.length === 0 || world.player.contracts.length >= CONTRACTS.maxActive) return world;
  const pick = [...board].sort((a, b) => offerScore(world, shopId, b) - offerScore(world, shopId, a))[0];
  world = acceptContract(world, pick.id);
  telemetry.contractsAccepted++;
  return world;
}

function runDeliver(world: World, telemetry: Telemetry, mem: Memory, contractId: string): World {
  recordShopVisit(world, mem, shopAt(world) ?? SHOP_IDS[0]);
  if (!world.player.contracts.some((c) => c.id === contractId)) return world;
  const before = world.player.contracts.length;
  world = deliverContract(world, contractId);
  if (world.player.contracts.length < before) telemetry.contractsDone++;
  return world;
}

function greedyAction(world: World, mem: Memory, wishlist: WishlistHit[], day: number): Action {
  return withMaintenance(chooseGreedy(world, mem), wishlist, day);
}

function chooseGreedy(world: World, mem: Memory): Action {
  if (mem.haul) return haulOnlyAction(world, mem);
  if (world.player.contracts.length > 0) return contractsOnlyAction(world, mem);
  if (bestContractShop(world, mem)) return contractsOnlyAction(world, mem);
  if (bestHaul(mem)) return haulOnlyAction(world, mem);
  if (unvisitedShop(world, mem)) return haulOnlyAction(world, mem);
  return salvageOnlyAction(world, mem);
}

function withMaintenance(action: Action, wishlist: WishlistHit[], day: number): Action {
  return { site: action.site, run: (w, t, m) => maintainThenRun(action, w, t, m, wishlist, day) };
}

function maintainThenRun(action: Action, world: World, telemetry: Telemetry, mem: Memory, wishlist: WishlistHit[], day: number): World {
  world = action.run(world, telemetry, mem);
  return maybeMaintain(world, telemetry, wishlist, day);
}

const WISHLIST_ORDER: { item: string; kind: ItemKind; tier: Tier }[] = [
  { item: 'weapon tier 2', kind: 'weapon', tier: 2 },
  { item: 'engine tier 2', kind: 'engine', tier: 2 },
  { item: 'armor tier 2', kind: 'armor', tier: 2 },
  { item: 'cargo tier 2', kind: 'cargo', tier: 2 },
  { item: 'chassis tier 2', kind: 'chassis', tier: 2 },
  { item: 'weapon tier 3', kind: 'weapon', tier: 3 },
  { item: 'engine tier 3', kind: 'engine', tier: 3 },
  { item: 'chassis tier 3', kind: 'chassis', tier: 3 },
];

function maybeMaintain(world: World, telemetry: Telemetry, wishlist: WishlistHit[], day: number): World {
  world = maybeRepairAndUpgrade(world, telemetry);
  world = maybeStripSpares(world, telemetry);
  recordWishlist(world, wishlist, day);
  return world;
}

function maybeRepairAndUpgrade(world: World, telemetry: Telemetry): World {
  const shopId = shopAt(world);
  if (!shopId || shopDef(shopId).kind !== 'garage') return world;
  if (repairCost(world) > 0 && world.player.money > repairCost(world) * 2) world = repairAll(world);
  return maybeUpgrade(world, shopId, telemetry);
}

function playerLevel(world: World): number {
  return (Object.keys(world.player.skills) as SkillId[]).reduce((sum, skill) => sum + skillLevel(world, skill), 0);
}

function haveTier(v: Vehicle, kind: ItemKind): Tier {
  if (kind === 'chassis') return chassisDef(v.chassisId).tier;
  const parts = mountedParts(v).filter((p) => partDef(p.defId).kind === kind);
  return (parts.length ? Math.max(...parts.map((p) => partDef(p.defId).tier)) : 1) as Tier;
}

function recordWishlist(world: World, wishlist: WishlistHit[], day: number): void {
  const v = playerVehicle(world);
  for (const entry of WISHLIST_ORDER) {
    if (wishlist.some((h) => h.item === entry.item)) continue;
    if (haveTier(v, entry.kind) >= entry.tier) wishlist.push({ item: entry.item, day, turn: world.turn });
  }
  for (let lvl = 1; lvl <= playerLevel(world); lvl++) {
    const item = `level ${lvl}`;
    if (!wishlist.some((h) => h.item === item)) wishlist.push({ item, day, turn: world.turn });
  }
}

function maybeUpgrade(world: World, shopId: string, telemetry: Telemetry): World {
  if (shopDef(shopId).kind !== 'garage') return world;
  for (const entry of WISHLIST_ORDER) {
    if (haveTier(playerVehicle(world), entry.kind) >= entry.tier) continue;
    const upgraded = entry.kind === 'chassis'
      ? tryUpgradeChassis(world, entry.tier)
      : tryUpgradePart(world, shopId, entry.kind as Exclude<ItemKind, 'chassis' | 'good'>, entry.tier);
    if (upgraded) {
      telemetry.upgradesBought++;
      return upgraded;
    }
  }
  return world;
}

function affordableUpgrade(world: World, cost: number): boolean {
  return world.player.money - cost >= GREEDY_RESERVE;
}

function tryUpgradeChassis(world: World, tier: Tier): World | null {
  const v = playerVehicle(world);
  const currentTierOf = chassisDef(v.chassisId).tier;
  const candidates = PLAYER_CHASSIS.filter((id) => chassisDef(id).tier >= tier && chassisDef(id).tier > currentTierOf);
  const pick = [...candidates].sort((a, b) => chassisDef(a).value - chassisDef(b).value)[0];
  if (!pick) return null;
  const cost = Math.max(0, chassisDef(pick).value - chassisTradeIn(world));
  if (!affordableUpgrade(world, cost)) return null;
  return buyChassis(world, pick);
}

function tryUpgradePart(world: World, shopId: string, kind: Exclude<ItemKind, 'chassis' | 'good'>, tier: Tier): World | null {
  const v = playerVehicle(world);
  const stock = shopState(world, shopId).stock.filter((p) => partDef(p.defId).kind === kind && partDef(p.defId).tier >= tier);
  const pick = [...stock].sort((a, b) => partTradePrice(world, v, a, 'buy') - partTradePrice(world, v, b, 'buy'))[0];
  if (!pick) return null;
  const cost = partTradePrice(world, v, pick, 'buy');
  if (!affordableUpgrade(world, cost)) return null;
  return swapMount(world, shopId, pick, kind);
}

function swapMount(world: World, shopId: string, stockPart: PartInstance, kind: PartKind): World | null {
  const v = playerVehicle(world);
  const old = [...mountedParts(v, kind)].sort((a, b) => partDef(a.defId).tier - partDef(b.defId).tier)[0];
  const oldItem = old ? v.items.find((it) => it.kind === 'part' && it.part.id === old.id) : undefined;
  if (oldItem) v.items = v.items.filter((it) => it.id !== oldItem.id);
  if (!mountPart(world, v, stockPart)) {
    if (oldItem) v.items.push(oldItem);
    return null;
  }
  world.player.money -= partTradePrice(world, v, stockPart, 'buy');
  takeStockPart(shopState(world, shopId), stockPart.id);
  if (old) {
    world.player.money += partTradePrice(world, v, old, 'sell');
    addStockPart(shopState(world, shopId), old);
  }
  return world;
}

function shouldStrip(part: PartInstance, world: World, v: Vehicle): boolean {
  if (part.hp > 0) return false;
  const stripValue = stripYield(part) * GOODS.parts.value;
  return stripValue > partTradePrice(world, v, part, 'sell');
}

function maybeStripSpares(world: World, telemetry: Telemetry): World {
  const v = playerVehicle(world);
  if (v.job) return world;
  const candidate = spareParts(v).find((p) => shouldStrip(p, world, v));
  if (!candidate) return world;
  telemetry.partsStripped++;
  return startStrip(world, candidate.id);
}

const POLICIES: Record<PolicyName, (world: World, mem: Memory, wishlist: WishlistHit[], day: number) => Action> = {
  idle: () => ({ site: null, run: (w) => w }),
  haulOnly: (w, m) => haulOnlyAction(w, m),
  salvageOnly: (w, m) => salvageOnlyAction(w, m),
  contractsOnly: (w, m) => contractsOnlyAction(w, m),
  greedy: (w, m, wl, d) => greedyAction(w, m, wl, d),
};

function zeroTelemetry(): Telemetry {
  return {
    trades: 0,
    fights: 0,
    fightsWon: 0,
    contractsAccepted: 0,
    contractsDone: 0,
    partsBroken: 0,
    partsJunked: 0,
    debtEvents: 0,
    upgradesBought: 0,
    partsStripped: 0,
  };
}

export function runPolicy(seed: number, policy: PolicyName, days: number): RunReport {
  let world = newWorld(seed, START_KITS.standard, TEST_MAP);
  const telemetry = zeroTelemetry();
  const wishlist: WishlistHit[] = [];
  const perDay: DayRecord[] = [];
  const tierAccum: Record<Tier, { delta: number; turns: number }> = { 1: { delta: 0, turns: 0 }, 2: { delta: 0, turns: 0 }, 3: { delta: 0, turns: 0 } };
  const mem = newMemory();
  const endTurn = days * TIME.turnsPerDay;
  let day = 0;
  let lastWorth = netWorth(world);
  let nextDayAt = TIME.turnsPerDay;

  while (world.turn < endTurn) {
    const before = world.turn;
    world = takeOneTrip(world, policy, telemetry, mem, wishlist, day);
    if (world.turn === before) passTurns(world, telemetry, 1, 0);
    while (world.turn >= nextDayAt && day < days) {
      day++;
      const worth = netWorth(world);
      const tier = currentTier(playerVehicle(world));
      tierAccum[tier].delta += worth - lastWorth;
      tierAccum[tier].turns += TIME.turnsPerDay;
      lastWorth = worth;
      perDay.push({ day, money: world.player.money, netWorth: worth, level: playerLevel(world), tier });
      nextDayAt += TIME.turnsPerDay;
    }
  }

  const wagePerTier = ([1, 2, 3] as Tier[]).reduce((acc, t) => {
    acc[t] = tierAccum[t].turns > 0 ? tierAccum[t].delta / tierAccum[t].turns : null;
    return acc;
  }, {} as Record<Tier, number | null>);

  return {
    seed,
    policy,
    days,
    executionProfile: 'precise',
    perDay,
    wagePerTier,
    wishlist,
    telemetry,
    effort: effortTable(wagePerTier),
    finalMoney: world.player.money,
    finalNetWorth: netWorth(world),
  };
}

function takeOneTrip(world: World, policy: PolicyName, telemetry: Telemetry, mem: Memory, wishlist: WishlistHit[], day: number): World {
  if (playerVehicle(world).job) {
    passTurns(world, telemetry, 1, 0);
    return world;
  }
  const action = POLICIES[policy](world, mem, wishlist, day);
  if (action.site) driveTo(world, telemetry, action.site);
  return action.run(world, telemetry, mem);
}

export function runMany(seeds: number[], policies: PolicyName[], days: number): RunReport[] {
  const reports: RunReport[] = [];
  for (const policy of policies) for (const seed of seeds) reports.push(runPolicy(seed, policy, days));
  return reports;
}

function effortRow(id: string, kind: ItemKind, tier: Tier, value: number, wagePerTier: Record<Tier, number | null>): EffortRow {
  const measured = wagePerTier[tier];
  const wage = measured && measured > 0 ? measured : EFFORT.wage[tier];
  const effort = value / wage;
  const band = EFFORT.bands[tier][kind];
  return { id, kind, tier, value, wage, effort, band, inBand: effort >= band[0] && effort <= band[1], measured: !!measured && measured > 0 };
}

function effortTable(wagePerTier: Record<Tier, number | null>): EffortRow[] {
  const rows: EffortRow[] = [];
  for (const def of Object.values(PARTS)) if (def.kind !== 'core') rows.push(effortRow(def.id, def.kind as ItemKind, def.tier, def.value, wagePerTier));
  for (const id of PLAYER_CHASSIS) rows.push(effortRow(id, 'chassis', chassisDef(id).tier, chassisDef(id).value, wagePerTier));
  for (const id of GOOD_IDS) rows.push(effortRow(id, 'good', GOODS[id].tier, GOODS[id].value, wagePerTier));
  return rows;
}

type PolicyGroup = { policy: PolicyName; runs: RunReport[] };
type WageBand = { mean: number; min: number; max: number } | null;

function groupByPolicy(reports: RunReport[]): PolicyGroup[] {
  const policies = [...new Set(reports.map((r) => r.policy))];
  return policies.map((policy) => ({ policy, runs: reports.filter((r) => r.policy === policy) }));
}

function wageBand(runs: RunReport[], tier: Tier): WageBand {
  const values = runs.map((r) => r.wagePerTier[tier]).filter((w): w is number => w !== null);
  if (values.length === 0) return null;
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

function groupWageBands(g: PolicyGroup): Record<Tier, WageBand> {
  return ([1, 2, 3] as Tier[]).reduce((acc, t) => {
    acc[t] = wageBand(g.runs, t);
    return acc;
  }, {} as Record<Tier, WageBand>);
}

function groupEffortTable(bands: Record<Tier, WageBand>): EffortRow[] {
  const wagePerTier = ([1, 2, 3] as Tier[]).reduce((acc, t) => {
    acc[t] = bands[t]?.mean ?? null;
    return acc;
  }, {} as Record<Tier, number | null>);
  return effortTable(wagePerTier);
}

function orderedMilestones(g: PolicyGroup): string[] {
  const fixed = WISHLIST_ORDER.map((e) => e.item);
  const levels = new Set<string>();
  for (const r of g.runs) for (const w of r.wishlist) if (w.item.startsWith('level ')) levels.add(w.item);
  const levelOrder = [...levels].sort((a, b) => Number(a.split(' ')[1]) - Number(b.split(' ')[1]));
  return [...fixed, ...levelOrder];
}

export function exploratoryRatio(reports: RunReport[]): number | null {
  const greedy = reports.filter((r) => r.policy === 'greedy').map((r) => r.finalNetWorth);
  const monotonous = reports.filter((r) => MONOTONOUS_POLICIES.includes(r.policy)).map((r) => r.finalNetWorth);
  if (greedy.length === 0 || monotonous.length === 0) return null;
  const monoBest = Math.max(...monotonous);
  if (monoBest <= 0) return null;
  return Math.max(...greedy) / monoBest;
}

export function formatReport(reports: RunReport[]): string {
  const ratio = exploratoryRatio(reports);
  const ratioLine =
    ratio === null
      ? 'exploratory_ratio: not computed (need at least one greedy run and one monotonous run with positive net worth)'
      : `exploratory_ratio (best greedy net worth / best monotonous net worth): ${ratio.toFixed(2)}`;
  return [ratioLine, ...groupByPolicy(reports).map(formatPolicyGroup)].join('\n\n');
}

function formatPolicyGroup(g: PolicyGroup): string {
  const bands = groupWageBands(g);
  const seeds = g.runs.map((r) => r.seed).join(', ');
  const lines: string[] = [];
  lines.push(`## ${g.policy} (${g.runs.length} seed(s): ${seeds}; ${g.runs[0].days} days; ${g.runs[0].executionProfile})`, '');
  lines.push('### Wage per tier (mean, min-max over seeds)', '', formatWageBands(bands), '');
  lines.push('### Progression (first day/turn each milestone is reached, per seed)', '', formatProgression(g), '');
  lines.push(`### Per-day, seed ${g.runs[0].seed}`, '', formatPerDay(g.runs[0]), '');
  lines.push('### Telemetry (summed over seeds)', '', formatTelemetry(g), '');
  lines.push('### Effort (turns and days to earn each item, at the mean wage across seeds)', '', formatEffort(groupEffortTable(bands)), '');
  return lines.join('\n');
}

function formatWageBands(bands: Record<Tier, WageBand>): string {
  const lines = ['| tier | mean wage/turn | min-max |', '| --- | --- | --- |'];
  for (const t of [1, 2, 3] as Tier[]) {
    const b = bands[t];
    lines.push(`| ${t} | ${b ? b.mean.toFixed(2) : 'n/a'} | ${b ? `${b.min.toFixed(2)}-${b.max.toFixed(2)}` : 'n/a'} |`);
  }
  return lines.join('\n');
}

function formatProgression(g: PolicyGroup): string {
  const labels = orderedMilestones(g);
  if (labels.length === 0) return 'No milestone was reached by any seed.';
  const header = `| milestone | ${g.runs.map((r) => `seed ${r.seed} (day/turn)`).join(' | ')} |`;
  const sep = `| --- | ${g.runs.map(() => '---').join(' | ')} |`;
  const rows = labels.map((label) => {
    const cells = g.runs.map((r) => {
      const hit = r.wishlist.find((w) => w.item === label);
      return hit ? `${hit.day}/${hit.turn}` : 'not reached';
    });
    return `| ${label} | ${cells.join(' | ')} |`;
  });
  return [header, sep, ...rows].join('\n');
}

function formatPerDay(r: RunReport): string {
  const lines = ['| day | money | net worth | level | best gear tier |', '| --- | --- | --- | --- | --- |'];
  for (const d of r.perDay) lines.push(`| ${d.day} | ${d.money} | ${Math.round(d.netWorth)} | ${d.level} | ${d.tier} |`);
  return lines.join('\n');
}

function formatTelemetry(g: PolicyGroup): string {
  const sum = g.runs.reduce((acc, r) => {
    for (const k of Object.keys(acc) as (keyof Telemetry)[]) acc[k] += r.telemetry[k];
    return acc;
  }, zeroTelemetry());
  return JSON.stringify(sum);
}

function formatEffort(rows: EffortRow[]): string {
  const lines = ['| item | kind | tier | value | effort (turns) | effort (days) | band (turns) | reached |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const e of rows) {
    const days = (e.effort / TIME.turnsPerDay).toFixed(1);
    const band = `${e.band[0]}-${e.band[1]}${e.inBand ? '' : ' OUT'}`;
    lines.push(`| ${e.id} | ${e.kind} | ${e.tier} | ${e.value} | ${e.effort.toFixed(0)} | ${days} | ${band} | ${e.measured ? 'yes' : 'never'} |`);
  }
  return lines.join('\n');
}
