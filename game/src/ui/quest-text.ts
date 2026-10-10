// Quest line markup and reveal. Inline markup is <name>text</name> or <name=value>text</name>, line tags are
// `# key:value`. A new effect is one entry in MARKS or LINE_TAGS plus its CSS in style.css.

import { CONFIG } from '../config';
import { QUEST_ART } from '../data/quest-art';
import { verbatim } from '../text/msg';
import { el } from './dom';

export type Mark = { name: string; value: string | null };
export type Span = { text: string; marks: Mark[] };
export type Reveal = 'all' | 'word' | 'char';
export type Speed = 'slow' | 'normal' | 'fast';
export type LineStyle = { reveal: Reveal; speed: Speed; img: string | null; speaker: string | null; place: string | null; flags: string[] };
export type Unit = { text: string; marks: Mark[]; delayMs: number };

type MarkDef = { values: readonly string[] | null };
type TagDef = { kind: 'value'; values: readonly string[] | null } | { kind: 'art' } | { kind: 'flag' };

export const QUEST_COLORS = ['rust', 'sand', 'blood', 'sky', 'ash'] as const;
export const ROW_CELL = ';';

export const MARKS: Record<string, MarkDef> = {
  b: { values: null },
  i: { values: null },
  shake: { values: null },
  pop: { values: null },
  color: { values: QUEST_COLORS },
};

const REVEALS: readonly Reveal[] = ['all', 'word', 'char'];
const SPEEDS: Record<Speed, number> = { slow: 2, normal: 1, fast: 0.5 };

export const LINE_TAGS: Record<string, TagDef> = {
  reveal: { kind: 'value', values: REVEALS },
  speed: { kind: 'value', values: Object.keys(SPEEDS) },
  img: { kind: 'art' },
  speaker: { kind: 'value', values: null },
  place: { kind: 'value', values: null },
  work_offer: { kind: 'flag' },
  page: { kind: 'flag' },
  row: { kind: 'flag' },
  head: { kind: 'flag' },
};

export const PLAIN_STYLE: LineStyle = { reveal: 'word', speed: 'normal', img: null, speaker: null, place: null, flags: [] };

const TAG = /<(\/?)([a-z_]+)(?:=([a-z0-9_-]+))?>/g;

export function parseMarkup(text: string): Span[] {
  const spans: Span[] = [];
  const open: Mark[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    spans.push({ text: text.slice(last, m.index), marks: [...open] });
    if (m[1]) closeMark(open, m[2], text);
    else open.push(openMark(m[2], m[3] ?? null, text));
    last = m.index + m[0].length;
  }
  spans.push({ text: text.slice(last), marks: [...open] });
  if (open.length > 0) throw new Error(`Markup <${open[open.length - 1].name}> is never closed in "${text}"`);
  return spans.filter((s) => s.text !== '');
}

export function plainText(text: string): string {
  return parseMarkup(text).map((s) => s.text).join('');
}

function openMark(name: string, value: string | null, text: string): Mark {
  const def = MARKS[name];
  if (!def) throw new Error(`Unknown markup <${name}> in "${text}". Known: ${Object.keys(MARKS).join(', ')}`);
  if (def.values === null) {
    if (value !== null) throw new Error(`Markup <${name}> takes no value in "${text}"`);
  } else if (!fitsValues(value, def.values)) throw new Error(`Markup <${name}=${value ?? ''}> needs one of ${def.values.join(', ')} in "${text}"`);
  return { name, value };
}

function fitsValues(value: string | null, values: readonly string[]): boolean {
  return value !== null && values.includes(value);
}

function closeMark(open: Mark[], name: string, text: string): void {
  const top = open.pop();
  if (top?.name !== name) throw new Error(`Markup </${name}> closes ${top ? `<${top.name}>` : 'nothing'} in "${text}"`);
}

export function lineStyle(tags: readonly string[]): LineStyle {
  return tags.reduce<LineStyle>((style, tag) => withTag(style, tag), { ...PLAIN_STYLE, flags: [] });
}

function withTag(style: LineStyle, tag: string): LineStyle {
  const [key, ...rest] = tag.split(':');
  const value = rest.join(':').trim();
  const def = LINE_TAGS[key.trim()];
  if (!def) throw new Error(`Unknown line tag # ${tag}. Known: ${Object.keys(LINE_TAGS).join(', ')}`);
  if (def.kind === 'flag') return { ...style, flags: [...style.flags, key.trim()] };
  checkTagValue(tag, value, def.kind === 'art' ? Object.keys(QUEST_ART) : def.values);
  return { ...style, [key.trim()]: value };
}

function checkTagValue(tag: string, value: string, allowed: readonly string[] | null): void {
  if (allowed !== null && !allowed.includes(value)) throw new Error(`Line tag # ${tag} needs one of ${allowed.join(', ') || 'nothing yet'}`);
}

export function markupProblems(text: string, tags: readonly string[]): string[] {
  return [() => parseMarkup(text), () => lineStyle(tags)].flatMap((check) => {
    try {
      check();
      return [];
    } catch (err) {
      return [err instanceof Error ? err.message : String(err)];
    }
  });
}

export function rowCells(text: string): string[] {
  return text.split(ROW_CELL).map((cell) => cell.trim());
}

export function revealUnits(spans: readonly Span[], style: LineStyle, startMs: number): Unit[] {
  const step = style.reveal === 'char' ? CONFIG.questCharMs : CONFIG.questWordMs;
  const units = spans.flatMap((span) => splitUnits(span.text, style.reveal).map((text) => ({ text, marks: span.marks })));
  return units.map((unit, k) => ({ ...unit, delayMs: style.reveal === 'all' ? startMs : startMs + k * step * SPEEDS[style.speed] }));
}

function splitUnits(text: string, reveal: Reveal): string[] {
  if (reveal === 'all') return [text];
  if (reveal === 'char') return [...text];
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function renderLine(text: string, tags: readonly string[], startMs: number): { el: HTMLElement; endMs: number } {
  const style = lineStyle(tags);
  const units = revealUnits(parseMarkup(text), style, startMs);
  const line = el('div', { class: `qt-line qt-reveal-${style.reveal}` });
  for (const unit of units) line.append(unitElement(unit));
  const endMs = units.length > 0 ? units[units.length - 1].delayMs + CONFIG.questWordMs : startMs;
  return { el: line, endMs };
}

function unitElement(unit: Unit): HTMLElement {
  const classes = ['qt-unit', ...unit.marks.map((m) => (m.value === null ? `qt-${m.name}` : `qt-${m.name}-${m.value}`))];
  return el('span', { class: classes.join(' '), style: `animation-delay: ${unit.delayMs}ms` }, verbatim(unit.text));
}
