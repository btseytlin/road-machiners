import { describe, expect, it } from 'vitest';
import type { QuestLive } from '../sim/types';
import { extendTranscript } from './quest-screen';

const live = (quest: string, text: string): QuestLive => ({ quest, ink: '{}', lines: [{ text, tags: [] }], choices: ['Goodbye.'] });

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
