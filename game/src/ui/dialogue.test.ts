import { describe, expect, it } from 'vitest';
import { HANG_UP_LINE, LINE_IDS, TOPICS, TRAIT_TALK, type LineId, type PrepareId } from '../data/dialogue';
import type { CallVar, CallVars } from '../sim/types';
import { LOCALES, type Msg } from '../text/msg';
import { lineKey } from '../text/names';
import { resolve, schemaOf } from '../text/resolve';
import { aidWords, lineText, tipText } from './dialogue';

const en = (msg: Msg): string => resolve(msg, 'en');

describe('trading tip text', () => {
  it('names the site and the good of a dear tip', () => {
    expect(en(tipText({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } }))).toBe('Last time I was at Bowl, salt was very overpriced.');
  });

  it('names the site and the good of a cheap tip', () => {
    expect(en(tipText({ kind: 'tip', tip: { shop: 'granary', good: 'grain', dear: false } }))).toBe('Last time I was at The Granary, grain was going cheap.');
  });

  it('fits the verb to a good with a plural name', () => {
    expect(en(tipText({ kind: 'tip', tip: { shop: 'nose', good: 'meds', dear: true } }))).toBe('Last time I was at Nose, meds were very overpriced.');
    expect(en(tipText({ kind: 'tip', tip: { shop: 'pump-station', good: 'batteries', dear: false } }))).toBe('Last time I was at Pump Station, batteries were going cheap.');
  });

  it('says there is nothing to tell without a tip', () => {
    expect(en(tipText({ kind: 'tip', tip: null }))).toBe('Nothing worth telling.');
  });

  it('tells a tip in Russian without the English verb', () => {
    expect(resolve(tipText({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } }), 'ru')).toBe('Заезжал недавно — Чаша. Там втридорога: соль.');
  });
});

describe('aid words', () => {
  it('names fuel and supplies, leaving out a zero part, and counts supplies in each language', () => {
    expect(en(aidWords(2, 3))).toBe('10 L of fuel and 3 supplies');
    expect(en(aidWords(0, 1))).toBe('1 supply');
    expect(resolve(aidWords(0, 5), 'ru')).toBe('5 ящиков припасов');
    expect(() => aidWords(0, 0)).toThrow();
  });
});

// The call values each prepare step can make. A topic without one has none.
const PREPARE_VARS: Record<PrepareId, string[]> = {
  nearestTown: ['town', 'bearing', 'distance'],
  towOffer: ['town', 'fee'],
  patchTerms: ['deal'],
  truceAnswer: ['answer'],
  mercyAnswer: ['answer'],
  threatAnswer: ['answer'],
  warnAnswer: ['answer'],
  npcTowTerms: ['site', 'fee'],
  lastTownPrices: ['town', 'prices'],
  nearestRumor: ['site', 'bearing', 'distance'],
  tradeTip: ['tip'],
  trucePrice: ['price'],
  aidWanted: ['aid', 'price'],
  aidAnswer: ['aid'],
  aidOffered: ['aid'],
  yieldAnswer: ['answer'],
};

// One sample value of each call value a line can name.
const SAMPLE: Record<string, CallVar> = {
  town: { kind: 'town', id: 'bowl' },
  site: { kind: 'site', id: 'granary' },
  bearing: { kind: 'bearing', rad: 1 },
  distance: { kind: 'distance', tiles: 300 },
  fee: { kind: 'money', amount: 1200 },
  price: { kind: 'money', amount: 45 },
  deal: { kind: 'deal', deal: 'paid', patcher: 'npc', price: 80, parts: 2, turns: 3 },
  prices: { kind: 'prices', town: 'bowl', goods: [{ good: 'salt', buy: 30, sell: 22 }, { good: 'meds', buy: 90, sell: 70 }] },
  tip: { kind: 'tip', tip: { shop: 'nose', good: 'meds', dear: false } },
  aid: { kind: 'aid', fuel: 2, supplies: 3 },
};

const named = (line: LineId): string[] => Object.keys(schemaOf(lineKey(line)));

describe('every radio line', () => {
  it('names only call values its topic prepares', () => {
    for (const topic of Object.values(TOPICS)) {
      const yields = new Set(topic.prepare ? PREPARE_VARS[topic.prepare] : []);
      for (const node of Object.values(topic.nodes)) {
        for (const name of named(node.line)) expect(yields.has(name), `${topic.id} ${node.line} {${name}}`).toBe(true);
        for (const option of node.options) expect(named(option.say), `${topic.id} ${option.say}`).toEqual([]);
      }
      if (topic.ask) expect(named(topic.ask.say), topic.id).toEqual([]);
    }
  });

  it('reads in every language with the values it names', () => {
    const vars: CallVars = SAMPLE;
    for (const locale of LOCALES) {
      for (const line of LINE_IDS) {
        const words = resolve(lineText(line, vars), locale);
        expect(words.length, `${locale} ${line}`).toBeGreaterThan(0);
        expect(words, `${locale} ${line}`).not.toContain('{');
      }
    }
  });

  it('every voice and the hang up need no values', () => {
    const voices = Object.values(TRAIT_TALK).flatMap((t) => (t.voice ? [t.voice.greeting, t.voice.repeatLine, t.voice.refusal] : []));
    for (const line of [...voices, HANG_UP_LINE]) expect(named(line)).toEqual([]);
  });

  it('throws for a line missing a value it names', () => {
    expect(() => lineText('townBearing', {})).toThrow(/town/);
  });
});
