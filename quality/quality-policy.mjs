import { parseSync } from 'oxc-parser';

const testPattern = /(?:^|\/)(?:tests?|[^/]+\.(?:test|spec)\.[^/]+)(?:\/|$)/;

export function inspectSource(file, source) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors.map(error => error.message).join('\n')}`);
  const suppressions = parsed.comments.filter(comment => /(?:eslint|oxlint)-(?:disable|enable)|@ts-(?:ignore|nocheck)/.test(comment.value));
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

export function checkComments(file, source, maxDocstringLines) {
  if (!Number.isInteger(maxDocstringLines) || maxDocstringLines <= 0) throw new Error('maxDocstringLines must be a positive integer.');
  const parsed = parseSync(file, source);
  const codeStart = parsed.program.body[0]?.start ?? source.length;
  const findings = parsed.comments.filter(comment => comment.end > codeStart && !isJsType(file, comment))
    .map(comment => ({ filename: file, code: 'quality/no-comment', message: comment.value.trim() }));
  if (docstringLines(source, parsed.comments.filter(comment => comment.end <= codeStart)) > maxDocstringLines) {
    findings.push({ filename: file, code: 'quality/long-docstring', message: `module docstring over ${maxDocstringLines} lines` });
  }
  return findings;
}

export function isJsType(file, comment) {
  return /\.[cm]?jsx?$/.test(file) && comment.type === 'Block' && /^\*\s*@(?:type|typedef|param|returns?|template|satisfies|import|callback|property|overload)\b/.test(comment.value);
}

function docstringLines(source, header) {
  if (!header.length) return 0;
  return source.slice(header[0].start, header.at(-1).end).split('\n').length;
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

export const SEPARATOR = String.fromCharCode(0xb7);

export function checkSeparators(texts) {
  return [...texts].flatMap(([file, text]) => text.split('\n').flatMap((line, index) => {
    if (!line.includes(SEPARATOR)) return [];
    return [`${file}:${index + 1}: middle dot separator. Use a comma or a colon.`];
  }));
}
