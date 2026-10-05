import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { appendLedger } from '../ledger';
import { DashboardHistory } from './history';

it('streams new ledger lines once and keeps private routes out of public history', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'job', id: 'job-1', stage: 'design', issue: 12, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'done', agents: [
      { model: 'sonnet', costUsd: 1.5, minutes: 5, modelUsage: [{ model: 'sonnet', input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 1.5 }] },
    ] });
    appendLedger(home, { kind: 'route', issue: 12, route: 'answer', by: 'PRIVATE', at: '2026-10-10T11:00:00Z' });
    const history = new DashboardHistory(home);
    await history.refresh(now);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.completed).toBe(1);
    expect(summary.cost).toBe(1.5);
    expect(summary.tokens).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
    appendLedger(home, { kind: 'post', id: 10, text: 'Public release', at: '2026-10-10T11:01:00Z' });
    await history.refresh(now);
    expect(history.readPosts(now)).toEqual([{ id: 10, text: 'Public release', at: '2026-10-10T11:01:00Z' }]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('reports token coverage as missing for older cost-only records', async () => {
  const home = mkdtempSync(resolve('tmp/history-'));
  try {
    const now = new Date('2026-10-10T12:00:00Z');
    appendLedger(home, { kind: 'job', id: 'old', stage: 'verify', issue: 9, startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T11:00:00Z', outcome: 'timeout', agents: [{ model: 'sonnet', costUsd: 2, minutes: 1 }] });
    const history = new DashboardHistory(home);
    await history.refresh(now);
    const summary = history.summarize(now, 1);
    expect(summary.tokens).toBeNull();
    expect(summary.cost).toBe(2);
    expect(summary.missingUsage).toBe(1);
    expect(summary.timeouts).toBe(1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
