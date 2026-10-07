import { beforeEach, describe, expect, it } from 'vitest';
import { readState } from '../state';
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
      'createIssue Optimize one slow spot (release 2026-09-29)',
      'addCard Design',
      'createIssue Code janitor pass (release 2026-09-29)',
      'addCard Design',
    ]);
    expect(f.created.map((issue) => issue.labels)).toEqual([['release'], ['release-task', 'maintenance'], ['release-task', 'maintenance']]);
    expect(f.created[0].body).toContain('- #3 faster trucks');
    expect(f.created[1].body).toContain('slow spot');
    expect(f.created[2].body).toContain('stale doc');
    expect(readState(f.ctx.statePath).release).toEqual({ issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, candidateSha: null, removed: [], playtest: { seed: 20260929, runs: 0, passed: null, blocked: null, notes: [] } });
  });

  it('merges main into dev first when dev lacks it, so the release merges into main without conflicts', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.ctx.repo.isMerged = async (base: string, branch: string) => !(base === 'main' && branch === 'dev');
    await release(f.ctx);
    expect(f.calls.slice(0, 4)).toEqual(['fetch', 'merge main dev', 'push dev','branch release/2026-09-29 dev']);
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
