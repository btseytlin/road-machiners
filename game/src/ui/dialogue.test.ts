import { describe, expect, it } from 'vitest';
import { fillLine, tipText } from './dialogue';

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
