import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import { fake, reset } from './test-fakes';
import { release } from './release';

beforeEach(reset);

describe('release cut', () => {
  it('only records the time when dev has no feature merges', async () => {
    const f = fake();
    f.changelog = ['Merge main into dev after release 2026-09-22'];
    await release(f.ctx);
    const state = readState(f.ctx.statePath);
    expect(state.lastRelease).toBe('2026-09-29T10:00:00.000Z');
    expect(state.release).toBeNull();
    expect(f.calls).toEqual(['fetch']);
  });

  it('cuts the branch, opens the tracking issue and two cleanup tasks, and sets the release', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn'];
    await release(f.ctx);
    expect(f.calls).toEqual([
      'fetch',
      'branch release/2026-09-29 dev',
      'createIssue Release 2026-09-29',
      'addCard Approval',
      'createIssue Optimize against the speed budget (release 2026-09-29)',
      'addCard Design',
      'createIssue Code janitor pass (release 2026-09-29)',
      'addCard Design',
    ]);
    expect(f.created.map((issue) => issue.labels)).toEqual([['release'], ['release-task', 'maintenance'], ['release-task', 'maintenance']]);
    expect(f.created[0].body).toContain('- #3 faster trucks');
    expect(f.created[1].body).toContain('npm run perf');
    expect(f.created[2].body).toContain('stale doc');
    expect(readState(f.ctx.statePath).release).toEqual({ issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, candidateSha: null, removed: [], tasks: [12, 13], playtest: { seed: 20260929, runs: 0, passed: null, blocked: null, notes: [] } });
  });

  it('merges main into dev first when dev lacks it, so the release merges into main without conflicts', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.ctx.repo.isMerged = async (base: string, branch: string) => !(base === 'main' && branch === 'dev');
    await release(f.ctx);
    expect(f.calls.slice(0, 4)).toEqual(['fetch', 'merge main dev', 'push dev','branch release/2026-09-29 dev']);
  });

  it('has an agent resolve a conflict of main into dev, pushes dev, and records the cut', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.ctx.repo.isMerged = async (base: string, branch: string) => !(base === 'main' && branch === 'dev');
    f.mergeConflicts = ['main dev'];
    await release(f.ctx);
    expect(f.calls.slice(0, 8)).toEqual(['fetch', 'merge main dev', 'open dev', 'agent', 'close dev', 'merge main dev', 'push dev', 'branch release/2026-09-29 dev']);
    expect(f.agentRuns[0].prompt).toContain('You are on branch dev.');
    expect(f.agentRuns[0].prompt).toContain('- game/src/a.ts');
    expect(f.calls.some((call) => call.startsWith('addLabel'))).toBe(false);
    expect(readState(f.ctx.statePath).lastRelease).toBe('2026-09-29T10:00:00.000Z');
  });

  it('leaves lastRelease alone when the cut fails, so the next tick cuts again', async () => {
    const f = fake();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), lastRelease: '2026-09-01T00:00:00.000Z' });
    f.changelog = ['Merge issue #3: faster trucks'];
    f.ctx.repo.isMerged = async () => false;
    f.ctx.repo.merge = async () => { throw new Error('push of dev failed'); };
    await expect(release(f.ctx)).rejects.toThrow('push of dev failed');
    expect(readState(f.ctx.statePath).lastRelease).toBe('2026-09-01T00:00:00.000Z');
  });

  it('removes the new branch when the tracking issue cannot be opened, so the next cut finds no branch', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.ctx.github.createIssue = async () => { throw new Error('gh down'); };
    await expect(release(f.ctx)).rejects.toThrow('gh down');
    expect(f.calls).toContain('delete release/2026-09-29');
    expect(readState(f.ctx.statePath).lastRelease).toBeNull();
  });

  it('keeps the release set when a task cannot be opened, so the failure names the tracking issue', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    let created = 0;
    f.ctx.github.createIssue = async () => {
      created += 1;
      if (created === 2) throw new Error('gh down');
      return 20 + created;
    };
    await expect(release(f.ctx)).rejects.toThrow('gh down');
    expect(readState(f.ctx.statePath).release?.issue).toBe(21);
  });
});
