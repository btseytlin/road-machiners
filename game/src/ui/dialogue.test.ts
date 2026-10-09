import { describe, expect, it } from 'vitest';
import { BUSY_LINE, SPARE_LINE, TOPICS, TRAIT_TALK } from '../data/dialogue';
import { fillLine, tipText } from './dialogue';
import { markupProblems, plainText } from './quest-text';

describe('radio line markup', () => {
  it('passes the quest text check on every radio line and option', () => {
    const voices = Object.values(TRAIT_TALK).flatMap((t) => (t.voice ? [t.voice.greeting, t.voice.repeatLine, t.voice.refusal] : []));
    const topics = Object.values(TOPICS).flatMap((t) => [...(t.ask ? [t.ask.text] : []), ...Object.values(t.nodes).flatMap((n) => [n.line, ...n.options.map((o) => o.text)])]);
    const lines = [BUSY_LINE, SPARE_LINE, ...voices, ...topics];
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) expect(markupProblems(line, []), line).toEqual([]);
  });

  it('drops the markup for the log', () => {
    expect(plainText('Bring <b>three</b> cans and <color=rust>run</color>.')).toBe('Bring three cans and run.');
  });
});

describe('trading tip text', () => {
  it('names the site and the good of a dear tip', () => {
    expect(tipText({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } })).toBe('Last time I was at Bowl, salt was very overpriced.');
  });

  it('names the site and the good of a cheap tip', () => {
    expect(tipText({ kind: 'tip', tip: { shop: 'granary', good: 'grain', dear: false } })).toBe('Last time I was at The Granary, grain was going cheap.');
  });

  it('fits the verb to a good with a plural name', () => {
    expect(tipText({ kind: 'tip', tip: { shop: 'nose', good: 'meds', dear: true } })).toBe('Last time I was at Nose, meds were very overpriced.');
    expect(tipText({ kind: 'tip', tip: { shop: 'pump-station', good: 'batteries', dear: false } })).toBe('Last time I was at Pump Station, batteries were going cheap.');
  });

  it('says there is nothing to tell without a tip', () => {
    expect(tipText({ kind: 'tip', tip: null })).toBe('Nothing worth telling.');
  });
});

describe('currency in dialogue', () => {
  it("groups an amount and names the unit", () => {
    expect(fillLine('{fee} when we get there.', { fee: { kind: 'money', amount: 150000 } })).toBe("1,500 M's when we get there.");
  });
});

describe('fillLine', () => {
  it("shows a driver's own line as it is", () => {
    expect(fillLine('{warnLine}', { warnLine: { kind: 'line', text: "That's my pick. Roll on." } })).toBe("That's my pick. Roll on.");
  });
});
