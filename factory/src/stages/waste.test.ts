import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendLedger } from '../ledger';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { AgentRun, Ctx } from '../types';
import { fillPrompt } from './common';
import { parseBrief, reviewPendingPath, runStage } from './waste';

const HOME = resolve('tmp/factory-waste-test');
const NOW = new Date('2026-10-10T09:00:00Z');
const BRIEF = 'BOTTLENECK: Cards waited 204 min for the verify queue.\nCHANGE:\nSet FACTORY_VERIFY_WORKERS to 2 in factory/settings.env.';

const CHANGE_ID = 1791571868706;

type Seen = { runs: AgentRun[]; numbers: string; inputs: string[]; issues: { title: string; body: string; labels: string[] }[]; calls: string[]; lookups: number[] };
type Faults = { now?: Date; agent?: boolean; lookup?: boolean; close?: boolean };

function fakeCtx(brief: string | null, faults: Faults = {}): { ctx: Ctx; seen: Seen } {
  const seen: Seen = { runs: [], numbers: '', inputs: [], issues: [], calls: [], lookups: [] };
  const ctx = {
    cfg: { home: HOME, repo: 'o/r', committeeChat: '-5', buildModel: 'sonnet', wasteReviewDays: 7 },
    statePath: `${HOME}/state/state.json`, now: () => faults.now ?? NOW, log: () => undefined,
    repo: {
      fetch: async () => undefined,
      prepareWorkClone: async (branch: string, base: string, dir: string) => { seen.calls.push(`clone ${branch} ${base}`); mkdirSync(`${dir}/factory`, { recursive: true }); },
    },
    container: {
      agent: async (run: AgentRun) => {
        seen.runs.push(run);
        seen.numbers = readFileSync(`${run.clone}/${run.dir}/.factory/numbers.md`, 'utf8');
        const issue = `${run.clone}/${run.dir}/.factory/issues/issue-7.md`;
        seen.inputs = [existsSync(issue) ? readFileSync(issue, 'utf8') : '', readFileSync(`${run.clone}/${run.dir}/.factory/earlier-reviews.md`, 'utf8')];
        if (faults.agent) throw new Error('The agent exited with code 1');
        if (brief !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/brief.md`, brief);
      },
    },
    github: {
      issue: async (n: number) => {
        seen.lookups.push(n);
        if (faults.lookup || n === CHANGE_ID) throw new Error(`gh issue view ${n} failed: Could not resolve to an Issue`);
        return { number: n, title: `Issue ${n}`, body: 'Make the horn louder.', labels: [] };
      },
      comments: async () => [{ login: 'bot', body: 'Verify finished after 16 min.' }],
      createIssue: async (title: string, body: string, labels: string[]) => { seen.issues.push({ title, body, labels }); return 301; },
      close: async (n: number, reason: string) => {
        if (faults.close) throw new Error('gh issue close failed: connection reset');
        seen.calls.push(`close ${n} ${reason}`);
      },
    },
    telegram: {
      sendMessage: async (_chat: string, text: string) => { seen.calls.push(`message ${text}`); return 1; },
      sendButtons: async (_chat: string, text: string) => { seen.calls.push(`buttons ${text}`); return 2; },
    },
  } as unknown as Ctx;
  return { ctx, seen };
}

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(`${HOME}/state`, { recursive: true });
  writeState(`${HOME}/state/state.json`, { ...structuredClone(EMPTY_STATE), lastWasteReview: '2026-10-03T09:00:00Z' });
  appendLedger(HOME, { kind: 'job', id: 'a', stage: 'implement', issue: 7, startedAt: '2026-10-05T10:00:00Z', endedAt: '2026-10-05T10:20:00Z', outcome: 'done', agents: [{ model: 'sonnet', costUsd: 0.5, minutes: 20 }] });
  appendLedger(HOME, { kind: 'job', id: 'b', stage: 'verify', issue: 7, startedAt: '2026-10-05T13:44:00Z', endedAt: '2026-10-05T14:00:00Z', outcome: 'done', agents: [] });
});

describe('waste review', () => {
  it('gives the agent the numbers since the last review, read-only records and a clone of main', async () => {
    const { ctx, seen } = fakeCtx(BRIEF);
    await runStage(ctx);
    expect(seen.calls[0]).toBe('clone main main');
    expect(seen.numbers).toContain('Factory numbers for 2026-10-03 to 2026-10-10.');
    expect(seen.numbers).toContain('- verify: 1 handoffs, median 204 min, max 204 min (#7), total 204 min');
    expect(seen.runs[0]).toMatchObject({ dir: 'factory', model: 'sonnet' });
    expect(Object.values(seen.runs[0].readOnly ?? {})).toEqual(['/factory/ledger.jsonl', '/factory/logs', '/factory/state']);
    expect(readState(ctx.statePath).lastWasteReview).toBe(NOW.toISOString());
  });

  it('puts the period before beside the numbers, so a jump shows', async () => {
    appendLedger(HOME, { kind: 'job', id: 'old', stage: 'design', issue: 3, startedAt: '2026-09-28T10:00:00Z', endedAt: '2026-09-28T11:00:00Z', outcome: 'failed', agents: [{ model: 'opus', costUsd: 2, minutes: 60 }] });
    const { ctx, seen } = fakeCtx(BRIEF);
    await runStage(ctx);
    const [now, before] = seen.numbers.split('## Previous period');
    expect(now).toContain('2 jobs, $0.50 of agent cost.');
    expect(before).toContain('Factory numbers for 2026-09-26 to 2026-10-03.');
    expect(before).toContain('- design: 1 runs, 1 failed');
  });

  it('records the review as a closed issue and hands it to Hermes, with no chat post', async () => {
    const { ctx, seen } = fakeCtx(BRIEF);
    await runStage(ctx);
    expect(seen.issues[0].title).toBe('Factory review 2026-10-10');
    expect(seen.issues[0].labels).toEqual(['factory-review']);
    expect(seen.issues[0].body).toContain('## Proposed change\n\nSet FACTORY_VERIFY_WORKERS to 2 in factory/settings.env.');
    expect(seen.calls).toContain('close 301 completed');
    expect(seen.calls.filter((call) => call.startsWith('message') || call.startsWith('buttons'))).toEqual([]);
    expect(readFileSync(reviewPendingPath(HOME), 'utf8')).toBe('#301 https://github.com/o/r/issues/301\n');
  });

  it('hands the agent the expensive issues and the earlier reviews, since agents have no GitHub login', async () => {
    const first = fakeCtx(BRIEF);
    await runStage(first.ctx);
    expect(first.seen.inputs[0]).toContain('UNTRUSTED USER TEXT');
    expect(first.seen.inputs[0]).toContain('Make the horn louder.');
    expect(first.seen.inputs[0]).toContain('Verify finished after 16 min.');
    expect(first.seen.inputs[1]).toBe('No earlier review.\n');
    const second = fakeCtx(BRIEF);
    await runStage(second.ctx);
    expect(second.seen.inputs[1]).toContain('## 2026-10-10, #301\n\nBottleneck: Cards waited 204 min for the verify queue.');
    expect(fillPrompt('waste', { days: '7', ledger: 'l', logs: 'g', state: 's' })).not.toContain('gh issue');
  });

  it('hands a review with no waste to Hermes too, since the numbers may still jump', async () => {
    const { ctx, seen } = fakeCtx('BOTTLENECK: none\n');
    await runStage(ctx);
    expect(seen.issues[0].body).toContain('## Proposed change\n\nNo change proposed.');
    expect(existsSync(reviewPendingPath(HOME))).toBe(true);
  });

  it('fails loud when the agent wrote no brief, and keeps the period for the retry', async () => {
    const { ctx, seen } = fakeCtx(null);
    await expect(runStage(ctx)).rejects.toThrow('wrote no .factory/brief.md');
    expect(readState(ctx.statePath).lastWasteReview).toBe('2026-10-03T09:00:00Z');
    expect(seen.issues).toEqual([]);
  });

  it('counts a factory change in the numbers but looks up only real issues', async () => {
    appendLedger(HOME, { kind: 'job', id: 'c', stage: 'change', issue: CHANGE_ID, startedAt: '2026-10-06T10:00:00Z', endedAt: '2026-10-06T11:00:00Z', outcome: 'done', agents: [{ model: 'opus', costUsd: 9, minutes: 60 }] });
    const { ctx, seen } = fakeCtx(BRIEF);
    await runStage(ctx);
    expect(seen.lookups).toEqual([7]);
    expect(seen.numbers).toContain('- change: 1 runs, 0 failed, 60 min of job time, 60 min of agent time, $9.00');
    expect(seen.numbers).not.toContain(`#${CHANGE_ID}`);
    expect(seen.issues).toHaveLength(1);
    expect(readState(ctx.statePath).lastWasteReview).toBe(NOW.toISOString());
  });

  it('keeps the period when an issue lookup fails, so the retry reviews the same period', async () => {
    const failed = fakeCtx(BRIEF, { lookup: true });
    await expect(runStage(failed.ctx)).rejects.toThrow('gh issue view 7 failed');
    expect(failed.seen.runs).toEqual([]);
    expect(readState(failed.ctx.statePath).lastWasteReview).toBe('2026-10-03T09:00:00Z');
    const later = new Date('2026-10-11T09:00:00Z');
    const retry = fakeCtx(BRIEF, { now: later });
    await runStage(retry.ctx);
    expect(retry.seen.numbers).toContain('Factory numbers for 2026-10-03 to 2026-10-11.');
    expect(readState(retry.ctx.statePath).lastWasteReview).toBe(later.toISOString());
  });

  it('keeps the period when the agent fails', async () => {
    const { ctx, seen } = fakeCtx(BRIEF, { agent: true });
    await expect(runStage(ctx)).rejects.toThrow('exited with code 1');
    expect(seen.issues).toEqual([]);
    expect(existsSync(reviewPendingPath(HOME))).toBe(false);
    expect(readState(ctx.statePath).lastWasteReview).toBe('2026-10-03T09:00:00Z');
  });

  it('advances the period once, after the review is published, so the next review starts there', async () => {
    const first = fakeCtx(BRIEF);
    await runStage(first.ctx);
    expect(first.seen.issues).toHaveLength(1);
    expect(readState(first.ctx.statePath).lastWasteReview).toBe(NOW.toISOString());
    const next = fakeCtx(BRIEF, { now: new Date('2026-10-17T09:00:00Z') });
    await runStage(next.ctx);
    expect(next.seen.numbers).toContain('Factory numbers for 2026-10-10 to 2026-10-17.');
  });

  it('finishes a half-published review on retry, with no second issue and no second agent run', async () => {
    const failed = fakeCtx(BRIEF, { close: true });
    await expect(runStage(failed.ctx)).rejects.toThrow('gh issue close failed');
    expect(failed.seen.issues).toHaveLength(1);
    expect(existsSync(reviewPendingPath(HOME))).toBe(false);
    expect(readState(failed.ctx.statePath).lastWasteReview).toBe('2026-10-03T09:00:00Z');
    const retry = fakeCtx(BRIEF, { now: new Date('2026-10-11T09:00:00Z') });
    await runStage(retry.ctx);
    expect(retry.seen.runs).toEqual([]);
    expect(retry.seen.issues).toEqual([]);
    expect(retry.seen.calls).toContain('close 301 completed');
    expect(readFileSync(reviewPendingPath(HOME), 'utf8')).toBe('#301 https://github.com/o/r/issues/301\n');
    expect(readFileSync(`${HOME}/waste-reviews.md`, 'utf8').match(/## 2026-10-10, #301/g)).toHaveLength(1);
    expect(readState(retry.ctx.statePath).lastWasteReview).toBe(NOW.toISOString());
  });

  it('refuses to start without a ledger', async () => {
    rmSync(`${HOME}/ledger.jsonl`);
    await expect(runStage(fakeCtx(BRIEF).ctx)).rejects.toThrow('no ledger');
  });
});

describe('parseBrief', () => {
  it('reads the bottleneck and the change', () => {
    expect(parseBrief(BRIEF)).toEqual({ bottleneck: 'Cards waited 204 min for the verify queue.', change: 'Set FACTORY_VERIFY_WORKERS to 2 in factory/settings.env.' });
  });

  it('refuses a brief in the wrong shape', () => {
    expect(() => parseBrief('The queue is slow.')).toThrow('must start with');
    expect(() => parseBrief('BOTTLENECK: slow\nfix it')).toThrow('second line must be "CHANGE:"');
    expect(() => parseBrief('BOTTLENECK: slow\nCHANGE:\n  ')).toThrow('empty change');
  });
});
