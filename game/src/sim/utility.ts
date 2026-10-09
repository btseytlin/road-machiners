// Utility parts: their charge, the orders that use them and the activation step of the turn. Each effect's world
// object has its own owner file; this file only checks orders and hands each use to its effect. The emitter's
// shutdown is the exception: it has no world object, only a window on each truck it hits, and it lives in its own

import { partDef, type PartDef, type UtilityDef, type UtilityEffect, type UtilityEffectType } from '../data/parts';
import { EMITTER, WORK } from '../data/utilities';
import { isHostile, noteAttack, type FireBlock } from './combat';
import { isKnockedOut } from './defeat';
import { isMounted, mountedParts } from './grid';
import { armClaymore } from './claymore';
import { endLines } from './harpoon';
import { deploySmoke, dropField, launchFlare, oilShort, spillOil } from './hazards';
import type { ChargeState, GameEvent, PartInstance, UtilityOrder, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { wornDef, wornTurns } from './wear';

export type UseKind = UtilityEffectType | 'claymore';

const ORDER_KIND: Record<UseKind, UtilityOrder['kind'] | null> = {
  sprout: 'self',
  caltrops: 'self',
  oil: 'self',
  emitter: 'self',
  claymore: 'self',
  mortar: 'point',
  flare: 'point',
  crane: null,
  scraper: null,
};

const USE_ORDER: Record<UseKind, number> = {
  sprout: 0,
  mortar: 0,
  flare: 0,
  caltrops: 1,
  oil: 1,
  claymore: 1,
  emitter: 2,
  crane: 3,
  scraper: 3,
};

type Use = { vehicle: Vehicle; part: PartInstance; order: UtilityOrder; kind: UseKind };

const passive = (kind: UseKind) => (): void => {
  throw new Error(`${kind} is passive and is never used`);
};
const ARMS: Record<UseKind, (world: World, use: Use) => void> = {
  sprout: (world, { vehicle, part }) => {
    const e = effectOf(part, 'sprout');
    deploySmoke(world, vehicle, vehicle.pos, e.radius, e.turns);
  },
  mortar: (world, { vehicle, part, order }) => {
    const e = effectOf(part, 'mortar');
    deploySmoke(world, vehicle, pointOf(order), e.radius, e.turns);
  },
  flare: (world, { vehicle, part, order }) => launchFlare(world, vehicle, pointOf(order), effectOf(part, 'flare')),
  caltrops: (world, { vehicle, part }) => dropField(world, vehicle, 'caltrops', effectOf(part, 'caltrops')),
  oil: (world, { vehicle, part }) => spillOil(world, vehicle, effectOf(part, 'oil')),
  claymore: (_world, { vehicle, part }) => armClaymore(vehicle, part),
  emitter: (world, { vehicle, part }) => pulse(world, vehicle, effectOf(part, 'emitter')),
  crane: passive('crane'),
  scraper: passive('scraper'),
};

function effectOf<T extends UtilityEffectType>(part: PartInstance, type: T): Extract<UtilityEffect, { type: T }> {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || def.effect.type !== type) throw new Error(`${def.name} is not a ${type}`);
  return def.effect as Extract<UtilityEffect, { type: T }>;
}

function pointOf(order: UtilityOrder): Vec {
  if (order.kind !== 'point') throw new Error(`A ${order.kind} order has no point`);
  return order.pos;
}

export function useKindOf(def: PartDef): UseKind {
  if (def.kind === 'utility') return def.effect.type;
  if (def.kind === 'armor' && def.claymore) return 'claymore';
  throw new Error(`${def.name} is not a utility`);
}

export function orderKindOf(part: PartInstance): UtilityOrder['kind'] | null {
  return ORDER_KIND[useKindOf(partDef(part.defId))];
}

export function chargedParts(v: Vehicle): PartInstance[] {
  return mountedParts(v).filter((p) => p.charge !== undefined);
}

export function chargeOf(part: PartInstance): ChargeState {
  if (!part.charge) throw new Error(`Part ${part.id} has no charge`);
  return part.charge;
}

export function wornReload(part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind === 'armor' && def.claymore) return wornTurns(def.claymore.reload, part.wear);
  const reload = def.kind === 'utility' ? wornDef<UtilityDef>(part).reload : null;
  if (reload === null) throw new Error(`${def.name} has no reload`);
  return reload;
}

function partOn(v: Vehicle, partId: string): { part: PartInstance; mounted: boolean } {
  for (const it of v.items)
    if (it.kind === 'part' && it.part.id === partId) return { part: it.part, mounted: isMounted(v.chassisId, it) };
  throw new Error(`${v.name} has no part ${partId}`);
}

export function utilityBlock(world: World, v: Vehicle, part: PartInstance): FireBlock | null {
  if (isKnockedOut(v)) return 'out';
  if (!partOn(v, part.id).mounted) return 'unmounted';
  if (part.hp <= 0) return 'disabled';
  if (isShutDown(world, v)) return 'shutDown';
  return chargeOf(part).reload > 0 ? 'cooldown' : null;
}

export function utilityOrderError(world: World, v: Vehicle, partId: string, order: UtilityOrder): string | null {
  const { part } = partOn(v, partId);
  const def = partDef(part.defId);
  const wanted = ORDER_KIND[useKindOf(def)];
  if (wanted === null) return `${def.name} is passive and takes no order`;
  if (order.kind !== wanted) return `${def.name} takes a ${wanted} order`;
  const charge = chargeError(world, v, part);
  if (charge) return `${def.name}: ${charge}`;
  return costError(world, v, def) ?? pointError(v, part, order);
}

function chargeError(world: World, v: Vehicle, part: PartInstance): string | null {
  return utilityBlock(world, v, part) ?? (chargeOf(part).armed ? 'armed' : null);
}

function costError(world: World, v: Vehicle, def: PartDef): string | null {
  if (def.kind !== 'utility' || def.effect.type !== 'oil') return null;
  return oilShort(world, v, def.effect.fuel) ? `${def.name}: fuel` : null;
}

function pointError(v: Vehicle, part: PartInstance, order: UtilityOrder): string | null {
  if (order.kind === 'point' && pointBlock(v, part, order.pos)) return `${partDef(part.defId).name}: range`;
  return null;
}

export function pointReach(part: PartInstance): { minRange: number; maxRange: number } {
  const def = partDef(part.defId);
  const e = def.kind === 'utility' ? def.effect : null;
  if (!e || !('maxRange' in e)) throw new Error(`${def.name} takes no point`);
  return { minRange: e.minRange, maxRange: e.maxRange };
}

export function pointBlock(v: Vehicle, part: PartInstance, pos: Vec): FireBlock | null {
  const { minRange, maxRange } = pointReach(part);
  const d = dist(v.pos, pos);
  return d < minRange || d > maxRange ? 'range' : null;
}

export function activateUtilities(world: World): void {
  const uses = world.vehicles.flatMap((vehicle) => takeUses(world, vehicle));
  uses.sort((a, b) => USE_ORDER[a.kind] - USE_ORDER[b.kind]);
  for (const use of uses) act(world, use);
}

function takeUses(world: World, vehicle: Vehicle): Use[] {
  const uses: Use[] = [];
  for (const [partId, order] of Object.entries(vehicle.utilityOrders)) {
    const use = oneShotUse(world, vehicle, partId, order);
    delete vehicle.utilityOrders[partId];
    if (use) uses.push(use);
  }
  return uses;
}

function held(vehicle: Vehicle, partId: string): boolean {
  return vehicle.items.some((it) => it.kind === 'part' && it.part.id === partId);
}

function oneShotUse(world: World, vehicle: Vehicle, partId: string, order: UtilityOrder): Use | null {
  return held(vehicle, partId) && utilityOrderError(world, vehicle, partId, order) === null ? useOf(vehicle, partId, order) : null;
}

function useOf(vehicle: Vehicle, partId: string, order: UtilityOrder): Use {
  const { part } = partOn(vehicle, partId);
  return { vehicle, part, order, kind: useKindOf(partDef(part.defId)) };
}

function act(world: World, use: Use): void {
  ARMS[use.kind](world, use);
  if (use.kind !== 'claymore') chargeOf(use.part).reload = wornReload(use.part);
  world.events.push({
    t: 'utility',
    vehicle: use.vehicle.id,
    part: use.part.id,
    effect: use.kind,
    point: use.order.kind === 'point' ? { ...use.order.pos } : null,
  });
}

export function tickCharges(world: World): void {
  for (const v of world.vehicles)
    for (const part of mountedParts(v)) if (part.charge && part.charge.reload > 0) part.charge.reload--;
}

export function hasWorkingUtility(v: Vehicle, effect: UtilityEffectType): boolean {
  return mountedParts(v, 'utility').some((p) => p.hp > 0 && (partDef(p.defId) as UtilityDef).effect.type === effect);
}

export function workTimeMult(v: Vehicle): number {
  return WORK.noCraneTime / (hasWorkingUtility(v, 'crane') ? WORK.craneSpeed : 1);
}

export function advanceUtilityEffects(world: World): void {
  world.smoke = aged(world.smoke);
  world.fields = aged(world.fields);
  world.flares = aged(world.flares);
  world.lines = aged(world.lines);
  endLines(world);
}

function aged<T extends { turnsLeft: number }>(effects: T[]): T[] {
  for (const e of effects) e.turnsLeft--;
  return effects.filter((e) => e.turnsLeft > 0);
}

type EmitterEffect = Extract<UtilityEffect, { type: 'emitter' }>;

function pulse(world: World, user: Vehicle, effect: EmitterEffect): void {
  const hit = world.vehicles.filter((v) => v.id !== user.id && dist(v.pos, user.pos) <= effect.radius);
  for (const v of hit) noteAttack(world, user, v, !isHostile(world, v, user));
  world.events.push({ t: 'pulse', vehicle: user.id, pos: { ...user.pos }, hit: hit.map((v) => v.id) });
}

export function settleShutdowns(world: World): void {
  for (const v of world.vehicles) if (v.shutDown && world.turn >= v.shutDown.until) delete v.shutDown;
  for (const e of world.events) if (e.t === 'pulse') shutDown(world, e);
}

function shutDown(world: World, e: Extract<GameEvent, { t: 'pulse' }>): void {
  const from = world.turn + EMITTER.startsAfter;
  const until = from + pulseEffect(world, e.vehicle).turns - 1;
  for (const v of world.vehicles) if (e.hit.includes(v.id)) v.shutDown = { from, until };
}

export function pulseEffect(world: World, userId: string): EmitterEffect {
  const user = [...world.vehicles, ...world.removed].find((v) => v.id === userId);
  if (!user) throw new Error(`Pulse from unknown vehicle ${userId}`);
  for (const part of mountedParts(user, 'utility')) {
    const def = partDef(part.defId);
    if (def.kind === 'utility' && def.effect.type === 'emitter') return def.effect;
  }
  throw new Error(`${user.name} pulsed with no emitter mounted`);
}

export function isShutDown(world: World, v: Vehicle): boolean {
  return v.shutDown !== undefined;
}

export function shutDownTurnsLeft(world: World, v: Vehicle): number {
  return v.shutDown ? v.shutDown.until - world.turn : 0;
}
