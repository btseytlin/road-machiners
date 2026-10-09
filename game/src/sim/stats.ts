// Derived vehicle numbers: chassis + installed parts + load + damage + player skills.
// Every rule that needs speed, turning or capacity reads it from here.

import { chassisDef } from '../data/chassis';
import { partDef, type EngineDef, type StoreDef, type WeaponDef } from '../data/parts';
import { MIN_NPC_SPEED, NPCS, PRIORITY_TOP, SPEED_SHARE, type LoadoutPriorities } from '../data/npcs';
import { RULES } from '../data/rules';
import { skillEffect } from './progress';
import { TOW } from '../data/tow';
import { maxHp, wornDef } from './wear';
import { openSides, type Side } from './armor';
import { corePart, coreParts, mountedItems, mountedParts } from './grid';
import { loadFactor, vehicleMass } from './mass';
import { getResources } from './resources';
import { isTowing } from './tow';
import { isShutDown } from './utility';
import type { PartInstance, Vehicle, World } from './types';
import { DEG } from './vec';
import { weatherOn } from './weather';
import { fuelUseScale } from './settings';

export type MountedWeapon = { part: PartInstance; def: WeaponDef; sides: Side[] };

export type VehicleStats = {
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number;
  turnFast: number;
  reverseTurn: number;
  fuelPerTile: number;
  limpSpeed: number;
  limpAccel: number;
  roughSkill: number;
  mass: number;
  radius: number;
  weapons: MountedWeapon[];
};

export function isWorking(part: PartInstance): boolean {
  return part.hp > 0;
}

export function hasWorkingEngine(v: Vehicle): boolean {
  const engines = mountedParts(v, 'engine');
  return engines.length > 0 && isWorking(engines[0]);
}

export function isStalled(world: World, v: Vehicle): boolean {
  return v.stalledUntil !== undefined && world.turn <= v.stalledUntil;
}

export function getMobilityCondition(v: Vehicle): number {
  const engine = mountedParts(v, 'engine')[0];
  if (!engine) return 0;
  const parts = [engine, corePart(v, 'transmission'), ...coreParts(v, 'wheel')];
  return Math.min(...parts.map((part) => part.hp / maxHp(part)));
}

export function isStranded(world: World, v: Vehicle): boolean {
  return !hasWorkingEngine(v) || !isWorking(corePart(v, 'transmission')) || getResources(world, v).fuel <= 0;
}

export type SpeedStep =
  | { kind: 'chassis'; base: number; speed: number }
  | { kind: 'engine'; worn: boolean; speed: number }
  | { kind: 'load'; factor: number; mass: number; rated: number; speed: number }
  | { kind: 'guns'; draw: number; capacity: number; factor: number; speed: number }
  | { kind: 'wheels'; broken: number; factor: number; speed: number }
  | { kind: 'floor'; speed: number }
  | { kind: 'overdrive'; factor: number; speed: number }
  | { kind: 'transmission'; speed: number }
  | { kind: 'limp'; cause: 'noEngine' | 'brokenEngine' | 'stalled'; speed: number }
  | { kind: 'weather'; factor: number; speed: number }
  | { kind: 'towing'; factor: number; speed: number };

export function maxSpeedSteps(world: World, v: Vehicle): SpeedStep[] {
  const steps: SpeedStep[] = [];
  walkSpeed(world, v, limpSpeedOf(world, v), loadFactor(v), brokenWheelCount(v), steps);
  return steps;
}

function brokenWheelCount(v: Vehicle): number {
  return coreParts(v, 'wheel').filter((p) => !isWorking(p)).length;
}

function walkSpeed(world: World, v: Vehicle, limpSpeed: number, load: number, broken: number, steps: SpeedStep[] | null): number {
  const driving = hasWorkingEngine(v) && !isStalled(world, v);
  const speed = driving ? drivingSpeed(world, v, limpSpeed, load, broken, steps) : limpSpeedStep(v, limpSpeed, steps);
  return conditionSpeed(world, v, speed, steps);
}

function limpSpeedStep(v: Vehicle, limpSpeed: number, steps: SpeedStep[] | null): number {
  const cause = mountedParts(v, 'engine').length === 0 ? 'noEngine' : !hasWorkingEngine(v) ? 'brokenEngine' : 'stalled';
  steps?.push({ kind: 'limp', cause, speed: limpSpeed });
  return limpSpeed;
}

function drivingSpeed(world: World, v: Vehicle, limpSpeed: number, load: number, broken: number, steps: SpeedStep[] | null): number {
  const ch = chassisDef(v.chassisId);
  const engine = mountedParts(v, 'engine')[0];
  const e = wornDef<EngineDef>(engine);
  let speed = ch.maxSpeed + e.speedBonus;
  steps?.push({ kind: 'chassis', base: ch.maxSpeed, speed: ch.maxSpeed }, { kind: 'engine', worn: engine.wear > 0, speed });
  speed *= load;
  steps?.push({ kind: 'load', factor: load, mass: vehicleMass(v), rated: ch.ratedMass, speed });
  const wheels = (1 - RULES.wheelLoss) ** broken;
  speed *= wheels;
  if (broken > 0) steps?.push({ kind: 'wheels', broken, factor: wheels, speed });
  const draw = gunDraw(v);
  const drag = gunDragOf(draw, e.capacity);
  speed *= drag;
  steps?.push({ kind: 'guns', draw, capacity: e.capacity, factor: drag, speed });
  return limitedSpeed(world, v, speed, limpSpeed, steps);
}

function limitedSpeed(world: World, v: Vehicle, from: number, limpSpeed: number, steps: SpeedStep[] | null): number {
  let speed = from;
  if (speed < RULES.minSpeedCap) {
    speed = RULES.minSpeedCap;
    steps?.push({ kind: 'floor', speed });
  }
  if (inOverdrive(world, v)) {
    speed *= RULES.overdriveBoost;
    steps?.push({ kind: 'overdrive', factor: RULES.overdriveBoost, speed });
  }
  return transmissionSpeed(v, speed, limpSpeed, steps);
}

function transmissionSpeed(v: Vehicle, from: number, limpSpeed: number, steps: SpeedStep[] | null): number {
  if (isWorking(corePart(v, 'transmission')) || from <= limpSpeed) return from;
  steps?.push({ kind: 'transmission', speed: limpSpeed });
  return limpSpeed;
}

function conditionSpeed(world: World, v: Vehicle, from: number, steps: SpeedStep[] | null): number {
  let speed = from;
  const weather = weatherOn(world, v).speed;
  if (weather !== 1) {
    speed *= weather;
    steps?.push({ kind: 'weather', factor: weather, speed });
  }
  if (isTowing(world, v.id)) {
    speed *= TOW.speedShare;
    steps?.push({ kind: 'towing', factor: TOW.speedShare, speed });
  }
  return speed;
}

export function vehicleStats(world: World, v: Vehicle): VehicleStats {
  const ch = chassisDef(v.chassisId);
  const mass = vehicleMass(v);
  const load = loadFactor(v);
  const force = ch.handlingMass / mass;
  const brokenWheels = brokenWheelCount(v);
  const wheels = (1 - RULES.wheelLoss) ** brokenWheels;
  const turnMult = (1 + skillEffect(world, v, 'driving', 'turnRate')) * load * wheels;
  const limpSpeed = limpSpeedOf(world, v);
  const limpAccel = limpSpeed * ch.accel;

  const { maxSpeed, accel, fuelMult } = driveOf(world, v, { limpSpeed, limpAccel, load, brokenWheels, force });

  return {
    maxSpeed,
    accel,
    brake: ch.brake * force,
    turnSlow: ch.turnSlow * DEG * turnMult,
    turnFast: ch.turnFast * DEG * turnMult,
    reverseTurn: ch.reverseTurn * DEG * turnMult,
    fuelPerTile: ch.fuelPerTile * fuelMult * RULES.fuelUseFactor * fuelUseScale(world),
    limpSpeed,
    limpAccel,
    roughSkill: skillEffect(world, v, 'driving', 'roughSpeed'),
    mass,
    radius: ch.radius,
    weapons: mountedItems(v, 'weapon').map((item) => ({ part: item.part, def: wornDef<WeaponDef>(item.part), sides: openSides(v, item) })),
  };
}

type Drive = { maxSpeed: number; accel: number; fuelMult: number };
type DriveShares = { limpSpeed: number; limpAccel: number; load: number; brokenWheels: number; force: number };

function driveOf(world: World, v: Vehicle, s: DriveShares): Drive {
  if (isShutDown(world, v)) return { maxSpeed: 0, accel: 0, fuelMult: 0 };
  const maxSpeed = walkSpeed(world, v, s.limpSpeed, s.load, s.brokenWheels, null);
  if (!hasWorkingEngine(v) || isStalled(world, v)) return { maxSpeed, accel: s.limpAccel, fuelMult: 0 };
  const ch = chassisDef(v.chassisId);
  const e = wornDef<EngineDef>(mountedParts(v, 'engine')[0]);
  const boost = inOverdrive(world, v) ? RULES.overdriveBoost : 1;
  const accel = (ch.accel + e.accelBonus) * s.force * RULES.accelScale * gunDragOf(gunDraw(v), e.capacity) * boost;
  return { maxSpeed, accel, fuelMult: e.fuelMult };
}

export function gunDraw(v: Vehicle): number {
  let draw = 0;
  for (const item of mountedItems(v, 'weapon')) if (isWorking(item.part)) draw += wornDef<WeaponDef>(item.part).draw;
  return draw;
}

export function workingEngineCapacity(v: Vehicle): number | null {
  return hasWorkingEngine(v) ? wornDef<EngineDef>(mountedParts(v, 'engine')[0]).capacity : null;
}

export function gunDrag(v: Vehicle, capacity: number): number {
  return gunDragOf(gunDraw(v), capacity);
}

function gunDragOf(draw: number, capacity: number): number {
  return 1 - RULES.gunDragMax * Math.min(1, draw / capacity) ** RULES.gunDragCurve;
}

export function npcMassRoom(v: Vehicle, share = templateSpeedShare(v)): number {
  const needed = neededLoadFactor(v, share);
  if (loadFactor(v) < needed) return 0;
  let low = 0;
  let high = chassisDef(v.chassisId).ratedMass;
  while (loadFactor(v, high) >= needed) high *= 2;
  while (high - low > 1) {
    const mid = (low + high) / 2;
    if (loadFactor(v, mid) >= needed) low = mid;
    else high = mid;
  }
  return low;
}

export function meetsSpeedFloor(v: Vehicle, share: number): boolean {
  return loadFactor(v) >= neededLoadFactor(v, share);
}

function neededLoadFactor(v: Vehicle, share: number): number {
  const engine = mountedParts(v, 'engine')[0];
  if (!engine) return share;
  const e = wornDef<EngineDef>(engine);
  const unloaded = chassisDef(v.chassisId).maxSpeed + e.speedBonus;
  const floor = unloaded > 0 ? MIN_NPC_SPEED / unloaded : Infinity;
  return Math.max(share, floor) / gunDrag(v, e.capacity);
}

export function speedShare(priorities: LoadoutPriorities): number {
  return SPEED_SHARE.low + ((SPEED_SHARE.high - SPEED_SHARE.low) * priorities.speed) / PRIORITY_TOP;
}

function templateSpeedShare(v: Vehicle): number {
  const template = v.brain && NPCS[v.brain.templateId];
  if (!template) throw new Error(`${v.id} has no NPC template to read its speed share from`);
  return speedShare(template.loadout.priorities);
}

export function inOverdrive(world: World, v: Vehicle): boolean {
  return v.id === world.player.vehicleId && world.player.overdrive && canOverdrive(v);
}

export function canOverdrive(v: Vehicle): boolean {
  const engine = mountedParts(v, 'engine')[0];
  return engine !== undefined && engine.hp > RULES.overdriveMinEngineShare * maxHp(engine);
}

export function fuelCap(v: Vehicle): number {
  return chassisDef(v.chassisId).fuelCap + storeRoom(v, 'fuel');
}

export function suppliesCap(v: Vehicle): number {
  return RULES.baseSupplies + storeRoom(v, 'supplies');
}

function storeRoom(v: Vehicle, holds: StoreDef['holds']): number {
  const stores = mountedParts(v, 'store').map((part) => partDef(part.defId) as StoreDef);
  return stores.filter((def) => def.holds === holds).reduce((sum, def) => sum + def.amount, 0);
}

function limpSpeedOf(world: World, v: Vehicle): number {
  return RULES.limpSpeed * (1 + skillEffect(world, v, 'driving', 'crawl'));
}

export function groundSpeed(s: VehicleStats, factor: number): number {
  return 1 - (1 - factor) * (1 - s.roughSkill);
}

export function maxTurn(s: VehicleStats, speed: number): number {
  if (speed < RULES.crawlSpeed) return s.turnSlow * Math.max(0, speed / RULES.crawlSpeed);
  const t = s.maxSpeed <= RULES.crawlSpeed ? 0 : (speed - RULES.crawlSpeed) / (s.maxSpeed - RULES.crawlSpeed);
  const k = Math.min(1, Math.max(0, t));
  return s.turnSlow + (s.turnFast - s.turnSlow) * k;
}
