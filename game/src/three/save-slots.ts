// The save slots in local storage and the request that tells boot which one to load. A slot is one key that holds
// one save envelope. The Autosave keeps the key a single save had before slots, so an old save shows up as it.

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

export function slotLabel(slot: SlotId): string {
  if (slot === 'auto') return 'Autosave';
  if (slot === 'day') return 'Day start';
  return `Slot ${slot.slice('slot'.length)}`;
}

export type SlotInfo = { slot: SlotId; savedAt: number; turn: number | null };

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function infoOf(slot: SlotId, raw: string): SlotInfo {
  try {
    const { savedAt, world } = JSON.parse(raw) as { savedAt?: unknown; world?: { turn?: unknown } };
    return { slot, savedAt: numberOr(savedAt, 0) ?? 0, turn: numberOr(world?.turn, null) };
  } catch {
    return { slot, savedAt: 0, turn: null };
  }
}

export function listSaves(storage: Storage, base: string, count: number): SlotInfo[] {
  const infos = allSlots(count).flatMap((slot) => {
    const raw = storage.getItem(slotKey(base, slot));
    return raw === null ? [] : [infoOf(slot, raw)];
  });
  return infos.sort((a, b) => b.savedAt - a.savedAt);
}

export function newestSlot(storage: Storage, base: string, count: number): SlotId | null {
  return listSaves(storage, base, count)[0]?.slot ?? null;
}

export type BootRequest = SlotId | 'new';

function requestKey(base: string): string {
  return `${base}.boot`;
}

export function requestBoot(session: Storage, base: string, request: BootRequest): void {
  session.setItem(requestKey(base), request);
}

function isBootRequest(value: string): value is BootRequest {
  return value === 'new' || value === 'auto' || value === 'day' || /^slot[1-9]\d*$/.test(value);
}

export function takeBootRequest(session: Storage, base: string): BootRequest | null {
  const value = session.getItem(requestKey(base));
  if (value === null) return null;
  session.removeItem(requestKey(base));
  if (!isBootRequest(value)) throw new Error(`Unknown boot request ${value}`);
  return value;
}
