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

type Seen = { runs: AgentRun[]; numbers: string; inputs: string[]; issues: { title: string; body: string; labels: string[] }[]; calls: string[] };

function fakeCtx(brief: string | null): { ctx: Ctx; seen: Seen } {
  const seen: Seen = { runs: [], numbers: '', inputs: [], issues: [], calls: [] };
  const ctx = {
    cfg: { home: HOME, repo: 'o/r', committeeChat: '-5', buildModel: 'sonnet', wasteReviewDays: 7 },
    statePath: `${HOME}/state/state.json`, now: () => NOW, log: () => undefined,
    repo: {
      fetch: async () => undefined,
      prepareWorkClone: async (branch: string, base: string, dir: string) => { seen.calls.push(`clone ${branch} ${base}`); mkdirSync(`${dir}/factory`, { recursive: true }); },
    },
    container: {
      agent: async (run: AgentRun) => {
        seen.runs.push(run);
        seen.numbers = readFileSync(`${run.clone}/${run.dir}/.factory/numbers.md`, 'utf8');
        // A second review in one test has an empty window, so issue 7 is not among its expensive issues.
        const issue = `${run.clone}/${run.dir}/.factory/issues/issue-7.md`;
        seen.inputs = [existsSync(issue) ? readFileSync(issue, 'utf8') : '', readFileSync(`${run.clone}/${run.dir}/.factory/earlier-reviews.md`, 'utf8')];
        if (brief !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/brief.md`, brief);
      },
    },
    github: {
      issue: async (n: number) => ({ number: n, title: `Issue ${n}`, body: 'Make the horn louder.', labels: [] }),
      comments: async () => [{ login: 'bot', body: 'Verify finished after 16 min.' }],
      createIssue: async (title: string, body: string, labels: string[]) => { seen.issues.push({ title, body, labels }); return 301; },
      close: async (n: number, reason: string) => { seen.calls.push(`close ${n} ${reason}`); },
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

  it('fails loud when the agent wrote no brief, and still waits a full period for the next review', async () => {
    const { ctx } = fakeCtx(null);
    await expect(runStage(ctx)).rejects.toThrow('wrote no .factory/brief.md');
    expect(readState(ctx.statePath).lastWasteReview).toBe(NOW.toISOString());
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
