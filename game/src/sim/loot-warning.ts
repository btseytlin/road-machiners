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
import type { GameEvent, GoalReason, NpcActivity, NpcState, StateEnding, Vehicle, World } from './types';
import { canVehicleSee } from './vision';

export type WarnAnswer = DecisionOptions['warnedOff'];
type Refusal = DecisionOptions['warnRefused'];
export type OnRefuse = 'roll' | Refusal;
type ArgumentEnd = Extract<GameEvent, { t: 'lootArgument' }>['end'];

export function canArgue(world: World, a: Vehicle, b: Vehicle): boolean {
  return !isHostile(world, a, b) && !isHostile(world, b, a) && !boundTo(world, a.id, b.id);
}

function contestKey(id: string): string {
  return `lootContested:${id}`;
}

export function arguedWith(npc: Vehicle, other: Vehicle): boolean {
  return npc.brain !== null && contestKey(other.id) in npc.brain.noticed;
}

function noteArgument(world: World, a: Vehicle, b: Vehicle): void {
  if (a.brain) a.brain.noticed[contestKey(b.id)] = world.turn;
  if (b.brain) b.brain.noticed[contestKey(a.id)] = world.turn;
}

export function passesUpLoot(world: World, npc: Vehicle, looter: Vehicle, targetId: string): boolean {
  if (!npc.brain) return true;
  if (arguedWith(npc, looter)) return looter.id !== world.player.vehicleId || pendingWarningTo(world, npc) === null;
  return !canArgue(world, npc, looter) || claimsPile(world, looter, targetId);
}

function claimsPile(world: World, v: Vehicle, targetId: string): boolean {
  const stock = world.salvage.find((s) => s.id === targetId);
  return stock !== undefined && claimantOf(world, stock)?.id === v.id;
}

function fightReason(world: World, warner: Vehicle, targetId: string): GoalReason {
  return claimsPile(world, warner, targetId) ? 'defendLoot' : 'fightOverLoot';
}

export function heldByLooter(world: World, npc: Vehicle, activity: NpcActivity): boolean {
  const taken = lootTaken(world, npc, activity.targetId);
  if (taken) finishGoal(world, npc, taken);
  return taken !== null || (activity.targetId !== null && meetsLooter(world, npc, activity.targetId));
}

export function meetsLooter(world: World, npc: Vehicle, targetId: string): boolean {
  const looter = lootBlocker(world, npc, targetId);
  if (!looter || !inLootReach(world, npc, targetId)) return false;
  if (!arguedWith(npc, looter)) contestLoot(world, npc, looter, targetId);
  return true;
}

export function contestLoot(world: World, npc: Vehicle, looter: Vehicle, targetId: string): void {
  if (lootBlocker(world, npc, targetId)?.id !== looter.id) throw new Error(`${looter.id} does not keep ${npc.id} off ${targetId}`);
  if (!canArgue(world, npc, looter)) throw new Error(`${npc.id} cannot argue with ${looter.id}`);
  noteArgument(world, npc, looter);
  const choice = decide(world, npc, 'lootContested', looter.id, perceiveDanger(world, npc, looter));
  if (choice === 'warn') warnTruck(world, npc, looter, targetId, 'roll');
  else if (choice === 'fight') fightOver(world, npc, looter, 'fightOverLoot');
  else leaveLoot(world, npc, targetId, 'lootTaken');
}

export function warnTruck(world: World, warner: Vehicle, warned: Vehicle, targetId: string, onRefuse: OnRefuse, answer: WarnAnswer | null = null): NpcState {
  if (!canArgue(world, warner, warned)) throw new Error(`${warner.id} cannot warn ${warned.id} off loot`);
  noteArgument(world, warner, warned);
  const s = addState(world, 'lootWarning', warner.id, warned.id, { kind: 'lootWarning', targetId, answer: null });
  if (warned.brain) settleLootWarning(world, s, answer ?? answerWarning(world, warned, warner), onRefuse);
  else if (answer !== null) throw new Error('The player answers a loot warning over the radio');
  return s;
}

export function answerWarning(world: World, warned: Vehicle, warner: Vehicle): WarnAnswer {
  return decide(world, warned, 'warnedOff', warner.id, perceiveDanger(world, warned, warner));
}

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

type AnswerRule = (world: World, warner: Vehicle, warned: Vehicle, targetId: string, onRefuse: OnRefuse) => ArgumentEnd | null;

const ANSWERS: Record<WarnAnswer, AnswerRule> = {
  comply: (world, _warner, warned, targetId) => {
    leaveLoot(world, warned, targetId, 'warnedOff');
    return 'yielded';
  },
  fightBack: (world, warner, warned, targetId) => {
    if (warned.brain) defyThreat(world, warned, warner, 'fightBack', 'keepLoot');
    if (warner.brain) fightOver(world, warner, warned, fightReason(world, warner, targetId));
    return 'fight';
  },
  refuse: (world, warner, warned, targetId, onRefuse) => {
    if (!warner.brain) return null;
    const refusal = onRefuse === 'roll' ? warnRefusalOf(world, warner, warned) : onRefuse;
    if (refusal === 'leave') {
      leaveLoot(world, warner, targetId, 'looterWontLeave');
      return 'backedOff';
    }
    fightOver(world, warner, warned, fightReason(world, warner, targetId));
    return 'fight';
  },
};

export function warnRefusalOf(world: World, warner: Vehicle, warned: Vehicle): Refusal {
  return decide(world, warner, 'warnRefused', warned.id, perceiveDanger(world, warner, warned));
}

export function fightOver(world: World, npc: Vehicle, other: Vehicle, reason: GoalReason): void {
  defyThreat(world, npc, other, firepower(world, npc) > 0 ? 'fightBack' : 'flee', reason);
}

export function leaveLoot(world: World, v: Vehicle, targetId: string, reason: GoalReason): void {
  if (jobTarget(v) === targetId) cancelJob(world, v);
  if (!v.brain) return;
  v.brain.noticed[`salvageSeen:${targetId}`] = world.turn;
  if (isLootGoalOn(topGoal(v), targetId)) finishGoal(world, v, reason);
}

function isLootGoalOn(goal: NpcActivity | null, targetId: string): boolean {
  return (goal?.kind === 'loot' || goal?.kind === 'scavenge') && goal.targetId === targetId;
}

function logArgument(world: World, warner: Vehicle, looter: Vehicle, targetId: string, end: ArgumentEnd): void {
  if (warner.brain && looter.brain) world.events.push({ t: 'lootArgument', warner: warner.id, looter: looter.id, place: placeOf(world, targetId), end });
}

function placeOf(world: World, targetId: string): 'wreck' | 'pile' | 'spot' | 'truck' {
  const stock = world.salvage.find((s) => s.id === targetId);
  if (!stock) return 'truck';
  const place = salvagePlace(stock);
  return place;
}

export function pendingWarningTo(world: World, npc: Vehicle): NpcState | null {
  const s = stateOf(world, 'lootWarning', npc.id, world.player.vehicleId);
  return s && lootWarningData(s).answer === null ? s : null;
}

export function answerLootWarning(world: World, npc: Vehicle, answer: WarnAnswer, refusal: Refusal): void {
  const s = pendingWarningTo(world, npc);
  if (!s) throw new Error(`${npc.id} has no loot warning waiting for the player`);
  settleLootWarning(world, s, answer, refusal);
}

export function warnedOffTarget(world: World, v: Vehicle, targetId: string): NpcState | null {
  return world.states.find((s) => s.kind === 'lootWarning' && s.other === v.id && lootWarningData(s).targetId === targetId && lootWarningData(s).answer === 'comply') ?? null;
}

export function breakLootWarning(world: World, me: Vehicle, targetId: string): void {
  const s = warnedOffTarget(world, me, targetId);
  if (s) endState(world, s, 'broken');
}

export function lootsBesidePlayer(world: World, npc: Vehicle): boolean {
  const target = lootClaimedBy(world, npc);
  const me = playerVehicle(world);
  if (target === null || target === me.id || !canArgue(world, me, npc)) return false;
  const stock = world.salvage.find((s) => s.id === target);
  return stock ? salvageInRange(me, stock) : inTowReach(me, vehicleById(world, target));
}

export function playerWarns(world: World, npc: Vehicle, answer: WarnAnswer): void {
  const target = lootClaimedBy(world, npc);
  if (target === null) throw new Error(`${npc.id} loots nothing to warn it off`);
  warnTruck(world, playerVehicle(world), npc, target, 'roll', answer);
}

function lootTargetExists(world: World, targetId: string): boolean {
  return world.salvage.some((s) => s.id === targetId) || world.vehicles.some((v) => v.id === targetId && isKnockedOut(v));
}

export function checkLootWarning(world: World, s: NpcState): StateEnding | null {
  const data = lootWarningData(s);
  if (!lootTargetExists(world, data.targetId)) return 'fulfilled';
  return data.answer === null && world.turn - s.born >= NPC_BEHAVIOR.warnAnswerTurns ? 'expired' : null;
}

export function lapseLootWarning(world: World, s: NpcState): void {
  const warner = world.vehicles.find((v) => v.id === s.holder);
  const data = lootWarningData(s);
  if (warner && data.answer === null) leaveLoot(world, warner, data.targetId, 'warningUnanswered');
}

export function defendWarned(world: World, s: NpcState): void {
  const warner = world.vehicles.find((v) => v.id === s.holder);
  const warned = world.vehicles.find((v) => v.id === s.other);
  if (!warner?.brain || !warned || isKnockedOut(warner) || !canVehicleSee(world, warner, warned.pos)) return;
  fightOver(world, warner, warned, 'defendPromisedLoot');
}
