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
import { npcName } from './spawn';

export type WorkLeft = { turnsLeft: number; total: number };
export type Work = WorkLeft & ({ from: 'job'; job: Job } | { from: 'state'; state: NpcState });

export type StateKind = {
  // True when this turn's events reset the timer to its full length.
  refresh(w: World, s: NpcState): boolean;
  // The ending the kind's own rule calls for this turn, or null. It runs before the missing-party rule, so it
  // must not assume both parties still exist.
  check(w: World, s: NpcState): StateEnding | null;
  hooks: Partial<Record<StateEnding, (w: World, s: NpcState) => void>>;
  // The turns of shared work left while the parties work on it this turn, or null. See workOf().
  work(w: World, s: NpcState): WorkLeft | null;
  // True when the holder gave the other party its word while the state lasts. See boundTo() and givesWord().
  binds: boolean;
};

const never = (): boolean => false;
const noCheck = (): StateEnding | null => null;
const noWork = (): WorkLeft | null => null;

export const STATE_KINDS: Record<StateKindId, StateKind> = {
  // Both parties are hostile while it lasts. Shots between them or either one seeing the other keep it going.
  // It is fulfilled when the other party is destroyed or knocked out. A holder that is gone breaks it.
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
      // A feud that went quiet failed. Hostility ends, and the holder backs off from the other party.
      expired: (w, s) => { addState(w, 'backedOff', s.holder, s.other, { kind: 'none' }); },
      // A won robbery sends the robber to loot what the other party left behind.
      fulfilled: (w, s) => { if (isRobberyFeud(s)) lootRobbed(w, s.holder, s.other); },
    },
    work: noWork,
    binds: false,
  },
  // The holder does not rob the other party while it lasts.
  backedOff: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  // The holder tows the other party to a town or camp. See src/sim/tow.ts. An NPC tower's goal fulfils and breaks it. A
  // player tower's arrival is its check.
  tow: {
    refresh: never,
    check: (w, s) => (s.holder === w.player.vehicleId ? checkPlayerTow(w, s) : null),
    hooks: { fulfilled: payTow, broken: releaseTow },
    work: noWork,
    binds: true,
  },
  turnedDown: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  // A tower that dropped a hitched tow for danger keeps the deal. See checkTowPromise() in src/sim/tow.ts.
  towPromise: { refresh: never, check: checkTowPromise, hooks: {}, work: noWork, binds: false },
  // The holder has taken the job of towing the other party, so no other driver answers. It is fulfilled by the offer
  // in src/sim/tow.ts, and broken once the holder's tow goal is gone from its stack. It lapses after its turns with the
  // other party in sight and out of combat, since a blocked tower never gets to offer.
  answering: {
    refresh: answerWaits,
    check: (w, s) => (answerDropped(w, s) ? 'broken' : null),
    hooks: { expired: lapseClaim },
    work: noWork,
    binds: true,
  },
  // The holder patches the other party's truck. See src/sim/patch.ts. Work keeps it going, and the fulfilled hook
  // pays once.
  // The two parties are not foes while it lasts, unless a feud says otherwise. See isFoe() in src/sim/combat.ts.
  truce: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  // The holder took damage in a crash with the other party while the two were at peace. The holder decides once
  // whether to forgive it, and src/sim/npc-activities.ts ends it then.
  grievance: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  // The holder asked the other party for a truce or mercy. See src/sim/parley.ts. It holds after the answer, so the
  // holder rarely asks the same party again soon.
  plea: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  patch: {
    refresh: isPatching,
    check: checkPatch,
    hooks: { fulfilled: settlePatch, expired: lapsePatch, broken: breakPatch },
    work: patchWork,
    binds: true,
  },
  // The holder pulls over to trade with the player. See src/sim/economy.ts. Being parked in reach keeps it
  // going. The player ends it when done trading, and a feud between the two breaks it.
  trade: { refresh: isMeeting, check: checkTrade, hooks: {}, work: noWork, binds: true },
  // The holder wants revenge on the other party, who knocked it out or attacked it during a deal. src/sim/defeat.ts
  // fulfils it when the holder knocks the player out, and src/sim/parley.ts when the player hands it cargo.
  revenge: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  // The holder escorts the other party. See src/sim/tow.ts. The leader's arrival fulfils it, and the fulfilled
  // hook pays once.
  escort: { refresh: never, check: checkEscort, hooks: { fulfilled: payEscort }, work: noWork, binds: true },
  // The holder took unintended damage from the other party's fire. src/sim/combat.ts sums it and turns it into an
  // attack past a threshold.
  strayFire: { refresh: never, check: noCheck, hooks: {}, work: noWork, binds: false },
  // The holder and the player deal in fuel and supply aid. See src/sim/aid.ts. An agreed deal waits for the player's
  // [E], then both trucks stay parked for its handover work, and the fulfilled hook moves everything once. Combat or
  // a feud breaks it. Parked in reach keeps an agreed deal alive, and a pending offer still lapses unanswered.
  aid: { refresh: refreshAid, check: checkAid, hooks: { fulfilled: settleAid }, work: aidWork, binds: true },
  // The holder is the aggressor and the other party its target. It starts with a hostile act, like a shot or a ram, or
  // with the holder hunting the other on a fight goal in sight. src/sim/combat.ts refreshes it. Both trucks count as in
  // combat while it lasts. It breaks once the two are no longer hostile to each other.
  combat: { refresh: never, check: checkCombat, hooks: {}, work: noWork, binds: false },
};

// A missing party is left to the missing-party rule.
function checkCombat(w: World, s: NpcState): StateEnding | null {
  const holder = w.vehicles.find((v) => v.id === s.holder);
  const other = w.vehicles.find((v) => v.id === s.other);
  if (!holder || !other) return null;
  return isHostile(w, holder, other) || isHostile(w, other, holder) ? null : 'broken';
}

// An answering tower's clock holds while it cannot see its client, as on a beacon answer from far off, or while the
// client is in combat, when the tower waits out the fight. Both parties exist here.
function answerWaits(w: World, s: NpcState): boolean {
  const holder = vehicleById(w, s.holder);
  const other = vehicleById(w, s.other);
  return !canVehicleSee(w, holder, other.pos) || inCombat(w, other);
}

// A missing holder is left to the missing-party rule.
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

// The data kind each state kind carries.
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

// Whether a and b have a deal that binds either of them. Neither turns on the other while it lasts.
export function boundTo(w: World, a: string, b: string): boolean {
  return w.states.some((s) => kindOf(s.kind).binds && ((s.holder === a && s.other === b) || (s.holder === b && s.other === a)));
}

// Whether the holder gave some truck its word. It starts nothing of its own until the deal ends.
export function givesWord(w: World, holder: string): boolean {
  return w.states.some((s) => s.holder === holder && kindOf(s.kind).binds);
}

// Removes the state, logs the ending, then runs the ending's hook. A hook may add or end other states.
export function endState(w: World, s: NpcState, ending: StateEnding): void {
  const i = w.states.findIndex((x) => x.id === s.id);
  if (i < 0) throw new Error(`State ${s.id} has already ended`);
  const [ended] = w.states.splice(i, 1);
  w.events.push({ t: 'stateEnded', state: ended, ending });
  if (kindOf(ended.kind).binds && ending !== 'broken') backOffAfterDeal(w, ended);
  kindOf(ended.kind).hooks[ending]?.(w, ended);
}

// A deal that was not broken leaves each NPC party backed off from the other, so neither turns on the other just
// after it.
function backOffAfterDeal(w: World, s: NpcState): void {
  for (const [id, other] of [[s.holder, s.other], [s.other, s.holder]]) {
    if (w.vehicles.find((v) => v.id === id)?.brain) addState(w, 'backedOff', id, other, { kind: 'none' });
  }
}

// The turn step. A state added this turn waits for the next one, so a hook chain moves one step per turn.
export function advanceStates(w: World): void {
  for (const s of [...w.states]) if (s.born !== w.turn && w.states.includes(s)) advanceState(w, s);
}

// Ends the state by its kind's check or a missing party, or else runs its timer.
function advanceState(w: World, s: NpcState): void {
  if (!settleState(w, s)) runTimer(w, s, kindOf(s.kind));
}

// Ends every state whose kind's check or a missing party calls for it, with no timers run. Commands outside the
// turn that remove a vehicle call it, so the next turn never meets a state with a missing party.
export function settleStates(w: World): void {
  for (const s of [...w.states]) if (w.states.includes(s)) settleState(w, s);
}

// True when the state ended.
function settleState(w: World, s: NpcState): boolean {
  const ending = kindOf(s.kind).check(w, s) ?? (partyMissing(w, s) ? 'broken' : null);
  if (ending) endState(w, s, ending);
  return ending !== null;
}

// A state without a timer waits. This turn's events refresh a timer to its full length. Otherwise it counts down
// and the state expires at zero.
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

// Whether the state is a robbery feud. The one test of the robbery marker.
export function isRobberyFeud(s: NpcState): boolean {
  return s.kind === 'feud' && feudData(s).robbery;
}

// Whether the robber holds a robbery feud on the target. Drivers fighting back hold feuds that are not robberies.
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

// The one place a tow fee is paid. The player's money may go negative. The towed truck stops where it was dropped.
function payTow(w: World, s: NpcState): void {
  const tow = towData(s);
  const towed = vehicleById(w, s.other);
  const tower = vehicleById(w, s.holder);
  getResources(w, towed).money -= tow.fee;
  getResources(w, tower).money += tow.fee;
  // An NPC client stands on its destination pad, so it needs no tow there. A player client may still be stranded in town, and no offer
  // should follow there.
  if (towed.brain) forgetClient(tower, s.other);
  towed.speed = 0;
  towed.order = null;
  if (s.holder === w.player.vehicleId) w.events.push({ t: 'money', amount: tow.fee, reason: `towing ${npcName(towed)}` });
  if (s.holder === w.player.vehicleId && tow.waived > 0) practice(w, 'freeTow', tow.waived, null, s.other);
  else w.events.push({ t: 'towDone', by: s.holder, client: s.other, fee: tow.fee });
}

// A released truck brakes to a stop. The caller logs why the tow broke, except for a tower that left the world,
// which only this step sees.
function releaseTow(w: World, s: NpcState): void {
  const towed = w.vehicles.find((v) => v.id === s.other);
  if (towed && towData(s).hitched) towed.order = { kind: 'brake' };
  if (s.holder === w.player.vehicleId) return;
  const holder = w.vehicles.find((v) => v.id === s.holder);
  if (!holder) w.events.push({ t: 'towDropped', by: s.holder, client: s.other, reason: 'gone' });
  else forgetClient(holder, s.other);
}

// An NPC tower forgets it decided on this client after a tow ends, so the client stranded in sight again is a fresh
// strandedSeen decision. An escort keeps its leader in sight, so this lets it tow the leader again.
function forgetClient(tower: Vehicle, clientId: string): void {
  if (tower.brain) delete tower.brain.noticed[`strandedSeen:${clientId}`];
}

// Timed work a truck does: its parked job, or a state whose kind declares work, like a patch. A job comes first. A
// state counts for both its parties while its work is under way. The HUD and the markers over NPCs read only this,
// so any new kind of timed work shows its progress.
export function workOf(w: World, v: Vehicle): Work | null {
  if (v.job) return { from: 'job', job: v.job, turnsLeft: v.job.turnsLeft, total: v.job.total };
  for (const state of w.states) {
    if (state.holder !== v.id && state.other !== v.id) continue;
    const left = kindOf(state.kind).work(w, state);
    if (left) return { from: 'state', state, ...left };
  }
  return null;
}
