import { describe, expect, it } from 'vitest';
import type { CardFlow, CardStep } from '../card-events';
import type { JobOutcome, LedgerLine } from '../ledger';
import type { Column, JobStage } from '../types';
import { summarizeDelivery } from './delivery';

type CardLine = Extract<LedgerLine, { kind: 'card' }>;
type JobLine = Extract<LedgerLine, { kind: 'job' }>;
const HOUR = 3_600_000;
const NOW = new Date('2026-10-10T00:00:00Z');
const at = (hoursAgo: number): string => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
const card = (issue: number, hoursAgo: number, step: CardStep, to: Column, flow?: CardFlow): CardLine => ({ kind: 'card', issue, step, to, at: at(hoursAgo), ...(flow ? { flow } : {}) });
const job = (issue: number, stage: JobStage, outcome: JobOutcome, hoursAgo: number): JobLine => ({ kind: 'job', id: `${stage}-${hoursAgo}`, stage, issue, startedAt: at(hoursAgo + 1), endedAt: at(hoursAgo), outcome, agents: [] });

// One feature from intake to the merge into dev, 2 hours in Triage, 10 in Design, 5 in Implementation, 3 in preview, 24 in Approval, 4 in harden, 1 in the merge queue.
function straight(issue: number, start: number): CardLine[] {
  return [
    card(issue, start, 'entered', 'Triage'), card(issue, start - 2, 'accepted', 'Design'), card(issue, start - 12, 'planned', 'Implementation'),
    card(issue, start - 17, 'built', 'Testing'), card(issue, start - 20, 'posted', 'Approval'), card(issue, start - 44, 'approved', 'Testing'),
    card(issue, start - 48, 'hardened', 'Approval'), card(issue, start - 49, 'merged', 'Done'),
  ];
}
const stage = (summary: ReturnType<typeof summarizeDelivery>, name: string) => summary!.stages.find((row) => row.stage === name)!;
const loop = (summary: ReturnType<typeof summarizeDelivery>, step: string) => summary!.loops.find((row) => row.step === step)!;
const gate = (summary: ReturnType<typeof summarizeDelivery>, name: string) => summary!.rejections.find((row) => row.gate === name)!;

describe('summarizeDelivery', () => {
  it('measures calendar time in each stage and the lead time of a straight-through feature', () => {
    const summary = summarizeDelivery(straight(1, 60), [], NOW, 7);
    expect(summary!.issues).toBe(1);
    expect(summary!.legacy).toBe(0);
    expect(summary!.since).toBe(at(60));
    expect(summary!.stages.map((row) => [row.stage, row.count, row.meanMs! / HOUR])).toEqual([
      ['triage', 1, 2], ['design', 1, 10], ['implementation', 1, 5], ['preview', 1, 3], ['approval', 1, 24], ['harden', 1, 4], ['merge', 1, 1],
    ]);
    expect(summary!.lead).toEqual({ open: 0, openMeanMs: null, missingStart: 0 });
    expect(summary!.looped).toBe(0);
    expect(summary!.rejections).toEqual([{ gate: 'triage', decided: 1, rejected: 0 }, { gate: 'design', decided: 1, rejected: 0 }, { gate: 'committee', decided: 1, rejected: 0 }]);
  });

  it('counts time in the Hardening column as harden, like older hardening in Testing', () => {
    const lines = straight(1, 60).map((line) => (line.step === 'approved' ? { ...line, to: 'Hardening' as const } : line));
    expect(stage(summarizeDelivery(lines, [], NOW, 7), 'harden')).toMatchObject({ count: 1, meanMs: 4 * HOUR });
  });

  it('counts each loop by transition and issue, apart from failed-job retries of the same stage', () => {
    const lines = [
      card(2, 50, 'entered', 'Triage'), card(2, 49, 'accepted', 'Design'), card(2, 48, 'questions', 'Triage'), card(2, 40, 'accepted', 'Design'),
      card(2, 38, 'planned', 'Implementation'), card(2, 36, 'built', 'Testing'), card(2, 35, 'rebuild', 'Implementation'), card(2, 33, 'built', 'Testing'),
      card(2, 32, 'posted', 'Approval'), card(2, 30, 'patch', 'Implementation'), card(2, 29, 'patched', 'Testing'), card(2, 28, 'posted', 'Approval'),
      card(2, 26, 'redesign', 'Design'),
      ...straight(3, 60),
    ];
    const jobs = [job(2, 'design', 'failed', 39), job(2, 'design', 'died', 38.5), job(2, 'design', 'done', 38), job(2, 'verify', 'timeout', 34), job(3, 'checks', 'stopped', 20), job(3, 'implement', 'held', 21)];
    const summary = summarizeDelivery(lines, jobs, NOW, 7);
    expect(loop(summary, 'questions')).toEqual({ step: 'questions', events: 1, issues: 1 });
    expect(loop(summary, 'rebuild').events).toBe(1);
    expect(loop(summary, 'patch').events).toBe(1);
    expect(loop(summary, 'redesign').events).toBe(1);
    expect(summary!.looped).toBe(1);
    expect(summary!.issues).toBe(2);
    expect(summary!.retries.find((row) => row.stage === 'design')).toEqual({ stage: 'design', runs: 2, issues: 1 });
    expect(summary!.retries.find((row) => row.stage === 'verify')!.runs).toBe(1);
    expect(summary!.retries.find((row) => row.stage === 'checks')!.runs).toBe(0);
    expect(summary!.retries.find((row) => row.stage === 'implement')?.runs ?? 0).toBe(0);
    // The first acceptance starts the wait. Issue 2 is open again in Design, so it is open since that acceptance.
    expect(summary!.lead.open).toBe(1);
    expect(summary!.lead.openMeanMs).toBe(49 * HOUR);
    expect(stage(summary, 'design').count).toBe(3);
    expect(stage(summary, 'design').open).toBe(1);
    expect(stage(summary, 'design').openMeanMs).toBe(26 * HOUR);
    expect(stage(summary, 'preview').count).toBe(4);
  });

  it('rates committee Deny and triage and design refusals on their own denominators, and no other end as a rejection', () => {
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
    ];
    const summary = summarizeDelivery(lines, [job(8, 'triage', 'failed', 10)], NOW, 7);
    expect(gate(summary, 'triage')).toEqual({ gate: 'triage', decided: 6, rejected: 1 });
    expect(gate(summary, 'design')).toEqual({ gate: 'design', decided: 4, rejected: 1 });
    expect(gate(summary, 'committee')).toEqual({ gate: 'committee', decided: 2, rejected: 1 });
    // Denied, refused and dropped cards are closed, so only the redesigned card stays open.
    expect(summary!.lead.open).toBe(1);
  });

  it('leaves hotfixes, release tasks, the release card and private tasks out, and counts them', () => {
    const lines = [
      ...straight(1, 60),
      card(2, 50, 'entered', 'Design', 'hotfix'), card(2, 40, 'planned', 'Implementation'), card(2, 30, 'merged', 'Done', 'hotfix'),
      card(3, 50, 'entered', 'Triage'), card(3, 49, 'accepted', 'Design', 'hotfix'), card(3, 30, 'denied', 'Done'),
      card(4, 50, 'entered', 'Design', 'release-task'), card(4, 40, 'planned', 'Implementation'), card(4, 30, 'merged', 'Done'),
      card(5, 50, 'entered', 'Approval', 'release'), card(5, 10, 'shipped', 'Done', 'release'),
      card(6, 50, 'entered', 'Implementation', 'adhoc'), card(6, 10, 'reported', 'Done', 'adhoc'),
    ];
    const summary = summarizeDelivery(lines, [job(2, 'implement', 'failed', 35), job(4, 'design', 'timeout', 45)], NOW, 7);
    expect(summary!.issues).toBe(1);
    expect(summary!.excluded).toBe(5);
    expect(gate(summary, 'committee')).toEqual({ gate: 'committee', decided: 1, rejected: 0 });
    expect(stage(summary, 'design').count).toBe(1);
    expect(summary!.retries.every((row) => row.runs === 0)).toBe(true);
  });

  it('marks cards that joined before lifecycle records and never invents a start for them', () => {
    const lines = [card(9, 30, 'planned', 'Implementation'), card(9, 20, 'built', 'Testing'), card(9, 10, 'posted', 'Approval'), card(9, 5, 'approved', 'Testing'), card(9, 3, 'hardened', 'Approval'), card(9, 2, 'merged', 'Done')];
    const summary = summarizeDelivery(lines, [], NOW, 7);
    expect(summary!.legacy).toBe(1);
    expect(stage(summary, 'design')).toMatchObject({ count: 0, meanMs: null, open: 0 });
    expect(stage(summary, 'implementation')).toMatchObject({ count: 1, meanMs: 10 * HOUR });
    expect(summary!.lead).toMatchObject({ open: 0, missingStart: 1 });
  });

  it('returns null with no card lines, so the page never shows unrecorded numbers as zero', () => {
    expect(summarizeDelivery([], [job(1, 'design', 'failed', 1)], NOW, 7)).toBeNull();
  });

  it('counts a visit in the window its stage ended in, and keeps open visits out of the averages', () => {
    const lines = [card(1, 200, 'entered', 'Triage'), card(1, 190, 'accepted', 'Design'), card(1, 20, 'planned', 'Implementation')];
    const day = summarizeDelivery(lines, [], NOW, 1);
    expect(stage(day, 'triage').count).toBe(0);
    expect(stage(day, 'design')).toMatchObject({ count: 1, meanMs: 170 * HOUR });
    expect(stage(day, 'implementation')).toMatchObject({ count: 0, meanMs: null, open: 1, openMeanMs: 20 * HOUR });
    // The card had no line in the last day before its stage ended, so a window holds a stage it saw end.
    expect(summarizeDelivery(lines, [], new Date(NOW.getTime() - 21 * HOUR), 1)!.issues).toBe(0);
    expect(stage(summarizeDelivery(lines, [], NOW, 30), 'triage')).toMatchObject({ count: 1, meanMs: 10 * HOUR });
  });

  it('drops the copy a resumed job writes, sorts lines by time and ignores a move into the same column', () => {
    const lines = [
      card(1, 50, 'entered', 'Triage'), card(1, 40, 'planned', 'Implementation'), card(1, 48, 'accepted', 'Design'), card(1, 47, 'accepted', 'Design'),
      card(1, 30, 'built', 'Testing'), card(1, 29, 'moved', 'Testing'), card(1, 20, 'rebuild', 'Implementation'), card(1, 19, 'rebuild', 'Implementation'),
    ];
    const summary = summarizeDelivery(lines, [], NOW, 7);
    expect(stage(summary, 'design')).toMatchObject({ count: 1, meanMs: 8 * HOUR });
    expect(stage(summary, 'preview')).toMatchObject({ count: 1, meanMs: 10 * HOUR });
    expect(loop(summary, 'rebuild').events).toBe(1);
    expect(stage(summary, 'implementation')).toMatchObject({ count: 1, open: 1, openMeanMs: 20 * HOUR });
  });

  it('counts an operator merge as merge queue time, not as the committee wait', () => {
    const lines = [card(1, 30, 'entered', 'Triage'), card(1, 29, 'accepted', 'Design'), card(1, 20, 'merge-ordered', 'Approval'), card(1, 18, 'merged', 'Done')];
    const summary = summarizeDelivery(lines, [], NOW, 7);
    expect(stage(summary, 'merge')).toMatchObject({ count: 1, meanMs: 2 * HOUR });
    expect(stage(summary, 'approval').count).toBe(0);
    expect(gate(summary, 'committee')).toEqual({ gate: 'committee', decided: 1, rejected: 0 });
  });

  it('publishes aggregates only, with no issue numbers', () => {
    const summary = summarizeDelivery(straight(4242, 60), [], NOW, 7);
    expect(JSON.stringify(summary)).not.toContain('4242');
  });
});
