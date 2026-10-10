// Paid services. Goods and part trade happen at any shop (src/sim/market.ts owns shop state). Supplies, repairs,
// mounting and garage storage are offered at any shop. Rebuilds and chassis need a town. Raider camps service raiders.
// Invalid requests throw: the UI only offers valid ones.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOODS } from "../data/goods";
import { shopDef } from "../data/market";
import { UNITS } from "../data/units";
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
import { playerCommand, Refused } from "./world";
import { tankLeaks } from "./supplies";
import { fuelCap, isStranded, isWorking, suppliesCap } from "./stats";
import { modeRules } from './settings';

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
  if (resources.money < total) throw new Refused({ id: "noMoney" });
  if (cargoRoom(vehicle, good) < count) throw new Refused({ id: "noCargoRoom" });
  if (vehicle.id === world.player.vehicleId) noteCostBasis(world, good, total / count, count);
  const added = addGoods(world, vehicle, good, count);
  if (added !== count) throw new Error("Cargo capacity invariant failed");
  resources.money -= total;
}

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

function practiceSale(world: World, buyer: string, good: string, price: number, count: number): void {
  const profit = (price - (world.player.costBasis[good] ?? 0)) * count;
  if (profit > 0) practice(world, "profit", profit, null, `${buyer}:${good}`);
}

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

export function serviceAtCamp(
  world: World,
  vehicle: Vehicle,
  campId: string,
  retainedParts: number,
): void {
  sellAtCamp(world, vehicle, campId, retainedParts);
  refuelAndRepair(world, vehicle);
}

export function cargoSaleValue(world: World, vehicle: Vehicle, buyerId: string): number {
  const camp = REGION.locations.find((l) => l.id === buyerId)?.kind === "camp";
  return Object.entries(goodsCount(vehicle)).reduce((sum, [good, count]) => {
    if (camp) return sum + count * campGoodPrice(good);
    return sum + (shopDef(buyerId).goods.includes(good) ? count * getTradePrice(world, vehicle, buyerId, good, "sell") : 0);
  }, 0);
}

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

function refuelAndRepair(world: World, vehicle: Vehicle): void {
  topUp(world, vehicle, ['fuel', 'supplies']);
  const resources = getResources(world, vehicle);
  if (resources.money < 0) return;
  const multiplier =
    vehicle.id === world.player.vehicleId ? repairMult(world) : 1;
  for (const part of repairableParts(vehicle)) {
    const unitCost = (ECONOMY.repairShare * partValue(part) * multiplier) / maxHp(part);
    const hp = Math.min(
      maxHp(part) - part.hp,
      Math.floor(resources.money / unitCost),
    );
    restorePart(part, part.hp + hp);
    resources.money -= Math.ceil(hp * unitCost);
  }
}

export function buyFuel(world: World, vehicle: Vehicle): void {
  topUp(world, vehicle, ['fuel']);
}

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

export function scrapPatch(world: World): void {
  if (!modeRules(world).rescue) return;
  const town = needsPatchInTown(world);
  if (!town) return;
  const me = playerVehicle(world);
  if (canPayFix(world, me, town.id)) return;
  if (isStranded(world, me)) for (const part of driveParts(me)) scrapPatchPart(part, RULES.scrapPatch);
  const fuel = scrapFuel(world, me);
  world.events.push({ t: 'scrapPatch', fuel });
}

export function scrapFuelNeed(world: World, v: Vehicle): number {
  const cap = fuelCap(v);
  const fuel = getResources(world, v).fuel;
  return fuel <= cap * RULES.lowFuelThreshold ? Math.max(0, cap * RULES.scrapPatch - fuel) : 0;
}

export function scrapFuel(world: World, v: Vehicle): number {
  const fuel = scrapFuelNeed(world, v);
  if (fuel > 0 && tankLeaks(v)) scrapPatchPart(corePart(v, 'tank'), RULES.scrapPatch);
  getResources(world, v).fuel += fuel;
  return fuel;
}

export function enterTown(world: World): World {
  return playerCommand(world, (w) => {
    if (!shopAt(w)) throw new Error('Not at a shop gate');
    if (w.player.townPatched || !modeRules(w).rescue) return;
    w.player.townPatched = true;
    const worn = criticalParts(playerVehicle(w)).filter((part) => !isJunk(part) && part.hp < Math.ceil(maxHp(part) * RULES.townPatch));
    for (const part of worn) scrapPatchPart(part, RULES.townPatch);
    if (worn.length > 0) w.events.push({ t: 'townPatch' });
  });
}

function criticalParts(v: Vehicle): PartInstance[] {
  return [...driveParts(v), corePart(v, 'cab')];
}

function needsPatchInTown(world: World): TownDef | null {
  const me = playerVehicle(world);
  if (world.player.state !== 'active' || mountedParts(me, 'engine').length === 0) return null;
  if (!isStranded(world, me) && scrapFuelNeed(world, me) === 0) return null;
  return townNear(world);
}

function canPayFix(world: World, v: Vehicle, shopId: string): boolean {
  const broken = driveParts(v).filter((p) => !isWorking(p));
  if (broken.some((p) => isJunk(p) && !canRebuild(world, p))) return false;
  const repairs = broken.reduce((sum, p) => sum + partRepairCost(world, p), 0);
  const cost = repairs + Math.ceil(scrapFuelNeed(world, v)) * ECONOMY.supplyPrice.fuel;
  return world.player.money + saleValue(world, v, shopId) >= cost;
}

function driveParts(v: Vehicle): PartInstance[] {
  const engine = mountedParts(v, 'engine').slice(0, 1);
  return [...engine, corePart(v, 'transmission'), ...coreParts(v, 'wheel'), corePart(v, 'tank')];
}

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
export function pay(world: World, amount: number): void {
  if (world.player.money < 0 || amount > world.player.money) throw new Refused({ id: 'noMoney' });
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
    pay(w, ECONOMY.supplyPrice[kind] * n);
    w.player[kind] += n;
  });
}

export function partRepairCost(world: World, part: PartInstance): number {
  if (isJunk(part)) {
    if (!canRebuild(world, part))
      throw new Error(`${part.defId} is junk and cannot be rebuilt`);
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
    pay(w, partRepairCost(w, part));
    garageRepair(part);
  });
}

export function canRebuild(world: World, part: PartInstance): boolean {
  return townAt(world) !== null && isJunk(part) && !part.rebuilt && vehicleHasPerk(world, playerVehicle(world), "rebuild");
}

export function garageRepair(part: PartInstance): void {
  if (isJunk(part)) rebuildJunk(part);
  else restorePart(part, maxHp(part));
}

function repairParts(world: World, pick: (w: World, v: Vehicle) => PartInstance[]): World {
  return playerCommand(world, (w) => {
    requireShop(w);
    const parts = pick(w, playerVehicle(w));
    pay(w, costOf(w, parts));
    for (const p of parts) garageRepair(p);
  });
}

export function repairAll(world: World): World {
  return repairParts(world, garageParts);
}

export function repairBasics(world: World): World {
  return repairParts(world, basicParts);
}

export function repairDrive(world: World): World {
  return repairParts(world, brokenDriveParts);
}

export function partTradePrice(world: World, vehicle: Vehicle, part: PartInstance, direction: 'buy' | 'sell'): number {
  return partPriceAt(part, vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread, direction);
}

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

export function partSellPrice(part: PartInstance): number {
  return Math.max(
    Math.round(scrapValue(part)),
    Math.round(partValue(part) * (part.hp / maxHp(part)) * (1 - ECONOMY.spread)),
  );
}

export function buyStockPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    const part = takeStockPart(shopState(w, shopId), partId);
    pay(w, partTradePrice(w, playerVehicle(w), part, "buy"));
    if (!stowPart(w, playerVehicle(w), part)) w.player.storage.push(part);
  });
}

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

function repairableParts(v: Vehicle): PartInstance[] {
  return allParts(v).filter((p) => !isJunk(p));
}

export function garageParts(world: World, v: Vehicle): PartInstance[] {
  return allParts(v).filter((p) => !isJunk(p) || canRebuild(world, p));
}

export function basicParts(world: World, v: Vehicle): PartInstance[] {
  return garageParts(world, v).filter((p) => partDef(p.defId).kind === "core");
}

function brokenDriveParts(world: World, v: Vehicle): PartInstance[] {
  return driveParts(v).filter((p) => !isWorking(p) && (!isJunk(p) || canRebuild(world, p)));
}

export function driveRepairCost(world: World): number {
  return costOf(world, brokenDriveParts(world, playerVehicle(world)));
}

function payChassisCost(world: World, chassisId: string): void {
  const cost = chassisDef(chassisId).value - chassisTradeIn(world);
  if (cost >= 0) pay(world, cost);
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

function isParked(v: Vehicle): boolean {
  return v.speed <= RULES.parkedSpeed;
}

export function tradeWith(world: World, npc: Vehicle): NpcState | null {
  return stateOf(world, "trade", npc.id, world.player.vehicleId);
}

export function startTrade(world: World, npc: Vehicle): void {
  addState(world, "trade", npc.id, world.player.vehicleId, { kind: "none" });
  meetGoal(world, npc, playerVehicle(world), "pullOver");
}

export function inMeetingReach(world: World, s: NpcState): boolean {
  return inTowReach(vehicleById(world, s.holder), vehicleById(world, s.other));
}

export function isMeeting(world: World, s: NpcState): boolean {
  return isParked(vehicleById(world, s.holder)) && isParked(vehicleById(world, s.other)) && inMeetingReach(world, s);
}

export function checkTrade(world: World, s: NpcState): "broken" | null {
  const npc = world.vehicles.find((v) => v.id === s.holder);
  const me = world.vehicles.find((v) => v.id === s.other);
  return npc && me && inFeud(world, npc, me) ? "broken" : null;
}

export function playerTrades(world: World): NpcState[] {
  return world.states.filter((x) => x.kind === "trade" && x.other === world.player.vehicleId);
}

export function canTradeWith(world: World, npcId: string): boolean {
  const s = playerTrades(world).find((x) => x.holder === npcId);
  return s !== undefined && isMeeting(world, s);
}

export function tradeReady(world: World): Vehicle | null {
  const s = world.states.find((x) => x.kind === "trade" && x.other === world.player.vehicleId && isMeeting(world, x));
  return s ? vehicleById(world, s.holder) : null;
}

function requireMeeting(world: World, npcId: string): { npc: Vehicle; state: NpcState } {
  const npc = vehicleById(world, npcId);
  const state = tradeWith(world, npc);
  if (!state) throw new Error(`No trade agreed with ${npc.id}`);
  if (!isMeeting(world, state)) throw new Error("Both trucks must be parked side by side");
  return { npc, state };
}

export function endTrade(world: World, npcId: string): World {
  return playerCommand(world, (w) => endState(w, requireMeeting(w, npcId).state, "fulfilled"));
}

function roadSpread(world: World): number {
  return spread(world) + ECONOMY.roadSpread;
}

export function truckGoodPrice(world: World, good: string, direction: "buy" | "sell"): number {
  return roadGoodPrice(good, roadSpread(world), direction);
}

function roadGoodPrice(good: string, margin: number, direction: "buy" | "sell"): number {
  const def = GOODS[good];
  if (!def) throw new Error(`Unknown good ${good}`);
  const buy = Math.max(1, Math.ceil(def.value * (1 + margin)));
  return direction === "buy" ? buy : Math.max(0, Math.min(buy - 1, Math.floor(def.value * (1 - margin))));
}

export function truckSupplyPrice(world: World, kind: Supply): number {
  return Math.ceil(ECONOMY.supplyPrice[kind] * (1 + roadSpread(world)));
}

export function truckSupplyForSale(npc: Vehicle, kind: Supply): number {
  const cap = kind === 'fuel' ? fuelCap(npc) : suppliesCap(npc);
  const held = npc.resources![kind];
  return Math.max(0, Math.floor(held - cap * NPC_UPKEEP.tradeReserve));
}

export function truckGoodsForSale(npc: Vehicle, good: string): number {
  const held = goodsCount(npc)[good] ?? 0;
  return good === "parts" ? Math.max(0, held - NPC_UPKEEP.repairParts) : held;
}

function requireCount(n: number): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Bad trade count ${n}`);
}

export function transfer(world: World, payer: Vehicle, payee: Vehicle, amount: number): void {
  const from = getResources(world, payer);
  const short = from.money < 0 || from.money < amount;
  if (short && payer.id === world.player.vehicleId) throw new Refused({ id: 'noMoney' });
  if (short) throw new Error(`${payer.id} cannot pay that much`);
  from.money -= amount;
  getResources(world, payee).money += amount;
}

export function buyTruckGood(world: World, npcId: string, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    requireCount(n);
    if (truckGoodsForSale(npc, good) < n) throw new Error(`${npc.id} will not sell ${n} ${good}`);
    if (freeCells(me) < n) throw new Refused({ id: "noCargoRoom" });
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
    if ((goodsCount(me)[good] ?? 0) < n) throw new Error(`Cannot sell ${n} ${good}`);
    if (cargoRoom(npc, good) < n) throw new Refused({ id: 'theyHaveNoRoom' });
    const price = truckGoodPrice(w, good, "sell");
    transfer(w, npc, me, price * n);
    removeGoods(me, good, n);
    if (addGoods(w, npc, good, n) !== n) throw new Error("Cargo capacity invariant failed");
    practiceSale(w, npc.id, good, price, n);
  });
}

function takeSpare(v: Vehicle, partId: string): PartInstance {
  const part = spareParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${v.id} has no spare part ${partId}`);
  v.items = v.items.filter((it) => it.kind !== "part" || it.part.id !== partId);
  return part;
}

export function buyTruckPart(world: World, npcId: string, partId: string): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    const part = takeSpare(npc, partId);
    transfer(w, me, npc, truckPartPrice(w, part, "buy"));
    if (!stowPart(w, me, part)) throw new Refused({ id: 'noCargoRoom' });
  });
}

export function sellTruckPart(world: World, npcId: string, partId: string): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    const part = takeSpare(me, partId);
    transfer(w, npc, me, truckPartPrice(w, part, "sell"));
    if (!stowPart(w, npc, part)) throw new Refused({ id: 'theyHaveNoRoom' });
  });
}

export function buyTruckSupply(world: World, npcId: string, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    requireCount(n);
    if (n > truckSupplyForSale(npc, kind)) throw new Error(`${npc.id} will not sell that much ${kind}`);
    if (n > supplyRoom(w, kind)) throw new Refused({ id: 'noSupplyRoom' });
    transfer(w, playerVehicle(w), npc, truckSupplyPrice(w, kind) * n);
    npc.resources![kind] -= n;
    w.player[kind] += n;
  });
}
