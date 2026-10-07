// Settlement talk: the locals of a town, the topics they take up now, and what asking them changes. The player
// talks to them at a town shop's pad through the town screen. Talk takes no time, pays nothing and teaches nothing.
// Rumors and clues go into the journal through learnNote. Work talk names the town board's best contract and takes
// it through acceptContract, as the board does.

import { CONTRACTS } from '../data/market';
import { LOCAL_TOPICS, LOCALS, type LocalConditionId, type LocalDef, type LocalId, type LocalTopic, type LocalTopicId } from '../data/locals';
import { WAGON_SEVEN } from '../data/salvage';
import { acceptContract, isExpired, shopAt, shopState, type Contract } from './market';
import { holdsNote, learnNote } from './notes';
import { storyStock } from './salvage';
import type { World } from './types';
import { update } from './world';

export const LOCAL_CONDITIONS: Record<LocalConditionId, (world: World) => boolean> = {
  foundBurntConvoy: (world) => world.player.discovered.includes('burnt-convoy'),
  foundFallenSun: (world) => world.player.discovered.includes('fallen-sun'),
  heardWagonBowl: (world) => holdsNote(world, 'wagonBowl'),
  searchedWagon: (world) => world.player.scavenged.includes(storyStock(world, WAGON_SEVEN).id),
};

// The people of a town, in data order. A stall or an unknown site has none.
export function localsAt(town: string): LocalDef[] {
  return Object.values(LOCALS).filter((l) => l.town === town);
}

export function localDef(localId: LocalId): LocalDef {
  const local = LOCALS[localId];
  if (!local) throw new Error(`No local ${localId}`);
  return local;
}

// The topics the local takes up now: those whose facts all hold, in data order.
export function localTopics(world: World, localId: LocalId): { id: LocalTopicId; topic: LocalTopic }[] {
  return localDef(localId).topics.map((id) => ({ id, topic: LOCAL_TOPICS[id] as LocalTopic })).filter(({ topic }) => topic.when.every((c) => LOCAL_CONDITIONS[c](world)));
}

// Asking a topic writes its notes into the journal and changes nothing else.
export function askLocal(world: World, localId: LocalId, topicId: LocalTopicId): World {
  requireTopic(world, localId, topicId);
  const topic: LocalTopic = LOCAL_TOPICS[topicId];
  return update(world, (w) => {
    for (const note of topic.notes) learnNote(w, note);
  });
}

// The contract a local with work offers: the best-paying open offer on the board of the town the player is parked
// at. Null when the board has none or the player already holds the most contracts.
export function localWork(world: World, localId: LocalId): Contract | null {
  requireParkedAt(world, localDef(localId));
  if (world.player.contracts.length >= CONTRACTS.maxActive) return null;
  const open = shopState(world, localDef(localId).town).contracts.filter((c) => !isExpired(world, c));
  return open.reduce<Contract | null>((best, c) => (best === null || c.reward > best.reward ? c : best), null);
}

// What a local with work says now: the offer line holding `{terms}`, or why there is nothing to offer.
export function workLine(world: World, localId: LocalId, topicId: LocalTopicId): string {
  const work = requireTopic(world, localId, topicId).work;
  if (!work) throw new Error(`${topicId} is not about work`);
  if (localWork(world, localId)) return work.offer;
  return world.player.contracts.length >= CONTRACTS.maxActive ? work.full : work.empty;
}

// Takes the contract the local offers, exactly as the board's Accept does.
export function takeLocalWork(world: World, localId: LocalId, contractId: string): World {
  const offer = localWork(world, localId);
  if (offer?.id !== contractId) throw new Error(`${localId} does not offer contract ${contractId}`);
  return acceptContract(world, contractId);
}

function requireTopic(world: World, localId: LocalId, topicId: LocalTopicId): LocalTopic {
  const local = localDef(localId);
  requireParkedAt(world, local);
  if (!(topicId in LOCAL_TOPICS)) throw new Error(`No local topic ${topicId}`);
  if (!localTopics(world, localId).some((t) => t.id === topicId)) throw new Error(`${local.name} does not take up ${topicId} now`);
  return LOCAL_TOPICS[topicId];
}

function requireParkedAt(world: World, local: LocalDef): void {
  if (shopAt(world) !== local.town) throw new Error(`Not parked at ${local.town}, where ${local.name} lives`);
}
