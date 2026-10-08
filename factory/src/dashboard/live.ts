import { createHash } from 'node:crypto';
import { readObservation, type Observation, type ActivityData } from '../observability';
import { QUEUE_OF, type FactoryState, type Job, type JobStage } from '../types';
import type { ScheduleReport, WaitReason } from '../tick';

const WAIT_REASONS: WaitReason[] = ['queue-full', 'issue-running','card-budget', 'needs-info', 'failed', 'approval', 'held'];
export function createWorkerKey(id: string): string { return createHash('sha256').update(id).digest('hex'); }
function isPrivateStage(stage: JobStage): boolean { return ['change', 'adhoc'].includes(stage); }
function readPublicIssue(stage: JobStage, issue: number | null): number | null { return isPrivateStage(stage) ? null : issue; }
function readFreshness(record: Observation, now: Date, heartbeatMs: number): 'ok' | 'stale' {
  return now.getTime() - Date.parse(record.at) > heartbeatMs * 3 ? 'stale' : 'ok';
}
function readWorkerActivity(home: string, job: Job, state: FactoryState, now: Date, heartbeatMs: number) {
  const record = readObservation(home, job.id);
  const key = createWorkerKey(job.id);
  if (record === null || record.data.type !== 'activity') return { key, activity: null, status: 'unavailable' };
  const value = record.data;
  const milestone = isPrivateStage(job.stage) ? null : value.milestone ?? null;
  return { key, activity: value.activity, milestone, phase: value.phase, source: value.source, progressAt: value.progressAt ?? null, since: record.since,
    status: readFreshness(record, now, heartbeatMs), waitingFor: readLockOwner(value, state) };
}
function readLockOwner(data: ActivityData | null, state: FactoryState): string | null {
  if (data?.activity !== 'lock') return null;
  const owner = state.jobs.find((job) => job.pid === data.ownerPid);
  return owner ? createWorkerKey(owner.id) : null;
}
function readScheduler(home: string, now: Date, heartbeatMs: number) {
  const record = readObservation(home, 'scheduler');
  if (record?.data.type !== 'scheduler') return null;
  const data = record.data;
  return { at: record.at, since: record.since, status: data.status, freshness: readFreshness(record, now, heartbeatMs),
    ...projectSchedule(data.report), counts: data.counts };
}
function projectSchedule(report: ScheduleReport | null) {
  if (report === null) return { decisions: [], release: null };
  return { decisions: report.decisions.map((item) => ({ stage: item.stage, queue: QUEUE_OF[item.stage], issue: readPublicIssue(item.stage, item.issue), reasons: item.reasons.filter((reason) => WAIT_REASONS.includes(reason)) })),
    release: report.release };
}
function readManager(home: string, now: Date, heartbeatMs: number) {
  const record = readObservation(home, 'manager');
  if (record?.data.type !== 'manager') return null;
  return { activity: record.data.activity, intent: record.data.intent ?? null, phase: record.data.phase, at: record.at, since: record.since,
    status: readFreshness(record, now, heartbeatMs) };
}
export function readLiveOperations(home: string, state: FactoryState, now: Date, heartbeatMs: number, tickIntervalMs: number) {
  return { workers: state.jobs.map((job) => readWorkerActivity(home, job, state, now, heartbeatMs)),
    scheduler: readScheduler(home, now, tickIntervalMs), manager: readManager(home, now, heartbeatMs) };
}
