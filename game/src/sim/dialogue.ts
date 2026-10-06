// Talk between the player and NPCs: radio calls and the horn. A radio call joins the player and one NPC, and
// radio works in sight only. A player call opens on the hub, which lists the topics this NPC can take up. An
// NPC call opens on the topic it raises. Turns wait while a call is open. Topic content lives in
// src/data/dialogue.ts, and its logic in src/sim/dialogue-rules.ts.

import { BUSY_LINE, END, HONK_RANGE, HUB, REFUSED, TOPICS, TRAIT_TALK, type DialogueOption, type Topic, type TopicId, type Voice } from '../data/dialogue';
import { inCombat, inCombatWithOther, inFeud, isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { isKnockedOut } from './defeat';
import { CONDITIONS, EFFECTS, PREPARES } from './dialogue-rules';
import type { Call, CallVars, GameEvent, Vehicle, World } from './types';
import { dist } from './vec';
import { npcTraits } from './npc-decisions';
import { practice } from './progress';
import { canVehicleSee } from './vision';
import { playerCommand, requireActivePlayer, update } from './world';

// An option the player can pick now. The hub lists topics, and a topic node lists its own options.
export type OfferedOption = { text: string; topic: TopicId | null; option: DialogueOption | null };

// The one place talk reads traits: the first voice among the driver's traits, and the union of their topics.
export function talkOf(npc: Vehicle): Voice & { topics: TopicId[] } {
  const talks = npcTraits(npc).map((id) => TRAIT_TALK[id]);
  const voice = talks.find((t) => t.voice)?.voice;
  if (!voice) throw new Error(`${npc.id} has no trait with a voice`);
  return { ...voice, topics: [...new Set(talks.flatMap((t) => t.topics))] };
}

function holds(world: World, npc: Vehicle, when: readonly (keyof typeof CONDITIONS)[], vars: CallVars): boolean {
  return when.every((id) => CONDITIONS[id](world, npc, vars));
}

function isSettled(world: World, npc: Vehicle, topic: Topic): boolean {
  return topic.once && world.player.talked[npc.id]?.[topic.id] !== undefined;
}

// A call the driver refused. It sits on no topic.
function isRefused(call: Call): boolean {
  return call.topic === null && call.node === REFUSED;
}

function openCall(world: World): Call {
  const call = world.player.call;
  if (!call) throw new Error('No call is open');
  return call;
}

// The topics the player can raise with this driver now. A driver in a feud takes up only topics asked during feuds.
function askable(world: World, npc: Vehicle): Topic[] {
  const feud = inFeud(world, npc, playerVehicle(world));
  return talkOf(npc).topics.map((id) => TOPICS[id]).filter((t) => t.ask && (!feud || t.ask.duringFeud) && holds(world, npc, t.ask.when, {}));
}

// The options on offer right now, in display order. Hang up is always the last, and the only one after a refusal.
export function currentOptions(world: World): OfferedOption[] {
  const call = openCall(world);
  const npc = vehicleById(world, call.with);
  const hangUp: OfferedOption = { text: 'Hang up.', topic: null, option: null };
  if (isRefused(call)) return [hangUp];
  if (!call.topic) return [...askable(world, npc).map((t) => ({ text: t.ask!.text, topic: t.id, option: null })), hangUp];
  const node = TOPICS[call.topic].nodes[call.node];
  const options = node.options.filter((o) => holds(world, npc, o.when, call.vars)).map((o) => ({ text: o.text, topic: call.topic, option: o }));
  return [...options, hangUp];
}

// The line the NPC says at the current node.
export function currentLine(world: World): string {
  const call = openCall(world);
  if (isRefused(call)) return call.line.text;
  if (!call.topic) return talkOf(vehicleById(world, call.with)).greeting;
  return TOPICS[call.topic].nodes[call.node].line;
}

function say(world: World, speaker: string, text: string, vars: CallVars): void {
  for (const name of placeholders(text)) {
    if (!vars[name]) throw new Error(`Line "${text}" needs the call value ${name}`);
  }
  world.events.push({ t: 'say', speaker, text, vars });
  if (world.player.call?.with === speaker) world.player.call.line = { text, vars };
}

export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// Moves the call to a node and has the NPC say its line.
function enter(world: World, call: Call, topic: TopicId | null, node: string): void {
  call.topic = topic;
  call.node = node;
  if (!topic) call.vars = {};
  say(world, call.with, currentLine(world), call.vars);
}

// Taking up a topic practices social. The same topic with the same driver pays only the first time.
function enterTopic(world: World, npc: Vehicle, call: Call, topic: Topic): void {
  call.vars = topic.prepare ? PREPARES[topic.prepare](world, npc) : {};
  practice(world, 'call', 1, null, `${npc.id}:${topic.id}`);
  enter(world, call, topic.id, topic.start);
}

function endCall(world: World, call: Call): void {
  world.player.call = null;
  world.events.push({ t: 'call', with: call.with, outcome: 'ended' });
}

function begin(world: World, npc: Vehicle): Call {
  if (world.player.call) throw new Error('A call is already open');
  const call: Call = { with: npc.id, topic: null, node: HUB, vars: {}, line: { text: '', vars: {} } };
  world.player.call = call;
  world.events.push({ t: 'call', with: npc.id, outcome: 'opened' });
  return call;
}

// The player calls a truck in sight. A truck busy fighting another, or in a feud with the player with no topic to
// take up, answers with a refusal, and the player can only hang up. The refusal stays out of the event log.
export function callVehicle(world: World, npcId: string): World {
  return update(world, (w) => {
    requireActivePlayer(w);
    if (w.player.call) throw new Error('A call is already open');
    const npc = vehicleById(w, npcId);
    if (!npc.brain) throw new Error(`${npcId} has no driver to call`);
    if (isKnockedOut(npc)) throw new Error(`${npcId} has a knocked-out driver`);
    if (!canVehicleSee(w, playerVehicle(w), npc.pos)) throw new Error(`${npcId} is out of sight`);
    const refusal = refusalOf(w, npc);
    const call = begin(w, npc);
    if (!refusal) return enter(w, call, null, HUB);
    call.node = REFUSED;
    call.line = { text: refusal, vars: {} };
  });
}

// The line a driver answers with instead of taking the player's call, or null when it takes the call.
function refusalOf(world: World, npc: Vehicle): string | null {
  if (busyElsewhere(world, npc, playerVehicle(world))) return BUSY_LINE;
  if (inFeud(world, npc, playerVehicle(world)) && askable(world, npc).length === 0) return talkOf(npc).refusal;
  return null;
}

// A driver in combat with another truck that is not at odds with the player. A foe of the player is part
// of the player's fight, so it takes calls and raises its demands and pleas even while it targets another truck.
function busyElsewhere(world: World, npc: Vehicle, me: Vehicle): boolean {
  return inCombatWithOther(world, npc, me.id) && !isHostile(world, npc, me);
}

// The player's reply goes to the log only on a call the driver took.
function reply(world: World, call: Call, text: string): void {
  if (!isRefused(call)) say(world, world.player.vehicleId, text, call.vars);
}

// The player picks an offered option by its index in currentOptions().
export function chooseOption(world: World, index: number): World {
  return update(world, (w) => {
    const offered = currentOptions(w)[index];
    if (!offered) throw new Error(`No option ${index} on offer`);
    const call = openCall(w);
    const npc = vehicleById(w, call.with);
    reply(w, call, offered.text);
    if (offered.option) return follow(w, npc, call, offered.option);
    if (offered.topic) return askTopic(w, npc, call, TOPICS[offered.topic]);
    hangUpCall(w, npc, call);
  });
}

// A topic picked from the hub. A settled `once` topic gets the repeat line, and the call stays on the hub.
function askTopic(world: World, npc: Vehicle, call: Call, topic: Topic): void {
  if (isSettled(world, npc, topic)) return say(world, npc.id, talkOf(npc).repeatLine, {});
  enterTopic(world, npc, call, topic);
}

function follow(world: World, npc: Vehicle, call: Call, option: DialogueOption): void {
  for (const id of option.effects) EFFECTS[id](world, npc, call);
  if (option.go === END) return endCall(world, call);
  if (option.go === HUB) return enter(world, call, null, HUB);
  enter(world, call, call.topic, option.go);
}

// A call opened during a turn ends when the player or the NPC is knocked out or killed later in that turn, or the
// NPC is gone. It counts as hanging up.
// A call the driver raised earlier in the turn also ends, without its hang-up effects, once the reason for it is
// gone, like a tow offer dropped for danger or a plea that ran out. Its answers would act on nothing.
export function endCallIfOut(world: World): void {
  const call = world.player.call;
  if (!call) return;
  const npc = world.vehicles.find((v) => v.id === call.with);
  if (!npc || lostReason(world, npc, call)) return endCall(world, call);
  if (world.player.state !== 'active' || isKnockedOut(npc)) hangUpCall(world, npc, call);
}

function lostReason(world: World, npc: Vehicle, call: Call): boolean {
  const raise = call.topic ? TOPICS[call.topic].raise : null;
  return raise !== null && !holds(world, npc, raise.when, call.vars);
}

// True while the player and this vehicle talk: neither shoots the other.
export function onCall(world: World, a: Vehicle, b: Vehicle): boolean {
  const call = world.player.call;
  if (!call) return false;
  const pair = [a.id, b.id];
  return pair.includes(call.with) && pair.includes(world.player.vehicleId);
}

// The vehicle ids on the radio now: both trucks of the open call, and the player's truck while its beacon is on.
export function onAir(world: World): string[] {
  const ids = new Set<string>();
  const call = world.player.call;
  if (call) ids.add(world.player.vehicleId).add(call.with);
  if (world.player.beacon) ids.add(world.player.vehicleId);
  return [...ids];
}

// The vehicle ids each kind of event puts on the radio. A honk, aid and patch work are not radio talk.
type Talk = { [K in GameEvent['t']]?: (e: Extract<GameEvent, { t: K }>, playerId: string) => string[] };
const pair = (e: { by: string; client: string }): string[] => [e.by, e.client];
const RADIO_TALK: Talk = {
  say: (e) => [e.speaker],
  call: (e, playerId) => [e.with, playerId],
  plea: (e) => (e.accepted === null ? [e.from] : [e.from, e.to]),
  escortHired: pair,
  escortRefused: pair,
  towHitched: pair,
  towOffer: (e) => [e.by],
};

// The vehicle ids that talked over the radio in these events.
export function radioSpeakers(events: readonly GameEvent[], playerId: string): string[] {
  return [...new Set(events.flatMap((e) => (RADIO_TALK[e.t] as ((e: GameEvent, id: string) => string[]) | undefined)?.(e, playerId) ?? []))];
}

function hangUpCall(world: World, npc: Vehicle, call: Call): void {
  if (call.topic) for (const id of TOPICS[call.topic].hangUp) EFFECTS[id](world, npc, call);
  endCall(world, call);
}

export function hangUp(world: World): World {
  return update(world, (w) => {
    const call = openCall(w);
    reply(w, call, 'Hang up.');
    hangUpCall(w, vehicleById(w, call.with), call);
  });
}

// A turn step: the first NPC in vehicle order that sees the player, is awake, is not busy fighting another truck
// and wants to raise a topic calls. A knocked-out driver keeps its old goals, so it must not read them here. The highest priority topic wins. A driver in a feud with the player calls only with a topic
// raised during feuds. While the player is in combat, only topics raised during combat call. One call at a time.
export function raiseCalls(world: World): void {
  if (world.player.call || world.player.state !== 'active') return;
  const me = playerVehicle(world);
  for (const npc of world.vehicles) {
    const topic = raisedTopic(world, npc, me);
    if (!topic) continue;
    enterTopic(world, npc, begin(world, npc), topic);
    return;
  }
}

function raisedTopic(world: World, npc: Vehicle, me: Vehicle): Topic | null {
  if (!npc.brain || isKnockedOut(npc) || busyElsewhere(world, npc, me) || !canVehicleSee(world, npc, me.pos)) return null;
  const feud = inFeud(world, npc, me);
  const combat = inCombat(world, me);
  const wanted = talkOf(npc).topics
    .map((id) => TOPICS[id])
    .filter((t) => t.raise && allowedNow(t.raise, feud, combat) && !isSettled(world, npc, t) && holds(world, npc, t.raise.when, {}))
    .sort((a, b) => b.raise!.priority - a.raise!.priority);
  return wanted[0] ?? null;
}

// A feud with the player or the player's combat stops a call unless the topic is raised during it.
function allowedNow(raise: NonNullable<Topic['raise']>, feud: boolean, combat: boolean): boolean {
  return (!feud || raise.duringFeud) && (!combat || raise.duringCombat);
}

// The horn is a signal, not a call. The player honks, and every NPC in earshot whose class answers, that is not
// hostile, not knocked out and not busy fighting another truck honks back, nearest first. Honking takes no turn.
export function honk(world: World): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    w.events.push({ t: 'honk', vehicle: me.id });
    for (const npc of answering(w, me)) {
      w.events.push({ t: 'honk', vehicle: npc.id });
      practiceHonk(w, me, npc);
    }
  });
}

// A driver in sight that honks back practices social a little.
function practiceHonk(world: World, me: Vehicle, npc: Vehicle): void {
  if (canVehicleSee(world, me, npc.pos)) practice(world, 'honk', 1, null, npc.id);
}

function answering(world: World, me: Vehicle): Vehicle[] {
  return world.vehicles
    .filter((v) => v.brain && !isKnockedOut(v) && dist(v.pos, me.pos) <= HONK_RANGE && talkOf(v).honksBack && !inCombatWithOther(world, v, me.id) && !isHostile(world, v, me))
    .sort((a, b) => dist(a.pos, me.pos) - dist(b.pos, me.pos));
}
