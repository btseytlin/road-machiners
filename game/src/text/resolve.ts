// Turns a Msg into words in one language. It owns the message syntax, a strict ICU subset with plural, case and
// gender, described in docs/architecture/text.md. Resolving never falls back to another language: an unknown key, a
// bad param, or a case or gender that a text does not have throws.
import { EN } from './en';
import { RU } from './ru';
import { CASES, CONCAT, DATE, GENDERS, isNoun, LIST, Msg, NUM, VERBATIM, type Case, type DevLocale, type EnEntry, type Gender, type Locale, type Noun, type NumberKind, type Param, type ParamKind, type Schema } from './msg';

export type Part =
  | { kind: 'lit'; text: string }
  | { kind: 'arg'; name: string; case: Case | null }
  | { kind: 'hash' }
  | { kind: 'plural'; name: string; forms: ReadonlyMap<string, readonly Part[]> }
  | { kind: 'gender'; name: string; forms: ReadonlyMap<Gender, readonly Part[]> };

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
    if (ch === '{') return this.placeholder(inPlural);
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

  placeholder(inPlural: boolean): Part {
    this.expect('{');
    const name = this.word();
    if (this.src[this.pos] === '}') {
      this.pos++;
      return { kind: 'arg', name, case: null };
    }
    this.expect(',');
    const kind = this.word();
    this.expect(',');
    if (kind === 'plural') return { kind: 'plural', name, forms: this.pluralForms() };
    if (kind === 'case') return { kind: 'arg', name, case: this.caseName() };
    if (kind === 'gender') return { kind: 'gender', name, forms: this.genderForms(inPlural) };
    return this.fail('only plural, case and gender are supported');
  }

  caseName(): Case {
    const name = this.word();
    const found = CASES.find((c) => c === name);
    if (!found) this.fail(`bad case "${name}"`);
    this.expect('}');
    return found;
  }

  forms(categories: ReadonlySet<string>, inPlural: boolean): Map<string, readonly Part[]> {
    const forms = new Map<string, readonly Part[]>();
    for (this.skipSpace(); this.src[this.pos] !== '}'; this.skipSpace()) {
      const category = this.word();
      if (!categories.has(category) || forms.has(category)) this.fail(`bad category "${category}"`);
      this.expect('{');
      forms.set(category, this.sequence(inPlural));
      this.expect('}');
    }
    this.expect('}');
    return forms;
  }

  pluralForms(): Map<string, readonly Part[]> {
    const forms = this.forms(CATEGORIES, true);
    if (!forms.has('other')) this.fail('a plural needs an "other" form');
    return forms;
  }

  genderForms(inPlural: boolean): Map<Gender, readonly Part[]> {
    const forms = this.forms(new Set(GENDERS), inPlural) as Map<Gender, readonly Part[]>;
    if (forms.size !== GENDERS.length) this.fail(`a gender needs every form: ${GENDERS.join(', ')}`);
    return forms;
  }
}

export function parse(text: string): Part[] {
  const parser = new Parser(text);
  const parts = parser.sequence(false);
  if (parser.pos < text.length) parser.fail('stray "}"');
  return parts;
}

function eachPart(parts: readonly Part[], visit: (part: Part) => void): void {
  for (const part of parts) {
    visit(part);
    if ('forms' in part) for (const form of part.forms.values()) eachPart(form, visit);
  }
}

export function placeholders(parts: readonly Part[]): Set<string> {
  const names = new Set<string>();
  eachPart(parts, (part) => {
    if ('name' in part) names.add(part.name);
  });
  return names;
}

export function pluralCategories(parts: readonly Part[]): Map<string, Set<string>> {
  const categories = new Map<string, Set<string>>();
  eachPart(parts, (part) => {
    if (part.kind !== 'plural') return;
    const seen = categories.get(part.name) ?? new Set<string>();
    for (const category of part.forms.keys()) seen.add(category);
    categories.set(part.name, seen);
  });
  return categories;
}

export function grammarParams(parts: readonly Part[]): Set<string> {
  const names = new Set<string>();
  eachPart(parts, (part) => {
    if ((part.kind === 'arg' && part.case !== null) || part.kind === 'gender') names.add(part.name);
  });
  return names;
}

type CatalogEntry = EnEntry | Noun;
const CATALOGS: Record<Locale, Readonly<Record<string, CatalogEntry>>> = { en: EN, ru: RU };
const TAGS: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU' };

function entryOf(locale: Locale, key: string): CatalogEntry {
  const entry = CATALOGS[locale][key];
  if (entry === undefined) throw new Error(`No ${locale} text for "${key}"`);
  return entry;
}

export function entryText(locale: Locale, key: string): string {
  const entry = entryOf(locale, key);
  if (typeof entry === 'string') return entry;
  return isNoun(entry) ? entry.forms.nom : entry.text;
}

export function nounOf(locale: Locale, key: string): Noun | null {
  const entry = entryOf(locale, key);
  return isNoun(entry) ? entry : null;
}

export function schemaOf(key: string): Schema {
  const entry = (EN as Readonly<Record<string, EnEntry>>)[key];
  if (entry === undefined) throw new Error(`Unknown text key "${key}"`);
  return typeof entry === 'string' ? {} : entry.schema;
}

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

type Mode = { readonly case: Case; readonly cap: boolean };
const SHOWN: Mode = { case: 'nom', cap: true };

export function resolve(msg: Msg, locale: DevLocale): string {
  if (locale === 'pseudo') return pseudo(render(msg, 'en', SHOWN));
  return render(msg, locale, SHOWN);
}

const INTERNAL: Record<string, (msg: Msg, locale: Locale, mode: Mode) => string> = {
  [VERBATIM]: (msg) => String(msg.params.name),
  [NUM.int]: (msg, locale) => formatNumber(Number(msg.params.n), 'int', locale),
  [NUM.dec]: (msg, locale) => formatNumber(Number(msg.params.n), 'dec', locale),
  [NUM.dec1]: (msg, locale) => formatNumber(Number(msg.params.n), 'dec1', locale),
  [LIST]: (msg, locale, mode) => msg.items.map((item, i) => render(item, locale, i === 0 ? mode : { case: mode.case, cap: false })).join(', '),
  [CONCAT]: (msg, locale) => msg.items.map((item) => render(item, locale, SHOWN)).join(''),
  [DATE]: (msg, locale) => formatsOf(locale).date.format(Number(msg.params.ms)),
};

function render(msg: Msg, locale: Locale, mode: Mode): string {
  const internal = INTERNAL[msg.key];
  if (internal) return internal(msg, locale, mode);
  const entry = entryOf(locale, msg.key);
  if (isNoun(entry)) return renderNoun(msg, entry, locale, mode);
  if (mode.case !== 'nom' && !firstName(msg, locale)) throw new Error(`Text "${msg.key}" has no ${mode.case} form in ${locale}`);
  const values = checkParams(msg, schemaOf(msg.key), locale);
  return renderParts({ msg, values, locale, mode, count: null }, partsOf(locale, msg.key));
}

function renderNoun(msg: Msg, entry: Noun, locale: Locale, mode: Mode): string {
  checkParams(msg, {}, locale);
  const form = entry.forms[mode.case];
  return mode.cap ? form.charAt(0).toUpperCase() + form.slice(1) : form;
}

function firstName(msg: Msg, locale: Locale): Msg | undefined {
  return partsOf(locale, msg.key)
    .map((part) => (part.kind === 'arg' && part.case === null ? msg.params[part.name] : undefined))
    .find((value): value is Msg => Msg.is(value));
}

export function genderOf(msg: Msg, locale: Locale): Gender | null {
  if (msg.key === LIST) return listGender(msg, locale);
  if (msg.key.startsWith('#')) return null;
  const entry = entryOf(locale, msg.key);
  if (isNoun(entry)) return entry.gender;
  const name = firstName(msg, locale);
  return name ? genderOf(name, locale) : null;
}

function listGender(msg: Msg, locale: Locale): Gender | null {
  if (msg.items.length > 1) return 'pl';
  return msg.items.length === 1 ? genderOf(msg.items[0], locale) : null;
}

type Value = string | number | Msg;

function checkParams(msg: Msg, schema: Schema, locale: Locale): Map<string, Value> {
  const values = new Map<string, Value>();
  for (const name of Object.keys(msg.params)) {
    if (!(name in schema)) throw new Error(`Text "${msg.key}" got an extra param "${name}"`);
  }
  for (const [name, kind] of Object.entries(schema)) {
    values.set(name, formatParam(msg, name, kind, locale));
  }
  return values;
}

function formatParam(msg: Msg, name: string, kind: ParamKind, locale: Locale): Value {
  const value: Param | undefined = msg.params[name];
  const formatted = PARAM_FORMATS[kind](value, locale);
  if (formatted === null) throw new Error(`Text "${msg.key}" needs ${kind} param "${name}", got ${String(value)}`);
  return formatted;
}

const isNumber = (value: Param | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

const PARAM_FORMATS: Record<ParamKind, (value: Param | undefined, locale: Locale) => Value | null> = {
  text: (value) => (Msg.is(value) ? value : null),
  name: (value) => (typeof value === 'string' ? value : null),
  count: (value) => (isNumber(value) ? value : null),
  int: (value, locale) => (isNumber(value) ? formatNumber(value, 'int', locale) : null),
  dec: (value, locale) => (isNumber(value) ? formatNumber(value, 'dec', locale) : null),
  dec1: (value, locale) => (isNumber(value) ? formatNumber(value, 'dec1', locale) : null),
};

type Ctx = { readonly msg: Msg; readonly values: Map<string, Value>; readonly locale: Locale; readonly mode: Mode; readonly count: number | null };

function renderParts(ctx: Ctx, parts: readonly Part[]): string {
  return parts.map((part) => renderPart(ctx, part)).join('');
}

function renderPart(ctx: Ctx, part: Part): string {
  if (part.kind === 'lit') return part.text;
  if (part.kind === 'hash') return formatNumber(ctx.count ?? 0, 'int', ctx.locale);
  return renderSlot(ctx, part);
}

function renderSlot(ctx: Ctx, part: Exclude<Part, { kind: 'lit' | 'hash' }>): string {
  if (part.kind === 'plural') return renderPlural(ctx, part);
  if (part.kind === 'gender') return renderGender(ctx, part);
  return renderArg(ctx.values.get(part.name) ?? '', ctx.locale, part.case === null ? ctx.mode : { case: part.case, cap: false });
}

function renderArg(value: Value, locale: Locale, mode: Mode): string {
  if (Msg.is(value)) return render(value, locale, mode);
  return typeof value === 'number' ? formatNumber(value, 'int', locale) : value;
}

function renderPlural(ctx: Ctx, part: Extract<Part, { kind: 'plural' }>): string {
  const value = ctx.values.get(part.name);
  if (typeof value !== 'number') throw new Error(`Plural "${part.name}" must be a count`);
  const category = formatsOf(ctx.locale).plural.select(value);
  const form = part.forms.get(category);
  if (!form) throw new Error(`Plural "${part.name}" has no "${category}" form in ${ctx.locale}`);
  return renderParts({ ...ctx, count: value }, form);
}

function renderGender(ctx: Ctx, part: Extract<Part, { kind: 'gender' }>): string {
  const value = ctx.values.get(part.name);
  if (!Msg.is(value)) throw new Error(`Gender "${part.name}" in "${ctx.msg.key}" must be a text`);
  const gender = genderOf(value, ctx.locale);
  if (gender === null) throw new Error(`Text "${ctx.msg.key}" agrees with {${part.name}}, which has no gender in ${ctx.locale}`);
  return renderParts(ctx, part.forms.get(gender) ?? []);
}

const ACCENTS: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ç', n: 'ñ', s: 'š', z: 'ž',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ç', N: 'Ñ', S: 'Š', Z: 'Ž',
};

export function pseudo(text: string): string {
  const padded = text.replace(/[A-Za-z]+/g, (word) => {
    const accented = [...word].map((ch) => ACCENTS[ch] ?? ch).join('');
    const extra = Math.ceil(word.length * 0.4);
    return accented + accented.repeat(Math.ceil(extra / accented.length)).slice(0, extra);
  });
  return `⟦${padded}⟧`;
}
