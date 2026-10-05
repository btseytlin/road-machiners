import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EMPTY_STATE, writeState } from '../state';
import { buildOperations, selectReleaseFeatures, PublicGitHub, SnapshotCollector } from './snapshot';
import { HostSampler, type HostLoad } from './host';
import type { DashboardConfig } from './config';
import type { FactoryState, Run } from '../types';

it('publishes only explicit operational fields, never private state or raw errors', () => {
  const state: FactoryState = { ...structuredClone(EMPTY_STATE),
    jobs: [{ id: 'private-job-id', stage: 'change', issue: 3, pid: 123, log: '/PRIVATE/log', startedAt: '2026-01-01T00:00:00Z' }],
    pendingChanges: [{ id: 3, text: 'PRIVATE request', by: 'PRIVATE user' }], lastTickError: 'PRIVATE error',
    postCaptions: { '1': 'PRIVATE caption' },
  };
  const result = buildOperations(state, false, { triageWorkers: 1, designWorkers: 2, implementWorkers: 2, verifyWorkers: 2, testWorkers: 2, publicUrl: 'https://example.org' });
  expect(result.status).toBe('blocked');
  expect(result.jobs).toEqual([{ stage: 'change', issue: null, startedAt: '2026-01-01T00:00:00Z', queue: 'branch' }]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(JSON.stringify(result)).not.toContain('private-job-id');
  expect(result.queues.branch).toEqual({ busy: 1, total: 1 });
});

it('only publishes a candidate link while the current candidate is valid', () => {
  const state: FactoryState = { ...structuredClone(EMPTY_STATE), release: { issue: 3, branch: 'release/day', day: '2026-01-01', postId: null, removed: [] }, builds: { '3': 'rc' } };
  const config = { triageWorkers: 1, designWorkers: 2, implementWorkers: 2, verifyWorkers: 2, testWorkers: 2, publicUrl: 'https://example.org' };
  expect(buildOperations(state, false, config).candidateUrl).toBeNull();
  state.release!.postId = 10;
  expect(buildOperations(state, false, config).candidateUrl).toBe('https://example.org/rc/');
});

function createConfig(home: string): DashboardConfig {
  return { home, repo: 'owner/game', projectOwner: 'owner', projectNumber: 1, publicUrl: 'https://example.org', playUrl: 'https://owner.itch.io/game', channelUrl: 'https://t.me/roam_public', socket: null, port: 8787, refreshMs: 2000, githubRefreshMs: 60000, commandTimeoutMs: 15000, triageWorkers: 1, designWorkers: 2, implementWorkers: 2, verifyWorkers: 2, testWorkers: 2 };
}
class FixtureGithub extends PublicGitHub {
  failed = false;
  override async read(state: FactoryState) {
    if (this.failed) throw new Error('PRIVATE credential failure');
    return { cards: [], features: [], releaseKey: JSON.stringify({ branch: state.release?.branch ?? 'dev', removed: [] }), provisional: state.release === null };
  }
}
class FixtureHost extends HostSampler {
  override async sample(): Promise<HostLoad> {
    const reading = { value: null, at: null, status: 'unavailable' as const, error: 'Unavailable' };
    return { cpu: reading, ram: reading, gpu: reading, ssd: reading };
  }
}
it('retains the last good snapshot with stale markers when its sources fail', async () => {
  mkdirSync('tmp', { recursive: true });
  const home = mkdtempSync(resolve('tmp/snapshot-'));
  try {
    mkdirSync(join(home, 'state'));
    const path = join(home, 'state', 'state.json');
    writeState(path, structuredClone(EMPTY_STATE));
    const config = createConfig(home);
    const github = new FixtureGithub(config, async () => { throw new Error('No network'); });
    const collector = new SnapshotCollector(config, github, new FixtureHost(home, 100));
    await collector.refreshLocal();
    await collector.refreshGithub();
    const good = collector.getSnapshot();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    expect(collector.getSnapshot().operations.status).toBe('stale');
    vi.useRealTimers();
    writeFileSync(path, 'corrupt PRIVATE');
    github.failed = true;
    await collector.refreshLocal();
    await collector.refreshGithub();
    const stale = collector.getSnapshot();
    expect(stale.operations.status).toBe('stale');
    expect(stale.operations.value).toEqual(good.operations.value);
    expect(stale.github.status).toBe('stale');
    expect(stale.github.value).toEqual(good.github.value);
    expect(JSON.stringify(stale)).not.toContain('PRIVATE');
  } finally { vi.useRealTimers(); rmSync(home, { recursive: true, force: true }); }
});
it('refuses to collect a private repository before reading its issues', async () => {
  const calls: string[][] = [];
  const run: Run = async (_command, args) => { calls.push(args); return { code: 0, stdout: 'private', stderr: '' }; };
  await expect(new PublicGitHub(createConfig('/unused'), run).read(structuredClone(EMPTY_STATE))).rejects.toThrow('public repository');
  expect(calls).toHaveLength(1);
});

describe('release first-parent history', () => {
  const commits = [
    { sha: 'a', parents: [{ sha: 'base' }, { sha: 'side' }], commit: { message: 'Merge issue #7: Included feature' } },
    { sha: 'nested', parents: [{ sha: 'base' }, { sha: 'x' }], commit: { message: 'Merge issue #99: Nested merge' } },
    { sha: 'b', parents: [{ sha: 'a' }, { sha: 'nested' }], commit: { message: 'Merge issue #8: Removed feature' } },
    { sha: 'head', parents: [{ sha: 'b' }], commit: { message: 'Release cleanup' } },
  ];
  it('matches factory membership: first-parent merge subjects, excluding removals', () => {
    expect(selectReleaseFeatures(commits, 'head', [8])).toEqual([{ issue: 7, title: 'Included feature' }]);
  });
  it('does not invent a release from unrelated or empty history', () => {
    expect(selectReleaseFeatures([], 'head', [])).toEqual([]);
    expect(selectReleaseFeatures([{ sha: 'head', parents: [{ sha: 'base' }], commit: { message: 'Merge issue #8: Not a merge commit' } }], 'head', [])).toEqual([]);
  });
});
