import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { GEAR_LEVELS, GEAR_LEVEL_IDS, MAX_GUN_SLOWDOWN, NPC_UPKEEP, NPC_WEAR, PRIORITY_TOP, SCRAP_ARMOR, type CargoRoll, type GearLevel, type LoadoutPriorities, type NpcLoadoutTable, type NpcTemplate, type Weighted } from '../data/npcs';
import { partDef, type EngineDef, type PartKind } from '../data/parts';
import { CONDITION } from '../data/wear';
import { everyGunFires } from './armor';
import { makePart, makeVehicle, newId, type PartSpec } from './factory';
import { cellKey, freeCells, gridOf, itemCells, mountedItems, type Cell } from './grid';
import { addGoods, mountPart, stowPart } from './inventory';
import { vehicleMass } from './mass';
import { gunDrag, meetsSpeedFloor, npcMassRoom, speedShare } from './stats';
import { nextRandom, type Rng } from './rng';
import type { GridItem, Vehicle, World } from './types';

export type NpcLoadout = {
  chassisId: string;
  level: GearLevel;
  parts: PartSpec[]; // mounted, non-core, with rolled wear
  spares: PartSpec[]; // loose parts carried but not mounted, traders only
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
  validateSpareTable(table.spares);
}

function validatePriorities(p: LoadoutPriorities): void {
  for (const [key, weight] of Object.entries(p)) if (!(weight >= 0 && weight <= PRIORITY_TOP)) throw new Error(`Loadout priority ${key} ${weight} must lie in 0 to ${PRIORITY_TOP}`);
  if (!(p.armor + p.firepower + p.cargo > 0)) throw new Error('Loadout priorities need armor, firepower or cargo above 0 to split the mass');
}

function validateGear(table: NpcLoadoutTable): void {
  validateWeights(table.levels);
  for (const { value } of table.levels) if (!GEAR_LEVEL_IDS.includes(value)) throw new Error(`Unknown gear level ${value}`);
  validatePriorities(table.priorities);
  if (!Number.isInteger(table.minGuns) || table.minGuns < 1) throw new Error(`minGuns ${table.minGuns} must be a whole number of at least 1`);
}

// The vehicle's chassis and mounted, non-core gear at pristine value (PC1, IV1). The engine is worn before the build,
// and the budget still counts it new, as every other part.
function computeEquipmentCost(v: Vehicle): number {
  return chassisDef(v.chassisId).value + v.items.reduce((sum, item) => {
    if (item.kind !== 'part' || partDef(item.part.defId).kind === 'core') return sum;
    return sum + partDef(item.part.defId).value;
  }, 0);
}

// A part is refused when it leaves any gun with no open side in its arc, like a front gun behind the cab.
// Probing checks feasibility at pristine wear, the most expensive and heaviest case a part can be. Any
// wear later rolled onto the mounted part only lowers its value, so a feasible pristine fit stays feasible.
// A fit that leaves any gun with no open side its arc reaches does not count, since that gun could never fire.
function tryMountChoice(world: World, v: Vehicle, id: string, budget: number, mount?: Cell[]): Vehicle | null {
  if (computeEquipmentCost(v) + partDef(id).value > budget) return null;
  if (vehicleMass(v) + partDef(id).mass > chassisDef(v.chassisId).ratedMass) return null;
  const candidate = { ...v, items: [...v.items] };
  if (!mountPart(world, candidate, makePart(world, id, 0), mount)) return null;
  return everyGunFires(candidate) ? candidate : null;
}

// What parts past the template minimum may take: the money, the share of its unloaded speed the truck keeps, the mass
// room kept free for cargo, the heaviest the truck may get with its armor, and how far the extra guns may slow it.
type Plan = { budget: number; share: number; cargoKg: number; armorCeiling: number; gunSlowdown: number };

// A part beyond the template minimum. Its weight and gun draw must leave the truck above its speed share and
// MIN_NPC_SPEED, with the plan's cargo room still free.
function tryMountExtra(world: World, v: Vehicle, id: string, plan: Plan, mount?: Cell[]): Vehicle | null {
  const next = tryMountChoice(world, v, id, plan.budget, mount);
  return next && meetsSpeedFloor(next, plan.share) && npcMassRoom(next, plan.share) >= plan.cargoKg ? next : null;
}

// One wear roll from NPC_WEAR per mounted non-core part, shifted by the gear level and clamped so a spawned part is
// never junk. Core parts stay wear 0. The engine keeps the wear rolled before the build.
function rollWear(world: World, rng: Rng, level: Level, v: Vehicle): void {
  for (const item of v.items) {
    if (item.kind !== 'part' || ['core', 'engine'].includes(partDef(item.part.defId).kind)) continue;
    item.part = makePart(world, item.part.defId, wearOf(rng, level));
  }
}

function wearOf(rng: Rng, level: Level): number {
  return Math.min(CONDITION.maxWear, Math.max(0, sampleWeighted(rng, NPC_WEAR) + level.wearShift));
}

// The choices depend only on data, so they are keyed by every input read, like gridCache in grid.ts. Cached vehicles
// are never handed out, see withFreshIds().
const armedChoiceCache = new Map<string, ArmedChoice[]>();

function armedChoiceKey(table: NpcLoadoutTable, chassisId: string, budget: number): string {
  const values = (pool: Weighted<string>[]) => pool.map((entry) => entry.value);
  return JSON.stringify([chassisId, budget, table.minGuns, values(table.engine), values(table.weapon), values(table.extraGun)]);
}

function armedChoices(probe: World, template: NpcTemplate, chassisId: string, budget: number): ArmedChoice[] {
  const key = armedChoiceKey(template.loadout, chassisId, budget);
  let choices = armedChoiceCache.get(key);
  if (!choices) {
    // A copy of the probe keeps the build's ids off the real counter.
    choices = buildArmedChoices({ ...probe }, template, chassisId, budget);
    armedChoiceCache.set(key, choices);
  }
  return choices;
}

// A copy with new item and part ids, so one generation never shares ids and rollWear() never writes into the cache.
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

// Guns past the main one up to the template minimum, each the first of the extra gun pool that fits. Null when the
// minimum does not fit.
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

function chooseOptionalPart(world: World, rng: Rng, v: Vehicle, plan: Plan, pool: Weighted<string | null>[]): Vehicle {
  const choices: Weighted<Vehicle>[] = [];
  for (const entry of pool) {
    const candidate = entry.value === null ? v : tryMountExtra(world, v, entry.value, plan);
    if (candidate) choices.push({ value: candidate, weight: entry.weight });
  }
  if (!choices.length) throw new Error(`No eligible optional equipment for ${v.chassisId}. Add an explicit empty outcome or a fitting part.`);
  return sampleWeighted(rng, choices);
}

// Non-core mounted parts with the wear rolled onto each.
function mountedNonCore(v: Vehicle): PartSpec[] {
  return v.items.flatMap((item) =>
    item.kind === 'part' && partDef(item.part.defId).kind !== 'core' ? [{ defId: item.part.defId, wear: item.part.wear, at: { x: item.x, y: item.y, rot: item.rot } }] : [],
  );
}

type Room = { cells: number; mass: number };

// The level scales the rolled count, cut to what fits.
function chooseGoods(rng: Rng, table: NpcLoadoutTable, level: Level, room: Room): CargoRoll | null {
  const goods = table.goods.filter(({ value }) => value === null || (value.count <= room.cells && GOODS[value.good].mass * value.count <= room.mass));
  if (!goods.length) throw new Error('No fitting cargo outcome for this NPC template');
  const roll = sampleWeighted(rng, goods);
  if (!roll) return null;
  const count = Math.min(Math.max(1, Math.round(roll.count * level.cargo)), room.cells, Math.floor(room.mass / GOODS[roll.good].mass));
  return { good: roll.good, count };
}

// Repair parts, goods and spares, in that order of priority, loaded onto a copy of the truck with the same calls
// the factory uses, so everything chosen fits at spawn. Rated mass caps the load too.
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

// Loose parts a driver carries to sell, as many of the rolled count as fit the grid and rated mass.
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

// Rolls the engine's wear first, then the chassis, engine and main gun among the builds that keep MIN_NPC_SPEED on an
// engine that worn, so the guns suit the engine. Then one utility part, then armor and extra guns by the template's
// priorities. The utility part comes first, so a full deck of guns never crowds out a hauler's cargo part. Armor comes
// before extra guns, so a driver covers its sides before it adds firepower. Each part fits the level's budget and the
// rated mass at pristine wear.
function chooseVehicle(probe: World, rng: Rng, wearRng: Rng, template: NpcTemplate, chassisId: string | null, level: Level): Vehicle {
  const table = template.loadout;
  const budget = table.budget * level.budget;
  // The required build and the utility part get at least the template budget, so a poor roll still drives, shoots
  // and hauls. The level budget limits the extra guns and armor.
  const required = Math.max(budget, table.budget);
  const engineWear = wearOf(wearRng, level);
  const choices = fastChoices(probe, rng, template, chassisId, required, engineWear);
  let v = wearEngine(probe, withFreshIds(probe, chooseRequiredParts(rng, table, choices)), engineWear);
  const share = speedShare(table.priorities);
  // The utility part belongs to what the template is, like the required build, so only MIN_NPC_SPEED holds it back.
  v = chooseOptionalPart(probe, rng, v, { budget: required, share: 0, cargoKg: 0, armorCeiling: Infinity, gunSlowdown: 0 }, table.cargoPart);
  const plan = massPlan(v, table.priorities, budget, share);
  v = addArmor(probe, rng, table, v, plan);
  return addGuns(probe, rng, table, v, plan);
}

// The required builds of one chassis, picked by chassis weight among those with a build that keeps MIN_NPC_SPEED on
// an engine at `wear`. A given chassis keeps the truck the driver already has.
function fastChoices(probe: World, rng: Rng, template: NpcTemplate, chassisId: string | null, budget: number, wear: number): ArmedChoice[] {
  const table = template.loadout;
  const chassis = chassisId === null ? table.chassis : table.chassis.filter((entry) => entry.value === chassisId);
  const all = chassis.map((entry) => ({ value: armedChoices(probe, template, entry.value, budget), weight: entry.weight }));
  if (all.every((entry) => entry.value.length === 0)) throw new Error(`No valid required NPC loadout for ${template.id}`);
  const fast = (c: ArmedChoice) => meetsSpeedFloor(wearEngine(probe, c.vehicle, wear), 0);
  const choices = all.map((entry) => ({ ...entry, value: entry.value.filter(fast) })).filter((entry) => entry.value.length > 0);
  if (!choices.length) throw new Error(`No ${template.id} build on ${chassisId ?? 'any chassis'} keeps MIN_NPC_SPEED on an engine at wear ${wear}`);
  return sampleWeighted(rng, choices);
}

// A copy with its engine at `wear`, keeping the engine's part id.
function wearEngine(world: World, v: Vehicle, wear: number): Vehicle {
  const worn = (item: GridItem): GridItem => (item.kind === 'part' && partDef(item.part.defId).kind === 'engine' ? { ...item, part: { ...makePart(world, item.part.defId, wear), id: item.part.id } } : item);
  return { ...v, items: v.items.map(worn) };
}

// Splits the mass the truck can take above its speed share between armor and free cargo room by their priorities, and
// scales the extra guns' slowdown by firepower.
function massPlan(v: Vehicle, p: LoadoutPriorities, budget: number, share: number): Plan {
  const room = Math.max(0, Math.min(chassisDef(v.chassisId).ratedMass - vehicleMass(v), npcMassRoom(v, share)));
  const split = p.armor + p.cargo;
  const armorKg = split > 0 ? (room * p.armor) / split : 0;
  const cargoKg = split > 0 ? (room * p.cargo) / split : 0;
  return { budget, share, cargoKg, armorCeiling: vehicleMass(v) + armorKg, gunSlowdown: (MAX_GUN_SLOWDOWN * p.firepower) / PRIORITY_TOP };
}

// Every free deck cell is a spot for one more gun while the money, the speed share, the cargo room and the plan's gun
// slowdown allow. The template minimum is already mounted.
function addGuns(world: World, rng: Rng, table: NpcLoadoutTable, v: Vehicle, plan: Plan): Vehicle {
  for (let spot = freeDeckCells(v); spot > 0; spot--) {
    const next = pickFitting(world, rng, table.extraGun, (id) => withinGunSlowdown(tryMountExtra(world, v, id, plan), plan.gunSlowdown));
    if (!next) break;
    v = next;
  }
  return v;
}

// The truck, or null when its guns slow it past `slowdown` on its pristine engine.
function withinGunSlowdown(v: Vehicle | null, slowdown: number): Vehicle | null {
  const engine = v && mountedItems(v, 'engine')[0];
  if (!v || !engine) return v;
  return 1 - gunDrag(v, (partDef(engine.part.defId) as EngineDef).capacity) <= slowdown ? v : null;
}

function freeDeckCells(v: Vehicle): number {
  const taken = new Set(v.items.flatMap(itemCells).map((c) => cellKey(c.x, c.y)));
  const cells = gridOf(v).cells;
  return cells.flatMap((row, y) => row.flatMap((c, x) => (c === 'D' && !taken.has(cellKey(x, y)) ? [1] : []))).length;
}

// A weighted pick among the pool entries that `mount` can fit, mounted. Null when none fits.
function pickFitting(world: World, rng: Rng, pool: Weighted<string>[], mount: (id: string) => Vehicle | null): Vehicle | null {
  const fitting = pool.flatMap((entry) => {
    const vehicle = mount(entry.value);
    return vehicle ? [{ value: vehicle, weight: entry.weight }] : [];
  });
  return fitting.length ? sampleWeighted(rng, fitting) : null;
}

const SIDE_ORDER: Cell[][] = [['F'], ['L', 'R'], ['B']];

// Armors sides in order, the front, both flanks, the rear, while the plan's armor mass and the money allow. Each side
// takes one armor type, picked among those that fit there. Flanks alternate pieces so both sides match. Cells the
// typed armor leaves bare get scrap, so a driver short of money still bolts something on every side.
function addArmor(world: World, rng: Rng, table: NpcLoadoutTable, v: Vehicle, plan: Plan): Vehicle {
  const mount = (u: Vehicle, id: string, side: Cell) => (vehicleMass(u) + partDef(id).mass <= plan.armorCeiling ? tryMountExtra(world, u, id, plan, [side]) : null);
  for (const sides of SIDE_ORDER) {
    const typed = pickFitting(world, rng, table.armor, (id) => mount(v, id, sides[0]));
    if (!typed) continue;
    v = typed;
    const type = mountedItems(v, 'armor').at(-1)!.part.defId;
    v = fillSides(v, type, sides, mount);
  }
  for (const sides of SIDE_ORDER) v = fillSides(v, SCRAP_ARMOR, sides, mount);
  return v;
}

function fillSides(v: Vehicle, type: string, sides: Cell[], mount: (u: Vehicle, id: string, side: Cell) => Vehicle | null): Vehicle {
  for (let progress = true; progress; ) {
    progress = false;
    for (const side of sides) {
      const next = mount(v, type, side);
      if (next) [v, progress] = [next, true];
    }
  }
  return v;
}

// A fresh loadout for the template at a rolled gear level, or at `level` when given. A given chassis keeps the
// truck the driver already has.
export function generateNpcLoadout(world: World, template: NpcTemplate, chassisId: string | null = null, level: GearLevel | null = null): NpcLoadout {
  const table = template.loadout;
  validateTable(table);
  // Probes may allocate IDs, but only the completed selection advances the real world's RNG.
  const probe = { ...world };
  const rng = { rngState: world.rngState };
  // Wear and spares draw from the market stream, so they never shift the main stream's decisions.
  const wearRng = { rngState: world.marketRng.rngState };
  const gear = level ?? sampleWeighted(rng, table.levels);
  const v = chooseVehicle(probe, rng, wearRng, template, chassisId, GEAR_LEVELS[gear]);
  rollWear(probe, wearRng, GEAR_LEVELS[gear], v);
  const { spares, carried } = chooseCargo(probe, rng, wearRng, table, GEAR_LEVELS[gear], v);
  world.rngState = rng.rngState;
  world.marketRng = wearRng;
  return { chassisId: v.chassisId, level: gear, parts: mountedNonCore(v), spares, cargo: carried };
}
