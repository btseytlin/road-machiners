import { describe, expect, it } from 'vitest';
import type { QuestLive } from '../sim/types';
import { lastTagged, pagesOf } from './quest-lines';
import { extendTranscript } from './quest-screen';

const live = (quest: string, text: string): QuestLive => ({ quest, ink: '{}', lines: [{ text, tags: [] }], choices: ['Goodbye.'], costs: [null] });
const line = (text: string, ...tags: string[]) => ({ text, tags });

describe('pagesOf', () => {
  it('starts a new page at each page line after the first', () => {
    const lines = [line('Outcome.'), line('More.'), line('Desk.', 'page', 'place: Office'), line('Hub.')];
    expect(pagesOf(lines)).toEqual([lines.slice(0, 2), lines.slice(2)]);
  });

  it('keeps one page when the page line comes first, as after a load', () => {
    const lines = [line('Desk.', 'page'), line('Hub.')];
    expect(pagesOf(lines)).toEqual([lines]);
  });
});

describe('lastTagged', () => {
  it('finds the latest place on view, or none', () => {
    expect(lastTagged([line('A', 'place: Gate'), line('B'), line('C', 'place: Barracks')], 'place')).toBe('Barracks');
    expect(lastTagged([line('A')], 'img')).toBeNull();
  });
});

describe('extendTranscript', () => {
  it('adds the pick and its answer under the last exchange of the same quest', () => {
    const first = live('bowl_hattie', 'Hello.');
    const start = extendTranscript([], null, first, null);

    const next = extendTranscript(start, first, live('bowl_hattie', 'Rumors.'), 'Heard any rumors?');

    expect(next).toEqual([
      { ask: null, lines: [{ text: 'Hello.', tags: [] }] },
      { ask: 'Heard any rumors?', lines: [{ text: 'Rumors.', tags: [] }] },
    ]);
  });

  it('starts over for a new quest or a live state with no pick, as after a load', () => {
    const hattie = live('bowl_hattie', 'Hello.');
    const before = extendTranscript([], null, hattie, null);

    expect(extendTranscript(before, hattie, live('bowl_ruben', 'Sit.'), 'Hi')).toEqual([{ ask: null, lines: [{ text: 'Sit.', tags: [] }] }]);
    expect(extendTranscript(before, hattie, live('bowl_hattie', 'Back.'), null)).toEqual([{ ask: null, lines: [{ text: 'Back.', tags: [] }] }]);
  });
});
