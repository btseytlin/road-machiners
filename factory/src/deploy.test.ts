import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAndDeploy, deployDev, rebuildDev, recordBuild, removeStaleBuilds } from './deploy';
import { readPublished } from './sourcemaps';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx } from './types';

function setup(): { ctx: Ctx; clone: string; webRoot: string; shells: string[][] } {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(join('tmp', 'factory-deploy-'));
  const clone = join(root, 'clone');
  const webRoot = join(root, 'web');
  mkdirSync(join(clone, 'game', 'dist'), { recursive: true });
  writeFileSync(join(clone, 'game', 'dist', 'index.html'), 'new');
  writeFileSync(join(clone, 'game', 'dist', 'index.js.map'), '{}');
  const shells: string[][] = [];
  const container = { agent: async () => {}, shell: async (c: string, s: string, l: string, e?: Record<string, string>) => { shells.push([c, s, l, JSON.stringify(e)]); } };
  const ctx = { cfg: { webRoot, publicUrl: 'http://x/play' }, container } as unknown as Ctx;
  return { ctx, clone, webRoot, shells };
}

describe('buildAndDeploy', () => {
  it('rejects a bad scope before building', async () => {
    const { ctx, clone, shells } = setup();
    await expect(buildAndDeploy(ctx, clone, '../evil', '/l')).rejects.toThrow('bad deploy scope');
    expect(shells).toHaveLength(0);
  });

  it('builds with the scope and replaces the old deploy', async () => {
    const { ctx, clone, webRoot, shells } = setup();
    mkdirSync(join(webRoot, 'dev'), { recursive: true });
    writeFileSync(join(webRoot, 'dev', 'old.html'), 'old');
    const url = await buildAndDeploy(ctx, clone, 'dev', '/l');
    expect(url).toBe('http://x/play/dev/');
    expect(shells[0]).toEqual([clone, 'npm ci && npm run build', '/l', '{"SAVE_SCOPE":"dev"}']);
    expect(readFileSync(join(webRoot, 'dev', 'index.html'), 'utf8')).toBe('new');
    expect(existsSync(join(webRoot, 'dev', 'old.html'))).toBe(false);
    expect(existsSync(join(webRoot, '.dev.new'))).toBe(false);
  });

  it('never publishes source maps, also for a card preview that sends no reports', async () => {
    const { ctx, clone, webRoot } = setup();
    await buildAndDeploy(ctx, clone, 'abc1234', '/l');
    expect(existsSync(join(webRoot, 'abc1234', 'index.html'))).toBe(true);
    expect(existsSync(join(webRoot, 'abc1234', 'index.js.map'))).toBe(false);
  });
});

describe('removeStaleBuilds', () => {
  it('removes folders not kept, spares dev and files, and logs each', () => {
    const { webRoot } = setup();
    for (const name of ['dev', 'keep1', 'gone1', 'gone2']) mkdirSync(join(webRoot, name), { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), 'x');
    const logs: string[] = [];
    const removed = removeStaleBuilds(webRoot, new Set(['keep1']), (m) => logs.push(m));
    expect(removed.sort()).toEqual(['gone1', 'gone2']);
    expect(logs).toHaveLength(2);
    expect(['dev', 'keep1', 'gone1', 'index.html'].map((n) => existsSync(join(webRoot, n)))).toEqual([true, true, false, true]);
  });

  it('keeps the reserved concepts folder and its files while removing stale builds', () => {
    const { webRoot } = setup();
    mkdirSync(join(webRoot, 'concepts'), { recursive: true });
    mkdirSync(join(webRoot, 'stale'), { recursive: true });
    writeFileSync(join(webRoot, 'concepts', 'a.png'), 'img');
    const removed = removeStaleBuilds(webRoot, new Set(), () => undefined);
    expect(removed).toEqual(['stale']);
    expect(readFileSync(join(webRoot, 'concepts', 'a.png'), 'utf8')).toBe('img');
  });

  it('does nothing when the web root does not exist yet', () => {
    expect(removeStaleBuilds(join('tmp', 'factory-no-such-web'), new Set(), () => undefined)).toEqual([]);
  });
});

describe('deployDev', () => {
  const SHA = 'abc1234'.padEnd(40, '0');

  function devSetup(buildFails: boolean): { ctx: Ctx; statePath: string; home: string; envs: Record<string, string>[] } {
    const { ctx, webRoot } = setup();
    const home = join(webRoot, '..');
    const statePath = join(home, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), devFailed: 'old1234', devError: 'old error' });
    const repo = {
      prepareWorkClone: async (_branch: string, _base: string, dir: string) => {
        mkdirSync(join(dir, 'game', 'dist'), { recursive: true });
        writeFileSync(join(dir, 'game', 'dist', 'index.html'), 'dev');
        writeFileSync(join(dir, 'game', 'dist', 'index.js.map'), '{}');
      },
      headHash: async () => 'abc1234',
    };
    const envs: Record<string, string>[] = [];
    const container = { agent: async () => {}, shell: async (_c: string, _s: string, _l: string, env: Record<string, string>) => { envs.push(env); if (buildFails) throw new Error('build broke'); } };
    const run = async () => ({ code: 0, stdout: `${SHA}\n`, stderr: '' });
    const now = () => new Date('2026-10-07T12:00:00Z');
    return { ctx: { ...ctx, cfg: { ...ctx.cfg, home, errorMapDays: 14 }, repo, container, run, now, statePath } as unknown as Ctx, statePath, home, envs };
  }

  it('publishes /dev/ and records the dev commit it serves', async () => {
    const { ctx, statePath } = devSetup(false);
    expect(await deployDev(ctx, '/l')).toBe('http://x/play/dev/');
    expect(readState(statePath)).toMatchObject({ devBuild: 'abc1234', devFailed: null, devError: null });
  });

  it('builds /dev/ with error reports on and keeps its maps on the host, not in the web root', async () => {
    const { ctx, home, envs } = devSetup(false);
    await deployDev(ctx, '/l');
    expect(envs).toEqual([{ SAVE_SCOPE: 'dev', ERROR_REPORT_URL: 'http://x/errors', ERROR_REPORT_BUILD: 'dev' }]);
    expect(existsSync(join(home, 'sourcemaps', SHA, 'index.js.map'))).toBe(true);
    expect(existsSync(join(home, 'web', 'dev', 'index.js.map'))).toBe(false);
    expect(readPublished(home)).toEqual([{ sha: SHA, kind: 'dev', publishedAt: '2026-10-07T12:00:00.000Z' }]);
  });

  it('builds /dev/ with error reports on and keeps its maps on the host, not in the web root', async () => {
    const { ctx, home, envs } = devSetup(false);
    await deployDev(ctx, '/l');
    expect(envs).toEqual([{ SAVE_SCOPE: 'dev', ERROR_REPORT_URL: 'http://x/errors', ERROR_REPORT_BUILD: 'dev' }]);
    expect(existsSync(join(home, 'sourcemaps', SHA, 'index.js.map'))).toBe(true);
    expect(existsSync(join(home, 'web', 'dev', 'index.js.map'))).toBe(false);
    expect(readPublished(home)).toEqual([{ sha: SHA, kind: 'dev', publishedAt: '2026-10-07T12:00:00.000Z' }]);
  });

  it('posts the dev link to the committee after a rebuild', async () => {
    const { ctx } = devSetup(false);
    const sent: string[] = [];
    const telegram = { sendMessage: async (chat: string, text: string) => { sent.push(`${chat}: ${text}`); return 1; } };
    await rebuildDev({ ...ctx, cfg: { ...ctx.cfg, committeeChat: 'c' }, telegram } as Ctx, '/l');
    expect(sent).toEqual(['c: Dev is rebuilt at abc1234.\nPlay it: http://x/play/dev/']);
  });

  it('records a failed dev commit and throws', async () => {
    const { ctx, statePath } = devSetup(true);
    await expect(deployDev(ctx, '/l')).rejects.toThrow('build broke');
    expect(readState(statePath)).toMatchObject({ devBuild: null, devFailed: 'abc1234', devError: 'build broke' });
  });
});

describe('recordBuild', () => {
  it('stores the folder name under the issue number', () => {
    const { webRoot } = setup();
    const statePath = join(webRoot, '..', 'state.json');
    writeState(statePath, structuredClone(EMPTY_STATE));
    recordBuild(statePath, 7, 'abc1234');
    expect(readState(statePath).builds).toEqual({ '7': 'abc1234' });
  });
});
