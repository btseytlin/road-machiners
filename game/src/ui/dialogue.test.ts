import { describe, expect, it } from 'vitest';
import { haulText, tipText } from './dialogue';

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

describe('haul text', () => {
  it('names goods by count and parts by name, joined in one list', () => {
    expect(haulText({ kind: 'haul', goods: { scrap: 2 }, parts: [] })).toBe('2 scrap metal');
    expect(haulText({ kind: 'haul', goods: { scrap: 2, salt: 1 }, parts: ['mg'] })).toBe('2 scrap metal, 1 salt and mg turret');
  });

  it('never names an empty haul', () => {
    expect(() => haulText({ kind: 'haul', goods: {}, parts: [] })).toThrow(/empty haul/);
  });
});
