import { describe, expect, it } from 'vitest';
import { LANGUAGE_KEY, Language, loadLanguage } from './language';
import { byId, list, num, sameMsg, t, verbatim } from './msg';
import { parse, placeholders, pluralCategories, pseudo, resolve } from './resolve';

class FakeStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('parse', () => {
  it('reads literals and placeholders', () => {
    const parts = parse('{km} km away');
    expect(parts).toEqual([{ kind: 'arg', name: 'km' }, { kind: 'lit', text: ' km away' }]);
  });

  it('reads plurals with # and nested placeholders', () => {
    const parts = parse('{n, plural, one {# part from {town}} other {# parts}}');
    expect([...placeholders(parts)].sort()).toEqual(['n', 'town']);
    expect([...pluralCategories(parts).get('n') ?? []]).toEqual(['one', 'other']);
  });

  it('keeps # literal outside a plural', () => {
    expect(parse('No. #1')).toEqual([{ kind: 'lit', text: 'No. #1' }]);
  });

  it('throws on stray braces and malformed plurals', () => {
    expect(() => parse('a } b')).toThrow(/stray/);
    expect(() => parse('a { b')).toThrow();
    expect(() => parse('{n, select, a {x} other {y}}')).toThrow(/plural/);
    expect(() => parse('{n, plural, one {x}}')).toThrow(/other/);
    expect(() => parse('{n, plural, lots {x} other {y}}')).toThrow(/category/);
  });
});

describe('resolve', () => {
  it('formats English numbers like en-US', () => {
    expect(resolve(num(1234567, 'int'), 'en')).toBe((1234567).toLocaleString('en-US'));
    expect(resolve(t('call.km', { km: 2.25 }), 'en')).toBe('2.3 km');
  });

  it('groups Russian numbers with a no-break space and a decimal comma', () => {
    expect(resolve(num(1234567, 'int'), 'ru')).toBe('1\u00a0234\u00a0567');
    expect(resolve(t('call.km', { km: 1.5 }), 'ru')).toBe('1,5 км');
  });

  it('picks Russian plural forms', () => {
    const say = (n: number) => resolve(t('unit.part', { n }), 'ru');
    expect([1, 2, 5, 11, 21, 22].map(say)).toEqual(['1 деталь', '2 детали', '5 деталей', '11 деталей', '21 деталь', '22 детали']);
  });

  it('picks English plural forms', () => {
    expect(resolve(t('unit.part', { n: 1 }), 'en')).toBe('1 part');
    expect(resolve(t('unit.part', { n: 3 }), 'en')).toBe('3 parts');
  });

  it('shows verbatim names and lists as they are', () => {
    expect(resolve(verbatim('Ray Nolan'), 'ru')).toBe('Ray Nolan');
    expect(resolve(list([t('menu.save'), verbatim('X')]), 'ru')).toBe('Сохранить, X');
  });

  it('throws on an unknown key, a missing param, an extra param or a wrong type', () => {
    expect(() => resolve(byId('menu.nothing'), 'en')).toThrow(/Unknown|No en/);
    expect(() => resolve(byId('call.km'), 'en')).toThrow(/needs dec1/);
    expect(() => resolve(byId('menu.save', { n: 1 }), 'en')).toThrow(/extra/);
    expect(() => resolve(byId('call.km', { km: 'far' }), 'ru')).toThrow(/needs dec1/);
  });

  it('pads pseudo text by about 40% inside marks', () => {
    const padded = pseudo('Save game');
    expect(padded.startsWith('⟦') && padded.endsWith('⟧')).toBe(true);
    expect(padded.length).toBeGreaterThanOrEqual(Math.ceil('Save game'.length * 1.3));
    expect(resolve(t('menu.save'), 'pseudo')).toBe(pseudo('Save'));
  });
});

describe('sameMsg', () => {
  it('compares keys and params', () => {
    expect(sameMsg(t('call.km', { km: 1 }), t('call.km', { km: 1 }))).toBe(true);
    expect(sameMsg(t('call.km', { km: 1 }), t('call.km', { km: 2 }))).toBe(false);
  });
});

describe('Language', () => {
  it('defaults to English and stores a switch under its own key', () => {
    const storage = new FakeStorage();
    const root = { lang: '' };
    const language = loadLanguage(storage, '', false, root);
    expect(language.current()).toBe('en');
    expect(root.lang).toBe('en');
    let heard = 0;
    language.subscribe(() => heard++);
    language.set('ru');
    expect(storage.items.get(LANGUAGE_KEY)).toBe('ru');
    expect(root.lang).toBe('ru');
    expect(heard).toBe(1);
  });

  it('reads the stored choice on boot', () => {
    const storage = new FakeStorage();
    storage.setItem(LANGUAGE_KEY, 'ru');
    expect(loadLanguage(storage, '', false, null).current()).toBe('ru');
  });

  it('ignores an unknown stored value', () => {
    const storage = new FakeStorage();
    storage.setItem(LANGUAGE_KEY, 'xx');
    expect(loadLanguage(storage, '', false, null).current()).toBe('en');
  });

  it('accepts pseudo only in dev and never stores it', () => {
    const storage = new FakeStorage();
    expect(loadLanguage(storage, '?lang=pseudo', false, null).current()).toBe('en');
    expect(loadLanguage(storage, '?lang=pseudo', true, null).current()).toBe('pseudo');
    expect(storage.items.size).toBe(0);
    loadLanguage(new FakeStorage(), '', false, null);
  });

  it('keeps its key out of the save keys', () => {
    expect(LANGUAGE_KEY.startsWith('roam.save')).toBe(false);
    expect(new Language('en', null, null).current()).toBe('en');
  });
});
