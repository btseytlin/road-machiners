import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import { MergeConflictError, RELEASE_TASK_LABEL, STUCK_LABEL, type AgentRun, type Card, type Ctx, type Job, type MergeStep, type Resolution } from '../types';
import { catchUp } from './catch-up';

let home = '';
let cards: Card[] = [];
let calls: string[] = [];
let runs: AgentRun[] = [];
let merged = false;
let conflicts = 0;
let resolutionDiff = '';
let logs: string[] = [];

const card = (issue: number, labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column: 'Merging', labels });
const mergeJob = (batch: number[] | undefined, caughtUp?: number[]): Job => ({ id: 'merge-x', stage: 'merge', issue: null, pid: 1, startedAt: '', log: '', batch, ...(caughtUp ? { caughtUp } : {}) });
const RELEASE = { issue: 20, branch: 'release/2026-10-09', day: '2026-10-09', postId: null, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } };

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-catch-up-');
  cards = [card(5), card(6), card(8)];
  calls = [];
  runs = [];
  merged = false;
  conflicts = 0;
  resolutionDiff = '';
  logs = [];
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), jobs: [mergeJob([5, 6])], release: RELEASE });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(): Ctx {
  const fake = {
    cfg: { home, buildModel: 'sonnet' },
    log: (_stage: string, _issue: number | null, msg: string) => { logs.push(msg); },
    statePath: `${home}/state.json`,
    now: () => new Date('2026-10-09T19:00:00Z'),
    github: { cards: async () => cards },
    container: { agent: async (run: AgentRun) => { runs.push(run); calls.push('agent'); return ''; } },
    repo: {
      fetch: async () => { calls.push('fetch'); },
      isMerged: async (base: string, branch: string) => { calls.push(`is-merged ${base} ${branch}`); return merged; },
      merge: async ([step]: MergeStep[], resolutions: Resolution[] = []) => {
        calls.push(`merge ${step.branch} into ${step.into} with ${resolutions.length} resolutions`);
        if (conflicts-- > 0) throw new MergeConflictError(step, ['game/src/a.ts'], 'both changed it', 'b1', 's1');
      },
      openConflict: async (dir: string) => { calls.push(`open ${dir.slice(home.length)}`); mkdirSync(dir, { recursive: true }); },
      closeConflict: async () => ({ resolution: { base: 'b1', source: 's1', head: 'h1' }, diff: resolutionDiff }),
    },
  };
  return fake as unknown as Ctx;
}

const caughtUp = (): number[] | undefined => readState(`${home}/state.json`).jobs.find((job) => job.stage === 'merge')?.caughtUp;

describe('catchUp', () => {
  it('merges dev into a waiting card branch with no conflict and records the card on the running merge job', async () => {
    await catchUp(fakeCtx(), 8);
    expect(calls).toEqual(['fetch', 'is-merged dev factory/issue-8', 'merge dev into factory/issue-8 with 0 resolutions']);
    expect(caughtUp()).toEqual([8]);
    expect(logs.at(-1)).toBe('factory/issue-8 took dev');
  });

  it('hands a conflict to an agent in its own work clone, then pushes the resolved merge to the issue branch only', async () => {
    conflicts = 1;
    await catchUp(fakeCtx(), 8);
    expect(calls).toEqual(['fetch', 'is-merged dev factory/issue-8', 'merge dev into factory/issue-8 with 0 resolutions', 'open /work/merge-factory-issue-8', 'agent', 'merge dev into factory/issue-8 with 1 resolutions']);
    expect(runs[0]!.prompt).toContain('game/src/a.ts');
  });

  it('pushes nothing when the issue branch already holds the base', async () => {
    merged = true;
    await catchUp(fakeCtx(), 8);
    expect(calls).toEqual(['fetch', 'is-merged dev factory/issue-8']);
    expect(caughtUp()).toEqual([8]);
  });

  it('takes the release branch for a release task', async () => {
    cards = [card(8, [RELEASE_TASK_LABEL])];
    await catchUp(fakeCtx(), 8);
    expect(calls).toContain('merge release/2026-10-09 into factory/issue-8 with 0 resolutions');
  });

  it('does nothing for a card of the running batch, a card it caught up already, a stuck card or with no merge job', async () => {
    const runs = async (jobs: Job[], issue: number): Promise<string[]> => {
      calls = [];
      writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), jobs });
      await catchUp(fakeCtx(), issue);
      return calls;
    };
    expect(await runs([mergeJob([5, 6, 8])], 8)).toEqual([]);
    expect(await runs([mergeJob([5, 6], [8])], 8)).toEqual([]);
    expect(await runs([mergeJob(undefined)], 8)).toEqual([]);
    expect(await runs([], 8)).toEqual([]);
    cards = [card(8, [STUCK_LABEL])];
    expect(await runs([mergeJob([5, 6])], 8)).toEqual([]);
    expect(caughtUp()).toBeUndefined();
  });

  it('fails with the issue named when the agent resolution touches .github, and pushes nothing', async () => {
    conflicts = 1;
    resolutionDiff = 'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n+x\n';
    await expect(catchUp(fakeCtx(), 8)).rejects.toThrow(/catch-up of #8 with dev failed, and its merge job merges it as before: .*may not push: .github\/workflows\/ci.yml/);
    expect(calls.filter((call) => call.startsWith('merge'))).toHaveLength(1);
  });
});
