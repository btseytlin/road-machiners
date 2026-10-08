// The one owner of which drivers keep off roads. A raider that retreats, flees or is stranded hides beside the
// roads and only crosses them, and a raider out hunting travels unseen by road traffic. route() asks this for
// every plan, so ambush tactics can extend it here.

import { huntsOffRoad } from './hunt-style';
import { topGoal } from './npc-activities';
import { isStranded } from './stats';
import type { Vehicle, World } from './types';

export function keepsOffRoads(world: World, v: Vehicle): boolean {
  if (!v.brain || v.faction !== 'raiders') return false;
  return hides(world, v) || huntsOffRoad(v.brain);
}

// A raider that retreats, flees or is stranded.
function hides(world: World, v: Vehicle): boolean {
  const goal = topGoal(v)?.kind;
  return goal === 'retreat' || goal === 'flee' || isStranded(world, v);
}
