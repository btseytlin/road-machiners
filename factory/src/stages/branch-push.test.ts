import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRun } from '../types';
import { guardAndPush } from './common';
import { fake, reset, type Fake } from './test-fakes';

beforeEach(reset);

// A fake whose issue branch moves on GitHub: each push in `rejects` fails once, and each entry of `moves` is what the next catch-up finds.
function moving(moves: { commit: string | null; conflicts: string[] }[], rejects: number): { f: Fake; prompts: string[] } {
  const f = fake();
  const prompts: string[] = [];
  let rejected = 0;
  Object.assign(f.ctx.github, { comments: async () => [] });
  Object.assign(f.ctx.container, { agent: async (run: AgentRun) => { prompts.push(run.prompt); f.calls.push('agent'); } });
  Object.assign(f.ctx.repo, {
    mergeBranchIntoWork: async () => {
      const next = moves.shift() ?? { commit: null, conflicts: [] };
      f.calls.push(`catch up ${next.commit ?? 'none'}`);
      return next;
    },
    push: async (commit: string, branch: string) => {
      if (rejected++ < rejects) { f.calls.push('push rejected'); throw new Error('git push failed: rejected (fetch first)'); }
      f.calls.push(`push ${commit} ${branch}`);
    },
  });
  return { f, prompts };
}

describe('pushing an issue branch that moved on GitHub', () => {
  it('merges a member push before the push, with no agent when it merges clean', async () => {
    const { f } = moving([{ commit: 'member1', conflicts: [] }], 0);
    await guardAndPush(f.ctx, 7, 'dev', 'verify');
    expect(f.calls.filter((call) => call !== 'fetch' && call !== 'fetchFromWork')).toEqual(['catch up member1', 'push work-head factory/issue-7']);
  });

  it('resolves a conflict with a member push in the same job, then pushes', async () => {
    const { f, prompts } = moving([{ commit: 'member1', conflicts: ['game/src/a.ts'] }], 0);
    await guardAndPush(f.ctx, 7, 'dev', 'verify');
    expect(f.calls.filter((call) => call !== 'fetch' && call !== 'fetchFromWork')).toEqual(['catch up member1', 'agent', 'push work-head factory/issue-7']);
    expect(prompts[0]).toContain('- game/src/a.ts');
    expect(prompts[0]).toContain('factory/issue-7');
  });

  it('merges again and pushes again when GitHub rejects the push because the branch moved meanwhile', async () => {
    const { f } = moving([{ commit: null, conflicts: [] }, { commit: 'member2', conflicts: ['f.txt'] }], 1);
    await guardAndPush(f.ctx, 7, 'dev', 'verify');
    expect(f.calls.filter((call) => call !== 'fetch' && call !== 'fetchFromWork')).toEqual(['catch up none', 'push rejected', 'catch up member2', 'agent', 'push work-head factory/issue-7']);
  });

  it('fails loud when GitHub rejects the push and the branch did not move', async () => {
    const { f } = moving([], 1);
    await expect(guardAndPush(f.ctx, 7, 'dev', 'verify')).rejects.toThrow('rejected');
  });

  it('fails when the agent leaves the merge unfinished', async () => {
    const { f } = moving([{ commit: 'member1', conflicts: ['f.txt'] }], 0);
    Object.assign(f.ctx.repo, { isMerged: async () => false });
    await expect(guardAndPush(f.ctx, 7, 'dev', 'verify')).rejects.toThrow('left the merge of member1 into factory/issue-7 unfinished');
    expect(f.calls).not.toContain('push work-head factory/issue-7');
  });
});
