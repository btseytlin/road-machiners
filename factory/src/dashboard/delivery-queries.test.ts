import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CardFlow, CardStep } from '../card-events';
import type { JobOutcome, LedgerLine } from '../ledger';
import type { Column, JobStage } from '../types';
import { AnalyticsRunner, type Analytics, type PanelName } from './analytics';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-10T00:00:00Z');
const PANELS: PanelName[] = ['delivery_coverage', 'lead', 'dwell', 'loops', 'rejections', 'delivery_retries'];
const at = (hoursAgo: number): string => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
const card = (issue: number, hoursAgo: number, step: CardStep, to: Column, flow?: CardFlow): LedgerLine => ({ kind: 'card', issue, step, to, at: at(hoursAgo), ...(flow ? { flow } : {}) });
const job = (issue: number, stage: JobStage, outcome: JobOutcome, hoursAgo: number): LedgerLine => ({ kind: 'job', id: `${stage}-${hoursAgo}`, stage, issue, startedAt: at(hoursAgo + 1), endedAt: at(hoursAgo), outcome, agents: [] });

function straight(issue: number, start: number): LedgerLine[] {
  return [
    card(issue, start, 'entered', 'Triage'), card(issue, start - 2, 'accepted', 'Design'), card(issue, start - 12, 'planned', 'Implementation'),
    card(issue, start - 17, 'built', 'Testing'), card(issue, start - 20, 'posted', 'Approval'), card(issue, start - 44, 'approved', 'Testing'),
    card(issue, start - 48, 'hardened', 'Approval'), card(issue, start - 49, 'merged', 'Done'),
  ];
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function run(lines: LedgerLine[], now = NOW): Promise<Analytics> {
  mkdirSync('tmp', { recursive: true });
  const dir = mkdtempSync(join('tmp', 'delivery-queries-'));
  dirs.push(dir);
  const path = join(dir, 'ledger.jsonl');
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  const result = await (await AnalyticsRunner.open()).read(path, now, 180000);
  for (const name of PANELS) expect(result[name].error).toBeNull();
  return result;
}
const stage = (result: Analytics, name: string, days: 1 | 7 | 30 = 7) => result.dwell.ranges![days].find((row) => row.stage === name)!;
const loop = (result: Analytics, step: string) => result.loops.ranges![7].find((row) => row.step === step)!;
const gate = (result: Analytics, name: string) => result.rejections.ranges![7].find((row) => row.gate === name)!;

describe('delivery queries', () => {
  it('measures calendar time in each stage and the lead time of a straight-through feature', async () => {
    const result = await run(straight(1, 60));
    expect(result.delivery_coverage.ranges![7]).toEqual([{ since: at(60), issues: 1, excluded: 0, legacy: 0, looped: 0 }]);
    expect(result.dwell.ranges![7].map((row) => [row.stage, row.count, row.mean_ms! / HOUR])).toEqual([
      ['triage', 1, 2], ['design', 1, 10], ['implementation', 1, 5], ['preview', 1, 3], ['approval', 1, 24], ['harden', 1, 4], ['merge', 1, 1],
    ]);
    expect(result.lead.ranges![7]).toEqual([{ open: 0, open_mean_ms: null, missing_start: 0 }]);
    expect(result.rejections.ranges![7]).toEqual([{ gate: 'triage', decided: 1, rejected: 0 }, { gate: 'design', decided: 1, rejected: 0 }, { gate: 'committee', decided: 1, rejected: 0 }]);
  });

  it('counts time in the Hardening column as harden, like older hardening in Testing', async () => {
    const lines = straight(1, 60).map((line) => (line.kind === 'card' && line.step === 'approved' ? { ...line, to: 'Hardening' as const } : line));
    expect(stage(await run(lines), 'harden')).toMatchObject({ count: 1, mean_ms: 4 * HOUR });
  });

  it('counts each loop by transition and issue, apart from failed-job retries of the same stage', async () => {
    const lines = [
      card(2, 50, 'entered', 'Triage'), card(2, 49, 'accepted', 'Design'), card(2, 48, 'questions', 'Triage'), card(2, 40, 'accepted', 'Design'),
      card(2, 38, 'planned', 'Implementation'), card(2, 36, 'built', 'Testing'), card(2, 35, 'rebuild', 'Implementation'), card(2, 33, 'built', 'Testing'),
      card(2, 32, 'posted', 'Approval'), card(2, 30, 'patch', 'Implementation'), card(2, 29, 'patched', 'Testing'), card(2, 28, 'posted', 'Approval'),
      card(2, 26, 'redesign', 'Design'),
      ...straight(3, 60),
      job(2, 'design', 'failed', 39), job(2, 'design', 'died', 38.5), job(2, 'design', 'done', 38), job(2, 'verify', 'timeout', 34), job(3, 'checks', 'stopped', 20), job(3, 'implement', 'held', 21),
    ];
    const result = await run(lines);
    const retries = result.delivery_retries.ranges![7];
    expect(loop(result, 'questions')).toEqual({ step: 'questions', events: 1, issues: 1 });
    expect(loop(result, 'rebuild').events).toBe(1);
    expect(loop(result, 'patch').events).toBe(1);
    expect(loop(result, 'redesign').events).toBe(1);
    expect(result.delivery_coverage.ranges![7][0]).toMatchObject({ looped: 1, issues: 2 });
    expect(retries.find((row) => row.stage === 'design')).toEqual({ stage: 'design', runs: 2, issues: 1 });
    expect(retries.find((row) => row.stage === 'verify')!.runs).toBe(1);
    expect(retries.find((row) => row.stage === 'checks')!.runs).toBe(0);
    expect(retries.find((row) => row.stage === 'implement')!.runs).toBe(0);
    expect(result.lead.ranges![7][0].open).toBe(1);
    expect(result.lead.ranges![7][0].open_mean_ms).toBe(49 * HOUR);
    expect(stage(result, 'design').count).toBe(3);
    expect(stage(result, 'design').open).toBe(1);
    expect(stage(result, 'design').open_mean_ms).toBe(26 * HOUR);
    expect(stage(result, 'preview').count).toBe(4);
  });

  it('rates committee Deny and triage and design refusals on their own denominators, and no other end as a rejection', async () => {
    const lines = [
      ...straight(1, 60),
      card(2, 50, 'entered', 'Triage'), card(2, 49, 'triage-wont-do', 'Done'),
      card(3, 50, 'entered', 'Triage'), card(3, 49, 'accepted', 'Design'), card(3, 48, 'design-wont-do', 'Done'),
      card(4, 50, 'entered', 'Triage'), card(4, 49, 'accepted', 'Design'), card(4, 48, 'planned', 'Implementation'), card(4, 47, 'built', 'Testing'),
      card(4, 46, 'posted', 'Approval'), card(4, 45, 'denied', 'Done'),
      card(5, 50, 'entered', 'Triage'), card(5, 49, 'accepted', 'Design'), card(5, 48, 'planned', 'Implementation'), card(5, 47, 'built', 'Testing'),
      card(5, 46, 'posted', 'Approval'), card(5, 45, 'redesign', 'Design'),
      card(6, 50, 'entered', 'Triage'), card(6, 49, 'accepted', 'Design'), card(6, 48, 'dropped', 'Done'), card(6, 48, 'dropped', 'Done'),
      card(7, 50, 'entered', 'Triage'), card(7, 49, 'bundled', 'Done'),
      job(8, 'triage', 'failed', 10),
    ];
    const result = await run(lines);
    expect(gate(result, 'triage')).toEqual({ gate: 'triage', decided: 6, rejected: 1 });
    expect(gate(result, 'design')).toEqual({ gate: 'design', decided: 4, rejected: 1 });
    expect(gate(result, 'committee')).toEqual({ gate: 'committee', decided: 2, rejected: 1 });
    expect(result.lead.ranges![7][0].open).toBe(1);
  });

  it('leaves hotfixes, release tasks, the release card and private tasks out, and counts them', async () => {
    const lines = [
      ...straight(1, 60),
      card(2, 50, 'entered', 'Design', 'hotfix'), card(2, 40, 'planned', 'Implementation'), card(2, 30, 'merged', 'Done', 'hotfix'),
      card(3, 50, 'entered', 'Triage'), card(3, 49, 'accepted', 'Design', 'hotfix'), card(3, 30, 'denied', 'Done'),
      card(4, 50, 'entered', 'Design', 'release-task'), card(4, 40, 'planned', 'Implementation'), card(4, 30, 'merged', 'Done'),
      card(5, 50, 'entered', 'Approval', 'release'), card(5, 10, 'shipped', 'Done', 'release'),
      card(6, 50, 'entered', 'Implementation', 'adhoc'), card(6, 10, 'reported', 'Done', 'adhoc'),
      job(2, 'implement', 'failed', 35), job(4, 'design', 'timeout', 45),
    ];
    const result = await run(lines);
    expect(result.delivery_coverage.ranges![7][0]).toMatchObject({ issues: 1, excluded: 5 });
    expect(gate(result, 'committee')).toEqual({ gate: 'committee', decided: 1, rejected: 0 });
    expect(stage(result, 'design').count).toBe(1);
    expect(result.delivery_retries.ranges![7].every((row) => row.runs === 0)).toBe(true);
  });

  it('marks cards that joined before lifecycle records and never invents a start for them', async () => {
    const lines = [card(9, 30, 'planned', 'Implementation'), card(9, 20, 'built', 'Testing'), card(9, 10, 'posted', 'Approval'), card(9, 5, 'approved', 'Testing'), card(9, 3, 'hardened', 'Approval'), card(9, 2, 'merged', 'Done')];
    const result = await run(lines);
    expect(result.delivery_coverage.ranges![7][0].legacy).toBe(1);
    expect(stage(result, 'design')).toMatchObject({ count: 0, mean_ms: null, open: 0 });
    expect(stage(result, 'implementation')).toMatchObject({ count: 1, mean_ms: 10 * HOUR });
    expect(result.lead.ranges![7][0]).toMatchObject({ open: 0, missing_start: 1 });
  });

  it('returns a null since and zeros with no card lines, so the page never shows unrecorded numbers as zero', async () => {
    const result = await run([job(1, 'design', 'failed', 1)]);
    expect(result.delivery_coverage.ranges![7]).toEqual([{ since: null, issues: 0, excluded: 0, legacy: 0, looped: 0 }]);
  });

  it('counts a visit in the window its stage ended in, and keeps open visits out of the averages', async () => {
    const lines = [card(1, 200, 'entered', 'Triage'), card(1, 190, 'accepted', 'Design'), card(1, 20, 'planned', 'Implementation')];
    const result = await run(lines);
    expect(stage(result, 'triage', 1).count).toBe(0);
    expect(stage(result, 'design', 1)).toMatchObject({ count: 1, mean_ms: 170 * HOUR });
    expect(stage(result, 'implementation', 1)).toMatchObject({ count: 0, mean_ms: null, open: 1, open_mean_ms: 20 * HOUR });
    expect((await run(lines, new Date(NOW.getTime() - 21 * HOUR))).delivery_coverage.ranges![1][0].issues).toBe(0);
    expect(stage(result, 'triage', 30)).toMatchObject({ count: 1, mean_ms: 10 * HOUR });
  });

  it('drops the copy a resumed job writes, sorts lines by time and ignores a move into the same column', async () => {
    const lines = [
      card(1, 50, 'entered', 'Triage'), card(1, 40, 'planned', 'Implementation'), card(1, 48, 'accepted', 'Design'), card(1, 47, 'accepted', 'Design'),
      card(1, 30, 'built', 'Testing'), card(1, 29, 'moved', 'Testing'), card(1, 20, 'rebuild', 'Implementation'), card(1, 19, 'rebuild', 'Implementation'),
    ];
    const result = await run(lines);
    expect(stage(result, 'design')).toMatchObject({ count: 1, mean_ms: 8 * HOUR });
    expect(stage(result, 'preview')).toMatchObject({ count: 1, mean_ms: 10 * HOUR });
    expect(loop(result, 'rebuild').events).toBe(1);
    expect(stage(result, 'implementation')).toMatchObject({ count: 1, open: 1, open_mean_ms: 20 * HOUR });
  });

  it('counts an operator merge as merge queue time, not as the committee wait', async () => {
    const lines = [card(1, 30, 'entered', 'Triage'), card(1, 29, 'accepted', 'Design'), card(1, 20, 'merge-ordered', 'Approval'), card(1, 18, 'merged', 'Done')];
    const result = await run(lines);
    expect(stage(result, 'merge')).toMatchObject({ count: 1, mean_ms: 2 * HOUR });
    expect(stage(result, 'approval').count).toBe(0);
    expect(gate(result, 'committee')).toEqual({ gate: 'committee', decided: 1, rejected: 0 });
  });

  it('averages the two middle dwell times for an even count', async () => {
    const lines = [...straight(1, 60), ...straight(2, 70), ...straight(3, 80), ...straight(4, 100)];
    const result = await run(lines, NOW);
    expect(stage(result, 'design').median_ms).toBe(10 * HOUR);
    const uneven = [card(1, 30, 'entered', 'Triage'), card(1, 28, 'accepted', 'Design'), card(2, 30, 'entered', 'Triage'), card(2, 26, 'accepted', 'Design')];
    expect(stage(await run(uneven), 'triage').median_ms).toBe(3 * HOUR);
  });

  it('publishes aggregates only, with no issue numbers', async () => {
    const result = await run(straight(4242, 60));
    expect(JSON.stringify(PANELS.map((name) => result[name]))).not.toContain('4242');
  });
});
