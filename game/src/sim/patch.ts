// Roadside patches between two trucks. A patch lifts the broken engine, transmission and tank that strand a truck to
// PATCH.share of their max HP, with the repair math of src/sim/repair.ts and the patcher's Machining. The terms are
// the NPC's `patchDeal` decision, so traits and states shape them. A deal is a `patch` state held by the patcher

import { practice, skillEffect, vehicleHasPerk } from './progress';
import { PERK_NUMBERS } from '../data/skills';
import { REGION } from '../data/region';
import { PATCH } from '../data/wear';
import { isJunk, maxHp, restorePart } from './wear';
import { playerVehicle, vehicleById } from './damage';
import { getTradePrice } from './economy';
import { corePart, goodsCount, mountedParts } from './grid';
import { removeGoods } from './inventory';
import { isParkedForWork } from './jobs';
import { decide, optionWeights } from './npc-decisions';
import { machiningMult, planPartRepair } from './repair';
import { getResources } from './resources';
import { addState, type WorkLeft } from './states';
import { isStranded } from './stats';
import { inTowReach } from './tow';
import type { CallVar, NpcState, PartInstance, PatchDeal, StateData, Vehicle, World } from './types';
import { dist } from './vec';

export type PatchPlan = { parts: number; turns: number };
type Roles = { patcher: Vehicle; client: Vehicle };

function brokenParts(v: Vehicle): PartInstance[] {
  const engine = mountedParts(v, 'engine')[0];
  return [engine, corePart(v, 'transmission'), corePart(v, 'tank')].filter((p): p is PartInstance => p !== undefined && p.hp === 0 && !isJunk(p));
}

export function needsPatch(world: World, v: Vehicle): boolean {
  return isStranded(world, v) && brokenParts(v).length > 0;
}

export function canFixItself(world: World, v: Vehicle): boolean {
  return partsHeld(v) >= patchPlan(world, { patcher: v, client: v }).parts;
}

export function patchPlan(world: World, { patcher, client }: Roles): PatchPlan {
  const mult = machiningMult(world, patcher);
  const plans = brokenParts(client).map((p) => planPartRepair(p, PATCH.share, mult, Infinity, Infinity));
  return { parts: plans.reduce((sum, p) => sum + p.parts, 0), turns: plans.reduce((sum, p) => sum + p.turns, 0) };
}

function rolesWith(world: World, npc: Vehicle): Roles {
  const me = playerVehicle(world);
  return needsPatch(world, npc) ? { patcher: me, client: npc } : { patcher: npc, client: me };
}

function partsHeld(v: Vehicle): number {
  return goodsCount(v).parts ?? 0;
}

function partsValue(world: World, client: Vehicle, parts: number): number {
  const town = REGION.towns.reduce((a, b) => (dist(client.pos, a.pos) <= dist(client.pos, b.pos) ? a : b));
  return parts * getTradePrice(world, client, town.id, 'parts', 'buy');
}

function priceOf(world: World, deal: PatchDeal, roles: Roles, plan: PatchPlan): number {
  const labor = plan.turns * PATCH.laborPerTurn;
  if (deal === 'free') return 0;
  const full = deal === 'ownParts' ? labor : labor + partsValue(world, roles.client, plan.parts);
  const mechanic = vehicleHasPerk(world, roles.patcher, 'roadMechanic') ? PERK_NUMBERS.roadMechanic.price : 1;
  return Math.round(full * mechanic * (1 - skillEffect(world, roles.client, 'social', 'patchPrice')));
}

function partsPayer(deal: PatchDeal, roles: Roles): Vehicle {
  return deal === 'ownParts' ? roles.client : roles.patcher;
}

export function promisedParts(world: World, v: Vehicle): number {
  let total = 0;
  for (const s of world.states) {
    if (s.kind !== 'patch' || !partiesPresent(world, s)) continue;
    const roles = { patcher: vehicleById(world, s.holder), client: vehicleById(world, s.other) };
    const data = patchData(s);
    if (partsPayer(data.deal, roles) === v) total += data.parts;
  }
  return total;
}

function canPay(world: World, v: Vehicle, amount: number): boolean {
  return v.id === world.player.vehicleId || getResources(world, v).money >= amount;
}

export function dealAvailable(deal: PatchDeal): (world: World, npc: Vehicle) => boolean {
  return (world, npc) => {
    const roles = rolesWith(world, npc);
    const plan = patchPlan(world, roles);
    if (plan.parts === 0) return false;
    return partsHeld(partsPayer(deal, roles)) >= plan.parts && canPay(world, roles.client, priceOf(world, deal, roles, plan));
  };
}

export function patchTerms(world: World, npc: Vehicle): CallVar | null {
  const subject = world.player.vehicleId;
  if (Object.keys(optionWeights(world, npc, 'patchDeal', subject, null)).length === 0) return null;
  const roles = rolesWith(world, npc);
  const deal = decide(world, npc, 'patchDeal', subject, null);
  const plan = patchPlan(world, roles);
  const patcher = roles.patcher.id === subject ? 'player' : 'npc';
  return { kind: 'deal', deal, patcher, price: priceOf(world, deal, roles, plan), parts: plan.parts, turns: plan.turns };
}

export function agreePatch(world: World, npc: Vehicle, terms: Extract<CallVar, { kind: 'deal' }>): NpcState {
  const { patcher, client } = rolesWith(world, npc);
  const data: StateData = { kind: 'patch', deal: terms.deal, parts: terms.parts, price: terms.price, work: terms.turns, workLeft: terms.turns };
  return addState(world, 'patch', patcher.id, client.id, data);
}

export function patchData(s: NpcState): Extract<StateData, { kind: 'patch' }> {
  if (s.data.kind !== 'patch') throw new Error(`State ${s.id} holds no patch`);
  return s.data;
}

export function isPatching(world: World, s: NpcState): boolean {
  const patcher = vehicleById(world, s.holder);
  const client = vehicleById(world, s.other);
  return isParkedForWork(world, patcher) && isParkedForWork(world, client) && inTowReach(patcher, client);
}

export function advancePatches(world: World): void {
  for (const s of world.states) {
    if (s.kind !== 'patch' || !workUnderWay(world, s)) continue;
    const data = patchData(s);
    if (data.workLeft === data.work) world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'started' });
    data.workLeft--;
  }
}

function workUnderWay(world: World, s: NpcState): boolean {
  return partiesPresent(world, s) && isPatching(world, s);
}

export function patchWork(world: World, s: NpcState): WorkLeft | null {
  if (!workUnderWay(world, s)) return null;
  const data = patchData(s);
  return { turnsLeft: data.workLeft, total: data.work };
}

function partiesPresent(world: World, s: NpcState): boolean {
  return world.vehicles.some((v) => v.id === s.holder) && world.vehicles.some((v) => v.id === s.other);
}

export function checkPatch(world: World, s: NpcState): 'fulfilled' | 'broken' | null {
  if (!partiesPresent(world, s)) return null;
  const data = patchData(s);
  const roles = { patcher: vehicleById(world, s.holder), client: vehicleById(world, s.other) };
  if (!canStillPay(world, data, roles)) return 'broken';
  return data.workLeft <= 0 ? 'fulfilled' : null;
}

function canStillPay(world: World, data: Extract<StateData, { kind: 'patch' }>, roles: Roles): boolean {
  return partsHeld(partsPayer(data.deal, roles)) >= data.parts && canPay(world, roles.client, data.price);
}

export function settlePatch(world: World, s: NpcState): void {
  const data = patchData(s);
  const roles = { patcher: vehicleById(world, s.holder), client: vehicleById(world, s.other) };
  removeGoods(partsPayer(data.deal, roles), 'parts', data.parts);
  getResources(world, roles.client).money -= data.price;
  getResources(world, roles.patcher).money += data.price;
  for (const part of brokenParts(roles.client)) restorePart(part, Math.max(1, Math.round(maxHp(part) * PATCH.share)));
  world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'done' });
  if (s.holder === world.player.vehicleId) practice(world, 'patch', 1, null, s.other);
  if (s.holder === world.player.vehicleId) practice(world, 'deal', 1, null, s.other);
  if (s.other === world.player.vehicleId) practice(world, 'deal', 1, null, s.holder);
}

export function breakPatch(world: World, s: NpcState): void {
  world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'broken' });
}

export function lapsePatch(world: World, s: NpcState): void {
  world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'lapsed' });
}
