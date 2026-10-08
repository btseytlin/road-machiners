import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { sweepLogs, sweepTestCache, sweepWork } from './cleanup';
import { cpuSets, poolOf, vitestWorkersOf } from './cpus';
import { removeStaleBuilds } from './deploy';
import { freeGb } from './health';
import { failureIssue, pruneFailures, reportFailure } from './fail';
import { intake } from './intake';
import { recordJob } from './ledger';
import { reportAttempt, reportScheduler } from './observability';
import { pruneCaptions } from './post-status';
import { isAlive, killJob, removeJobContainers, spawnJob } from './jobs';
import { clearSessions, markResumed } from './sessions';
import { openTasks } from './stages/release-common';
import { readState, updateState } from './state';
import { sweepTranscripts } from './transcript-archive';
import { askedAt, isAnswered } from './questions';
import { ADHOC_LABEL, AGENT_QUEUES, HOTFIX_LABEL, NEEDS_INFO_LABEL, QUEUE_OF, RELEASE_LABEL, RELEASE_TASK_LABEL, STUCK_LABEL } from './types';
import type { Card, Ctx, FactoryConfig, FactoryState, Job, JobStage, PlaytestState, Queue, Run } from './types';

export type JobPick = { stage: JobStage; issue: number | null };
type Candidate = JobPick & { uncapped: boolean };
type Due = Pick<FactoryConfig, 'releaseDays' | 'wasteReviewDays' | 'maxJobsPerDay' | 'maxJobsPerCard' | 'triageWorkers' | 'designWorkers' | 'implementWorkers' | 'verifyWorkers' | 'testWorkers'>;

const DAY_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;
const UNCAPPED_STAGES: JobStage[] = ['approve', 'merge', 'remove', 'ship', 'change', 'adhoc', 'incident', 'dev', 'waste', 'checks'];
const CARD_ORDER: Card['column'][] = ['Hardening', 'Testing', 'Implementation', 'Design', 'Triage'];

function isDue(last: string | null, now: Date, everyMs: number): boolean {
  return last === null || now.getTime() - new Date(last).getTime() > everyMs;
}

const isHeld = (state: FactoryState, issue: number | null): boolean => issue !== null && String(issue) in state.held;

function queued(state: FactoryState): JobPick[] {
  const approvals = Object.keys(state.pendingApprovals).map(Number).filter((issue) => !isHeld(state, issue)).sort((a, b) => a - b);
  const ship: JobPick[] = state.pendingShip !== null && state.release ? [{ stage: 'ship', issue: state.release.issue }] : [];
  return [
    ...approvals.map((issue) => ({ stage: 'approve' as const, issue })),
    ...state.pendingRemovals.map((removal) => ({ stage: 'remove' as const, issue: removal.issue })),
    ...ship,
    ...state.pendingIncidents.map((issue) => ({ stage: 'incident' as const, issue })),
  ];
}

function changeJobs(state: FactoryState): JobPick[] {
  return state.pendingChanges.map((change) => ({ stage: 'change' as const, issue: change.id }));
}

function openCards(state: FactoryState, cards: Card[]): Card[] {
  return cards.filter((card) => !card.labels.includes(STUCK_LABEL) && !card.labels.includes(NEEDS_INFO_LABEL) && !isHeld(state, card.issue));
}

function byProgress(state: FactoryState, cards: Card[]): JobPick[] {
  return CARD_ORDER.flatMap((column) =>
    cards
      .filter((card) => card.column === column)
      .sort((a, b) => a.issue - b.issue)
      .map((card) => ({ stage: cardStage(state, card), issue: card.issue })),
  );
}

const COLUMN_STAGE: Partial<Record<Card['column'], (state: FactoryState, issue: number) => JobStage>> = {
  Hardening: () => 'harden',
  Testing: (state, issue) => (state.postOnly.includes(issue) ? 'checks' : 'verify'),
  Implementation: () => 'implement',
  Design: () => 'design',
};

function cardStage(state: FactoryState, card: Card): JobStage {
  return COLUMN_STAGE[card.column]?.(state, card.issue) ?? 'triage';
}

function mergeJob(state: FactoryState, cards: Card[]): JobPick | null {
  return openCards(state, cards).some((card) => card.column === 'Merging') ? { stage: 'merge', issue: null } : null;
}

const has =
  (label: string) =>
  (card: Card): boolean =>
    card.labels.includes(label);
const lacks =
  (label: string) =>
  (card: Card): boolean =>
    !card.labels.includes(label);

function cardCandidates(state: FactoryState, cards: Card[]): Candidate[] {
  const open = openCards(state, cards).filter(lacks(RELEASE_LABEL));
  const hotfix = byProgress(state, open.filter(has(HOTFIX_LABEL))).map((pick) => ({ ...pick, uncapped: true }));
  const rest = open.filter(lacks(HOTFIX_LABEL));
  const adhoc = rest
    .filter((card) => card.column === 'Implementation' && has(ADHOC_LABEL)(card))
    .sort((a, b) => a.issue - b.issue)
    .map((card) => ({ stage: 'adhoc' as const, issue: card.issue }));
  const work = rest.filter(lacks(ADHOC_LABEL));
  const normal = [...adhoc, ...changeJobs(state), ...byProgress(state, work.filter(has(RELEASE_TASK_LABEL))), ...byProgress(state, work.filter(lacks(RELEASE_TASK_LABEL)))];
  return [...hotfix, ...normal.map((pick) => ({ ...pick, uncapped: !countsAgainstCap(pick.stage) }))];
}

export type ReleaseGate = { reason: 'uncut' | 'tracking-missing' | 'failed' | 'release-tasks' | 'playtest' | 'playtest-blocked' | 'candidate' | 'ship-approval'; issues: number[] };
export function readReleaseGate(state: FactoryState, cards: Card[], releaseHead: string | null = null): ReleaseGate {
  const release = state.release;
  if (release === null) return { reason: 'uncut', issues: [] };
  if (release.postId !== null) return { reason: 'ship-approval', issues: [] };
  const tracking = cards.find((card) => card.issue === release.issue);
  if (!tracking) return { reason: 'tracking-missing', issues: [] };
  if (tracking.labels.includes(STUCK_LABEL)) return { reason: 'failed', issues: [release.issue] };
  return playtestGate(openTasks(cards, release.tasks), release.playtest, releaseHead);
}
function playtestGate(issues: number[], playtest: PlaytestState, releaseHead: string | null): ReleaseGate {
  if (issues.length) return { reason: 'release-tasks', issues };
  if (playtest.blocked !== null) return { reason: 'playtest-blocked', issues: [] };
  return releaseHead !== null && playtest.passed === releaseHead ? { reason: 'candidate', issues: [] } : { reason: 'playtest', issues: [] };
}
function releaseJob(state: FactoryState, cards: Card[], releaseHead: string | null): JobPick | null {
  if (state.release === null || releaseHead === null) return null;
  const reason = readReleaseGate(state, cards, releaseHead).reason;
  if (reason !== 'playtest' && reason !== 'candidate') return null;
  return { stage: reason, issue: state.release.issue };
}

function wasteReview(state: FactoryState, now: Date, cfg: Due): Candidate[] {
  if (state.lastWasteReview === null || !isDue(state.lastWasteReview, now, cfg.wasteReviewDays * DAY_MS)) return [];
  return [{ stage: 'waste', issue: null, uncapped: true }];
}

function releaseCut(state: FactoryState, now: Date, cfg: Due): JobPick | null {
  return state.release === null && isDue(state.lastRelease, now, cfg.releaseDays * DAY_MS) ? { stage: 'release', issue: null } : null;
}

function devJob(state: FactoryState, devHead: string | null): JobPick | null {
  if (devHead === null || devHead === state.devBuild || devHead === state.devFailed) return null;
  return { stage: 'dev', issue: null };
}

function branchCandidates(state: FactoryState, cards: Card[], now: Date, cfg: Due, heads: Heads): Candidate[] {
  const picks = [...queued(state), mergeJob(state, cards), devJob(state, heads.dev), releaseCut(state, now, cfg), releaseJob(state, cards, heads.release)];
  return picks.filter((pick) => pick !== null).map((pick) => ({ ...pick, uncapped: !countsAgainstCap(pick.stage) }));
}

export function countsAgainstCap(stage: JobStage): boolean {
  return !UNCAPPED_STAGES.includes(stage);
}

export function recentStarts(state: FactoryState, now: Date): string[] {
  return state.jobStarts.filter((start) => now.getTime() - new Date(start).getTime() < DAY_MS);
}

export function recentCardStarts(state: FactoryState, now: Date, issue: number): string[] {
  return (state.cardStarts[issue] ?? []).filter((start) => now.getTime() - new Date(start).getTime() < DAY_MS);
}

function recentCardStartsAll(state: FactoryState, now: Date): Record<string, string[]> {
  const entries = Object.keys(state.cardStarts).map((issue) => [issue, recentCardStarts(state, now, Number(issue))] as const);
  return Object.fromEntries(entries.filter(([, starts]) => starts.length > 0));
}

export function atCap(state: FactoryState, now: Date, cfg: Pick<FactoryConfig, 'maxJobsPerDay'>): boolean {
  return recentStarts(state, now).length >= cfg.maxJobsPerDay;
}

function limits(cfg: Due): Record<Queue, number> {
  return {
    branch: Infinity,
    triage: cfg.triageWorkers,
    design: cfg.designWorkers,
    implement: cfg.implementWorkers,
    verify: cfg.verifyWorkers,
    test: cfg.testWorkers,
  };
}

export type WaitReason = 'queue-full' | 'issue-running' | 'daily-cap' | 'card-budget' | 'needs-info' | 'failed' | 'approval' | 'held';
export type ScheduleDecision = JobPick & { reasons: WaitReason[] };
export type ScheduleReport = { picks: JobPick[]; decisions: ScheduleDecision[]; nextCapAt: string | null; release: ReleaseGate };
function findCapacityReasons(state: FactoryState, pick: JobPick, running: JobPick[], cfg: Due): WaitReason[] {
  const queue = QUEUE_OF[pick.stage];
  const reasons: WaitReason[] = isHeld(state, pick.issue) ? ['held'] : [];
  if (running.filter((job) => QUEUE_OF[job.stage] === queue).length >= limits(cfg)[queue]) reasons.push('queue-full');
  if (running.some((job) => job.issue === pick.issue && (pick.issue !== null || job.stage === pick.stage))) reasons.push('issue-running');
  if (RELEASE_WRITERS.includes(pick.stage) && running.some((job) => RELEASE_WRITERS.includes(job.stage))) reasons.push('issue-running');
  return reasons;
}
const RELEASE_WRITERS: JobStage[] = ['ship', 'remove'];
function readCardWait(state: FactoryState, card: Card): ScheduleDecision[] {
  const reasons: WaitReason[] = [];
  if (card.labels.includes(STUCK_LABEL)) reasons.push('failed');
  if (card.labels.includes(NEEDS_INFO_LABEL)) reasons.push('needs-info');
  if (card.column === 'Approval') reasons.push('approval');
  if (isHeld(state, card.issue)) reasons.push('held');
  return reasons.length ? [{ stage: readWaitingStage(state, card), issue: card.issue, reasons }] : [];
}
function readWaitingStage(state: FactoryState, card: Card): JobStage {
  return card.column === 'Approval' ? 'approve' : cardStage(state, card);
}
function readNextCapAt(state: FactoryState, now: Date, cfg: Due): string | null {
  if (!atCap(state, now, cfg)) return null;
  return new Date(Date.parse(recentStarts(state, now).sort()[0]) + DAY_MS).toISOString();
}

function readCardLeft(state: FactoryState, now: Date, cfg: Due, picked: Map<number, number>, issue: number | null): number {
  if (issue === null) return Infinity;
  return cfg.maxJobsPerCard - recentCardStarts(state, now, issue).length - (picked.get(issue) ?? 0);
}
function readCapReasons(capped: number, capLeft: number, cardLeft: number): WaitReason[] {
  const reasons: WaitReason[] = [];
  if (capped > capLeft) reasons.push('daily-cap');
  if (capped > 0 && cardLeft < 1) reasons.push('card-budget');
  return reasons;
}
function countCardPick(picked: Map<number, number>, capped: number, issue: number | null): void {
  if (capped > 0 && issue !== null) picked.set(issue, (picked.get(issue) ?? 0) + 1);
}

export type Heads = { dev: string | null; release: string | null };
const NO_HEADS: Heads = { dev: null, release: null };

export function evaluateSchedule(state: FactoryState, cards: Card[], now: Date, cfg: Due, heads: Heads = NO_HEADS): ScheduleReport {
  let capLeft = cfg.maxJobsPerDay - recentStarts(state, now).length;
  const picks: JobPick[] = [];
  const pickedForCard = new Map<number, number>();
  const decisions = cards.filter((card) => card.column !== 'Done' && !card.labels.includes(RELEASE_LABEL)).flatMap((card) => readCardWait(state, card));
  for (const candidate of [...branchCandidates(state, cards, now, cfg, heads), ...wasteReview(state, now, cfg), ...cardCandidates(state, cards)]) {
    const pick = { stage: candidate.stage, issue: candidate.issue };
    const capped = candidate.uncapped ? 0 : 1;
    const cardLeft = readCardLeft(state, now, cfg, pickedForCard, pick.issue);
    const reasons = [...findCapacityReasons(state, pick, [...state.jobs, ...picks], cfg), ...readCapReasons(capped, capLeft, cardLeft)];
    decisions.push({ ...pick, reasons });
    if (reasons.length) continue;
    capLeft -= capped;
    countCardPick(pickedForCard, capped, pick.issue);
    picks.push(pick);
  }
  return { picks, decisions, nextCapAt: readNextCapAt(state, now, cfg), release: readReleaseGate(state, cards, heads.release) };
}
export function chooseJobs(state: FactoryState, cards: Card[], now: Date, cfg: Due, heads: Heads = NO_HEADS): JobPick[] {
  return evaluateSchedule(state, cards, now, cfg, heads).picks;
}

export type TickDeps = {
  isAlive: (pid: number) => boolean;
  kill: (run: Run, pid: number, id: string) => Promise<void>;
  removeContainers: (run: Run, id: string) => Promise<void>;
  spawn: (args: string[], cwd: string, log: string, id: string, cpus: string, testWorkers: number | null) => number;
  cores: () => number;
};
export const REAL_DEPS: TickDeps = {
  isAlive,
  kill: killJob,
  removeContainers: removeJobContainers,
  spawn: spawnJob,
  cores: availableParallelism,
};

function dropJob(ctx: Ctx, id: string): void {
  updateState(ctx.statePath, (state) => ({
    ...state,
    jobs: state.jobs.filter((job) => job.id !== id),
  }));
}

function minutesSince(ctx: Ctx, iso: string): number {
  return (ctx.now().getTime() - new Date(iso).getTime()) / MINUTE_MS;
}

async function checkJob(ctx: Ctx, job: Job, deps: TickDeps): Promise<void> {
  const minutes = minutesSince(ctx, job.startedAt);
  const alive = deps.isAlive(job.pid);
  const inTime = minutes <= timeoutOf(ctx.cfg, job.stage);
  if (alive && inTime) return ctx.log('tick', job.issue, `${job.stage} still running`);
  if (!alive && inTime && canResume(ctx, job)) return resumeJob(ctx, job, deps);
  await failJob(ctx, job, alive, deps);
}

async function failJob(ctx: Ctx, job: Job, alive: boolean, deps: TickDeps): Promise<void> {
  if (alive) await deps.kill(ctx.run, job.pid, job.id);
  recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), job, alive ? 'timeout' : 'died');
  dropJob(ctx, job.id);
  forgetResume(ctx, job);
  const reason = alive ? `timed out after ${timeoutOf(ctx.cfg, job.stage)} minutes` : 'job process died without finishing';
  await reportFailure(ctx, job.stage, failureIssue(job.stage, job.issue, readState(ctx.statePath)), reason, job.log);
}

export function timeoutOf(cfg: FactoryConfig, stage: JobStage): number {
  if (stage === 'playtest') return cfg.playtestTimeoutMinutes;
  if (stage === 'merge') return cfg.mergeTimeoutMinutes;
  const queue = QUEUE_OF[stage];
  const minutes: Record<Queue, number> = {
    triage: cfg.triageTimeoutMinutes,
    design: cfg.designTimeoutMinutes,
    implement: cfg.implementTimeoutMinutes,
    verify: cfg.verifyTimeoutMinutes,
    test: cfg.testTimeoutMinutes,
    branch: cfg.branchTimeoutMinutes,
  };
  return minutes[queue];
}

function resumable(job: Job): job is Job & { issue: number } {
  return QUEUE_OF[job.stage] !== 'branch' && job.issue !== null;
}

function canResume(ctx: Ctx, job: Job): job is Job & { issue: number } {
  return resumable(job) && !readState(ctx.statePath).interrupted.includes(job.issue);
}

function forgetResume(ctx: Ctx, job: Job): void {
  if (!resumable(job)) return;
  updateState(ctx.statePath, (state) => ({
    ...state,
    interrupted: state.interrupted.filter((issue) => issue !== job.issue),
  }));
  clearSessions(ctx.cfg.home, job.issue);
}

async function resumeJob(ctx: Ctx, job: Job & { issue: number }, deps: TickDeps): Promise<void> {
  await deps.removeContainers(ctx.run, job.id);
  recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), job, 'died');
  markResumed(ctx.cfg.home, job.issue, job.stage);
  updateState(ctx.statePath, (state) => interruptJob(state, job));
  ctx.log('tick', job.issue, `${job.stage} process died, it resumes once on the next start`);
}

export function interruptJob(state: FactoryState, job: Job & { issue: number }): FactoryState {
  const start = countsAgainstCap(job.stage) ? state.jobStarts.indexOf(job.startedAt) : -1;
  const jobStarts = state.jobStarts.filter((_, index) => index !== start);
  const cardStart = (state.cardStarts[job.issue] ?? []).indexOf(job.startedAt);
  const cardStarts = { ...state.cardStarts, [job.issue]: (state.cardStarts[job.issue] ?? []).filter((_, index) => index !== cardStart || start === -1) };
  const interrupted = state.interrupted.includes(job.issue) ? state.interrupted : [...state.interrupted, job.issue];
  return { ...state, jobs: state.jobs.filter((other) => other.id !== job.id), jobStarts, cardStarts, interrupted };
}

function startJob(ctx: Ctx, codeDir: string, pick: JobPick, deps: TickDeps): void {
  const stamp = ctx.now().toISOString().replaceAll(':', '');
  const id = `${pick.stage}-${pick.issue ?? '-'}-${stamp}`;
  const log = join(ctx.cfg.home, 'logs', `${id}.log`);
  const pool = poolOf(pick.stage);
  const cpus = cpuSets(ctx.cfg, deps.cores())[pool];
  const pid = deps.spawn([pick.stage, String(pick.issue ?? '-')], codeDir, log, id, cpus, vitestWorkersOf(ctx.cfg, pool));
  const job: Job = { ...pick, id, pid, startedAt: ctx.now().toISOString(), log };
  updateState(ctx.statePath, (state) => {
    if (!countsAgainstCap(pick.stage)) return { ...state, jobs: [...state.jobs, job] };
    const recent = recentCardStartsAll(state, ctx.now());
    const cardStarts = pick.issue === null ? recent : { ...recent, [pick.issue]: [...(recent[pick.issue] ?? []), job.startedAt] };
    return { ...state, jobs: [...state.jobs, job], jobStarts: [...recentStarts(state, ctx.now()), job.startedAt], cardStarts };
  });
  reportAttempt(ctx.cfg.home, job, 'started', ctx.now());
  ctx.log('tick', pick.issue, `started ${pick.stage}, pid ${pid}, CPUs ${cpus}, log ${log}`);
}

async function releaseReason(ctx: Ctx, card: Card): Promise<'answered' | 'no answer in time' | null> {
  if (card.column !== 'Triage' || !card.labels.includes(NEEDS_INFO_LABEL)) return null;
  const comments = await ctx.github.comments(card.issue);
  if (isAnswered(comments)) return 'answered';
  const asked = askedAt(comments);
  return asked !== null && minutesSince(ctx, asked) > ctx.cfg.needsInfoHours * 60 ? 'no answer in time' : null;
}

export async function releaseAnswered(ctx: Ctx, cards: Card[]): Promise<Card[]> {
  const released: Card[] = [];
  for (const card of cards) {
    const reason = await releaseReason(ctx, card);
    if (reason === null) {
      released.push(card);
      continue;
    }
    await ctx.github.removeLabel(card.issue, NEEDS_INFO_LABEL);
    ctx.log('tick', card.issue, `${reason}, removed ${NEEDS_INFO_LABEL}`);
    released.push({ ...card, labels: card.labels.filter((label) => label !== NEEDS_INFO_LABEL) });
  }
  return released;
}

function cleanBuilds(ctx: Ctx, cards: Card[]): void {
  const state = readState(ctx.statePath);
  if (state.jobs.some((job) => job.stage === 'verify' || !AGENT_QUEUES.includes(QUEUE_OF[job.stage]))) return;
  const keep = cards.filter((card) => card.column === 'Approval' || card.column === 'Hardening').map((card) => state.builds[String(card.issue)]).filter((name) => name !== undefined);
  removeStaleBuilds(ctx.cfg.webRoot, new Set(keep), (msg) => ctx.log('tick', null, msg));
}

function cleanWork(ctx: Ctx, cards: Card[]): void {
  const state = readState(ctx.statePath);
  const swept = sweepWork(join(ctx.cfg.home, 'work'), join(ctx.cfg.home, 'locks'), state, cards);
  for (const name of swept.removed) ctx.log('tick', null, `removed work clone ${name}`);
  if (swept.stripped.length > 0) ctx.log('tick', null, `removed packages of idle clones ${swept.stripped.join(', ')}`);
  if (swept.unknown.length > 0) ctx.log('tick', null, `left unknown work folders ${swept.unknown.join(', ')}`);
  const logs = sweepLogs(join(ctx.cfg.home, 'logs'), state, ctx.now(), ctx.cfg.logDays);
  if (logs.length > 0) ctx.log('tick', null, `removed ${logs.length} job logs older than ${ctx.cfg.logDays} days`);
  const transcripts = sweepTranscripts(ctx.cfg.home, ctx.now(), ctx.cfg.transcriptDays);
  if (transcripts.length > 0) ctx.log('tick', null, `removed ${transcripts.length} agent transcripts older than ${ctx.cfg.transcriptDays} days`);
  const cached = sweepTestCache(join(ctx.cfg.home, 'test-cache'), ctx.now(), ctx.cfg.testCacheDays);
  if (cached > 0) ctx.log('tick', null, `removed ${cached} test cache files older than ${ctx.cfg.testCacheDays} days`);
}

async function expireReplies(ctx: Ctx): Promise<void> {
  const late = Object.entries(readState(ctx.statePath).unroutedReplies).filter(([, reply]) => minutesSince(ctx, reply.at) > ctx.cfg.replyRouteMinutes);
  for (const [messageId, reply] of late) {
    updateState(ctx.statePath, (state) => ({ ...state, unroutedReplies: Object.fromEntries(Object.entries(state.unroutedReplies).filter(([id]) => id !== messageId)) }));
    const text = reply.text.replace(/\s+/g, ' ');
    await reportFailure(ctx, 'feedback', null, `Route the reply ${messageId} to the approval post ${reply.postId} of issue #${reply.issue} on your best reading, unrouted for ${ctx.cfg.replyRouteMinutes} minutes: ${text}`, null);
  }
}

async function settleRouting(ctx: Ctx): Promise<void> {
  await expireReplies(ctx);
  if (readState(ctx.statePath).lastWasteReview === null)
    updateState(ctx.statePath, (state) => ({
      ...state,
      lastWasteReview: ctx.now().toISOString(),
    }));
}

export async function checkJobs(ctx: Ctx, deps: TickDeps = REAL_DEPS): Promise<void> {
  for (const job of readState(ctx.statePath).jobs) await checkJob(ctx, job, deps);
}

export async function tick(ctx: Ctx, codeDir: string, deps: TickDeps = REAL_DEPS): Promise<void> {
  await checkJobs(ctx, deps);
  await settleRouting(ctx);
  await startJobs(ctx, codeDir, deps);
  await intake(ctx);
}

async function releaseHead(ctx: Ctx): Promise<string | null> {
  const release = readState(ctx.statePath).release;
  return release === null ? null : ctx.repo.headHash(release.branch);
}

async function startJobs(ctx: Ctx, codeDir: string, deps: TickDeps): Promise<void> {
  const cards = await releaseAnswered(ctx, await ctx.github.cards());
  cleanBuilds(ctx, cards);
  cleanWork(ctx, cards);
  updateState(ctx.statePath, pruneCaptions);
  updateState(ctx.statePath, pruneFailures(ctx.now()));
  const free = freeGb(ctx.cfg.home);
  if (free < ctx.cfg.minFreeGb) {
    reportScheduler(ctx.cfg.home, 'disk-low', ctx.now());
    return ctx.log('tick', null, `disk low: ${free} GB free, under ${ctx.cfg.minFreeGb} GB, starts nothing`);
  }
  await ctx.repo.fetch();
  const heads = { dev: await ctx.repo.headHash('dev'), release: await releaseHead(ctx) };
  const report = evaluateSchedule(readState(ctx.statePath), cards, ctx.now(), ctx.cfg, heads);
  reportScheduler(ctx.cfg.home, 'ready', ctx.now(), report, cards);
  if (report.picks.length === 0) return ctx.log('tick', null, 'nothing to start');
  for (const pick of report.picks) startJob(ctx, codeDir, pick, deps);
}
