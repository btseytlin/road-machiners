// Timed relations between two vehicles, like a feud or a tow. Each kind lives in STATE_KINDS. A state ends once,
// as expired, fulfilled or broken, and its kind's hook for that ending runs once. A holder holds at most one state
// of each kind toward each other party.

import { STATE_TURNS } from '../data/npcs';
import { aidWork, checkAid, refreshAid, settleAid } from './aid';
import { vehicleById } from './damage';
import { newId } from './factory';
import { lootRobbed } from './defeat';
import { checkPatch, isPatching, breakPatch, lapsePatch, patchWork, settlePatch } from './patch';
import { practice } from './progress';
import { checkEscort, checkPlayerTow, checkTowPromise, lapseClaim, payEscort } from './tow';
import { checkTrade, isMeeting } from './economy';
import { inCombat, isHostile } from './combat';
import { getResources } from './resources';
import type { Job, NpcState, StateData, StateEnding, StateKindId, Vehicle, World } from './types';
import { canVehicleSee } from './vision';

export type WorkLeft = { turnsLeft: number; total: number };
export type Work = WorkLeft & ({ from: 'job'; job: Job } | { from: 'state'; state: NpcState });

export type StateKind = {
  refresh(w: World, s: NpcState): boolean;
  check(w: World, s: NpcState): StateEnding | null;
  hooks: Partial<Record<StateEnding, (w: World, s: NpcState) => void>>;
  work(w: World, s: NpcState): WorkLeft | null;
  binds: boolean;
};

const never = (): boolean => false;
const noCheck = (): StateEnding | null => null;
const noWork = (): WorkLeft | null => null;

export const STATE_KINDS: Record<StateKindId, StateKind> = {
  feud: {
    refresh: (w, s) => {
      const shot = w.events.some((e) => e.t === 'shot'
        && ((e.shooter === s.holder && e.target === s.other) || (e.shooter === s.other && e.target === s.holder)));
      if (shot) return true;
      const holder = vehicleById(w, s.holder);
      const other = vehicleById(w, s.other);
      return canVehicleSee(w, holder, other.pos) || canVehicleSee(w, other, holder.pos);
    },
    check: (w, s) => (w.events.some((e) => (e.t === 'destroyed' || e.t === 'npcKnockout') && e.vehicle === s.other) ? 'fulfilled' : null),
    hooks: {
      expired: (w, s) => { addState(w, 'backedOff', s.holder, s.other, { kind: 'none' }); },
      fulfilled: (w, s) => { if (isRobberyFeud(s)) lootRobbed(w, s.holder, s.other); },
    },
    work: noWork,
    binds: false,
  },
  backedOff: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  tow: {
    refresh: never,
    check: (w, s) => (s.holder === w.player.vehicleId ? checkPlayerTow(w, s) : null),
    hooks: { fulfilled: payTow, broken: releaseTow },
    work: noWork,
    binds: true,
  },
  turnedDown: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  towPromise: { refresh: never, check: checkTowPromise, hooks: {}, work: noWork, binds: false },
  answering: {
    refresh: answerWaits,
    check: (w, s) => (answerDropped(w, s) ? 'broken' : null),
    hooks: { expired: lapseClaim },
    work: noWork,
    binds: true,
  },
  truce: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  grievance: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  plea: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  patch: {
    refresh: isPatching,
    check: checkPatch,
    hooks: { fulfilled: settlePatch, expired: lapsePatch, broken: breakPatch },
    work: patchWork,
    binds: true,
  },
  trade: { refresh: isMeeting, check: checkTrade, hooks: {}, work: noWork, binds: true },
  revenge: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  escort: { refresh: never, check: checkEscort, hooks: { fulfilled: payEscort }, work: noWork, binds: true },
  strayFire: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  aid: { refresh: refreshAid, check: checkAid, hooks: { fulfilled: settleAid }, work: aidWork, binds: true },
  combat: { refresh: never, check: checkCombat, hooks: {}, work: noWork, binds: false },
};

function checkCombat(w: World, s: NpcState): StateEnding | null {
  const holder = w.vehicles.find((v) => v.id === s.holder);
  const other = w.vehicles.find((v) => v.id === s.other);
  if (!holder || !other) return null;
  return isHostile(w, holder, other) || isHostile(w, other, holder) ? null : 'broken';
}

function answerWaits(w: World, s: NpcState): boolean {
  const holder = vehicleById(w, s.holder);
  const other = vehicleById(w, s.other);
  return !canVehicleSee(w, holder, other.pos) || inCombat(w, other);
}

function answerDropped(w: World, s: NpcState): boolean {
  const holder = w.vehicles.find((v) => v.id === s.holder);
  return holder !== undefined && !holder.brain!.goals.some((g) => g.kind === 'tow');
}

function kindOf(kind: StateKindId): StateKind {
  if (!Object.hasOwn(STATE_KINDS, kind)) throw new Error(`Unknown state kind ${kind}`);
  return STATE_KINDS[kind];
}

function turnsOf(kind: StateKindId): number | null {
  if (!Object.hasOwn(STATE_TURNS, kind)) throw new Error(`Unknown state kind ${kind}`);
  return STATE_TURNS[kind];
}

const DATA_KIND: Record<StateKindId, StateData['kind']> = { feud: 'feud', backedOff: 'none', tow: 'tow', turnedDown: 'none', towPromise: 'towPromise', answering: 'none', patch: 'patch', truce: 'none', grievance: 'none', plea: 'plea', trade: 'none', revenge: 'none', escort: 'escort', strayFire: 'strayFire', aid: 'aid', combat: 'none' };

export function addState(w: World, kind: StateKindId, holder: string, other: string, data: StateData): NpcState {
  kindOf(kind);
  if (data.kind !== DATA_KIND[kind]) throw new Error(`A ${kind} state needs ${DATA_KIND[kind]} data, got ${data.kind}`);
  const s: NpcState = { id: newId(w, 'state'), kind, holder, other, turnsLeft: turnsOf(kind), born: w.turn, data };
  w.states = w.states.filter((x) => !(x.kind === kind && x.holder === holder && x.other === other));
  w.states.push(s);
  return s;
}

export function stateOf(w: World, kind: StateKindId, holder: string, other: string): NpcState | null {
  return w.states.find((s) => s.kind === kind && s.holder === holder && s.other === other) ?? null;
}

export function statesHeld(w: World, holder: string): NpcState[] {
  return w.states.filter((s) => s.holder === holder);
}

export function boundTo(w: World, a: string, b: string): boolean {
  return w.states.some((s) => kindOf(s.kind).binds && ((s.holder === a && s.other === b) || (s.holder === b && s.other === a)));
}

export function givesWord(w: World, holder: string): boolean {
  return w.states.some((s) => s.holder === holder && kindOf(s.kind).binds);
}

export function endState(w: World, s: NpcState, ending: StateEnding): void {
  const i = w.states.findIndex((x) => x.id === s.id);
  if (i < 0) throw new Error(`State ${s.id} has already ended`);
  const [ended] = w.states.splice(i, 1);
  w.events.push({ t: 'stateEnded', state: ended, ending });
  if (kindOf(ended.kind).binds && ending !== 'broken') backOffAfterDeal(w, ended);
  kindOf(ended.kind).hooks[ending]?.(w, ended);
}

function backOffAfterDeal(w: World, s: NpcState): void {
  for (const [id, other] of [[s.holder, s.other], [s.other, s.holder]]) {
    if (w.vehicles.find((v) => v.id === id)?.brain) addState(w, 'backedOff', id, other, { kind: 'none' });
  }
}

export function advanceStates(w: World): void {
  for (const s of [...w.states]) if (s.born !== w.turn && w.states.includes(s)) advanceState(w, s);
}

function advanceState(w: World, s: NpcState): void {
  if (!settleState(w, s)) runTimer(w, s, kindOf(s.kind));
}

export function settleStates(w: World): void {
  for (const s of [...w.states]) if (w.states.includes(s)) settleState(w, s);
}

function settleState(w: World, s: NpcState): boolean {
  const ending = kindOf(s.kind).check(w, s) ?? (partyMissing(w, s) ? 'broken' : null);
  if (ending) endState(w, s, ending);
  return ending !== null;
}

function runTimer(w: World, s: NpcState, kind: StateKind): void {
  if (s.turnsLeft === null) return;
  if (kind.refresh(w, s)) {
    s.turnsLeft = turnsOf(s.kind);
    return;
  }
  s.turnsLeft--;
  if (s.turnsLeft === 0) endState(w, s, 'expired');
}

function partyMissing(w: World, s: NpcState): boolean {
  return !w.vehicles.some((v) => v.id === s.holder) || !w.vehicles.some((v) => v.id === s.other);
}

export function feudData(s: NpcState): Extract<StateData, { kind: 'feud' }> {
  if (s.data.kind !== 'feud') throw new Error(`State ${s.id} holds no feud`);
  return s.data;
}

export function isRobberyFeud(s: NpcState): boolean {
  return s.kind === 'feud' && feudData(s).robbery;
}

export function robbing(w: World, robberId: string, targetId: string): boolean {
  const feud = stateOf(w, 'feud', robberId, targetId);
  return feud !== null && isRobberyFeud(feud);
}

export function pleaData(s: NpcState): Extract<StateData, { kind: 'plea' }> {
  if (s.data.kind !== 'plea') throw new Error(`State ${s.id} holds no plea`);
  return s.data;
}

export function towPromiseData(s: NpcState): Extract<StateData, { kind: 'towPromise' }> {
  if (s.data.kind !== 'towPromise') throw new Error(`State ${s.id} holds no tow promise`);
  return s.data;
}

export function towData(s: NpcState): Extract<StateData, { kind: 'tow' }> {
  if (s.data.kind !== 'tow') throw new Error(`State ${s.id} holds no tow`);
  return s.data;
}

export function aidData(s: NpcState): Extract<StateData, { kind: 'aid' }> {
  if (s.data.kind !== 'aid') throw new Error(`State ${s.id} holds no aid`);
  return s.data;
}

export function strayData(s: NpcState): Extract<StateData, { kind: 'strayFire' }> {
  if (s.data.kind !== 'strayFire') throw new Error(`State ${s.id} holds no stray fire`);
  return s.data;
}

function payTow(w: World, s: NpcState): void {
  const tow = towData(s);
  const towed = vehicleById(w, s.other);
  const tower = vehicleById(w, s.holder);
  getResources(w, towed).money -= tow.fee;
  getResources(w, tower).money += tow.fee;
  if (towed.brain) forgetClient(tower, s.other);
  towed.speed = 0;
  towed.order = null;
  if (s.holder === w.player.vehicleId) w.events.push({ t: 'money', amount: tow.fee, reason: { kind: 'towing', vehicle: towed.id } });
  if (s.holder === w.player.vehicleId && tow.waived > 0) practice(w, 'freeTow', tow.waived, null, s.other);
  else w.events.push({ t: 'towDone', by: s.holder, client: s.other, fee: tow.fee });
}

function releaseTow(w: World, s: NpcState): void {
  const towed = w.vehicles.find((v) => v.id === s.other);
  if (towed && towData(s).hitched) towed.order = { kind: 'brake' };
  if (s.holder === w.player.vehicleId) return;
  const holder = w.vehicles.find((v) => v.id === s.holder);
  if (!holder) w.events.push({ t: 'towDropped', by: s.holder, client: s.other, reason: 'gone' });
  else forgetClient(holder, s.other);
}

function forgetClient(tower: Vehicle, clientId: string): void {
  if (tower.brain) delete tower.brain.noticed[`strandedSeen:${clientId}`];
}

export function workOf(w: World, v: Vehicle): Work | null {
  if (v.job) return { from: 'job', job: v.job, turnsLeft: v.job.turnsLeft, total: v.job.total };
  for (const state of w.states) {
    if (state.holder !== v.id && state.other !== v.id) continue;
    const left = kindOf(state.kind).work(w, state);
    if (left) return { from: 'state', state, ...left };
  }
  return null;
}
