import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLedger } from './ledger';
import { readObservation, type SchedulerData } from './observability';
import { resumedStage } from './sessions';
import { chooseJobs, evaluateSchedule, tick, type TickDeps } from './tick';
import { EMPTY_STATE, readState, writeState } from './state';
import { FACTORY_MARK, HOTFIX_LABEL, NEEDS_INFO_LABEL, QUESTIONS_HEADING, STUCK_LABEL, type Card, type ReleaseState, type Ctx, type IssueComment, type FactoryState, type Job } from './types';

const NOW = new Date('2026-01-10T12:00:00Z');
const CFG = { releaseDays: 7, wasteReviewDays: 7, maxJobsPerDay: 3, maxJobsPerCard: 2, triageWorkers: 3, designWorkers: 3, implementWorkers: 3, verifyWorkers: 1, testWorkers: 1 };
// One worker per agent queue, so a test sees which card each queue prefers.
const ONE = { ...CFG, triageWorkers: 1, designWorkers: 1, implementWorkers: 1 };
const DEV = 'dev0001';
const FRESH = { lastRelease: '2026-01-09T12:00:00Z', devBuild: DEV };

const state = (over: Partial<FactoryState> = {}): FactoryState => ({ ...structuredClone(EMPTY_STATE), ...FRESH, ...over });
const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });
const running = (stage: Job['stage'], issue: number | null): Job => ({ id: `${stage}-${issue}`, stage, issue, pid: 1, startedAt: '', log: '' });

const starts = (...hoursAgo: number[]): string[] => hoursAgo.map((h) => new Date(NOW.getTime() - h * 3_600_000).toISOString());

describe('chooseJobs card budget', () => {
  const big = { ...CFG, maxJobsPerDay: 50 };

  it('holds a card at its budget and leaves other cards running', () => {
    const spent = state({ cardStarts: { 4: starts(23, 5) } });
    expect(chooseJobs(spent, [card(4, 'Design'), card(5, 'Design')], NOW, big)).toEqual([{ stage: 'design', issue: 5 }]);
  });

  it('frees a slot when the oldest start leaves the window', () => {
    const aged = state({ cardStarts: { 4: starts(25, 5) } });
    expect(chooseJobs(aged, [card(4, 'Design')], NOW, big)).toEqual([{ stage: 'design', issue: 4 }]);
  });

  it('does not charge checks, and lets a hotfix run at the budget', () => {
    const spent = state({ cardStarts: { 4: starts(5, 3), 6: starts(5, 3) }, testPhase: { 4: 'checks' } });
    expect(chooseJobs(spent, [card(4, 'Testing')], NOW, big)).toEqual([{ stage: 'checks', issue: 4 }]);
    expect(chooseJobs(spent, [card(6, 'Implementation', [HOTFIX_LABEL])], NOW, big)).toEqual([{ stage: 'implement', issue: 6 }]);
  });
});

describe('chooseJobs daily cap', () => {
  const capped = state({ jobStarts: starts(23, 5, 1), lastRelease: null });

  it('skips periodic and card jobs at the cap, and fills only the slots left', () => {
    expect(chooseJobs(capped, [card(4, 'Design')], NOW, CFG)).toEqual([]);
    expect(chooseJobs({ ...capped, jobStarts: starts(1, 5) }, [card(4, 'Design')], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
  });

  it('still runs committee-driven jobs at the cap', () => {
    expect(chooseJobs({ ...capped, pendingApprovals: { '4': 'u' } }, [], NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }]);
    expect(chooseJobs({ ...capped, pendingChanges: [{ id: 2, text: 't', by: 'u' }] }, [], NOW, CFG)).toEqual([{ stage: 'change', issue: 2 }]);
    expect(chooseJobs(capped, [card(6, 'Implementation', ['adhoc'])], NOW, CFG)).toEqual([{ stage: 'adhoc', issue: 6 }]);
  });

  it('runs a queued incident job at the cap, after the other branch jobs', () => {
    const queuedIncident = { ...capped, pendingIncidents: [7, 8] };
    expect(chooseJobs(queuedIncident, [], NOW, CFG)).toEqual([{ stage: 'incident', issue: 7 }]);
    expect(chooseJobs({ ...queuedIncident, pendingShip: 'u', release: { issue: 3, branch: 'release/x', day: 'x', postId: 1, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } } }, [], NOW, CFG)).toEqual([{ stage: 'ship', issue: 3 }]);
  });

  it('runs factory changes in the implement queue after ad hoc tasks and before cards', () => {
    const s = state({ pendingChanges: [{ id: 2, text: 't', by: 'u' }, { id: 3, text: 't', by: 'u' }] });
    const cards = [card(4, 'Implementation'), card(6, 'Implementation', ['adhoc'])];
    expect(chooseJobs(s, cards, NOW, CFG)).toEqual([{ stage: 'adhoc', issue: 6 }, { stage: 'change', issue: 2 }, { stage: 'change', issue: 3 }]);
  });

  it('ignores starts older than 24 hours', () => {
    expect(chooseJobs({ ...capped, jobStarts: starts(25, 5, 1) }, [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
  });
});

const RELEASE: ReleaseState = { issue: 20, branch: 'release/2026-01-05', day: '2026-01-05', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } };
const tracking = (labels: string[] = ['release']): Card => card(20, 'Approval', labels);

const AT_HEAD = { dev: null, release: 'rel0001' };

describe('chooseJobs during a release', () => {
  const open = state({ release: RELEASE, lastRelease: null });
  const passed = state({ release: { ...RELEASE, playtest: { ...RELEASE.playtest, passed: 'rel0001' } }, lastRelease: null });

  it('cuts a release only when none is open', () => {
    expect(chooseJobs(state({ lastRelease: null }), [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
    expect(chooseJobs(open, [], NOW, CFG)).toEqual([]);
  });

  it('starts the candidate once every release task is Done, the tracking issue is healthy and the playtest passed the head', () => {
    const cards = [tracking(), card(21, 'Done', ['release-task', 'maintenance'])];
    expect(chooseJobs(passed, cards, NOW, CFG, AT_HEAD)).toEqual([{ stage: 'candidate', issue: 20 }]);
  });

  it('runs the playtest after the release tasks and before the candidate', () => {
    const cards = [tracking(), card(21, 'Done', ['release-task', 'maintenance'])];
    expect(chooseJobs(open, cards, NOW, CFG, AT_HEAD)).toEqual([{ stage: 'playtest', issue: 20 }]);
    expect(chooseJobs(open, [tracking(), card(21, 'Testing', ['release-task', 'maintenance'])], NOW, CFG, AT_HEAD)).toEqual([{ stage: 'verify', issue: 21 }]);
  });

  it('plays again when the release moved past the passed commit', () => {
    expect(chooseJobs(passed, [tracking()], NOW, CFG, { dev: null, release: 'rel0002' })).toEqual([{ stage: 'playtest', issue: 20 }]);
  });

  it('runs neither the playtest nor the candidate while the release head is unknown or the playtest is blocked', () => {
    expect(chooseJobs(passed, [tracking()], NOW, CFG)).toEqual([]);
    const blocked = { ...open, release: { ...RELEASE, playtest: { ...RELEASE.playtest, passed: 'rel0001', blocked: { sha: 'rel0002', reason: 'r' } } } };
    expect(chooseJobs(blocked, [tracking()], NOW, CFG, AT_HEAD)).toEqual([]);
    expect(evaluateSchedule(blocked, [tracking()], NOW, CFG, AT_HEAD).release.reason).toBe('playtest-blocked');
  });

  it('runs the playtest in the verify queue, beside a branch job', () => {
    const busy = { ...open, pendingApprovals: { '4': 'u' } };
    expect(chooseJobs(busy, [tracking()], NOW, CFG, AT_HEAD)).toEqual([{ stage: 'approve', issue: 4 }, { stage: 'playtest', issue: 20 }]);
    expect(chooseJobs({ ...open, jobs: [running('verify', 9)] }, [tracking()], NOW, CFG, AT_HEAD)).toEqual([]);
  });

  it('waits for a release task outside Done, also a stuck one', () => {
    expect(chooseJobs(open, [tracking(), card(21, 'Approval', ['release-task'])], NOW, CFG)).toEqual([]);
    expect(chooseJobs(open, [tracking(), card(21, 'Testing', ['release-task', STUCK_LABEL])], NOW, CFG)).toEqual([]);
  });

  it('waits when the tracking issue is stuck, missing, or already has a post', () => {
    expect(chooseJobs(open, [tracking(['release', STUCK_LABEL])], NOW, CFG)).toEqual([]);
    expect(chooseJobs(open, [], NOW, CFG)).toEqual([]);
    expect(chooseJobs({ ...open, release: { ...RELEASE, postId: 5 } }, [tracking()], NOW, CFG)).toEqual([]);
  });

  it('counts the playtest and the candidate against the daily cap', () => {
    expect(chooseJobs({ ...open, jobStarts: starts(23, 5, 1) }, [tracking()], NOW, CFG, AT_HEAD)).toEqual([]);
    expect(chooseJobs({ ...passed, jobStarts: starts(23, 5, 1) }, [tracking()], NOW, CFG, AT_HEAD)).toEqual([]);
  });

  it('runs release tasks before other cards, furthest along first', () => {
    const cards = [tracking(), card(30, 'Implementation'), card(21, 'Design', ['release-task']), card(22, 'Implementation', ['release-task'])];
    expect(chooseJobs(open, cards, NOW, ONE)).toEqual([{ stage: 'implement', issue: 22 }, { stage: 'design', issue: 21 }]);
    expect(chooseJobs(open, cards, NOW, CFG)).toEqual([{ stage: 'implement', issue: 22 }, { stage: 'design', issue: 21 }, { stage: 'implement', issue: 30 }]);
  });

  it('never gives the tracking issue card a card job', () => {
    expect(chooseJobs(state(), [card(20, 'Design', ['release'])], NOW, CFG)).toEqual([]);
  });

  it('runs one branch job at a time, a removal before a ship, beside ad hoc work, at the cap too', () => {
    const queuedState = { ...open, release: { ...RELEASE, postId: 5 }, pendingShip: 'Ann', pendingRemovals: [{ issue: 8, by: 'Ann', text: 't' }], jobStarts: starts(23, 5, 1) };
    const adhoc = [card(6, 'Implementation', ['adhoc'])];
    expect(chooseJobs(queuedState, adhoc, NOW, CFG)).toEqual([{ stage: 'remove', issue: 8 }, { stage: 'adhoc', issue: 6 }]);
    expect(chooseJobs({ ...queuedState, pendingRemovals: [] }, adhoc, NOW, CFG)).toEqual([{ stage: 'ship', issue: 20 }, { stage: 'adhoc', issue: 6 }]);
  });

  it('runs an approval before a removal', () => {
    const s = { ...open, pendingApprovals: { '4': 'u' }, pendingRemovals: [{ issue: 8, by: 'Ann', text: 't' }] };
    expect(chooseJobs(s, [], NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }]);
  });

  it('ignores a queued ship when no release is open', () => {
    expect(chooseJobs(state({ pendingShip: 'Ann' }), [], NOW, CFG)).toEqual([]);
  });
});

describe('chooseJobs', () => {
  it('picks the lowest ad hoc card before other agent work, beside a branch job', () => {
    const cards = [card(8, 'Implementation', ['adhoc']), card(6, 'Implementation', ['adhoc']), card(5, 'Implementation'), card(7, 'Implementation', ['adhoc', 'factory-stuck'])];
    expect(chooseJobs(state({ lastRelease: null }), cards, NOW, ONE)).toEqual([{ stage: 'release', issue: null }, { stage: 'adhoc', issue: 6 }]);
    expect(chooseJobs(state(), cards, NOW, CFG)).toEqual([{ stage: 'adhoc', issue: 6 }, { stage: 'adhoc', issue: 8 }, { stage: 'implement', issue: 5 }]);
  });

  it('runs a hotfix card before ad hoc work and other cards, at the cap too', () => {
    const cards = [card(2, 'Implementation', ['adhoc']), card(3, 'Testing'), card(9, 'Design', ['bug', 'hotfix']), card(8, 'Design', ['hotfix', 'factory-stuck'])];
    expect(chooseJobs(state(), cards, NOW, ONE)).toEqual([{ stage: 'design', issue: 9 }, { stage: 'adhoc', issue: 2 }, { stage: 'verify', issue: 3 }]);
    expect(chooseJobs(state({ jobStarts: starts(23, 5, 1) }), cards, NOW, CFG)).toEqual([{ stage: 'design', issue: 9 }, { stage: 'adhoc', issue: 2 }]);
  });

  it('skips ad hoc cards in the normal implement pick', () => {
    expect(chooseJobs(state(), [card(2, 'Implementation', ['adhoc', 'factory-stuck']), card(3, 'Implementation')], NOW, CFG)).toEqual([{ stage: 'implement', issue: 3 }]);
  });

  it('fills each queue up to its limit beside running jobs, never twice on one issue', () => {
    const s = state({ jobs: [running('design', 1), running('verify', 7), running('approve', 9)], pendingIncidents: [3] });
    const cards = [card(1, 'Design'), card(2, 'Design'), card(8, 'Testing'), card(4, 'Triage'), card(5, 'Triage')];
    expect(chooseJobs(s, cards, NOW, { ...CFG, maxJobsPerDay: 10 })).toEqual([{ stage: 'design', issue: 2 }, { stage: 'triage', issue: 4 }, { stage: 'triage', issue: 5 }]);
    const idle = state({ jobs: [running('design', 1)] });
    expect(chooseJobs(idle, cards, NOW, { ...CFG, maxJobsPerDay: 10, testWorkers: 2, designWorkers: 1 })).toEqual([{ stage: 'verify', issue: 8 }, { stage: 'triage', issue: 4 }, { stage: 'triage', issue: 5 }]);
  });

  it('counts each counted pick against the cap slots left', () => {
    const cards = [card(1, 'Design'), card(2, 'Design'), card(3, 'Design')];
    expect(chooseJobs(state({ jobStarts: starts(2) }), cards, NOW, CFG)).toEqual([{ stage: 'design', issue: 1 }, { stage: 'design', issue: 2 }]);
  });

  it('runs the lowest pending approval, and a change beside it', () => {
    const s = state({ pendingApprovals: { '9': 'u', '4': 'u' }, pendingChanges: [{ id: 3, text: 't', by: 'u' }] });
    expect(chooseJobs(s, [], NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }, { stage: 'change', issue: 3 }]);
  });

  it('runs a pending change beside a due release cut', () => {
    const s = state({ pendingChanges: [{ id: 3, text: 't', by: 'u' }], lastRelease: null });
    expect(chooseJobs(s, [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }, { stage: 'change', issue: 3 }]);
  });

  it('runs release when never released or older than the interval', () => {
    expect(chooseJobs(state({ lastRelease: null }), [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
    expect(chooseJobs(state({ lastRelease: '2026-01-03T11:00:00Z' }), [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
  });

  it('skips release inside the interval', () => {
    expect(chooseJobs(state({ lastRelease: '2026-01-03T13:00:00Z' }), [], NOW, CFG)).toEqual([]);
  });

  it('picks the card furthest along, lowest issue first, per queue', () => {
    const cards = [card(1, 'Design'), card(5, 'Implementation'), card(7, 'Testing'), card(6, 'Testing')];
    expect(chooseJobs(state(), cards, NOW, ONE)).toEqual([{ stage: 'verify', issue: 6 }, { stage: 'implement', issue: 5 }, { stage: 'design', issue: 1 }]);
    expect(chooseJobs(state(), cards.slice(0, 1), NOW, ONE)).toEqual([{ stage: 'design', issue: 1 }]);
  });

  it('runs Triage cards in their own queue beside a long design, and skips needs-info and stuck ones', () => {
    const cards = [card(1, 'Triage'), card(2, 'Triage', [NEEDS_INFO_LABEL]), card(3, 'Design')];
    expect(chooseJobs(state(), cards, NOW, ONE)).toEqual([{ stage: 'design', issue: 3 }, { stage: 'triage', issue: 1 }]);
    expect(chooseJobs(state({ jobs: [running('design', 5)] }), cards, NOW, ONE)).toEqual([{ stage: 'triage', issue: 1 }]);
    expect(chooseJobs(state(), cards.slice(0, 2), NOW, ONE)).toEqual([{ stage: 'triage', issue: 1 }]);
    expect(chooseJobs(state(), [card(2, 'Triage', [NEEDS_INFO_LABEL]), card(4, 'Triage', [STUCK_LABEL])], NOW, CFG)).toEqual([]);
  });

  it('rebuilds /dev/ when dev moved, after queued work, beside cards, at the cap too', () => {
    const cards = [card(6, 'Implementation', ['adhoc']), card(4, 'Design')];
    expect(chooseJobs(state(), cards, NOW, CFG, { dev: 'dev0002', release: null })).toEqual([{ stage: 'dev', issue: null }, { stage: 'adhoc', issue: 6 }, { stage: 'design', issue: 4 }]);
    expect(chooseJobs(state({ jobStarts: starts(23, 5, 1) }), [], NOW, CFG, { dev: 'dev0002', release: null })).toEqual([{ stage: 'dev', issue: null }]);
    expect(chooseJobs(state({ pendingApprovals: { '4': 'u' } }), [], NOW, CFG, { dev: 'dev0002', release: null })).toEqual([{ stage: 'approve', issue: 4 }]);
    expect(chooseJobs(state({ jobs: [running('approve', 4)] }), [], NOW, CFG, { dev: 'dev0002', release: null })).toEqual([]);
  });

  it('leaves /dev/ alone when it serves dev or dev failed to build', () => {
    expect(chooseJobs(state(), [], NOW, CFG, { dev: DEV, release: null })).toEqual([]);
    expect(chooseJobs(state({ devFailed: 'dev0002' }), [], NOW, CFG, { dev: 'dev0002', release: null })).toEqual([]);
    expect(chooseJobs(state({ devFailed: 'dev0002' }), [], NOW, CFG, { dev: 'dev0003', release: null })).toEqual([{ stage: 'dev', issue: null }]);
  });

  it('skips stuck cards, Approval and Done', () => {
    const cards = [card(1, 'Testing', [STUCK_LABEL]), card(2, 'Approval'), card(3, 'Done'), card(4, 'Design')];
    expect(chooseJobs(state(), cards, NOW, CFG)).toEqual([{ stage: 'design', issue: 4 }]);
    expect(chooseJobs(state(), cards.slice(0, 3), NOW, CFG)).toEqual([]);
  });
});

type Harness = { ctx: Ctx; sent: string[]; labels: string[]; removed: string[]; deps: TickDeps; killed: string[]; spawned: string[][]; pinned: string[] };

function harness(job: Job | null, alive: boolean, cards: Card[] = [], comments: IssueComment[] = [], devHead = DEV): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'tick-'));
  const statePath = join(dir, 'state.json');
  writeState(statePath, state({ jobs: job ? [job] : [] }));
  const sent: string[] = [];
  const labels: string[] = [];
  const removed: string[] = [];
  const killed: string[] = [];
  const spawned: string[][] = [];
  const pinned: string[] = [];
  const github = { cards: async () => cards, candidates: async () => [], addLabel: async (n: number, l: string) => { labels.push(`${n}:${l}`); }, comments: async () => comments, removeLabel: async (n: number, l: string) => { removed.push(`${n}:${l}`); } };
  const telegram = { sendMessage: async (_chat: string, text: string) => { sent.push(text); return 1; } };
  const cfg = { home: dir, webRoot: join(dir, 'web'), repo: 'o/r', committeeChat: 'c', triageTimeoutMinutes: 30, designTimeoutMinutes: 30, implementTimeoutMinutes: 120, verifyTimeoutMinutes: 30, testTimeoutMinutes: 30, branchTimeoutMinutes: 30, replyRouteMinutes: 15, minFreeGb: 0.001, minAvailableGb: 1, logDays: 14, cpuLight: 0.25, cpuImplement: 0.25, cpuTest: 0.5, vitestWorkersImplement: 2, vitestWorkersTest: 4, ...CFG };
  const repo = { fetch: async () => {},headHash: async (branch: string) => { if (branch === RELEASE.branch) return 'rel0001'; if (branch !== 'dev') throw new Error(`unexpected branch ${branch}`); return devHead; } };
  const ctx = { cfg, github, telegram, repo, statePath, now: () => NOW, log: () => undefined } as unknown as Ctx;
  const deps: TickDeps = { isAlive: () => alive, kill: async (_run, pid, id) => { killed.push(`${pid} ${id}`); }, removeContainers: async (_run, id) => { killed.push(`containers ${id}`); }, spawn: (args, _cwd, _log, id, cpus, testWorkers) => { spawned.push([...args, id]); pinned.push(`${args[0]} ${cpus} ${testWorkers}`); return 77; }, cores: () => 4 };
  return { ctx, sent, labels, removed, deps, killed, spawned, pinned };
}

const job = (startedAt: string, stage: Job['stage'] = 'design', issue: number | null = 5): Job => ({ id: `${stage}-job`, stage, issue, pid: 42, startedAt, log: '/l.log' });
// The spawned args without the job id at the end.
const args = (h: Harness): string[][] => h.spawned.map((call) => call.slice(0, 2));

describe('tick', () => {
  it('kills a job past the timeout by its id, clears it and reports', async () => {
    const h = harness(job('2026-01-10T11:00:00Z'), true);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual(['42 design-job']);
    expect(h.labels).toEqual([`5:${STUCK_LABEL}`]);
    expect(readState(h.ctx.statePath).failures[0].error).toBe('timed out after 30 minutes');
    expect(h.sent).toEqual([]);
    expect(readState(h.ctx.statePath).jobs).toEqual([]);
    expect(readLedger(h.ctx.cfg.home, new Date(0)).filter((line) => line.kind === 'job')).toEqual([{ kind: 'job', retryOf: null, id: 'design-job', stage: 'design', issue: 5, startedAt: '2026-01-10T11:00:00Z', endedAt: NOW.toISOString(), outcome: 'timeout', agents: [] }]);
  });

  it('times a job by the limit of its own queue', async () => {
    const h = harness(job('2026-01-10T11:00:00Z', 'implement'), true);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([]);
    expect(readState(h.ctx.statePath).jobs.map((j) => j.stage)).toEqual(['implement']);
  });

  it('leaves a job in time alone and starts another beside it', async () => {
    const h = harness(job('2026-01-10T11:50:00Z'), true, [card(5, 'Design'), card(8, 'Design')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([]);
    expect(args(h)).toEqual([['design', '8']]);
    expect(readState(h.ctx.statePath).jobs.map((j) => [j.issue, j.pid])).toEqual([[5, 42], [8, 77]]);
  });

  it('starts each job on the CPUs and test workers of its pool, verify beside implement and checks alone on the test pool', async () => {
    const h = harness(null, true, [card(3, 'Implementation'), card(4, 'Testing'), card(5, 'Testing')]);
    writeState(h.ctx.statePath, state({ testPhase: { 5: 'checks' } }));
    await tick(h.ctx, '/code', h.deps);
    expect(h.pinned.sort()).toEqual(['checks 2-3 4', 'implement 1 2', 'verify 1 2']);
  });

  it('starts no job while free disk is under the minimum, and still cleans', async () => {
    const h = harness(null, true, [card(8, 'Design'), card(9, 'Done')]);
    mkdirSync(join(h.ctx.cfg.home, 'work', 'issue-9'), { recursive: true });
    h.ctx.cfg.minFreeGb = Number.MAX_SAFE_INTEGER;
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([]);
    expect(existsSync(join(h.ctx.cfg.home, 'work', 'issue-9'))).toBe(false);
  });

  it('keeps the clone of a running job and removes the clone of a Done card', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'checks', 5), true, [card(5, 'Done'), card(9, 'Done')]);
    for (const name of ['issue-5', 'check-issue-5', 'issue-9']) mkdirSync(join(h.ctx.cfg.home, 'work', name), { recursive: true });
    await tick(h.ctx, '/code', h.deps);
    expect(['issue-5', 'check-issue-5', 'issue-9'].map((name) => existsSync(join(h.ctx.cfg.home, 'work', name)))).toEqual([true, true, false]);
  });

  it('reports a change job that died a second time, without an issue', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'change', 3), false);
    writeState(h.ctx.statePath, state({ jobs: [job('2026-01-10T11:50:00Z', 'change', 3)], interrupted: [3] }));
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([]);
    expect(readState(h.ctx.statePath).failures).toMatchObject([{ stage: 'change', issue: null, error: 'job process died without finishing' }]);
    expect(readState(h.ctx.statePath).jobs).toEqual([]);
    expect(readLedger(h.ctx.cfg.home, new Date(0)).filter((line) => line.kind === 'job')).toMatchObject([{ id: 'change-job', outcome: 'died' }]);
  });

  it('starts the chosen jobs and records each with its id', async () => {
    const h = harness(null, false, [card(8, 'Implementation'), card(9, 'Testing')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([['verify', '9', 'verify-9-2026-01-10T120000.000Z'], ['implement', '8', 'implement-8-2026-01-10T120000.000Z']]);
    const started = readState(h.ctx.statePath).jobs;
    expect(started[1]).toMatchObject({ id: 'implement-8-2026-01-10T120000.000Z', stage: 'implement', issue: 8, pid: 77 });
    expect(started[1].log).toMatch(/logs\/implement-8-2026-01-10T120000\.000Z\.log$/);
  });

  it('skips build cleanup while a checks or branch job runs, not while a verify agent runs', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'checks', 9), true, []);
    mkdirSync(join(h.ctx.cfg.webRoot, 'fresh01'), { recursive: true });
    await tick(h.ctx, '/code', h.deps);
    expect(existsSync(join(h.ctx.cfg.webRoot, 'fresh01'))).toBe(true);
    const agent = harness(job('2026-01-10T11:50:00Z', 'verify', 9), true, []);
    mkdirSync(join(agent.ctx.cfg.webRoot, 'fresh01'), { recursive: true });
    await tick(agent.ctx, '/code', agent.deps);
    expect(existsSync(join(agent.ctx.cfg.webRoot, 'fresh01'))).toBe(false);
  });

  it('picks verify for a Testing card with no phase or a fix phase, and checks once verify is done', () => {
    const cards = [card(1, 'Testing'), card(2, 'Testing'), card(3, 'Testing'), card(4, 'Testing')];
    const phases = state({ testPhase: { 2: 'checks', 3: 'fix', 4: 'checks-after-fix' } });
    const picks = chooseJobs(phases, cards, NOW, { ...CFG, maxJobsPerDay: 10, verifyWorkers: 2, testWorkers: 2 });
    expect(picks).toEqual([{ stage: 'verify', issue: 1 }, { stage: 'checks', issue: 2 }, { stage: 'verify', issue: 3 }, { stage: 'checks', issue: 4 }]);
  });

  it('picks harden for a Hardening card, and checks once harden set the phase, ahead of Testing', () => {
    const cards = [card(1, 'Testing'), card(5, 'Hardening'), card(6, 'Hardening'), card(7, 'Hardening')];
    const phases = state({ testPhase: { 6: 'checks', 7: 'fix' } });
    const picks = chooseJobs(phases, cards, NOW, { ...CFG, maxJobsPerDay: 10, verifyWorkers: 3, testWorkers: 2 });
    expect(picks).toEqual([{ stage: 'harden', issue: 5 }, { stage: 'checks', issue: 6 }, { stage: 'harden', issue: 7 }, { stage: 'verify', issue: 1 }]);
  });

  it('runs a patch for an Implementation card with a queued patch, in the implement queue', () => {
    const picks = chooseJobs(state({ patching: { 4: 'abc1234' } }), [card(3, 'Implementation'), card(4, 'Implementation')], NOW, { ...CFG, maxJobsPerDay: 10 });
    expect(picks).toEqual([{ stage: 'implement', issue: 3 }, { stage: 'patch', issue: 4 }]);
  });

  it('turns a reply Hermes left unrouted past the limit into a failure, and keeps a fresh one', async () => {
    const h = harness(null, false);
    const old = new Date(NOW.getTime() - 20 * 60_000).toISOString();
    const fresh = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    writeState(h.ctx.statePath, state({ unroutedReplies: { 3: { issue: 4, postId: 42, text: 'show the atlas', at: old }, 6: { issue: 5, postId: 43, text: 'x', at: fresh } } }));
    await tick(h.ctx, '/code', h.deps);
    const after = readState(h.ctx.statePath);
    expect(after.unroutedReplies).toEqual({ 6: { issue: 5, postId: 43, text: 'x', at: fresh } });
    expect(after.failures).toMatchObject([{ stage: 'feedback', issue: 4, error: expect.stringContaining('got no route within 15 minutes') }]);
    expect(h.labels).toEqual([`4:${STUCK_LABEL}`]);
  });

  it('starts the waste review when its period passed, at the cap too, before card work in the triage queue', () => {
    const due = state({ lastWasteReview: '2026-01-02T12:00:00Z', jobStarts: starts(1, 2, 3) });
    expect(chooseJobs(due, [card(5, 'Triage')], NOW, { ...CFG, triageWorkers: 1 })).toEqual([{ stage: 'waste', issue: null }]);
    expect(chooseJobs(state({ lastWasteReview: '2026-01-05T12:00:00Z' }), [], NOW, CFG)).toEqual([]);
  });

  it('never starts a review the first time it sees no review, and starts the period then', async () => {
    expect(chooseJobs(state({ lastWasteReview: null }), [], NOW, CFG)).toEqual([]);
    const h = harness(null, false);
    writeState(h.ctx.statePath, state({ lastWasteReview: null }));
    await tick(h.ctx, '/code', h.deps);
    expect(readState(h.ctx.statePath).lastWasteReview).toBe(NOW.toISOString());
    expect(args(h)).toEqual([]);
  });

  it('runs a checks job beside a verify agent, one per queue', () => {
    const picks = chooseJobs(state({ testPhase: { 2: 'checks', 3: 'checks' } }), [card(1, 'Testing'), card(2, 'Testing'), card(3, 'Testing'), card(5, 'Testing')], NOW, { ...CFG, maxJobsPerDay: 10 });
    expect(picks).toEqual([{ stage: 'verify', issue: 1 }, { stage: 'checks', issue: 2 }]);
  });

  it('starts a /dev/ rebuild when origin dev moved past the build', async () => {
    const h = harness(null, false, [card(8, 'Implementation')], [], 'dev0002');
    await tick(h.ctx, '/code', h.deps);
    expect(args(h)).toEqual([['dev', '-'], ['implement', '8']]);
    expect(readState(h.ctx.statePath).jobStarts).toEqual([NOW.toISOString()]);
  });

  it('removes needs-info from an answered Triage card and starts its triage', async () => {
    const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
    const h = harness(null, false, [card(8, 'Triage', [NEEDS_INFO_LABEL])], [asked, { login: 'anna', body: 'This' }]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.removed).toEqual([`8:${NEEDS_INFO_LABEL}`]);
    expect(args(h)).toEqual([['triage', '8']]);
  });

  it('keeps needs-info while nobody answered and starts nothing', async () => {
    const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
    const h = harness(null, false, [card(8, 'Triage', [NEEDS_INFO_LABEL])], [asked]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.removed).toEqual([]);
    expect(h.spawned).toEqual([]);
  });

  it('counts and prunes public-driven starts, not committee-driven ones', async () => {
    const h = harness(null, false, [card(8, 'Implementation')]);
    writeState(h.ctx.statePath, state({ jobStarts: starts(30, 2) }));
    await tick(h.ctx, '/code', h.deps);
    expect(readState(h.ctx.statePath).jobStarts).toEqual([...starts(2), NOW.toISOString()]);
    expect(readState(h.ctx.statePath).cardStarts).toEqual({ 8: [NOW.toISOString()] });
    const c = harness(null, false, []);
    writeState(c.ctx.statePath, state({ jobStarts: starts(2), pendingApprovals: { '3': 'u' } }));
    await tick(c.ctx, '/code', c.deps);
    expect(args(c)).toEqual([['approve', '3']]);
    expect(readState(c.ctx.statePath).jobStarts).toEqual(starts(2));
  });

  it('holds capped work at the cap without a chat message, across cap windows', async () => {
    const h = harness(null, false, [card(8, 'Design')]);
    const scheduler = () => readObservation(h.ctx.cfg.home, 'scheduler')?.data as SchedulerData;
    writeState(h.ctx.statePath, state({ jobStarts: starts(23, 5, 1) }));
    await tick(h.ctx, '/code', h.deps);
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([]);
    expect(scheduler().report?.decisions.find((item) => item.issue === 8)?.reasons).toContain('daily-cap');
    expect(scheduler().report?.nextCapAt).toBe('2026-01-10T13:00:00.000Z');
    expect(readState(h.ctx.statePath).jobStarts).toEqual(starts(23, 5, 1));
    writeState(h.ctx.statePath, state({ jobStarts: starts(1, 5) }));
    await tick(h.ctx, '/code', h.deps);
    expect(args(h)).toEqual([['design', '8']]);
    expect(scheduler().report?.nextCapAt).toBeNull();
    const again = harness(null, false, [card(8, 'Design')]);
    writeState(again.ctx.statePath, state({ jobStarts: starts(23, 5, 1) }));
    await tick(again.ctx, '/code', again.deps);
    expect(again.spawned).toEqual([]);
    expect([...h.sent, ...again.sent]).toEqual([]);
  });

  it('starts jobs before intake, so a failed intake still fails the tick but holds back no job', async () => {
    const h = harness(null, true, [card(8, 'Design')]);
    h.ctx.github.candidates = async () => { throw new Error('HTTP 403: API rate limit exceeded'); };
    await expect(tick(h.ctx, '/code', h.deps)).rejects.toThrow('rate limit');
    expect(args(h)).toEqual([['design', '8']]);
  });

  it('deletes builds outside Approval, keeping dev', async () => {
    const h = harness(null, false, [card(8, 'Approval'), card(9, 'Done')]);
    const web = h.ctx.cfg.webRoot;
    for (const name of ['dev', 'aaa1111', 'bbb2222', 'ccc3333']) mkdirSync(join(web, name), { recursive: true });
    writeState(h.ctx.statePath, state({ builds: { '8': 'aaa1111', '9': 'bbb2222' } }));
    await tick(h.ctx, '/code', h.deps);
    expect(['dev', 'aaa1111', 'bbb2222', 'ccc3333'].filter((name) => existsSync(join(web, name)))).toEqual(['dev', 'aaa1111']);
  });

  it('keeps the rc build while the tracking card waits in Approval', async () => {
    const h = harness(null, false, [card(20, 'Approval', ['release']), card(9, 'Done')]);
    const web = h.ctx.cfg.webRoot;
    for (const name of ['dev', 'rc', 'bbb2222']) mkdirSync(join(web, name), { recursive: true });
    writeState(h.ctx.statePath, state({ release: { ...RELEASE, postId: 7, candidateSha: 'rel0001' }, builds: { '20': 'rc', '9': 'bbb2222' } }));
    await tick(h.ctx, '/code', h.deps);
    expect(['dev', 'rc', 'bbb2222'].filter((name) => existsSync(join(web, name)))).toEqual(['dev', 'rc']);
  });

  it('labels the tracking issue when a playtest job runs past the verify time limit, so the release stays blocked', async () => {
    const h = harness(job('2026-01-10T11:00:00Z', 'playtest', 20), true);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toContain('42 playtest-job');
    expect(h.labels).toEqual([`20:${STUCK_LABEL}`]);
  });

  it('labels the tracking issue when a candidate job dies', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'candidate', 20), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([`20:${STUCK_LABEL}`]);
  });

  it('labels the tracking issue when a release cut dies after it opened one, and no issue before', async () => {
    const after = harness(job('2026-01-10T11:50:00Z', 'release', null), false);
    writeState(after.ctx.statePath, state({ jobs: [job('2026-01-10T11:50:00Z', 'release', null)], release: RELEASE }));
    await tick(after.ctx, '/code', after.deps);
    expect(after.labels).toEqual([`20:${STUCK_LABEL}`]);
    const before = harness(job('2026-01-10T11:50:00Z', 'release', null), false);
    await tick(before.ctx, '/code', before.deps);
    expect(before.labels).toEqual([]);
  });

  it('labels the removed feature when a removal dies', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'remove', 8), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([`8:${STUCK_LABEL}`]);
  });

  describe('a job whose process died', () => {
    const IN_TIME = '2026-01-10T11:50:00Z';
    const sessions = (h: Harness): string => join(h.ctx.cfg.home, 'sessions', 'issue-5');

    it('resumes an agent job once: removes its containers, marks the issue, reports nothing and starts it again', async () => {
      const h = harness(job(IN_TIME), false, [card(5, 'Design')]);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME)], jobStarts: [IN_TIME] }));
      await tick(h.ctx, '/code', h.deps);
      expect(h.killed).toEqual(['containers design-job']);
      expect(args(h)).toEqual([['design', '5']]);
      expect(resumedStage(h.ctx.cfg.home, 5)).toBe('design');
      const after = readState(h.ctx.statePath);
      expect(after.interrupted).toEqual([5]);
      expect(after.failures).toEqual([]);
      expect(h.labels).toEqual([]);
      expect(after.jobs.map((j) => j.pid)).toEqual([77]);
      expect(readLedger(h.ctx.cfg.home, new Date(0)).filter((line) => line.kind === 'job')).toMatchObject([{ id: 'design-job', outcome: 'died' }]);
    });

    it('resumes a test job too', async () => {
      const h = harness(job(IN_TIME, 'verify', 5), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME, 'verify', 5)] }));
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath)).toMatchObject({ interrupted: [5], failures: [], jobs: [] });
    });

    it('frees the cap slot of the dead job, so the restart does not count twice', async () => {
      const h = harness(job(IN_TIME), false, [card(5, 'Design')]);
      const other = starts(20, 1);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME)], jobStarts: [other[0], IN_TIME, other[1]] }));
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath).jobStarts).toEqual([other[0], other[1], NOW.toISOString()]);
    });

    it('takes no cap slot from an uncapped job that resumes', async () => {
      const h = harness(job(IN_TIME, 'adhoc', 5), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME, 'adhoc', 5)], jobStarts: [IN_TIME] }));
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath).jobStarts).toEqual([IN_TIME]);
      expect(readState(h.ctx.statePath).interrupted).toEqual([5]);
    });

    it('fails a second death, clears the mark and the sessions, and reports', async () => {
      const h = harness(job(IN_TIME), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME)], interrupted: [5, 6] }));
      mkdirSync(sessions(h), { recursive: true });
      await tick(h.ctx, '/code', h.deps);
      expect(h.killed).toEqual([]);
      expect(h.labels).toEqual([`5:${STUCK_LABEL}`]);
      const after = readState(h.ctx.statePath);
      expect(after.failures).toMatchObject([{ stage: 'design', issue: 5, error: 'job process died without finishing' }]);
      expect(after.interrupted).toEqual([6]);
      expect(after.jobs).toEqual([]);
      expect(existsSync(sessions(h))).toBe(false);
    });

    it('fails a job past the timeout and never resumes it, dead or alive', async () => {
      const late = '2026-01-10T11:00:00Z';
      const alive = harness(job(late), true);
      await tick(alive.ctx, '/code', alive.deps);
      expect(readState(alive.ctx.statePath)).toMatchObject({ interrupted: [], failures: [{ error: 'timed out after 30 minutes' }] });
      const dead = harness(job(late), false);
      await tick(dead.ctx, '/code', dead.deps);
      expect(readState(dead.ctx.statePath)).toMatchObject({ interrupted: [], failures: [{ error: 'job process died without finishing' }] });
    });

    it('clears a lingering mark and the sessions of a timed out job', async () => {
      const h = harness(job('2026-01-10T11:00:00Z'), true);
      writeState(h.ctx.statePath, state({ jobs: [job('2026-01-10T11:00:00Z')], interrupted: [5] }));
      mkdirSync(sessions(h), { recursive: true });
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath).interrupted).toEqual([]);
      expect(existsSync(sessions(h))).toBe(false);
    });

    it('fails a dead branch job, and touches no mark or sessions of its issue', async () => {
      const h = harness(job(IN_TIME, 'approve', 5), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME, 'approve', 5)], interrupted: [5] }));
      mkdirSync(sessions(h), { recursive: true });
      await tick(h.ctx, '/code', h.deps);
      expect(h.killed).toEqual([]);
      expect(readState(h.ctx.statePath)).toMatchObject({ interrupted: [5], failures: [{ stage: 'approve' }], jobs: [] });
      expect(existsSync(sessions(h))).toBe(true);
    });
  });

  it('starts a queued ship without counting it against the cap', async () => {
    const h = harness(null, false, []);
    writeState(h.ctx.statePath, state({ release: { ...RELEASE, postId: 7, candidateSha: 'rel0001' }, pendingShip: 'Ann', jobStarts: starts(2) }));
    await tick(h.ctx, '/code', h.deps);
    expect(args(h)).toEqual([['ship', '20']]);
    expect(readState(h.ctx.statePath).jobStarts).toEqual(starts(2));
  });

  it('keeps the candidate post while a ship runs, since the ship moves the release itself', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'ship', 20), true, [card(20, 'Approval', ['release'])]);
    writeState(h.ctx.statePath, state({ jobs: [job('2026-01-10T11:50:00Z', 'ship', 20)], release: { ...RELEASE, postId: 7, candidateSha: 'rel0000' }, pendingShip: 'Ann' }));
    await tick(h.ctx, '/code', h.deps);
    expect(readState(h.ctx.statePath).release?.postId).toBe(7);
    expect(readState(h.ctx.statePath).pendingShip).toBe('Ann');
  });

  it('drops the candidate post and a queued ship once the release moved past the posted commit, and plays the new head', async () => {
    const h = harness(null, false, [card(20, 'Approval', ['release'])]);
    writeState(h.ctx.statePath, state({ release: { ...RELEASE, postId: 7, candidateSha: 'rel0000', playtest: { ...RELEASE.playtest, passed: 'rel0000' } }, pendingShip: 'Ann' }));
    await tick(h.ctx, '/code', h.deps);
    const after = readState(h.ctx.statePath);
    expect(after.release?.postId).toBeNull();
    expect(after.pendingShip).toBeNull();
    expect(args(h)).toEqual([['playtest', '20']]);
  });
});
