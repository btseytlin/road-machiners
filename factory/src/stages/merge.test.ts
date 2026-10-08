import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { AgentRun, Card, Ctx } from '../types';
import { BudgetError } from './checkpoint';

const deployed: string[] = [];
vi.mock('../deploy', () => ({ deployDev: async () => { deployed.push('dev'); return 'https://play.test/dev/'; } }));
const { merge } = await import('./merge');

let home = '';
let calls: string[] = [];
let comments: string[] = [];
let runs: AgentRun[] = [];
let cards: Card[] = [];
// What merging each branch into the clone gives, in order. A branch with no entry left merges cleanly.
let merges: Record<string, { commit: string | null; conflicts: string[] }[]> = {};
let shellFailures: string[] = [];
let pushFailures = 0;
let diff = '';

const card = (issue: number, labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column: 'Merging', labels });
const result = `${JSON.stringify({ type: 'result', total_cost_usd: 1, duration_ms: 1000 })}\n`;

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-merge-');
  calls = [];
  comments = [];
  runs = [];
  cards = [card(5), card(6)];
  merges = {};
  shellFailures = [];
  pushFailures = 0;
  diff = '';
  deployed.length = 0;
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), approvedResolving: { 5: 'Ann', 6: 'Bob' }, release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: 300, removed: [9], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } }, pendingShip: 'ann' });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(budget = 5): Ctx {
  const fake = {
    cfg: { home, buildModel: 'sonnet', mergingBudgetUsd: budget, gpu: false, publicUrl: 'https://play.test', committeeChat: 'chat' },
    log: () => undefined,
    statePath: `${home}/state.json`,
    now: () => new Date('2026-09-30T10:00:00Z'),
    github: {
      cards: async () => cards,
      issue: async (issue: number) => ({ number: issue, title: `Card ${issue}`, labels: cards.find((c) => c.issue === issue)?.labels ?? [] }),
      comment: async (issue: number, body: string) => { comments.push(`${issue} ${body}`); },
      addLabel: async (issue: number, label: string) => { calls.push(`label ${issue} ${label}`); },
      move: async (issue: number, column: string) => { calls.push(`move ${issue} ${column}`); },
    },
    telegram: { sendMessage: async (_chat: string, text: string) => { calls.push(`message ${text}`); return 1; } },
    container: {
      agent: async (run: AgentRun) => { runs.push(run); calls.push('agent'); return result; },
      shell: async () => {
        calls.push('checks');
        const failure = shellFailures.shift();
        if (failure !== undefined) throw new Error(failure);
      },
    },
    repo: {
      fetch: async () => { calls.push('fetch'); },
      prepareWorkClone: async (branch: string, base: string, dir: string) => { calls.push(`clone ${branch} ${base}`); mkdirSync(dir, { recursive: true }); },
      mergeBranchIntoWork: async (_dir: string, branch: string) => {
        calls.push(`merge ${branch}`);
        return merges[branch]?.shift() ?? { commit: null, conflicts: [] };
      },
      fetchFromWork: async () => 'head1',
      diff: async () => diff,
      push: async (commit: string, branch: string) => {
        calls.push(`push ${commit} ${branch}`);
        if (pushFailures-- > 0) throw new Error('rejected: non-fast-forward');
      },
      isMerged: async () => false,
    },
  };
  return fake as unknown as Ctx;
}

describe('merge queue', () => {
  it('merges every Merging card of one base, checks the result once, pushes it and settles each card', async () => {
    await merge(fakeCtx());
    expect(calls.filter((call) => !call.startsWith('label') && !call.startsWith('move') && !call.startsWith('message'))).toEqual([
      'fetch', 'clone dev dev', 'merge factory/issue-5', 'merge factory/issue-6', 'checks', 'push head1 dev',
    ]);
    expect(runs).toEqual([]);
    expect(comments).toEqual([
      '5 Approved by Ann and merged into dev. It merged together with #6, and the checks passed on the result. It closes when its release ships.',
      '6 Approved by Bob and merged into dev. It merged together with #5, and the checks passed on the result. It closes when its release ships.',
    ]);
    expect(calls).toContain('label 5 release-candidate');
    expect(calls).toContain('move 5 Done');
    expect(calls).toContain('move 6 Done');
    expect(deployed).toEqual(['dev']);
    expect(readState(`${home}/state.json`).approvedResolving).toEqual({});
  });

  it('takes only the cards of the first card base, and a release batch drops the candidate post', async () => {
    cards = [card(5, ['release-task']), card(6), card(7, ['release-task'])];
    await merge(fakeCtx());
    expect(calls).toContain('clone release/2026-09-29 release/2026-09-29');
    expect(calls).toContain('merge factory/issue-7');
    expect(calls).not.toContain('merge factory/issue-6');
    expect(deployed).toEqual([]);
    const state = readState(`${home}/state.json`);
    expect(state.release?.postId).toBeNull();
    expect(state.pendingShip).toBeNull();
  });

  it('has an agent resolve a conflict, and fails when the merge stays unfinished', async () => {
    merges = { 'factory/issue-6': [{ commit: 'c6', conflicts: ['game/src/a.ts'] }] };
    await merge(fakeCtx());
    expect(runs).toHaveLength(1);
    expect(runs[0]!.prompt).toContain('- game/src/a.ts');
    expect(runs[0]!.model).toBe('sonnet');
    merges = { 'factory/issue-6': [{ commit: 'c6', conflicts: ['game/src/a.ts'] }, { commit: 'c6', conflicts: ['game/src/a.ts'] }] };
    await expect(merge(fakeCtx())).rejects.toThrow('left the merge of factory/issue-6 into dev unfinished');
  });

  it('hands failed checks to one continued agent session until they pass', async () => {
    shellFailures = ['FAIL a.test.ts: expected 1 to be 2', 'FAIL b.test.ts'];
    await merge(fakeCtx());
    expect(runs).toHaveLength(2);
    expect(runs[0]!.prompt).toContain('expected 1 to be 2');
    expect(runs[0]!.prompt).toContain('- #5 on factory/issue-5');
    expect(runs[0]!.session?.resume).toBe(false);
    expect(runs[1]!.session).toEqual({ ...runs[0]!.session, resume: true });
    expect(calls.filter((call) => call === 'checks')).toHaveLength(3);
    expect(calls).toContain('push head1 dev');
  });

  it('labels every card of the batch stuck and pushes nothing once the budget is spent', async () => {
    shellFailures = Array(9).fill('FAIL a.test.ts');
    await expect(merge(fakeCtx(2))).rejects.toThrow(BudgetError);
    expect(calls).toContain('label 5 factory-stuck');
    expect(calls).toContain('label 6 factory-stuck');
    expect(calls.some((call) => call.startsWith('push'))).toBe(false);
  });

  it('merges the moved base again and checks again when GitHub rejects the push', async () => {
    pushFailures = 1;
    await merge(fakeCtx());
    expect(calls.filter((call) => /^(merge dev|checks|push)/.test(call))).toEqual(['checks', 'push head1 dev', 'merge dev', 'checks', 'push head1 dev']);
  });

  it('refuses a result that touches a protected path', async () => {
    diff = 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n';
    await expect(merge(fakeCtx())).rejects.toThrow('paths an agent may not push');
    expect(calls.some((call) => call.startsWith('push'))).toBe(false);
  });

  it('does nothing when no card waits', async () => {
    cards = [];
    await merge(fakeCtx());
    expect(calls).toEqual([]);
  });
});
