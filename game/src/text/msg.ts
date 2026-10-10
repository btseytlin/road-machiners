// A Msg is player text that is not resolved yet: a catalog key and its params. It turns into words only where it is
// shown, in the active language. See docs/architecture/text.md.
import type { EN } from './en';

export type Locale = 'en' | 'ru';
export type DevLocale = Locale | 'pseudo';
export const LOCALES: readonly Locale[] = ['en', 'ru'];

export type ParamKind = 'int' | 'dec' | 'dec1' | 'count' | 'text' | 'name';
export type NumberKind = 'int' | 'dec' | 'dec1';
export type Schema = Readonly<Record<string, ParamKind>>;
export type Entry<S extends Schema = Schema> = { readonly text: string; readonly schema: S };
export type EnEntry = string | Entry;

export function m<const S extends Schema>(text: string, schema: S): Entry<S> {
  return { text, schema };
}

export type Param = number | string | Msg;

export class Msg {
  readonly #brand = true;
  constructor(
    readonly key: string,
    readonly params: Readonly<Record<string, Param>>,
    readonly items: readonly Msg[] = [],
  ) {}

  static is(x: unknown): x is Msg {
    return x instanceof Msg && x.#brand;
  }
}

type Catalog = typeof EN;
export type Key = keyof Catalog & string;
type ValueOf<K extends ParamKind> = K extends 'text' ? Msg : K extends 'name' ? string : number;
export type ParamsOf<K extends Key> = Catalog[K] extends Entry<infer S>
  ? { readonly [P in keyof S]: ValueOf<S[P]> }
  : Record<never, never>;
type ParamArgs<K extends Key> = Catalog[K] extends Entry ? [ParamsOf<K>] : [];

export type PlainKey = { [K in Key]: Catalog[K] extends Entry ? never : K }[Key];

export function t<K extends Key>(key: K, ...params: ParamArgs<K>): Msg {
  return new Msg(key, params[0] ?? {});
}

export const VERBATIM = '#verbatim';
export const NUM = { int: '#int', dec: '#dec', dec1: '#dec1' } as const;
export const LIST = '#list';
export const CONCAT = '#concat';
export const DATE = '#date';

export function verbatim(name: string): Msg {
  return new Msg(VERBATIM, { name });
}

export const SPACE: Msg = verbatim(' ');
export const PLUS: Msg = verbatim('+');
export const MINUS_SIGN: Msg = verbatim('\u2212');
export const DASH: Msg = verbatim('–');

export function num(n: number, kind: NumberKind): Msg {
  return new Msg(NUM[kind], { n });
}

export function date(ms: number): Msg {
  return new Msg(DATE, { ms });
}

export function list(items: readonly Msg[]): Msg {
  return new Msg(LIST, {}, items);
}

export function concat(items: readonly Msg[]): Msg {
  return new Msg(CONCAT, {}, items);
}

export function sameMsg(a: Msg, b: Msg): boolean {
  if (a === b) return true;
  if (a.key !== b.key || a.items.length !== b.items.length) return false;
  if (!a.items.every((item, i) => sameMsg(item, b.items[i]))) return false;
  return sameParams(a.params, b.params);
}

function sameParams(a: Readonly<Record<string, Param>>, b: Readonly<Record<string, Param>>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => sameParam(a[k], b[k]));
}

function sameParam(a: Param | undefined, b: Param | undefined): boolean {
  if (Msg.is(a) && Msg.is(b)) return sameMsg(a, b);
  return a === b;
}

export function byId(key: string, params: Readonly<Record<string, Param>> = {}): Msg {
  return new Msg(key, params);
}

export type Case = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'prep';
export const CASES: readonly Case[] = ['nom', 'gen', 'dat', 'acc', 'ins', 'prep'];
export type PlaceCase = 'at' | 'to' | 'from';
export const PLACE_CASES: readonly PlaceCase[] = ['at', 'to', 'from'];
export type Ask = Case | PlaceCase;
export const ASKS: readonly Ask[] = [...CASES, ...PLACE_CASES];
export type Gender = 'm' | 'f' | 'n' | 'pl';
export const GENDERS: readonly Gender[] = ['m', 'f', 'n', 'pl'];

export type Noun = { readonly forms: Readonly<Record<Case, string>>; readonly gender: Gender; readonly place?: Readonly<Record<PlaceCase, string>> };

export function noun(gender: Gender, nom: string, gen: string, dat: string, acc: string, ins: string, prep: string): Noun {
  return { forms: { nom, gen, dat, acc, ins, prep }, gender };
}

export function place(name: Noun, at: string, to: string, from: string): Noun {
  return { ...name, place: { at, to, from } };
}

export const isPlaceCase = (ask: Ask): ask is PlaceCase => (PLACE_CASES as readonly string[]).includes(ask);

export function isNoun(entry: unknown): entry is Noun {
  return typeof entry === 'object' && entry !== null && 'forms' in entry;
}

export type Translation<T> = { readonly [K in keyof T]: string | Noun };
