import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { GEAR_LEVELS, GEAR_LEVEL_IDS, MAX_GUN_SLOWDOWN, NPC_UPKEEP, type CargoRoll, type GearLevel, type NpcLoadoutTable, type NpcTemplate, type Weighted } from '../data/npcs';
import { partDef, type EngineDef, type PartKind } from '../data/parts';
import { CONDITION } from '../data/wear';
import { everyGunFires } from './armor';
import { makePart, makeVehicle, newId, type PartSpec } from './factory';
import { baseGrid, cellKey, freeCells, gridOf, itemCells, mountedItems, type Cell } from './grid';
import { addGoods, mountPart, stowPart } from './inventory';
import { vehicleMass } from './mass';
import { gunDrag, meetsSpeedFloor, npcMassRoom } from './stats';
import { nextRandom, type Rng } from './rng';
import type { Vehicle, World } from './types';
import { partValue } from './wear';

export type NpcLoadout = {
  chassisId: string;
  level: GearLevel;
  parts: PartSpec[];
  spares: PartSpec[];
  cargo: Record<string, number>;
};
type ArmedChoice = { engine: string; weapon: string; vehicle: Vehicle };
type Level = (typeof GEAR_LEVELS)[GearLevel];

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

function validatePartPool(pool: Weighted<string | null>[], kind: PartKind, required: boolean): void {
  validateWeights(pool);
  for (const entry of pool) {
    if (entry.value === null && !required) continue;
    if (entry.value === null || partDef(entry.value).kind !== kind) throw new Error(`NPC pool requires ${kind} parts`);
  }
}

function validateWearTable(wear: Weighted<number>[]): void {
  validateWeights(wear);
  for (const { value } of wear) {
    if (!Number.isInteger(value) || value < 0 || value > CONDITION.maxWear) throw new Error(`NPC wear roll ${value} is out of range`);
  }
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
  if (!Number.isFinite(table.budget) || table.budget <= 0) throw new Error('NPC equipment budget must be positive and finite');
  validateWeights(table.chassis);
  for (const entry of table.chassis) chassisDef(entry.value);
  validatePartPool(table.engine, 'engine', true);
  validatePartPool(table.weapon, 'weapon', true);
  validatePartPool(table.extraGun, 'weapon', true);
  validatePartPool(table.armor, 'armor', true);
  validateGear(table);
  validatePartPool(table.cargoPart, 'cargo', false);
  validateGoodsTable(table.goods);
  validateWearTable(table.wear);
  validateSpareTable(table.spares);
}

function validateGear(table: NpcLoadoutTable): void {
  validateWeights(table.levels);
  for (const { value } of table.levels) if (!GEAR_LEVEL_IDS.includes(value)) throw new Error(`Unknown gear level ${value}`);
  if (!(table.gunFill > 0)) throw new Error(`gunFill ${table.gunFill} must be above 0`);
  if (!Number.isInteger(table.minGuns) || table.minGuns < 1) throw new Error(`minGuns ${table.minGuns} must be a whole number of at least 1`);
}

function computeEquipmentCost(v: Vehicle): number {
  return chassisDef(v.chassisId).value + v.items.reduce((sum, item) => {
    if (item.kind !== 'part' || partDef(item.part.defId).kind === 'core') return sum;
    return sum + partValue(item.part);
  }, 0);
}

function tryMountChoice(world: World, v: Vehicle, id: string, budget: number, mount?: Cell[]): Vehicle | null {
  if (computeEquipmentCost(v) + partDef(id).value > budget) return null;
  if (vehicleMass(v) + partDef(id).mass > chassisDef(v.chassisId).ratedMass) return null;
  const candidate = { ...v, items: [...v.items] };
  if (!mountPart(world, candidate, makePart(world, id, 0), mount)) return null;
  return everyGunFires(candidate) ? candidate : null;
}

function tryMountExtra(world: World, v: Vehicle, id: string, budget: number, mount?: Cell[]): Vehicle | null {
  const next = tryMountChoice(world, v, id, budget, mount);
  return next && meetsSpeedFloor(next) ? next : null;
}

function rollWear(world: World, rng: Rng, table: NpcLoadoutTable, level: Level, v: Vehicle): void {
  for (const item of v.items) {
    if (item.kind !== 'part' || partDef(item.part.defId).kind === 'core') continue;
    item.part = makePart(world, item.part.defId, wearOf(rng, table, level));
  }
}

function wearOf(rng: Rng, table: NpcLoadoutTable, level: Level): number {
  return Math.min(CONDITION.maxWear, Math.max(0, sampleWeighted(rng, table.wear) + level.wearShift));
}

const armedChoiceCache = new Map<string, ArmedChoice[]>();

function armedChoiceKey(table: NpcLoadoutTable, chassisId: string, budget: number): string {
  const values = (pool: Weighted<string>[]) => pool.map((entry) => entry.value);
  return JSON.stringify([chassisId, budget, table.minGuns, values(table.engine), values(table.weapon), values(table.extraGun)]);
}

function armedChoices(probe: World, template: NpcTemplate, chassisId: string, budget: number): ArmedChoice[] {
  const key = armedChoiceKey(template.loadout, chassisId, budget);
  let choices = armedChoiceCache.get(key);
  if (!choices) {
    choices = buildArmedChoices({ ...probe }, template, chassisId, budget);
    armedChoiceCache.set(key, choices);
  }
  return choices;
}

function withFreshIds(world: World, v: Vehicle): Vehicle {
  const items = v.items.map((item) => {
    const fresh = { ...item, id: newId(world, 'i') };
    return fresh.kind === 'part' ? { ...fresh, part: { ...fresh.part, id: newId(world, 'p') } } : fresh;
  });
  return { ...v, items };
}

function buildArmedChoices(world: World, template: NpcTemplate, chassisId: string, budget: number): ArmedChoice[] {
  const table = template.loadout;
  const bare = makeVehicle(world, { name: template.name, faction: template.faction, chassisId, parts: [], spares: [], cargo: {}, pos: { x: 0, y: 0 }, heading: 0, brain: null });
  const choices: ArmedChoice[] = [];
  for (const engine of table.engine) {
    const powered = tryMountChoice(world, bare, engine.value, budget);
    if (!powered) continue;
    for (const weapon of table.weapon) {
      const main = tryMountChoice(world, powered, weapon.value, budget);
      const armed = main && addRequiredGuns(world, table, main, budget);
      if (armed) choices.push({ engine: engine.value, weapon: weapon.value, vehicle: armed });
    }
  }
  return choices;
}

function addRequiredGuns(world: World, table: NpcLoadoutTable, v: Vehicle, budget: number): Vehicle | null {
  while (mountedItems(v, 'weapon').length < table.minGuns) {
    const next = table.extraGun.map((entry) => tryMountChoice(world, v, entry.value, budget)).find((x) => x !== null);
    if (!next) return null;
    v = next;
  }
  return v;
}

function chooseRequiredParts(rng: Rng, table: NpcLoadoutTable, choices: ArmedChoice[]): Vehicle {
  const engines = table.engine.filter((entry) => choices.some((choice) => choice.engine === entry.value));
  const engine = sampleWeighted(rng, engines);
  const weapons = table.weapon.filter((entry) => choices.some((choice) => choice.engine === engine && choice.weapon === entry.value));
  const weapon = sampleWeighted(rng, weapons);
  const choice = choices.find((entry) => entry.engine === engine && entry.weapon === weapon);
  if (!choice) throw new Error('Selected NPC engine and weapon have no fitting loadout');
  return choice.vehicle;
}

function chooseOptionalPart(world: World, rng: Rng, v: Vehicle, budget: number, pool: Weighted<string | null>[]): Vehicle {
  const choices: Weighted<Vehicle>[] = [];
  for (const entry of pool) {
    const candidate = entry.value === null ? v : tryMountExtra(world, v, entry.value, budget);
    if (candidate) choices.push({ value: candidate, weight: entry.weight });
  }
  if (!choices.length) throw new Error(`No eligible optional equipment for ${v.chassisId}. Add an explicit empty outcome or a fitting part.`);
  return sampleWeighted(rng, choices);
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
  const massLeft = () => Math.min(chassisDef(v.chassisId).ratedMass - vehicleMass(load), npcMassRoom(load));
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
    const part = makePart(world, defId, wearOf(rng, table, level));
    if (stowPart(world, load, part)) added.push({ defId, wear: part.wear });
  }
  return added;
}

function chooseVehicle(probe: World, rng: Rng, template: NpcTemplate, chassisId: string | null, level: Level): Vehicle {
  const table = template.loadout;
  const budget = table.budget * level.budget;
  const required = Math.max(budget, table.budget);
  const chassis = chassisId === null ? table.chassis : table.chassis.filter((entry) => entry.value === chassisId);
  const chassisChoices = chassis.map((entry) => ({ value: armedChoices(probe, template, entry.value, required), weight: entry.weight })).filter((entry) => entry.value.length > 0);
  if (!chassisChoices.length) throw new Error(`No valid required NPC loadout for ${template.id}`);
  let v = withFreshIds(probe, chooseRequiredParts(rng, table, sampleWeighted(rng, chassisChoices)));
  v = chooseOptionalPart(probe, rng, v, required, table.cargoPart);
  v = addGuns(probe, rng, table, level, v, budget);
  return addArmor(probe, rng, table, level, v, budget);
}

function addGuns(world: World, rng: Rng, table: NpcLoadoutTable, level: Level, v: Vehicle, budget: number): Vehicle {
  for (let spot = freeDeckCells(v); spot > 0; spot--) {
    if (nextRandom(rng) >= Math.min(1, level.fill * table.gunFill)) continue;
    const next = pickFitting(world, rng, table.extraGun, (id) => withinGunSlowdown(tryMountExtra(world, v, id, budget)));
    if (!next) break;
    v = next;
  }
  return v;
}

function withinGunSlowdown(v: Vehicle | null): Vehicle | null {
  const engine = v && mountedItems(v, 'engine')[0];
  if (!v || !engine) return v;
  return 1 - gunDrag(v, (partDef(engine.part.defId) as EngineDef).capacity) <= MAX_GUN_SLOWDOWN ? v : null;
}

function freeDeckCells(v: Vehicle): number {
  const taken = new Set(v.items.flatMap(itemCells).map((c) => cellKey(c.x, c.y)));
  const cells = gridOf(v).cells;
  return cells.flatMap((row, y) => row.flatMap((c, x) => (c === 'D' && !taken.has(cellKey(x, y)) ? [1] : []))).length;
}

function pickFitting(world: World, rng: Rng, pool: Weighted<string>[], mount: (id: string) => Vehicle | null): Vehicle | null {
  const fitting = pool.flatMap((entry) => {
    const vehicle = mount(entry.value);
    return vehicle ? [{ value: vehicle, weight: entry.weight }] : [];
  });
  return fitting.length ? sampleWeighted(rng, fitting) : null;
}

const SIDE_ORDER: Cell[][] = [['F'], ['L', 'R'], ['B']];
const EDGES: readonly Cell[] = ['F', 'B', 'L', 'R'];

function addArmor(world: World, rng: Rng, table: NpcLoadoutTable, level: Level, v: Vehicle, budget: number): Vehicle {
  const target = Math.round(edgeCells(v.chassisId) * level.armor);
  for (const sides of SIDE_ORDER) {
    if (armoredCells(v) >= target) break;
    const typed = pickFitting(world, rng, table.armor, (id) => tryMountExtra(world, v, id, budget, [sides[0]]));
    if (!typed) continue;
    v = typed;
    const type = mountedItems(v, 'armor').at(-1)!.part.defId;
    v = fillSides(world, v, type, sides, budget, target);
  }
  return v;
}

function fillSides(world: World, v: Vehicle, type: string, sides: Cell[], budget: number, target: number): Vehicle {
  for (let progress = true; progress && armoredCells(v) < target; ) {
    progress = false;
    for (const side of sides) {
      if (armoredCells(v) >= target) break;
      const next = tryMountExtra(world, v, type, budget, [side]);
      if (next) [v, progress] = [next, true];
    }
  }
  return v;
}

function edgeCells(chassisId: string): number {
  return baseGrid(chassisId).cells.flat().filter((c) => c !== null && EDGES.includes(c)).length;
}

function armoredCells(v: Vehicle): number {
  return mountedItems(v, 'armor').reduce((sum, item) => sum + itemCells(item).length, 0);
}

export function generateNpcLoadout(world: World, template: NpcTemplate, chassisId: string | null = null, level: GearLevel | null = null): NpcLoadout {
  const table = template.loadout;
  validateTable(table);
  const probe = { ...world };
  const rng = { rngState: world.rngState };
  const wearRng = { rngState: world.marketRng.rngState };
  const gear = level ?? sampleWeighted(rng, table.levels);
  const v = chooseVehicle(probe, rng, template, chassisId, GEAR_LEVELS[gear]);
  rollWear(probe, wearRng, table, GEAR_LEVELS[gear], v);
  const { spares, carried } = chooseCargo(probe, rng, wearRng, table, GEAR_LEVELS[gear], v);
  world.rngState = rng.rngState;
  world.marketRng = wearRng;
  return { chassisId: v.chassisId, level: gear, parts: mountedNonCore(v), spares, cargo: carried };
}
