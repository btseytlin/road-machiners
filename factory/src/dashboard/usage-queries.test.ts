import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentUsage, JobOutcome, LedgerLine, ModelUsage } from '../ledger';
import type { JobStage } from '../types';
import { AnalyticsRunner, type Analytics, type PanelName, type PanelRows } from './analytics';

const NOW = new Date('2026-10-10T12:00:00Z');
const PANELS: PanelName[] = ['problems', 'coverage', 'counters', 'usage_buckets', 'stage_time', 'waiting', 'waiting_stages', 'retries', 'stage_models', 'activity'];
const SCHEDULER_PANELS: PanelName[] = ['waiting', 'waiting_stages'];

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

type Line = LedgerLine | Record<string, unknown> | string;
async function run(lines: Line[], now = NOW, budgetMs = 60000): Promise<Analytics> {
  mkdirSync('tmp', { recursive: true });
  const dir = mkdtempSync(join('tmp', 'usage-queries-'));
  dirs.push(dir);
  const path = join(dir, 'ledger.jsonl');
  writeFileSync(path, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n');
  const result = await (await AnalyticsRunner.open()).read(path, now, budgetMs);
  for (const name of PANELS) expect(result[name].error, name).toBeNull();
  return result;
}
function rows<K extends PanelName>(result: Analytics, panel: K, days: 1 | 7 | 30 = 1): PanelRows[K][] { return result[panel].ranges![days]; }

const usage = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number, cost: number): ModelUsage => ({ model, input, output, cacheRead, cacheWrite, cost });
const agent = (model: string, costUsd: number, modelUsage?: ModelUsage[], extra: Partial<AgentUsage> = {}): AgentUsage => ({ model, costUsd, minutes: 1, ...(modelUsage ? { modelUsage } : {}), ...extra });
function job(id: string, stage: JobStage, issue: number, startedAt: string, endedAt: string, outcome: JobOutcome, agents: AgentUsage[], retryOf?: string): LedgerLine {
  return { kind: 'job', id, stage, issue, startedAt, endedAt, outcome, agents, ...(retryOf === undefined ? {} : { retryOf }) };
}
function schedulerLine(at: string, decisions: { stage: string; issue: number; reasons: string[] }[]): Record<string, unknown> {
  const report = { picks: [], decisions, release: { reason: 'uncut', issues: [] } };
  return { kind: 'observation', producer: 'scheduler', at, since: at, data: { type: 'scheduler', status: 'ready', report, counts: {} } };
}

describe('usage queries', () => {
  it('sums one job into counters and keeps private route and control text out of every panel', async () => {
    const result = await run([
      job('job-1', 'design', 12, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'done', [agent('sonnet', 1.5, [usage('sonnet', 10, 20, 30, 40, 1.5)])]),
      { kind: 'route', issue: 12, route: 'answer', by: 'PRIVATE', at: '2026-10-10T11:00:00Z' },
      { kind: 'control', action: 'move', issue: 12, by: 'PRIVATE', reason: 'PRIVATE reason', at: '2026-10-10T11:00:00Z' },
      { kind: 'post', id: 9, text: 'PRIVATE committee post', at: '2026-10-10T11:00:00Z' },
    ]);
    expect(rows(result, 'counters')).toEqual([{ worker_ms: 3_600_000, cost: 1.5, input: 10, output: 20, cache_read: 30, cache_write: 40, wasted_cost: null, wasted_input: null, wasted_output: null, wasted_cache_read: null, wasted_cache_write: null }]);
    expect(rows(result, 'problems')).toEqual([{ unreadable: 0, untimed: 0, uncosted: 0 }]);
    expect(rows(result, 'stage_time')).toEqual([{ stage: 'design', worker_ms: 3_600_000 }]);
    expect(rows(result, 'coverage')).toEqual([{ since: '2026-10-10T11:00:00Z', missing_usage: 0 }]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('reports token coverage as missing for older cost-only records', async () => {
    const result = await run([job('old', 'verify', 9, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'timeout', [agent('sonnet', 2)])]);
    expect(rows(result, 'counters')[0]).toMatchObject({ cost: 2, input: null, output: null, cache_read: null, cache_write: null });
    expect(rows(result, 'usage_buckets')).toEqual([
      { start: '2026-10-10T11', grouping: 'model', key: 'unattributed', cost: 2, tokens: null },
      { start: '2026-10-10T11', grouping: 'stage', key: 'verify', cost: 2, tokens: null },
    ]);
    expect(rows(result, 'coverage')[0].missing_usage).toBe(1);
    expect(rows(result, 'activity')).toEqual([{ stage: 'verify', issue: 9, outcome: 'timeout', at: '2026-10-10T11:00:00Z' }]);
  });

  it('splits usage into hourly buckets for one day and daily buckets for longer ranges, by stage and model', async () => {
    const now = new Date('2026-10-10T12:30:00Z');
    const result = await run([
      job('a', 'design', 1, '2026-10-10T09:00:00Z', '2026-10-10T09:50:00Z', 'done', [agent('opus', 3, [usage('claude-opus-5-5', 1, 2, 3, 4, 2), usage('claude-haiku-4-5', 1, 2, 3, 4, 1)])]),
      job('b', 'verify', 2, '2026-10-10T10:00:00Z', '2026-10-10T11:10:00Z', 'done', [agent('sonnet', 1, [usage('claude-sonnet-5-5', 1, 2, 3, 4, 1)])]),
    ], now);
    expect(rows(result, 'usage_buckets', 1)).toEqual([
      { start: '2026-10-10T09', grouping: 'model', key: 'claude-haiku-4-5', cost: 1, tokens: 10 },
      { start: '2026-10-10T09', grouping: 'model', key: 'claude-opus-5-5', cost: 2, tokens: 10 },
      { start: '2026-10-10T09', grouping: 'stage', key: 'design', cost: 3, tokens: 20 },
      { start: '2026-10-10T11', grouping: 'model', key: 'claude-sonnet-5-5', cost: 1, tokens: 10 },
      { start: '2026-10-10T11', grouping: 'stage', key: 'verify', cost: 1, tokens: 10 },
    ]);
    const week = rows(result, 'usage_buckets', 7);
    expect(new Set(week.map((bucket) => bucket.start))).toEqual(new Set(['2026-10-10']));
    expect(week.filter((bucket) => bucket.grouping === 'stage')).toEqual([
      { start: '2026-10-10', grouping: 'stage', key: 'design', cost: 3, tokens: 20 },
      { start: '2026-10-10', grouping: 'stage', key: 'verify', cost: 1, tokens: 10 },
    ]);
    expect(rows(result, 'counters', 1)[0]).toMatchObject({ cost: 4, input: 3, output: 6, cache_read: 9, cache_write: 12 });
  });

  it('buckets a cost-only agent under the unattributed model, hourly for one day and daily for a week', async () => {
    const result = await run([job('old', 'verify', 9, '2026-10-10T10:00:00Z', '2026-10-10T11:20:00Z', 'done', [agent('sonnet', 2)])]);
    expect(rows(result, 'usage_buckets', 1).filter((bucket) => bucket.grouping === 'model')).toEqual([{ start: '2026-10-10T11', grouping: 'model', key: 'unattributed', cost: 2, tokens: null }]);
    expect(rows(result, 'usage_buckets', 7).filter((bucket) => bucket.grouping === 'model')).toEqual([{ start: '2026-10-10', grouping: 'model', key: 'unattributed', cost: 2, tokens: null }]);
    expect(rows(result, 'usage_buckets', 30).filter((bucket) => bucket.grouping === 'model')).toEqual([{ start: '2026-10-10', grouping: 'model', key: 'unattributed', cost: 2, tokens: null }]);
  });

  it('counts the spend of failed, dead and timed-out jobs as wasted, and sums a resumed run like any other run', async () => {
    const single = (input: number, cost: number) => [usage('opus', input, 0, 0, 0, cost)];
    const result = await run([
      job('dead', 'implement', 3, '2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z', 'died', [agent('opus', 0.1 + 0.2, single(100, 0.1 + 0.2), { sessionId: 's1', resumed: false, fromTranscript: true })]),
      job('resumed', 'implement', 3, '2026-10-10T09:01:00Z', '2026-10-10T10:00:00Z', 'done', [agent('opus', 0.3, single(100, 0.3), { sessionId: 's1', resumed: true })]),
      job('failed', 'verify', 4, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'failed', [agent('opus', 2, single(50, 2))]),
    ]);
    const counters = rows(result, 'counters')[0];
    expect(counters.wasted_cost).toBeCloseTo(2.3, 9);
    expect(counters).toMatchObject({ wasted_input: 150, wasted_output: 0, wasted_cache_read: 0, wasted_cache_write: 0, input: 250, output: 0 });
    expect(counters.cost).toBeCloseTo(2.6, 9);
  });

  it('counts a resumed fromTranscript record as its own spend', async () => {
    const result = await run([
      job('first', 'design', 1, '2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z', 'done', [agent('opus', 1, [usage('opus', 10, 0, 0, 0, 1)], { sessionId: 's', resumed: false })]),
      job('second', 'design', 1, '2026-10-10T09:00:00Z', '2026-10-10T10:00:00Z', 'done', [agent('opus', 4, [usage('opus', 40, 0, 0, 0, 4)], { sessionId: 's', resumed: true, fromTranscript: true })]),
    ]);
    expect(rows(result, 'counters')[0]).toMatchObject({ cost: 5, input: 50 });
    expect(rows(result, 'stage_models')).toEqual([{ stage: 'design', model: 'opus', input: 50, output: 0, cache_read: 0, cache_write: 0, cost: 5 }]);
  });

  it('counts a held job as no waste', async () => {
    const result = await run([job('held', 'implement', 3, '2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z', 'held', [agent('opus', 1, [usage('opus', 10, 0, 0, 0, 1)], { fromTranscript: true })])]);
    expect(rows(result, 'counters')[0]).toMatchObject({ cost: 1, wasted_cost: null, wasted_input: null, wasted_output: null, wasted_cache_read: null, wasted_cache_write: null });
    expect(rows(result, 'activity')).toEqual([{ stage: 'implement', issue: 3, outcome: 'held', at: '2026-10-10T09:00:00Z' }]);
  });

  it('keeps card lines past the 30 days of usage and publishes no private text', async () => {
    const result = await run([
      { kind: 'card', issue: 31, step: 'entered', to: 'Triage', at: '2026-08-01T00:00:00Z' },
      { kind: 'card', issue: 31, step: 'accepted', to: 'Design', at: '2026-08-02T00:00:00Z' },
      { kind: 'route', issue: 31, route: 'patch', by: 'PRIVATE', at: '2026-10-09T00:00:00Z' },
      { kind: 'control', action: 'move', issue: 31, by: 'PRIVATE', reason: 'PRIVATE reason', at: '2026-10-09T00:00:00Z' },
      { kind: 'card', issue: 31, step: 'merged', to: 'Done', at: '2026-10-10T00:00:00Z' },
    ]);
    expect(result.delivery_coverage.error).toBeNull();
    expect(result.lead.error).toBeNull();
    expect(result.delivery_coverage.ranges![7][0].since).toBe('2026-08-01T00:00:00Z');
    expect(result.lead.ranges![7][0]).toMatchObject({ open: 0, missing_start: 0 });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('shows delivery as unrecorded when the ledger has no card lines', async () => {
    const result = await run([job('job-1', 'design', 12, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'failed', [])]);
    expect(result.delivery_coverage.error).toBeNull();
    expect(result.delivery_coverage.ranges![30]).toEqual([{ since: null, issues: 0, excluded: 0, legacy: 0, looped: 0 }]);
  });

  it('sums resumed usage like any other run and links retry spend to the repeat attempt', async () => {
    const agentUsage = (cost: number, tokens: number, resumed: boolean) => agent('model', cost, [usage('model', tokens, 0, 0, 0, cost)], { sessionId: 'session', resumed });
    const now = new Date('2026-10-04T10:04:00Z');
    const result = await run([
      job('first', 'design', 1, '2026-10-04T10:00:00Z', '2026-10-04T10:01:00Z', 'died', [agentUsage(2, 200, false)], undefined),
      job('second', 'design', 1, '2026-10-04T10:02:00Z', '2026-10-04T10:03:00Z', 'done', [agentUsage(3, 300, true)], 'first'),
    ], now);
    expect(rows(result, 'counters')[0]).toMatchObject({ cost: 5, input: 500 });
    expect(rows(result, 'stage_models')).toEqual([{ stage: 'design', model: 'model', input: 500, output: 0, cache_read: 0, cache_write: 0, cost: 5 }]);
    expect(rows(result, 'retries')).toEqual([{ outcome: 'died', runs: 1, worker_ms: 60000, cost: 3 }]);
  });

  it('finds the outcome of the previous attempt among all ledger jobs, not only the last 30 days', async () => {
    const result = await run([
      job('first', 'design', 1, '2026-07-01T10:00:00Z', '2026-07-01T10:01:00Z', 'timeout', [agent('model', 1)]),
      job('second', 'design', 1, '2026-10-09T10:00:00Z', '2026-10-09T10:01:00Z', 'done', [agent('model', 2)], 'first'),
    ]);
    expect(rows(result, 'retries', 30)).toEqual([{ outcome: 'timeout', runs: 1, worker_ms: 60000, cost: 2 }]);
  });

  it('crosses measured model tokens with the stage that ran them without inventing older counts', async () => {
    const at = '2026-10-04T10:00:00Z';
    const measured = (model: string, input: number, output: number, cacheRead: number, cost: number) => agent(model, cost, [usage(model, input, output, cacheRead, 0, cost)]);
    const result = await run([
      job('design', 'design', 1, at, at, 'done', [measured('opus', 10, 20, 30, 1)]),
      job('verify', 'verify', 1, at, at, 'done', [measured('sonnet', 4, 5, 6, 2), measured('opus', 7, 8, 9, 3)]),
      job('old', 'verify', 1, at, at, 'done', [agent('opus', 4)]),
    ], new Date(at));
    const stageModels = rows(result, 'stage_models');
    expect(stageModels).toEqual([
      { stage: 'design', model: 'opus', input: 10, output: 20, cache_read: 30, cache_write: 0, cost: 1 },
      { stage: 'verify', model: 'sonnet', input: 4, output: 5, cache_read: 6, cache_write: 0, cost: 2 },
      { stage: 'verify', model: 'opus', input: 7, output: 8, cache_read: 9, cache_write: 0, cost: 3 },
    ]);
    const models = new Map<string, number[]>();
    for (const row of stageModels) {
      const total = models.get(row.model) ?? [0, 0, 0, 0, 0];
      models.set(row.model, [total[0] + row.input, total[1] + row.output, total[2] + row.cache_read, total[3] + row.cache_write, total[4] + row.cost]);
    }
    expect(Object.fromEntries(models)).toEqual({ opus: [17, 28, 39, 0, 4], sonnet: [4, 5, 6, 0, 2] });
    expect(rows(result, 'coverage')[0].missing_usage).toBe(1);
    expect(rows(result, 'counters')[0]).toMatchObject({ input: 21, output: 33, cache_read: 45, cache_write: 0 });
  });

  it('measures observed waits once per issue, not once per blocking reason', async () => {
    const result = await run([
      schedulerLine('2026-10-04T10:00:00.000Z', [{ stage: 'design', issue: 1, reasons: ['queue-full', 'card-budget'] }]),
      schedulerLine('2026-10-04T10:01:00.000Z', []),
    ], new Date('2026-10-04T10:02:00Z'));
    expect(rows(result, 'waiting')).toEqual([{ waiting_ms: 60000, span_ms: 120000, gaps: 0 }]);
    expect(rows(result, 'waiting_stages')).toEqual([{ stage: 'design', waiting_ms: 60000 }]);
  });

  it('sums waiting card-time per card and measures the clock time once', async () => {
    const decisions = [{ stage: 'verify', issue: 1, reasons: ['queue-full'] }, { stage: 'verify', issue: 2, reasons: ['queue-full'] }, { stage: 'verify', issue: 3, reasons: ['issue-running'] }];
    const result = await run([schedulerLine('2026-10-04T10:00:00.000Z', decisions), schedulerLine('2026-10-04T10:01:00.000Z', [])], new Date('2026-10-04T10:02:00Z'));
    expect(rows(result, 'waiting')).toEqual([{ waiting_ms: 120000, span_ms: 120000, gaps: 0 }]);
    expect(rows(result, 'waiting_stages')).toEqual([{ stage: 'verify', waiting_ms: 120000 }]);
  });

  it('keeps unrecorded waiting time unavailable', async () => {
    const result = await run([]);
    expect(rows(result, 'waiting', 7)).toEqual([{ waiting_ms: null, span_ms: 0, gaps: 0 }]);
    expect(rows(result, 'waiting_stages', 7)).toEqual([]);
  });

  it('counts a gap when the next scheduler report comes later than the budget', async () => {
    const result = await run([schedulerLine('2026-10-04T10:00:00.000Z', [{ stage: 'design', issue: 1, reasons: ['queue-full'] }]), schedulerLine('2026-10-04T10:10:00.000Z', [])], new Date('2026-10-04T10:10:30Z'));
    expect(rows(result, 'waiting')[0]).toMatchObject({ waiting_ms: 60000, gaps: 1 });
  });

  it('reports an unreadable line and a non-numeric cost, and still totals the other jobs', async () => {
    const bad = { ...job('bad', 'verify', 2, '2026-10-10T09:00:00Z', '2026-10-10T10:00:00Z', 'done', []), agents: [{ model: 'opus', costUsd: 'lots', minutes: 1 }] };
    const result = await run([
      job('good', 'design', 1, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'done', [agent('sonnet', 1.5, [usage('sonnet', 10, 20, 30, 40, 1.5)])]),
      'this is not json {',
      bad,
    ]);
    expect(rows(result, 'problems')).toEqual([{ unreadable: 1, untimed: 0, uncosted: 1 }]);
    expect(rows(result, 'counters')[0]).toMatchObject({ cost: 1.5, input: 10, output: 20, cache_read: 30, cache_write: 40 });
  });

  it('changes no panel result for a new unknown line kind', async () => {
    const lines: Line[] = [
      job('a', 'design', 1, '2026-10-10T09:00:00Z', '2026-10-10T10:00:00Z', 'failed', [agent('opus', 2, [usage('opus', 1, 2, 3, 4, 2)])]),
      job('b', 'design', 1, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'done', [agent('opus', 3, [usage('opus', 1, 2, 3, 4, 3)])], 'a'),
      schedulerLine('2026-10-10T10:00:00.000Z', [{ stage: 'design', issue: 1, reasons: ['queue-full'] }]),
    ];
    const plain = await run(lines);
    const withFuture = await run([...lines, { kind: 'future', at: '2026-10-10T11:30:00Z', payload: 'PRIVATE' }]);
    for (const name of [...PANELS, ...SCHEDULER_PANELS]) expect(withFuture[name], name).toEqual(plain[name]);
  });
});
