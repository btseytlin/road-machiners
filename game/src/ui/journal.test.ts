import { describe, expect, it } from 'vitest';
import { NOTES } from '../data/locals';
import { TIME } from '../data/time';
import { emptyWorld } from '../sim/testkit';
import { journalEntries } from './journal';

describe('journal entries', () => {
  it('lists the notes newest first, with the day each was learned', () => {
    const w = emptyWorld();
    w.player.notes = [
      { id: 'wagonBowl', turn: 10 },
      { id: 'greenPit', turn: TIME.turnsPerDay + 10 },
      { id: 'wagonNose', turn: TIME.turnsPerDay + 10 },
    ];

    const entries = journalEntries(w);

    expect(entries.map((e) => e.title)).toEqual([NOTES.wagonNose.title, NOTES.greenPit.title, NOTES.wagonBowl.title]);
    expect(entries.map((e) => e.day)).toEqual([2, 2, 1]);
    expect(entries[0]).toMatchObject({ from: NOTES.wagonNose.from, text: NOTES.wagonNose.text });
  });

  it('is empty with no notes', () => {
    expect(journalEntries(emptyWorld())).toEqual([]);
  });
});
