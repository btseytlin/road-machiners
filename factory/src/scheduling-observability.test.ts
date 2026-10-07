import { expect, it } from 'vitest';
import * as scheduling from './tick';
import { EMPTY_STATE } from './state';
import { STUCK_LABEL, NEEDS_INFO_LABEL, type Card, type Job } from './types';

const now = new Date('2026-10-04T12:00:00Z');
const config = { releaseDays: 7, wasteReviewDays: 7, maxJobsPerDay: 20, maxJobsPerCard: 10, triageWorkers: 1, designWorkers: 1, implementWorkers: 1, verifyWorkers: 1, testWorkers: 1 };
function createCard(issue: number, column: Card['column'], labels: string[] = []): Card { return { issue, column, labels, itemId: String(issue) }; }
function createState() { return { ...structuredClone(EMPTY_STATE), lastRelease: now.toISOString() }; }

it('explains both slot contention and an already running issue without changing selections', () => {
  expect(scheduling).toHaveProperty('evaluateSchedule');
  const state = createState();
  state.jobs = [{ id: 'job-1', stage: 'implement', issue: 1, pid: 123, log: '', startedAt: now.toISOString() } satisfies Job];
  const cards = [createCard(1, 'Implementation'), createCard(2, 'Implementation'), createCard(3, 'Design')];
  const result = scheduling.evaluateSchedule(state, cards, now, config);
  expect(result.picks).toEqual([{ stage: 'design', issue: 3 }]);
  expect(result.decisions.find(item => item.issue === 1)?.reasons).toEqual(['queue-full', 'issue-running']);
  expect(result.decisions.find(item => item.issue === 2)?.reasons).toEqual(['queue-full']);
});
it('explains author waits, failed work, approval waits and the daily cap', () => {
  expect(scheduling).toHaveProperty('evaluateSchedule');
  const state = createState();
  state.jobStarts = Array.from({ length: 20 }, () => now.toISOString());
  const result = scheduling.evaluateSchedule(state, [createCard(1, 'Triage', [NEEDS_INFO_LABEL]), createCard(2, 'Testing', [STUCK_LABEL]), createCard(3, 'Approval'), createCard(4, 'Design')], now, config);
  expect(result.picks).toEqual([]);
  expect(result.decisions.find(item => item.issue === 1)?.reasons).toContain('needs-info');
  expect(result.decisions.find(item => item.issue === 2)?.reasons).toContain('failed');
  expect(result.decisions.find(item => item.issue === 3)?.reasons).toContain('approval');
  expect(result.decisions.find(item => item.issue === 4)?.reasons).toContain('daily-cap');
  expect(result.nextCapAt).toBe('2026-10-05T12:00:00.000Z');
});
it('reports the same candidate gate used by selection', () => {
  expect(scheduling).toHaveProperty('readReleaseGate');
  const state = createState();
  state.release = { issue: 10, branch: 'release/2026-10-04', day: '2026-10-04', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } };
  const cards = [createCard(10, 'Approval', ['release']), createCard(11, 'Testing', ['release-task'])];
  expect(scheduling.readReleaseGate(state, cards)).toEqual({ reason: 'release-tasks', issues: [11] });
  cards[1].column = 'Done';
  expect(scheduling.readReleaseGate(state, cards, 'rel0001')).toEqual({ reason: 'playtest', issues: [] });
  expect(scheduling.chooseJobs(state, cards, now, config, { dev: null, release: 'rel0001' })).toEqual([{ stage: 'playtest', issue: 10 }]);
  state.release.playtest.passed = 'rel0001';
  expect(scheduling.readReleaseGate(state, cards, 'rel0001')).toEqual({ reason: 'candidate', issues: [] });
  expect(scheduling.chooseJobs(state, cards, now, config, { dev: null, release: 'rel0001' })).toEqual([{ stage: 'candidate', issue: 10 }]);
});
