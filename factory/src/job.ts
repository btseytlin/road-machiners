import { rebuildDev } from './deploy';
import { failureIssue, reportFailure, summarizeError } from './fail';
import { UsageLimitError } from './pause';
import { CARD_JOBS } from './position';
import { BudgetError } from './stages/checkpoint';
import { CommitteeDecisionError } from './diff-guard';
import { adhoc } from './stages/adhoc';
import { approve } from './stages/approval';
import { change } from './stages/change';
import { runStage as design } from './stages/design';
import { runStage as implement } from './stages/implement';
import { candidate } from './stages/candidate';
import { playtest } from './stages/playtest';
import { release } from './stages/release';
import { runStage as incident } from './stages/incident';
import { remove } from './stages/remove';
import { ship } from './stages/ship';
import { runStage as checks } from './stages/checks';
import { merge } from './stages/merge';
import { runStage as verify } from './stages/verify';
import { runStage as harden } from './stages/harden';
import { runStage as waste } from './stages/waste';
import { runStage as triage } from './stages/triage';
import { recordJob, type JobOutcome } from './ledger';
import { clearSessions, markResumed, resumedStage } from './sessions';
import { clearQueued, readState, updateState } from './state';
import { QUEUE_OF, type Ctx, type Job, type JobStage } from './types';

type Handler = (ctx: Ctx, issue: number) => Promise<void>;

const HANDLERS: Record<Exclude<JobStage, 'release' | 'dev' | 'waste' | 'merge'>, Handler> = {
  triage, design, implement, verify, harden, checks, change, adhoc, playtest, candidate, remove, incident,
  ship: (ctx, issue) => ship(ctx, issue, readState(ctx.statePath).pendingShip),
  approve: (ctx, issue) => approve(ctx, issue, readState(ctx.statePath).pendingApprovals[String(issue)] ?? 'the committee'),
};

const CARD_STAGE_NAMES: Partial<Record<JobStage, string>> = { triage: 'Triage', design: 'Design', implement: 'Implementation', verify: 'Testing', harden: 'Hardening', checks: 'Post' };

type Ending = 'finished' | 'failed' | 'stopped';
const NEXT: Record<Ending, string> = { finished: '', failed: ' Hermes is looking into it.', stopped: ' It resumes in its own session on the next tick, with the error.' };

export function progressNote(ctx: Ctx, stage: JobStage, startedAt: string | null, outcome: Ending): string {
  const minutes = startedAt ? Math.round((ctx.now().getTime() - new Date(startedAt).getTime()) / 60_000) : null;
  const took = minutes === null ? '' : ` after ${minutes} min`;
  return `${CARD_STAGE_NAMES[stage]} ${outcome}${took}.${NEXT[outcome]}`;
}

async function noteProgress(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null, outcome: Ending): Promise<void> {
  if (issue === null || !(stage in CARD_STAGE_NAMES)) return;
  await ctx.github.comment(issue, progressNote(ctx, stage, job?.startedAt ?? null, outcome));
}

function retriesItself(ctx: Ctx, stage: JobStage, issue: number | null, error: unknown): issue is number {
  if (issue === null || !CARD_JOBS.includes(stage)) return false;
  if (error instanceof BudgetError || error instanceof UsageLimitError || error instanceof CommitteeDecisionError) return false;
  return !readState(ctx.statePath).interrupted.includes(issue);
}

function resumeOnce(ctx: Ctx, stage: JobStage, issue: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  markResumed(ctx.cfg.home, issue, stage, summarizeError(message));
  updateState(ctx.statePath, (state) => ({ ...state, interrupted: [...state.interrupted, issue] }));
  ctx.log(stage, issue, `stopped on an error, it resumes once: ${message}`);
}

function ownJob(ctx: Ctx, stage: JobStage, issue: number | null): Job | null {
  return readState(ctx.statePath).jobs.find((job) => job.stage === stage && job.issue === issue) ?? null;
}

export async function runJob(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  const job = ownJob(ctx, stage, issue);
  const entry = ledgerEntry(ctx, job, stage, issue);
  let outcome: JobOutcome = 'failed';
  let retry = false;
  if (!resuming(ctx, stage, issue)) clearSessionsOf(ctx, stage, issue);
  try {
    await dispatch(ctx, stage, issue, job);
    outcome = 'done';
    ctx.log(stage, issue, 'done');
    await noteProgress(ctx, stage, issue, job, 'finished');
  } catch (error) {
    retry = await failed(ctx, stage, issue, job, error);
  } finally {
    recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), entry, outcome);
    clearJob(ctx, stage, issue, retry);
    if (!retry) clearSessionsOf(ctx, stage, issue);
  }
}

async function failed(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null, error: unknown): Promise<boolean> {
  const retry = retriesItself(ctx, stage, issue, error);
  if (retry) resumeOnce(ctx, stage, issue, error);
  else await reportFailure(ctx, stage, failureIssue(stage, issue, readState(ctx.statePath)), error, job?.log ?? null, batchOf(ctx, job));
  await noteProgress(ctx, stage, issue, job, retry ? 'stopped' : 'failed');
  return retry;
}

function batchOf(ctx: Ctx, job: Job | null): number[] {
  if (job === null) return [];
  return readState(ctx.statePath).jobs.find((other) => other.id === job.id)?.batch ?? [];
}

function ledgerEntry(ctx: Ctx, job: Job | null, stage: JobStage, issue: number | null): { id: string | null; stage: JobStage; issue: number | null; startedAt: string } {
  if (job === null) return { id: null, stage, issue, startedAt: ctx.now().toISOString() };
  return { id: job.id, stage, issue, startedAt: job.startedAt };
}

function resuming(ctx: Ctx, stage: JobStage, issue: number | null): boolean {
  return issue !== null && readState(ctx.statePath).interrupted.includes(issue) && resumedStage(ctx.cfg.home, issue) === stage;
}

function clearSessionsOf(ctx: Ctx, stage: JobStage, issue: number | null): void {
  if (issue !== null && QUEUE_OF[stage] !== 'branch') clearSessions(ctx.cfg.home, issue);
}

const ISSUELESS: Record<'release' | 'dev' | 'waste' | 'merge', (ctx: Ctx, job: Job | null) => Promise<unknown>> = {
  release: (ctx) => release(ctx),
  waste: (ctx) => waste(ctx),
  merge: (ctx) => merge(ctx),
  dev: (ctx, job) => rebuildDev(ctx, job?.log ?? `${ctx.cfg.home}/logs/dev-build.log`),
};

const isIssueless = (stage: JobStage): stage is keyof typeof ISSUELESS => stage in ISSUELESS;

async function dispatch(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null): Promise<void> {
  if (isIssueless(stage)) return void (await ISSUELESS[stage](ctx, job));
  if (issue === null) throw new Error(`Job ${stage} needs an issue or change id`);
  return HANDLERS[stage](ctx, issue);
}

function clearJob(ctx: Ctx, stage: JobStage, issue: number | null, resumes: boolean): void {
  updateState(ctx.statePath, (state) => {
    const jobs = state.jobs.filter((job) => job.stage !== stage || job.issue !== issue);
    const interrupted = QUEUE_OF[stage] === 'branch' || resumes ? state.interrupted : state.interrupted.filter((item) => item !== issue);
    return { ...clearQueued(state, stage, issue), jobs, interrupted };
  });
}
