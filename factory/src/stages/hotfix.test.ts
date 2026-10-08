import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import { MergeConflictError } from '../types';
import { fake, reset } from './test-fakes';

vi.mock('../deploy', () => ({ deployDev: async () => 'https://play.test/dev/' }));
const { shipHotfix } = await import('./hotfix');

beforeEach(() => {
  reset();
  writeState(fake().ctx.statePath, structuredClone(EMPTY_STATE));
});

function hotfixable() {
  const f = fake();
  Object.assign(f.ctx.cfg, { itchTarget: 'u/g', butlerKey: 'secret' });
  return f;
}

describe('hotfix fan-out', () => {
  it('has an agent resolve a conflict of main into dev, pushes all branches once, and ships', async () => {
    const f = hotfixable();
    f.mergeConflicts = ['main dev'];
    await shipHotfix(f.ctx, 7, 'Big horn', 'Ann');
    expect(f.calls.filter((call) => /^(merge|open|agent|close (dev|main|release)|push)/.test(call))).toEqual([
      'merge factory/issue-7 main', 'merge main dev', 'open dev', 'agent', 'close dev',
      'merge factory/issue-7 main', 'merge main dev', 'push main dev',
    ]);
    expect(f.calls.some((call) => call.startsWith('message public'))).toBe(true);
    expect(f.calls.some((call) => call.startsWith('addLabel'))).toBe(false);
  });

  it('has an agent resolve a conflict of main into the open release', async () => {
    const f = hotfixable();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: 42, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } } });
    f.mergeConflicts = ['main release/2026-09-29'];
    await shipHotfix(f.ctx, 7, 'Big horn', 'Ann');
    expect(f.calls).toContain('open release/2026-09-29');
    expect(f.calls).toContain('push main dev release/2026-09-29');
    expect(readState(f.ctx.statePath).release?.postId).toBeNull();
  });

  it('leaves a conflict of the hotfix branch itself to the approval', async () => {
    const f = hotfixable();
    f.mergeConflicts = ['factory/issue-7 main'];
    const error = await shipHotfix(f.ctx, 7, 'Big horn', 'Ann').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MergeConflictError);
    expect(f.calls.some((call) => call.startsWith('open') || call === 'agent')).toBe(false);
  });
});
