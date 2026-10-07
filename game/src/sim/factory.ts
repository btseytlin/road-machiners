// Building vehicles and parts with world-unique ids.

import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { NPC_RESOURCES } from '../data/npcs';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { maxHp } from './wear';
import { gridOf, isMounted, placementError } from './grid';
import { addGoods, mountPart, stowPart } from './inventory';
import type { Faction, GridItem, NpcBrain, PartInstance, Vehicle, World } from './types';
import type { Vec } from './vec';

// A part to create, with its wear step. `at` places it on that grid spot instead of the first fitting mount.
export type PartSpec = { defId: string; wear: number; at?: Pick<GridItem, 'x' | 'y' | 'rot'> };

export type VehicleSpec = {
  name: string;
  faction: Faction;
  chassisId: string;
  parts: PartSpec[]; // mounted in order on the first free fitting mount
  spares: PartSpec[]; // loose parts stowed in the grid after the cargo
  cargo: Record<string, number>;
  pos: Vec;
  heading: number;
  brain: NpcBrain | null;
};

// What makes ids: a world, or a counter of its own for a truck that never joins one.
export type IdSource = Pick<World, 'nextId'>;

export function newId(world: IdSource, prefix: string): string {
  world.nextId++;
  return `${prefix}${world.nextId}`;
}

// A part at the given wear step, at full HP for that step.
export function makePart(world: IdSource, defId: string, wear: number): PartInstance {
  if (!Number.isInteger(wear) || wear < 0 || wear > CONDITION.maxWear) throw new Error(`Bad wear ${wear} for a new ${defId}`);
  const part: PartInstance = { id: newId(world, 'p'), defId, hp: 0, wear, ...gunFor(defId), ...chargeFor(defId) };
  return { ...part, hp: maxHp(part) };
}

// A weapon starts with a full magazine. Other parts carry no gun state.
export function gunFor(defId: string): Pick<PartInstance, 'gun'> {
  const def = partDef(defId);
  return def.kind === 'weapon' ? { gun: { cooldown: 0, ammo: def.magazine, reloadWork: 0 } } : {};
}

// An active utility and a claymore ram start ready. Other parts carry no charge.
export function chargeFor(defId: string): Pick<PartInstance, 'charge'> {
  const def = partDef(defId);
  const active = (def.kind === 'utility' && def.reload !== null) || (def.kind === 'armor' && def.claymore !== undefined);
  return active ? { charge: { reload: 0 } } : {};
}

// Places the chassis's built-in parts at their fixed cells. Throws if a spot is taken or is not built-in cells.
export function addCoreParts(world: IdSource, v: Vehicle): void {
  for (const c of chassisDef(v.chassisId).core) {
    const def = partDef(c.defId);
    if (def.kind !== 'core') throw new Error(`${c.defId} on ${v.chassisId} is not a core part`);
    const item: GridItem = { id: newId(world, 'i'), x: c.x, y: c.y, rot: c.rot ?? 0, kind: 'part', part: makePart(world, c.defId, 0) };
    const err = placementError(gridOf(v), v.items, item, null);
    if (err) throw new Error(`${def.name} at ${c.x},${c.y} on ${v.chassisId}: ${err}`);
    if (!isMounted(v.chassisId, item)) throw new Error(`${def.name} at ${c.x},${c.y} on ${v.chassisId} is not on built-in cells`);
    v.items.push(item);
  }
}

export function makeVehicle(world: World, spec: VehicleSpec): Vehicle {
  const v = bareVehicle(world, spec);
  loadVehicle(world, v, spec);
  return v;
}

// A truck with only its chassis's built-in parts: cab, wheels and cores.
export function bareVehicle(world: IdSource, spec: Omit<VehicleSpec, 'parts' | 'spares' | 'cargo'>): Vehicle {
  chassisDef(spec.chassisId);
  const v: Vehicle = {
    id: newId(world, 'v'),
    name: spec.name,
    faction: spec.faction,
    chassisId: spec.chassisId,
    items: [],
    pos: { ...spec.pos },
    heading: spec.heading,
    speed: 0,
    order: null,
    direct: false,
    weaponOrders: {},
    utilityOrders: {},
    trail: [],
    brain: spec.brain,
    resources: spec.faction === 'player' ? null : { ...NPC_RESOURCES, fuel: Math.min(NPC_RESOURCES.fuel, chassisDef(spec.chassisId).fuelCap), health: RULES.maxHealth },
    lastHitBy: null,
    job: null,
  };
  addCoreParts(world, v);
  return v;
}

// Mounts the parts, then adds cargo, then stows the spares. Throws when any of them does not fit.
function loadVehicle(world: World, v: Vehicle, spec: VehicleSpec): void {
  for (const { defId, wear, at } of spec.parts) {
    const part = makePart(world, defId, wear);
    if (at) placeAt(world, v, part, at);
    else if (!mountPart(world, v, part)) throw new Error(`No free mount for ${defId} on ${spec.chassisId}`);
  }
  loadCargo(world, v, spec);
}

function placeAt(world: World, v: Vehicle, part: PartInstance, at: NonNullable<PartSpec['at']>): void {
  const item: GridItem = { id: newId(world, 'i'), kind: 'part', part, ...at };
  const error = placementError(gridOf(v), v.items, item, item.id);
  if (error) throw new Error(`Cannot place ${part.defId} at ${at.x},${at.y} on ${v.chassisId}: ${error}`);
  v.items.push(item);
}

function loadCargo(world: World, v: Vehicle, spec: VehicleSpec): void {
  for (const [good, n] of Object.entries(spec.cargo)) {
    if (addGoods(world, v, good, n) < n) throw new Error(`No room for ${n} ${good} on ${spec.chassisId}`);
  }
  for (const { defId, wear } of spec.spares) {
    if (!stowPart(world, v, makePart(world, defId, wear))) throw new Error(`No room for spare ${defId} on ${spec.chassisId}`);
  }
}
