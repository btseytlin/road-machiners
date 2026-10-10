// The blocking check against hard-coded player text. It parses every production file of the game's code and fails on
// text that skips the catalog: prose literals, text sinks, Cyrillic outside the Russian catalog, and Msg forgeries.
// A deliberate exception goes in src/text/untranslated.ts with its reason. See docs/architecture/text.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { UNTRANSLATED } from './untranslated';

type Node = { type: string; start: number; end: number; [key: string]: unknown };
export type Finding = { file: string; line: number; rule: string; text: string };

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['src/ui', 'src/three', 'src/sim', 'src/data', 'src/render', 'src/text'];

// Two words of letters with a space between, or a capitalized word: the shape of something a player reads.
const PROSE = /[A-Za-z]{2,}[ ]+[A-Za-z]{2,}|\b[A-Z][a-z]{2,}\b/;
const CYRILLIC = /[Ѐ-ӿ]/;
// Shapes of strings a program reads that the prose test would mistake for words: class lists, markup, shader and style
// source, and keyboard codes.
const CODE_SHAPES = [/^[a-z0-9 -]*-[a-z0-9 -]*$/, /^\s*</, /;\s*\n|\n.*;/, /#(include|define|undef)\b|\b(varying|uniform) \w+ \w+;/, /\b\d+px\b/, /^(Key[A-Z]|Digit|Arrow[A-Z])/];
const TEXT_SINK_PROPS = new Set(['textContent', 'innerText', 'title']);
const TEXT_ATTRS = new Set(['title', 'aria-label', 'aria-valuetext', 'placeholder', 'alt']);
const DIALOGS = new Set(['alert', 'confirm', 'prompt']);
// Calls whose string arguments are names a program reads, never words a player reads.
const CODE_CALLS = new Set([
  'panel', 'querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById', 'createElement', 'createElementNS', 'addEventListener',
  'removeEventListener', 'getItem', 'setItem', 'removeItem', 'add', 'remove', 'toggle', 'contains', 'setProperty', 'runKey', 'getAttribute',
  'hasAttribute', 'removeAttribute', 'mark', 'measure', 'dispatchEvent', 'postMessage', 'fetch', 'getContext', 'require',
]);
// Object keys whose values are names a program reads.
const CODE_KEYS = new Set(['class', 'className', 'id', 'role', 'type', 'style', 'href', 'target', 'rel', 'kind', 'key', 'code', 'tabindex', 'for']);

function isNode(x: unknown): x is Node {
  return typeof x === 'object' && x !== null && typeof (x as Node).type === 'string';
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === 'parent') continue;
    if (Array.isArray(v)) out.push(...v.filter(isNode));
    else if (isNode(v)) out.push(v);
  }
  return out;
}

function calleeName(call: Node): string | null {
  const callee = call.callee as Node;
  if (callee.type === 'Identifier') return callee.name as string;
  if (callee.type === 'MemberExpression' && (callee.property as Node).type === 'Identifier') return (callee.property as Node).name as string;
  return null;
}

function isErrorCall(node: Node): boolean {
  if (node.type !== 'NewExpression' && node.type !== 'CallExpression') return false;
  const callee = node.callee as Node;
  if (callee.type === 'Identifier') return /Error$/.test(callee.name as string);
  return callee.type === 'MemberExpression' && ((callee.object as Node).name === 'console');
}

function propName(prop: Node): string | null {
  const key = prop.key as Node;
  if (key.type === 'Identifier') return key.name as string;
  if (key.type === 'Literal') return String(key.value);
  return null;
}

// Containers a literal flows through on its way to where it is used.
const TRANSPARENT = new Set(['ConditionalExpression', 'LogicalExpression', 'TemplateLiteral', 'ArrayExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression', 'BinaryExpression']);
const COMPARISONS = new Set(['===', '!==', '==', '!=', 'in']);

// Whether a literal at the end of this ancestor chain is code, not text: a type, an import, an error, an object key,
// a comparison, a style, or an argument a program reads.
function isCodeContext(chain: Node[]): boolean {
  for (let i = chain.length - 2; i >= 0; i--) {
    const parent = chain[i];
    if (codeParent(parent, chain[i + 1])) return true;
    if (!TRANSPARENT.has(parent.type)) return false;
  }
  return false;
}

function codeParent(parent: Node, child: Node): boolean {
  if (parent.type.startsWith('TS') && !TRANSPARENT.has(parent.type)) return true;
  if (parent.type === 'ImportDeclaration' || parent.type === 'ImportExpression' || parent.type === 'ExportAllDeclaration') return true;
  if (parent.type === 'ExportNamedDeclaration' && parent.source === child) return true;
  if (isErrorCall(parent)) return true;
  if (parent.type === 'CallExpression' && (parent.callee as Node).type === 'Super') return true;
  if (parent.type === 'Property') return parent.key === child || isCodeKey(propName(parent));
  if (parent.type === 'BinaryExpression') return COMPARISONS.has(parent.operator as string);
  if (parent.type === 'SwitchCase') return parent.test === child;
  if (parent.type === 'CallExpression') return CODE_CALLS.has(calleeName(parent) ?? '');
  if (parent.type === 'MemberExpression') return parent.property === child;
  return parent.type === 'AssignmentExpression' && isStyleTarget(parent.left as Node);
}

function isCodeKey(name: string | null): boolean {
  return name !== null && (CODE_KEYS.has(name) || name.startsWith('data-'));
}

// A style, a class name or the cssText of an element.
function isStyleTarget(left: Node): boolean {
  if (left.type !== 'MemberExpression') return false;
  const prop = (left.property as Node).name;
  const object = left.object as Node;
  return prop === 'cssText' || prop === 'className' || (object.type === 'MemberExpression' && (object.property as Node).name === 'style');
}

function isProse(text: string): boolean {
  return PROSE.test(text) && !CODE_SHAPES.some((shape) => shape.test(text));
}

function literalText(node: Node): string | null {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return (node.quasis as Node[]).map((q) => (q.value as { cooked: string }).cooked).join(' ');
  return null;
}

function sinkFindings(node: Node, report: (rule: string, at: Node, text: string) => void): void {
  if (node.type === 'AssignmentExpression') {
    const left = node.left as Node;
    const prop = left.type === 'MemberExpression' ? ((left.property as Node).name as string) : null;
    if (prop && TEXT_SINK_PROPS.has(prop)) report('text sink', node, `.${prop} =`);
    if (prop === 'innerHTML') report('innerHTML', node, '.innerHTML =');
  }
  if (node.type !== 'CallExpression') return;
  const name = calleeName(node);
  const args = node.arguments as Node[];
  if (name === 'insertAdjacentText') report('text sink', node, 'insertAdjacentText');
  if (name === 'setAttribute' && args[0]?.type === 'Literal' && TEXT_ATTRS.has(String(args[0].value))) report('text sink', node, `setAttribute('${String(args[0].value)}')`);
  if (name && DIALOGS.has(name) && args.length > 0 && !(args[0].type === 'CallExpression' && calleeName(args[0]) === 'say')) report('text sink', node, `${name}()`);
}

function forgeryFindings(node: Node, report: (rule: string, at: Node, text: string) => void): void {
  if (node.type === 'TSAsExpression' && (node.typeAnnotation as Node).type === 'TSTypeReference' && ((node.typeAnnotation as Node).typeName as Node).name === 'Msg') report('Msg forgery', node, 'as Msg');
  if (node.type === 'NewExpression' && (node.callee as Node).name === 'Msg') report('Msg forgery', node, 'new Msg');
  if (node.type === 'CallExpression' && calleeName(node) === 'verbatim') {
    const arg = (node.arguments as Node[])[0];
    if (arg && (arg.type === 'Literal' || (arg.type === 'TemplateLiteral' && (arg.expressions as Node[]).length === 0))) report('verbatim literal', node, literalText(arg) ?? '');
  }
}

// Every finding in one source file. inText: the file is part of src/text/, which may build messages and write text.
export function scanSource(file: string, source: string): Finding[] {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) throw new Error(`${file}: ${parsed.errors.map((e) => e.message).join('; ')}`);
  const lineOf = (pos: number) => source.slice(0, pos).split('\n').length;
  const findings: Finding[] = [];
  const report = (rule: string, at: Node, text: string) => findings.push({ file, line: lineOf(at.start), rule, text });
  const inText = file.startsWith('src/text/');
  const inRu = file.startsWith('src/text/ru/');
  const walk = (chain: Node[]): void => {
    const node = chain[chain.length - 1];
    const text = literalText(node);
    if (text !== null && CYRILLIC.test(text) && !inRu) report('Cyrillic', node, text);
    if (text !== null && !inText && isProse(text) && !isCodeContext(chain)) report('prose literal', node, text);
    if (!inText) sinkFindings(node, report);
    if (!inText) forgeryFindings(node, report);
    for (const child of children(node)) walk([...chain, child]);
  };
  walk([parsed.program as unknown as Node]);
  return findings;
}

function productionFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function allowed(f: Finding): boolean {
  return UNTRANSLATED.some((a) => a.file === f.file && (a.text === '*' || a.text === f.text));
}

describe('the hard-coded text scan', () => {
  // The allowlist names the text it lets through, so it is not scanned itself.
  const files = SCANNED.flatMap(productionFiles).map((f) => relative(ROOT, join(ROOT, f)).replaceAll('\\', '/')).filter((f) => f !== 'src/text/untranslated.ts');
  const findings = files.flatMap((file) => scanSource(file, readFileSync(join(ROOT, file), 'utf8')));

  it('finds no player text outside the catalog', () => {
    const open = findings.filter((f) => !allowed(f)).map((f) => `${f.file}:${f.line} ${f.rule}: ${JSON.stringify(f.text)}`);
    expect(open).toEqual([]);
  });

  it('has a reason for every allowlist entry and no unused entry', () => {
    for (const a of UNTRANSLATED) expect(a.reason.length, `${a.file}: ${a.text}`).toBeGreaterThan(10);
    const unused = UNTRANSLATED.filter((a) => !findings.some((f) => f.file === a.file && (a.text === '*' || a.text === f.text)));
    expect(unused.map((a) => `${a.file}: ${a.text}`)).toEqual([]);
  });
});

describe('each scan rule catches its own case', () => {
  const rules = (source: string, file = 'src/ui/fixture.ts') => scanSource(file, source).map((f) => f.rule);

  it('flags prose literals and keeps code strings', () => {
    expect(rules("el('div', {}, 'Hold fire now');")).toEqual(['prose literal']);
    expect(rules("const label = 'Save';")).toEqual(['prose literal']);
    expect(rules("import x from './Some Module';\nthrow new Error('Bad thing happened');\nconsole.log('Some debug line');")).toEqual([]);
    expect(rules("el('div', { class: 'Big panel', 'data-x': 'Other thing' });\nif (e.code === 'KeyQ') run();\ntype T = 'Moving' | 'Firing';")).toEqual([]);
  });

  it('flags text sinks', () => {
    expect(rules("node.textContent = x;\nnode.title = y;\nnode.setAttribute('aria-label', z);\nwindow.confirm(q);")).toEqual(['text sink', 'text sink', 'text sink', 'text sink']);
    expect(rules('window.confirm(say(msg));')).toEqual([]);
    expect(rules('node.innerHTML = svg;')).toEqual(['innerHTML']);
  });

  it('flags Cyrillic outside the Russian catalog', () => {
    expect(rules("const a = 'привет';")).toContain('Cyrillic');
    expect(rules("export const X = { 'a.b': 'привет' };", 'src/text/ru/fixture.ts')).toEqual([]);
  });

  it('flags Msg forgeries outside src/text/', () => {
    expect(rules("const m = x as Msg;\nconst n = new Msg('k', {});\nverbatim('ray');")).toEqual(['Msg forgery', 'Msg forgery', 'verbatim literal']);
    expect(rules('verbatim(driver);')).toEqual([]);
  });
});
