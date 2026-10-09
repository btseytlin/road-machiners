// The catalog check: every key in every language, with the same params and the language's own plural forms.
import { describe, expect, it } from 'vitest';
import { EN } from './en';
import { LOCALES, type EnEntry, type Locale, type Noun } from './msg';
import { entryText, grammarParams, nounOf, parse, placeholders, pluralCategories, schemaOf } from './resolve';
import { RU } from './ru';

const CATALOGS: Record<Locale, Readonly<Record<string, EnEntry | Noun>>> = { en: EN, ru: RU };
const KEYS = Object.keys(EN);

const SAME_AS_ENGLISH = new Set(['radio.band', 'radio.frequency', 'language.en', 'language.ru']);
const RU_NOUN = /^(part|chassis|site|terrain|faction)\.[^.]+$|^driver\.(first|last)\.|^npc\.[^.]+\.profession$|^good\.[^.]+(\.lower|\.subject)?$/;
const RU_NOUN_KEYS = new Set(['vehicle.yours', 'job.theTruck', 'job.somePart', 'log.anObstacle', 'log.something', 'log.you']);
const hasWords =(text: string): boolean => /\p{L}{2,}/u.test(text.replace(/\{[^}]*\}/g, ''));

const BANNED: Record<Locale, readonly string[]> = {
  en: ['turn', 'quest', 'xp', 'experience', 'level', 'hp', 'click', 'press', 'key', 'player', 'game', 'tile', 'save'],
  ru: ['ход', 'квест', 'опыт', 'уров', 'игрок', 'игров', 'клик', 'нажм', 'клавиш', 'клетк', 'сохран'],
};

// Russian the committee rejected as machine translation. None of it may come back, in any entry.
const REJECTED_RU: readonly { text: string; reason: string }[] = [
  { text: 'чинено', reason: 'ungrammatical as a part status; a rebuild after a breakdown is «капремонт»' },
  { text: 'удлинённая платформа', reason: 'the flatbed extension lengthens the bed: «удлинитель кузова»' },
  { text: 'является', reason: 'bureaucratic; use a plain verb or a dash' },
  { text: 'осуществ', reason: 'bureaucratic; say what is done' },
];

function bannedIn(locale: Locale, text: string): string[] {
  const words = text.toLowerCase().split(/[^\p{L}]+/u);
  return BANNED[locale].filter((stem) => words.some((word) => (stem === 'ход' ? word === stem : word.startsWith(stem))));
}

describe('the catalog', () => {
  it('parses every entry in every language', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) expect(() => parse(entryText(locale, key)), `${locale} ${key}`).not.toThrow();
    }
  });

  it('has the same keys in every language', () => {
    for (const locale of LOCALES) expect(Object.keys(CATALOGS[locale]).sort(), locale).toEqual([...KEYS].sort());
  });

  it('uses exactly the params the English schema declares, in every language', () => {
    for (const key of KEYS) {
      const declared = Object.keys(schemaOf(key)).sort();
      for (const locale of LOCALES) expect([...placeholders(parse(entryText(locale, key)))].sort(), `${locale} ${key}`).toEqual(declared);
    }
  });

  it('pluralizes only counts, with exactly the plural forms of each language', () => {
    for (const locale of LOCALES) {
      const forms = new Intl.PluralRules(locale === 'en' ? 'en-US' : 'ru-RU').resolvedOptions().pluralCategories;
      for (const key of KEYS) {
        for (const [param, categories] of pluralCategories(parse(entryText(locale, key)))) {
          expect(schemaOf(key)[param], `${locale} ${key} {${param}}`).toBe('count');
          expect([...categories].sort(), `${locale} ${key} {${param}}`).toEqual([...forms].sort());
        }
      }
    }
  });

  it('puts only text params in a case or a gender agreement', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        for (const param of grammarParams(parse(entryText(locale, key)))) expect(schemaOf(key)[param], `${locale} ${key} {${param}}`).toBe('text');
      }
    }
  });

  it('gives every Russian name its forms in every case and its gender', () => {
    const templates = KEYS.filter((key) => key.endsWith('.profession')).map((key) => key.slice(0, -'.profession'.length));
    const names = KEYS.filter((key) => RU_NOUN.test(key) || RU_NOUN_KEYS.has(key) || templates.includes(key));
    expect(names.length).toBeGreaterThan(150);
    expect(names.filter((key) => nounOf('ru', key) === null)).toEqual([]);
    for (const key of RU_NOUN_KEYS) expect(KEYS).toContain(key);
  });

  it('says where every Russian place is, where to and where from', () => {
    const sites = KEYS.filter((key) => key.startsWith('site.'));
    expect(sites.filter((key) => !nounOf('ru', key)?.place)).toEqual([]);
  });

  it('has Russian words for every entry with words, never the English copied over', () => {
    const copied = KEYS.filter((key) => !SAME_AS_ENGLISH.has(key) && hasWords(entryText('en', key)) && entryText('ru', key) === entryText('en', key));
    expect(copied).toEqual([]);
  });

  it('keeps only real keys in the same-as-English list', () => {
    for (const key of SAME_AS_ENGLISH) expect(KEYS).toContain(key);
  });

  it('keeps radio talk and broadcasts in character in every language', () => {
    const talk = KEYS.filter((key) => key.startsWith('line.') || key.startsWith('radio.') || key.startsWith('deal.') || key.startsWith('tip.'));
    expect(talk.length).toBeGreaterThan(150);
    for (const locale of LOCALES) {
      for (const key of talk) expect(bannedIn(locale, entryText(locale, key)), `${locale} ${key}`).toEqual([]);
    }
  });

  it('holds none of the Russian the committee rejected', () => {
    const found = KEYS.flatMap((key) => {
      const entry = CATALOGS.ru[key];
      const texts = typeof entry === 'string' ? [entry] : 'forms' in entry ? Object.values(entry.forms) : [entry.text];
      return REJECTED_RU.filter(({ text }) => texts.some((t) => t.toLowerCase().includes(text))).map(({ text, reason }) => `${key}: «${text}», ${reason}`);
    });
    expect(found).toEqual([]);
  });

  it('the banned words check catches its own case', () => {
    expect(bannedIn('en', 'Your turn is up')).toEqual(['turn']);
    expect(bannedIn('ru', 'Твой ход, игрок')).toEqual(['ход', 'игрок']);
    expect(bannedIn('ru', 'Проходи мимо')).toEqual([]);
  });
});
