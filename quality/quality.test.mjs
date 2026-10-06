import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
let directory;

function runGit(...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
}

function writeSource(content, name = 'game/src/example.ts') {
  writeFileSync(path.join(directory, name), content);
}

function runCheck(mode = '--staged') {
  const args = mode === '--working' ? [] : [mode];
  return spawnSync(process.execPath, ['quality/quality.mjs', ...args], { cwd: directory, encoding: 'utf8' });
}

function assertRejected(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, pattern);
}

beforeEach(() => {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  directory = mkdtempSync(path.join(root, 'tmp/quality-test-'));
  for (const project of ['game', 'factory']) {
    mkdirSync(path.join(directory, project, 'src'), { recursive: true });
    mkdirSync(path.join(directory, project, 'node_modules'));
    writeFileSync(path.join(directory, project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true }, include: ['src'] }));
  }
  writeFileSync(path.join(directory, 'factory/src/example.ts'), 'export const value = 1;\n');
  mkdirSync(path.join(directory, 'quality'));
  mkdirSync(path.join(directory, '.githooks'));
  for (const file of ['quality/quality.mjs', 'quality/quality-policy.mjs', 'quality/install-hooks.mjs', '.githooks/pre-commit', '.oxlintrc.json', '.quality.json', 'package.json']) {
    cpSync(path.join(root, file), path.join(directory, file));
  }
  runGit('init', '-q');
  runGit('config', 'user.email', 'fixture@example.invalid');
  runGit('config', 'user.name', 'Quality fixture');
  writeSource('export const value = 1;\n');
  runGit('add', '.');
  runGit('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

test('accepts valid staged TypeScript and leaves unstaged edits untouched', () => {
  writeSource('export const value = 2;\n');
  runGit('add', 'game');
  writeSource('export const value: number = "unstaged";\n');
  const before = runGit('diff');
  const result = runCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(runGit('diff'), before);
  assert.match(readFileSync(path.join(directory, 'game/src/example.ts'), 'utf8'), /unstaged/);
});

test('checks the working tree without ignoring the temporary HEAD baseline', () => {
  writeSource('export const value = 2;\n');
  const result = runCheck('--working');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects staged type errors hidden by a valid working copy', () => {
  writeSource('export const value: number = "staged";\n');
  runGit('add', 'game');
  writeSource('export const value = 2;\n');
  assertRejected(runCheck(), /not assignable/);
});

test('rejects lint regressions', () => {
  writeSource('export const value: any = 2;\n');
  runGit('add', 'game');
  assertRejected(runCheck(), /no-explicit-any/);
});

test('accepts unchanged lint debt in a changed file', () => {
  writeSource('export const value: any = 1;\n');
  runGit('add', 'game');
  runGit('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'existing debt');
  writeSource('export const value: any = 2;\n');
  runGit('add', 'game');
  const result = runCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects new complexity above the Steelman limit', () => {
  writeSource('export function choose(x: number) {\n' + Array.from({ length: 6 }, (_, i) => `if (x === ${i}) return ${i};`).join('\n') + '\nreturn -1;\n}\n');
  runGit('add', 'game');
  assertRejected(runCheck(), /complexity/);
});

function makeComplexSource(branches) {
  return 'export function choose(x: number) {\n' + Array.from({ length: branches }, (_, i) => `if (x === ${i}) return ${i};`).join('\n') + '\nreturn -1;\n}\n';
}

test('accepts reduced complexity that remains above the ceiling', () => {
  writeSource(makeComplexSource(7));
  runGit('add', 'game');
  runGit('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'existing complexity');
  writeSource(makeComplexSource(6));
  runGit('add', 'game');
  const result = runCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects increased complexity in an already complex function', () => {
  writeSource(makeComplexSource(6));
  runGit('add', 'game');
  runGit('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'existing complexity');
  writeSource(makeComplexSource(7));
  runGit('add', 'game');
  assertRejected(runCheck(), /complexity/);
});

test('rejects renderer imports in the simulation', () => {
  mkdirSync(path.join(directory, 'game/src/sim'));
  writeSource('import { Scene } from "three";\nexport const scene = new Scene();\n', 'game/src/sim/example.ts');
  runGit('add', 'game');
  assertRejected(runCheck(), /no-restricted-imports/);
});

test('rejects inline attempts to suppress lint', () => {
  writeSource('/* eslint-disable */\nexport const value: any = 2;\n');
  runGit('add', 'game');
  assertRejected(runCheck(), /no-suppression/);
});

test('installs the hook and rejects a real commit without changing the index', () => {
  const installed = spawnSync('npm', ['run', 'hooks:install'], { cwd: directory, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  writeSource('export const value: any = 2;\n');
  runGit('add', 'game');
  const before = runGit('write-tree');
  const result = spawnSync('git', ['commit', '-qm', 'must fail'], { cwd: directory, encoding: 'utf8' });
  assertRejected(result, /no-explicit-any/);
  assert.equal(runGit('write-tree'), before);
  writeSource('export const value = 2;\n');
  runGit('add', 'game');
  assert.doesNotThrow(() => runGit('commit', '-qm', 'valid change'));
});

test('refuses to overwrite another hook configuration', () => {
  runGit('config', 'core.hooksPath', 'custom-hooks');
  const result = spawnSync('npm', ['run', 'hooks:install'], { cwd: directory, encoding: 'utf8' });
  assertRejected(result, /Refusing to replace/);
  assert.equal(runGit('config', '--get', 'core.hooksPath').trim(), 'custom-hooks');
});

test('refuses unstaged changes to the tooling used by the hook', () => {
  writeFileSync(path.join(directory, '.quality.json'), '{"maxFilesPerKloc": 999}\n');
  assertRejected(runCheck(), /Stage or restore quality tooling/);
});

test('checks a first commit without HEAD', () => {
  runGit('checkout', '--orphan', 'first-commit');
  writeSource(Array.from({ length: 200 }, (_, i) => `export const value${i} = ${i};`).join('\n'));
  runGit('add', 'game');
  const result = runCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const [name, source, rule] of [
  ['nesting', 'export function choose(x: number) {\n' + 'if (x) {\n'.repeat(5) + 'return x;\n' + '}\n'.repeat(6), /max-depth/],
  ['function length', 'export function choose(x: number) {\n' + 'x++;\n'.repeat(301) + 'return x;\n}', /max-lines-per-function/],
  ['module length', Array.from({ length: 1001 }, (_, i) => `export const value${i} = ${i};`).join('\n'), /max-lines/],
]) {
  test(`rejects new ${name} above the Steelman limit`, () => {
    writeSource(source);
    runGit('add', 'game');
    assertRejected(runCheck(), rule);
  });
}

test('exempts tests from structural limits but still rejects test type errors', () => {
  writeSource(makeComplexSource(8), 'game/src/example.test.ts');
  runGit('add', 'game');
  const result = runCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  writeSource('export const value: number = "wrong";\n', 'game/src/example.test.ts');
  runGit('add', 'game');
  assertRejected(runCheck(), /not assignable/);
});

test('checks JavaScript paths with spaces', () => {
  mkdirSync(path.join(directory, 'quality/space dir'));
  writeSource('export function stop() { debugger; }\n', 'quality/space dir/check.mjs');
  runGit('add', 'quality');
  assertRejected(runCheck(), /no-debugger/);
});

test('handles deleted source files', () => {
  writeSource('export const other = 2;\n', 'game/src/other.ts');
  runGit('rm', 'game/src/example.ts');
  runGit('add', 'game');
  const result = runCheck();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects a staged middle dot in any text file but skips vendored skills and an unstaged copy', () => {
  const dot = String.fromCharCode(0xb7);
  writeSource(`Speed ${dot} 40%\n`, 'game/notes.md');
  mkdirSync(path.join(directory, 'game/.claude'));
  writeSource(`a ${dot} b\n`, 'game/.claude/skill.md');
  runGit('add', 'game');
  assertRejected(runCheck(), /game\/notes\.md:1: middle dot separator/);
  assert.doesNotMatch(runCheck().stderr, /skill\.md/);
  writeSource('Speed, 40%\n', 'game/notes.md');
  assertRejected(runCheck(), /game\/notes\.md:1/);
  runGit('add', 'game');
  assert.equal(runCheck().status, 0);
  writeSource(`Speed ${dot} 40%\n`, 'game/notes.md');
  assertRejected(runCheck('--working'), /game\/notes\.md:1/);
});

test('rejects staged type errors in the factory project', () => {
  writeSource('export const value: number = "wrong";\n', 'factory/src/example.ts');
  runGit('add', 'factory');
  assertRejected(runCheck(), /not assignable/);
});
