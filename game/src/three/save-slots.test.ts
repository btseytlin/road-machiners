import { describe, expect, it } from 'vitest';
import { resolve } from '../text/resolve';
import { allSlots, listSaves, manualSlots, newestSlot, requestBoot, slotKey, slotLabel, takeBootRequest } from './save-slots';

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

const save = (turn: number, savedAt?: number) => JSON.stringify({ format: { major: 2, minor: 3 }, savedAt, world: { turn } });

describe('save slots', () => {
  it('keeps the old key for the autosave and adds the slot to the others', () => {
    expect(slotKey('roam.save', 'auto')).toBe('roam.save');
    expect(slotKey('roam.save', 'day')).toBe('roam.save:day');
    expect(slotKey('roam.save.factory', 'slot2')).toBe('roam.save.factory:slot2');
  });

  it('lists the autosaves first, then the manual slots, with labels', () => {
    expect(manualSlots(3)).toEqual(['slot1', 'slot2', 'slot3']);
    expect(allSlots(2)).toEqual(['auto', 'day', 'slot1', 'slot2']);
    expect(['auto', 'day', 'slot3'].map((s) => resolve(slotLabel(s as 'auto'), 'en'))).toEqual(['Autosave', 'Day start', 'Slot 3']);
    expect(resolve(slotLabel('slot3'), 'ru')).toBe('Ячейка 3');
  });

  it('lists filled slots newest first, counts a missing savedAt as 0 and flags an unreadable row', () => {
    const storage = makeStorage();
    storage.setItem('roam.save', save(40));
    storage.setItem('roam.save:slot1', save(30, 500));
    storage.setItem('roam.save:slot2', '{');
    storage.setItem('roam.save:day', save(20, 900));

    expect(listSaves(storage, 'roam.save', 3)).toEqual([
      { slot: 'day', savedAt: 900, turn: 20 },
      { slot: 'slot1', savedAt: 500, turn: 30 },
      { slot: 'auto', savedAt: 0, turn: 40 },
      { slot: 'slot2', savedAt: 0, turn: null },
    ]);
    expect(newestSlot(storage, 'roam.save', 3)).toBe('day');
    expect(newestSlot(makeStorage(), 'roam.save', 3)).toBeNull();
  });

  it('removes the boot request when it is read', () => {
    const session = makeStorage();
    expect(takeBootRequest(session, 'roam.save')).toBeNull();
    requestBoot(session, 'roam.save', 'slot2');
    expect(takeBootRequest(session, 'roam.save')).toBe('slot2');
    expect(takeBootRequest(session, 'roam.save')).toBeNull();
  });

  it('throws on an unknown boot request', () => {
    const session = makeStorage();
    session.setItem('roam.save.boot', 'bogus');
    expect(() => takeBootRequest(session, 'roam.save')).toThrow(/bogus/);
  });
});
