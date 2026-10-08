import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendLedger } from './ledger';
import { withLockSync } from './lock';
import type { ScheduleReport } from './tick';
import { ADHOC_LABEL, COLUMNS, QUEUE_OF, type Card, type Column, type JobStage } from './types';
import type { JobOutcome } from './ledger';

export const ACTIVITIES = ['starting', 'model', 'reading', 'editing', 'command', 'tests', 'typecheck', 'playtest', 'build', 'publish', 'install', 'git', 'lock', 'review', 'design', 'investigate', 'waiting', 'finished'] as const;
export type Activity = typeof ACTIVITIES[number];
// An agent names its milestone in the card's words, like "Building orchard buildings". The public dashboard shows it, so the text cannot carry paths, commands or markup, and fits one table cell.
export const MILESTONE_PATTERN = /^[A-Za-z0-9 ,.'-]{3,80}$/;
export type Milestone = string;
export type ActivityData = { type: 'activity'; activity: Activity; phase: 'running' | 'completed' | 'failed'; source: 'runner' | 'agent'; milestone?: Milestone | null; progressAt?: string | null; ownerPid?: number | null };
export type SchedulerData = { type: 'scheduler'; status: 'checking' | 'ready' | 'paused' | 'disk-low' | 'failed'; report: ScheduleReport | null; counts: Partial<Record<Column, number>> };
export type ManagerData = { type: 'manager'; activity: Activity; intent?: Activity | null; phase: 'running' | 'completed' | 'failed'; issue: number | null };
export type AttemptData = { type: 'attempt'; jobId: string; stage: JobStage; issue: number | null; startedAt: string; outcome: JobOutcome | 'started'; previousId: string | null };
export type ObservationData = ActivityData | SchedulerData | ManagerData | AttemptData;
export type Observation = { kind: 'observation'; producer: string; at: string; since: string; data: ObservationData };

function resolveObservationPath(home: string, producer: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(producer)) throw new Error('Invalid observation producer');
  return join(home, 'observations', `${producer}.json`);
}
export function readObservation(home: string, producer: string): Observation | null {
  const path = resolveObservationPath(home, producer);
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, 'utf8')) as Observation;
  if (record.producer !== producer || record.kind !== 'observation') throw new Error('Invalid observation identity');
  if (!Number.isFinite(Date.parse(record.at)) || !Number.isFinite(Date.parse(record.since))) throw new Error('Invalid observation time');
  validateObservationData(record.data);
  return record;
}
function validateObservationData(data: ObservationData): void {
  if (data.type === 'scheduler') return validateScheduler(data);
  if (data.type === 'attempt') return;
  validateActivitySource(data);
  if (!['activity', 'manager'].includes(data.type)) throw new Error('Invalid observation type');
  if (!ACTIVITIES.includes(data.activity)) throw new Error('Invalid observation activity');
  if (!['running', 'completed', 'failed'].includes(data.phase)) throw new Error('Invalid observation phase');
}
function validateActivitySource(data: ActivityData | ManagerData): void {
  if (data.type === 'manager') return validateManagerIntent(data);
  if (!['runner', 'agent'].includes(data.source)) throw new Error('Invalid activity source');
  validateMilestone(data.milestone);
  if (data.progressAt != null && !Number.isFinite(Date.parse(data.progressAt))) throw new Error('Invalid progress time');
}
function validateMilestone(milestone: Milestone | null | undefined): void {
  if (milestone != null && !MILESTONE_PATTERN.test(milestone)) throw new Error('Invalid activity milestone');
}
function validateManagerIntent(data: ManagerData): void {
  if (data.intent != null && !ACTIVITIES.includes(data.intent)) throw new Error('Invalid manager intent');
}
function validateScheduler(data: SchedulerData): void {
  if (!['checking', 'ready', 'paused', 'disk-low', 'failed'].includes(data.status)) throw new Error('Invalid scheduler status');
  for (const [column, count] of Object.entries(data.counts)) validateFunnelCount(column, count);
  if (data.report === null) return;
  for (const decision of data.report.decisions) validateDecision(decision);
  validateReleaseReport(data.report);
}
function validateFunnelCount(column: string, count: number): void {
  if (!(COLUMNS as readonly string[]).includes(column)) throw new Error('Invalid funnel column');
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid funnel count');
}
function validateDecision(decision: ScheduleReport['decisions'][number]): void {
  if (!Object.hasOwn(QUEUE_OF, decision.stage)) throw new Error('Invalid scheduler stage');
  validateIssue(decision.issue);
  const reasons = ['queue-full', 'issue-running', 'daily-cap', 'card-budget', 'needs-info', 'failed', 'approval', 'held'];
  if (!decision.reasons.every((reason) => reasons.includes(reason))) throw new Error('Invalid scheduler reason');
}
function validateIssue(issue: number | null): void {
  if (issue === null) return;
  if (!Number.isSafeInteger(issue) || issue <= 0) throw new Error('Invalid observation issue');
}
function validateReleaseReport(report: ScheduleReport): void {
  if (report.nextCapAt !== null && !Number.isFinite(Date.parse(report.nextCapAt))) throw new Error('Invalid cap time');
  if (!['uncut', 'tracking-missing', 'failed', 'release-tasks', 'playtest', 'playtest-blocked', 'candidate', 'ship-approval'].includes(report.release.reason)) throw new Error('Invalid release gate');
  for (const issue of report.release.issues) validateIssue(issue);
}
export function recordObservation(home: string, producer: string, data: ObservationData, now = new Date()): void {
  const path = resolveObservationPath(home, producer);
  validateObservationData(data);
  mkdirSync(join(home, 'observations'), { recursive: true });
  // Match the state lock's deadline: observation writes are small local transactions.
  withLockSync(`${path}.lock`, 30_000, () => writeObservation(home, path, producer, data, now));
}
function writeObservation(home: string, path: string, producer: string, data: ObservationData, now: Date): void {
  const previous = readObservation(home, producer);
  const at = now.toISOString();
  if (previous && previous.at > at) throw new Error('Out-of-order observation');
  const changed = JSON.stringify(previous?.data) !== JSON.stringify(data);
  const since = changed ? at : previous!.since;
  const record: Observation = { kind: 'observation', producer, at, since, data };
  if (shouldJournalObservation(changed, data)) appendLedger(home, record);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporary, path);
}
function shouldJournalObservation(changed: boolean, data: ObservationData): boolean { return changed || data.type === 'scheduler'; }
export function reportObservation(home: string, producer: string, data: ObservationData, now = new Date()): boolean {
  try {
    recordObservation(home, producer, data, now);
    return true;
  } catch (error) {
    console.error('Factory observation failed', producer, error);
    return false;
  }
}
export function recordAttempt(home: string, job: { id: string; stage: JobStage; issue: number | null; startedAt: string }, outcome: AttemptData['outcome'], now: Date): string | null {
  const producer = `attempt-${job.stage}-${job.issue ?? 'none'}`;
  const prior = readLastAttempt(home, producer);
  if (outcome !== 'started' && prior && prior.jobId !== job.id) return null;
  const previousId = findPreviousAttempt(prior, job.id);
  recordObservation(home, producer, { type: 'attempt', jobId: job.id, stage: job.stage, issue: job.issue, startedAt: job.startedAt, outcome, previousId }, now);
  return previousId;
}
function readLastAttempt(home: string, producer: string): AttemptData | null {
  const data = readObservation(home, producer)?.data;
  return data?.type === 'attempt' ? data : null;
}
function findPreviousAttempt(previous: AttemptData | null, jobId: string): string | null {
  if (previous === null) return null;
  if (previous.jobId === jobId) return previous.previousId;
  return previous.outcome === 'done' ? null : previous.jobId;
}
export function reportAttempt(home: string, job: { id: string; stage: JobStage; issue: number | null; startedAt: string }, outcome: AttemptData['outcome'], now: Date): string | null | undefined {
  try { return recordAttempt(home, job, outcome, now); }
  catch (error) { console.error('Factory attempt observation failed', job.id, error); return undefined; }
}
export function createLockWaitReporter(home: string, producer: string | null, heartbeatMs: number): (owner: number | null) => void {
  let lastReport = 0;
  return (ownerPid) => {
    if (producer === null || Date.now() - lastReport < heartbeatMs) return;
    reportObservation(home, producer, { type: 'activity', activity: 'lock', phase: 'running', source: 'runner', ownerPid });
    lastReport = Date.now();
  };
}
export function reportScheduler(home: string, status: SchedulerData['status'], now: Date, report: ScheduleReport | null = null, cards: Card[] = []): void {
  const counts: Partial<Record<Column, number>> = {};
  for (const card of cards.filter((item) => !item.labels.includes(ADHOC_LABEL))) counts[card.column] = (counts[card.column] ?? 0) + 1;
  reportObservation(home, 'scheduler', { type: 'scheduler', status, report, counts }, now);
}
function readStatusFields(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const fields = value as Record<string, unknown>;
  if (fields.type !== 'factory_status' || Object.keys(fields).length !== 2) return null;
  return fields;
}
function readReportedActivity(value: unknown): { activity: Activity } | null {
  if (typeof value !== 'string' || !ACTIVITIES.includes(value as Activity)) return null;
  return { activity: value as Activity };
}
function readReportedMilestone(value: unknown): { milestone: Milestone } | null {
  if (typeof value !== 'string' || !MILESTONE_PATTERN.test(value)) return null;
  return { milestone: value };
}
export function parseAgentStatus(line: string): { activity: Activity } | { milestone: Milestone } | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  const fields = readStatusFields(value);
  if (fields === null) return null;
  return readReportedActivity(fields.activity) ?? readReportedMilestone(fields.milestone);
}
