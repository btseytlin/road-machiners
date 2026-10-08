import { FIELD_SPARE_WEAR, SALVAGE, type LootRange, type LootTable } from '../data/salvage';
import { SHOPS } from '../data/market';
import { ECONOMY, GOODS } from '../data/goods';
import { REGION, type LocationDef } from '../data/region';
import { BREAKABLE, RULES } from '../data/rules';
import { WRECK_LOOKS } from '../data/territory';
import { TIME } from '../data/time';
import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { makePart, newId } from './factory';
import { findRoadWreckSpot, isBreakable, propReach } from './mapgen';
import { playerVehicle, vehicleById } from './damage';
import { isKnockedOut } from './defeat';
import { grayRadius } from './vision';
import { findSpot, goodsCount, gridOf, isMounted, mountedParts, MOUNT_CELLS, type Spot } from './grid';
import { addGoods, cargoMassRoom, getLayoutError, lootRefitTurns, requireIdleRefit, stowPart } from './inventory';
import { chance, randInt } from './rng';
import { sampleWeighted } from './npc-loadout';
import { itemMass } from './mass';
import { getResources } from './resources';
import { fuelCap, suppliesCap, vehicleStats } from './stats';
import { inCombat } from './combat';
import { cancelJob, startJob } from './jobs';
import type { GoalReason, GridItem, HiddenLoot, Refusal, NpcActivity, Obstacle, PartInstance, Pile, RefitPickup, SalvageStock, Vehicle, World } from './types';
import { estimateCrashGeometry } from './crash-contact';
import { walkLane } from './armor';
import { canUseSite } from './sites';
import { shopAt } from './market';
import { isLootSpot, spotLookOf, spotTable, territoryOfStock } from './territory';
import { inTowReach } from './tow';
import { playerCommand, Refused } from './world';
import { dist, type Vec } from './vec';
import { OPENING_WRECK_ID } from './opening';
import { maxHp } from './wear';

export function initializeSalvage(world: World): void {
  const sites = REGION.locations.flatMap((site) => {
    const table = siteLootTable(site);
    return table ? [rollStock(world, table, site.id, site.pos, site.radius)] : [];
  });
  const spots = world.obstacles.filter(isLootSpot).map((o) => rollStock(world, spotTable(o), o.id, o.pos, propReach(o)));
  const wrecks = world.obstacles.filter(isRoadWreck).map((o) => rollStock(world, SALVAGE.roadWreck, o.id, o.pos, o.r * RULES.wreckRadiusScale));
  world.salvage = [...sites, ...spots, ...wrecks];
}

export function siteLootTable(site: LocationDef): LootTable | null {
  if (site.kind === 'territory' || site.id in SHOPS) return null;
  if (site.kind === 'convoy') return SALVAGE.convoy;
  return site.kind === 'landmark' ? SALVAGE.landmark : null;
}

export function isSiteStock(stock: SalvageStock): boolean {
  return REGION.locations.some((site) => site.id === stock.id);
}

export function isRoadWreck(o: { id: string }): boolean {
  return /^wreck\d+$/.test(o.id);
}

export type SalvagePlace = 'pile' | 'site' | 'wreck' | 'spot';

export function salvagePlace(stock: SalvageStock): SalvagePlace {
  if (stock.pile) return 'pile';
  if (isSiteStock(stock)) return 'site';
  return isRoadWreck(stock) || isTruckWreck(stock) || stock.id === OPENING_WRECK_ID ? 'wreck' : spotPlace(stock);
}

function spotPlace(stock: SalvageStock): 'wreck' | 'spot' {
  const look = territoryOfStock(stock) ? spotLookOf(stock) : null;
  if (!look) throw new Error(`Stock ${stock.id} is no pile, site, wreck or loot spot`);
  return WRECK_LOOKS.includes(look) ? 'wreck' : 'spot';
}

function fieldSpare(world: World, table: LootTable): PartInstance {
  const defId = table.spareParts[randInt(world, 0, table.spareParts.length - 1)];
  return makePart(world, defId, sampleWeighted(world.marketRng, FIELD_SPARE_WEAR));
}

export function rollStock(world: World, table: LootTable, id: string, pos: Vec, radius: number): SalvageStock {
  const goods: Record<string, number> = {};
  for (const [good, [lo, hi]] of Object.entries(table.goods)) goods[good] = randInt(world, lo, hi);
  goods.parts = randInt(world, table.parts[0], table.parts[1]);
  const parts: PartInstance[] = [];
  if (chance(world, table.sparePartChance)) parts.push(fieldSpare(world, table));
  const hidden = { goods, parts, fuel: randInt(world, ...table.fuel), supplies: randInt(world, ...table.supplies) };
  return { id, pos: { ...pos }, radius, goods: {}, parts: [], fuel: 0, supplies: 0, hidden };
}

export function emptyHidden(): HiddenLoot {
  return { goods: {}, parts: [], fuel: 0, supplies: 0 };
}

export function hasSalvage(stock: SalvageStock): boolean {
  return hasRevealed(stock) || hiddenUnits(stock) > 0;
}

export function hasRevealed(stock: SalvageStock): boolean {
  return stock.parts.length > 0 || Object.values(stock.goods).some((count) => count > 0) || hasStores(stock);
}

export function hiddenUnits(stock: SalvageStock): number {
  const { goods, parts, fuel, supplies } = stock.hidden;
  return parts.length + Object.values(goods).reduce((sum, count) => sum + count, 0) + Number(fuel > 0) + Number(supplies > 0);
}

export type Found = { goods: Record<string, number>; parts: string[]; fuel: number; supplies: number };

export function revealTurn(world: World, stock: SalvageStock, p: number): Found {
  const found: Found = { goods: revealGoods(world, stock, p), parts: [], fuel: 0, supplies: 0 };
  stock.hidden.parts = stock.hidden.parts.filter((part) => {
    if (!chance(world.searchRng, p)) return true;
    stock.parts.push(part);
    found.parts.push(part.defId);
    return false;
  });
  for (const kind of ['fuel', 'supplies'] as const) {
    if (stock.hidden[kind] <= 0 || !chance(world.searchRng, p)) continue;
    found[kind] = stock.hidden[kind];
    stock[kind] = (stock[kind] ?? 0) + stock.hidden[kind];
    stock.hidden[kind] = 0;
  }
  return found;
}

function revealGoods(world: World, stock: SalvageStock, p: number): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [good, count] of Object.entries(stock.hidden.goods)) {
    let hits = 0;
    for (let unit = 0; unit < count; unit++) if (chance(world.searchRng, p)) hits++;
    if (hits === 0) continue;
    stock.hidden.goods[good] = count - hits;
    stock.goods[good] = (stock.goods[good] ?? 0) + hits;
    found[good] = hits;
  }
  return found;
}

export function canTakeAny(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  return hiddenUnits(stock) > 0 || canTakeRevealed(world, vehicle, stock);
}

function canTakeRevealed(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  const room = storesRoom(world, vehicle);
  if ((['fuel', 'supplies'] as const).some((kind) => (stock[kind] ?? 0) > 0 && room[kind] >= 1)) return true;
  const grid = gridOf(vehicle);
  const good: GridItem = { id: 'fit-check', x: 0, y: 0, rot: 0, kind: 'good', good: 'scrap' };
  const massRoom = cargoMassRoom(vehicle);
  if (Object.entries(stock.goods).some(([id, count]) => count > 0 && GOODS[id].mass <= massRoom) && findSpot(grid, vehicle.items, good, null, null)) return true;
  return stock.parts.some((part) => {
    const item: GridItem = { id: 'fit-check', x: 0, y: 0, rot: 0, kind: 'part', part };
    return itemMass(item) <= massRoom && findSpot(grid, vehicle.items, item, null, MOUNT_CELLS[partDef(part.defId).kind]) !== null;
  });
}

export function hasStores(stock: SalvageStock): boolean {
  return (stock.fuel ?? 0) > 0 || (stock.supplies ?? 0) > 0;
}

export function salvageUnits(stock: SalvageStock): number {
  return stock.parts.length + Object.values(stock.goods).reduce((sum, count) => sum + count, 0);
}

export function canReachSalvage(vehicle: Vehicle, stock: SalvageStock): boolean {
  return vehicle.speed <= RULES.parkedSpeed && salvageInRange(vehicle, stock);
}

export function searchTarget(world: World, vehicle: Vehicle, stockId: string | null): { stock: SalvageStock } | { ended: GoalReason } {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) return { ended: 'salvageGone' };
  const arrived = world.events.some((e) => e.t === 'arrived' && e.vehicle === vehicle.id);
  return arrived && !salvageInRange(vehicle, stock) ? { ended: 'salvageOutOfReach' } : { stock };
}

export function salvageInRange(vehicle: Vehicle, stock: SalvageStock): boolean {
  const site = REGION.locations.find((l) => l.id === stock.id);
  return site ? canUseSite(vehicle.pos, site) : dist(vehicle.pos, stock.pos) <= (stock.radius + ECONOMY.useRange) * ECONOMY.interactionScale;
}

export function collectSalvage(world: World, vehicle: Vehicle, stockId: string, units: number): number {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  if (!canReachSalvage(vehicle, stock)) throw new Error('Stop within salvage reach');
  pourStores(world, vehicle, stock);
  let moved = 0;
  stock.parts = stock.parts.filter((part) => {
    if (moved >= units || !stowPart(world, vehicle, part)) return true;
    moved++;
    return false;
  });
  return collectGoods(world, vehicle, stock, units - moved) + moved;
}

function collectGoods(world: World, vehicle: Vehicle, stock: SalvageStock, units: number): number {
  let moved = 0;
  for (const [good, count] of Object.entries(stock.goods)) {
    if (moved >= units || count <= 0) continue;
    const want = Math.min(count, units - moved);
    const held = goodsCount(vehicle)[good] ?? 0;
    const took = addGoods(world, vehicle, good, want);
    stock.goods[good] -= took;
    moved += took;
    if (vehicle.id === world.player.vehicleId) takeBasis(world, stock, good, held, took);
  }
  return moved;
}

export function takeBasis(world: World, stock: SalvageStock, good: string, held: number, took: number): void {
  addBasis(world, good, held, took, stockBasis(stock, good));
}

export function addBasis(world: World, good: string, held: number, took: number, unit: number): void {
  if (took === 0) return;
  const paid = world.player.costBasis[good] ?? 0;
  world.player.costBasis[good] = (paid * held + unit * took) / (held + took);
}

function stockBasis(stock: SalvageStock, good: string): number {
  if (!stock.pile?.fromPlayer) return GOODS[good].value;
  const basis = stock.pile.basis[good];
  if (basis === undefined) throw new Error(`Player pile ${stock.id} has no cost basis for ${good}`);
  return basis;
}

export function pourStores(world: World, vehicle: Vehicle, stock: SalvageStock): void {
  const resources = getResources(world, vehicle);
  const room = storesRoom(world, vehicle);
  for (const kind of ['fuel', 'supplies'] as const) {
    const took = Math.min(stock[kind] ?? 0, Math.floor(room[kind]));
    if (took <= 0) continue;
    resources[kind] += took;
    stock[kind] = (stock[kind] ?? 0) - took;
  }
}

function storesRoom(world: World, vehicle: Vehicle): { fuel: number; supplies: number } {
  const resources = getResources(world, vehicle);
  return {
    fuel: Math.max(0, fuelCap(vehicle) - resources.fuel),
    supplies: Math.max(0, suppliesCap(vehicle) - resources.supplies),
  };
}

const TRUCK_WRECK = 'wreck-';

export function wreckStockId(vehicleId: string): string {
  return `${TRUCK_WRECK}${vehicleId}`;
}

function isTruckWreck(stock: SalvageStock): boolean {
  return stock.id.startsWith(TRUCK_WRECK);
}

export function carriedPart(world: World, vehicleId: string, partId: string): PartInstance | undefined {
  const v = world.vehicles.find((x) => x.id === vehicleId) ?? world.removed.find((x) => x.id === vehicleId);
  const wreck = world.salvage.find((s) => s.id === wreckStockId(vehicleId));
  return (v && mountedParts(v).find((x) => x.id === partId)) ?? wreck?.parts.find((x) => x.id === partId);
}

export function createWreckSalvage(world: World, vehicle: Vehicle): void {
  const goods = goodsCount(vehicle);
  const parts: PartInstance[] = [];
  const core: PartInstance[] = [];
  for (const item of vehicle.items) {
    if (item.kind !== 'part') continue;
    if (partDef(item.part.defId).kind === 'core') core.push(item.part);
    else parts.push(item.part);
  }
  const coreScrap = coreWreckScrap(vehicle, core);
  if (coreScrap > 0) goods.parts = (goods.parts ?? 0) + coreScrap;
  addVehicleStock(world, vehicle, wreckStockId(vehicle.id), goods, parts);
  vehicle.items = vehicle.items.filter((item) => item.kind === 'part' && partDef(item.part.defId).kind === 'core');
}

function coreWreckScrap(vehicle: Vehicle, core: PartInstance[]): number {
  if (core.length === 0) return 0;
  const hpShare = core.reduce((sum, part) => sum + part.hp / maxHp(part), 0) / core.length;
  const value = chassisDef(vehicle.chassisId).value * SALVAGE.coreValueShare * hpShare;
  return Math.round(value / GOODS.parts.value);
}

export function createCargoSalvage(world: World, vehicle: Vehicle, goodsShare: number): SalvageStock {
  return dropOnPile(world, vehicle, cargoItems(vehicle, goodsShare), `cargo-${vehicle.id}-${world.turn}`);
}

export function dumpOnPile(world: World, vehicle: Vehicle, item: GridItem): SalvageStock {
  return dropOnPile(world, vehicle, [item], `dump-${vehicle.id}-${world.turn}`);
}

export function spillOnPile(world: World, vehicle: Vehicle, items: GridItem[]): SalvageStock {
  return dropOnPile(world, vehicle, items, `spill-${vehicle.id}-${world.turn}`);
}

function cargoItems(vehicle: Vehicle, goodsShare: number): GridItem[] {
  if (!(goodsShare >= 0 && goodsShare <= 1)) throw new Error(`Cargo share ${goodsShare} is not in [0, 1]`);
  const quota: Record<string, number> = {};
  for (const [good, count] of Object.entries(goodsCount(vehicle))) quota[good] = Math.ceil(count * goodsShare);
  return vehicle.items.filter((item) => {
    if (item.kind === 'part') return !isMounted(vehicle.chassisId, item);
    if (quota[item.good] <= 0) return false;
    quota[item.good]--;
    return true;
  });
}

export function hasCargo(vehicle: Vehicle): boolean {
  return vehicle.items.some((item) => item.kind === 'good' || !isMounted(vehicle.chassisId, item));
}

function addVehicleStock(world: World, vehicle: Vehicle, id: string, goods: Record<string, number>, parts: PartInstance[]): SalvageStock {
  if (world.salvage.some((stock) => stock.id === id)) throw new Error(`Duplicate wreck salvage ${id}`);
  const stock: SalvageStock = { id, pos: { ...vehicle.pos }, radius: vehicleStats(world, vehicle).radius * RULES.wreckRadiusScale, goods, parts, hidden: emptyHidden() };
  world.salvage.push(stock);
  return stock;
}

function dropOnPile(world: World, vehicle: Vehicle, items: GridItem[], id: string): SalvageStock {
  const byPlayer = vehicle.id === world.player.vehicleId;
  const pile = world.salvage.find((stock) => stock.pile?.fromPlayer === byPlayer && salvageInRange(vehicle, stock))
    ?? addVehicleStock(world, vehicle, id, {}, []);
  const held = stampPile(world, byPlayer, pile);
  for (const item of items) {
    if (item.kind === 'good') dropGood(world, held, item.good);
    else pile.parts.push(item.part);
  }
  vehicle.items = vehicle.items.filter((item) => !items.includes(item));
  return pile;
}

function stampPile(world: World, byPlayer: boolean, stock: SalvageStock): { stock: SalvageStock; pile: Pile } {
  const pile: Pile = { until: world.turn + SALVAGE.pileTurns, fromPlayer: byPlayer, basis: stock.pile?.basis ?? {}, claim: stock.pile?.claim };
  stock.pile = pile;
  if (byPlayer && !world.player.scavenged.includes(stock.id)) world.player.scavenged.push(stock.id);
  return { stock, pile };
}

function dropGood(world: World, { stock, pile }: { stock: SalvageStock; pile: Pile }, good: string): void {
  const count = stock.goods[good] ?? 0;
  stock.goods[good] = count + 1;
  if (!pile.fromPlayer) return;
  const paid = world.player.costBasis[good] ?? 0;
  pile.basis[good] = ((pile.basis[good] ?? 0) * count + paid) / (count + 1);
}

export function claimPile(world: World, stock: SalvageStock, claimant: Vehicle, warned: string[] = []): void {
  if (!stock.pile) throw new Error(`Cannot claim ${stock.id}, it is no pile`);
  stock.pile.claim = { by: claimant.id, until: world.turn + SALVAGE.claimTurns, warned };
}

function claimHolds(world: World, stock: SalvageStock, claimant: Vehicle | undefined): claimant is Vehicle {
  const claim = stock.pile?.claim;
  if (!claim || !claimant || world.turn >= claim.until) return false;
  return !isKnockedOut(claimant) && goesFor(world, claimant, stock);
}

function goesFor(world: World, claimant: Vehicle, stock: SalvageStock): boolean {
  return wantsLoot(claimant, stock.id) || inCombat(world, claimant);
}

function wantsLoot(vehicle: Vehicle, stockId: string): boolean {
  return !!vehicle.brain && vehicle.brain.goals.some((goal) => goal.kind === 'loot' && goal.targetId === stockId);
}

export function claimantOf(world: World, stock: SalvageStock): Vehicle | null {
  const claimant = world.vehicles.find((v) => v.id === stock.pile?.claim?.by);
  return claimHolds(world, stock, claimant) ? claimant : null;
}

export function holdsClaim(world: World, vehicleId: string): boolean {
  return world.salvage.some((stock) => stock.pile?.claim?.by === vehicleId && claimantOf(world, stock));
}

export function backedOff(stock: SalvageStock, vehicleId: string): boolean {
  return !!stock.pile?.claim?.warned.includes(vehicleId);
}

export function clearPiles(world: World): void {
  for (const stock of world.salvage) if (stock.pile?.claim && !claimantOf(world, stock)) delete stock.pile.claim;
  removeStocks(world, new Set(world.salvage.filter((stock) => stock.pile && (world.turn >= stock.pile.until || !hasSalvage(stock))).map((stock) => stock.id)));
}

export function removeStocks(world: World, gone: Set<string>): void {
  if (gone.size === 0) return;
  for (const v of world.vehicles) if (v.job?.kind === 'search' && gone.has(v.job.stockId)) cancelJob(world, v);
  world.salvage = world.salvage.filter((stock) => !gone.has(stock.id));
  world.player.scavenged = world.player.scavenged.filter((id) => !gone.has(id));
}

export function renewSalvage(world: World): void {
  if (world.turn % TIME.turnsPerDay !== 0) return;
  for (const site of REGION.locations) {
    const table = siteLootTable(site);
    if (table) restockSite(world, siteStock(world, site.id), table);
  }
  for (const o of world.obstacles.filter(isLootSpot)) restockSite(world, siteStock(world, o.id), spotTable(o));
  turnOverRoadWrecks(world);
  regrowBroken(world);
}

function siteStock(world: World, id: string): SalvageStock {
  const stock = world.salvage.find((entry) => entry.id === id);
  if (!stock) throw new Error(`Site ${id} has no salvage stock`);
  return stock;
}

function restockSite(world: World, stock: SalvageStock, table: LootTable): void {
  for (const [good, range] of Object.entries({ ...table.goods, parts: table.parts })) refillGood(world, stock, good, range);
  for (const kind of ['fuel', 'supplies'] as const) stock.hidden[kind] += refill(world, (stock[kind] ?? 0) + stock.hidden[kind], table[kind]);
  if (stock.parts.length + stock.hidden.parts.length > 0 || !chance(world, table.sparePartChance * SALVAGE.restockShare)) return;
  stock.hidden.parts.push(fieldSpare(world, table));
}

function refillGood(world: World, stock: SalvageStock, good: string, range: LootRange): void {
  const hidden = stock.hidden.goods[good] ?? 0;
  stock.hidden.goods[good] = hidden + refill(world, (stock.goods[good] ?? 0) + hidden, range);
}

function refill(world: World, current: number, [lo, hi]: LootRange): number {
  let gain = 0;
  for (let unit = randInt(world, lo, hi); unit > 0; unit--) if (chance(world, SALVAGE.restockShare)) gain++;
  return Math.max(current, Math.min(hi, current + gain)) - current;
}

function turnOverRoadWrecks(world: World): void {
  for (const stock of world.salvage.filter(isRoadWreck)) {
    if (hasSalvage(stock)) continue;
    stock.emptySince ??= world.turn;
    if (world.turn - stock.emptySince < SALVAGE.wreckClearDays * TIME.turnsPerDay || inPlayerView(world, stock.pos)) continue;
    replaceRoadWreck(world, stock);
  }
}

function replaceRoadWreck(world: World, old: SalvageStock): void {
  removeStocks(world, new Set([old.id]));
  world.obstacles = world.obstacles.filter((o) => o.id !== old.id);
  const spot = findRoadWreckSpot(world, world.obstacles, (pos, r) => !inPlayerView(world, pos) && clearOfVehicles(world, pos, r));
  const id = newId(world, 'wreck');
  if (world.obstacles.some((o) => o.id === id)) throw new Error(`Duplicate road wreck ${id}`);
  world.obstacles.push({ id, ...spot, kind: 'wreck' });
  world.salvage.push(rollStock(world, SALVAGE.roadWreck, id, spot.pos, spot.r * RULES.wreckRadiusScale));
}

export function breakProp(world: World, id: string, vehicleId: string): void {
  const prop = world.obstacles.find((o) => o.id === id);
  if (!prop || !isBreakable(prop)) throw new Error(`No standing breakable prop ${id}`);
  const vehicle = vehicleById(world, vehicleId);
  world.obstacles = world.obstacles.filter((o) => o !== prop);
  world.broken.push({ obstacle: prop, turn: world.turn });
  vehicle.speed *= 1 - BREAKABLE.slowdown;
  const contact = estimateCrashGeometry(vehicle, null, prop.pos).a;
  const lane = contact.lanes[Math.floor(contact.lanes.length / 2)];
  const hitsA = walkLane(world, vehicle, contact.side, lane, { damage: BREAKABLE.damage, pen: RULES.crashPen, blast: false, armorShare: 1 });
  world.events.push({ t: 'collision', a: vehicle.id, b: id, hitsA, hitsB: [] });
}

function regrowBroken(world: World): void {
  const due = world.broken.filter((b) => world.turn - b.turn >= BREAKABLE.regrowDays * TIME.turnsPerDay);
  const back = due.filter(({ obstacle }) => canRegrow(world, obstacle));
  if (back.length === 0) return;
  world.broken = world.broken.filter((b) => !back.includes(b));
  world.obstacles.push(...back.map((b) => b.obstacle));
}

function canRegrow(world: World, o: Obstacle): boolean {
  return canVanish(world, o.pos, propReach(o));
}

export function canVanish(world: World, pos: Vec, reach: number): boolean {
  return dist(playerVehicle(world).pos, pos) > grayRadius(world) + reach && clearOfVehicles(world, pos, reach);
}

function inPlayerView(world: World, pos: Vec): boolean {
  return dist(playerVehicle(world).pos, pos) <= grayRadius(world);
}

function clearOfVehicles(world: World, pos: Vec, r: number): boolean {
  return world.vehicles.every((v) => dist(v.pos, pos) > chassisDef(v.chassisId).radius + r);
}

type TruckPickup = Extract<RefitPickup, { from: 'truck' }>;

export function canLootTruck(looter: Vehicle, target: Vehicle): boolean {
  return looter.id !== target.id && isKnockedOut(target) && looter.speed <= RULES.parkedSpeed && inTowReach(looter, target);
}

// Why this item cannot leave the truck, or null. A built-in part stays, and a rack must be empty before it comes off.
export function takeError(target: Vehicle, item: GridItem): Refusal | null {
  if (item.kind === 'part' && partDef(item.part.defId).kind === 'core' && isMounted(target.chassisId, item)) return { id: 'builtInStays' };
  const left = getLayoutError(target, target.items.filter((it) => it.id !== item.id));
  return left ? { id: 'emptyRackFirst' } : null;
}

function takeTurns(world: World, looter: Vehicle, target: Vehicle, item: GridItem, placed: GridItem): number {
  const planned = RULES.refitTurnsPerPart * (Number(isMounted(target.chassisId, item)) + Number(isMounted(looter.chassisId, placed)));
  const garage = looter.id === world.player.vehicleId && shopAt(world) !== null;
  return planned > 0 && !garage ? lootRefitTurns(world, looter, planned) : 0;
}

export function takeItem(world: World, looter: Vehicle, target: Vehicle, item: GridItem, to: Spot): void {
  const placed: GridItem = { ...item, id: newId(world, 'i'), ...to };
  const error = takeError(target, item) ?? getLayoutError(looter, [...looter.items, placed]);
  if (error) throw new Refused(error);
  const work = takeTurns(world, looter, target, item, placed);
  if (work === 0) return moveNow(world, looter, target, item, placed);
  if (item.kind !== 'part') throw new Error('Only parts take a refit');
  const pickup: TruckPickup = { from: 'truck', vehicleId: target.id, partId: item.part.id, itemId: placed.id, to };
  startJob(world, looter, { kind: 'refit', moves: [], pickup, turnsLeft: work, total: work });
}

function moveNow(world: World, looter: Vehicle, target: Vehicle, item: GridItem, placed: GridItem): void {
  target.items = target.items.filter((it) => it.id !== item.id);
  if (placed.kind === 'good' && looter.id === world.player.vehicleId) addBasis(world, placed.good, goodsCount(looter)[placed.good] ?? 0, 1, GOODS[placed.good].value);
  looter.items.push(placed);
}

export function takeFromTruck(world: World, targetId: string, itemId: string, to: Spot): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    const target = vehicleById(w, targetId);
    requireIdleRefit(me);
    if (!canLootTruck(me, target)) throw new Error('Park beside a knocked-out truck to loot it');
    requireLootFree(w, me, targetId);
    const item = target.items.find((it) => it.id === itemId);
    if (!item) throw new Error(`No item ${itemId} on ${target.id}`);
    takeItem(w, me, target, item, to);
  });
}

// The part a running refit takes off the truck, at its new spot, or why the refit cannot go on.
export function truckPickupItem(world: World, looter: Vehicle, pickup: TruckPickup): GridItem | Refusal {
  const target = world.vehicles.find((v) => v.id === pickup.vehicleId);
  if (!target || !canLootTruck(looter, target)) return { id: 'truckOutOfReach' };
  const item = target.items.find((it) => it.kind === 'part' && it.part.id === pickup.partId);
  if (item?.kind !== 'part') return { id: 'truckPartGone' };
  return { kind: 'part', id: pickup.itemId, part: item.part, ...pickup.to };
}

export function finishTruckPickup(world: World, looter: Vehicle, pickup: TruckPickup): void {
  const target = vehicleById(world, pickup.vehicleId);
  const item = target.items.find((it) => it.kind === 'part' && it.part.id === pickup.partId);
  if (item?.kind !== 'part') throw new Error('Truck part disappeared after validation');
  target.items = target.items.filter((it) => it.id !== item.id);
}

export function isLootTarget(world: World, targetId: string): boolean {
  const stock = world.salvage.find((s) => s.id === targetId);
  if (stock) return !isSiteStock(stock);
  const truck = world.vehicles.find((v) => v.id === targetId);
  return truck !== undefined && isKnockedOut(truck);
}

export function looterOf(world: World, targetId: string): Vehicle | null {
  if (!isLootTarget(world, targetId)) return null;
  const working = world.vehicles.find((v) => worksOn(v, targetId)) ?? world.vehicles.find((v) => actsOn(world, v, targetId));
  if (working) return working;
  if (world.salvage.some((s) => s.id === targetId && claimantOf(world, s))) return null;
  const me = playerVehicle(world);
  return inLootReach(world, me, targetId) ? me : null;
}

export function lootBlocker(world: World, looter: Vehicle, targetId: string): Vehicle | null {
  const holder = looterOf(world, targetId);
  return holder && holder.id !== looter.id ? holder : null;
}

export function requireLootFree(world: World, looter: Vehicle, targetId: string): void {
  const blocker = lootBlocker(world, looter, targetId);
  if (blocker) throw new Refused(lootBlockedError(world, blocker, targetId));
}

export function lootBlockedError(world: World, blocker: Vehicle, targetId: string): Refusal {
  const stock = world.salvage.find((s) => s.id === targetId);
  if (stock) return { id: 'looting', by: blocker.id, place: salvagePlace(stock) === 'spot' ? 'here' : 'wreck' };
  if (world.vehicles.some((v) => v.id === targetId)) return { id: 'looting', by: blocker.id, place: 'truck' };
  throw new Error(`No loot target ${targetId}`);
}

export function lootClaimedBy(world: World, npc: Vehicle): string | null {
  const ids = [jobTarget(npc), npc.brain?.goals.at(-1)?.targetId ?? null];
  return ids.find((id) => id !== null && looterOf(world, id)?.id === npc.id) ?? null;
}

export function jobTarget(v: Vehicle): string | null {
  const job = v.job;
  if (job?.kind === 'search') return job.stockId;
  const pickup = job?.kind === 'refit' ? job.pickup : null;
  return pickup ? pickupSource(pickup) : null;
}

function pickupSource(pickup: RefitPickup): string {
  return pickup.from === 'stock' ? pickup.stockId : pickup.vehicleId;
}

function worksOn(v: Vehicle, targetId: string): boolean {
  return jobTarget(v) === targetId;
}

function actsOn(world: World, v: Vehicle, targetId: string): boolean {
  const goal = v.brain?.goals.at(-1);
  return goal !== undefined && isLootActOn(goal, targetId) && inLootReach(world, v, targetId);
}

function isLootActOn(goal: NpcActivity, targetId: string): boolean {
  return (goal.kind === 'loot' || goal.kind === 'scavenge') && goal.targetId === targetId && goal.phase === 'act';
}

function inLootReach(world: World, v: Vehicle, targetId: string): boolean {
  const stock = world.salvage.find((s) => s.id === targetId);
  return stock ? canReachSalvage(v, stock) : canLootTruck(v, vehicleById(world, targetId));
}

export const CANNOT_HOLD: GoalReason = 'cargoFullLoot';

export const STRIPPED: GoalReason = 'salvageExhausted';

// One turn of an NPC looting a parked-beside truck. Every loose item that fits comes over at once, then one
// installed part per refit, stowed as a spare. No refit starts with a foe in sight, so the looting ends then.
// Returns why the loot ends, or null while work remains.
export function lootTruckTurn(world: World, looter: Vehicle, target: Vehicle): GoalReason | null {
  if (looter.job?.kind === 'refit') return null;
  takeLooseItems(world, looter, target);
  if (inCombat(world, looter)) return 'combatStopsLooting';
  const next = nextInstalled(looter, target);
  if (!next) return target.items.some((it) => takeError(target, it) === null) ? 'cargoFullLoot' : 'nothingToLoot';
  takeItem(world, looter, target, next.item, next.spot);
  return null;
}

function takeLooseItems(world: World, looter: Vehicle, target: Vehicle): void {
  for (const item of target.items.filter((it) => !isMounted(target.chassisId, it))) {
    const spot = spareSpot(looter, item);
    if (spot) takeItem(world, looter, target, item, spot);
  }
}

export function canTakeFromTruck(looter: Vehicle, target: Vehicle): boolean {
  return target.items.some((it) => takeError(target, it) === null && spareSpot(looter, it) !== null);
}

function nextInstalled(looter: Vehicle, target: Vehicle): { item: GridItem; spot: Spot } | null {
  for (const item of target.items) {
    if (!isMounted(target.chassisId, item) || takeError(target, item)) continue;
    const spot = spareSpot(looter, item);
    if (spot) return { item, spot };
  }
  return null;
}

function spareSpot(looter: Vehicle, item: GridItem): Spot | null {
  if (itemMass(item) > cargoMassRoom(looter)) return null;
  const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
  return findSpot(gridOf(looter), looter.items, { ...item, id: 'probe' }, null, avoid);
}
