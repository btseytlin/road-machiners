import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { QUEST_ART } from '../data/quest-art';
import { lineStyle, markupProblems, parseMarkup, PLAIN_STYLE, revealUnits, rowCells } from './quest-text';

describe('parseMarkup', () => {
  it('splits a line into spans carrying their marks, nested ones included', () => {
    expect(parseMarkup('He <b>leans <color=rust>in</color></b> slowly.')).toEqual([
      { text: 'He ', marks: [] },
      { text: 'leans ', marks: [{ name: 'b', value: null }] },
      { text: 'in', marks: [{ name: 'b', value: null }, { name: 'color', value: 'rust' }] },
      { text: ' slowly.', marks: [] },
    ]);
  });

  it('keeps plain text whole', () => {
    expect(parseMarkup('Just words.')).toEqual([{ text: 'Just words.', marks: [] }]);
  });

  it('fails unknown, unclosed, crossed and badly valued markup', () => {
    expect(() => parseMarkup('<blink>x</blink>')).toThrow('Unknown markup <blink>');
    expect(() => parseMarkup('<b>x')).toThrow('Markup <b> is never closed');
    expect(() => parseMarkup('<b><i>x</b></i>')).toThrow('Markup </b> closes <i>');
    expect(() => parseMarkup('<color=pink>x</color>')).toThrow('Markup <color=pink> needs one of');
    expect(() => parseMarkup('<b=big>x</b>')).toThrow('Markup <b> takes no value');
  });
});

describe('lineStyle', () => {
  it('reads reveal, speed, speaker, place and flags from line tags', () => {
    expect(lineStyle(['reveal:char', 'speed:slow', 'speaker:Hattie', 'place: Fuel shed', 'work_offer', 'page'])).toEqual({
      reveal: 'char',
      speed: 'slow',
      img: null,
      speaker: 'Hattie',
      place: 'Fuel shed',
      flags: ['work_offer', 'page'],
    });
  });

  it('takes art only from the art list', () => {
    QUEST_ART.test_gate = 'gate.png';
    try {
      expect(lineStyle(['img: test_gate']).img).toBe('test_gate');
      expect(() => lineStyle(['img: test_wall'])).toThrow('Line tag # img: test_wall needs one of test_gate');
    } finally {
      delete QUEST_ART.test_gate;
    }
  });

  it('gives an untagged line the plain style', () => {
    expect(lineStyle([])).toEqual(PLAIN_STYLE);
  });

  it('fails an unknown tag, a bad value and art that does not exist', () => {
    expect(() => lineStyle(['glow'])).toThrow('Unknown line tag # glow');
    expect(() => lineStyle(['reveal:fade'])).toThrow('Line tag # reveal:fade needs one of all, word, char');
    expect(() => lineStyle(['img:wagon'])).toThrow('Line tag # img:wagon needs one of nothing yet');
  });
});

describe('rowCells', () => {
  it('splits a table row line at semicolons, keeping an empty first cell', () => {
    expect(rowCells('; Sabine; Depot pump')).toEqual(['', 'Sabine', 'Depot pump']);
    expect(rowCells('3rd;2 cans ;Pell')).toEqual(['3rd', '2 cans', 'Pell']);
  });
});

describe('markupProblems', () => {
  it('lists every problem of a line without throwing', () => {
    expect(markupProblems('<b>x', ['glow'])).toEqual([expect.stringContaining('never closed'), expect.stringContaining('Unknown line tag')]);
    expect(markupProblems('<pop>BAM</pop> it fell.', ['reveal:word'])).toEqual([]);
  });
});

describe('revealUnits', () => {
  it('reveals word by word, each word with its trailing space and its marks', () => {
    const units = revealUnits(parseMarkup('A <pop>BIG</pop> door'), lineStyle(['reveal:word']), 100);
    expect(units.map((u) => [u.text, u.delayMs, u.marks.map((m) => m.name)])).toEqual([
      ['A ', 100, []],
      ['BIG', 100 + CONFIG.questWordMs, ['pop']],
      [' ', 100 + 2 * CONFIG.questWordMs, []],
      ['door', 100 + 3 * CONFIG.questWordMs, []],
    ]);
  });

  it('reveals char by char, slower at slow speed', () => {
    const units = revealUnits(parseMarkup('ab'), lineStyle(['reveal:char', 'speed:slow']), 0);
    expect(units.map((u) => u.delayMs)).toEqual([0, 2 * CONFIG.questCharMs]);
  });

  it('shows a whole line at once with reveal all', () => {
    const units = revealUnits(parseMarkup('one <b>two</b>'), lineStyle(['reveal:all']), 40);
    expect(units.map((u) => u.delayMs)).toEqual([40, 40]);
  });
});
