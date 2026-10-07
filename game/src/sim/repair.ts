// Field repair: a parked job that spends parts to restore one part's HP up to a field cap.
// Parts are spent only when the job finishes. Machining shortens the job and cuts parts use.

import { partDef } from '../data/parts';
import { GOODS } from '../data/goods';
import { skillEffect } from './progress';
import { REPAIR } from '../data/wear';
import { isJunk, maxHp, partValue, restorePart } from './wear';
import { goodsCount, mountedParts } from './grid';
import { removeGoods } from './inventory';
import type { Job, PartInstance, Vehicle, World } from './types';

function findRepairPart(v: Vehicle, partId: string): PartInstance {
  const part = mountedParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${partId} is not a mounted part on ${v.id}`);
  return part;
}

// Machining scales down both parts spent and turns needed. Player only: NPCs have no skills.
export function machiningMult(world: World, v: Vehicle): number {
  return Math.max(0, 1 - skillEffect(world, v, 'machining', 'repair'));
}

// A patch spends the parts held, up to what the field cap needs and at most maxParts. Fewer parts
// restore less HP. `needed` is the parts a patch to the field cap would take.
export type RepairPlan = { turns: number; parts: number; hp: number; needed: number };

export function repairPlan(world: World, v: Vehicle, partId: string, maxParts = Infinity): RepairPlan {
  const part = findRepairPart(v, partId);
  return planPartRepair(part, partFieldCap(world, v, part), machiningMult(world, v), goodsCount(v).parts ?? 0, maxParts);
}

// Scrap armor patches to full and ceramic armor only mends in town. Every other part stops at the field cap.
function partFieldCap(world: World, v: Vehicle, part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind !== 'armor' || def.fieldRepair === 'capped') return fieldCapShare(world, v);
  return def.fieldRepair === 'full' ? 1 : 0;
}

// Share of max HP a field repair lifts a part to. The player's machining raises it, up to full HP.
function fieldCapShare(world: World, v: Vehicle): number {
  return Math.min(1, REPAIR.fieldCapShare + skillEffect(world, v, 'machining', 'fieldCap'));
}

// The repair math for one part: lift it to `capShare` of max HP, spending at most the parts held and maxParts.
// `mult` is the repairer's Machining multiplier.
// Throws for a junk part, which no repair rebuilds.
export function planPartRepair(part: PartInstance, capShare: number, mult: number, partsHeld: number, maxParts: number): RepairPlan {
  if (isJunk(part)) throw new Error(`${part.defId} is junk and cannot be rebuilt`);
  const max = maxHp(part);
  const cap = Math.min(max, max * capShare);
  const gap = Math.max(0, cap - part.hp);
  if (gap === 0) return { turns: 0, parts: 0, hp: 0, needed: 0 };
  // A unit of the parts good restores about its own money value in part value, so a field repair is a fair
  // trade rather than a discount: cheap parts patch to a large HP share per unit, costly parts to a small one.
  const hpPerPart = mult > 0 ? (max * GOODS.parts.value) / (partValue(part) * mult) : Infinity;
  const needed = Math.max(1, Math.ceil(gap / hpPerPart - 1e-9)); // float slack keeps an exact 2 from rounding to 3
  const parts = Math.min(needed, maxParts, partsHeld);
  if (parts === 0) return { turns: 0, parts: 0, hp: 0, needed };
  const hp = Math.min(gap, parts * hpPerPart);
  const turns = Math.max(1, Math.ceil(parts * REPAIR.turnsPerPart * mult));
  return { turns, parts, hp, needed };
}

export function repairTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'repair' }>): boolean {
  job.turnsLeft--;
  if (job.turnsLeft > 0) return false;
  const plan = repairPlan(world, v, job.partId, job.parts);
  if (plan.needed === 0) return true;
  removeGoods(v, 'parts', plan.parts);
  const part = findRepairPart(v, job.partId);
  restorePart(part, part.hp + plan.hp);
  return true;
}
