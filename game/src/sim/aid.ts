// Fuel and supply aid between the player and one NPC. One truck gives the other fuel, supplies or both, paid or
// free. A deal is an `aid` state held by the NPC toward the player. Once agreed, the NPC's meet goal brings the two
// trucks side by side. The player then starts the handover with [E]: one turn of shared work, paused when a truck moves and

import { ECONOMY } from '../data/goods';
import { AID } from '../data/npc-behavior';
import { RULES } from '../data/rules';
import { inCombat, inFeud, isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { talkOf } from './dialogue';
import { isMeeting, supplyRoom, transfer, truckSupplyForSale, type Supply } from './economy';
import { vehicleValue } from './market';
import { fuelReserveFor, inDanger, meetGoal, react } from './npc-activities';
import { bodyCondition } from './npc-decisions';
import { corePart } from './grid';
import { dropLeftoverOrder } from './jobs';
import { practice } from './progress';
import { getResources } from './resources';
import { addState, aidData, endState, stateOf, type WorkLeft } from './states';
import { fuelCap, suppliesCap } from './stats';
import type { NpcState, StateData, StateEnding, Vehicle, World } from './types';
import { canVehicleSee } from './vision';
import { playerCommand } from './world';

export type AidAmounts = { fuel: number; supplies: number };
type AidTerms = Omit<Extract<StateData, { kind: 'aid' }>, 'kind' | 'agreed' | 'started' | 'work' | 'workLeft'>;

const HANDOVER = { started: false, work: AID.handoverTurns, workLeft: AID.handoverTurns };

const SUPPLIES: readonly Supply[] = ['fuel', 'supplies'];

function capOf(v: Vehicle, kind: Supply): number {
  return kind === 'fuel' ? fuelCap(v) : suppliesCap(v);
}

export function isLowOn(world: World, v: Vehicle, kind: Supply): boolean {
  return getResources(world, v)[kind] <= capOf(v, kind) * RULES.lowFuelThreshold;
}

export function isLow(world: World, v: Vehicle): boolean {
  return SUPPLIES.some((kind) => isLowOn(world, v, kind));
}

export function looksPoor(v: Vehicle): boolean {
  return bodyCondition(v) < AID.poorCondition && vehicleValue(v) <= AID.poorValue;
}

export function playerAid(world: World): NpcState | null {
  return world.states.find((s) => s.kind === 'aid' && s.other === world.player.vehicleId) ?? null;
}

function amountsBy(pick: (kind: Supply) => number): AidAmounts {
  return { fuel: pick('fuel'), supplies: pick('supplies') };
}

export function wantedAid(world: World, npc: Vehicle): AidAmounts {
  const held = getResources(world, npc);
  const target = (kind: Supply) => {
    const share = capOf(npc, kind) * AID.fillShare;
    if (kind !== 'fuel') return share;
    return corePart(npc, 'tank')?.hp === 0 ? 0 : Math.min(share, Math.max(1, Math.ceil(fuelReserveFor(world, npc))));
  };
  const want = (kind: Supply) => Math.max(0, Math.floor(target(kind) - held[kind]));
  return amountsBy((kind) => (isLowOn(world, npc, kind) ? Math.min(want(kind), Math.floor(world.player[kind])) : 0));
}

export function spareAid(world: World, npc: Vehicle): AidAmounts {
  const me = playerVehicle(world);
  const gift = (kind: Supply) => Math.min(Math.floor(capOf(me, kind) * AID.giftShare), truckSupplyForSale(npc, kind), supplyRoom(world, kind));
  return amountsBy((kind) => (isLowOn(world, me, kind) ? gift(kind) : 0));
}

export function hasAid(a: AidAmounts): boolean {
  return a.fuel > 0 || a.supplies > 0;
}

function aidValue(a: AidAmounts): number {
  return a.fuel * ECONOMY.supplyPrice.fuel + a.supplies * ECONOMY.supplyPrice.supplies;
}

export function aidPrice(world: World, npc: Vehicle, a: AidAmounts): number {
  return Math.max(0, Math.min(aidValue(a), getResources(world, npc).money));
}

export function canSpareFor(world: World, npc: Vehicle): boolean {
  return hasAid(spareAid(world, npc)) && playerAid(world) === null;
}

export function offerAid(world: World, npc: Vehicle): void {
  const data: StateData = { kind: 'aid', giver: 'npc', ...spareAid(world, npc), price: 0, free: true, agreed: false, ...HANDOVER };
  addState(world, 'aid', npc.id, world.player.vehicleId, data);
}

export function agreeAid(world: World, npc: Vehicle, terms: AidTerms): NpcState {
  const s = addState(world, 'aid', npc.id, world.player.vehicleId, { kind: 'aid', ...terms, agreed: true, ...HANDOVER });
  meetGoal(world, npc, playerVehicle(world), terms.giver === 'npc' ? 'bring fuel and supplies' : 'pick up fuel and supplies');
  return s;
}

export function refuseAid(world: World, npc: Vehicle): void {
  const s = stateOf(world, 'aid', npc.id, world.player.vehicleId);
  if (!s || aidData(s).agreed) throw new Error(`${npc.name} has no aid offer pending`);
  endState(world, s, 'broken');
}

export function checkAid(world: World, s: NpcState): StateEnding | null {
  const npc = world.vehicles.find((v) => v.id === s.holder);
  const me = world.vehicles.find((v) => v.id === s.other);
  if (!npc || !me) return null;
  if (callsOff(world, npc, me)) return 'broken';
  return handoverDone(s) ? 'fulfilled' : null;
}

function callsOff(world: World, npc: Vehicle, me: Vehicle): boolean {
  return inFeud(world, npc, me) || inCombat(world, npc) || inCombat(world, me);
}

function handoverDone(s: NpcState): boolean {
  const data = aidData(s);
  return data.agreed && data.started && data.workLeft <= 0;
}

export function refreshAid(world: World, s: NpcState): boolean {
  return aidData(s).agreed && isMeeting(world, s);
}

export function readyAid(world: World): NpcState | null {
  const s = playerAid(world);
  if (!s || !awaitsStart(s) || !isMeeting(world, s)) return null;
  return inCombat(world, vehicleById(world, s.holder)) || inCombat(world, playerVehicle(world)) ? null : s;
}

function awaitsStart(s: NpcState): boolean {
  const data = aidData(s);
  return data.agreed && !data.started;
}

export function startAid(world: World, npcId: string): World {
  return playerCommand(world, (w) => {
    const s = readyAid(w);
    if (!s || s.holder !== npcId) throw new Error('No aid handover is ready with that driver');
    aidData(s).started = true;
    dropLeftoverOrder(w, playerVehicle(w));
    const data = aidData(s);
    const [giver, receiver] = data.giver === 'player' ? [s.other, s.holder] : [s.holder, s.other];
    w.events.push({ t: 'aidStarted', giver, receiver });
  });
}

function handingOver(world: World, s: NpcState): boolean {
  return aidData(s).started && world.vehicles.some((v) => v.id === s.holder) && world.vehicles.some((v) => v.id === s.other) && isMeeting(world, s);
}

export function aidWork(world: World, s: NpcState): WorkLeft | null {
  if (!handingOver(world, s)) return null;
  const data = aidData(s);
  return { turnsLeft: data.workLeft, total: data.work };
}

export function advanceAid(world: World): void {
  for (const s of world.states) {
    if (s.kind === 'aid' && handingOver(world, s)) aidData(s).workLeft--;
  }
}

export function settleAid(world: World, s: NpcState): void {
  const data = aidData(s);
  const npc = vehicleById(world, s.holder);
  const me = vehicleById(world, s.other);
  const [giver, receiver] = data.giver === 'player' ? [me, npc] : [npc, me];
  const moved = amountsBy((kind) => moveSupply(world, giver, receiver, kind, data[kind]));
  const paid = Math.min(data.price, aidPrice(world, npc, moved));
  if (paid > 0) transfer(world, npc, me, paid);
  world.events.push({ t: 'aid', giver: giver.id, receiver: receiver.id, ...moved, paid });
  if (data.free && data.giver === 'player' && hasAid(moved)) practice(world, 'aid', aidValue(moved), null, npc.id);
}

function givable(world: World, giver: Vehicle, kind: Supply): number {
  return giver.brain ? truckSupplyForSale(giver, kind) : Math.floor(getResources(world, giver)[kind]);
}

function moveSupply(world: World, giver: Vehicle, receiver: Vehicle, kind: Supply, units: number): number {
  const to = getResources(world, receiver);
  const n = Math.max(0, Math.min(units, givable(world, giver, kind), Math.floor(capOf(receiver, kind) - to[kind])));
  getResources(world, giver)[kind] -= n;
  to[kind] += n;
  return n;
}

function mayHelp(world: World, npc: Vehicle): boolean {
  return !inDanger(npc) && !inCombat(world, npc) && talkOf(npc).topics.includes('aidOffer');
}

function looksNeedy(world: World, me: Vehicle): boolean {
  return isLow(world, me) && looksPoor(me) && !inCombat(world, me);
}

function mayOfferAid(world: World, npc: Vehicle): boolean {
  const me = playerVehicle(world);
  if (playerAid(world) !== null || !mayHelp(world, npc)) return false;
  return canVehicleSee(world, npc, me.pos) && !isHostile(world, npc, me) && looksNeedy(world, me);
}

export function onNeedySeen(world: World, npc: Vehicle): void {
  if (mayOfferAid(world, npc) && react(world, npc, 'needySeen', world.player.vehicleId) === 'aid') offerAid(world, npc);
}
