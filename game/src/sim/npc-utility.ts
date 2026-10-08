// NPC use of utility parts. Each turn, after vision and auto fire, a driver picks this turn's utility orders from what
// it sees and what it is doing. The rules only choose orders: each order then passes the same checks and resolves in
// the same activation step as the player's, in src/sim/utility.ts.

import { NPC_UTILITY } from '../data/npc-behavior';
import { partDef } from '../data/parts';
import { inCombat, isHostile } from './combat';
import { corePart } from './grid';
import { topGoal } from './npc-activities';
import { visibleHostiles } from './npc-decisions';
import { sunAt } from './sun';
import type { NpcBrain, PartInstance, UtilityOrder, Vehicle, World } from './types';
import { chargedParts, useKindOf, utilityOrderError, type UseKind } from './utility';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { maxHp } from './wear';

type Npc = Vehicle & { brain: NpcBrain };
type Rule = (world: World, v: Npc, part: PartInstance) => UtilityOrder | null;

const self = (wanted: boolean): UtilityOrder | null => (wanted ? { kind: 'self' } : null);

const RULES: Record<UseKind, Rule> = {
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

export function assignUtilityOrders(world: World): void {
  for (const v of world.vehicles) if (isNpc(world, v)) planUses(world, v);
}

function isNpc(world: World, v: Vehicle): v is Npc {
  return v.brain !== null && v.id !== world.player.vehicleId;
}

function planUses(world: World, v: Npc): void {
  for (const part of chargedParts(v)) {
    if (part.id in v.utilityOrders) continue;
    const order = RULES[useKindOf(partDef(part.defId))](world, v, part);
    if (order && utilityOrderError(world, v, part.id, order) === null) v.utilityOrders[part.id] = order;
  }
}

function fleeing(v: Npc): boolean {
  return topGoal(v)?.kind === 'flee';
}

function seenAttackers(world: World, v: Npc): Vehicle[] {
  const seen = world.vehicles.filter((x) => x.id in v.brain.attackers && canVehicleSee(world, v, x.pos));
  return seen.sort((a, b) => dist(v.pos, a.pos) - dist(v.pos, b.pos));
}

function ahead(v: Vehicle, p: Vec): boolean {
  return Math.cos(v.heading) * (p.x - v.pos.x) + Math.sin(v.heading) * (p.y - v.pos.y) > 0;
}

function wantsSmoke(world: World, v: Npc): boolean {
  if (seenAttackers(world, v).length === 0) return false;
  const cab = corePart(v, 'cab');
  return (fleeing(v) && inCombat(world, v)) || cab.hp < maxHp(cab) * NPC_UTILITY.sproutCab;
}

function chased(world: World, v: Npc): boolean {
  return fleeing(v) && visibleHostiles(world, v).some((h) => dist(v.pos, h.pos) <= NPC_UTILITY.dropReach && !ahead(v, h.pos));
}

function mortarOrder(world: World, v: Npc): UtilityOrder | null {
  const attacker = fleeing(v) ? seenAttackers(world, v)[0] : undefined;
  if (!attacker) return null;
  return { kind: 'point', pos: { x: (v.pos.x + attacker.pos.x) / 2, y: (v.pos.y + attacker.pos.y) / 2 } };
}

function flareOrder(world: World, v: Npc): UtilityOrder | null {
  const goal = topGoal(v);
  if (sunAt(world.turn) || goal?.kind !== 'investigate' || !goal.destination) return null;
  return { kind: 'point', pos: { ...goal.destination } };
}

function emitterOrder(world: World, v: Npc, part: PartInstance): UtilityOrder | null {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || def.effect.type !== 'emitter') throw new Error(`${def.name} is not an emitter`);
  const radius = def.effect.radius;
  const near = world.vehicles.filter((x) => x.id !== v.id && dist(x.pos, v.pos) <= radius && canVehicleSee(world, v, x.pos));
  return self(near.length > 0 && inCombat(world, v) && near.every((x) => isHostile(world, v, x)));
}
