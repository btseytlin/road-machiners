// Paid services. Goods and part trade happen at any shop (src/sim/market.ts owns shop state). Supplies, repairs,
// mounting and garage storage are offered at any shop. Rebuilds and chassis need a town. Raider camps service raiders.
// Invalid requests throw: the UI only offers valid ones.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOODS } from "../data/goods";
import { shopDef } from "../data/market";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { NPC_UPKEEP } from "../data/npcs";
import { REGION, type TownDef } from "../data/region";
import { CONDITION } from "../data/wear";
import { fitStores, getResources } from "./resources";
import { isJunk, maxHp, partValue, rebuildJunk, restorePart, scrapPatchPart, scrapValue, wearFactor } from "./wear";
import { playerVehicle, vehicleById } from "./damage";
import { inFeud } from "./combat";
import { meetGoal } from "./npc-activities";
import { addState, endState, stateOf } from "./states";
import { inTowReach } from "./tow";
import { addCoreParts } from "./factory";
import { practice, skillEffect, vehicleHasPerk } from "./progress";
import { addStockPart, goodPrice, lotPrice, recordTrade, requireShop, shopAt, shopState, siteOf, takeStockPart } from "./market";
import { canUseSite, requireTown, townAt, townNear } from "./sites";
import { corePart, coreParts, freeCells, goodsCount, mountedParts } from "./grid";
import { addGoods, cargoRoom, mountPart, removeGoods, spareParts, stowPart } from "./inventory";
import type { NpcState, PartInstance, Vehicle, World } from "./types";
import { playerCommand } from "./world";
import { fuelCap, isStranded, isWorking, suppliesCap } from "./stats";

export type Supply = "fuel" | "supplies";

export function requireVehicleTown(
  world: World,
  vehicle: Vehicle,
  townId: string,
): void {
  const town = REGION.towns.find((t) => t.id === townId);
  if (!town || !canUseSite(vehicle.pos, town))
    throw new Error("Not at a gate of the requested town");
  if (
    vehicle.id !== world.player.vehicleId &&
    vehicle.speed > RULES.parkedSpeed
  )
    throw new Error("Stop before using town services");
}

// A vehicle trading at a shop must be at its gate, and an NPC must be parked.
export function requireVehicleShop(world: World, vehicle: Vehicle, shopId: string): void {
  if (!canUseSite(vehicle.pos, siteOf(shopId)))
    throw new Error(`Not at a gate of ${shopId}`);
  if (vehicle.id !== world.player.vehicleId && vehicle.speed > RULES.parkedSpeed)
    throw new Error("Stop before trading");
}

export function getTradePrice(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  direction: "buy" | "sell",
): number {
  const margin =
    vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread;
  return goodPrice(shopId, shopState(world, shopId), good, direction, margin);
}

// The total price of a whole lot, each unit priced at the pressure left by the unit before it.
export function getLotTradePrice(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  count: number,
  direction: "buy" | "sell",
): number {
  const margin =
    vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread;
  return lotPrice(shopId, shopState(world, shopId), good, direction, margin, count);
}

export function tradeGoods(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  count: number,
  direction: "buy" | "sell",
): void {
  requireVehicleShop(world, vehicle, shopId);
  if (!GOODS[good] || !Number.isInteger(count) || count <= 0)
    throw new Error(`Bad trade ${count} ${good}`);
  const total = getLotTradePrice(world, vehicle, shopId, good, count, direction);
  if (direction === "buy") buyGoods(world, vehicle, good, count, total);
  else sellGoods(world, vehicle, shopId, good, count, total);
  recordTrade(shopId, shopState(world, shopId), good, count, direction);
}

function buyGoods(world: World, vehicle: Vehicle, good: string, count: number, total: number): void {
  const resources = getResources(world, vehicle);
  if (resources.money < total) throw new Error("Not enough money");
  if (cargoRoom(vehicle, good) < count) throw new Error("Not enough cargo space");
  if (vehicle.id === world.player.vehicleId) noteCostBasis(world, good, total / count, count);
  const added = addGoods(world, vehicle, good, count);
  if (added !== count) throw new Error("Cargo capacity invariant failed");
  resources.money -= total;
}

// The player's average price paid per unit of a good, counting units already held. Call it before adding them.
export function noteCostBasis(world: World, good: string, price: number, count: number): void {
  const held = goodsCount(playerVehicle(world))[good] ?? 0;
  world.player.costBasis[good] = ((world.player.costBasis[good] ?? 0) * held + price * count) / (held + count);
}

function sellGoods(world: World, vehicle: Vehicle, shopId: string, good: string, count: number, total: number): void {
  const held = goodsCount(vehicle)[good] ?? 0;
  if (count > held) throw new Error(`Cannot sell ${count} ${good}, holding ${held}`);
  removeGoods(vehicle, good, count);
  getResources(world, vehicle).money += total;
  if (vehicle.id === world.player.vehicleId) practiceSale(world, shopId, good, total / count, count);
}

// The largest lot of `good` a buyer can both fit and afford at `shopId`, since a lot's total price
// rises unit by unit and a single-unit estimate can overshoot the budget.
export function affordableBuyCount(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  cap: number,
  budget: number,
): number {
  const unitPrice = getTradePrice(world, vehicle, shopId, good, "buy");
  let count = Math.max(0, Math.min(cap, Math.floor(budget / unitPrice)));
  while (count > 0 && getLotTradePrice(world, vehicle, shopId, good, count, "buy") > budget) count--;
  return count;
}

// Social XP comes from profit over the average price paid. A sale at a loss teaches nothing. The target is the buyer, a
// shop or a truck, and the good.
function practiceSale(world: World, buyer: string, good: string, price: number, count: number): void {
  const profit = (price - (world.player.costBasis[good] ?? 0)) * count;
  if (profit > 0) practice(world, "profit", profit, null, `${buyer}:${good}`);
}

// Sells every good the shop trades, keeping `retainedParts` units of the parts good, and every
// loose part, which joins the shop's stock.
export function sellVehicleCargo(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  retainedParts: number,
): void {
  requireVehicleShop(world, vehicle, shopId);
  const traded = shopDef(shopId).goods;
  for (const [good, count] of Object.entries(goodsCount(vehicle))) {
    const sellCount = good === 'parts' ? Math.max(0, count - retainedParts) : count;
    if (sellCount > 0 && traded.includes(good)) tradeGoods(world, vehicle, shopId, good, sellCount, "sell");
  }
  const resources = getResources(world, vehicle);
  const spares = spareParts(vehicle);
  for (const part of spares) {
    resources.money += partTradePrice(world, vehicle, part, "sell");
    addStockPart(shopState(world, shopId), part);
  }
  vehicle.items = vehicle.items.filter((item) => item.kind !== "part" || !spares.includes(item.part));
}

export function serviceVehicle(
  world: World,
  vehicle: Vehicle,
  townId: string,
  retainedParts: number,
): void {
  requireVehicleTown(world, vehicle, townId);
  sellVehicleCargo(world, vehicle, townId, retainedParts);
  refuelAndRepair(world, vehicle);
}

// A camp is a fence. It pays the NPC road price, the lowest in the region, keeps no stock and leaves the goods out of the world.
const CAMP_MARGIN = ECONOMY.spread + ECONOMY.roadSpread;

export function campGoodPrice(good: string): number {
  return roadGoodPrice(good, CAMP_MARGIN, "sell");
}

export function campPartPrice(part: PartInstance): number {
  return partPriceAt(part, CAMP_MARGIN, "sell");
}

function requireCampService(vehicle: Vehicle, campId: string): void {
  const camp = REGION.locations.find((l) => l.id === campId);
  if (camp?.kind !== "camp" || !canUseSite(vehicle.pos, camp))
    throw new Error("Not at a gate of the requested camp");
  if (vehicle.faction !== "raiders")
    throw new Error("Only raiders use camp services");
  if (vehicle.speed > RULES.parkedSpeed)
    throw new Error("Stop before using camp services");
}

// Sells every good above `retainedParts` units of parts, and every spare part, at the camp price. No shop state moves.
export function sellAtCamp(world: World, vehicle: Vehicle, campId: string, retainedParts: number): void {
  requireCampService(vehicle, campId);
  const resources = getResources(world, vehicle);
  for (const [good, count] of Object.entries(goodsCount(vehicle))) {
    const sellCount = good === "parts" ? Math.max(0, count - retainedParts) : count;
    if (sellCount <= 0) continue;
    removeGoods(vehicle, good, sellCount);
    resources.money += sellCount * campGoodPrice(good);
  }
  const spares = spareParts(vehicle);
  for (const part of spares) resources.money += campPartPrice(part);
  vehicle.items = vehicle.items.filter((item) => item.kind !== "part" || !spares.includes(item.part));
}

// A raider camp buys cargo, then sells fuel, supplies and repairs to raiders at the town rates.
export function serviceAtCamp(
  world: World,
  vehicle: Vehicle,
  campId: string,
  retainedParts: number,
): void {
  sellAtCamp(world, vehicle, campId, retainedParts);
  refuelAndRepair(world, vehicle);
}

// What the carried cargo sells for at a buyer: a camp buys any good, a shop only the goods it trades.
export function cargoSaleValue(world: World, vehicle: Vehicle, buyerId: string): number {
  const camp = REGION.locations.find((l) => l.id === buyerId)?.kind === "camp";
  return Object.entries(goodsCount(vehicle)).reduce((sum, [good, count]) => {
    if (camp) return sum + count * campGoodPrice(good);
    return sum + (shopDef(buyerId).goods.includes(good) ? count * getTradePrice(world, vehicle, buyerId, good, "sell") : 0);
  }, 0);
}

// A roadside stall buys an NPC's cargo that it trades, then fuels, resupplies and repairs it like a town garage. Raiders use camps only.
export function serviceAtStall(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  retainedParts: number,
): void {
  if (shopDef(shopId).kind !== "stall") throw new Error(`${shopId} is no stall`);
  if (vehicle.faction === "raiders") throw new Error("Only non-raiders use stall services");
  sellVehicleCargo(world, vehicle, shopId, retainedParts);
  refuelAndRepair(world, vehicle);
}

// A driver in debt buys nothing.
function refuelAndRepair(world: World, vehicle: Vehicle): void {
  topUp(world, vehicle, ['fuel', 'supplies']);
  const resources = getResources(world, vehicle);
  if (resources.money < 0) return;
  const multiplier =
    vehicle.id === world.player.vehicleId ? repairMult(world) : 1;
  for (const part of repairableParts(vehicle)) {
    // Same formula as partRepairCost: a share of the part's value per HP share restored.
    const unitCost = (ECONOMY.repairShare * partValue(part) * multiplier) / maxHp(part);
    const hp = Math.min(
      maxHp(part) - part.hp,
      Math.floor(resources.money / unitCost),
    );
    restorePart(part, part.hp + hp);
    resources.money -= Math.ceil(hp * unitCost);
  }
}

// Fills the tank as far as the money goes, for a driver doing business at a pump.
export function buyFuel(world: World, vehicle: Vehicle): void {
  topUp(world, vehicle, ['fuel']);
}

// Fills each kind up to its cap, as far as the money goes. A driver in debt buys nothing.
function topUp(world: World, vehicle: Vehicle, kinds: readonly Supply[]): void {
  const resources = getResources(world, vehicle);
  if (resources.money < 0) return;
  for (const kind of kinds) {
    const cap =
      kind === 'fuel'
        ? fuelCap(vehicle)
        : suppliesCap(vehicle);
    const count = Math.max(
      0,
      Math.min(
        Math.floor(cap - resources[kind]),
        Math.floor(resources.money / ECONOMY.supplyPrice[kind]),
      ),
    );
    resources[kind] += count;
    resources.money -= count * ECONOMY.supplyPrice[kind];
  }
}

// ---- Scrap patch: a broke player stranded or low on fuel at a town gets going again, so the run never locks up.

// Runs each turn. It fires when the player is stranded or at or below RULES.lowFuelThreshold of the tank, on a town pad,
// and money plus everything the town would buy cannot pay for the fix. A stranded player gets the engine, transmission,
// wheels and tank raised to RULES.scrapPatch of max HP, a junk engine included. A low tank is topped up to RULES.scrapPatch
// of its cap. A truck with no engine gets nothing, as no patch makes one.
export function scrapPatch(world: World): void {
  const town = needsPatchInTown(world);
  if (!town) return;
  const me = playerVehicle(world);
  if (canPayFix(world, me, town.id)) return;
  if (isStranded(world, me)) for (const part of driveParts(me)) scrapPatchPart(part, RULES.scrapPatch);
  const fuel = scrapFuel(world, me);
  world.events.push({ t: 'scrapPatch', fuel });
}

// The fuel that lifts a tank at or below RULES.lowFuelThreshold of its cap up to RULES.scrapPatch of it, else 0.
export function scrapFuelNeed(world: World, v: Vehicle): number {
  const cap = fuelCap(v);
  const fuel = getResources(world, v).fuel;
  return fuel <= cap * RULES.lowFuelThreshold ? Math.max(0, cap * RULES.scrapPatch - fuel) : 0;
}

// Adds the scrap fuel and returns the amount. It checks neither pay nor site, so the caller decides who gets it.
export function scrapFuel(world: World, v: Vehicle): number {
  const fuel = scrapFuelNeed(world, v);
  getResources(world, v).fuel += fuel;
  return fuel;
}

// The player command for opening a shop, a town or a stall, at its gate. The first time on a visit, each worn critical
// part rises to RULES.townPatch of max HP for free, and the log says so. Junk parts stay junk. Leaving the shop ends the
// visit, in endTurn.
export function enterTown(world: World): World {
  return playerCommand(world, (w) => {
    if (!shopAt(w)) throw new Error('Not at a shop gate');
    if (w.player.townPatched) return;
    w.player.townPatched = true;
    const worn = criticalParts(playerVehicle(w)).filter((part) => !isJunk(part) && part.hp < Math.ceil(maxHp(part) * RULES.townPatch));
    for (const part of worn) scrapPatchPart(part, RULES.townPatch);
    if (worn.length > 0) w.events.push({ t: 'townPatch' });
  });
}

// The first engine, the transmission, the wheels, the tank and the cab.
function criticalParts(v: Vehicle): PartInstance[] {
  return [...driveParts(v), corePart(v, 'cab')];
}

function needsPatchInTown(world: World): TownDef | null {
  const me = playerVehicle(world);
  if (world.player.state !== 'active' || mountedParts(me, 'engine').length === 0) return null;
  if (!isStranded(world, me) && scrapFuelNeed(world, me) === 0) return null;
  return townNear(world);
}

// Whether the player can buy the fix, after selling all they can at the shop: garage repair of each broken drive
// part and the patch fuel at the pump. A junk engine the garage cannot rebuild has no price.
function canPayFix(world: World, v: Vehicle, shopId: string): boolean {
  const broken = driveParts(v).filter((p) => !isWorking(p));
  if (broken.some((p) => isJunk(p) && !canRebuild(world, p))) return false;
  const repairs = broken.reduce((sum, p) => sum + partRepairCost(world, p), 0);
  const cost = repairs + Math.ceil(scrapFuelNeed(world, v)) * ECONOMY.supplyPrice.fuel;
  return world.player.money + saleValue(world, v, shopId) >= cost;
}

// The first engine, the transmission, the wheels and the tank.
function driveParts(v: Vehicle): PartInstance[] {
  const engine = mountedParts(v, 'engine').slice(0, 1);
  return [...engine, corePart(v, 'transmission'), ...coreParts(v, 'wheel'), corePart(v, 'tank')];
}

// The money the shop pays for goods it buys, spare parts, mounted parts other than the engine, and parts in
// garage storage.
function saleValue(world: World, v: Vehicle, shopId: string): number {
  const shop = shopDef(shopId);
  const goods = Object.entries(goodsCount(v))
    .filter(([good, count]) => count > 0 && shop.goods.includes(good))
    .reduce((sum, [good, count]) => sum + getLotTradePrice(world, v, shopId, good, count, 'sell'), 0);
  const engine = mountedParts(v, 'engine')[0];
  const mounted = mountedParts(v).filter((p) => p !== engine && partDef(p.defId).kind !== 'core');
  const parts = [...mounted, ...spareParts(v), ...world.player.storage];
  return goods + parts.reduce((sum, p) => sum + partTradePrice(world, v, p, 'sell'), 0);
}

// The player's trade margin: the base spread narrowed by the Social skill.
export function spread(world: World): number {
  return Math.max(
    0,
    ECONOMY.spread - skillEffect(world, playerVehicle(world), "social", "priceSpread"),
  );
}

export function buyPrice(world: World, shopId: string, good: string): number {
  return getTradePrice(world, playerVehicle(world), shopId, good, "buy");
}

export function sellPrice(world: World, shopId: string, good: string): number {
  return getTradePrice(world, playerVehicle(world), shopId, good, "sell");
}

function repairMult(world: World): number {
  return Math.max(
    0,
    1 - skillEffect(world, playerVehicle(world), "machining", "repair"),
  );
}

// A player in debt cannot buy anything, even at no cost.
function pay(world: World, amount: number, reason: string): void {
  if (world.player.money < 0 || amount > world.player.money)
    throw new Error(`Not enough money for ${reason}`);
  world.player.money -= amount;
}

export function buyGood(world: World, good: string, n: number): World {
  return playerCommand(world, (w) => {
    tradeGoods(w, playerVehicle(w), requireShop(w), good, n, "buy");
  });
}

export function sellGood(world: World, good: string, n: number): World {
  return playerCommand(world, (w) => {
    tradeGoods(w, playerVehicle(w), requireShop(w), good, n, "sell");
  });
}

export function supplyRoom(world: World, kind: Supply): number {
  const p = world.player;
  const cap =
    kind === 'fuel'
      ? fuelCap(playerVehicle(world))
      : suppliesCap(playerVehicle(world));
  return Math.max(0, Math.floor(cap - p[kind]));
}

export function buySupply(world: World, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    if (!shopDef(shopId).supplies.includes(kind))
      throw new Error(`${shopId} does not sell ${kind}`);
    if (n <= 0 || n > supplyRoom(w, kind))
      throw new Error(`Cannot buy ${n} ${kind}`);
    pay(w, ECONOMY.supplyPrice[kind] * n, kind);
    w.player[kind] += n;
  });
}

// A share of the part's value per HP share restored, times Machining. A broken part (0 HP) pays
// the same formula for a full rebuild. A junk part the Rebuild perk can rebuild pays a full repair at
// the last wear step. Throws for any other junk part.
export function partRepairCost(world: World, part: PartInstance): number {
  if (isJunk(part)) {
    if (!canRebuild(world, part))
      throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
    return partRepairCost(world, { ...part, wear: CONDITION.maxWear, hp: 0 });
  }
  const missingShare = 1 - part.hp / maxHp(part);
  return Math.ceil(
    ECONOMY.repairShare * partValue(part) * missingShare * repairMult(world),
  );
}

export function repairPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    requireShop(w);
    const part = allParts(playerVehicle(w)).find((p) => p.id === partId);
    if (!part) throw new Error(`No truck part ${partId}`);
    pay(w, partRepairCost(w, part), "repairs");
    garageRepair(part);
  });
}

// The Rebuild perk lets a town garage rebuild a player's junk part once.
export function canRebuild(world: World, part: PartInstance): boolean {
  return townAt(world) !== null && isJunk(part) && !part.rebuilt && vehicleHasPerk(world, playerVehicle(world), "rebuild");
}

// Full HP for a repairable part, or a rebuild for junk. partRepairCost already refused junk that cannot be rebuilt.
function garageRepair(part: PartInstance): void {
  if (isJunk(part)) rebuildJunk(part);
  else restorePart(part, maxHp(part));
}

function repairParts(world: World, pick: (w: World, v: Vehicle) => PartInstance[]): World {
  return playerCommand(world, (w) => {
    requireShop(w);
    const parts = pick(w, playerVehicle(w));
    pay(w, costOf(w, parts), "repairs");
    for (const p of parts) garageRepair(p);
  });
}

export function repairAll(world: World): World {
  return repairParts(world, garageParts);
}

// Only the built-in parts: cab, transmission, wheels and fuel tank.
export function repairBasics(world: World): World {
  return repairParts(world, basicParts);
}

// Buy or sell price at one place, both scaled by the part's current condition (HP share), not only
// its wear. The spread is added on top for buy and cut for sell, so buy always rounds to strictly
// above sell (IV4), even at the narrowest Social skill spread. Both are floored at the scrap value.
export function partTradePrice(world: World, vehicle: Vehicle, part: PartInstance, direction: 'buy' | 'sell'): number {
  return partPriceAt(part, vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread, direction);
}

// The player's price for a part traded with a truck on the road, at the road spread.
export function truckPartPrice(world: World, part: PartInstance, direction: 'buy' | 'sell'): number {
  return partPriceAt(part, roadSpread(world), direction);
}

function partPriceAt(part: PartInstance, margin: number, direction: 'buy' | 'sell'): number {
  const pressured = partValue(part) * (part.hp / maxHp(part));
  const floor = Math.round(scrapValue(part));
  const buy = Math.max(floor + 1, Math.ceil(pressured * (1 + margin)));
  if (direction === 'buy') return buy;
  return Math.max(floor, Math.min(buy - 1, Math.floor(pressured * (1 - margin))));
}

// A world-free, skill-free sell quote for garage storage listings, which have no vehicle context.
export function partSellPrice(part: PartInstance): number {
  return Math.max(
    Math.round(scrapValue(part)),
    Math.round(partValue(part) * (part.hp / maxHp(part)) * (1 - ECONOMY.spread)),
  );
}

// Buys a part from the stock of the shop the player is parked at. It goes into the truck grid, or
// into garage storage when the grid has no room.
export function buyStockPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    const part = takeStockPart(shopState(w, shopId), partId);
    pay(w, partTradePrice(w, playerVehicle(w), part, "buy"), partDef(part.defId).name);
    if (!stowPart(w, playerVehicle(w), part)) w.player.storage.push(part);
  });
}

// Sells a spare part from the truck grid, or from garage storage. It joins the shop's stock.
export function sellPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    const part = takeSellablePart(w, partId);
    w.player.money += partTradePrice(w, playerVehicle(w), part, "sell");
    addStockPart(shopState(w, shopId), part);
  });
}

function takeSellablePart(world: World, partId: string): PartInstance {
  const me = playerVehicle(world);
  const spare = spareParts(me).find((p) => p.id === partId);
  if (spare) {
    me.items = me.items.filter((it) => it.kind !== "part" || it.part.id !== partId);
    return spare;
  }
  const i = world.player.storage.findIndex((p) => p.id === partId);
  if (i < 0) throw new Error(`No sellable part ${partId} here`);
  return world.player.storage.splice(i, 1)[0];
}

// The trade-in is the chassis sell price: value less the sell spread, scaled by the mean health and
// the mean wear of the built-in parts.
export function chassisTradeIn(world: World): number {
  const me = playerVehicle(world);
  const core = mountedParts(me, "core");
  const health =
    core.reduce((a, p) => a + p.hp / maxHp(p), 0) / core.length;
  const meanWear = core.reduce((a, p) => a + p.wear, 0) / core.length;
  return Math.floor(
    chassisDef(me.chassisId).value *
      (1 - spread(world)) *
      health *
      wearFactor(meanWear),
  );
}

function costOf(world: World, parts: PartInstance[]): number {
  return parts.reduce((a, p) => a + partRepairCost(world, p), 0);
}

export function repairCost(world: World): number {
  return costOf(world, garageParts(world, playerVehicle(world)));
}

export function basicsRepairCost(world: World): number {
  return costOf(world, basicParts(world, playerVehicle(world)));
}

function allParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === "part" ? [it.part] : []));
}

// Repairs skip junk parts, which no repair rebuilds.
function repairableParts(v: Vehicle): PartInstance[] {
  return allParts(v).filter((p) => !isJunk(p));
}

// The player's town garage also takes junk parts the Rebuild perk can rebuild.
function garageParts(world: World, v: Vehicle): PartInstance[] {
  return allParts(v).filter((p) => !isJunk(p) || canRebuild(world, p));
}

function basicParts(world: World, v: Vehicle): PartInstance[] {
  return garageParts(world, v).filter((p) => partDef(p.defId).kind === "core");
}

// Swap chassis: the old built-in parts go with the old chassis and the new one brings its own.
// Mounted parts move to free mounts, spares and goods to free cells, and parts that do not fit go to
// garage storage. Goods that do not fit block the swap. The old chassis is traded in.
// Pays the new chassis's price less the trade-in. A trade-in that beats the price refunds the
// difference instead of charging nothing.
function payChassisCost(world: World, chassisId: string): void {
  const cost = chassisDef(chassisId).value - chassisTradeIn(world);
  if (cost >= 0) pay(world, cost, chassisDef(chassisId).name);
  else world.player.money -= cost;
}

export function buyChassis(world: World, chassisId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    if (!PLAYER_CHASSIS.includes(chassisId))
      throw new Error(`${chassisId} is not for sale`);
    const me = playerVehicle(w);
    if (me.chassisId === chassisId)
      throw new Error("You already drive this chassis");
    payChassisCost(w, chassisId);
    const mounted = new Set(mountedParts(me).map((p) => p.id));
    const goods = goodsCount(me);
    const old = me.items;
    me.chassisId = chassisId;
    me.items = [];
    addCoreParts(w, me);
    // Cargo parts first: their extra rows make room for the rest.
    const parts = old.flatMap((it) =>
      it.kind === "part" && partDef(it.part.defId).kind !== "core"
        ? [it.part]
        : [],
    );
    parts.sort(
      (a, b) =>
        Number(partDef(b.defId).kind === "cargo") -
        Number(partDef(a.defId).kind === "cargo"),
    );
    for (const part of parts) {
      const placed = mounted.has(part.id)
        ? mountPart(w, me, part) || stowPart(w, me, part)
        : stowPart(w, me, part);
      if (!placed) w.player.storage.push(part);
    }
    for (const [good, n] of Object.entries(goods)) {
      if (addGoods(w, me, good, n) < n)
        throw new Error(
          "Cargo would not fit the new chassis. Sell some first.",
        );
    }
    me.weaponOrders = {};
    fitStores(w, me);
  });
}

// Trade with an NPC truck. A radio call starts a `trade` state held by the NPC toward the player, and the NPC's
// meet goal brings it alongside. Trades run only while both trucks are parked in reach.

function isParked(v: Vehicle): boolean {
  return v.speed <= RULES.parkedSpeed;
}

// The trade meeting this driver holds with the player, or null.
export function tradeWith(world: World, npc: Vehicle): NpcState | null {
  return stateOf(world, "trade", npc.id, world.player.vehicleId);
}

export function startTrade(world: World, npc: Vehicle): void {
  addState(world, "trade", npc.id, world.player.vehicleId, { kind: "none" });
  meetGoal(world, npc, playerVehicle(world), "pull over to trade");
}

// Both trucks of the meeting are parked in reach. It keeps the meeting from lapsing.
export function isMeeting(world: World, s: NpcState): boolean {
  const npc = vehicleById(world, s.holder);
  const me = vehicleById(world, s.other);
  return isParked(npc) && isParked(me) && inTowReach(npc, me);
}

// A feud between the two calls the meeting off. A missing party is left to the missing-party rule.
export function checkTrade(world: World, s: NpcState): "broken" | null {
  const npc = world.vehicles.find((v) => v.id === s.holder);
  const me = world.vehicles.find((v) => v.id === s.other);
  return npc && me && inFeud(world, npc, me) ? "broken" : null;
}

// The NPC with an agreed trade, met or still on its way, or null.
export function tradePartner(world: World): Vehicle | null {
  const s = world.states.find((x) => x.kind === "trade" && x.other === world.player.vehicleId);
  return s ? vehicleById(world, s.holder) : null;
}

// The NPC the player can trade with now, or null.
export function tradeReady(world: World): Vehicle | null {
  const s = world.states.find((x) => x.kind === "trade" && x.other === world.player.vehicleId && isMeeting(world, x));
  return s ? vehicleById(world, s.holder) : null;
}

// The meeting with this NPC, which must be under way now. Every trade command checks it first.
function requireMeeting(world: World, npcId: string): { npc: Vehicle; state: NpcState } {
  const npc = vehicleById(world, npcId);
  const state = tradeWith(world, npc);
  if (!state) throw new Error(`No trade agreed with ${npc.name}`);
  if (!isMeeting(world, state)) throw new Error("Both trucks must be parked side by side");
  return { npc, state };
}

// The player is done trading. The NPC drops its meet goal on its next think.
export function endTrade(world: World, npcId: string): World {
  return playerCommand(world, (w) => endState(w, requireMeeting(w, npcId).state, "fulfilled"));
}

// A truck on the road trades at the player's spread plus the road spread. Social skill narrows it as in town.
function roadSpread(world: World): number {
  return spread(world) + ECONOMY.roadSpread;
}

// Trucks keep no price pressure, so a good trades at its base value with the road spread either way.
export function truckGoodPrice(world: World, good: string, direction: "buy" | "sell"): number {
  return roadGoodPrice(good, roadSpread(world), direction);
}

function roadGoodPrice(good: string, margin: number, direction: "buy" | "sell"): number {
  const def = GOODS[good];
  if (!def) throw new Error(`Unknown good ${good}`);
  const buy = Math.max(1, Math.ceil(def.value * (1 + margin)));
  return direction === "buy" ? buy : Math.max(0, Math.min(buy - 1, Math.floor(def.value * (1 - margin))));
}

// A truck charges the town price plus the road spread, since it sells from its own tank.
export function truckSupplyPrice(world: World, kind: Supply): number {
  return Math.ceil(ECONOMY.supplyPrice[kind] * (1 + roadSpread(world)));
}

// Whole units the driver will sell: what it holds above its reserve share of its cap.
export function truckSupplyForSale(npc: Vehicle, kind: Supply): number {
  const cap = kind === 'fuel' ? fuelCap(npc) : suppliesCap(npc);
  const held = npc.resources![kind];
  return Math.max(0, Math.floor(held - cap * NPC_UPKEEP.tradeReserve));
}

// Units of a good the driver will sell. It keeps its field repair parts.
export function truckGoodsForSale(npc: Vehicle, good: string): number {
  const held = goodsCount(npc)[good] ?? 0;
  return good === "parts" ? Math.max(0, held - NPC_UPKEEP.repairParts) : held;
}

function requireCount(n: number): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Bad trade count ${n}`);
}

// Moves money from payer to payee. A payer in debt or short of the amount throws.
export function transfer(world: World, payer: Vehicle, payee: Vehicle, amount: number): void {
  const from = getResources(world, payer);
  if (from.money < 0 || from.money < amount) throw new Error(payer.id === world.player.vehicleId ? 'Not enough money' : `${payer.name} cannot pay that much`);
  from.money -= amount;
  getResources(world, payee).money += amount;
}

export function buyTruckGood(world: World, npcId: string, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    requireCount(n);
    if (truckGoodsForSale(npc, good) < n) throw new Error(`${npc.name} will not sell ${n} ${GOODS[good].name}`);
    if (freeCells(me) < n) throw new Error("Not enough cargo space");
    const price = truckGoodPrice(w, good, "buy");
    transfer(w, me, npc, price * n);
    noteCostBasis(w, good, price, n);
    removeGoods(npc, good, n);
    if (addGoods(w, me, good, n) !== n) throw new Error("Cargo capacity invariant failed");
  });
}

export function sellTruckGood(world: World, npcId: string, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    requireCount(n);
    if ((goodsCount(me)[good] ?? 0) < n) throw new Error(`Cannot sell ${n} ${GOODS[good].name}`);
    if (cargoRoom(npc, good) < n) throw new Error(`No room on ${npc.name}'s truck`);
    const price = truckGoodPrice(w, good, "sell");
    transfer(w, npc, me, price * n);
    removeGoods(me, good, n);
    if (addGoods(w, npc, good, n) !== n) throw new Error("Cargo capacity invariant failed");
    practiceSale(w, npc.id, good, price, n);
  });
}

function takeSpare(v: Vehicle, partId: string): PartInstance {
  const part = spareParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${v.name} has no spare part ${partId}`);
  v.items = v.items.filter((it) => it.kind !== "part" || it.part.id !== partId);
  return part;
}

export function buyTruckPart(world: World, npcId: string, partId: string): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    const part = takeSpare(npc, partId);
    transfer(w, me, npc, truckPartPrice(w, part, "buy"));
    if (!stowPart(w, me, part)) throw new Error(`No room in the truck for ${partDef(part.defId).name}`);
  });
}

export function sellTruckPart(world: World, npcId: string, partId: string): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    const part = takeSpare(me, partId);
    transfer(w, npc, me, truckPartPrice(w, part, "sell"));
    if (!stowPart(w, npc, part)) throw new Error(`No room on ${npc.name}'s truck for ${partDef(part.defId).name}`);
  });
}

export function buyTruckSupply(world: World, npcId: string, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    requireCount(n);
    if (n > truckSupplyForSale(npc, kind)) throw new Error(`${npc.name} will not sell that much ${kind}`);
    if (n > supplyRoom(w, kind)) throw new Error(`No room for ${n} ${kind}`);
    transfer(w, playerVehicle(w), npc, truckSupplyPrice(w, kind) * n);
    npc.resources![kind] -= n;
    w.player[kind] += n;
  });
}
