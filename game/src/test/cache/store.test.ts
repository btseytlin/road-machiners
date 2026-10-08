import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Input } from './fingerprint';
import { entryPath, hasPass, passedFingerprints, recordPass } from './store';

let cache: string;
const inputs: Input[] = [{ path: 'src/a.ts', kind: 'file' }];

beforeEach(() => {
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  cache = mkdtempSync(join(process.cwd(), 'tmp', 'store-'));
});
afterEach(() => rmSync(cache, { recursive: true, force: true }));

describe('cache store', () => {
  it('treats an empty cache as having no passes', () => {
    expect(passedFingerprints(cache, 'src/a.test.ts')).toEqual([]);
    expect(hasPass(cache, 'src/a.test.ts', 'fp')).toBe(false);
  });

  it('treats a cache folder that does not exist yet as empty', () => {
    expect(passedFingerprints(join(cache, 'later'), 'src/a.test.ts')).toEqual([]);
  });

  it('returns the input lists it recorded for a test file only', () => {
    recordPass(cache, 'src/a.test.ts', 'fp1', inputs);
    recordPass(cache, 'src/b.test.ts', 'fp2', [{ path: 'src/b.ts', kind: 'file' }]);
    expect(passedFingerprints(cache, 'src/a.test.ts')).toEqual([inputs]);
    expect(hasPass(cache, 'src/a.test.ts', 'fp1')).toBe(true);
    expect(hasPass(cache, 'src/a.test.ts', 'fp2')).toBe(false);
  });

  it('touches an entry on a hit, so pruning by age keeps it', () => {
    recordPass(cache, 'src/a.test.ts', 'fp1', inputs);
    const file = entryPath(cache, 'src/a.test.ts', 'fp1');
    const old = new Date(Date.now() - 10 * 86_400_000);
    utimesSync(file, old, old);
    hasPass(cache, 'src/a.test.ts', 'fp1');
    expect(statSync(file).mtimeMs).toBeGreaterThan(old.getTime() + 86_400_000);
  });

  it('leaves no temp file behind after a write', () => {
    recordPass(cache, 'src/a.test.ts', 'fp1', inputs);
    expect(readdirSync(join(cache, 'entries', readdirSync(join(cache, 'entries'))[0]!))).toEqual(['fp1.json']);
  });

  it('throws with the entry path when an entry is not JSON', () => {
    recordPass(cache, 'src/a.test.ts', 'fp1', inputs);
    const file = entryPath(cache, 'src/a.test.ts', 'fp1');
    writeFileSync(file, '{not json');
    expect(() => passedFingerprints(cache, 'src/a.test.ts')).toThrow(file);
  });

  it('throws with the entry path when an entry has the wrong shape', () => {
    recordPass(cache, 'src/a.test.ts', 'fp1', inputs);
    const file = entryPath(cache, 'src/a.test.ts', 'fp1');
    writeFileSync(file, JSON.stringify({ inputs: [{ path: 3, kind: 'file' }] }));
    expect(() => passedFingerprints(cache, 'src/a.test.ts')).toThrow(file);
  });
});
