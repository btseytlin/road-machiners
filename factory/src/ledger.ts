import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLockSync } from './lock';
import { transcriptUsage } from './transcript';
import type { CardFlow, CardStep } from './card-events';
import type { Column, JobStage, Route, TokenPrice } from './types';
import { reportAttempt, type Observation } from './observability';

export type ModelUsage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
export type AgentUsage = { model: string; costUsd: number; minutes: number; modelUsage?: ModelUsage[]; sessionId?: string; resumed?: boolean; fromTranscript?: true };
export type OpenRun = { model: string; projects: string; sessionId: string; resumed: boolean; startedAt: string };
export type JobOutcome = 'done' | 'failed' | 'died' | 'timeout' | 'stopped' | 'held';
export const isFailedOutcome = (outcome: JobOutcome): boolean => outcome !== 'done' && outcome !== 'held';

export type LedgerLine =
  | Observation
  | { kind: 'job'; id: string; stage: JobStage; issue: number | null; startedAt: string; endedAt: string; outcome: JobOutcome; agents: AgentUsage[]; peakGb?: number; retryOf?: string | null }
  | { kind: 'route'; issue: number; route: Route; by: string; at: string }
  | { kind: 'post'; id: number; channel?: string; text: string; at: string }
  | { kind: 'control'; action: string; issue: number | null; by: string; reason: string; at: string }
  | { kind: 'card'; issue: number; step: CardStep; to: Column; at: string; flow?: CardFlow };

const LEDGER_LOCK_MS = 30_000;

const ledgerPath = (home: string): string => join(home, 'ledger.jsonl');
const usagePath = (home: string, jobId: string): string => join(home, 'usage', `${jobId}.jsonl`);
const peakPath = (home: string, jobId: string): string => join(home, 'usage', `${jobId}.peak`);
const openRunPath =(home: string, jobId: string): string => join(home, 'usage', `${jobId}.run.json`);
export const runProjectsDir = (home: string, jobId: string): string => join(home, 'usage', `${jobId}.projects`);

function readResult(stdout: string): Record<string, unknown> & { total_cost_usd: number; duration_ms: number } {
  const result = stdout.trimEnd().split('\n').reverse().map(parseLine).find((event) => event?.type === 'result' && !event.parent_tool_use_id);
  if (result === undefined) throw new Error('The agent output has no result event, so its cost is unknown');
  if (typeof result.total_cost_usd !== 'number') throw new Error('The agent result event has no total_cost_usd');
  if (typeof result.duration_ms !== 'number') throw new Error('The agent result event has no duration_ms');
  return result as Record<string, unknown> & { total_cost_usd: number; duration_ms: number };
}
export function usageFromOutput(stdout: string, model: string, resumed = false): AgentUsage {
  const result = readResult(stdout);
  const modelUsage = readModelUsage(result.modelUsage);
  return { model, costUsd: result.total_cost_usd, minutes: result.duration_ms / 60_000,
    ...(modelUsage?.length ? { modelUsage } : {}),
    ...(typeof result.session_id === 'string' ? { sessionId: result.session_id, resumed } : {}),
  };
}

function readMeasurement(fields: Record<string, unknown>, key: string): number {
  const count = fields[key];
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw new Error(`Invalid ${key}`);
  return count;
}
function readModelUsage(measurements: unknown): ModelUsage[] | null {
  if (measurements === undefined) return null;
  if (typeof measurements !== 'object' || measurements === null || Array.isArray(measurements)) throw new Error('Invalid modelUsage');
  return Object.entries(measurements).map(([model, value]) => {
    if (!/^[\w.:-]+$/.test(model) || typeof value !== 'object' || value === null) throw new Error('Invalid modelUsage');
    const fields = value as Record<string, unknown>;
    return { model, input: readMeasurement(fields, 'inputTokens'), output: readMeasurement(fields, 'outputTokens'),
      cacheRead: readMeasurement(fields, 'cacheReadInputTokens'), cacheWrite: readMeasurement(fields, 'cacheCreationInputTokens'), cost: readMeasurement(fields, 'costUSD') };
  });
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function appendUsage(home: string, jobId: string, usage: AgentUsage): void {
  mkdirSync(join(home, 'usage'), { recursive: true });
  appendFileSync(usagePath(home, jobId), `${JSON.stringify(usage)}\n`);
}

export function openRun(home: string, jobId: string, run: OpenRun): void {
  mkdirSync(join(home, 'usage'), { recursive: true });
  writeFileSync(openRunPath(home, jobId), JSON.stringify(run));
}

export function closeRun(home: string, jobId: string, usage: AgentUsage): void {
  appendUsage(home, jobId, usage);
  forgetRun(home, jobId);
}

export function closeRunFromTranscript(home: string, jobId: string, prices: Record<string, TokenPrice>, endedAt: Date): void {
  const path = openRunPath(home, jobId);
  if (!existsSync(path)) return;
  const run = JSON.parse(readFileSync(path, 'utf8')) as OpenRun;
  const modelUsage = transcriptUsage(run.projects, run.sessionId, prices);
  if (modelUsage !== null) {
    const costUsd = modelUsage.reduce((sum, row) => sum + row.cost, 0);
    const minutes = (endedAt.getTime() - Date.parse(run.startedAt)) / 60_000;
    appendUsage(home, jobId, { model: run.model, costUsd, minutes, modelUsage, sessionId: run.sessionId, resumed: run.resumed, fromTranscript: true });
  }
  forgetRun(home, jobId);
}

function forgetRun(home: string, jobId: string): void {
  rmSync(openRunPath(home, jobId), { force: true });
  rmSync(runProjectsDir(home, jobId), { recursive: true, force: true });
}

export function recordPeak(home: string, jobId: string, gb: number): void {
  mkdirSync(join(home, 'usage'), { recursive: true });
  const path = peakPath(home, jobId);
  const before = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
  writeFileSync(path, String(Math.max(before, gb)));
}

function takePeak(home: string, jobId: string): number | undefined {
  const path = peakPath(home, jobId);
  if (!existsSync(path)) return undefined;
  const gb = Number(readFileSync(path, 'utf8'));
  rmSync(path);
  return gb;
}

export function takeUsage(home: string, jobId: string): AgentUsage[] {
  const path = usagePath(home, jobId);
  if (!existsSync(path)) return [];
  const runs = readLines<AgentUsage>(path);
  rmSync(path);
  return runs;
}

export function recordJob(home: string, prices: Record<string, TokenPrice>, endedAt: Date, job: { id: string | null; stage: JobStage; issue: number | null; startedAt: string }, outcome: JobOutcome): void {
  const records = job.id === null ? { agents: [] } : takeJobRecords(home, prices, endedAt, { ...job, id: job.id }, outcome);
  appendLedger(home, { kind: 'job', id: job.id ?? 'hand-run', stage: job.stage, issue: job.issue, startedAt: job.startedAt, endedAt: endedAt.toISOString(), outcome, ...records });
}

function takeJobRecords(home: string, prices: Record<string, TokenPrice>, endedAt: Date, job: { id: string; stage: JobStage; issue: number | null; startedAt: string }, outcome: JobOutcome): { agents: AgentUsage[]; peakGb?: number; retryOf?: string | null } {
  closeRunFromTranscript(home, job.id, prices, endedAt);
  const agents = takeUsage(home, job.id);
  const peakGb = takePeak(home, job.id);
  const retryOf = reportAttempt(home, job, outcome, endedAt);
  return { agents, ...(peakGb === undefined ? {} : { peakGb }), ...(retryOf === undefined ? {} : { retryOf }) };
}

export function appendLedger(home: string, line: LedgerLine): void {
  withLockSync(join(home, 'ledger.lock'), LEDGER_LOCK_MS, () => appendFileSync(ledgerPath(home), `${JSON.stringify(line)}\n`));
}

export function readLedger(home: string, since: Date): LedgerLine[] {
  const path = ledgerPath(home);
  if (!existsSync(path)) return [];
  return readLines<LedgerLine>(path).filter((line) => new Date(lineTime(line)).getTime() >= since.getTime());
}

export function lineTime(line: LedgerLine): string {
  return line.kind === 'job' ? line.endedAt : line.at;
}

function readLines<T>(path: string): T[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T);
}
