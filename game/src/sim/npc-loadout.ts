import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { GEAR_DRAWS, GEAR_LEVELS, GEAR_LEVEL_IDS, GEAR_WHIM, MAX_GUN_SLOWDOWN, NPC_UPKEEP, NPC_WEAR, PRIORITY_TOP, SCRAP_ARMOR, type CargoRoll, type GearLevel, type LoadoutPriorities, type NpcLoadoutTable, type NpcTemplate, type Weighted } from '../data/npcs';
import { NPC_UTILITY_PARTS, type UtilityRoll } from '../data/npc-utilities';
import { partDef, type EngineDef, type PartKind } from '../data/parts';
import { CONDITION } from '../data/wear';
import { everyGunFires } from './armor';
import { makePart, makeVehicle, newId, type PartSpec } from './factory';
import { freeCells, mountedItems, type Cell } from './grid';
import { addGoods, mountPart, stowPart } from './inventory';
import { vehicleMass } from './mass';
import { gearBaseline, gearScore, type Load } from './npc-gear-score';
import { gunDrag, meetsSpeedFloor, npcMassRoom, speedShare } from './stats';
import { nextRandom, type Rng } from './rng';
import type { GridItem, Vehicle, World } from './types';
import { wornDef } from './wear';

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

// The template's utility pool. Every template must have one.
function utilityPoolOf(template: NpcTemplate): UtilityRoll[] {
  const pool = NPC_UTILITY_PARTS[template.id];
  if (!pool) throw new Error(`NPC template ${template.id} has no utility pool`);
  return pool;
}

// A utility pool holds utility parts and the harpoon, the gun that ties a line, which drivers carry as gear rather
// than as one of their guns.
function validateUtilityPool(pool: UtilityRoll[]): void {
  validateWeights(pool);
  const stray = pool.find(({ value }) => value !== null && !isGearPart(value));
  if (stray) throw new Error(`NPC utility pool holds ${stray.value}, not a utility or a line gun`);
  for (const { levels } of pool) for (const level of levels ?? []) if (!GEAR_LEVEL_IDS.includes(level)) throw new Error(`Unknown gear level ${level}`);
}

function isGearPart(defId: string): boolean {
  const def = partDef(defId);
  return def.kind === 'utility' || (def.kind === 'weapon' && def.line !== undefined);
}

// The utility rolls open to the gear level: those with no level list, and those that name it.
function utilityRollsAt(pool: UtilityRoll[], gear: GearLevel): Weighted<string | null>[] {
  return pool.filter((entry) => !entry.levels || entry.levels.includes(gear));
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
  if (!(p.armor + p.firepower > 0)) throw new Error('Loadout priorities need firepower or armor above 0 for the driver to judge a fight');
}

function validateGear(table: NpcLoadoutTable): void {
  validateWeights(table.levels);
  for (const { value } of table.levels) if (!GEAR_LEVEL_IDS.includes(value)) throw new Error(`Unknown gear level ${value}`);
  validatePriorities(table.priorities);
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

// What parts past the main gun may take: the money, and the share of its unloaded speed the truck keeps.
type Plan = { budget: number; share: number };

// A part beyond the main gun. Its weight and gun draw must leave the truck above its speed share and MIN_NPC_SPEED.
function tryMountExtra(world: World, v: Vehicle, id: string, plan: Plan, mount?: Cell[]): Vehicle | null {
  const next = tryMountChoice(world, v, id, plan.budget, mount);
  return next && meetsSpeedFloor(next, plan.share) ? next : null;
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
  return JSON.stringify([chassisId, budget, values(table.engine), values(table.weapon)]);
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
      const armed = tryMountChoice(world, powered, weapon.value, budget);
      if (armed) choices.push({ engine: engine.value, weapon: weapon.value, vehicle: armed });
    }
  }
  return choices;
}

// The engine, then the main gun, each by weight among the choices left by the earlier pick.
function chooseRequiredParts(rng: Rng, table: NpcLoadoutTable, choices: ArmedChoice[]): Vehicle {
  const engine = sampleWeighted(rng, table.engine.filter((entry) => choices.some((choice) => choice.engine === entry.value)));
  const withEngine = choices.filter((choice) => choice.engine === engine);
  const weapon = sampleWeighted(rng, table.weapon.filter((entry) => withEngine.some((choice) => choice.weapon === entry.value)));
  const choice = withEngine.find((entry) => entry.weapon === weapon);
  if (!choice) throw new Error('Selected NPC engine and weapon have no fitting loadout');
  return choice.vehicle;
}

function chooseOptionalPart(world: World, rng: Rng, v: Vehicle, plan: Plan, pool: Weighted<string | null>[], accepts: (next: Vehicle) => boolean = () => true): Vehicle {
  const choices: Weighted<Vehicle>[] = [];
  for (const entry of pool) {
    const candidate = optionalCandidate(world, v, entry.value, plan, accepts);
    if (candidate) choices.push({ value: candidate, weight: entry.weight });
  }
  if (!choices.length) throw new Error(`No eligible optional equipment for ${v.chassisId}. Add an explicit empty outcome or a fitting part.`);
  return sampleWeighted(rng, choices);
}

// The truck with the pool entry mounted, or as it stands for the empty entry. Null when the part does not fit or
// `accepts` refuses the truck with it.
function optionalCandidate(world: World, v: Vehicle, defId: string | null, plan: Plan, accepts: (next: Vehicle) => boolean): Vehicle | null {
  if (defId === null) return v;
  const next = tryMountExtra(world, v, defId, plan);
  return next && accepts(next) ? next : null;
}

// Non-core mounted parts with the wear rolled onto each.
function mountedNonCore(v: Vehicle): PartSpec[] {
  return v.items.flatMap((item) =>
    item.kind === 'part' && partDef(item.part.defId).kind !== 'core' ? [{ defId: item.part.defId, wear: item.part.wear, at: { x: item.x, y: item.y, rot: item.rot } }] : [],
  );
}

type Room = { cells: number; mass: number };

// The biggest load the template carries at this level, as chooseCargo() loads it: the repair parts, the biggest
// goods roll and the most spares of the biggest spare part. A good takes one cell.
function biggestLoad(table: NpcLoadoutTable, level: Level): Load {
  const counts = table.goods.map(({ value }) => (value ? { n: Math.max(1, Math.round(value.count * level.cargo)), kg: GOODS[value.good].mass } : { n: 0, kg: 0 }));
  const repair = NPC_UPKEEP.repairParts;
  const goods = { kg: Math.max(0, ...counts.map((c) => c.n * c.kg)), cells: Math.max(0, ...counts.map((c) => c.n)) };
  const spares = table.spares ? Math.round(Math.max(...table.spares.count.map((c) => c.value)) * level.cargo) : 0;
  const pool = table.spares ? table.spares.pool.flatMap((p) => (p.value ? [partDef(p.value)] : [])) : [];
  const spareKg = spares * Math.max(0, ...pool.map((def) => def.mass));
  const spareCells = spares * Math.max(0, ...pool.map((def) => def.w * def.h));
  return { kg: repair * GOODS.parts.mass + goods.kg + spareKg, cells: repair + goods.cells + spareCells };
}

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
// engine that worn, so the guns suit the engine. Then one cargo part and one utility part, then guns and armor by
// pickGear(). Those parts come first, so a full deck of guns never crowds out a hauler's cargo part or a driver's
// utility. Each part fits the money and the rated mass at pristine wear.
function chooseVehicle(probe: World, rng: Rng, wearRng: Rng, template: NpcTemplate, chassisId: string | null, gear: GearLevel): Vehicle {
  const table = template.loadout;
  const level = GEAR_LEVELS[gear];
  const engineWear = wearOf(wearRng, level);
  const choices = fastChoices(probe, rng, template, chassisId, table.budget, engineWear);
  let v = wearEngine(probe, withFreshIds(probe, chooseRequiredParts(rng, table, choices)), engineWear);
  // The cargo and utility parts belong to what the template is, like the base build, so only MIN_NPC_SPEED holds them
  // back. A gun among them, the harpoon, also keeps the gun power limit.
  const whole = { budget: table.budget, share: 0 };
  v = chooseOptionalPart(probe, rng, v, whole, table.cargoPart);
  v = chooseOptionalPart(probe, rng, v, whole, utilityRollsAt(utilityPoolOf(template), gear), withinGunDraw);
  // The template budget is a standard truck's whole value. The money left past the base build is the gear money, and
  // the gear level scales it, so a poor driver still buys a little gear.
  const base = computeEquipmentCost(v);
  const budget = base + level.budget * Math.max(0, table.budget - base);
  return pickGear(probe, rng, table, v, { budget, share: speedShare(table.priorities) }, biggestLoad(table, level));
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

const SIDE_GROUPS: Cell[][] = [['F'], ['L', 'R'], ['B']];

// One step a truck could take next: one gun from the extra gun pool, or one armor type over a side group, as many
// pieces as fit, so the side is covered and both flanks match. Scrap is on offer to every driver. Each keeps the money,
// the rated mass, the speed share, MIN_NPC_SPEED and the gun power limit, or gives null.
type GearMove = (v: Vehicle) => Vehicle | null;

function gearMoves(world: World, table: NpcLoadoutTable, plan: Plan): Weighted<GearMove>[] {
  const moves: Weighted<GearMove>[] = table.extraGun.map((gun) => ({
    value: (v) => {
      const next = tryMountExtra(world, v, gun.value, plan);
      return next && withinGunDraw(next) ? next : null;
    },
    weight: gun.weight,
  }));
  const pieces = [...table.armor, ...(table.armor.some((a) => a.value === SCRAP_ARMOR) ? [] : [{ value: SCRAP_ARMOR, weight: 1 }])];
  for (const piece of pieces) {
    for (const group of SIDE_GROUPS) moves.push({ value: (v) => coverSides(v, group, (u, side) => tryMountExtra(world, u, piece.value, plan, [side])), weight: piece.weight });
  }
  return moves;
}

// The truck with pieces mounted round the sides in turn until none fits, or null when not one fits.
function coverSides(v: Vehicle, sides: Cell[], mount: (u: Vehicle, side: Cell) => Vehicle | null): Vehicle | null {
  let added = false;
  for (let progress = true; progress; ) {
    progress = false;
    for (const side of sides) {
      const next = mount(v, side);
      if (next) [v, progress, added] = [next, true, true];
    }
  }
  return added ? v : null;
}

// Whether the guns slow the truck by no more than MAX_GUN_SLOWDOWN on its worn engine.
function withinGunDraw(v: Vehicle): boolean {
  const engine = mountedItems(v, 'engine')[0];
  return 1 - gunDrag(v, wornDef<EngineDef>(engine.part).capacity) <= MAX_GUN_SLOWDOWN;
}

// Adds guns and armor one pick at a time, judged by gearScore(). Each step goes through the moves in a random order
// weighted by pool weight and keeps the first GEAR_DRAWS that fit and beat the truck as it stands. It takes the one
// that gains the most for what it uses, or with GEAR_WHIM odds a random one of them. The driver stops when no move
// beats the truck.
function pickGear(world: World, rng: Rng, table: NpcLoadoutTable, v: Vehicle, plan: Plan, load: Load): Vehicle {
  const rival = coverSides(v, ['F'], (u, side) => tryMountChoice(world, u, table.armor[0].value, Infinity, [side])) ?? v;
  const base = gearBaseline(v, rival, table.priorities, load);
  const moves = gearMoves(world, table, plan);
  const score = (u: Vehicle) => gearScore(world, u, table.priorities, base);
  for (;;) {
    const now = score(v);
    const from = v;
    const drawn = drawBetter(rng, moves, v, (next) => (score(next) - now) / used(from, next, plan));
    if (!drawn.length) return v;
    v = nextRandom(rng) < GEAR_WHIM ? drawn[Math.floor(nextRandom(rng) * drawn.length)].v : drawn.reduce((a, b) => (b.worth > a.worth ? b : a)).v;
  }
}

// The first GEAR_DRAWS moves, in weighted random order, that fit and are worth taking.
function drawBetter(rng: Rng, moves: Weighted<GearMove>[], v: Vehicle, worth: (next: Vehicle) => number): { v: Vehicle; worth: number }[] {
  const drawn: { v: Vehicle; worth: number }[] = [];
  for (const move of weightedOrder(rng, moves)) {
    const next = move(v);
    const gain = next ? worth(next) : 0;
    if (next && gain > 0) drawn.push({ v: next, worth: gain });
    if (drawn.length === GEAR_DRAWS) break;
  }
  return drawn;
}

// The values in a random order where heavier weights tend to come first: each sorts by a random key raised to one over
// its weight.
function weightedOrder<T>(rng: Rng, pool: Weighted<T>[]): T[] {
  return pool.map((entry) => ({ value: entry.value, key: nextRandom(rng) ** (1 / entry.weight) })).sort((a, b) => b.key - a.key).map((entry) => entry.value);
}

// The larger share an option takes of what the driver has left: the money, or the mass the truck can take before it
// drops below its speed share.
function used(v: Vehicle, next: Vehicle, plan: Plan): number {
  const money = (computeEquipmentCost(next) - computeEquipmentCost(v)) / Math.max(1, plan.budget - computeEquipmentCost(v));
  const mass = (vehicleMass(next) - vehicleMass(v)) / Math.max(1, npcMassRoom(v, plan.share));
  return Math.max(money, mass);
}

// A fresh loadout for the template at a rolled gear level, or at `level` when given. A given chassis keeps the
// truck the driver already has.
export function generateNpcLoadout(world: World, template: NpcTemplate, chassisId: string | null = null, level: GearLevel | null = null): NpcLoadout {
  const table = template.loadout;
  validateTable(table);
  validateUtilityPool(utilityPoolOf(template));
  // Probes may allocate IDs, but only the completed selection advances the real world's RNG.
  const probe = { ...world };
  const rng = { rngState: world.rngState };
  // Wear and spares draw from the market stream, so they never shift the main stream's decisions.
  const wearRng = { rngState: world.marketRng.rngState };
  const gear = level ?? sampleWeighted(rng, table.levels);
  const v = chooseVehicle(probe, rng, wearRng, template, chassisId, gear);
  rollWear(probe, wearRng, GEAR_LEVELS[gear], v);
  const { spares, carried } = chooseCargo(probe, rng, wearRng, table, GEAR_LEVELS[gear], v);
  world.rngState = rng.rngState;
  world.marketRng = wearRng;
  return { chassisId: v.chassisId, level: gear, parts: mountedNonCore(v), spares, cargo: carried };
}
