// Escapes: the player gets away from hostile trucks. At each turn's end the player keeps the ids of the hostile
// trucks in sight. A turn that ends with none of them in sight and no hostile seen practices driving, unless one
// of them was destroyed, which is a win and not an escape. Only a truck in combat with the player or hunting it

import { engagedWith, isHostile } from './combat';
import { playerVehicle } from './damage';
import { fightOdds } from './fight-odds';
import { practice } from './progress';
import type { Vehicle, World } from './types';
import { playerSees } from './vision';

export function noteEscape(world: World): void {
  const p = world.player;
  const me = playerVehicle(world);
  const before = p.hostilesSeen;
  p.hostilesSeen = p.state === 'active' ? hostilesInSight(world, me) : [];
  if (p.state !== 'active' || p.hostilesSeen.length > 0) return;
  const escaped = escapedFrom(world, me, before);
  if (!escaped) return;
  const strongest = escaped.reduce((a, b) => (escapeDifficulty(world, me, b) > escapeDifficulty(world, me, a) ? b : a));
  practice(world, 'escape', 1, escapeDifficulty(world, me, strongest), strongest.id);
}

function escapedFrom(world: World, me: Vehicle, seen: string[]): Vehicle[] | null {
  if (seen.length === 0) return null;
  const escaped = world.vehicles.filter((v) => seen.includes(v.id));
  if (escaped.length < seen.length || escaped.some((v) => playerSees(world, v.pos))) return null;
  const engaged = escaped.filter((v) => engagedWith(world, v, me));
  return engaged.length > 0 ? engaged : null;
}

function hostilesInSight(world: World, me: Vehicle): string[] {
  return world.vehicles.filter((v) => v.id !== me.id && isHostile(world, v, me) && playerSees(world, v.pos)).map((v) => v.id);
}

function escapeDifficulty(world: World, me: Vehicle, strongest: Vehicle): number {
  return 1 - fightOdds(world, [me], [strongest]).win;
}
