import { parseSync } from 'oxc-parser';

const testPattern = /(?:^|\/)(?:tests?|[^/]+\.(?:test|spec)\.[^/]+)(?:\/|$)/;

export function inspectSource(file, source) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors.map(error => error.message).join('\n')}`);
  const suppressions = parsed.comments.filter(isSuppression);
  const findings = suppressions.map(comment => ({ filename: file, code: 'quality/no-suppression', message: comment.value.trim() }));
  const characters = source.split('');
  for (const comment of parsed.comments) {
    for (let index = comment.start; index < comment.end; index++) {
      if (characters[index] !== '\n') characters[index] = ' ';
    }
  }
  const lines = characters.join('').split('\n').filter(line => line.trim()).length;
  return { findings, lines };
}

export function checkComments(file, source) {
  const parsed = parseSync(file, source);
  return parsed.comments.filter(comment => !isJsType(file, comment))
    .map(comment => ({ filename: file, code: 'quality/no-comment', message: comment.value.trim() }));
}

export function stripComments(file, source) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors.map(error => error.message).join('\n')}`);
  let result = source;
  for (const comment of parsed.comments.filter(comment => !isJsType(file, comment) && !isSuppression(comment)).reverse()) {
    result = removeSpan(result, comment.start, comment.end);
  }
  return result;
}

function removeSpan(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd);
  if (!before.trim() && !after.trim()) return text.slice(0, lineStart) + text.slice(Math.min(lineEnd + 1, text.length));
  if (!before.trim()) return text.slice(0, start) + text.slice(end).replace(/^[ \t]+/, '');
  return text.slice(0, start).replace(/[ \t]+$/, '') + joinGap(before, after) + text.slice(end).replace(/^[ \t]+(?=\n|$)/, '');
}

function joinGap(before, after) {
  return /\w$/.test(before) && /^\w/.test(after) ? ' ' : '';
}

function isSuppression(comment) {
  return /(?:eslint|oxlint)-(?:disable|enable)|@ts-(?:ignore|nocheck)/.test(comment.value);
}

export function isJsType(file, comment) {
  return /\.[cm]?jsx?$/.test(file) && comment.type === 'Block' && /^\*\s*@(?:type|typedef|param|returns?|template|satisfies|import|callback|property|overload)\b/.test(comment.value);
}

export function collectComponents(sources) {
  const components = new Map();
  const production = [...sources].filter(([file]) => file.startsWith('game/src/') && !testPattern.test(file));
  for (const [file, source] of production) {
    const { lines } = inspectSource(file, source);
    if (!lines) continue;
    const parts = file.split('/');
    const name = parts.length > 3 ? `game/src/${parts[2]}` : 'game/src';
    const component = components.get(name) ?? { files: 0, lines: 0 };
    component.files++;
    component.lines += lines;
    components.set(name, component);
  }
  return components;
}

export function isGuidance(file) {
  const name = file.split('/').pop();
  return /^(?:claude|agents)\.md$/i.test(name) || name === 'DESIGN.md';
}

export function checkGuidance(docs, limit) {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('maxGuidanceWords must be positive.');
  return [...docs].flatMap(([file, text]) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < limit) return [];
    return [`${file}: ${words} words, the limit is under ${limit}. Move details to docs/.`];
  });
}

export const SEPARATOR = String.fromCharCode(0xb7);

export function checkSeparators(texts) {
  return [...texts].flatMap(([file, text]) => text.split('\n').flatMap((line, index) => {
    if (!line.includes(SEPARATOR)) return [];
    return [`${file}:${index + 1}: middle dot separator. Use a comma or a colon.`];
  }));
}

export function checkFragmentation(current, previous, limit) {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('maxFilesPerKloc must be positive.');
  return [...collectComponents(current)].flatMap(([name, component]) => {
    const before = previous.get(name) ?? { files: 0, lines: 1 };
    if (component.files <= before.files) return [];
    const ratio = component.files * 1000 / component.lines;
    const ceiling = Math.max(limit, before.files * 1000 / before.lines);
    if (ratio <= ceiling) return [];
    return [`${name}: fragmentation ${ratio.toFixed(2)} files/1,000 code lines exceeds ${ceiling.toFixed(2)}. Keep related behavior together.`];
  });
}
