import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { AgentRun, Ctx, MergeStep } from '../types';
import { queueIncidents, runStage } from './incident';

let home = '';
let calls: string[] = [];
let prompt = '';
let changed: string[] = [];

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-incident-');
  calls = [];
  prompt = '';
  changed = ['docs/incident-log.md'];
  writeState(`${home}/state.json`, structuredClone(EMPTY_STATE));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(outcome: string | null, log = 'ID: R6\nrepo: game\n'): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', repo: 'o/r' },
    statePath: `${home}/state.json`,
    log: () => undefined,
    github: {
      issue: async () => ({ number: 7, title: 'Slow sight checks', body: 'Turns are slow', labels: ['bug'], createdAt: '', state: 'CLOSED', author: 'anna', thumbsUp: [] }),
      comments: async () => [],
      comment: record('comment'),
    },
    container: {
      agent: async (run: AgentRun) => {
        calls.push(`agent ${run.model}`);
        prompt = run.prompt;
        mkdirSync(`${run.clone}/docs`, { recursive: true });
        writeFileSync(`${run.clone}/docs/incident-log.md`, log);
        if (outcome !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/incident.json`, outcome);
      },
    },
    repo: {
      fetch: record('sync'), deleteBranch: record('delete'),
      merge: async (steps: MergeStep[]) => { calls.push(...steps.map((step) => `merge ${step.branch} ${step.into} ${step.message}`)); },
      fetchFromWork: async (...args: unknown[]) => { calls.push(`fetch ${args.join(' ')}`); return 'abc123'; },
      changedFiles: async () => changed,
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
    },
  };
  return fake as unknown as Ctx;
}

const outcome = (over: Record<string, unknown>): string => JSON.stringify({ written: true, id: 'R6', reason: 'It cost a day of profiling.', ...over });

describe('incident stage', () => {
  it('merges a written entry into dev in one atomic merge and comments the id', async () => {
    await runStage(fakeCtx(outcome({})), 7);
    expect(calls).toContain('agent opus');
    expect(calls).toContain('merge abc123 dev Record incident R6 from issue #7');
    expect(calls).toContain('comment 7 Recorded in the incident log as R6. It cost a day of profiling.');
    expect(prompt).not.toContain('{{');
  });

  it('comments the reason and pushes nothing when the bug is below the bar', async () => {
    await runStage(fakeCtx(outcome({ written: false, id: null, reason: 'A typo in one label.' })), 7);
    expect(calls).toContain('comment 7 Not added to the incident log. A typo in one label.');
    expect(calls.filter((call) => call.startsWith('push') || call.startsWith('merge') || call.startsWith('fetch'))).toEqual([]);
  });

  it('throws when the agent wrote no output file', async () => {
    await expect(runStage(fakeCtx(null), 7)).rejects.toThrow('wrote no .factory/incident.json');
  });

  it('throws on a malformed output file', async () => {
    await expect(runStage(fakeCtx('{"written": "yes", "reason": "x"}'), 7)).rejects.toThrow('written as true or false');
    await expect(runStage(fakeCtx(outcome({ id: 'seven' })), 7)).rejects.toThrow('needs an id like R7');
    await expect(runStage(fakeCtx(outcome({ reason: ' ' })), 7)).rejects.toThrow('non-empty reason');
    await expect(runStage(fakeCtx('not json'), 7)).rejects.toThrow();
    expect(calls.filter((call) => call.startsWith('push') || call.startsWith('comment'))).toEqual([]);
  });

  it('throws before the merge when the branch touches more than the log', async () => {
    changed = ['docs/incident-log.md', 'game/src/sim/vision.ts'];
    await expect(runStage(fakeCtx(outcome({})), 7)).rejects.toThrow('must commit docs/incident-log.md alone');
    expect(calls.filter((call) => call.startsWith('push') || call.startsWith('merge'))).toEqual([]);
  });

  it('throws when the log lacks the entry id', async () => {
    await expect(runStage(fakeCtx(outcome({ id: 'R9' })), 7)).rejects.toThrow('no entry with ID: R9');
  });
});

describe('queueIncidents', () => {
  it('adds each issue once', () => {
    const ctx = fakeCtx(null);
    queueIncidents(ctx, [7, 8]);
    queueIncidents(ctx, [8, 9]);
    queueIncidents(ctx, []);
    expect(readState(ctx.statePath).pendingIncidents).toEqual([7, 8, 9]);
  });
});
