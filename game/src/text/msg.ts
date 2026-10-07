// A Msg is player text that is not resolved yet: a catalog key and its params. It turns into words only where it is
// shown, in the active language. See docs/architecture/text.md.
import type { EN } from './en';

export type Locale = 'en' | 'ru';
// pseudo is a dev-only locale that pads English to find layouts that break on longer text.
export type DevLocale = Locale | 'pseudo';
export const LOCALES: readonly Locale[] = ['en', 'ru'];

// int: a grouped integer. dec: at most one decimal, like 2 or 1.5. dec1: always one decimal. count: an integer that
// picks plural forms. text: a nested Msg. name: a proper name shown as it is.
export type ParamKind = 'int' | 'dec' | 'dec1' | 'count' | 'text' | 'name';
export type NumberKind = 'int' | 'dec' | 'dec1';
export type Schema = Readonly<Record<string, ParamKind>>;
// An English entry with params. An English entry without params is a plain string.
export type Entry<S extends Schema = Schema> = { readonly text: string; readonly schema: S };
export type EnEntry = string | Entry;

export function m<const S extends Schema>(text: string, schema: S): Entry<S> {
  return { text, schema };
}

export type Param = number | string | Msg;

// Only src/text/ builds a Msg directly. Everything else calls t(), verbatim(), num() or list().
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

// Keys that need no params.
export type PlainKey = { [K in Key]: Catalog[K] extends Entry ? never : K }[Key];

export function t<K extends Key>(key: K, ...params: ParamArgs<K>): Msg {
  return new Msg(key, params[0] ?? {});
}

// Internal keys. They start with '#', which no catalog key does.
export const VERBATIM = '#verbatim';
export const NUM = { int: '#int', dec: '#dec', dec1: '#dec1' } as const;
export const LIST = '#list';
export const CONCAT = '#concat';
export const DATE = '#date';

// A proper name, like a driver's name, shown as it is in every language. Never call it with a literal.
export function verbatim(name: string): Msg {
  return new Msg(VERBATIM, { name });
}

// A number shown on its own, formatted for the active language.
export function num(n: number, kind: NumberKind): Msg {
  return new Msg(NUM[kind], { n });
}

// A moment of real time, like when a save was written, formatted for the active language. ms: epoch milliseconds.
export function date(ms: number): Msg {
  return new Msg(DATE, { ms });
}

// Items joined into one comma list, like "Fuel tank, Grill".
export function list(items: readonly Msg[]): Msg {
  return new Msg(LIST, {}, items);
}

// Pieces shown one after another, like the colored spans of one log line. Each piece is a whole message of its own.
export function concat(items: readonly Msg[]): Msg {
  return new Msg(CONCAT, {}, items);
}

// Whether two messages say the same thing, so a view that redraws every frame can skip an unchanged one.
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

// A message whose key is built from a data id, like `part.${id}`. Only src/text/names.ts calls it, and the coverage
// test checks that every data id has its key in both languages.
export function byId(key: string, params: Readonly<Record<string, Param>> = {}): Msg {
  return new Msg(key, params);
}

// A translation gives a string for every key of an English area, with the same params.
export type Translation<T> = { readonly [K in keyof T]: string };
