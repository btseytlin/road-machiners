// Driver memories: hidden facts a driver saw, each with the turn it saw it. A newer fact about the same subject
// replaces the older one, and a memory fades after its kind's lifetime in MEMORY.turns. This is the only writer of
// brain.memories. Talk reads memories through recall().

import { MEMORY } from '../data/npcs';
import type { Memory, MemoryFact, NpcBrain, Vehicle, World } from './types';

export function subjectOf(fact: MemoryFact): string {
  return `${fact.kind}:${fact.shop}`;
}

function brainOf(vehicle: Vehicle): NpcBrain {
  if (!vehicle.brain) throw new Error(`${vehicle.id} has no brain to remember with`);
  return vehicle.brain;
}

export function remember(world: World, vehicle: Vehicle, fact: MemoryFact): void {
  const brain = brainOf(vehicle);
  const subject = subjectOf(fact);
  brain.memories = brain.memories.filter((m) => subjectOf(m.fact) !== subject);
  brain.memories.push({ turn: world.turn, fact });
}

export function recall<K extends MemoryFact['kind']>(vehicle: Vehicle, kind: K): (Memory & { fact: Extract<MemoryFact, { kind: K }> })[] {
  return brainOf(vehicle).memories
    .filter((m): m is Memory & { fact: Extract<MemoryFact, { kind: K }> } => m.fact.kind === kind)
    .reverse();
}

export function forgetOld(world: World): void {
  const fresh = (m: Memory): boolean => world.turn - m.turn < MEMORY.turns[m.fact.kind];
  for (const v of world.vehicles) {
    if (v.brain && !v.brain.memories.every(fresh)) v.brain.memories = v.brain.memories.filter(fresh);
  }
}
