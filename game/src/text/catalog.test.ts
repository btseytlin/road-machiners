// The catalog check: every key in every language, with the same params and the language's own plural forms.
import { describe, expect, it } from 'vitest';
import { EN } from './en';
import { LOCALES, type EnEntry, type Locale } from './msg';
import { entryText, parse, placeholders, pluralCategories, schemaOf } from './resolve';
import { RU } from './ru';

const CATALOGS: Record<Locale, Readonly<Record<string, string | EnEntry>>> = { en: EN, ru: RU };
const KEYS = Object.keys(EN);

// Russian text that reads the same as the English on purpose: brands, a language's own name, and numbers or marks.
const SAME_AS_ENGLISH = new Set(['radio.band', 'radio.frequency', 'language.en', 'language.ru']);
const hasWords = (text: string): boolean => /\p{L}{2,}/u.test(text.replace(/\{[^}]*\}/g, ''));

// Words that break character on the radio: the drivers and J.J. talk about roads, cargo, money and wrecks, never
// about the game itself. A stem matches at the start of a word.
const BANNED: Record<Locale, readonly string[]> = {
  en: ['turn', 'quest', 'xp', 'experience', 'level', 'hp', 'click', 'press', 'key', 'player', 'game', 'tile', 'save'],
  ru: ['ход', 'квест', 'опыт', 'уров', 'игрок', 'игров', 'клик', 'нажм', 'клавиш', 'клетк', 'сохран'],
};

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

  it('the banned words check catches its own case', () => {
    expect(bannedIn('en', 'Your turn is up')).toEqual(['turn']);
    expect(bannedIn('ru', 'Твой ход, игрок')).toEqual(['ход', 'игрок']);
    expect(bannedIn('ru', 'Проходи мимо')).toEqual([]);
  });
});
