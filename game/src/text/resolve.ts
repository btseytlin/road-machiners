// Turns a Msg into words in one language. It owns the message syntax, a strict ICU subset: {name} and
// {name, plural, one {...} other {...}}, where # stands for the formatted count. A literal brace is not allowed.
// Resolving never falls back to another language: an unknown key or a missing, extra or mistyped param throws.
import { EN } from './en';
import { RU } from './ru';
import { CONCAT, DATE, LIST, Msg, NUM, VERBATIM, type DevLocale, type EnEntry, type Locale, type NumberKind, type Param, type ParamKind, type Schema } from './msg';

export type Part =
  | { kind: 'lit'; text: string }
  | { kind: 'arg'; name: string }
  | { kind: 'hash' }
  | { kind: 'plural'; name: string; forms: ReadonlyMap<string, readonly Part[]> };

const CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  fail(why: string): never {
    throw new Error(`Bad message "${this.src}" at ${this.pos}: ${why}`);
  }

  sequence(inPlural: boolean): Part[] {
    const parts: Part[] = [];
    for (let ch = this.src[this.pos]; ch !== undefined && ch !== '}'; ch = this.src[this.pos]) {
      parts.push(this.part(ch, inPlural));
    }
    return parts;
  }

  part(ch: string, inPlural: boolean): Part {
    if (ch === '{') return this.placeholder();
    if (ch === '#' && inPlural) {
      this.pos++;
      return { kind: 'hash' };
    }
    const stop = inPlural ? /[{}#]/ : /[{}]/;
    const rest = this.src.slice(this.pos);
    const end = rest.search(stop);
    const text = end < 0 ? rest : rest.slice(0, end);
    this.pos += text.length;
    return { kind: 'lit', text };
  }

  word(): string {
    this.skipSpace();
    const found = /^[A-Za-z0-9_]+/.exec(this.src.slice(this.pos));
    if (!found) this.fail('expected a name');
    this.pos += found[0].length;
    this.skipSpace();
    return found[0];
  }

  skipSpace(): void {
    while (this.src[this.pos] === ' ') this.pos++;
  }

  expect(ch: string): void {
    if (this.src[this.pos] !== ch) this.fail(`expected "${ch}"`);
    this.pos++;
  }

  placeholder(): Part {
    this.expect('{');
    const name = this.word();
    if (this.src[this.pos] === '}') {
      this.pos++;
      return { kind: 'arg', name };
    }
    this.expect(',');
    if (this.word() !== 'plural') this.fail('only plural is supported');
    this.expect(',');
    return { kind: 'plural', name, forms: this.forms() };
  }

  forms(): Map<string, readonly Part[]> {
    const forms = new Map<string, readonly Part[]>();
    for (this.skipSpace(); this.src[this.pos] !== '}'; this.skipSpace()) {
      const category = this.word();
      if (!CATEGORIES.has(category) || forms.has(category)) this.fail(`bad plural category "${category}"`);
      this.expect('{');
      forms.set(category, this.sequence(true));
      this.expect('}');
    }
    this.expect('}');
    if (!forms.has('other')) this.fail('a plural needs an "other" form');
    return forms;
  }
}

export function parse(text: string): Part[] {
  const parser = new Parser(text);
  const parts = parser.sequence(false);
  if (parser.pos < text.length) parser.fail('stray "}"');
  return parts;
}

// Every param name the message uses.
export function placeholders(parts: readonly Part[], into = new Set<string>()): Set<string> {
  for (const part of parts) {
    if (part.kind === 'arg') into.add(part.name);
    if (part.kind !== 'plural') continue;
    into.add(part.name);
    for (const form of part.forms.values()) placeholders(form, into);
  }
  return into;
}

// The plural categories each plural param uses.
export function pluralCategories(parts: readonly Part[], into = new Map<string, Set<string>>()): Map<string, Set<string>> {
  for (const part of parts) {
    if (part.kind !== 'plural') continue;
    const seen = into.get(part.name) ?? new Set<string>();
    for (const [category, form] of part.forms) {
      seen.add(category);
      pluralCategories(form, into);
    }
    into.set(part.name, seen);
  }
  return into;
}

const CATALOGS: Record<Locale, Readonly<Record<string, EnEntry>>> = { en: EN, ru: RU };
const TAGS: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU' };

export function entryText(locale: Locale, key: string): string {
  const entry = CATALOGS[locale][key];
  if (entry === undefined) throw new Error(`No ${locale} text for "${key}"`);
  return typeof entry === 'string' ? entry : entry.text;
}

export function schemaOf(key: string): Schema {
  const entry = (EN as Readonly<Record<string, EnEntry>>)[key];
  if (entry === undefined) throw new Error(`Unknown text key "${key}"`);
  return typeof entry === 'string' ? {} : entry.schema;
}

// Parsed messages by `${locale}:${key}`, so resolving in a render loop does not parse again.
const parsed = new Map<string, readonly Part[]>();

function partsOf(locale: Locale, key: string): readonly Part[] {
  const id = `${locale}:${key}`;
  const hit = parsed.get(id);
  if (hit) return hit;
  const parts = parse(entryText(locale, key));
  const schema = schemaOf(key);
  for (const name of placeholders(parts)) {
    if (!(name in schema)) throw new Error(`Text "${key}" in ${locale} uses unknown {${name}}`);
  }
  parsed.set(id, parts);
  return parts;
}

type Formats = { [K in NumberKind]: Intl.NumberFormat } & { plural: Intl.PluralRules; date: Intl.DateTimeFormat };
const formats = new Map<Locale, Formats>();

function formatsOf(locale: Locale): Formats {
  const hit = formats.get(locale);
  if (hit) return hit;
  const tag = TAGS[locale];
  const made = {
    int: new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }),
    dec: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
    dec1: new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    plural: new Intl.PluralRules(tag),
    date: new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short' }),
  };
  formats.set(locale, made);
  return made;
}

export function formatNumber(n: number, kind: NumberKind, locale: Locale): string {
  return formatsOf(locale)[kind].format(n);
}

export function resolve(msg: Msg, locale: DevLocale): string {
  if (locale === 'pseudo') return pseudo(render(msg, 'en'));
  return render(msg, locale);
}

// Messages with an internal key: names, numbers and joined pieces.
const INTERNAL: Record<string, (msg: Msg, locale: Locale) => string> = {
  [VERBATIM]: (msg) => String(msg.params.name),
  [NUM.int]: (msg, locale) => formatNumber(Number(msg.params.n), 'int', locale),
  [NUM.dec]: (msg, locale) => formatNumber(Number(msg.params.n), 'dec', locale),
  [NUM.dec1]: (msg, locale) => formatNumber(Number(msg.params.n), 'dec1', locale),
  [LIST]: (msg, locale) => msg.items.map((item) => render(item, locale)).join(', '),
  [CONCAT]: (msg, locale) => msg.items.map((item) => render(item, locale)).join(''),
  [DATE]: (msg, locale) => formatsOf(locale).date.format(Number(msg.params.ms)),
};

function render(msg: Msg, locale: Locale): string {
  const internal = INTERNAL[msg.key];
  if (internal) return internal(msg, locale);
  const parts = partsOf(locale, msg.key);
  const values = checkParams(msg, schemaOf(msg.key), locale);
  return renderParts(parts, values, locale, null);
}

function checkParams(msg: Msg, schema: Schema, locale: Locale): Map<string, string | number> {
  const values = new Map<string, string | number>();
  for (const name of Object.keys(msg.params)) {
    if (!(name in schema)) throw new Error(`Text "${msg.key}" got an extra param "${name}"`);
  }
  for (const [name, kind] of Object.entries(schema)) {
    values.set(name, formatParam(msg, name, kind, locale));
  }
  return values;
}

// A count keeps its number, so a plural can pick its form. Every other param is formatted to its words here.
function formatParam(msg: Msg, name: string, kind: ParamKind, locale: Locale): string | number {
  const value: Param | undefined = msg.params[name];
  const formatted = PARAM_FORMATS[kind](value, locale);
  if (formatted === null) throw new Error(`Text "${msg.key}" needs ${kind} param "${name}", got ${String(value)}`);
  return formatted;
}

const isNumber = (value: Param | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

// Each param kind's words, or null for a value of the wrong type.
const PARAM_FORMATS: Record<ParamKind, (value: Param | undefined, locale: Locale) => string | number | null> = {
  text: (value, locale) => (Msg.is(value) ? render(value, locale) : null),
  name: (value) => (typeof value === 'string' ? value : null),
  count: (value) => (isNumber(value) ? value : null),
  int: (value, locale) => (isNumber(value) ? formatNumber(value, 'int', locale) : null),
  dec: (value, locale) => (isNumber(value) ? formatNumber(value, 'dec', locale) : null),
  dec1: (value, locale) => (isNumber(value) ? formatNumber(value, 'dec1', locale) : null),
};

function renderParts(parts: readonly Part[], values: Map<string, string | number>, locale: Locale, count: number | null): string {
  return parts.map((part) => renderPart(part, values, locale, count)).join('');
}

function renderPart(part: Part, values: Map<string, string | number>, locale: Locale, count: number | null): string {
  if (part.kind === 'lit') return part.text;
  if (part.kind === 'hash') return formatNumber(count ?? 0, 'int', locale);
  if (part.kind === 'plural') return renderPlural(part, values, locale);
  return renderArg(values.get(part.name) ?? '', locale);
}

// A count shown on its own is a grouped integer. Every other param is words already.
function renderArg(value: string | number, locale: Locale): string {
  return typeof value === 'number' ? formatNumber(value, 'int', locale) : value;
}

function renderPlural(part: Extract<Part, { kind: 'plural' }>, values: Map<string, string | number>, locale: Locale): string {
  const value = values.get(part.name);
  if (typeof value !== 'number') throw new Error(`Plural param "${part.name}" must be a count`);
  const category = formatsOf(locale).plural.select(value);
  const form = part.forms.get(category);
  if (!form) throw new Error(`Plural "${part.name}" has no "${category}" form in ${locale}`);
  return renderParts(form, values, locale, value);
}

const ACCENTS: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ç', n: 'ñ', s: 'š', z: 'ž',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ç', N: 'Ñ', S: 'Š', Z: 'Ž',
};

// Pads every word by 40% with accented letters, inside ⟦⟧ marks, so a layout check sees text longer than English.
export function pseudo(text: string): string {
  const padded = text.replace(/[A-Za-z]+/g, (word) => {
    const accented = [...word].map((ch) => ACCENTS[ch] ?? ch).join('');
    const extra = Math.ceil(word.length * 0.4);
    return accented + accented.repeat(Math.ceil(extra / accented.length)).slice(0, extra);
  });
  return `⟦${padded}⟧`;
}
