import { describe, expect, it } from 'vitest';
import { holdsNote, learnNote } from './notes';
import { emptyWorld } from './testkit';
import type { NoteId } from '../data/locals';

describe('journal notes', () => {
  it('starts a new player with no notes', () => {
    expect(emptyWorld().player.notes).toEqual([]);
  });

  it('keeps a learned note with the turn it was learned and tells the log once', () => {
    const w = emptyWorld();
    w.turn = 42;

    learnNote(w, 'greenPit');

    expect(w.player.notes).toEqual([{ id: 'greenPit', turn: 42 }]);
    expect(w.events).toEqual([{ t: 'note', id: 'greenPit' }]);
    expect(holdsNote(w, 'greenPit')).toBe(true);
    expect(holdsNote(w, 'glassTank')).toBe(false);
  });

  it('learns a held note again without a change or an event', () => {
    const w = emptyWorld();
    w.turn = 5;
    learnNote(w, 'greenPit');
    w.events = [];
    w.turn += 10;

    learnNote(w, 'greenPit');

    expect(w.player.notes).toEqual([{ id: 'greenPit', turn: 5 }]);
    expect(w.events).toEqual([]);
  });

  it('refuses a note id it does not know', () => {
    const w = emptyWorld();

    expect(() => learnNote(w, 'nonsense' as NoteId)).toThrow(/nonsense/);
    expect(w.player.notes).toEqual([]);
  });
});
