import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { withLockSync } from './lock';
import type { JobStage, Route } from './types';
import { reportAttempt, type Observation } from './observability';

// One agent run: its model, its cost in dollars and its run time.
export type ModelUsage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
export type AgentUsage = { model: string; costUsd: number; minutes: number; modelUsage?: ModelUsage[]; sessionId?: string; resumed?: boolean };
export type JobOutcome = 'done' | 'failed' | 'died' | 'timeout';

// One line per ended job and per routed committee reply. The waste review derives queue wait and reruns from these lines.
export type LedgerLine =
  | Observation
  | { kind: 'job'; id: string; stage: JobStage; issue: number | null; startedAt: string; endedAt: string; outcome: JobOutcome; agents: AgentUsage[]; retryOf?: string | null }
  | { kind: 'route'; issue: number; route: Route; by: string; at: string }
  | { kind: 'post'; id: number; channel?: string; text: string; at: string };

// An append is one small write, so a writer that waits this long found a stuck lock.
const LEDGER_LOCK_MS = 30_000;

const ledgerPath = (home: string): string => join(home, 'ledger.jsonl');
const usagePath = (home: string, jobId: string): string => join(home, 'usage', `${jobId}.jsonl`);

// Claude's stream-json output ends with a `result` event that holds the run's cost and duration.
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

// A job's agents run one after another in its own process, so its usage file has one writer.
export function appendUsage(home: string, jobId: string, usage: AgentUsage): void {
  mkdirSync(join(home, 'usage'), { recursive: true });
  appendFileSync(usagePath(home, jobId), `${JSON.stringify(usage)}\n`);
}

// Returns every agent run the job recorded and removes the file, so the job's ledger line holds them once.
export function takeUsage(home: string, jobId: string): AgentUsage[] {
  const path = usagePath(home, jobId);
  if (!existsSync(path)) return [];
  const runs = readLines<AgentUsage>(path);
  rmSync(path);
  return runs;
}

// The ledger line of a job that ended, with the agent runs it recorded. A job run by hand has no id and records no usage.
export function recordJob(home: string, endedAt: Date, job: { id: string | null; stage: JobStage; issue: number | null; startedAt: string }, outcome: JobOutcome): void {
  const id = job.id ?? 'hand-run';
  const agents = job.id === null ? [] : takeUsage(home, job.id);
  const retryOf = job.id === null ? undefined : reportAttempt(home, { ...job, id }, outcome, endedAt);
  appendLedger(home, { kind: 'job', id, stage: job.stage, issue: job.issue, startedAt: job.startedAt, endedAt: endedAt.toISOString(), outcome, agents, ...(retryOf === undefined ? {} : { retryOf }) });
}

export function appendLedger(home: string, line: LedgerLine): void {
  withLockSync(join(home, 'ledger.lock'), LEDGER_LOCK_MS, () => appendFileSync(ledgerPath(home), `${JSON.stringify(line)}\n`));
}

// The lines that ended at or after `since`.
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
