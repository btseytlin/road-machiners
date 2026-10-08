// The route style of hunting raiders. A raider out on a raid, a patrol or an investigation keeps off the road, so it
// travels unseen by road traffic. keepsOffRoads() in src/sim/off-road.ts reads it, so near and far
// driving, previews and traffic checks agree. It imports only types and data.

import { HUNT } from '../data/npc-behavior';
import type { NpcActivity, NpcBrain } from './types';

const OFF_ROAD_GOALS: ReadonlySet<NpcActivity['kind']> = new Set(HUNT.offRoadGoals);

// Whether this driver plans its routes off the road: the raider trait with a top goal in HUNT.offRoadGoals.
export function huntsOffRoad(brain: NpcBrain | undefined): boolean {
  if (!brain?.traits.includes('raider')) return false;
  const top = brain.goals.at(-1);
  return top !== undefined && OFF_ROAD_GOALS.has(top.kind);
}
