// Where saves and run logs live. The browser keeps them in IndexedDB, which stores objects as they are, writes each
// transaction whole or not at all, and has a quota sized to the disk. Tests keep them in memory.

import { reportError } from './crash';
import { slotKey, type SlotId } from './save-slots';

// A run log entry before it is stored. turn and day place it in the run.
export type LogEntry = { kind: string; turn: number; day: number } & Record<string, unknown>;

// A stored run log entry. seq rises by one per record within a run.
export type LogRecord = LogEntry & { runId: string; seq: number };

export type SaveBackend = {
  readAll(): Promise<Map<SlotId, unknown>>;
  put(slot: SlotId, envelope: unknown): Promise<void>;
  remove(slot: SlotId): Promise<void>;
  // Numbers the entries on from the run's last stored record, in the same transaction, so two tabs on one run never
  // take the same number.
  appendLog(runId: string, entries: readonly LogEntry[]): Promise<void>;
  readLog(runId: string): Promise<LogRecord[]>;
};

const SAVES = 'saves';
const LOG = 'log';

// The database of one save scope. Version 1 holds the saves by slot and the log by run id and seq.
export async function idbBackend(name: string): Promise<SaveBackend> {
  const db = await opened(name);
  return {
    readAll: async () => {
      const tx = db.transaction(SAVES, 'readonly');
      const [keys, values] = await Promise.all([request(tx.objectStore(SAVES).getAllKeys()), request(tx.objectStore(SAVES).getAll())]);
      return new Map(keys.map((key, i) => [key as SlotId, values[i]]));
    },
    put: (slot, envelope) => written(db, SAVES, (store) => store.put(envelope, slot)),
    remove: (slot) => written(db, SAVES, (store) => store.delete(slot)),
    appendLog: (runId, entries) => written(db, LOG, (store) => {
      const last = store.openCursor(runRange(runId), 'prev');
      last.onsuccess = () => {
        const next = last.result ? (last.result.value as LogRecord).seq + 1 : 0;
        entries.forEach((entry, i) => store.add({ ...entry, runId, seq: next + i }));
      };
    }),
    readLog: (runId) => request(db.transaction(LOG, 'readonly').objectStore(LOG).getAll(runRange(runId))),
  };
}

function runRange(runId: string): IDBKeyRange {
  return IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]);
}

async function opened(name: string): Promise<IDBDatabase> {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(SAVES);
    open.result.createObjectStore(LOG, { keyPath: ['runId', 'seq'] });
  };
  try {
    return await request(open);
  } catch (err) {
    throw new Error(`The game keeps saves in IndexedDB, and this browser refused it: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// A write that resolves once the browser has put it on disk, not when it reached the browser's memory.
function written(db: IDBDatabase, store: string, write: (store: IDBObjectStore) => void): Promise<void> {
  const tx = db.transaction(store, 'readwrite', { durability: 'strict' });
  write(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error(`The ${store} write was aborted`));
  });
}

export function memoryBackend(): SaveBackend {
  const saves = new Map<SlotId, unknown>();
  const log: LogRecord[] = [];
  return {
    readAll: async () => new Map([...saves].map(([slot, envelope]) => [slot, structuredClone(envelope)])),
    put: async (slot, envelope) => { saves.set(slot, structuredClone(envelope)); },
    remove: async (slot) => { saves.delete(slot); },
    appendLog: async (runId, entries) => {
      const next = Math.max(-1, ...log.filter((r) => r.runId === runId).map((r) => r.seq)) + 1;
      log.push(...entries.map((entry, i) => structuredClone({ ...entry, runId, seq: next + i })));
    },
    readLog: async (runId) => log.filter((r) => r.runId === runId),
  };
}

// The save slots, mirrored in memory so the game reads and writes them at once. A write goes on to the backend in the
// background, and a failed one goes to onError. flush() waits for the writes, so a reload never cuts one off.
export class SaveSlots {
  onError: (err: unknown) => void = reportError;
  private pending = new Set<Promise<void>>();

  // envelopes must be what the backend holds.
  constructor(readonly backend: SaveBackend, private envelopes: Map<SlotId, unknown>) {}

  // Opens the slots and moves every save left in local storage by older builds into the backend. A local storage save
  // replaces a slot only when it is newer, since a tab of an old build may still write there. A save that does not
  // parse moves as its raw text into an empty slot, so load reports it like any other unreadable save.
  static async open(backend: SaveBackend, legacy: Storage, base: string, slots: readonly SlotId[]): Promise<SaveSlots> {
    const stored = await backend.readAll();
    for (const slot of slots) {
      const key = slotKey(base, slot);
      const raw = legacy.getItem(key);
      if (raw === null) continue;
      const envelope = parsedOrRaw(raw);
      if (!stored.has(slot) || savedAtOf(envelope) > savedAtOf(stored.get(slot))) await backend.put(slot, envelope);
      legacy.removeItem(key);
    }
    return new SaveSlots(backend, await backend.readAll());
  }

  // A copy, so the world loaded from it never changes the mirror.
  get(slot: SlotId): unknown {
    const envelope = this.envelopes.get(slot);
    return envelope === undefined ? null : structuredClone(envelope);
  }

  has(slot: SlotId): boolean {
    return this.envelopes.has(slot);
  }

  put(slot: SlotId, envelope: unknown): void {
    const copy = structuredClone(envelope);
    this.envelopes.set(slot, copy);
    this.track(this.backend.put(slot, copy));
  }

  remove(slot: SlotId): void {
    this.envelopes.delete(slot);
    this.track(this.backend.remove(slot));
  }

  // Resolves once every write made so far has landed or failed.
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  private track(write: Promise<void>): void {
    const done = write.catch((err) => this.onError(err)).finally(() => this.pending.delete(done));
    this.pending.add(done);
  }
}

// When a save was written, 0 for a save from before slots or one that does not parse.
function savedAtOf(envelope: unknown): number {
  const savedAt = (envelope as { savedAt?: unknown } | null)?.savedAt;
  return typeof savedAt === 'number' ? savedAt : 0;
}

function parsedOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
