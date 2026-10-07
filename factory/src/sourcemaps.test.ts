import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorUrl, readPublished, takeMaps, type ReportBuild } from './sourcemaps';
import type { Ctx } from './types';

const sha = (n: number) => String(n).padStart(40, 'a');

function setup(): { home: string; build: (n: number, kind: ReportBuild, at: string) => Promise<void> } {
  mkdirSync('tmp', { recursive: true });
  const home = mkdtempSync(join('tmp', 'factory-maps-'));
  const build = async (n: number, kind: ReportBuild, at: string) => {
    const clone = join(home, 'work', `clone-${n}`);
    mkdirSync(join(clone, 'game', 'dist', 'assets'), { recursive: true });
    writeFileSync(join(clone, 'game', 'dist', 'assets', 'index.js.map'), `{"n":${n}}`);
    writeFileSync(join(clone, 'game', 'dist', 'assets', 'index.js'), 'code');
    const ctx = { cfg: { home, errorMapDays: 14 }, now: () => new Date(at), run: async () => ({ code: 0, stdout: `${sha(n)}\n`, stderr: '' }) } as unknown as Ctx;
    await takeMaps(ctx, clone, kind);
  };
  return { home, build };
}

describe('takeMaps', () => {
  it('moves the maps under the commit, leaves the code and records the publish', async () => {
    const { home, build } = setup();
    await build(1, 'candidate', '2026-10-01T00:00:00Z');
    expect(existsSync(join(home, 'sourcemaps', sha(1), 'assets', 'index.js.map'))).toBe(true);
    expect(existsSync(join(home, 'work', 'clone-1', 'game', 'dist', 'assets', 'index.js.map'))).toBe(false);
    expect(existsSync(join(home, 'work', 'clone-1', 'game', 'dist', 'assets', 'index.js'))).toBe(true);
    expect(readPublished(home)).toEqual([{ sha: sha(1), kind: 'candidate', publishedAt: '2026-10-01T00:00:00.000Z' }]);
  });

  it('drops old dev and candidate maps at the next publish but keeps every release', async () => {
    const { home, build } = setup();
    await build(1, 'dev', '2026-09-01T00:00:00Z');
    await build(2, 'release', '2026-09-01T00:00:00Z');
    await build(3, 'dev', '2026-09-20T00:00:00Z');
    await build(4, 'dev', '2026-10-01T00:00:00Z');
    expect(readPublished(home).map((entry) => entry.sha)).toEqual([sha(2), sha(3), sha(4)]);
    expect([1, 2, 3, 4].map((n) => existsSync(join(home, 'sourcemaps', sha(n))))).toEqual([false, true, true, true]);
  });

  it('keeps the maps of a dev commit that later shipped as a release', async () => {
    const { home, build } = setup();
    await build(1, 'dev', '2026-09-01T00:00:00Z');
    await build(1, 'release', '2026-09-02T00:00:00Z');
    await build(5, 'dev', '2026-10-01T00:00:00Z');
    expect(existsSync(join(home, 'sourcemaps', sha(1)))).toBe(true);
    expect(readPublished(home).map((entry) => `${entry.sha.slice(-1)} ${entry.kind}`)).toEqual(['1 dev', '1 release', '5 dev']);
  });

  it('fails a reporting build with no maps, since its reports could not be read', async () => {
    const home = mkdtempSync(join('tmp', 'factory-maps-'));
    mkdirSync(join(home, 'clone', 'game', 'dist'), { recursive: true });
    const ctx = { cfg: { home, errorMapDays: 14 }, now: () => new Date(), run: async () => ({ code: 0, stdout: sha(1), stderr: '' }) } as unknown as Ctx;
    await expect(takeMaps(ctx, join(home, 'clone'), 'dev')).rejects.toThrow('has no source maps');
  });
});

describe('errorUrl', () => {
  it('puts the endpoint at the root of the play site', () => {
    expect(errorUrl('https://roam.example/play')).toBe('https://roam.example/errors');
  });
});
