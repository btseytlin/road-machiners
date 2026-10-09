import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, updateState, writeState } from '../state';
import { RELEASE_TASK_LABEL, STUCK_LABEL, type AgentRun, type Card, type Ctx } from '../types';
import { BudgetError } from './checkpoint';

const deployed: string[] = [];
vi.mock('../deploy', () => ({ deployDev: async () => { deployed.push('dev'); return 'https://play.test/dev/'; } }));
const { merge } = await import('./merge');

let home = '';
let calls: string[] = [];
let comments: string[] = [];
let runs: AgentRun[] = [];
let cards: Card[] = [];
let merges: Record<string, { commit: string | null; conflicts: string[] }[]> = {};
let shellFailures: string[] = [];
let pushFailures = 0;
let diff = '';
let messages: string[] = [];
let limits: (number | undefined)[] = [];
let logs: string[] = [];
const HUNG = 'CheckTimeoutError: the checks ran past their 45 minute limit, and the factory removed their container.';

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
  messages = [];
  limits = [];
  logs = [];
  deployed.length = 0;
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), approvedResolving: { 5: 'Ann', 6: 'Bob' }, release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: 300, removed: [9], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } }, pendingShip: 'ann' });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(budget = 5): Ctx {
  const fake = {
    cfg: { home, buildModel: 'sonnet', mergingBudgetUsd: budget, checksTimeoutMinutes: 45, gpu: false, publicUrl: 'https://play.test', committeeChat: 'chat' },
    log: (_stage: string, _issue: number | null, msg: string) => { logs.push(msg); },
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
      shell: async (_dir: string, _script: string, _log: string, _env?: Record<string, string>, _mounts?: Record<string, string>, limit?: number) => {
        calls.push('checks');
        limits.push(limit);
        const failure = shellFailures.shift();
        if (failure !== undefined) throw new Error(failure);
      },
    },
    repo: {
      fetch: async () => { calls.push('fetch'); },
      prepareWorkClone: async (branch: string, base: string, dir: string) => { calls.push(`clone ${branch} ${base}`); mkdirSync(dir, { recursive: true }); },
      mergeBranchIntoWork: async (_dir: string, branch: string, message?: string) => {
        calls.push(`merge ${branch}`);
        if (message !== undefined) messages.push(message);
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
    expect(messages).toEqual(['Merge issue #5: Card 5', 'Merge issue #6: Card 6']);
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

  it('takes at most three cards of the first card base, oldest first, and the next job takes the rest', async () => {
    cards = [card(5), card(6, ['release-task']), card(7), card(8), card(9), card(10)];
    const job = { id: 'merge---x', stage: 'merge' as const, issue: null, pid: 1, startedAt: '', log: '' };
    updateState(`${home}/state.json`, (state) => ({ ...state, jobs: [job] }));
    await merge(fakeCtx());
    expect(calls.filter((call) => call.startsWith('merge '))).toEqual(['merge factory/issue-5', 'merge factory/issue-7', 'merge factory/issue-8']);
    expect(readState(`${home}/state.json`).jobs[0].batch).toEqual([5, 7, 8]);
    cards = cards.filter((c) => ![5, 7, 8].includes(c.issue));
    calls = [];
    await merge(fakeCtx());
    expect(calls.filter((call) => call.startsWith('merge '))).toEqual(['merge factory/issue-6']);
  });

  it('keeps an earlier batch pushed and settled when a later batch fails, and labels only the failed batch', async () => {
    cards = [card(5), card(6), card(7), card(8)];
    await merge(fakeCtx());
    expect(calls.filter((call) => /^(merge factory|checks|push)/.test(call))).toEqual(['merge factory/issue-5', 'merge factory/issue-6', 'merge factory/issue-7', 'checks', 'push head1 dev']);
    cards = [card(8)];
    calls = [];
    shellFailures = Array(9).fill('FAIL a.test.ts');
    await expect(merge(fakeCtx(0))).rejects.toThrow(BudgetError);
    expect(calls.filter((call) => call.startsWith('label') && call.endsWith(STUCK_LABEL))).toEqual(['label 8 factory-stuck']);
    expect(calls.some((call) => call.startsWith('push'))).toBe(false);
    expect(comments.filter((text) => text.includes('merged into dev')).map((text) => text.split(' ')[0])).toEqual(['5', '6', '7']);
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

  it('runs each checks run with the time limit, and runs a timed-out run again before it pushes', async () => {
    shellFailures = [HUNG];
    await merge(fakeCtx());
    expect(limits).toEqual([45, 45]);
    expect(runs).toEqual([]);
    expect(logs).toContain('the checks only timed out, run 1, running them again');
    expect(calls.filter((call) => /^(checks|push)/.test(call))).toEqual(['checks', 'checks', 'push head1 dev']);
  });

  it('fails the batch after three timed-out runs, with no agent round and no push', async () => {
    shellFailures = [HUNG, HUNG, HUNG];
    await expect(merge(fakeCtx())).rejects.toThrow('timed out 3 times, under load or in a hung step');
    expect(runs).toEqual([]);
    expect(calls.some((call) => call.startsWith('push'))).toBe(false);
    expect(calls).toContain('label 5 factory-stuck');
  });

  it('hands a real test failure to the agent even when the run then hung', async () => {
    shellFailures = [`FAIL a.test.ts\nAssertionError: expected 1 to be 2\n${HUNG}`];
    await merge(fakeCtx());
    expect(runs).toHaveLength(1);
    expect(runs[0]!.prompt).toContain('expected 1 to be 2');
    expect(calls).toContain('push head1 dev');
  });

  it('judges each run by its own lines of the shared checks log, so a real failure after a hung run reaches the agent', async () => {
    const outputs = [HUNG, "src/a.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'."];
    const ctx = fakeCtx();
    ctx.container.shell = async (_dir: string, _script: string, log: string) => {
      calls.push('checks');
      const output = outputs.shift();
      if (output === undefined) return;
      appendFileSync(log, `${output}\n`);
      throw new Error('shell failed with exit 2');
    };
    await merge(ctx);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.prompt).toContain('error TS2322');
    expect(runs[0]!.prompt).not.toContain('ran past their');
    expect(calls.filter((call) => call === 'checks')).toHaveLength(3);
  });

  it('lets a slow run that ends inside its limit pass, and notes its progress every 5 minutes', async () => {
    vi.useFakeTimers();
    try {
      const ctx = fakeCtx();
      ctx.container.shell = async () => { calls.push('checks'); await new Promise((done) => setTimeout(done, 38 * 60_000)); };
      const merged = merge(ctx);
      await vi.advanceTimersByTimeAsync(38 * 60_000);
      await merged;
      expect(logs.filter((line) => line.startsWith('the checks still run after'))).toHaveLength(7);
      expect(logs).toContain('the checks still run after 35 min, with no log yet');
      expect(calls).toContain('push head1 dev');
    } finally {
      vi.useRealTimers();
    }
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

  it('leaves a stuck or held card out of the batch', async () => {
    cards = [card(5, [STUCK_LABEL]), card(6), card(7)];
    updateState(`${home}/state.json`, (state) => ({ ...state, held: { 7: { by: 'Ann', reason: 'wait', at: '2026-09-30T09:00:00Z', stage: null } } }));
    await merge(fakeCtx());
    expect(calls.filter((call) => call.startsWith('merge '))).toEqual(['merge factory/issue-6']);
  });

  it('leaves release task cards out while a ship runs, and merges dev cards', async () => {
    cards = [card(6), card(7, [RELEASE_TASK_LABEL])];
    const ship = { id: 'ship-20-x', stage: 'ship' as const, issue: 20, pid: 1, startedAt: '', log: '' };
    updateState(`${home}/state.json`, (state) => ({ ...state, jobs: [ship], release: { issue: 20, branch: 'release/2026-01-05', day: '2026-01-05', postId: null, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } } }));
    await merge(fakeCtx());
    expect(calls.filter((call) => call.startsWith('merge '))).toEqual(['merge factory/issue-6']);
  });

  it('records the batch on its own job entry, without the stuck and held cards', async () => {
    cards = [card(5, [STUCK_LABEL]), card(6), card(7)];
    const job = { id: 'merge---x', stage: 'merge' as const, issue: null, pid: 1, startedAt: '', log: '' };
    updateState(`${home}/state.json`, (state) => ({ ...state, jobs: [job], held: { 7: { by: 'Ann', reason: 'wait', at: '2026-09-30T09:00:00Z', stage: null } } }));
    let batch: number[] | undefined;
    const ctx = fakeCtx();
    ctx.container.shell = async () => { batch = readState(`${home}/state.json`).jobs[0].batch; return { code: 0, stdout: '', stderr: '' } as never; };
    await merge(ctx);
    expect(batch).toEqual([6]);
  });

  it('logs how long the batch spent merging, checking, fixing, merging the moved base again and pushing, also when it fails', async () => {
    pushFailures = 1;
    await merge(fakeCtx());
    expect(logs).toContain('batch #5 #6 took merges 0 min in 2, checks 0 min in 2, fixes 0 min in 0, remerges 0 min in 1, pushes 0 min in 2');
    logs = [];
    shellFailures = ['FAIL a.test.ts'];
    await expect(merge(fakeCtx(0))).rejects.toThrow(BudgetError);
    expect(logs).toContain('batch #5 #6 took merges 0 min in 2, checks 0 min in 1, fixes 0 min in 0, remerges 0 min in 0, pushes 0 min in 0');
  });

  it('leaves a card whose catch-up still runs to a later batch, so no card is merged by two jobs at once', async () => {
    cards = [card(5), card(6), card(7), card(8)];
    const merging = { id: 'merge---x', stage: 'merge' as const, issue: null, pid: 1, startedAt: '', log: '' };
    const catching = { id: 'catch-up-5-x', stage: 'catch-up' as const, issue: 5, pid: 2, startedAt: '', log: '' };
    updateState(`${home}/state.json`, (state) => ({ ...state, jobs: [merging, catching], approvedResolving: {} }));
    await merge(fakeCtx());
    expect(readState(`${home}/state.json`).jobs.find((job) => job.stage === 'merge')?.batch).toEqual([6, 7, 8]);
    expect(calls.filter((call) => call.startsWith('merge '))).toEqual(['merge factory/issue-6', 'merge factory/issue-7', 'merge factory/issue-8']);
  });

  it('merges every waiting card exactly once across jobs while catch-ups run between them', async () => {
    cards = [card(5), card(6), card(7), card(8), card(9)];
    const merging = { id: 'merge---x', stage: 'merge' as const, issue: null, pid: 1, startedAt: '', log: '' };
    const mergedOnce: string[] = [];
    for (let round = 0; round < 3 && cards.length > 0; round++) {
      calls = [];
      updateState(`${home}/state.json`, (state) => ({ ...state, jobs: [merging, ...(round === 1 ? [{ id: 'c', stage: 'catch-up' as const, issue: 8, pid: 2, startedAt: '', log: '' }] : [])] }));
      await merge(fakeCtx());
      const taken = readState(`${home}/state.json`).jobs.find((job) => job.stage === 'merge')?.batch ?? [];
      mergedOnce.push(...calls.filter((call) => call.startsWith('merge factory/')));
      cards = cards.filter((c) => !taken.includes(c.issue));
    }
    expect(mergedOnce.sort()).toEqual(['merge factory/issue-5', 'merge factory/issue-6', 'merge factory/issue-7', 'merge factory/issue-8', 'merge factory/issue-9']);
  });

  it('does nothing when no card waits', async () => {
    cards = [];
    await merge(fakeCtx());
    expect(calls).toEqual([]);
  });
});
