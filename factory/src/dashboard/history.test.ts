import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { appendLedger, type AgentUsage } from '../ledger';
import { DashboardHistory } from './history';

it('streams new ledger lines once and keeps private routes out of public history', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'job', id: 'job-1', stage: 'design', issue: 12, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'done', agents: [
      { model: 'sonnet', costUsd: 1.5, minutes: 5, modelUsage: [{ model: 'sonnet', input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 1.5 }] },
    ] });
    appendLedger(home, { kind: 'route', issue: 12, route: 'answer', by: 'PRIVATE', at: '2026-10-10T11:00:00Z' });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.completed).toBe(1);
    expect(summary.cost).toBe(1.5);
    expect(summary.tokens).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
    appendLedger(home, { kind: 'post', id: 9, text: 'PRIVATE committee post', at: '2026-10-10T11:00:00Z' });
    appendLedger(home, { kind: 'post', id: 10, channel: '@public_factory', text: 'Public release', at: '2026-10-10T11:01:00Z' });
    appendLedger(home, { kind: 'post', id: 11, channel: '-1001', text: 'PRIVATE new post', at: '2026-10-10T11:02:00Z' });
    await history.refresh(now);
    expect(history.readPosts(now, '@public_factory')).toEqual([{ id: 10, text: 'Public release', at: '2026-10-10T11:01:00Z' }]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('reads past committee control lines without publishing them', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'control', action: 'move', issue: 12, by: 'PRIVATE', reason: 'PRIVATE reason', at: '2026-10-10T11:00:00Z' });
    appendLedger(home, { kind: 'job', id: 'job-1', stage: 'design', issue: 12, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'done', agents: [] });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.completed).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('reports token coverage as missing for older cost-only records', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'job', id: 'old', stage: 'verify', issue: 9, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'timeout', agents: [{ model: 'sonnet', costUsd: 2, minutes: 1 }] });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.tokens).toBeNull();
    expect(summary.cost).toBe(2);
    expect(summary.buckets).toEqual([{ start: '2026-10-10T11', cost: 2, tokens: null, stages: { verify: { cost: 2, tokens: 0 } }, models: { unattributed: { cost: 2, tokens: 0 } } }]);
    expect(summary.missingUsage).toBe(1);
    expect(summary.timeouts).toBe(1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('splits usage into hourly buckets for one day and daily buckets for longer ranges, by stage and model', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:30:00Z');
    const usage = (model: string, cost: number) => ({ model, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost });
    appendLedger(home, { kind: 'job', id: 'a', stage: 'design', issue: 1, startedAt: '2026-10-10T09:00:00Z', endedAt: '2026-10-10T09:50:00Z', outcome: 'done', agents: [{ model: 'opus', costUsd: 3, minutes: 1, modelUsage: [usage('claude-opus-5-5', 2), usage('claude-haiku-4-5', 1)] }] });
    appendLedger(home, { kind: 'job', id: 'b', stage: 'verify', issue: 2, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:10:00Z', outcome: 'done', agents: [{ model: 'sonnet', costUsd: 1, minutes: 1, modelUsage: [usage('claude-sonnet-5-5', 1)] }] });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    expect(history.summarize(now, 1).buckets).toEqual([
      { start: '2026-10-10T09', cost: 3, tokens: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8 }, stages: { design: { cost: 3, tokens: 20 } }, models: { 'claude-opus-5-5': { cost: 2, tokens: 10 }, 'claude-haiku-4-5': { cost: 1, tokens: 10 } } },
      { start: '2026-10-10T11', cost: 1, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, stages: { verify: { cost: 1, tokens: 10 } }, models: { 'claude-sonnet-5-5': { cost: 1, tokens: 10 } } },
    ]);
    const week = history.summarize(now, 7).buckets;
    expect(week.map((bucket) => [bucket.start, bucket.cost])).toEqual([['2026-10-10', 4]]);
    expect(week[0].stages).toEqual({ design: { cost: 3, tokens: 20 }, verify: { cost: 1, tokens: 10 } });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('counts the spend of failed, dead and timed-out jobs as wasted, and a resumed agent result as its own run', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    const usage = (input: number, cost: number) => [{ model: 'opus', input, output: 0, cacheRead: 0, cacheWrite: 0, cost }];
    appendLedger(home, { kind: 'job', id: 'dead', stage: 'implement', issue: 3, startedAt: '2026-10-10T08:00:00Z', endedAt: '2026-10-10T09:00:00Z', outcome: 'died', agents: [
      { model: 'opus', costUsd: 0.1 + 0.2, minutes: 60, modelUsage: usage(100, 0.1 + 0.2), sessionId: 's1', resumed: false, fromTranscript: true },
    ] });
    appendLedger(home, { kind: 'job', id: 'resumed', stage: 'implement', issue: 3, startedAt: '2026-10-10T09:01:00Z', endedAt: '2026-10-10T10:00:00Z', outcome: 'done', agents: [
      { model: 'opus', costUsd: 0.3, minutes: 59, modelUsage: usage(100, 0.3), sessionId: 's1', resumed: true },
    ] });
    appendLedger(home, { kind: 'job', id: 'failed', stage: 'verify', issue: 4, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'failed', agents: [
      { model: 'opus', costUsd: 2, minutes: 60, modelUsage: usage(50, 2) },
    ] });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.wasted.cost).toBeCloseTo(2.3, 9);
    expect(summary.wasted.tokens).toEqual({ input: 150, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(summary.cost).toBeCloseTo(2.6, 9);
    expect(summary.tokens?.input).toBe(250);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('counts a resumed transcript reading only past the spend its session already recorded', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    const usage = (input: number, cost: number) => [{ model: 'opus', input, output: 0, cacheRead: 0, cacheWrite: 0, cost }];
    const run = (id: string, at: string, outcome: 'died' | 'failed', agent: AgentUsage) => appendLedger(home, { kind: 'job', id, stage: 'implement', issue: 3, startedAt: at, endedAt: at, outcome, agents: [agent] });
    run('first', '2026-10-10T08:00:00Z', 'failed', { model: 'opus', costUsd: 1, minutes: 1, modelUsage: usage(100, 1), sessionId: 's1', resumed: false });
    run('second', '2026-10-10T09:00:00Z', 'failed', { model: 'opus', costUsd: 2, minutes: 1, modelUsage: usage(40, 2), sessionId: 's1', resumed: true });
    run('third', '2026-10-10T10:00:00Z', 'died', { model: 'opus', costUsd: 3.5, minutes: 1, modelUsage: usage(150, 3.5), sessionId: 's1', resumed: true, fromTranscript: true });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.cost).toBeCloseTo(3.5, 9);
    expect(summary.tokens?.input).toBe(150);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('counts a held job as neither finished nor failed, and its spend as no waste', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'job', id: 'held', stage: 'implement', issue: 3, startedAt: '2026-10-10T08:00:00Z', endedAt: '2026-10-10T09:00:00Z', outcome: 'held', agents: [
      { model: 'opus', costUsd: 1, minutes: 60, modelUsage: [{ model: 'opus', input: 10, output: 0, cacheRead: 0, cacheWrite: 0, cost: 1 }], fromTranscript: true },
    ] });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary).toMatchObject({ completed: 0, failed: 0, wasted: { cost: null, tokens: null } });
    expect(summary.cost).toBe(1);
    expect(summary.activity).toEqual([{ stage: 'implement', issue: 3, outcome: 'held', at: '2026-10-10T09:00:00Z' }]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('keeps card lines past the 30 days of usage and publishes delivery numbers with no private text', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'card', issue: 31, step: 'entered', to: 'Triage', at: '2026-08-01T00:00:00Z' });
    appendLedger(home, { kind: 'card', issue: 31, step: 'accepted', to: 'Design', at: '2026-08-02T00:00:00Z' });
    appendLedger(home, { kind: 'route', issue: 31, route: 'patch', by: 'PRIVATE', at: '2026-10-09T00:00:00Z' });
    appendLedger(home, { kind: 'control', action: 'move', issue: 31, by: 'PRIVATE', reason: 'PRIVATE reason', at: '2026-10-09T00:00:00Z' });
    appendLedger(home, { kind: 'card', issue: 31, step: 'merged', to: 'Done', at: '2026-10-10T00:00:00Z' });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    const delivery = history.summarize(now, 7).delivery!;
    expect(delivery.since).toBe('2026-08-01T00:00:00Z');
    expect(delivery.lead).toMatchObject({ open: 0, missingStart: 0 });
    expect(JSON.stringify(delivery)).not.toContain('PRIVATE');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('shows delivery as unrecorded when the ledger has no card lines', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'job', id: 'job-1', stage: 'design', issue: 12, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'failed', agents: [] });
    const history = new DashboardHistory(home, 60000);
    await history.refresh(now);
    expect(history.summarize(now, 30).delivery).toBeNull();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
