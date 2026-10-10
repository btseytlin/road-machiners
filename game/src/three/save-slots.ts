
import type { SaveSlots } from './save-db';

import { parseSetup } from '../sim/settings';
import type { WorldSetup } from '../sim/types';

import { t, type Msg } from '../text/msg';

export type SlotId = 'auto' | 'day' | `slot${number}`;

export function manualSlots(count: number): SlotId[] {
  return Array.from({ length: count }, (_, i) => `slot${i + 1}` as const);
}

export function allSlots(count: number): SlotId[] {
  return ['auto', 'day', ...manualSlots(count)];
}

export function slotKey(base: string, slot: SlotId): string {
  return slot === 'auto' ? base : `${base}:${slot}`;
}

export function slotLabel(slot: SlotId): Msg {
  if (slot === 'auto') return t('save.slot.auto');
  if (slot === 'day') return t('save.slot.day');
  return t('save.slot.manual', { n: Number(slot.slice('slot'.length)) });
}

export type SlotInfo = { slot: SlotId; savedAt: number; turn: number | null };

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function infoOf(slot: SlotId, envelope: unknown): SlotInfo {
  const { savedAt, world } = (typeof envelope === 'object' && envelope !== null ? envelope : {}) as { savedAt?: unknown; world?: { turn?: unknown } };
  return { slot, savedAt: numberOr(savedAt, 0) ?? 0, turn: numberOr(world?.turn, null) };
}

export function listSaves(slots: SaveSlots, count: number): SlotInfo[] {
  const infos = allSlots(count).flatMap((slot) => slots.has(slot) ? [infoOf(slot, slots.get(slot))] : []);
  return infos.sort((a, b) => b.savedAt - a.savedAt);
}

export function newestSlot(slots: SaveSlots, count: number): SlotId | null {
  return listSaves(slots, count)[0]?.slot ?? null;
}

export type RoadBoot = { slot: SlotId; reason: 'road' };
export type BootRequest = SlotId | { new: WorldSetup } | RoadBoot;

function requestKey(base: string): string {
  return `${base}.boot`;
}

export function requestBoot(session: Storage, base: string, request: BootRequest): void {
  session.setItem(requestKey(base), typeof request === 'string' ? request : JSON.stringify(request));
}

function isSlotId(value: string): value is SlotId {
  return value === 'auto' || value === 'day' || /^slot[1-9]\d*$/.test(value);
}

export function takeBootRequest(session: Storage, base: string): BootRequest | null {
  const value = session.getItem(requestKey(base));
  if (value === null) return null;
  session.removeItem(requestKey(base));
  if (isSlotId(value)) return value;
  const request = parsedRequest(value);
  if ('new' in request) return { new: parseSetup(request.new) };
  if (isRoadBoot(request)) return { slot: request.slot, reason: 'road' };
  throw new Error(`Unknown boot request ${value}`);
}

function isRoadBoot(request: { slot?: unknown; reason?: unknown }): request is { slot: SlotId; reason: 'road' } {
  return request.reason === 'road' && typeof request.slot === 'string' && isSlotId(request.slot);
}

function parsedRequest(value: string): { new?: unknown; slot?: unknown; reason?: unknown } {
  let request: unknown;
  try {
    request = JSON.parse(value);
  } catch {
    throw new Error(`Unknown boot request ${value}`);
  }
  if (typeof request !== 'object' || request === null) throw new Error(`Unknown boot request ${value}`);
  return request;
}
