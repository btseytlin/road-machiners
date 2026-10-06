import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { readLiveOperations } from './dashboard/live';
import { recordObservation } from './observability';
import { EMPTY_STATE } from './state';
import { evaluateSchedule } from './tick';
import { HEAVY_OF, NEEDS_INFO_LABEL, QUEUE_OF, type Card, type FactoryState, type Job } from './types';

// The real heavy limit: no heavySlots in the config.
const NOW = new Date('2026-10-06T12:00:00Z');
const CFG = { releaseDays: 7, wasteReviewDays: 7, maxJobsPerDay: 20, triageWorkers: 3, designWorkers: 3, implementWorkers: 3, verifyWorkers: 3, testWorkers: 3 };
const state = (over: Partial<FactoryState> = {}): FactoryState => ({ ...structuredClone(EMPTY_STATE), lastRelease: NOW.toISOString(), ...over });
const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });
// A job persisted by the factory before this rule shipped looks the same, so it counts too.
const running = (stage: Job['stage'], issue: number | null): Job => ({ id: `${stage}-${issue}`, stage, issue, pid: 1, startedAt: '2026-10-05T12:00:00Z', log: '' });
const reasonsOf = (report: ReturnType<typeof evaluateSchedule>, issue: number | null) => report.decisions.find((item) => item.issue === issue)?.reasons;

describe('heavy job slot', () => {
  it('classes every stage, and only the release cut is light', () => {
    expect(Object.keys(HEAVY_OF).sort()).toEqual(Object.keys(QUEUE_OF).sort());
    expect(Object.entries(HEAVY_OF).filter(([, heavy]) => !heavy).map(([stage]) => stage)).toEqual(['release']);
  });

  it('lets a running heavy job block heavy work in other queues but not the release cut', () => {
    const report = evaluateSchedule(state({ lastRelease: null, jobs: [running('implement', 1)] }), [card(2, 'Testing'), card(3, 'Design')], NOW, CFG);
    expect(report.picks).toEqual([{ stage: 'release', issue: null }]);
    expect(reasonsOf(report, 2)).toEqual(['heavy-busy']);
    expect(reasonsOf(report, 3)).toEqual(['heavy-busy']);
  });

  it('starts at most one heavy job in an empty tick', () => {
    const report = evaluateSchedule(state({ pendingApprovals: { '9': 'u' } }), [card(1, 'Implementation'), card(2, 'Design'), card(3, 'Triage')], NOW, CFG);
    expect(report.picks).toEqual([{ stage: 'approve', issue: 9 }]);
    expect(report.decisions.filter((item) => item.reasons.includes('heavy-busy')).map((item) => item.issue)).toEqual([1, 2, 3]);
  });

  it('gives a free slot to Checks before implementation, verify, a change and a branch job', () => {
    const cards = [card(1, 'Implementation'), card(2, 'Testing'), card(3, 'Testing')];
    const s = state({ testPhase: { 3: 'checks' }, pendingChanges: [{ id: 5, text: 't', by: 'u' }], pendingApprovals: { '9': 'u' } });
    expect(evaluateSchedule(s, cards, NOW, CFG).picks).toEqual([{ stage: 'checks', issue: 3 }]);
  });

  it('passes the slot on when Checks cannot start', () => {
    const cards = [card(1, 'Implementation', ['adhoc']), card(2, 'Testing'), card(3, 'Testing', [NEEDS_INFO_LABEL])];
    const s = state({ testPhase: { 2: 'checks', 3: 'checks' } });
    const capped = evaluateSchedule({ ...s, jobStarts: Array.from({ length: 20 }, () => NOW.toISOString()) }, cards, NOW, CFG);
    expect(capped.picks).toEqual([{ stage: 'adhoc', issue: 1 }]);
    expect(reasonsOf(capped, 2)).toEqual(['daily-cap']);
    expect(evaluateSchedule(s, cards.slice(0, 1).concat(cards[2]), NOW, CFG).picks).toEqual([{ stage: 'adhoc', issue: 1 }]);
  });

  it('keeps the queue limit and the one job per issue beside the heavy slot', () => {
    const report = evaluateSchedule(state({ jobs: [running('verify', 1)] }), [card(1, 'Testing'), card(2, 'Testing')], NOW, { ...CFG, verifyWorkers: 1 });
    expect(reasonsOf(report, 1)).toEqual(['queue-full', 'issue-running', 'heavy-busy']);
    expect(reasonsOf(report, 2)).toEqual(['queue-full', 'heavy-busy']);
  });

  it('lets a light release cut beside it leave the heavy slot free', () => {
    expect(evaluateSchedule(state({ jobs: [running('release', null)] }), [card(2, 'Design')], NOW, CFG).picks).toEqual([{ stage: 'design', issue: 2 }]);
  });
});

describe('heavy-busy telemetry', () => {
  const homes: string[] = [];
  afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

  it('records and reports the heavy-busy reason', () => {
    mkdirSync('tmp', { recursive: true });
    const home = mkdtempSync('tmp/heavy-');
    homes.push(home);
    const report = evaluateSchedule(state({ jobs: [running('checks', 1)] }), [card(2, 'Design')], NOW, CFG);
    recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report, counts: { Design: 1 } }, NOW);
    const live = readLiveOperations(home, state(), NOW, 10_000, 60_000);
    expect(live.scheduler?.decisions).toEqual([{ stage: 'design', queue: 'design', issue: 2, reasons: ['heavy-busy'] }]);
  });
});
