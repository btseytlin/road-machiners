import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readLedger } from './ledger';
import { resumedStage, sessionsDir } from './sessions';
import { EMPTY_STATE, readState, writeState } from './state';
import { chooseJobs } from './tick';
import type { Card, Column, Ctx, FactoryConfig, FactoryState, Job } from './types';

const killed: string[] = [];
// Runs inside the fake kill, like a job that ends on its own while the hold stops it.
let duringKill: () => void = () => undefined;
vi.mock('./jobs', async (original) => ({ ...(await original<object>()), killJob: async (_run: unknown, pid: number, id: string) => { killed.push(`${pid} ${id}`); duringKill(); } }));
const { applyControl } = await import('./control');

const ROOT = resolve('tmp/factory-hold-test');
const statePath = join(ROOT, 'state.json');
const NOW = new Date('2026-10-07T10:00:00Z');
const STARTED = '2026-10-07T09:00:00.000Z';
const CFG = { releaseDays: 7, wasteReviewDays: 7, maxJobsPerDay: 10, maxJobsPerCard: 1, triageWorkers: 1, designWorkers: 1, implementWorkers: 1, verifyWorkers: 1, testWorkers: 1 };
const JOB: Job = { id: 'implement-4-x', stage: 'implement', issue: 4, pid: 77, startedAt: STARTED, log: 'l' };

let cards: Card[] = [];
let comments: string[] = [];
const card = (issue: number, column: Column, labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });

function fakeCtx(): Ctx {
  const cfg = { home: ROOT, committeeBootstrapTelegram: '11', committeeBootstrapGithub: 'boss', tokenPrices: {} } as FactoryConfig;
  return {
    cfg, statePath, now: () => NOW, log: () => undefined, run: async () => ({ code: 0, stdout: '', stderr: '' }),
    github: {
      cards: async () => cards,
      comment: async (n: number, body: string) => { comments.push(`${n} ${body}`); },
      addLabel: async (n: number, label: string) => { comments.push(`addLabel ${n} ${label}`); },
    },
  } as unknown as Ctx;
}

const seed = (patch: Partial<FactoryState>): void => writeState(statePath, { ...structuredClone(EMPTY_STATE), lastRelease: NOW.toISOString(), ...patch });
const order = (action: 'hold' | 'unhold', issue = 4, by = 'Ann') => applyControl(fakeCtx(), { action, issue, by, reason: 'release tasks first' });
const jobLines = () => readLedger(ROOT, new Date(0)).filter((line) => line.kind === 'job');
const controlLines = () => readLedger(ROOT, new Date(0)).filter((line) => line.kind === 'control');

// An implement card mid-run, with a session saved and a cap slot taken.
function runningCard(): void {
  cards = [card(4, 'Implementation'), card(6, 'Implementation', ['release-task'])];
  seed({ jobs: [JOB, { ...JOB, id: 'verify-5-x', stage: 'verify', issue: 5, pid: 78 }], jobStarts: [STARTED], cardStarts: { 4: [STARTED] } });
  mkdirSync(join(sessionsDir(ROOT, 4), 'work'), { recursive: true });
  writeFileSync(join(sessionsDir(ROOT, 4), 'implement.id'), 'sess-1');
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'committee'), { recursive: true });
  writeFileSync(join(ROOT, 'committee', 'committee.json'), JSON.stringify({ members: [{ telegram: '11', github: 'boss', name: 'Ann' }] }));
  killed.length = 0;
  comments = [];
  cards = [];
  duringKill = () => undefined;
  seed({});
});

describe('pause-card on a running card', () => {
  it('stops only that job, keeps its sessions, and marks the card held with no failure', async () => {
    runningCard();
    const text = await order('hold');
    expect(killed).toEqual(['77 implement-4-x']);
    const state = readState(statePath);
    expect(state.jobs.map((job) => job.id)).toEqual(['verify-5-x']);
    expect(state.held).toEqual({ 4: { by: 'Ann', reason: 'release tasks first', at: NOW.toISOString(), stage: 'implement' } });
    expect(state.interrupted).toEqual([4]);
    expect(state.failures).toEqual([]);
    expect(comments.some((line) => line.includes('factory-stuck'))).toBe(false);
    expect(existsSync(join(sessionsDir(ROOT, 4), 'implement.id'))).toBe(true);
    expect(resumedStage(ROOT, 4)).toBe('implement');
    expect(text).toContain('implement job stopped');
  });

  it('frees the cap slot and writes a held job line and the order line with its reason', async () => {
    runningCard();
    await order('hold');
    const state = readState(statePath);
    expect(state.jobStarts).toEqual([]);
    expect(state.cardStarts[4]).toEqual([]);
    expect(jobLines()).toMatchObject([{ id: 'implement-4-x', stage: 'implement', issue: 4, outcome: 'held' }]);
    expect(controlLines()).toMatchObject([{ action: 'hold', issue: 4, by: 'Ann', reason: 'release tasks first' }]);
    expect(comments[0]).toContain('Ordered by Ann. Reason: release tasks first');
  });

  it('gives the freed worker to the release task on the same tick', async () => {
    runningCard();
    await order('hold');
    expect(chooseJobs(readState(statePath), cards, NOW, CFG)).toEqual([{ stage: 'implement', issue: 6 }]);
  });

  it('writes no held line for a job that ended on its own before the kill landed', async () => {
    runningCard();
    duringKill = () => seed({ jobs: [] });
    await order('hold');
    expect(jobLines()).toEqual([]);
    expect(readState(statePath).held[4].stage).toBeNull();
    expect(readState(statePath).interrupted).toEqual([]);
    expect(resumedStage(ROOT, 4)).toBeNull();
  });
});

describe('pause-card on a queued card', () => {
  it('holds the card with no kill and no job line', async () => {
    cards = [card(4, 'Design')];
    expect(await order('hold')).toContain('No job ran');
    expect(killed).toEqual([]);
    expect(jobLines()).toEqual([]);
    expect(readState(statePath).held[4]).toMatchObject({ by: 'Ann', stage: null });
    expect(chooseJobs(readState(statePath), cards, NOW, CFG)).toEqual([]);
  });

  it('keeps an approval pressed while held waiting until the hold goes', async () => {
    cards = [card(4, 'Approval')];
    await order('hold');
    seed({ ...readState(statePath), pendingApprovals: { 4: 'Bob' } });
    expect(chooseJobs(readState(statePath), cards, NOW, CFG)).toEqual([]);
    await order('unhold');
    expect(chooseJobs(readState(statePath), cards, NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }]);
  });
});

describe('pause-card refusals', () => {
  it('refuses a card it cannot hold and changes nothing', async () => {
    cards = [card(4, 'Approval'), card(5, 'Done'), card(20, 'Approval', ['release'])];
    seed({ jobs: [{ ...JOB, stage: 'approve' }] });
    await expect(order('hold')).rejects.toThrow('runs a approve job');
    await expect(order('hold', 5)).rejects.toThrow('Done');
    await expect(order('hold', 20)).rejects.toThrow('release tracking card');
    await expect(order('hold', 9)).rejects.toThrow('not on the board');
    expect(killed).toEqual([]);
    expect(readState(statePath).held).toEqual({});
    expect(readState(statePath).jobs).toHaveLength(1);
  });

  it('refuses a Merging card while the merge job, which has no issue, runs', async () => {
    cards = [card(4, 'Merging')];
    seed({ jobs: [{ ...JOB, stage: 'merge', issue: null }] });
    await expect(order('hold')).rejects.toThrow('runs a merge job');
    expect(killed).toEqual([]);
  });

  it('refuses a second hold and a resume of a card that is not held', async () => {
    cards = [card(4, 'Design')];
    await expect(order('unhold')).rejects.toThrow('not held');
    await order('hold');
    await expect(order('hold')).rejects.toThrow('held already, by Ann');
  });

  it('lets hermes hold and resume a card', async () => {
    cards = [card(4, 'Design')];
    await order('hold', 4, 'hermes');
    expect(readState(statePath).held[4].by).toBe('Hermes');
    await order('unhold', 4, 'hermes');
    expect(readState(statePath).held).toEqual({});
  });
});

describe('a hold across restarts', () => {
  it('stays in the state file, so a new process still skips the card', async () => {
    runningCard();
    await order('hold');
    const reread = readState(statePath);
    expect(chooseJobs(reread, [card(4, 'Implementation')], NOW, CFG)).toEqual([]);
  });

  it('reads an old state file with no holds as none', () => {
    writeFileSync(statePath, JSON.stringify({ jobs: [] }));
    expect(readState(statePath).held).toEqual({});
  });
});

describe('resume-card', () => {
  it('lifts the hold, and the next start of the stage continues the stopped sessions', async () => {
    runningCard();
    await order('hold');
    const text = await order('unhold');
    expect(text).toContain('implement job continues');
    const state = readState(statePath);
    expect(state.held).toEqual({});
    expect(chooseJobs(state, [card(4, 'Implementation')], NOW, CFG)).toEqual([{ stage: 'implement', issue: 4 }]);
    expect(state.interrupted).toEqual([4]);
    expect(resumedStage(ROOT, 4)).toBe('implement');
    expect(existsSync(join(sessionsDir(ROOT, 4), 'implement.id'))).toBe(true);
    expect(controlLines().map((line) => line.kind === 'control' && line.action)).toEqual(['hold', 'unhold']);
  });

  it('lifts the hold of a card that left the board', async () => {
    seed({ held: { 9: { by: 'Ann', reason: 'r', at: NOW.toISOString(), stage: null } } });
    await order('unhold', 9);
    expect(readState(statePath).held).toEqual({});
  });
});
