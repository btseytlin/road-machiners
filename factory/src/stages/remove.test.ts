import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { ReleaseState } from '../types';
import { fake, reset } from './test-fakes';

vi.mock('../deploy', () => ({ deployDev: async () => 'https://play.test/dev/' }));
const { remove } = await import('./remove');

const RELEASE: ReleaseState = { issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: 42, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } };

beforeEach(() => {
  reset();
  writeState(fake().ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE, pendingRemovals: [{ issue: 5, by: 'Ann', text: 'remove #5 too loud' }] });
});

describe('remove', () => {
  it('reverts on the release branch and dev, pushes both, deletes the branch, reopens and sends the issue to design', async () => {
    const f = fake();
    await remove(f.ctx, 5);
    expect(f.calls).toEqual([
      'fetch',
      'revert 5 release/2026-09-29',
      'revert 5 dev',
      'delete factory/issue-5',
      'reopen 5',
      'removeLabel 5 release-candidate',
      expect.stringContaining('comment ## Committee feedback\n\nRemoved from release 2026-09-29 by Ann:\n\nremove #5 too loud'),
      'move Design',
      expect.stringContaining('message committee - Issue #5 is out of release'),
    ]);
    const state = readState(f.ctx.statePath);
    expect(state.release).toMatchObject({ postId: null, removed: [5] });
  });

  it('clears postId and pendingShip once the release branch is reverted, even when the dev revert fails', async () => {
    const f = fake();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE, pendingShip: 'Bob', pendingRemovals: [{ issue: 5, by: 'Ann', text: 't' }] });
    f.ctx.repo.revertIssueMerge = async (issue, branch) => {
      f.calls.push(`revert ${issue} ${branch}`);
      if (branch === 'dev') throw new Error('revert failed. Conflicting files: a.ts');
      return true;
    };
    await expect(remove(f.ctx, 5)).rejects.toThrow('Conflicting files');
    const state = readState(f.ctx.statePath);
    expect(state.release).toMatchObject({ postId: null, removed: [] });
    expect(state.pendingShip).toBeNull();
  });

  it('finishes a retried removal when the release branch is clean and only dev holds the merge', async () => {
    const f = fake();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, postId: null }, pendingRemovals: [{ issue: 5, by: 'Ann', text: 't' }] });
    f.ctx.repo.revertIssueMerge = async (issue, branch) => { f.calls.push(`revert ${issue} ${branch}`); return branch === 'dev'; };
    await remove(f.ctx, 5);
    expect(f.calls).toContain('revert 5 dev');
    expect(f.calls).toContain('reopen 5');
    expect(readState(f.ctx.statePath).release).toMatchObject({ postId: null, removed: [5] });
  });

  it('throws when neither branch has the merge, and changes nothing', async () => {
    const f = fake();
    f.ctx.repo.revertIssueMerge = async () => false;
    await expect(remove(f.ctx, 5)).rejects.toThrow('Neither release/2026-09-29 nor dev has a merge of issue #5');
    expect(f.calls.some((call) => call.startsWith('push') || call.startsWith('delete') || call.startsWith('reopen'))).toBe(false);
    expect(readState(f.ctx.statePath).release).toEqual(RELEASE);
  });

  it('pushes nothing after a conflicting revert and keeps the branch and issue as they are', async () => {
    const f = fake();
    f.ctx.repo.revertIssueMerge = async () => { throw new Error('revert failed. Conflicting files: a.ts'); };
    await expect(remove(f.ctx, 5)).rejects.toThrow('Conflicting files');
    expect(f.calls.some((call) => call.startsWith('push') || call.startsWith('delete') || call.startsWith('reopen'))).toBe(false);
  });

  it('throws when the removal is not queued or no release is open', async () => {
    const f = fake();
    await expect(remove(f.ctx, 9)).rejects.toThrow('No removal of issue #9 is queued');
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), pendingRemovals: [{ issue: 5, by: 'Ann', text: 't' }] });
    await expect(remove(f.ctx, 5)).rejects.toThrow('No release is open');
  });
});
