import { rebuildDev } from './deploy';
import { failureIssue, reportFailure } from './fail';
import { adhoc } from './stages/adhoc';
import { approve } from './stages/approval';
import { change } from './stages/change';
import { runStage as design } from './stages/design';
import { runStage as implement } from './stages/implement';
import { candidate } from './stages/candidate';
import { release } from './stages/release';
import { runStage as incident } from './stages/incident';
import { remove } from './stages/remove';
import { ship } from './stages/ship';
import { runStage as checks } from './stages/checks';
import { runStage as patch } from './stages/patch';
import { runStage as verify } from './stages/verify';
import { runStage as waste } from './stages/waste';
import { runStage as triage } from './stages/triage';
import { recordJob, type JobOutcome } from './ledger';
import { clearSessions, resumedStage } from './sessions';
import { readState, updateState } from './state';
import { QUEUE_OF, type Ctx, type FactoryState, type Job, type JobStage } from './types';

type Handler = (ctx: Ctx, issue: number) => Promise<void>;

// Ship reads who pressed it from the state, so the job cannot run without a queued Ship.
const HANDLERS: Record<Exclude<JobStage, 'release' | 'dev' | 'waste'>, Handler> = {
  triage, design, implement, patch, verify, checks, change, adhoc, candidate, remove, incident,
  ship: (ctx, issue) => ship(ctx, issue, readState(ctx.statePath).pendingShip),
  approve: (ctx, issue) => approve(ctx, issue, readState(ctx.statePath).pendingApprovals[String(issue)] ?? 'the committee'),
};

// Card stages leave a progress comment on their issue, so the issue shows where its work stands.
const CARD_STAGE_NAMES: Partial<Record<JobStage, string>> = { triage: 'Triage', design: 'Design', implement: 'Implementation', patch: 'Patch', verify: 'Verify', checks: 'Checks' };

export function progressNote(ctx: Ctx, stage: JobStage, startedAt: string | null, outcome: 'finished' | 'failed'): string {
  const minutes = startedAt ? Math.round((ctx.now().getTime() - new Date(startedAt).getTime()) / 60_000) : null;
  const took = minutes === null ? '' : ` after ${minutes} min`;
  const next = outcome === 'failed' ? ' Hermes is looking into it.' : '';
  return `${CARD_STAGE_NAMES[stage]} ${outcome}${took}.${next}`;
}

async function noteProgress(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null, outcome: 'finished' | 'failed'): Promise<void> {
  if (issue === null || !(stage in CARD_STAGE_NAMES)) return;
  await ctx.github.comment(issue, progressNote(ctx, stage, job?.startedAt ?? null, outcome));
}

// The tick records a job before it starts it. A job run by hand has no record.
function ownJob(ctx: Ctx, stage: JobStage, issue: number | null): Job | null {
  return readState(ctx.statePath).jobs.find((job) => job.stage === stage && job.issue === issue) ?? null;
}

// Runs one job to its end. Success or failure, the job's record, its queued command, its issue's interrupted mark and its sessions are cleared, so nothing retries.
export async function runJob(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  const job = ownJob(ctx, stage, issue);
  const entry = ledgerEntry(ctx, job, stage, issue);
  let outcome: JobOutcome = 'failed';
  // Only the stage that died resumes. Any other job starts new, so sessions left by an earlier job never resume.
  if (!resuming(ctx, stage, issue)) clearSessionsOf(ctx, stage, issue);
  try {
    await dispatch(ctx, stage, issue, job);
    outcome = 'done';
    ctx.log(stage, issue, 'done');
    await noteProgress(ctx, stage, issue, job, 'finished');
  } catch (error) {
    await reportFailure(ctx, stage, failureIssue(stage, issue, readState(ctx.statePath)), error, job?.log ?? null);
    await noteProgress(ctx, stage, issue, job, 'failed');
  } finally {
    recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), entry, outcome);
    clearJob(ctx, stage, issue);
    clearSessionsOf(ctx, stage, issue);
  }
}

// A job run by hand has no record, so it has no id, its agents record no usage, and it starts now.
function ledgerEntry(ctx: Ctx, job: Job | null, stage: JobStage, issue: number | null): { id: string | null; stage: JobStage; issue: number | null; startedAt: string } {
  if (job === null) return { id: null, stage, issue, startedAt: ctx.now().toISOString() };
  return { id: job.id, stage, issue, startedAt: job.startedAt };
}

function resuming(ctx: Ctx, stage: JobStage, issue: number | null): boolean {
  return issue !== null && readState(ctx.statePath).interrupted.includes(issue) && resumedStage(ctx.cfg.home, issue) === stage;
}

// Only agent and test jobs run agents with sessions.
function clearSessionsOf(ctx: Ctx, stage: JobStage, issue: number | null): void {
  if (issue !== null && QUEUE_OF[stage] !== 'branch') clearSessions(ctx.cfg.home, issue);
}

// Jobs that work on no issue.
const ISSUELESS: Record<'release' | 'dev' | 'waste', (ctx: Ctx, job: Job | null) => Promise<unknown>> = {
  release: (ctx) => release(ctx),
  waste: (ctx) => waste(ctx),
  // A dev job run by hand has no job in the state, so its build output goes to a fixed log.
  dev: (ctx, job) => rebuildDev(ctx, job?.log ?? `${ctx.cfg.home}/logs/dev-build.log`),
};

const isIssueless = (stage: JobStage): stage is keyof typeof ISSUELESS => stage in ISSUELESS;

async function dispatch(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null): Promise<void> {
  if (isIssueless(stage)) return void (await ISSUELESS[stage](ctx, job));
  if (issue === null) throw new Error(`Job ${stage} needs an issue or change id`);
  return HANDLERS[stage](ctx, issue);
}

function clearJob(ctx: Ctx, stage: JobStage, issue: number | null): void {
  updateState(ctx.statePath, (state) => {
    const jobs = state.jobs.filter((job) => job.stage !== stage || job.issue !== issue);
    // Only agent and test jobs resume.
    const interrupted = QUEUE_OF[stage] === 'branch' ? state.interrupted : state.interrupted.filter((item) => item !== issue);
    return { ...clearQueued(state, stage, issue), jobs, interrupted };
  });
}

// The queued command the job ran, so nothing runs it again.
function clearQueued(state: FactoryState, stage: JobStage, issue: number | null): FactoryState {
  const pendingApprovals = { ...state.pendingApprovals };
  if (stage === 'approve') delete pendingApprovals[String(issue)];
  const pendingChanges = stage === 'change' ? state.pendingChanges.filter((item) => item.id !== issue) : state.pendingChanges;
  const pendingIncidents = stage === 'incident' ? state.pendingIncidents.filter((n) => n !== issue) : state.pendingIncidents;
  const pendingShip = stage === 'ship' ? null : state.pendingShip;
  const first = stage === 'remove' ? state.pendingRemovals.findIndex((item) => item.issue === issue) : -1;
  const pendingRemovals = state.pendingRemovals.filter((_, index) => index !== first);
  return { ...state, pendingApprovals, pendingChanges, pendingIncidents, pendingShip, pendingRemovals };
}
