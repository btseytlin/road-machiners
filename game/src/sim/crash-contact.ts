import { PHYSICS } from '../data/physics';
import { lanesAt } from './body';
import { corePart, coreParts, mountedParts } from './grid';
import { NPC_BEHAVIOR } from '../data/npcs';
import { isHostile, noteCollision } from './combat';
import { getMobilityCondition, isStranded, vehicleStats } from './stats';
import { angleDiff, bearing, dist, type Vec } from './vec';
import { laneCount, passShare, ramMult, sideToward, walkLane, type PartHit, type Side } from './armor';
import { partDef, sustainedDamage } from '../data/parts';
import { isJunk, maxHp, restorePart } from './wear';
import { damagePart } from './damage';
import { RULES } from '../data/rules';
import { practice, skillEffect, vehicleHasPerk } from './progress';
import { PERK_NUMBERS } from '../data/skills';
import { vehicleMass } from './mass';
import { bodyOf } from './body';
import { towsClient } from './tow';
import { claymoresSetOff, detonateOnCrash, detonateOnObstacle } from './claymore';
import type { Vehicle, World } from './types';
import { damageScale } from './settings';

export type CrashContact = { side: Side; lanes: number[] };
export type CrashGeometry = { a: CrashContact; b: CrashContact | null };

export function applyContactCrash(world: World, a: Vehicle, b: Vehicle | null, what: string, impact: number, contact: CrashGeometry): void {
  if (!Number.isFinite(impact) || impact < 0) throw new Error(`Bad crash impact ${impact}`);
  if (Boolean(b) !== Boolean(contact.b)) throw new Error('Crash geometry does not match the bodies');
  if (b) {
    const blasts = claymoreBlasts(world, a, b, impact, contact);
    const { hitsA, hitsB } = damageVehicleCrash(world, a, b, impact, contact);
    stallRammed(world, a, b, hitsA, hitsB);
    noteCollision(world, a, b, hitsA, hitsB);
    world.events.push({ t: 'collision', a: a.id, b: b.id, hitsA, hitsB });
    blasts();
    practiceRam(world, a, b, hitsA, hitsB);
    return;
  }
  const crash = { impact, own: contact.a, theirs: null };
  const rams = world.obstacles.some((o) => o.id === what) ? claymoresSetOff(world, a, null, crash) : [];
  const hitsA = applyContactDamage(world, a, contact.a, impact, 1, hardCrash(impact));
  world.events.push({ t: 'collision', a: a.id, b: what, hitsA, hitsB: [] });
  detonateOnObstacle(world, a, what, rams, crash);
}

export function applyGroundCrash(world: World, v: Vehicle, what: string, impact: number, contact: CrashContact): void {
  if (!Number.isFinite(impact) || impact < 0) throw new Error(`Bad ground crash impact ${impact}`);
  const hitsA = applyContactDamage(world, v, contact, impact, 1, RULES.groundCrash);
  world.events.push({ t: 'collision', a: v.id, b: what, hitsA, hitsB: [] });
}

export function applyLanding(world: World, v: Vehicle, what: string, impact: number): void {
  if (!Number.isFinite(impact) || impact < 0) throw new Error(`Bad landing impact ${impact}`);
  if (impact < RULES.collisionMinImpact) return;
  const driving = skillEffect(world, v, 'driving', 'crashDamage');
  const damage = RULES.ramDamage * RULES.crashDamage * damageScale(world) * RULES.landingDamage * impact * impact * Math.max(0, 1 - driving);
  const hitsA = coreParts(v, 'wheel').filter((wheel) => wheel.hp > 0).map((wheel) => ({ part: wheel.id, damage: damagePart(world, v, wheel, damage) }));
  world.events.push({ t: 'collision', a: v.id, b: what, hitsA, hitsB: [] });
}

function claymoreBlasts(world: World, a: Vehicle, b: Vehicle, impact: number, contact: CrashGeometry): () => void {
  if (!contact.b) throw new Error('Vehicle crash has no target contact');
  const forA = { impact, own: contact.a, theirs: contact.b };
  const forB = { impact, own: contact.b, theirs: contact.a };
  const ramsA = claymoresSetOff(world, a, b, forA);
  const ramsB = claymoresSetOff(world, b, a, forB);
  return () => {
    detonateOnCrash(world, a, b, ramsA, forA);
    detonateOnCrash(world, b, a, ramsB, forB);
  };
}

function hardCrash(impact: number): number {
  return Math.max(1, impact / RULES.hardCrashSpeed) ** 2;
}

function practiceRam(world: World, a: Vehicle, b: Vehicle, hitsA: PartHit[], hitsB: PartHit[]): void {
  const ram = playerRam(world, a, b, hitsA, hitsB);
  if (!ram) return;
  const { own, other, damage } = ram;
  practice(world, 'ram', damage, vehicleMass(other) / (vehicleMass(other) + vehicleMass(own)), other.id);
}

function stallRammed(world: World, a: Vehicle, b: Vehicle, hitsA: PartHit[], hitsB: PartHit[]): void {
  const ram = playerRam(world, a, b, hitsA, hitsB);
  if (!ram || !vehicleHasPerk(world, ram.own, 'rammer') || !isHostile(world, ram.own, ram.other)) return;
  ram.other.stalledUntil = world.turn + PERK_NUMBERS.rammer.stallTurns;
}

function playerRam(world: World, a: Vehicle, b: Vehicle, hitsA: PartHit[], hitsB: PartHit[]): { own: Vehicle; other: Vehicle; damage: number } | null {
  const me = world.player.vehicleId;
  if (a.id !== me && b.id !== me) return null;
  const [own, other, dealt] = a.id === me ? [a, b, hitsB] : [b, a, hitsA];
  const damage = dealt.reduce((sum, hit) => sum + hit.damage, 0);
  return damage === 0 ? null : { own, other, damage };
}

function damageVehicleCrash(world: World, a: Vehicle, b: Vehicle, impact: number, contact: CrashGeometry): { hitsA: PartHit[]; hitsB: PartHit[] } {
  if (!contact.b) throw new Error('Vehicle crash has no target contact');
  const share = vehicleMass(b) / (vehicleMass(a) + vehicleMass(b));
  const multA = ramMult(a, contact.a.side);
  const multB = ramMult(b, contact.b.side);
  if (towsClient(world, a, b) || towsClient(world, b, a)) return { hitsA: [], hitsB: [] };
  const hitsA = applyContactDamage(world, a, contact.a, impact, share, multB);
  const hitsB = applyContactDamage(world, b, contact.b, impact, 1 - share, multA);
  return { hitsA, hitsB };
}

function applyContactDamage(world: World, vehicle: Vehicle, contact: CrashContact, impact: number, share: number, mult: number): PartHit[] {
  if (contact.lanes.length === 0) throw new Error('Crash has no touched lanes');
  if (impact < RULES.collisionMinImpact) return [];
  const energy = computeCrashEnergy(world, vehicle, impact, share, mult);
  const hits = new Map<string, number>();
  const round = { damage: energy / laneCount(vehicle, contact.side), pen: RULES.crashPen * mult, blast: false, armorShare: 1 };
  for (const lane of contact.lanes) {
    const copy = structuredClone(vehicle);
    const draft = { ...world, player: structuredClone(world.player), events: [] };
    for (const hit of walkLane(draft, copy, contact.side, lane, round)) {
      hits.set(hit.part, (hits.get(hit.part) ?? 0) + hit.damage);
    }
  }
  return applyCrashHits(world, vehicle, hits);
}

function computeCrashEnergy(world: World, vehicle: Vehicle, impact: number, share: number, mult: number): number {
  const driving = skillEffect(world, vehicle, 'driving', 'crashDamage');
  return RULES.ramDamage * RULES.crashDamage * damageScale(world) * impact * impact * share * mult * Math.max(0, 1 - driving);
}

function applyCrashHits(world: World, vehicle: Vehicle, hits: Map<string, number>): PartHit[] {
  const parts = new Map(mountedParts(vehicle).map((part) => [part.id, part]));
  return [...hits].map(([id, damage]) => {
    const part = parts.get(id);
    if (!part) throw new Error(`Crash hit unknown part ${id}`);
    return { part: id, damage: damagePart(world, vehicle, part, damage) };
  });
}

export function ramImpact(world: World, attacker: Vehicle, target: Vehicle): number | null {
  if (isStranded(world, attacker)) return null;
  const heading = bearing(attacker.pos, target.pos);
  if (Math.abs(angleDiff(attacker.heading, heading)) > Math.PI / 4) return null;
  const stats = vehicleStats(world, attacker);
  const speed = Math.min(stats.maxSpeed, attacker.speed + stats.accel);
  const along = target.speed * Math.cos(target.heading - heading);
  const impact = Math.max(0, speed - along);
  return impact < RULES.collisionMinImpact ? null : impact;
}

export type PartLoss = { defId: string; lost: number };
export type RamForecast = { dealt: PartLoss[]; cost: PartLoss[]; fit: boolean };

export function forecastRam(world: World, attacker: Vehicle, target: Vehicle, impact: number): RamForecast {
  const own = structuredClone(attacker);
  const other = structuredClone(target);
  for (const part of mountedParts(other)) if (!isJunk(part)) restorePart(part, maxHp(part));
  const intact = structuredClone(other);
  const draft = { ...world, player: structuredClone(world.player), events: [] };
  own.heading = bearing(attacker.pos, target.pos);
  damageVehicleCrash(draft, own, other, impact, estimateCrashGeometry(own, other, other.pos));
  const minimum = NPC_BEHAVIOR.fleeCondition;
  const cab = corePart(own, 'cab');
  const fit = getMobilityCondition(attacker) > NPC_BEHAVIOR.recoverCondition && getMobilityCondition(own) > minimum && cab.hp > maxHp(cab) * minimum;
  return { dealt: partLosses(intact, other), cost: partLosses(attacker, own), fit };
}

function partLosses(before: Vehicle, after: Vehicle): PartLoss[] {
  const hp = new Map(mountedParts(before).map((part) => [part.id, part.hp]));
  return mountedParts(after).flatMap((part) => {
    const previous = hp.get(part.id);
    if (previous === undefined) throw new Error(`Ram forecast introduced part ${part.id}`);
    return previous > part.hp ? [{ defId: part.defId, lost: previous - part.hp }] : [];
  });
}

const R = NPC_BEHAVIOR.ram;

export function ramValue(world: World, attacker: Vehicle, target: Vehicle): number {
  const impact = ramImpact(world, attacker, target);
  if (impact === null) return 0;
  const forecast = forecastRam(world, attacker, target, impact);
  const net = weighed(forecast.dealt) - weighed(forecast.cost);
  if (!forecast.fit || net <= 0) return 0;
  const turns = turnsToClose(world, attacker, target, impact);
  const worth = ramHitChance(world, attacker, target, impact) * net;
  const guns = gunDamage(world, attacker, target) * R.gunWeight * (1 + turns);
  return worth / (worth + guns);
}

export function ramFactor(world: World, attacker: Vehicle, target: Vehicle): number {
  const value = ramValue(world, attacker, target);
  return value > 0 ? value * R.valueScale : R.riskyRam;
}

export function ramHitChance(world: World, attacker: Vehicle, target: Vehicle, impact: number): number {
  const line = bearing(attacker.pos, target.pos);
  const sway = target.speed * (R.dodge + Math.abs(Math.sin(angleDiff(target.heading, line)))) * turnsToClose(world, attacker, target, impact);
  return 1 / (1 + sway / pathWidth(world, attacker, target));
}

function turnsToClose(world: World, attacker: Vehicle, target: Vehicle, impact: number): number {
  const gap = Math.max(0, dist(attacker.pos, target.pos) - pathWidth(world, attacker, target));
  return gap / impact;
}

function pathWidth(world: World, attacker: Vehicle, target: Vehicle): number {
  return vehicleStats(world, attacker).radius + vehicleStats(world, target).radius;
}

function weighed(losses: PartLoss[]): number {
  return losses.reduce((sum, { defId, lost }) => sum + lost * partWeight(defId), 0);
}

function partWeight(defId: string): number {
  const def = partDef(defId);
  const key = def.kind === 'core' ? def.role : def.kind;
  const weight = R.partWeight[key];
  if (weight === undefined) throw new Error(`No ram part weight for ${key}`);
  return weight;
}

function gunDamage(world: World, attacker: Vehicle, target: Vehicle): number {
  const side = sideToward(target, attacker.pos);
  return vehicleStats(world, attacker).weapons.filter((mw) => mw.part.hp > 0).reduce((sum, mw) => sum + sustainedDamage(mw.def) * passShare(target, side, mw.def.round), 0);
}

export function estimateCrashGeometry(a: Vehicle, b: Vehicle | null, from: Vec): CrashGeometry {
  return { a: estimateBodyContact(a, b, from), b: b ? estimateBodyContact(b, a, a.pos) : null };
}

function estimateBodyContact(vehicle: Vehicle, other: Vehicle | null, from: Vec): CrashContact {
  const angle = bearing(vehicle.pos, from) - vehicle.heading;
  const normal = { x: Math.cos(angle), y: Math.sin(angle) };
  const side = selectContactSide(normal);
  const front = side === 'front' || side === 'rear';
  const extent = other ? computeProjectedExtent(other, vehicle.heading, front) : 0;
  const distance = Math.hypot(from.x - vehicle.pos.x, from.y - vehicle.pos.y) * PHYSICS.metersPerTile;
  const across = front ? Math.sin(angle) * distance : Math.cos(angle) * distance;
  const points = front
    ? [{ x: 0, y: across - extent }, { x: 0, y: across + extent }]
    : [{ x: across - extent, y: 0 }, { x: across + extent, y: 0 }];
  return locateCrashContact(vehicle.chassisId, points, normal);
}

function computeProjectedExtent(vehicle: Vehicle, heading: number, front: boolean): number {
  const body = bodyOf(vehicle.chassisId);
  const relative = vehicle.heading - heading;
  const c = Math.abs(Math.cos(relative));
  const s = Math.abs(Math.sin(relative));
  return front ? body.half.x * s + body.half.z * c : body.half.x * c + body.half.z * s;
}

function selectContactSide(normal: Vec): Side {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) return normal.x >= 0 ? 'front' : 'rear';
  return normal.y >= 0 ? 'right' : 'left';
}

export function locateCrashContact(chassisId: string, points: Vec[], normal: Vec): CrashContact {
  if (points.length === 0) throw new Error('Crash has no contact points');
  const side = selectContactSide(normal);
  const front = side === 'front' || side === 'rear';
  const values = points.map((point) => (front ? point.y : point.x));
  return { side, lanes: lanesAt(chassisId, front ? 'column' : 'row', Math.min(...values), Math.max(...values)) };
}

export function computeClosingSpeed(relative: Vec, normal: Vec): number {
  const length = Math.hypot(normal.x, normal.y);
  if (!(length > 0)) throw new Error('Crash normal has no horizontal direction');
  return Math.max(0, (relative.x * normal.x + relative.y * normal.y) / length);
}
