import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprint, type Input } from './fingerprint';
import { inputsOf, recordRun, selectTests, type RunResult } from './select';
import { hasPass, passedFingerprints } from './store';

let root: string;
let cache: string;

function put(rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

beforeEach(() => {
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  root = mkdtempSync(join(process.cwd(), 'tmp', 'select-'));
  cache = join(root, 'cache');
  put('src/a.test.ts', 'test a');
  put('src/a.ts', 'import a');
  put('data/one.txt', '1');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const abs = (rel: string) => join(root, rel);
const result = (over: Partial<RunResult> = {}): RunResult => ({
  test: 'src/a.test.ts',
  passed: true,
  graphFiles: [abs('src/a.test.ts'), abs('src/a.ts')],
  reads: [abs('data'), abs('data/one.txt'), abs('maybe.txt')],
  ...over,
});
const select = (key = 'k', tests = ['src/a.test.ts']) => selectTests(root, cache, key, tests);

describe('inputsOf', () => {
  it('joins imports and reads into sorted repo-relative inputs with their kinds', () => {
    expect(inputsOf(root, 'src/a.test.ts', result().graphFiles, result().reads)).toEqual([
      { path: 'data', kind: 'dir' },
      { path: 'data/one.txt', kind: 'file' },
      { path: 'maybe.txt', kind: 'missing' },
      { path: 'src/a.test.ts', kind: 'file' },
      { path: 'src/a.ts', kind: 'file' },
    ]);
  });

  it('lists a path once when it is both imported and read', () => {
    const list = inputsOf(root, 'src/a.test.ts', [abs('src/a.ts')], [abs('src/a.ts')]);
    expect(list?.filter((input) => input.path === 'src/a.ts')).toHaveLength(1);
  });

  it('drops node_modules paths', () => {
    put('node_modules/pkg/index.js', 'x');
    const list = inputsOf(root, 'src/a.test.ts', [abs('node_modules/pkg/index.js'), abs('src/a.ts')], []);
    expect(list?.map((input) => input.path)).toEqual(['src/a.test.ts', 'src/a.ts']);
  });

  it('returns null when the test read a path outside the repo', () => {
    expect(inputsOf(root, 'src/a.test.ts', [abs('src/a.ts')], [join(root, '..', 'elsewhere.txt')])).toBeNull();
  });
});

describe('selectTests', () => {
  const record = () => recordRun(root, cache, 'k', [result()]);

  it('runs everything when the cache is empty', () => {
    expect(select()).toEqual({ run: ['src/a.test.ts'], skipped: [] });
  });

  it('skips a test file whose inputs are unchanged since a pass', () => {
    record();
    expect(select()).toEqual({ run: [], skipped: ['src/a.test.ts'] });
  });

  it('runs a test file when an import changed', () => {
    record();
    put('src/a.ts', 'import a changed');
    expect(select().run).toEqual(['src/a.test.ts']);
  });

  it('runs a test file when a file it read changed', () => {
    record();
    put('data/one.txt', 'changed');
    expect(select().run).toEqual(['src/a.test.ts']);
  });

  it('runs a test file when a file is added to a folder it read', () => {
    record();
    put('data/two.txt', '2');
    expect(select().run).toEqual(['src/a.test.ts']);
  });

  it('runs a test file when a missing path it probed appears', () => {
    record();
    put('maybe.txt', 'here');
    expect(select().run).toEqual(['src/a.test.ts']);
  });

  it('runs a test file when the global key changed', () => {
    record();
    expect(select('other').run).toEqual(['src/a.test.ts']);
  });

  it('skips again after the changed inputs pass once, and keeps the old pass', () => {
    record();
    put('src/a.ts', 'import a changed');
    recordRun(root, cache, 'k', [result()]);
    expect(select().skipped).toEqual(['src/a.test.ts']);
    put('src/a.ts', 'import a');
    expect(select().skipped).toEqual(['src/a.test.ts']);
  });

  it('splits several test files', () => {
    put('src/b.test.ts', 'test b');
    record();
    expect(select('k', ['src/a.test.ts', 'src/b.test.ts'])).toEqual({ run: ['src/b.test.ts'], skipped: ['src/a.test.ts'] });
  });
});

describe('recordRun', () => {
  it('records a pass entry for a passed test file', () => {
    recordRun(root, cache, 'k', [result()]);
    const inputs: Input[] = passedFingerprints(cache, 'src/a.test.ts')[0]!;
    expect(hasPass(cache, 'src/a.test.ts', fingerprint(root, 'k', inputs))).toBe(true);
  });

  it('never records a failed test file', () => {
    expect(recordRun(root, cache, 'k', [result({ passed: false })])).toBe(0);
    expect(passedFingerprints(cache, 'src/a.test.ts')).toEqual([]);
  });

  it('never records a test file that read outside the repo, and counts it', () => {
    const count = recordRun(root, cache, 'k', [result({ reads: [join(root, '..', 'elsewhere.txt')] })]);
    expect(count).toBe(1);
    expect(passedFingerprints(cache, 'src/a.test.ts')).toEqual([]);
    expect(select().run).toEqual(['src/a.test.ts']);
  });

  it('counts an uncacheable test file even when it failed', () => {
    expect(recordRun(root, cache, 'k', [result({ passed: false, reads: [join(root, '..', 'x')] })])).toBe(1);
  });
});
