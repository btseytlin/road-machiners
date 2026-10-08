import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprint, globalKey, type Input } from './fingerprint';

let root: string;

function put(rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

beforeEach(() => {
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  root = mkdtempSync(join(process.cwd(), 'tmp', 'fingerprint-'));
  put('package-lock.json', 'lock');
  put('vitest.config.ts', 'config');
  put('scripts/test-cache.mjs', 'runner');
  put('src/test/helper.ts', 'helper');
  put('src/test/helper.test.ts', 'a test');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('globalKey', () => {
  const key = (define: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}) => globalKey(root, define, env);

  it('stays the same when nothing changed', () => {
    expect(key()).toBe(key());
  });

  it('changes with the lockfile, the config, the runner and a non-test file under src/test', () => {
    const before = key();
    put('package-lock.json', 'lock 2');
    const afterLock = key();
    put('vitest.config.ts', 'config 2');
    const afterConfig = key();
    put('scripts/test-cache.mjs', 'runner 2');
    const afterRunner = key();
    put('src/test/helper.ts', 'helper 2');
    const afterHelper = key();
    expect(new Set([before, afterLock, afterConfig, afterRunner, afterHelper]).size).toBe(5);
  });

  it('ignores test files under src/test', () => {
    const before = key();
    put('src/test/helper.test.ts', 'another test');
    expect(key()).toBe(before);
  });

  it('changes with a define value and the TEST_TIMEOUTS value', () => {
    expect(key({ __X__: '1' })).not.toBe(key({ __X__: '2' }));
    expect(key({}, { TEST_TIMEOUTS: 'off' })).not.toBe(key({}, {}));
  });

  it('ignores the game version, which changes with every commit', () => {
    expect(key({ __GAME_VERSION__: '"1+abc"' })).toBe(key({ __GAME_VERSION__: '"1+def"' }));
  });
});

describe('fingerprint', () => {
  const inputs: Input[] = [
    { path: 'src/a.ts', kind: 'file' },
    { path: 'data', kind: 'dir' },
    { path: 'maybe.txt', kind: 'missing' },
  ];
  const fp = (key = 'k') => fingerprint(root, key, inputs);

  beforeEach(() => {
    put('src/a.ts', 'a');
    put('data/one.txt', '1');
  });

  it('stays the same when nothing changed', () => {
    expect(fp()).toBe(fp());
  });

  it('changes when an imported file changes', () => {
    const before = fp();
    put('src/a.ts', 'a2');
    expect(fp()).not.toBe(before);
  });

  it('changes when a file is added to a folder it listed', () => {
    const before = fp();
    put('data/two.txt', '2');
    expect(fp()).not.toBe(before);
  });

  it('ignores a change inside a file of a listed folder', () => {
    const before = fp();
    put('data/one.txt', 'changed');
    expect(fp()).toBe(before);
  });

  it('changes when a missing path appears', () => {
    const before = fp();
    put('maybe.txt', 'now here');
    expect(fp()).not.toBe(before);
  });

  it('changes with the global key', () => {
    expect(fp('k1')).not.toBe(fp('k2'));
  });
});
