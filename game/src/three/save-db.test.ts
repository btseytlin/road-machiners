import { defaultSetup } from '../sim/settings';
import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { loadWorld, saveOf, writeSave } from './save';
import { memoryBackend, SaveSlots, type SaveBackend } from './save-db';
import { allSlots } from './save-slots';

const SLOTS = allSlots(3);

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('SaveSlots.open', () => {
  it('moves every local storage save into the backend, loads it, and deletes the local storage key', async () => {
    const legacy = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    legacy.setItem('roam.save', JSON.stringify({ ...saveOf(world), savedAt: 5 }));
    legacy.setItem('roam.save:slot2', JSON.stringify({ ...saveOf({ ...world, turn: 9 }), savedAt: 6 }));
    legacy.setItem('roam.tips', '[]');
    const backend = memoryBackend();

    const slots = await SaveSlots.open(backend, legacy, 'roam.save', SLOTS);

    expect(loadWorld(slots, 'auto', TEST_MAP)).toEqual(world);
    expect(loadWorld(slots, 'slot2', TEST_MAP)?.turn).toBe(9);
    expect([legacy.getItem('roam.save'), legacy.getItem('roam.save:slot2'), legacy.getItem('roam.tips')]).toEqual([null, null, '[]']);
    expect([...(await backend.readAll()).keys()].sort()).toEqual(['auto', 'slot2']);
  });

  it('keeps a newer database save over an older local storage one, and deletes the local storage key', async () => {
    const backend = memoryBackend();
    await backend.put('auto', { savedAt: 50, world: { turn: 9 } });
    const legacy = makeStorage();
    legacy.setItem('roam.save', JSON.stringify({ savedAt: 10, world: { turn: 3 } }));
    legacy.setItem('roam.save:day', JSON.stringify({ savedAt: 90, world: { turn: 4 } }));
    await backend.put('day', { savedAt: 60, world: { turn: 2 } });

    const slots = await SaveSlots.open(backend, legacy, 'roam.save', SLOTS);

    expect(slots.get('auto')).toEqual({ savedAt: 50, world: { turn: 9 } });
    expect(slots.get('day')).toEqual({ savedAt: 90, world: { turn: 4 } });
    expect([legacy.getItem('roam.save'), legacy.getItem('roam.save:day')]).toEqual([null, null]);
  });

  it('moves a local storage save that does not parse as its text', async () => {
    const legacy = makeStorage();
    legacy.setItem('roam.save:day', '{"format":');
    const slots = await SaveSlots.open(memoryBackend(), legacy, 'roam.save', SLOTS);
    expect(slots.get('day')).toBe('{"format":');
  });

  it('opens what an earlier session saved', async () => {
    const backend = memoryBackend();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const first = await SaveSlots.open(backend, makeStorage(), 'roam.save', SLOTS);
    writeSave(first, 'slot1', world, 'r', 1);
    await first.flush();

    const reopened = await SaveSlots.open(backend, makeStorage(), 'roam.save', SLOTS);

    expect(loadWorld(reopened, 'slot1', TEST_MAP)).toEqual(world);
  });
});

describe('SaveSlots', () => {
  it('hands out copies, so changing a loaded save leaves the slot as saved', () => {
    const slots = new SaveSlots(memoryBackend(), new Map());
    slots.put('auto', { world: { turn: 3 } });
    (slots.get('auto') as { world: { turn: number } }).world.turn = 99;
    expect(slots.get('auto')).toEqual({ world: { turn: 3 } });
  });

  it('flushes only once every write has landed', async () => {
    const backend = memoryBackend();
    let land = () => {};
    const slow: SaveBackend = { ...backend, put: (slot, envelope) => new Promise((resolve) => { land = () => resolve(backend.put(slot, envelope)); }) };
    const slots = new SaveSlots(slow, new Map());
    slots.put('auto', { world: { turn: 3 } });
    let flushed = false;
    const flush = slots.flush().then(() => { flushed = true; });
    await new Promise((resolve) => setTimeout(resolve));
    expect(flushed).toBe(false);
    land();
    await flush;
    expect((await backend.readAll()).get('auto')).toEqual({ world: { turn: 3 } });
  });

  it('sends a refused write to onError and keeps the backend as it was', async () => {
    const backend = memoryBackend();
    await backend.put('auto', { world: { turn: 3 } });
    const refusing: SaveBackend = { ...backend, put: () => Promise.reject(new Error('Quota exceeded')) };
    const slots = new SaveSlots(refusing, await backend.readAll());
    const errors: unknown[] = [];
    slots.onError = (err) => errors.push(err);

    slots.put('auto', { world: { turn: 4 } });
    await new Promise((resolve) => setTimeout(resolve));

    expect(errors.map((e) => (e as Error).message)).toEqual(['Quota exceeded']);
    expect((await backend.readAll()).get('auto')).toEqual({ world: { turn: 3 } });
  });
});
