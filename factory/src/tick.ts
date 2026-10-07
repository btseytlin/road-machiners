import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { sweepLogs, sweepWork } from './cleanup';
import { POOL_OF, cpuSets, vitestWorkersOf } from './cpus';
import { removeStaleBuilds } from './deploy';
import { freeGb } from './health';
import { failureIssue, pruneFailures, reportFailure } from './fail';
import { intake } from './intake';
import { recordJob } from './ledger';
import { reportAttempt, reportScheduler } from './observability';
import { pruneCaptions } from './post-status';
import { isAlive, killJob, removeJobContainers, spawnJob } from './jobs';
import { clearSessions, markResumed } from './sessions';
import { readState, updateState } from './state';
import { isAnswered } from './questions';
import { ADHOC_LABEL, AGENT_QUEUES, HOTFIX_LABEL, NEEDS_INFO_LABEL, QUEUE_OF, RELEASE_LABEL, RELEASE_TASK_LABEL, STUCK_LABEL } from './types';
import type { Card, Ctx, FactoryConfig, FactoryState, Job, JobStage, PlaytestState, Queue, Run } from './types';

export type JobPick = { stage: JobStage; issue: number | null };
// A candidate job and whether it may start at the daily cap.
type Candidate = JobPick & { uncapped: boolean };
type Due = Pick<FactoryConfig, 'releaseDays' | 'wasteReviewDays' | 'maxJobsPerDay' | 'maxJobsPerCard' | 'triageWorkers' | 'designWorkers' | 'implementWorkers' | 'verifyWorkers' | 'testWorkers'>;

const DAY_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;
// Committee-driven jobs, the factory's own review and the free checks never count against the daily cap or a card's budget.
const UNCAPPED_STAGES: JobStage[] = ['approve', 'remove', 'ship', 'change', 'adhoc', 'incident', 'dev', 'waste', 'checks'];
const CARD_ORDER: Card['column'][] = ['Testing', 'Implementation', 'Design', 'Triage'];

function isDue(last: string | null, now: Date, everyMs: number): boolean {
  return last === null || now.getTime() - new Date(last).getTime() > everyMs;
}

// A removal runs before a ship, so a Ship pressed after a Remove finds the release without a current post and refuses.
function queued(state: FactoryState): JobPick | null {
  const approval = Object.keys(state.pendingApprovals).map(Number).sort((a, b) => a - b)[0];
  if (approval !== undefined) return { stage: 'approve', issue: approval };
  const removal = state.pendingRemovals[0];
  if (removal) return { stage: 'remove', issue: removal.issue };
  if (state.pendingShip !== null && state.release) return { stage: 'ship', issue: state.release.issue };
  // An incident entry waits on no release step.
  const incident = state.pendingIncidents[0];
  return incident === undefined ? null : { stage: 'incident', issue: incident };
}

// Factory changes in the order they were asked. A change id is a timestamp, so it never equals an issue number.
function changeJobs(state: FactoryState): JobPick[] {
  return state.pendingChanges.map((change) => ({ stage: 'change' as const, issue: change.id }));
}

function openCards(cards: Card[]): Card[] {
  return cards.filter((card) => !card.labels.includes(STUCK_LABEL) && !card.labels.includes(NEEDS_INFO_LABEL));
}

// Furthest along first, lowest issue first.
function byProgress(state: FactoryState, cards: Card[]): JobPick[] {
  return CARD_ORDER.flatMap((column) => cards.filter((card) => card.column === column).sort((a, b) => a.issue - b.issue).map((card) => ({ stage: cardStage(state, card), issue: card.issue })));
}

// The card job of a column in CARD_ORDER.
function cardStage(state: FactoryState, card: Card): JobStage {
  if (card.column === 'Testing') return testingStage(state, card.issue);
  if (card.column === 'Implementation') return String(card.issue) in state.patching ? 'patch' : 'implement';
  return card.column === 'Design' ? 'design' : 'triage';
}

// A Testing card runs the factory checks once verify or a patch set its phase, and verify otherwise.
function testingStage(state: FactoryState, issue: number): JobStage {
  const phase = state.testPhase[String(issue)];
  return phase === 'checks' || phase === 'checks-after-fix' || phase === 'post' ? 'checks' : 'verify';
}

const has = (label: string) => (card: Card): boolean => card.labels.includes(label);
const lacks = (label: string) => (card: Card): boolean => !card.labels.includes(label);

// Card jobs in order: hotfixes, ad hoc tasks, factory changes, release tasks, then the rest. The tracking issue card only waits for Ship, so it never gets a card job.
// A shipped bug waits for nothing else, and a hotfix card runs at the cap too, since the committee chose it.
function cardCandidates(state: FactoryState, cards: Card[]): Candidate[] {
  const open = openCards(cards).filter(lacks(RELEASE_LABEL));
  const hotfix = byProgress(state, open.filter(has(HOTFIX_LABEL))).map((pick) => ({ ...pick, uncapped: true }));
  const rest = open.filter(lacks(HOTFIX_LABEL));
  const adhoc = rest.filter((card) => card.column === 'Implementation' && has(ADHOC_LABEL)(card)).sort((a, b) => a.issue - b.issue).map((card) => ({ stage: 'adhoc' as const, issue: card.issue }));
  const work = rest.filter(lacks(ADHOC_LABEL));
  const normal = [...adhoc, ...changeJobs(state), ...byProgress(state, work.filter(has(RELEASE_TASK_LABEL))), ...byProgress(state, work.filter(lacks(RELEASE_TASK_LABEL)))];
  return [...hotfix, ...normal.map((pick) => ({ ...pick, uncapped: !countsAgainstCap(pick.stage) }))];
}

// The candidate waits until the tracking issue is healthy, every release task is done and the playtest passed the release head.
// `releaseHead` is the short hash of the release branch on origin, or null when it is unknown, which holds both the playtest and the candidate.
export type ReleaseGate = { reason: 'uncut' | 'tracking-missing' | 'failed' | 'release-tasks' | 'playtest' | 'playtest-blocked' | 'candidate' | 'ship-approval'; issues: number[] };
export function readReleaseGate(state: FactoryState, cards: Card[], releaseHead: string | null = null): ReleaseGate {
  const release = state.release;
  if (release === null) return { reason: 'uncut', issues: [] };
  if (release.postId !== null) return { reason: 'ship-approval', issues: [] };
  const tracking = cards.find((card) => card.issue === release.issue);
  if (!tracking) return { reason: 'tracking-missing', issues: [] };
  if (tracking.labels.includes(STUCK_LABEL)) return { reason: 'failed', issues: [release.issue] };
  return playtestGate(cards, release.playtest, releaseHead);
}
function playtestGate(cards: Card[], playtest: PlaytestState, releaseHead: string | null): ReleaseGate {
  const issues = cards.filter((card) => card.labels.includes(RELEASE_TASK_LABEL) && card.column !== 'Done').map((card) => card.issue);
  if (issues.length) return { reason: 'release-tasks', issues };
  if (playtest.blocked !== null) return { reason: 'playtest-blocked', issues: [] };
  return releaseHead !== null && playtest.passed === releaseHead ? { reason: 'candidate', issues: [] } : { reason: 'playtest', issues: [] };
}
// The playtest and the candidate both need a known release head.
function releaseJob(state: FactoryState, cards: Card[], releaseHead: string | null): JobPick | null {
  if (state.release === null || releaseHead === null) return null;
  const reason = readReleaseGate(state, cards, releaseHead).reason;
  if (reason !== 'playtest' && reason !== 'candidate') return null;
  return { stage: reason, issue: state.release.issue };
}

// An empty lastWasteReview waits: the tick sets it to now, so the first review covers a full period of ledger.
function wasteReview(state: FactoryState, now: Date, cfg: Due): Candidate[] {
  if (state.lastWasteReview === null || !isDue(state.lastWasteReview, now, cfg.wasteReviewDays * DAY_MS)) return [];
  return [{ stage: 'waste', issue: null, uncapped: true }];
}

function releaseCut(state: FactoryState, now: Date, cfg: Due): JobPick | null {
  return state.release === null && isDue(state.lastRelease, now, cfg.releaseDays * DAY_MS) ? { stage: 'release', issue: null } : null;
}

// /dev/ is stale when dev moved past its build, by a factory merge or any other push. A failed commit waits for the next push or for Hermes.
function devJob(state: FactoryState, devHead: string | null): JobPick | null {
  if (devHead === null || devHead === state.devBuild || devHead === state.devFailed) return null;
  return { stage: 'dev', issue: null };
}

// Branch jobs in order: queued approvals, removals, ships and incident entries, then a stale /dev/, then a due release cut, then the
// release playtest or the candidate. The playtest runs in the verify queue, but it takes its turn here, since it gates the candidate.
function branchCandidates(state: FactoryState, cards: Card[], now: Date, cfg: Due, heads: Heads): Candidate[] {
  const picks = [queued(state), devJob(state, heads.dev), releaseCut(state, now, cfg), releaseJob(state, cards, heads.release)];
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

export function atCap(state: FactoryState, now: Date, cfg: Pick<FactoryConfig, 'maxJobsPerDay'>): boolean {
  return recentStarts(state, now).length >= cfg.maxJobsPerDay;
}

function limits(cfg: Due): Record<Queue, number> {
  return { branch: 1, triage: cfg.triageWorkers, design: cfg.designWorkers, implement: cfg.implementWorkers, verify: cfg.verifyWorkers, test: cfg.testWorkers };
}

// A job fits when its queue has a free worker and no other job works on its issue.
export type WaitReason = 'queue-full' | 'issue-running' | 'daily-cap' | 'card-budget' | 'needs-info' | 'failed' | 'approval';
export type ScheduleDecision = JobPick & { reasons: WaitReason[] };
export type ScheduleReport = { picks: JobPick[]; decisions: ScheduleDecision[]; nextCapAt: string | null; release: ReleaseGate };
function findCapacityReasons(pick: JobPick, running: JobPick[], cfg: Due): WaitReason[] {
  const queue = QUEUE_OF[pick.stage];
  const reasons: WaitReason[] = [];
  if (running.filter((job) => QUEUE_OF[job.stage] === queue).length >= limits(cfg)[queue]) reasons.push('queue-full');
  if (pick.issue !== null && running.some((job) => job.issue === pick.issue)) reasons.push('issue-running');
  return reasons;
}
function readCardWait(state: FactoryState, card: Card): ScheduleDecision[] {
  const reasons: WaitReason[] = [];
  if (card.labels.includes(STUCK_LABEL)) reasons.push('failed');
  if (card.labels.includes(NEEDS_INFO_LABEL)) reasons.push('needs-info');
  if (card.column === 'Approval') reasons.push('approval');
  return reasons.length ? [{ stage: readWaitingStage(state, card), issue: card.issue, reasons }] : [];
}
function readWaitingStage(state: FactoryState, card: Card): JobStage {
  return card.column === 'Approval' ? 'approve' : cardStage(state, card);
}
function readNextCapAt(state: FactoryState, now: Date, cfg: Due): string | null {
  if (!atCap(state, now, cfg)) return null;
  return new Date(Date.parse(recentStarts(state, now).sort()[0]) + DAY_MS).toISOString();
}

// Starts a card may still make in the 24 hours, counting the jobs this evaluation already picked for it. A job with no card has no budget.
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

// The short hashes of dev and the release branch on origin. A null skips the /dev/ check or holds the release jobs.
export type Heads = { dev: string | null; release: string | null };
const NO_HEADS: Heads = { dev: null, release: null };

// Picks the jobs to start now, in priority order within each queue, next to the jobs that already run.
// At the daily cap only the uncapped jobs start.
export function evaluateSchedule(state: FactoryState, cards: Card[], now: Date, cfg: Due, heads: Heads = NO_HEADS): ScheduleReport {
  let capLeft = cfg.maxJobsPerDay - recentStarts(state, now).length;
  const picks: JobPick[] = [];
  const pickedForCard = new Map<number, number>();
  const decisions = cards.filter((card) => card.column !== 'Done' && !card.labels.includes(RELEASE_LABEL)).flatMap((card) => readCardWait(state, card));
  for (const candidate of [...branchCandidates(state, cards, now, cfg, heads), ...wasteReview(state, now, cfg), ...cardCandidates(state, cards)]) {
    const pick = { stage: candidate.stage, issue: candidate.issue };
    const capped = candidate.uncapped ? 0 : 1;
    const cardLeft = readCardLeft(state, now, cfg, pickedForCard, pick.issue);
    const reasons = [...findCapacityReasons(pick, [...state.jobs, ...picks], cfg), ...readCapReasons(capped, capLeft, cardLeft)];
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

// Process control the tick uses. The CLI uses the real ones, and tests pass fakes.
export type TickDeps = {
  isAlive: (pid: number) => boolean;
  kill: (run: Run, pid: number, id: string) => Promise<void>;
  removeContainers: (run: Run, id: string) => Promise<void>;
  spawn: (args: string[], cwd: string, log: string, id: string, cpus: string, testWorkers: number | null) => number;
  cores: () => number;
};
export const REAL_DEPS: TickDeps = { isAlive, kill: killJob, removeContainers: removeJobContainers, spawn: spawnJob, cores: availableParallelism };

function dropJob(ctx: Ctx, id: string): void {
  updateState(ctx.statePath, (state) => ({ ...state, jobs: state.jobs.filter((job) => job.id !== id) }));
}

function minutesSince(ctx: Ctx, iso: string): number {
  return (ctx.now().getTime() - new Date(iso).getTime()) / MINUTE_MS;
}

// A dead or timed-out job leaves the list. A dead agent or test job in time gets one resume, and every other one reports a failure. A job in time stays.
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

// Each queue has its own time limit, since its jobs differ in length by hours.
export function timeoutOf(cfg: FactoryConfig, stage: JobStage): number {
  const queue = QUEUE_OF[stage];
  const minutes: Record<Queue, number> = {
    triage: cfg.triageTimeoutMinutes, design: cfg.designTimeoutMinutes, implement: cfg.implementTimeoutMinutes,
    verify: cfg.verifyTimeoutMinutes, test: cfg.testTimeoutMinutes, branch: cfg.branchTimeoutMinutes,
  };
  return minutes[queue];
}

// A branch job moves branches and posts between its containers, so a restart could repeat a half done step.
function resumable(job: Job): job is Job & { issue: number } {
  return QUEUE_OF[job.stage] !== 'branch' && job.issue !== null;
}

// The mark says the job already resumed once, so a second death fails.
function canResume(ctx: Ctx, job: Job): job is Job & { issue: number } {
  return resumable(job) && !readState(ctx.statePath).interrupted.includes(job.issue);
}

// A failed job ends here, so nothing of its resume stays for the next job on the issue. The job's own end does this for a job that finishes.
function forgetResume(ctx: Ctx, job: Job): void {
  if (!resumable(job)) return;
  updateState(ctx.statePath, (state) => ({ ...state, interrupted: state.interrupted.filter((issue) => issue !== job.issue) }));
  clearSessions(ctx.cfg.home, job.issue);
}

// The job's process is gone, and its containers may still run. They go before the next job starts, so two never work in one clone.
// Its card stays where it is, so the next tick starts the stage again. The dead job's cap slot frees, since the restart takes a new one.
async function resumeJob(ctx: Ctx, job: Job & { issue: number }, deps: TickDeps): Promise<void> {
  await deps.removeContainers(ctx.run, job.id);
  recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), job, 'died');
  markResumed(ctx.cfg.home, job.issue, job.stage);
  updateState(ctx.statePath, (state) => {
    // Jobs started by one tick share a start time, so only one of them goes.
    const start = countsAgainstCap(job.stage) ? state.jobStarts.indexOf(job.startedAt) : -1;
    const jobStarts = state.jobStarts.filter((_, index) => index !== start);
    const cardStart = (state.cardStarts[job.issue] ?? []).indexOf(job.startedAt);
    const cardStarts = { ...state.cardStarts, [job.issue]: (state.cardStarts[job.issue] ?? []).filter((_, index) => index !== cardStart || start === -1) };
    const interrupted = state.interrupted.includes(job.issue) ? state.interrupted : [...state.interrupted, job.issue];
    return {
      ...state,
      jobs: state.jobs.filter((other) => other.id !== job.id),
      jobStarts,
      cardStarts,
      interrupted,
    };
  });
  ctx.log('tick', job.issue, `${job.stage} process died, it resumes once on the next start`);
}

function startJob(ctx: Ctx, codeDir: string, pick: JobPick, deps: TickDeps): void {
  const stamp = ctx.now().toISOString().replaceAll(':', '');
  const id = `${pick.stage}-${pick.issue ?? '-'}-${stamp}`;
  const log = join(ctx.cfg.home, 'logs', `${id}.log`);
  const pool = POOL_OF[QUEUE_OF[pick.stage]];
  const cpus = cpuSets(ctx.cfg, deps.cores())[pool];
  const pid = deps.spawn([pick.stage, String(pick.issue ?? '-')], codeDir, log, id, cpus, vitestWorkersOf(ctx.cfg, pool));
  const job: Job = { ...pick, id, pid, startedAt: ctx.now().toISOString(), log };
  updateState(ctx.statePath, (state) => {
    if (!countsAgainstCap(pick.stage)) return { ...state, jobs: [...state.jobs, job] };
    const cardStarts = pick.issue === null ? state.cardStarts : { ...state.cardStarts, [pick.issue]: [...recentCardStarts(state, ctx.now(), pick.issue), job.startedAt] };
    return { ...state, jobs: [...state.jobs, job], jobStarts: [...recentStarts(state, ctx.now()), job.startedAt], cardStarts };
  });
  reportAttempt(ctx.cfg.home, job, 'started', ctx.now());
  ctx.log('tick', pick.issue, `started ${pick.stage}, pid ${pid}, CPUs ${cpus}, log ${log}`);
}

async function answeredWaiting(ctx: Ctx, card: Card): Promise<boolean> {
  const waiting = card.column === 'Triage' && card.labels.includes(NEEDS_INFO_LABEL);
  return waiting && isAnswered(await ctx.github.comments(card.issue));
}

// A Triage card that waits for answers gets its label back off once someone replies. Returns the cards as they stand after that.
export async function releaseAnswered(ctx: Ctx, cards: Card[]): Promise<Card[]> {
  const released: Card[] = [];
  for (const card of cards) {
    if (!(await answeredWaiting(ctx, card))) {
      released.push(card);
      continue;
    }
    await ctx.github.removeLabel(card.issue, NEEDS_INFO_LABEL);
    ctx.log('tick', card.issue, `answered, removed ${NEEDS_INFO_LABEL}`);
    released.push({ ...card, labels: card.labels.filter((label) => label !== NEEDS_INFO_LABEL) });
  }
  return released;
}

// Removes builds no card in Approval still needs.
// Testing and branch jobs deploy builds before they record them, so cleanup waits while one of them runs.
function cleanBuilds(ctx: Ctx, cards: Card[]): void {
  const state = readState(ctx.statePath);
  if (state.jobs.some((job) => !AGENT_QUEUES.includes(QUEUE_OF[job.stage]))) return;
  // The candidate's card is the tracking issue, so its 'rc' build stays while the card waits in Approval.
  const keep = cards.filter((card) => card.column === 'Approval').map((card) => state.builds[String(card.issue)]).filter((name) => name !== undefined);
  removeStaleBuilds(ctx.cfg.webRoot, new Set(keep), (msg) => ctx.log('tick', null, msg));
}

// Deletes finished work clones and old job logs. Running jobs and resumable clones stay, see sweepWork.
function cleanWork(ctx: Ctx, cards: Card[]): void {
  const state = readState(ctx.statePath);
  const swept = sweepWork(join(ctx.cfg.home, 'work'), state, cards);
  for (const name of swept.removed) ctx.log('tick', null, `removed work clone ${name}`);
  if (swept.stripped.length > 0) ctx.log('tick', null, `removed packages of idle clones ${swept.stripped.join(', ')}`);
  if (swept.unknown.length > 0) ctx.log('tick', null, `left unknown work folders ${swept.unknown.join(', ')}`);
  const logs = sweepLogs(join(ctx.cfg.home, 'logs'), state, ctx.now(), ctx.cfg.logDays);
  if (logs.length > 0) ctx.log('tick', null, `removed ${logs.length} job logs older than ${ctx.cfg.logDays} days`);
}

// A plain approval reply that Hermes did not route in time becomes a failure, so the incident watch wakes Hermes and the reply is never lost.
async function expireReplies(ctx: Ctx): Promise<void> {
  const late = Object.entries(readState(ctx.statePath).unroutedReplies).filter(([, reply]) => minutesSince(ctx, reply.at) > ctx.cfg.replyRouteMinutes);
  for (const [messageId, reply] of late) {
    updateState(ctx.statePath, (state) => ({ ...state, unroutedReplies: Object.fromEntries(Object.entries(state.unroutedReplies).filter(([id]) => id !== messageId)) }));
    await reportFailure(ctx, 'feedback', reply.issue, `The reply ${messageId} to the approval post ${reply.postId} got no route within ${ctx.cfg.replyRouteMinutes} minutes: ${reply.text}`, null);
  }
}

// Late approval replies become failures, and the first tick that sees no waste review starts its period.
async function settleRouting(ctx: Ctx): Promise<void> {
  await expireReplies(ctx);
  if (readState(ctx.statePath).lastWasteReview === null) updateState(ctx.statePath, (state) => ({ ...state, lastWasteReview: ctx.now().toISOString() }));
}

// One tick: check the running jobs, clean old builds, clones and logs, start every job that fits while the disk has room, then run intake. `deps` defaults to the real process control.
// Intake runs last, so a failed intake never holds back a job, like the factory change that would fix it. A card it adds starts on the next tick.
export async function tick(ctx: Ctx, codeDir: string, deps: TickDeps = REAL_DEPS): Promise<void> {
  for (const job of readState(ctx.statePath).jobs) await checkJob(ctx, job, deps);
  await settleRouting(ctx);
  await startJobs(ctx, codeDir, deps);
  await intake(ctx);
}

async function releaseHead(ctx: Ctx): Promise<string | null> {
  const release = readState(ctx.statePath).release;
  return release === null ? null : ctx.repo.headHash(release.branch);
}

// A candidate post plays one commit. Once the release branch moves, by any path, the post and a queued Ship go, and the
// playtest and a new candidate follow on the new head.
export function dropStaleCandidate(ctx: Ctx, head: string | null): void {
  const release = readState(ctx.statePath).release;
  if (release === null || head === null || release.postId === null || release.candidateSha === head) return;
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
  ctx.log('tick', release.issue, `release moved from ${release.candidateSha ?? 'an unknown commit'} to ${head}, dropped candidate post ${release.postId}`);
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
  dropStaleCandidate(ctx, heads.release);
  const report = evaluateSchedule(readState(ctx.statePath), cards, ctx.now(), ctx.cfg, heads);
  reportScheduler(ctx.cfg.home, 'ready', ctx.now(), report, cards);
  if (report.picks.length === 0) return ctx.log('tick', null, 'nothing to start');
  for (const pick of report.picks) startJob(ctx, codeDir, pick, deps);
}
