import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEPARATOR, checkFragmentation, checkGuidance, checkSeparators, collectComponents, inspectSource, isGuidance } from './quality-policy.mjs';

function makeSource(lines) {
  return Array.from({ length: lines }, (_, index) => `export const value${index} = ${index};`).join('\n');
}

test('counts code lines but excludes comments, blank lines and tests', () => {
  const sources = new Map([
    ['game/src/sim/rule.ts', '// Heading\n\n/* two\nlines */\nexport const value = 1; // Inline\n'],
    ['game/src/sim/rule.test.ts', makeSource(10)],
    ['game/src/sim/empty.ts', '// Empty\n'],
  ]);
  assert.deepEqual(collectComponents(sources).get('game/src/sim'), { files: 1, lines: 1 });
});

test('rejects a new tiny component', () => {
  const failures = checkFragmentation(new Map([['game/src/new/rule.ts', makeSource(10)]]), new Map(), 5);
  assert.match(failures.join('\n'), /game\/src\/new: fragmentation/);
});

test('accepts a new component at the original five-files-per-kloc ceiling', () => {
  assert.deepEqual(checkFragmentation(new Map([['game/src/new/rule.ts', makeSource(200)]]), new Map(), 5), []);
});

test('does not block existing components unless their file count grows', () => {
  const old = collectComponents(new Map([['game/src/sim/rule.ts', makeSource(10)]]));
  assert.deepEqual(checkFragmentation(new Map([['game/src/sim/rule.ts', makeSource(1)]]), old, 5), []);
});

test('rejects worse fragmentation and accepts improved legacy fragmentation', () => {
  const old = collectComponents(new Map([['game/src/sim/rule.ts', makeSource(10)]]));
  const worse = new Map([['game/src/sim/rule.ts', makeSource(10)], ['game/src/sim/new.ts', makeSource(1)]]);
  assert.equal(checkFragmentation(worse, old, 5).length, 1);
  worse.set('game/src/sim/new.ts', makeSource(20));
  assert.deepEqual(checkFragmentation(worse, old, 5), []);
});

test('finds suppression comments but not strings that quote them', () => {
  const source = 'export const text = "eslint-disable";\n/* oxlint-disable */\n// @ts-nocheck\n';
  assert.equal(inspectSource('game/src/example.ts', source).findings.length, 2);
});

test('rejects invalid syntax and invalid policy limits', () => {
  assert.throws(() => inspectSource('game/src/example.ts', 'const = ;'), /game\/src\/example.ts/);
  assert.throws(() => checkFragmentation(new Map(), new Map(), 0), /must be positive/);
  assert.throws(() => checkGuidance(new Map(), undefined), /must be positive/);
});

test('limits agent guidance files to fewer words than the ceiling', () => {
  const docs = new Map([['CLAUDE.md', 'a b\n c'], ['game/agents.md', 'word '.repeat(3)]]);
  assert.deepEqual(checkGuidance(docs, 4), []);
  assert.match(checkGuidance(docs, 3).join('\n'), /^CLAUDE\.md: 3 words[\s\S]*game\/agents\.md: 3 words/);
});

test('matches agent files in any case and DESIGN.md exactly, in any folder', () => {
  const names = ['CLAUDE.md', 'factory/claude.md', 'game/AGENTS.md', 'game/docs/DESIGN.md', 'game/docs/CLAUDE.md.bak', 'game/MYCLAUDE.md', 'game/docs/VISUAL_DESIGN.md', 'factory/prompts/design.md'];
  assert.deepEqual(names.filter(isGuidance), names.slice(0, 4));
});

test('names each line with the middle dot separator', () => {
  const texts = new Map([['game/src/hud.ts', `ok\nCab ${SEPARATOR} 40%\nfine`], ['README.md', 'Cab: 40%']]);
  assert.deepEqual(checkSeparators(texts), ['game/src/hud.ts:2: middle dot separator. Use a comma or a colon.']);
});
