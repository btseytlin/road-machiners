import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, updateState, writeState } from './state';
import { classifyStuck, sweepStuck, type Repair } from './stuck';
import { STUCK_LABEL, WORK_DIR, type Card, type Ctx, type Failure, type FactoryState, type Job } from './types';

const NOW = new Date('2026-10-09T12:00:00Z');
const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const stuck = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels: [...labels, STUCK_LABEL] });
const ready = (issue: number, column: Card['column'] = 'Merging'): Card => ({ itemId: `i${issue}`, issue, column, labels: [] });
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, index) => from + index);
const mergeDown = (batch: number[], at: string, error = 'timed out after 240 minutes'): Failure => ({ stage: 'merge', issue: null, error, log: `/logs/merge-${at}.log`, at, batch });
const failure = (issue: number, error: string, over: Partial<Failure> = {}): Failure => ({ stage: 'verify', issue, error, log: '/logs/v.log', at: minutesAgo(30), ...over });
const mergeJob = (batch: number[]): Job => ({ id: 'merge-x', stage: 'merge', issue: null, pid: 1, startedAt: minutesAgo(10), log: '/l', batch });

type Board = { ctx: Ctx; cards: Card[]; removed: number[]; repairs: number[]; logs: string[]; failRemove: Set<number> };

function board(cards: Card[], over: Partial<FactoryState> = {}, repairFails: string | null = null): Board & { repair: Repair } {
  const home = mkdtempSync(join(tmpdir(), 'stuck-'));
  const statePath = join(home, 'state.json');
  writeState(statePath, { ...structuredClone(EMPTY_STATE), ...over });
  const b: Board = { ctx: {} as Ctx, cards, removed: [], repairs: [], logs: [], failRemove: new Set() };
  const github = {
    removeLabel: async (issue: number, label: string) => {
      if (b.failRemove.has(issue)) throw new Error('gh issue edit failed with exit 1: HTTP 502');
      expect(label).toBe(STUCK_LABEL);
      b.removed.push(issue);
      b.cards = b.cards.map((card) => (card.issue === issue ? { ...card, labels: card.labels.filter((name) => name !== STUCK_LABEL) } : card));
    },
  };
  b.ctx = { cfg: { home, minFreeGb: 10 }, statePath, github, now: () => NOW, log: (_stage: string, issue: number | null, msg: string) => b.logs.push(`#${issue} ${msg}`) } as unknown as Ctx;
  const repair: Repair = async (ctx, order) => {
    expect(order).toMatchObject({ backupMerge: true, refuseUnpushed: true, by: 'factory' });
    if (repairFails !== null) throw new Error(repairFails);
    b.repairs.push(order.issue);
    await ctx.github.removeLabel(order.issue, STUCK_LABEL);
    return ['repaired'];
  };
  return Object.assign(b, { repair });
}

const sweep = (b: Board & { repair: Repair }, diskOk = true): Promise<Card[]> => sweepStuck(b.ctx, b.cards, diskOk, b.repair);
const kinds = (b: Board): Record<string, string> => Object.fromEntries(Object.entries(readState(b.ctx.statePath).stuck).map(([issue, record]) => [issue, record.kind]));
const openMerge = (b: Board, issue: number): void => {
  const git = join(WORK_DIR(b.ctx.cfg.home, issue), '.git');
  mkdirSync(git, { recursive: true });
  writeFileSync(join(git, 'MERGE_HEAD'), 'abc\n');
};

describe('the stuck sweep', () => {
  it('records every open stuck card on the board, past any page size, and clears none it cannot explain', async () => {
    const cards = range(1, 150).map((issue) => stuck(issue, issue % 2 === 0 ? 'Testing' : 'Design'));
    const b = board([...cards, stuck(900, 'Done'), ready(901, 'Testing')], { failures: [failure(2, 'checks failed: 3 tests')] });
    await sweep(b);
    const records = readState(b.ctx.statePath).stuck;
    expect(Object.keys(records)).toHaveLength(150);
    expect(records['2']).toMatchObject({ kind: 'blocked', incident: `2:verify:${minutesAgo(30)}`, cause: 'checks failed: 3 tests', log: '/logs/v.log' });
    expect(records['1']).toMatchObject({ kind: 'unrecorded', cause: 'no failure names this card' });
    expect(b.removed).toEqual([]);
  });

  it('merges ten timed-out cards half at a time after a running batch of six, and never with the six', async () => {
    const failed = range(10, 10);
    const six = range(30, 6);
    const b = board([...failed.map((issue) => stuck(issue, 'Merging')), ...six.map((issue) => ready(issue))], { jobs: [mergeJob(six)], failures: [mergeDown(failed, minutesAgo(60))] });

    await sweep(b);
    expect(b.removed).toEqual([]);
    expect(new Set(Object.values(kinds(b)))).toEqual(new Set(['merge-batch']));

    updateState(b.ctx.statePath, (state) => ({ ...state, jobs: [] }));
    b.cards = b.cards.map((card) => (six.includes(card.issue) ? { ...card, column: 'Done' } : card));
    const after = await sweep(b);
    expect(b.removed).toEqual(range(10, 5));
    expect(after.filter((card) => card.column === 'Merging' && !card.labels.includes(STUCK_LABEL)).map((card) => card.issue)).toEqual(range(10, 5));

    await sweep(b);
    expect(b.removed).toEqual(range(10, 5));

    updateState(b.ctx.statePath, (state) => ({ ...state, jobs: [mergeJob(range(10, 5))] }));
    await sweep(b);
    expect(b.removed).toEqual(range(10, 5));
    expect(Object.keys(readState(b.ctx.statePath).stuck)).toHaveLength(10);
  });

  it('splits a group that timed out again down to one card, and leaves a lone timeout for Hermes', async () => {
    const b = board([10, 11, 12].map((issue) => stuck(issue, 'Merging')), { failures: [mergeDown([10, 11, 12], minutesAgo(300)), mergeDown([10, 11], minutesAgo(30))] });
    await sweep(b);
    expect(b.removed).toEqual([12]);
    await sweep(b);
    expect(b.removed).toEqual([12]);
    b.cards = b.cards.map((card) => (card.issue === 12 ? { ...card, column: 'Done' } : card));
    await sweep(b);
    expect(b.removed).toEqual([12, 10]);
    updateState(b.ctx.statePath, (state) => ({ ...state, failures: [...state.failures, mergeDown([10], minutesAgo(1))] }));
    b.cards = b.cards.map((card) => (card.issue === 10 ? stuck(10, 'Merging') : card));
    await sweep(b);
    expect(kinds(b)).toMatchObject({ 10: 'blocked', 11: 'merge-batch' });
    expect(b.removed).toEqual([12, 10, 11]);
  });

  it('keeps a failed check of a whole batch and an empty budget blocked', async () => {
    const b = board([stuck(10, 'Merging'), stuck(11, 'Merging')], { failures: [mergeDown([10, 11], minutesAgo(30), 'The stage spent $9.10 of its $8 budget, and its checkpoint still fails.')] });
    await sweep(b);
    expect(kinds(b)).toEqual({ 10: 'blocked', 11: 'blocked' });
    expect(b.removed).toEqual([]);
  });

  it('repairs one stale clone merge per tick with the clone kept, and only once per card in its column', async () => {
    const b = board([stuck(4, 'Testing'), stuck(5, 'Hardening')], { failures: [failure(4, 'The agent left the merge of dev at abc1234 into factory/issue-4 unfinished.'), failure(5, 'job process died without finishing', { stage: 'harden' })] });
    openMerge(b, 4);
    openMerge(b, 5);
    await sweep(b);
    expect(b.repairs).toEqual([4]);
    await sweep(b);
    expect(b.repairs).toEqual([4, 5]);
    b.cards = b.cards.map((card) => (card.issue === 4 ? stuck(4, 'Testing') : card));
    updateState(b.ctx.statePath, (state) => ({ ...state, failures: [failure(4, 'The agent left the merge of dev unfinished.', { at: minutesAgo(1) })] }));
    await sweep(b);
    expect(b.repairs).toEqual([4, 5]);
    expect(kinds(b)).toMatchObject({ 4: 'blocked' });
  });

  it('repairs no clone while the disk is low, and none of a card that asked the committee', async () => {
    const b = board([stuck(4, 'Testing'), stuck(5, 'Testing')], { failures: [failure(4, 'unfinished merge'), failure(5, 'The agent needs a committee decision: pick a color', { decision: true })] });
    openMerge(b, 4);
    openMerge(b, 5);
    await sweep(b, false);
    expect(b.repairs).toEqual([]);
    expect(kinds(b)).toEqual({ 4: 'clone-merge', 5: 'blocked' });
  });

  it('leaves a refused repair for Hermes and does not try it again for the same incident', async () => {
    const b = board([stuck(4, 'Testing')], { failures: [failure(4, 'unfinished merge')] }, 'holds 2 commits on no GitHub branch');
    openMerge(b, 4);
    await sweep(b);
    await sweep(b);
    expect(readState(b.ctx.statePath).stuck['4']).toMatchObject({ kind: 'blocked', refused: 'holds 2 commits on no GitHub branch', tries: 1 });
    expect(b.logs.filter((line) => line.includes('left for Hermes'))).toHaveLength(1);
  });

  it('retries a GitHub outage once, after this tick read the board, and a full disk only once the disk is free', async () => {
    const gh = 'gh api graphql failed with exit 1: \ngh timed out after 30000 ms and was killed';
    const b = board([stuck(4, 'Design'), stuck(5, 'Design')], { failures: [failure(4, gh, { stage: 'design' }), failure(5, 'write failed: ENOSPC: no space left on device', { stage: 'design' })] });
    await sweep(b, false);
    expect(b.removed).toEqual([4]);
    expect(readState(b.ctx.statePath).failures.map((row) => row.issue)).toEqual([5]);
    await sweep(b, true);
    expect(b.removed).toEqual([4, 5]);
    b.cards = b.cards.map((card) => (card.issue === 4 ? stuck(4, 'Design') : card));
    updateState(b.ctx.statePath, (state) => ({ ...state, failures: [failure(4, gh, { stage: 'design', at: minutesAgo(1) })] }));
    await sweep(b);
    expect(b.removed).toEqual([4, 5]);
    expect(kinds(b)).toMatchObject({ 4: 'blocked' });
  });

  it('touches no card with a running job or a hold', async () => {
    const b = board([stuck(4, 'Testing'), stuck(5, 'Testing')], { jobs: [{ ...mergeJob([]), stage: 'verify', issue: 4 }], held: { 5: { by: 'ann', reason: 'r', at: NOW.toISOString(), stage: null } }, failures: [failure(4, 'unfinished merge'), failure(5, 'unfinished merge')] });
    openMerge(b, 4);
    openMerge(b, 5);
    await sweep(b);
    expect(kinds(b)).toEqual({ 4: 'running', 5: 'held' });
    expect(b.repairs).toEqual([]);
  });

  it('keeps a cause after its failure ages out, and opens a new incident on a new failure', async () => {
    const b = board([stuck(4, 'Testing')], { failures: [failure(4, 'checks failed')] });
    await sweep(b);
    const first = readState(b.ctx.statePath).stuck['4']!;
    updateState(b.ctx.statePath, (state) => ({ ...state, failures: [] }));
    await sweep(b);
    expect(readState(b.ctx.statePath).stuck['4']).toEqual(first);
    updateState(b.ctx.statePath, (state) => ({ ...state, failures: [failure(4, 'build failed', { at: minutesAgo(1) })] }));
    await sweep(b);
    expect(readState(b.ctx.statePath).stuck['4']!.incident).toBe(`4:verify:${minutesAgo(1)}`);
    expect(b.logs.filter((line) => line.startsWith('#4 stuck sweep: blocked'))).toHaveLength(2);
  });

  it('drops the record of a card someone else released, and keeps a released card until it leaves its column', async () => {
    const b = board([stuck(4, 'Testing'), stuck(10, 'Merging'), stuck(11, 'Merging')], { failures: [failure(4, 'checks failed'), mergeDown([10, 11], minutesAgo(30))] });
    await sweep(b);
    b.cards = b.cards.map((card) => (card.issue === 4 ? ready(4, 'Testing') : card));
    await sweep(b);
    expect(Object.keys(readState(b.ctx.statePath).stuck)).toEqual(['10', '11']);
    b.cards = b.cards.map((card) => (card.issue === 10 ? { ...card, column: 'Done' } : card));
    await sweep(b);
    expect(Object.keys(readState(b.ctx.statePath).stuck)).toEqual(['11']);
  });

  it('keeps a card stuck and tries again next tick when GitHub refuses the label removal', async () => {
    const b = board([stuck(10, 'Merging'), stuck(11, 'Merging')], { failures: [mergeDown([10, 11], minutesAgo(30))] });
    b.failRemove.add(10);
    const after = await sweep(b);
    expect(after.find((card) => card.issue === 10)!.labels).toContain(STUCK_LABEL);
    expect(kinds(b)).toEqual({ 10: 'merge-batch', 11: 'merge-batch' });
    b.failRemove.clear();
    await sweep(b);
    expect(b.removed).toEqual([10]);
  });

  it('records a crash of the whole sweep and hands the tick its cards unchanged', async () => {
    const broken = { ...stuck(4, 'Testing'), labels: null } as unknown as Card;
    const b = board([broken], { sweepError: null });
    expect(await sweep(b)).toEqual([broken]);
    expect(readState(b.ctx.statePath).sweepError).toContain('includes');
    b.cards = [stuck(4, 'Testing')];
    await sweep(b);
    expect(readState(b.ctx.statePath).sweepError).toBeNull();
  });

  it('classifies without writing anything', () => {
    const state = { ...structuredClone(EMPTY_STATE), failures: [mergeDown([10, 11], minutesAgo(30))] };
    const records = classifyStuck({ state, cards: [stuck(10, 'Merging'), stuck(11, 'Merging')], now: NOW, diskOk: true, marks: () => [] });
    expect(Object.values(records).map((record) => [record.kind, record.batch])).toEqual([['merge-batch', 2], ['merge-batch', 2]]);
    expect(state.stuck).toEqual({});
  });
});
