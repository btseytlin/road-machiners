import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { GEAR_DRAWS, GEAR_LEVELS, GEAR_LEVEL_IDS, GEAR_WHIM, NPC_UPKEEP, PRIORITY_TOP, type CargoRoll, type GearLevel, type LoadoutPriorities, type NpcLoadoutTable, type NpcTemplate, type Weighted } from '../data/npcs';
import { NPC_UTILITY_PARTS } from '../data/npc-utilities';
import { PARTS, partDef, type PartKind } from '../data/parts';
import { everyGunFires } from './armor';
import { makePart, makeVehicle, newId, type PartSpec } from './factory';
import { freeCells, gridOf, mountedItems, MOUNT_CELLS, mountSpots, plateSide, type SideLetter } from './grid';
import { addGoods, mountPart, stowPart } from './inventory';
import { vehicleMass } from './mass';
import { armorQuality, gearScorer } from './npc-gear-score';
import { meetsSpeedFloor, npcMassRoom, speedShare, vehicleStats } from './stats';
import { nextRandom, type Rng } from './rng';
import type { GridItem, Vehicle, World } from './types';

export type NpcLoadout = {
  chassisId: string;
  level: GearLevel;
  parts: PartSpec[];
  spares: PartSpec[];
  cargo: Record<string, number>;
};
type Level = (typeof GEAR_LEVELS)[GearLevel];
type PartItem = Extract<GridItem, { kind: 'part' }>;

function validateWeights<T>(pool: Weighted<T>[]): number {
  if (pool.length === 0) throw new Error('Empty NPC equipment pool');
  let total = 0;
  for (const entry of pool) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) throw new Error('NPC equipment weights must be positive and finite');
    total += entry.weight;
  }
  if (!Number.isFinite(total)) throw new Error('NPC equipment weight total is not finite');
  return total;
}

export function sampleWeighted<T>(rng: Rng, pool: Weighted<T>[]): T {
  const total = validateWeights(pool);
  let roll = nextRandom(rng) * total;
  for (const entry of pool) {
    if (roll < entry.weight) return entry.value;
    roll -= entry.weight;
  }
  throw new Error('NPC equipment roll exceeded its weight total');
}

function validatePartPool(pool: Weighted<string | null>[], kind: PartKind): void {
  validateWeights(pool);
  for (const entry of pool) {
    if (entry.value !== null && partDef(entry.value).kind !== kind) throw new Error(`NPC pool requires ${kind} parts`);
  }
}

function utilityPoolOf(template: NpcTemplate): Weighted<string | null>[] {
  const pool = NPC_UTILITY_PARTS[template.id];
  if (!pool) throw new Error(`NPC template ${template.id} has no utility pool`);
  return pool;
}

function validateUtilityPool(pool: Weighted<string | null>[]): void {
  validateWeights(pool);
  const stray = pool.find(({ value }) => value !== null && !isGearPart(value));
  if (stray) throw new Error(`NPC utility pool holds ${stray.value}, not a utility or a line gun`);
}

function isGearPart(defId: string): boolean {
  const def = partDef(defId);
  return def.kind === 'utility' || isLineGun(defId);
}

function isLineGun(defId: string): boolean {
  const def = partDef(defId);
  return def.kind === 'weapon' && def.line !== undefined;
}

function validateSparePool(pool: Weighted<string | null>[]): void {
  validateWeights(pool);
  for (const { value } of pool) {
    if (value !== null && partDef(value).kind === 'core') throw new Error('NPC spare pool cannot offer a core part');
  }
}

function validateGoodsTable(goods: Weighted<CargoRoll | null>[]): void {
  validateWeights(goods);
  for (const { value } of goods) {
    if (value === null) continue;
    if (!GOODS[value.good]) throw new Error(`Unknown NPC cargo ${value.good}`);
    if (!Number.isInteger(value.count) || value.count <= 0) throw new Error('NPC cargo counts must be positive integers');
  }
}

function validateSpareTable(spares: NpcLoadoutTable['spares']): void {
  if (!spares) return;
  validateSparePool(spares.pool);
  validateWeights(spares.count);
  for (const { value } of spares.count) {
    if (!Number.isInteger(value) || value < 0) throw new Error('NPC spare counts must be non-negative integers');
  }
}

function validateTable(table: NpcLoadoutTable): void {
  validateWeights(table.chassis);
  for (const entry of table.chassis) chassisDef(entry.value);
  validateWeights(table.levels);
  for (const { value } of table.levels) if (!GEAR_LEVEL_IDS.includes(value)) throw new Error(`Unknown gear level ${value}`);
  validatePriorities(table.priorities);
  validatePartPool(table.cargoPart, 'cargo');
  validateGoodsTable(table.goods);
  validateSpareTable(table.spares);
}

function validatePriorities(p: LoadoutPriorities): void {
  for (const [key, weight] of Object.entries(p)) if (!(weight >= 0 && weight <= PRIORITY_TOP)) throw new Error(`Loadout priority ${key} ${weight} must lie in 0 to ${PRIORITY_TOP}`);
  if (!(p.armor + p.firepower > 0)) throw new Error('Loadout priorities need firepower or armor above 0 for the driver to judge a fight');
}

function rollWear(world: World, rng: Rng, level: Level, v: Vehicle): void {
  for (const item of v.items) {
    if (item.kind !== 'part' || ['core', 'engine'].includes(partDef(item.part.defId).kind)) continue;
    item.part = makePart(world, item.part.defId, wearOf(rng, level));
  }
}

function wearOf(rng: Rng, level: Level): number {
  return sampleWeighted(rng, level.wear);
}

type Build = { world: World; budget: number; engineWear: number };

function equipmentCost(v: Vehicle): number {
  return chassisDef(v.chassisId).value + v.items.reduce((sum, item) => {
    if (item.kind !== 'part' || partDef(item.part.defId).kind === 'core') return sum;
    return sum + partDef(item.part.defId).value;
  }, 0);
}

function fits(b: Build, v: Vehicle): boolean {
  return equipmentCost(v) <= b.budget && vehicleMass(v) <= chassisDef(v.chassisId).ratedMass && meetsSpeedFloor(v, 0) && everyGunFires(v);
}

function copyOf(v: Vehicle): Vehicle {
  return { ...v, items: [...v.items] };
}

function mounted(b: Build, v: Vehicle, defId: string, mount?: SideLetter[]): Vehicle | null {
  const next = copyOf(v);
  return mountPart(b.world, next, makePart(b.world, defId, 0), mount) && fits(b, next) ? next : null;
}

function chooseOptionalPart(b: Build, rng: Rng, v: Vehicle, pool: Weighted<string | null>[]): Vehicle {
  const choices: Weighted<Vehicle>[] = [];
  for (const entry of pool) {
    const candidate = entry.value === null ? v : mounted(b, v, entry.value);
    if (candidate) choices.push({ value: candidate, weight: entry.weight });
  }
  if (!choices.length) throw new Error(`No eligible optional equipment for ${v.chassisId}. Add an explicit empty outcome or a fitting part.`);
  return sampleWeighted(rng, choices);
}

const ENGINES = Object.values(PARTS).filter((d) => d.kind === 'engine').map((d) => d.id);
const GUNS = Object.values(PARTS).filter((d) => d.kind === 'weapon' && !isLineGun(d.id)).map((d) => d.id);
const ARMOR = Object.values(PARTS).filter((d) => d.kind === 'armor').map((d) => d.id);
const SIDE_GROUPS: SideLetter[][] = [['F'], ['L', 'R'], ['B']];

function withEngine(b: Build, v: Vehicle, defId: string): Vehicle | null {
  const old = mountedItems(v, 'engine')[0];
  const next = { ...v, items: v.items.filter((item) => item !== old) };
  return mountPart(b.world, next, makePart(b.world, defId, b.engineWear)) && fits(b, next) ? next : null;
}

function withGun(b: Build, score: (v: Vehicle) => number, v: Vehicle, defId: string): Vehicle | null {
  if (!affords(b, v, partDef(defId))) return null;
  const item: PartItem = { id: newId(b.world, 'i'), x: 0, y: 0, rot: 0, kind: 'part', part: makePart(b.world, defId, 0) };
  return bestGunSpot(v, item, score);
}

function affords(b: Build, v: Vehicle, def: { value: number; mass: number }): boolean {
  return equipmentCost(v) + def.value <= b.budget && vehicleMass(v) + def.mass <= chassisDef(v.chassisId).ratedMass;
}

function bestGunSpot(v: Vehicle, item: PartItem, score: (v: Vehicle) => number): Vehicle | null {
  const spots = mountSpots(gridOf(v), v.items, item, MOUNT_CELLS.weapon);
  let best: Vehicle | null = null;
  let bestScore = -Infinity;
  for (const spot of spots) {
    const next = { ...v, items: [...v.items, { ...item, ...spot }] };
    if (!everyGunFires(next)) continue;
    if (best === null && !meetsSpeedFloor(next, 0)) return null;
    const value = score(next);
    if (value > bestScore) [best, bestScore] = [next, value];
  }
  return best;
}

function withArmor(b: Build, v: Vehicle, defId: string, sides: SideLetter[]): Vehicle | null {
  const next = copyOf(v);
  for (const side of sides) if (!mountPart(b.world, next, makePart(b.world, defId, 0), [side])) return null;
  return fits(b, next) ? next : null;
}

function withBetterArmor(b: Build, v: Vehicle, defId: string, sides: SideLetter[]): Vehicle | null {
  const quality = (item: PartItem) => armorQuality(b.world, item.part.defId, item.part.wear);
  let next = v;
  for (const side of sides) {
    const onSide = mountedItems(next, 'armor').filter((item) => plateSide(next.chassisId, item) === side);
    if (!onSide.length) return null;
    const worst = onSide.reduce((a, c) => (quality(c) < quality(a) ? c : a));
    if (armorQuality(b.world, defId, 0) <= quality(worst)) return null;
    next = { ...next, items: next.items.filter((item) => item !== worst) };
    if (!mountPart(b.world, next, makePart(b.world, defId, 0), [side])) return null;
  }
  return fits(b, next) ? next : null;
}

type GearMove = (v: Vehicle) => Vehicle | null;

function gearMoves(b: Build, score: (v: Vehicle) => number): GearMove[] {
  const moves: GearMove[] = GUNS.map((id) => (v: Vehicle) => withGun(b, score, v, id));
  for (const id of ARMOR) {
    for (const sides of SIDE_GROUPS) {
      moves.push((v) => withArmor(b, v, id, sides));
      moves.push((v) => withBetterArmor(b, v, id, sides));
    }
  }
  for (const id of ENGINES) moves.push((v) => withEngine(b, v, id));
  return moves;
}

function takeStep(b: Build, rng: Rng, v: Vehicle, moves: GearMove[], score: (v: Vehicle) => number, now: number, mustAct = false): Vehicle | null {
  const drawn = drawOffers(b, rng, v, moves, (next) => {
    const gain = score(next) - now;
    return gain > 0 || (mustAct && gain === 0) ? gain : null;
  });
  if (!drawn.length) return null;
  if (nextRandom(rng) < GEAR_WHIM) return drawn[Math.floor(nextRandom(rng) * drawn.length)].v;
  return drawn.reduce((a, c) => (c.worth > a.worth ? c : a)).v;
}

function drawOffers(b: Build, rng: Rng, v: Vehicle, moves: GearMove[], gainOf: (next: Vehicle) => number | null): { v: Vehicle; worth: number }[] {
  const order = [...moves];
  const drawn: { v: Vehicle; worth: number }[] = [];
  for (let i = 0; i < order.length && drawn.length < GEAR_DRAWS; i++) {
    const pick = i + Math.floor(nextRandom(rng) * (order.length - i));
    [order[i], order[pick]] = [order[pick], order[i]];
    const next = order[i](v);
    const gain = next && gainOf(next);
    if (next && gain !== null) drawn.push({ v: next, worth: gain / used(b, v, next) });
  }
  return drawn;
}

function used(b: Build, v: Vehicle, next: Vehicle): number {
  const money = (equipmentCost(next) - equipmentCost(v)) / Math.max(1, b.budget - equipmentCost(v));
  const mass = (vehicleMass(next) - vehicleMass(v)) / Math.max(1, massRoom(v));
  return Math.max(money, mass, MIN_USED);
}
const MIN_USED = 1e-3;

function massRoom(v: Vehicle): number {
  return mountedItems(v, 'engine').length ? npcMassRoom(v, 0) : chassisDef(v.chassisId).ratedMass - vehicleMass(v);
}

function chooseEngine(b: Build, rng: Rng, p: LoadoutPriorities, bare: Vehicle): Vehicle {
  const offers = ENGINES.map((id) => withEngine(b, bare, id));
  const options = offers.filter((v): v is Vehicle => v !== null);
  if (!options.length) throw new Error(`No engine keeps MIN_NPC_SPEED on ${bare.chassisId} at wear ${b.engineWear} within the gear money`);
  const fastest = options.reduce((a, c) => (vehicleStats(b.world, c).maxSpeed > vehicleStats(b.world, a).maxSpeed ? c : a));
  const score = gearScorer(b.world, p, fastest);
  const engine = takeStep(b, rng, bare, ENGINES.map((id) => (v: Vehicle) => withEngine(b, v, id)), score, 0, true);
  if (!engine) throw new Error(`No engine adds speed to ${bare.chassisId}`);
  return engine;
}

function chooseVehicle(probe: World, rng: Rng, wearRng: Rng, template: NpcTemplate, chassisId: string | null, gear: GearLevel): Vehicle {
  const table = template.loadout;
  const level = GEAR_LEVELS[gear];
  const chassis = chassisId ?? sampleWeighted(rng, table.chassis);
  const bare = makeVehicle(probe, { name: template.name, faction: template.faction, chassisId: chassis, parts: [], spares: [], cargo: {}, pos: { x: 0, y: 0 }, heading: 0, brain: null });
  const b: Build = { world: probe, budget: chassisDef(chassis).value + level.money, engineWear: wearOf(wearRng, level) };
  const powered = chooseEngine(b, rng, table.priorities, bare);
  let v = chooseOptionalPart(b, rng, powered, table.cargoPart);
  v = chooseOptionalPart(b, rng, v, utilityPoolOf(template));
  return pickGear(b, rng, table.priorities, v, powered);
}

function pickGear(b: Build, rng: Rng, p: LoadoutPriorities, v: Vehicle, powered: Vehicle): Vehicle {
  const score = gearScorer(b.world, p, powered);
  const moves = gearMoves(b, score);
  for (;;) {
    const next = takeStep(b, rng, v, moves, score, score(v));
    if (!next) return v;
    v = next;
  }
}

function mountedNonCore(v: Vehicle): PartSpec[] {
  return v.items.flatMap((item) =>
    item.kind === 'part' && partDef(item.part.defId).kind !== 'core' ? [{ defId: item.part.defId, wear: item.part.wear, at: { x: item.x, y: item.y, rot: item.rot } }] : [],
  );
}

type Room = { cells: number; mass: number };

function chooseGoods(rng: Rng, table: NpcLoadoutTable, level: Level, room: Room): CargoRoll | null {
  const goods = table.goods.filter(({ value }) => value === null || (value.count <= room.cells && GOODS[value.good].mass * value.count <= room.mass));
  if (!goods.length) throw new Error('No fitting cargo outcome for this NPC template');
  const roll = sampleWeighted(rng, goods);
  if (!roll) return null;
  const count = Math.min(Math.max(1, Math.round(roll.count * level.cargo)), room.cells, Math.floor(room.mass / GOODS[roll.good].mass));
  return { good: roll.good, count };
}

function chooseCargo(world: World, rng: Rng, wearRng: Rng, table: NpcLoadoutTable, level: Level, v: Vehicle): { spares: PartSpec[]; carried: Record<string, number> } {
  const load = { ...v, items: [...v.items] };
  const share = speedShare(table.priorities);
  const massLeft = () => Math.min(chassisDef(v.chassisId).ratedMass - vehicleMass(load), npcMassRoom(load, share));
  const carried: Record<string, number> = {};
  const addGood = (good: string, n: number) => {
    const added = addGoods(world, load, good, n);
    if (added > 0) carried[good] = (carried[good] ?? 0) + added;
  };
  addGood('parts', Math.min(NPC_UPKEEP.repairParts, Math.floor(massLeft() / GOODS.parts.mass)));
  const cargo = chooseGoods(rng, table, level, { cells: freeCells(load), mass: massLeft() });
  if (cargo) addGood(cargo.good, cargo.count);
  return { spares: addSpareParts(world, wearRng, table, level, load, massLeft), carried };
}

function addSpareParts(world: World, rng: Rng, table: NpcLoadoutTable, level: Level, load: Vehicle, massLeft: () => number): PartSpec[] {
  if (!table.spares) return [];
  const added: PartSpec[] = [];
  const count = Math.round(sampleWeighted(rng, table.spares.count) * level.cargo);
  for (let i = 0; i < count; i++) {
    const defId = sampleWeighted(rng, table.spares.pool);
    if (defId === null || partDef(defId).mass > massLeft()) continue;
    const part = makePart(world, defId, wearOf(rng, level));
    if (stowPart(world, load, part)) added.push({ defId, wear: part.wear });
  }
  return added;
}

export function generateNpcLoadout(world: World, template: NpcTemplate, chassisId: string | null = null, level: GearLevel | null = null): NpcLoadout {
  const table = template.loadout;
  validateTable(table);
  validateUtilityPool(utilityPoolOf(template));
  const probe = { ...world };
  const rng = { rngState: world.rngState };
  const wearRng = { rngState: world.marketRng.rngState };
  const gear = level ?? sampleWeighted(rng, table.levels);
  const v = chooseVehicle(probe, rng, wearRng, template, chassisId, gear);
  rollWear(probe, wearRng, GEAR_LEVELS[gear], v);
  const { spares, carried } = chooseCargo(probe, rng, wearRng, table, GEAR_LEVELS[gear], v);
  world.rngState = rng.rngState;
  world.marketRng = wearRng;
  return { chassisId: v.chassisId, level: gear, parts: mountedNonCore(v), spares, cargo: carried };
}
