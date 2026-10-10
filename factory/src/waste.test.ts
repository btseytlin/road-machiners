import { describe, expect, it } from 'vitest';
import type { AgentUsage, JobOutcome, LedgerLine } from './ledger';
import type { JobStage } from './types';
import { formatNumbers, wasteNumbers } from './waste';

const FROM = new Date('2026-10-01T00:00:00Z');
const TO = new Date('2026-10-08T00:00:00Z');

let next = 0;
function job(stage: JobStage, issue: number | null, startedAt: string, endedAt: string, agents: AgentUsage[] = [], outcome: JobOutcome = 'done'): LedgerLine {
  next += 1;
  return { kind: 'job', id: `j${next}`, stage, issue, startedAt, endedAt, outcome, agents };
}

const opus = (costUsd: number, minutes: number) => ({ model: 'opus', costUsd, minutes });
const sonnet = (costUsd: number, minutes: number) => ({ model: 'sonnet', costUsd, minutes });

const LEDGER: LedgerLine[] = [
  job('implement', 131, '2026-10-02T15:32:00Z', '2026-10-02T16:02:00Z', [opus(4, 30)]),
  job('verify', 131, '2026-10-02T19:16:00Z', '2026-10-02T20:30:00Z', [opus(3, 17), opus(5, 47)]),
  { kind: 'route', issue: 131, route: 'redesign', by: 'Boris', at: '2026-10-02T21:28:00Z' },
  job('design', 131, '2026-10-02T21:29:00Z', '2026-10-02T21:34:00Z', [opus(1.5, 5)]),
  job('implement', 7, '2026-10-03T10:00:00Z', '2026-10-03T10:20:00Z', [sonnet(0.5, 20)]),
  job('verify', 7, '2026-10-03T10:30:00Z', '2026-10-03T10:40:00Z', [sonnet(0.2, 10)], 'failed'),
  job('verify', 7, '2026-10-03T11:00:00Z', '2026-10-03T11:10:00Z', [sonnet(0.2, 10)]),
  job('dev', null, '2026-10-03T12:00:00Z', '2026-10-03T12:05:00Z'),
  job('design', 9, '2026-09-20T00:00:00Z', '2026-09-20T01:00:00Z', [opus(9, 60)]),
];

describe('wasteNumbers', () => {
  it('counts a held job as no failure, since its stage continues', () => {
    const held = wasteNumbers([job('implement', 5, '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z', [opus(1, 60)], 'held')], FROM, TO);
    expect(held.stages[0]).toMatchObject({ stage: 'implement', runs: 1, failed: 0 });
  });

  const n = wasteNumbers(LEDGER, FROM, TO);

  it('sums cost and agent minutes per stage and per model inside the window', () => {
    expect(n.jobs).toBe(7);
    expect(n.costUsd).toBeCloseTo(14.4);
    expect(n.stages[0]).toMatchObject({ stage: 'verify', runs: 3, failed: 1, wallMinutes: 94, agentMinutes: 84 });
    expect(n.stages[0].costUsd).toBeCloseTo(8.4);
    expect(n.models.map((m) => [m.model, m.runs])).toEqual([['opus', 4], ['sonnet', 3]]);
    expect(n.models[1].costUsd).toBeCloseTo(0.9);
  });

  it('measures the handoff wait per queue, and skips the wait after the Testing post, where the committee plays', () => {
    const verify = n.waits.find((wait) => wait.queue === 'verify');
    expect(verify).toEqual({ queue: 'verify', handoffs: 2, medianMinutes: 194, maxMinutes: 194, totalMinutes: 204, worstIssue: 131 });
    expect(n.waits.find((wait) => wait.queue === 'design')).toBeUndefined();
  });

  it('lists stages that ran more than once on one issue, and counts the routes', () => {
    expect(n.reruns).toEqual([{ issue: 7, stage: 'verify', runs: 2 }]);
    expect(n.routes).toEqual({ answer: 0, patch: 0, redesign: 1 });
  });

  it('ranks the most expensive issues', () => {
    expect(n.issues[0]).toEqual({ issue: 131, costUsd: 13.5, jobs: 3, wallMinutes: 109 });
    expect(n.issues[1].issue).toBe(7);
  });

  it('counts a factory change in the totals but never as an issue, since its id is no GitHub issue', () => {
    const change = 1791571868706;
    const cheap = [1, 2, 3, 4, 5].map((issue) => job('triage', issue, '2026-10-04T00:00:00Z', '2026-10-04T00:01:00Z', [sonnet(0.01, 1)]));
    const lines = [...cheap, job('change', change, '2026-10-04T01:00:00Z', '2026-10-04T02:00:00Z', [opus(50, 60)]), job('change', change, '2026-10-04T03:00:00Z', '2026-10-04T04:00:00Z', [opus(50, 60)])];
    const mixed = wasteNumbers([...LEDGER, ...lines], FROM, TO);
    expect(mixed.costUsd).toBeCloseTo(114.45);
    expect(mixed.stages[0]).toMatchObject({ stage: 'change', runs: 2, costUsd: 100 });
    expect(mixed.issues.map((item) => item.issue)).toEqual([131, 7, 1, 2, 3]);
    expect(mixed.reruns.map((item) => item.issue)).toEqual([7]);
    expect(mixed.waits.every((wait) => wait.worstIssue !== change)).toBe(true);
  });

  it('formats every number for the agent and the post', () => {
    const text = formatNumbers(n);
    expect(text).toContain('2026-10-01 to 2026-10-08');
    expect(text).toContain('- verify: 2 handoffs, median 194 min, max 194 min (#131), total 204 min');
    expect(text).toContain('- #131: $13.50, 3 jobs, 109 min');
    expect(text).toContain('- redesign: 1');
  });

  it('reports an empty window plainly', () => {
    const empty = wasteNumbers([], FROM, TO);
    expect(empty.jobs).toBe(0);
    expect(formatNumbers(empty)).toContain('No jobs ended in this window.');
  });
});
