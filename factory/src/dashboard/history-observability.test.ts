import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { DashboardHistory } from './history';
import { appendLedger, type AgentUsage } from '../ledger';
import { recordObservation } from '../observability';
const homes: string[] = [];
function createHome() { mkdirSync('tmp', { recursive: true }); const home = mkdtempSync('tmp/analytics-'); homes.push(home); return home; }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function createUsage(cost: number, tokens: number, resumed: boolean): AgentUsage { return { model: 'model', sessionId: 'session', resumed, minutes: 1, costUsd: cost, modelUsage: [{ model: 'model', input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost }] }; }
it('counts resumed cumulative usage once and links retry spend to the repeat attempt', async () => {
  const home = createHome();
  appendLedger(home, { kind: 'job', id: 'first', issue: 1, stage: 'design', startedAt: '2026-10-04T10:00:00Z', endedAt: '2026-10-04T10:01:00Z', outcome: 'died', agents: [createUsage(2, 200, false)], retryOf: null });
  appendLedger(home, { kind: 'job', id: 'second', issue: 1, stage: 'design', startedAt: '2026-10-04T10:02:00Z', endedAt: '2026-10-04T10:03:00Z', outcome: 'done', agents: [createUsage(3, 300, true)], retryOf: 'first' });
  const history = new DashboardHistory(home, 60000);
  await history.refresh(new Date('2026-10-04T10:04:00Z'));
  const summary = history.summarize(new Date('2026-10-04T10:04:00Z'), 1);
  expect(summary.cost).toBe(3);
  expect(summary.tokens?.input).toBe(300);
  expect(summary.stageModels).toEqual([{ stage: 'design', model: 'model', input: 300, output: 0, cacheRead: 0, cacheWrite: 0, cost: 3 }]);
  expect(summary.retries).toEqual([{ outcome: 'died', runs: 1, workerMs: 60000, cost: 1 }]);
});
it('crosses measured model tokens with the stage that ran them without inventing older counts', async () => {
  const home = createHome();
  const at = '2026-10-04T10:00:00Z';
  const agent = (model: string, input: number, output: number, cacheRead: number, cost: number): AgentUsage =>
    ({ model, costUsd: cost, minutes: 1, modelUsage: [{ model, input, output, cacheRead, cacheWrite: 0, cost }] });
  appendLedger(home, { kind: 'job', id: 'design', stage: 'design', issue: 1, startedAt: at, endedAt: at, outcome: 'done', agents: [agent('opus', 10, 20, 30, 1)] });
  appendLedger(home, { kind: 'job', id: 'verify', stage: 'verify', issue: 1, startedAt: at, endedAt: at, outcome: 'done', agents: [agent('sonnet', 4, 5, 6, 2), agent('opus', 7, 8, 9, 3)] });
  appendLedger(home, { kind: 'job', id: 'old', stage: 'verify', issue: 1, startedAt: at, endedAt: at, outcome: 'done', agents: [{ model: 'opus', costUsd: 4, minutes: 1 }] });
  const history = new DashboardHistory(home, 60000);
  await history.refresh(new Date(at));
  const summary = history.summarize(new Date(at), 1);
  expect(summary.stageModels).toEqual([
    { stage: 'design', model: 'opus', input: 10, output: 20, cacheRead: 30, cacheWrite: 0, cost: 1 },
    { stage: 'verify', model: 'sonnet', input: 4, output: 5, cacheRead: 6, cacheWrite: 0, cost: 2 },
    { stage: 'verify', model: 'opus', input: 7, output: 8, cacheRead: 9, cacheWrite: 0, cost: 3 },
  ]);
  expect(summary.missingUsage).toBe(1);
  expect(summary.tokens).toEqual({ input: 21, output: 33, cacheRead: 45, cacheWrite: 0 });
});
it('measures observed waits once per issue, not once per blocking reason', async () => {
  const home = createHome();
  const report = { picks: [], decisions: [{ stage: 'design' as const, issue: 1, reasons: ['queue-full' as const, 'card-budget' as const] }], release: { reason: 'uncut' as const, issues: [] } };
  recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report, counts: { Design: 1 } }, new Date('2026-10-04T10:00:00Z'));
  recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report: { ...report, decisions: [] }, counts: {} }, new Date('2026-10-04T10:01:00Z'));
  const history = new DashboardHistory(home, 60000);
  const now = new Date('2026-10-04T10:02:00Z');
  await history.refresh(now);
  const summary = history.summarize(now, 1);
  expect(summary.waitingMs).toBe(60000);
  expect(summary.waitingStages).toEqual([{ stage: 'design', workerMs: 60000 }]);
});
it('sums waiting card-time per card and measures the clock time once', async () => {
  const home = createHome();
  const decisions = [{ stage: 'verify' as const, issue: 1, reasons: ['queue-full' as const] }, { stage: 'verify' as const, issue: 2, reasons: ['queue-full' as const] }, { stage: 'verify' as const, issue: 3, reasons: ['issue-running' as const] }];
  const report = { picks: [], decisions, release: { reason: 'uncut' as const, issues: [] } };
  recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report, counts: {} }, new Date('2026-10-04T10:00:00Z'));
  recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report: { ...report, decisions: [] }, counts: {} }, new Date('2026-10-04T10:01:00Z'));
  const history = new DashboardHistory(home, 60000);
  const now = new Date('2026-10-04T10:02:00Z');
  await history.refresh(now);
  const summary = history.summarize(now, 1);
  expect(summary.waitingMs).toBe(120000);
  expect(summary.waitingSpanMs).toBe(120000);
});
it('keeps unrecorded waiting time unavailable', async () => {
  const home = createHome();
  const history = new DashboardHistory(home, 60000);
  await history.refresh(new Date());
  expect(history.summarize(new Date(), 7).waitingMs).toBeNull();
});
