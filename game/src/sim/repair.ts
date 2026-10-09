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
  if (!part) throw new Error(`${partId} is not a mounted part on ${v.name}`);
  return part;
}

export function machiningMult(world: World, v: Vehicle): number {
  return Math.max(0, 1 - skillEffect(world, v, 'machining', 'repair'));
}

export type RepairPlan = { turns: number; parts: number; hp: number; needed: number };

export function repairPlan(world: World, v: Vehicle, partId: string, maxParts = Infinity): RepairPlan {
  const part = findRepairPart(v, partId);
  return planPartRepair(part, partFieldCap(world, v, part), machiningMult(world, v), goodsCount(v).parts ?? 0, maxParts);
}

function partFieldCap(world: World, v: Vehicle, part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind !== 'armor' || def.fieldRepair === 'capped') return fieldCapShare(world, v);
  return def.fieldRepair === 'full' ? 1 : 0;
}

function fieldCapShare(world: World, v: Vehicle): number {
  return Math.min(1, REPAIR.fieldCapShare + skillEffect(world, v, 'machining', 'fieldCap'));
}

export function planPartRepair(part: PartInstance, capShare: number, mult: number, partsHeld: number, maxParts: number): RepairPlan {
  if (isJunk(part)) throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
  const max = maxHp(part);
  const cap = Math.min(max, max * capShare);
  const gap = Math.max(0, cap - part.hp);
  if (gap === 0) return { turns: 0, parts: 0, hp: 0, needed: 0 };
  const hpPerPart = mult > 0 ? (max * GOODS.parts.value) / (partValue(part) * mult) : Infinity;
  const needed = Math.max(1, Math.ceil(gap / hpPerPart - 1e-9));
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
