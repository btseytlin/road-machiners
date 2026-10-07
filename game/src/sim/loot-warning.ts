// Arguments over loot. One truck at a time loots a wreck, a pile, a loot spot or a knocked-out truck, see looterOf()
// in src/sim/salvage.ts. A driver that reaches a target another truck at peace is looting argues over it once while
// the looter stays in sight: it warns the looter off, leaves, or rarely fights. Any truck warns any other through
// warnTruck(), and an NPC answers through the warnedOff decision. The player answers an NPC's warning over the radio,
// see the lootWarning topic in src/data/dialogue.ts. A warning is a lootWarning state from the warner to the warned
// truck. One that ends in leaving lasts as the record that keeps the warned truck off the target. Pile claims warn
// trespassers through the same path, see src/sim/parley.ts.

import { NPC_BEHAVIOR, type DecisionOptions } from '../data/npcs';
import { isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { isKnockedOut } from './defeat';
import { cancelJob } from './jobs';
import { defyThreat, finishGoal, topGoal } from './npc-activities';
import { decide, firepower, lootTaken, perceiveDanger } from './npc-decisions';
import { claimantOf, inLootReach, jobTarget, lootBlocker, lootClaimedBy, salvageInRange, salvagePlace } from './salvage';
import { addState, boundTo, endState, lootWarningData, stateOf } from './states';
import { inTowReach } from './tow';
import type { GameEvent, NpcActivity, NpcState, StateEnding, Vehicle, World } from './types';
import { canVehicleSee } from './vision';

export type WarnAnswer = DecisionOptions['warnedOff'];
type Refusal = DecisionOptions['warnRefused'];
// What a warner does when the looter refuses: roll warnRefused, or do what the player or a pile claim already chose.
export type OnRefuse = 'roll' | Refusal;
type ArgumentEnd = Extract<GameEvent, { t: 'lootArgument' }>['end'];

// The two trucks can argue over loot: both at peace with each other and bound by no deal. Partners never turn on
// each other, and a hostile looter is the job of the hostile decisions.
export function canArgue(world: World, a: Vehicle, b: Vehicle): boolean {
  return !isHostile(world, a, b) && !isHostile(world, b, a) && !boundTo(world, a.id, b.id);
}

function contestKey(id: string): string {
  return `lootContested:${id}`;
}

// The driver argued over loot with the other truck, and still has it in sight. The player keeps no such note.
export function arguedWith(npc: Vehicle, other: Vehicle): boolean {
  return npc.brain !== null && contestKey(other.id) in npc.brain.noticed;
}

// Both trucks note the argument, so neither starts another while the other stays in sight.
function noteArgument(world: World, a: Vehicle, b: Vehicle): void {
  if (a.brain) a.brain.noticed[contestKey(b.id)] = world.turn;
  if (b.brain) b.brain.noticed[contestKey(a.id)] = world.turn;
}

// Whether the driver passes up a target the looter is looting. It does when it cannot argue with the looter, or the
// looter holds the pile's claim, or it already argued with the looter and waits on no answer from the player. Until
// then the target stays the driver's to drive to, so it arrives and argues. The argument check comes first, since
// the deal check scans every state.
export function passesUpLoot(world: World, npc: Vehicle, looter: Vehicle, targetId: string): boolean {
  if (!npc.brain) return true;
  if (arguedWith(npc, looter)) return looter.id !== world.player.vehicleId || pendingWarningTo(world, npc) === null;
  return !canArgue(world, npc, looter) || claimsPile(world, looter, targetId);
}

// The truck holds the claim on the handed-over pile. See the pile claims in src/sim/parley.ts.
function claimsPile(world: World, v: Vehicle, targetId: string): boolean {
  const stock = world.salvage.find((s) => s.id === targetId);
  return stock !== undefined && claimantOf(world, stock)?.id === v.id;
}

// Why the warner fights the warned truck: for its claimed pile, or over any other loot.
function fightReason(world: World, warner: Vehicle, targetId: string): string {
  return claimsPile(world, warner, targetId) ? 'defend its claimed loot' : 'fight over loot';
}

// A driver parked on its way to a loot target another truck holds. It gives the target up once it passes it up, and
// argues once on arrival in reach. True when it starts nothing there this turn.
export function heldByLooter(world: World, npc: Vehicle, activity: NpcActivity): boolean {
  const taken = lootTaken(world, npc, activity.targetId);
  if (taken) finishGoal(world, npc, taken);
  return taken !== null || (activity.targetId !== null && meetsLooter(world, npc, activity.targetId));
}

// A driver at its loot target finds another truck looting it and argues once. True while the looter holds the
// target, so the driver starts nothing there: it waits for the player's answer, or it has just argued.
export function meetsLooter(world: World, npc: Vehicle, targetId: string): boolean {
  const looter = lootBlocker(world, npc, targetId);
  if (!looter || !inLootReach(world, npc, targetId)) return false;
  if (!arguedWith(npc, looter)) contestLoot(world, npc, looter, targetId);
  return true;
}

// The driver weighs the looter's danger and warns it off, leaves, or fights it for the target.
export function contestLoot(world: World, npc: Vehicle, looter: Vehicle, targetId: string): void {
  if (lootBlocker(world, npc, targetId)?.id !== looter.id) throw new Error(`${looter.id} does not keep ${npc.id} off ${targetId}`);
  if (!canArgue(world, npc, looter)) throw new Error(`${npc.id} cannot argue with ${looter.id}`);
  noteArgument(world, npc, looter);
  const choice = decide(world, npc, 'lootContested', looter.id, perceiveDanger(world, npc, looter));
  if (choice === 'warn') warnTruck(world, npc, looter, targetId, 'roll');
  else if (choice === 'fight') fightOver(world, npc, looter, 'fight over loot');
  else leaveLoot(world, npc, targetId, 'someone else is looting it');
}

// The warner warns the truck off the target. An NPC answers at once, with `answer` when its answer was rolled
// before. The player answers over the radio, and the state waits with no answer until then.
export function warnTruck(world: World, warner: Vehicle, warned: Vehicle, targetId: string, onRefuse: OnRefuse, answer: WarnAnswer | null = null): NpcState {
  if (!canArgue(world, warner, warned)) throw new Error(`${warner.id} cannot warn ${warned.id} off loot`);
  noteArgument(world, warner, warned);
  const s = addState(world, 'lootWarning', warner.id, warned.id, { kind: 'lootWarning', targetId, answer: null });
  if (warned.brain) settleLootWarning(world, s, answer ?? answerWarning(world, warned, warner), onRefuse);
  else if (answer !== null) throw new Error('The player answers a loot warning over the radio');
  return s;
}

// A looter's answer to a warning, rolled once.
export function answerWarning(world: World, warned: Vehicle, warner: Vehicle): WarnAnswer {
  return decide(world, warned, 'warnedOff', warner.id, perceiveDanger(world, warned, warner));
}

// The warned truck answered. One that complies leaves the target, and the state stays as its word. One that fights
// back fights the warner. On a refusal an NPC warner leaves or fights, as `onRefuse` says, and the player warner
// decides by what it does next. Only a warning that ends in leaving lasts.
export function settleLootWarning(world: World, s: NpcState, answer: WarnAnswer, onRefuse: OnRefuse): void {
  const data = lootWarningData(s);
  if (data.answer !== null) throw new Error(`Loot warning ${s.id} is already answered`);
  data.answer = answer;
  if (answer !== 'comply') endState(world, s, 'fulfilled');
  const warner = vehicleById(world, s.holder);
  const warned = vehicleById(world, s.other);
  const end = ANSWERS[answer](world, warner, warned, data.targetId, onRefuse);
  if (end) logArgument(world, warner, warned, data.targetId, end);
}

// What each answer does, and how the argument ended. Null when the player warner decides by acting.
type AnswerRule = (world: World, warner: Vehicle, warned: Vehicle, targetId: string, onRefuse: OnRefuse) => ArgumentEnd | null;

const ANSWERS: Record<WarnAnswer, AnswerRule> = {
  comply: (world, _warner, warned, targetId) => {
    leaveLoot(world, warned, targetId, 'warned off the loot');
    return 'yielded';
  },
  fightBack: (world, warner, warned, targetId) => {
    if (warned.brain) defyThreat(world, warned, warner, 'fightBack', 'keep its loot');
    if (warner.brain) fightOver(world, warner, warned, fightReason(world, warner, targetId));
    return 'fight';
  },
  refuse: (world, warner, warned, targetId, onRefuse) => {
    if (!warner.brain) return null;
    const refusal = onRefuse === 'roll' ? warnRefusalOf(world, warner, warned) : onRefuse;
    if (refusal === 'leave') {
      leaveLoot(world, warner, targetId, 'the looter would not leave');
      return 'backedOff';
    }
    fightOver(world, warner, warned, fightReason(world, warner, targetId));
    return 'fight';
  },
};

// A warner's choice once the looter refused, rolled once.
export function warnRefusalOf(world: World, warner: Vehicle, warned: Vehicle): Refusal {
  return decide(world, warner, 'warnRefused', warned.id, perceiveDanger(world, warner, warned));
}

// The driver fights the other truck for loot, or runs when it has no working gun.
export function fightOver(world: World, npc: Vehicle, other: Vehicle, reason: string): void {
  defyThreat(world, npc, other, firepower(world, npc) > 0 ? 'fightBack' : 'flee', reason);
}

// The truck gives the target up: its job there ends, and an NPC's loot goal on it pops. The NPC notices it as salvage
// seen, so no roll on the way picks it again while it stays in sight.
export function leaveLoot(world: World, v: Vehicle, targetId: string, reason: string): void {
  if (jobTarget(v) === targetId) cancelJob(world, v);
  if (!v.brain) return;
  v.brain.noticed[`salvageSeen:${targetId}`] = world.turn;
  if (isLootGoalOn(topGoal(v), targetId)) finishGoal(world, v, reason);
}

function isLootGoalOn(goal: NpcActivity | null, targetId: string): boolean {
  return (goal?.kind === 'loot' || goal?.kind === 'scavenge') && goal.targetId === targetId;
}

// A driver warned off its loot gives up the target it holds the one-looter claim on.
export function backOffLoot(world: World, vehicle: Vehicle): void {
  const target = lootClaimedBy(world, vehicle);
  if (target === null) throw new Error(`${vehicle.id} holds no loot claim to back off from`);
  leaveLoot(world, vehicle, target, 'warned off the loot');
}

// Arguments between two NPCs show in the log when the player notices either truck. The player's own show on the radio.
function logArgument(world: World, warner: Vehicle, looter: Vehicle, targetId: string, end: ArgumentEnd): void {
  if (warner.brain && looter.brain) world.events.push({ t: 'lootArgument', warner: warner.id, looter: looter.id, place: placeOf(world, targetId), end });
}

function placeOf(world: World, targetId: string): 'wreck' | 'pile' | 'spot' | 'truck' {
  const stock = world.salvage.find((s) => s.id === targetId);
  if (!stock) return 'truck';
  const place = salvagePlace(stock);
  if (place === 'site') throw new Error(`Site stock ${targetId} is no loot target`);
  return place;
}

// ---- The player in a warning.

// The NPC's warning to the player that waits for an answer, or null.
export function pendingWarningTo(world: World, npc: Vehicle): NpcState | null {
  const s = stateOf(world, 'lootWarning', npc.id, world.player.vehicleId);
  return s && lootWarningData(s).answer === null ? s : null;
}

// The player answers the NPC's waiting warning. `refusal` is the NPC's choice on a refusal, rolled when the call
// opened.
export function answerLootWarning(world: World, npc: Vehicle, answer: WarnAnswer, refusal: Refusal): void {
  const s = pendingWarningTo(world, npc);
  if (!s) throw new Error(`${npc.id} has no loot warning waiting for the player`);
  settleLootWarning(world, s, answer, refusal);
}

// The warning that keeps the truck off the target: it agreed to leave it. Null when none holds.
export function warnedOffTarget(world: World, v: Vehicle, targetId: string): NpcState | null {
  return world.states.find((s) => s.kind === 'lootWarning' && s.other === v.id && lootWarningData(s).targetId === targetId && lootWarningData(s).answer === 'comply') ?? null;
}

// The player starts work on a target it agreed to leave, so it breaks its word. NPCs keep theirs.
export function breakLootWarning(world: World, me: Vehicle, targetId: string): void {
  const s = warnedOffTarget(world, me, targetId);
  if (s) endState(world, s, 'broken');
}

// The driver loots a target the player truck is in reach of too, so the player can warn it off. A call from afar has
// nothing to claim, and the player warns no deal partner.
export function lootsBesidePlayer(world: World, npc: Vehicle): boolean {
  const target = lootClaimedBy(world, npc);
  const me = playerVehicle(world);
  if (target === null || target === me.id || !canArgue(world, me, npc)) return false;
  const stock = world.salvage.find((s) => s.id === target);
  return stock ? salvageInRange(me, stock) : inTowReach(me, vehicleById(world, target));
}

// The player warns the NPC off the target it loots. The NPC's answer was rolled when the call opened, and the player
// decides what to do about a refusal.
export function playerWarns(world: World, npc: Vehicle, answer: WarnAnswer): void {
  const target = lootClaimedBy(world, npc);
  if (target === null) throw new Error(`${npc.id} loots nothing to warn it off`);
  warnTruck(world, playerVehicle(world), npc, target, 'roll', answer);
}

// ---- The state's rules. See STATE_KINDS.lootWarning in src/sim/states.ts.

function lootTargetExists(world: World, targetId: string): boolean {
  return world.salvage.some((s) => s.id === targetId) || world.vehicles.some((v) => v.id === targetId && isKnockedOut(v));
}

// Fulfilled once the target is gone. A warning the player leaves unanswered lapses after
// NPC_BEHAVIOR.warnAnswerTurns.
export function checkLootWarning(world: World, s: NpcState): StateEnding | null {
  const data = lootWarningData(s);
  if (!lootTargetExists(world, data.targetId)) return 'fulfilled';
  return data.answer === null && world.turn - s.born >= NPC_BEHAVIOR.warnAnswerTurns ? 'expired' : null;
}

// A warner whose warning got no answer leaves, as after a refusal it chose to leave.
export function lapseLootWarning(world: World, s: NpcState): void {
  const warner = world.vehicles.find((v) => v.id === s.holder);
  const data = lootWarningData(s);
  if (warner && data.answer === null) leaveLoot(world, warner, data.targetId, 'no answer to its warning');
}

// The warned truck broke its word. A warner that sees it fights for the target.
export function defendWarned(world: World, s: NpcState): void {
  const warner = world.vehicles.find((v) => v.id === s.holder);
  const warned = world.vehicles.find((v) => v.id === s.other);
  if (!warner?.brain || !warned || isKnockedOut(warner) || !canVehicleSee(world, warner, warned.pos)) return;
  fightOver(world, warner, warned, 'defend the loot it was promised');
}
