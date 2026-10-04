// NPC use of utility parts. Each turn, after vision and auto fire, a driver picks this turn's utility orders from what
// it sees and what it is doing. The rules only choose orders: each order then passes the same checks and resolves in
// the same activation step as the player's, in src/sim/utility.ts.

import { NPC_UTILITY } from '../data/npc-behavior';
import { partDef } from '../data/parts';
import { inCombat, isHostile } from './combat';
import { corePart } from './grid';
import { isTownGuarded } from './guards';
import { topGoal } from './npc-activities';
import { visibleHostiles } from './npc-decisions';
import { sunAt } from './sun';
import type { NpcBrain, PartInstance, UtilityOrder, Vehicle, World } from './types';
import { chargedParts, useKindOf, utilityOrderError, type UseKind } from './utility';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { maxHp } from './wear';

type Npc = Vehicle & { brain: NpcBrain };
// The order the driver wants to give the part this turn, or null for none.
type Rule = (world: World, v: Npc, part: PartInstance) => UtilityOrder | null;

const self = (wanted: boolean): UtilityOrder | null => (wanted ? { kind: 'self' } : null);

const RULES: Record<UseKind, Rule> = {
  harpoon: harpoonOrder,
  sprout: (world, v) => self(wantsSmoke(world, v)),
  caltrops: (world, v) => self(chased(world, v)),
  oil: (world, v) => self(chased(world, v)),
  mortar: mortarOrder,
  flare: flareOrder,
  emitter: emitterOrder,
  claymore: (_world, v) => self(v.brain.ramChoice !== undefined),
  crane: () => null,
  scraper: () => null,
};

// Gives every NPC's utilities the orders its rules want. The player's truck is never touched. An order already given
// stays, except a standing harpoon order whose fight has ended, which is cleared first.
export function assignUtilityOrders(world: World): void {
  for (const v of world.vehicles) if (isNpc(world, v)) planUses(world, v);
}

function isNpc(world: World, v: Vehicle): v is Npc {
  return v.brain !== null && v.id !== world.player.vehicleId;
}

// An order the part refuses now is not given: for a self or point order that is broken, recharging, out of range or
// shut down, and for a truck order broken or unseen. A truck order then waits on range, arc and recharge.
function planUses(world: World, v: Npc): void {
  for (const part of chargedParts(v)) {
    dropEndedFight(v, part.id);
    if (part.id in v.utilityOrders) continue;
    const order = RULES[useKindOf(partDef(part.defId))](world, v, part);
    if (order && utilityOrderError(world, v, part.id, order) === null) v.utilityOrders[part.id] = order;
  }
}

// Clears a standing truck order once the driver no longer fights its target, as setUtilityOrder clears.
function dropEndedFight(v: Npc, partId: string): void {
  const standing = v.utilityOrders[partId];
  if (standing?.kind === 'truck' && !fightsWith(v, standing.targetId)) delete v.utilityOrders[partId];
}

// Whether the fight on top of the driver's goals is with this truck.
function fightsWith(v: Npc, targetId: string): boolean {
  const goal = topGoal(v);
  return goal?.kind === 'fight' && goal.targetId === targetId;
}

function fleeing(v: Npc): boolean {
  return topGoal(v)?.kind === 'flee';
}

// The trucks that shot at the driver and are in its sight, nearest first.
function seenAttackers(world: World, v: Npc): Vehicle[] {
  const seen = world.vehicles.filter((x) => x.id in v.brain.attackers && canVehicleSee(world, v, x.pos));
  return seen.sort((a, b) => dist(v.pos, a.pos) - dist(v.pos, b.pos));
}

// Whether `p` lies ahead of the truck's nose, across the line through its center.
function ahead(v: Vehicle, p: Vec): boolean {
  return Math.cos(v.heading) * (p.x - v.pos.x) + Math.sin(v.heading) * (p.y - v.pos.y) > 0;
}

// Whether a hostile use may hit the trucks: like a gun opening fire, never inside a town's guard.
function unguarded(trucks: Vehicle[]): boolean {
  return trucks.every((x) => !isTownGuarded(x.pos));
}

// Harpoon: the fight target is driving away from the driver, outside any town guard. Sight is the order's own check,
// and the order then stands through range, arc and recharge until it fires or the fight ends.
function harpoonOrder(world: World, v: Npc): UtilityOrder | null {
  const goal = topGoal(v);
  const target = goal?.kind === 'fight' ? world.vehicles.find((x) => x.id === goal.targetId) : undefined;
  if (!target || !drivesAway(target, v.pos) || !unguarded([v, target])) return null;
  return { kind: 'truck', targetId: target.id, aim: 'body' };
}

// Whether the truck is moving and its heading points away from `from`.
function drivesAway(v: Vehicle, from: Vec): boolean {
  return v.speed > 0 && Math.cos(v.heading) * (v.pos.x - from.x) + Math.sin(v.heading) * (v.pos.y - from.y) > 0;
}

// Sprout: an attacker is in sight, and the driver flees a fight or its cab is below NPC_UTILITY.sproutCab.
function wantsSmoke(world: World, v: Npc): boolean {
  if (seenAttackers(world, v).length === 0) return false;
  const cab = corePart(v, 'cab');
  return (fleeing(v) && inCombat(world, v)) || cab.hp < maxHp(cab) * NPC_UTILITY.sproutCab;
}

// Caltrops and oil: the driver flees with a hostile in sight behind it, within NPC_UTILITY.dropReach.
function chased(world: World, v: Npc): boolean {
  return fleeing(v) && visibleHostiles(world, v).some((h) => dist(v.pos, h.pos) <= NPC_UTILITY.dropReach && !ahead(v, h.pos));
}

// Smoke mortar: a fleeing driver shells the midpoint between itself and its nearest attacker in sight.
function mortarOrder(world: World, v: Npc): UtilityOrder | null {
  const attacker = fleeing(v) ? seenAttackers(world, v)[0] : undefined;
  if (!attacker) return null;
  return { kind: 'point', pos: { x: (v.pos.x + attacker.pos.x) / 2, y: (v.pos.y + attacker.pos.y) / 2 } };
}

// Flare cannon: at night, a driver investigating a contact lights the contact's center.
function flareOrder(world: World, v: Npc): UtilityOrder | null {
  const goal = topGoal(v);
  if (sunAt(world.turn) || goal?.kind !== 'investigate' || !goal.destination) return null;
  return { kind: 'point', pos: { ...goal.destination } };
}

// Emitter: in a fight, every truck the driver sees within the pulse radius is hostile, there is at least one, and none
// is inside a town guard.
function emitterOrder(world: World, v: Npc, part: PartInstance): UtilityOrder | null {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || def.effect.type !== 'emitter') throw new Error(`${def.name} is not an emitter`);
  const radius = def.effect.radius;
  const near = world.vehicles.filter((x) => x.id !== v.id && dist(x.pos, v.pos) <= radius && canVehicleSee(world, v, x.pos));
  return self(near.length > 0 && inCombat(world, v) && unguarded([v, ...near]) && near.every((x) => isHostile(world, v, x)));
}
