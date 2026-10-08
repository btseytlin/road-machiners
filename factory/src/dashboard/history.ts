import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isFailedOutcome, lineTime, type AgentUsage, type LedgerLine, type ModelUsage } from '../ledger';
import type { JobStage } from '../types';
import type { Observation, SchedulerData } from '../observability';
import { summarizeDelivery, type DeliverySummary } from './delivery';

const DAY_MS = 86_400_000;
// A card can take months from triage to its merge, so card lines stay longer than the 30 days of usage. Each card writes a few lines, so this stays small.
const CARD_DAYS = 180;
type Job = Extract<LedgerLine, { kind: 'job' }>;
type CardLine = Extract<LedgerLine, { kind: 'card' }>;
type Counts = { input: number; output: number; cacheRead: number; cacheWrite: number };
// A bucket is one UTC hour for the 24-hour range and one UTC day otherwise. Segment tokens count measured usage only.
type Segment = { cost: number; tokens: number };
type Bucket = { start: string; cost: number; tokens: Counts | null; stages: Record<string, Segment>; models: Record<string, Segment> };
const UNATTRIBUTED = 'unattributed';
type Summary = {
  days: number; since: string | null; completed: number; failed: number; timeouts: number; workerMs: number;
  cost: number | null; tokens: Counts | null; missingUsage: number; collectionFaults: number;
  // Spend of jobs that failed, died or timed out, including runs priced from their transcripts.
  wasted: { cost: number | null; tokens: Counts | null };
  models: ModelUsage[]; stageModels: (ModelUsage & { stage: JobStage })[]; stages: { stage: string; workerMs: number; cost: number | null }[];
  issues: { issue: number; workerMs: number; cost: number | null }[];
  buckets: Bucket[];
  activity: { stage: JobStage; issue: number | null; outcome: string; at: string }[];
  waitingMs: number | null; waitingStages: { stage: string; workerMs: number }[]; waitingGaps: number;
  retries: { outcome: string; runs: number; workerMs: number; cost: number | null }[];
  delivery: DeliverySummary | null;
};
type StageRow = Summary['stages'][number];
type IssueRow = Summary['issues'][number];
type Totals = { stages: Map<string, StageRow>; issues: Map<number, IssueRow>; models: Map<string, ModelUsage>; stageModels: Map<string, ModelUsage & { stage: JobStage }>; buckets: Map<string, Bucket> };
const createCounts = (): Counts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
function addCounts(target: Counts, value: Counts): void {
  target.input += value.input;
  target.output += value.output;
  target.cacheRead += value.cacheRead;
  target.cacheWrite += value.cacheWrite;
}
function getPublicIssue(job: Job): number | null {
  return job.stage === 'change' || job.stage === 'adhoc' ? null : job.issue;
}
function createSummary(days: number, since: string | null): Summary {
  return { days, since, completed: 0, failed: 0, timeouts: 0, workerMs: 0, cost: null, tokens: null, missingUsage: 0, collectionFaults: 0, wasted: { cost: null, tokens: null }, waitingMs: null, waitingStages: [], waitingGaps: 0, retries: [], delivery: null, models: [], stageModels: [], stages: [], issues: [], buckets: [], activity: [] };
}
function addCost(summary: Summary, stage: StageRow, issue: IssueRow | null, cost: number): void {
  summary.cost = (summary.cost ?? 0) + cost;
  stage.cost = (stage.cost ?? 0) + cost;
  if (issue) issue.cost = (issue.cost ?? 0) + cost;
}
function addWaste(summary: Summary, agent: AgentUsage): void {
  summary.wasted.cost = (summary.wasted.cost ?? 0) + agent.costUsd;
  for (const usage of agent.modelUsage ?? []) addCounts(summary.wasted.tokens ??= createCounts(), usage);
}
function addAgent(summary: Summary, totals: Totals, job: Job, agent: AgentUsage, stage: StageRow, issue: IssueRow | null): void {
  addCost(summary, stage, issue, agent.costUsd);
  if (isFailedOutcome(job.outcome)) addWaste(summary, agent);
  const bucket = getBucket(totals, job.endedAt.slice(0, summary.days === 1 ? 13 : 10));
  bucket.cost += agent.costUsd;
  addSegment(bucket.stages, job.stage, agent.costUsd, 0);
  if (!agent.modelUsage?.length) { summary.missingUsage++; addSegment(bucket.models, UNATTRIBUTED, agent.costUsd, 0); return; }
  addMeasuredUsage(summary, totals, bucket, job.stage, agent.modelUsage);
}
function getBucket(totals: Totals, start: string): Bucket {
  const bucket = totals.buckets.get(start) ?? { start, cost: 0, tokens: null, stages: {}, models: {} };
  totals.buckets.set(start, bucket);
  return bucket;
}
function addSegment(segments: Record<string, Segment>, key: string, cost: number, tokens: number): void {
  const segment = segments[key] ?? { cost: 0, tokens: 0 };
  segment.cost += cost;
  segment.tokens += tokens;
  segments[key] = segment;
}
const sumCounts = (value: Counts): number => value.input + value.output + value.cacheRead + value.cacheWrite;
function addMeasuredUsage(summary: Summary, totals: Totals, bucket: Bucket, stage: JobStage, measurements: ModelUsage[]): void {
  summary.tokens ??= createCounts();
  bucket.tokens ??= createCounts();
  for (const usage of measurements) {
    addModel(summary.tokens, totals.models, bucket.tokens, usage);
    addStageModel(totals.stageModels, stage, usage);
    addSegment(bucket.stages, stage, 0, sumCounts(usage));
    addSegment(bucket.models, usage.model, usage.cost, sumCounts(usage));
  }
}
function addStageModel(rows: Totals['stageModels'], stage: JobStage, usage: ModelUsage): void {
  const key = JSON.stringify([stage, usage.model]);
  const row = rows.get(key) ?? { stage, model: usage.model, cost: 0, ...createCounts() };
  addCounts(row, usage);
  row.cost += usage.cost;
  rows.set(key, row);
}
function addModel(tokens: Counts, models: Map<string, ModelUsage>, bucket: Counts, usage: ModelUsage): void {
  addCounts(tokens, usage);
  addCounts(bucket, usage);
  const model = models.get(usage.model) ?? { model: usage.model, cost: 0, ...createCounts() };
  addCounts(model, usage);
  model.cost += usage.cost;
  models.set(usage.model, model);
}
function addJob(summary: Summary, totals: Totals, job: Job): void {
  const duration = Date.parse(job.endedAt) - Date.parse(job.startedAt);
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid job duration');
  summary.workerMs += duration;
  summary.completed += Number(job.outcome === 'done');
  summary.failed += Number(isFailedOutcome(job.outcome));
  summary.timeouts += Number(job.outcome === 'timeout');
  const publicIssue = getPublicIssue(job);
  summary.activity.push({ stage: job.stage, issue: publicIssue, outcome: job.outcome === 'done' ? 'finished' : job.outcome, at: job.endedAt });
  const { stage, issue } = getJobRows(totals, job, publicIssue, duration);
  summary.missingUsage += countMissingRuns(job);
  for (const agent of job.agents) addAgent(summary, totals, job, agent, stage, issue);
}
function countMissingRuns(job: Job): number {
  return Number(!job.agents.length && ['triage', 'design', 'implement', 'patch', 'verify', 'change', 'adhoc', 'incident', 'waste'].includes(job.stage));
}
function getJobRows(totals: Totals, job: Job, publicIssue: number | null, duration: number): { stage: StageRow; issue: IssueRow | null } {
  const stage = totals.stages.get(job.stage) ?? { stage: job.stage, workerMs: 0, cost: null };
  stage.workerMs += duration;
  totals.stages.set(job.stage, stage);
  if (publicIssue === null) return { stage, issue: null };
  const issue = totals.issues.get(publicIssue) ?? { issue: publicIssue, workerMs: 0, cost: null };
  issue.workerMs += duration;
  totals.issues.set(publicIssue, issue);
  return { stage, issue };
}

// A run cut off and then resumed is priced once from its transcript and once by Claude Code. Both price the same tokens, but sum the floats in another order.
const COST_ROUNDING = 1e-6;
function subtractMeasurement(current: number, previous: number): number {
  const value = current - previous;
  if (value < 0 && value > -COST_ROUNDING) return 0;
  if (!Number.isFinite(value) || value < 0) throw new Error('Cumulative usage decreased');
  return value;
}
function subtractModel(current: ModelUsage, previous: ModelUsage): ModelUsage {
  return { model: current.model, cost: subtractMeasurement(current.cost, previous.cost), input: subtractMeasurement(current.input, previous.input), output: subtractMeasurement(current.output, previous.output), cacheRead: subtractMeasurement(current.cacheRead, previous.cacheRead), cacheWrite: subtractMeasurement(current.cacheWrite, previous.cacheWrite) };
}
function reconcileModels(current: AgentUsage, previous: AgentUsage): ModelUsage[] | undefined {
  if (!current.modelUsage || !previous.modelUsage) return undefined;
  return current.modelUsage.map((model) => {
    const prior = previous.modelUsage!.find((row) => row.model === model.model);
    return prior ? subtractModel(model, prior) : model;
  });
}
function reconcileAgent(agent: AgentUsage, sessions: Map<string, AgentUsage>): AgentUsage {
  if (!agent.sessionId) return agent;
  const prior = sessions.get(agent.sessionId);
  sessions.set(agent.sessionId, agent);
  if (!agent.resumed || !prior) return agent;
  return { ...agent, costUsd: subtractMeasurement(agent.costUsd, prior.costUsd), modelUsage: reconcileModels(agent, prior) };
}
function reconcileJobs(records: LedgerLine[]): Job[] {
  const sessions = new Map<string, AgentUsage>();
  return records.filter((line): line is Job => line.kind === 'job').map((job) => ({ ...job, agents: job.agents.map((agent) => reconcileAgent(agent, sessions)) }));
}
function addRetry(summary: Summary, jobs: Job[], job: Job): void {
  if (!job.retryOf) return;
  const outcome = readPreviousOutcome(jobs, job.retryOf);
  const row = summary.retries.find((item) => item.outcome === outcome) ?? { outcome, runs: 0, workerMs: 0, cost: null };
  if (!summary.retries.includes(row)) summary.retries.push(row);
  row.runs++;
  row.workerMs += Date.parse(job.endedAt) - Date.parse(job.startedAt);
  for (const agent of job.agents) row.cost = (row.cost ?? 0) + agent.costUsd;
}
function readPreviousOutcome(jobs: Job[], id: string): string { return jobs.find((job) => job.id === id)?.outcome ?? 'unknown'; }
function retainRecord(line: LedgerLine): boolean {
  if (line.kind === 'control') return false;
  return line.kind !== 'observation' || line.data.type === 'scheduler';
}
type SchedulerPoint = Observation & { data: SchedulerData };
function addWaitInterval(summary: Summary, point: SchedulerPoint, duration: number): void {
  if (point.data.report === null) return;
  summary.waitingMs ??= 0;
  const waiting = point.data.report.decisions.filter((decision) => decision.reasons.length && !decision.reasons.includes('issue-running'));
  const issues = new Set<string>();
  for (const decision of waiting) {
    const key = `${decision.stage}:${decision.issue}`;
    if (issues.has(key)) continue;
    issues.add(key);
    addStageWait(summary, decision.stage, duration);
  }
}
function addStageWait(summary: Summary, stage: string, duration: number): void {
  const row = summary.waitingStages.find((item) => item.stage === stage) ?? { stage, workerMs: 0 };
  if (!summary.waitingStages.includes(row)) summary.waitingStages.push(row);
  row.workerMs += duration;
  summary.waitingMs = (summary.waitingMs ?? 0) + duration;
}
function addWaiting(summary: Summary, records: LedgerLine[], now: Date, days: number, budgetMs: number): void {
  const points = records.filter((line): line is SchedulerPoint => line.kind === 'observation' && line.data.type === 'scheduler');
  const start = now.getTime() - days * DAY_MS;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const at = Date.parse(point.at);
    const end = index + 1 < points.length ? Date.parse(points[index + 1].at) : now.getTime();
    if (end < start) continue;
    if (end - at > budgetMs) summary.waitingGaps++;
    const duration = Math.max(0, Math.min(end, at + budgetMs, now.getTime()) - Math.max(at, start));
    addWaitInterval(summary, point, duration);
  }
}

function parseHistoryRecord(text: string): LedgerLine {
  const line = JSON.parse(text) as LedgerLine;
  if (!['job', 'route', 'post', 'observation', 'control', 'card'].includes(line.kind)) throw new Error('Invalid ledger line');
  if (!Number.isFinite(Date.parse(lineTime(line)))) throw new Error('Invalid ledger timestamp');
  return line;
}

export class DashboardHistory {
  private offset = 0;
  private remainder = '';
  private records: LedgerLine[] = [];
  private cards: CardLine[] = [];
  private first: string | null = null;
  constructor(private readonly home: string, private readonly tickIntervalMs: number) {}
  private consumeLine(text: string, now: Date): void {
    if (!text.trim()) return;
    const line = parseHistoryRecord(text);
    const at = lineTime(line);
    this.first ??= at;
    if (line.kind === 'card') return this.keepCard(line, now);
    if (!retainRecord(line)) return;
    if (Date.parse(at) >= now.getTime() - 30 * DAY_MS) this.records.push(line);
  }
  private keepCard(line: CardLine, now: Date): void {
    if (Date.parse(line.at) >= now.getTime() - CARD_DAYS * DAY_MS) this.cards.push(line);
  }
  private consumeChunk(chunk: string, now: Date): void {
    const parts = (this.remainder + chunk).split('\n');
    this.remainder = parts.pop()!;
    for (const part of parts) this.consumeLine(part, now);
  }
  async refresh(now: Date): Promise<void> {
    const path = join(this.home, 'ledger.jsonl');
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size < this.offset) { this.offset = 0; this.remainder = ''; this.records = []; this.cards = []; this.first = null; }
    if (size > this.offset) {
      const stream = createReadStream(path, { start: this.offset, end: size - 1, encoding: 'utf8' });
      for await (const chunk of stream) this.consumeChunk(chunk, now);
      this.offset = size;
    }
    this.records = this.records.filter((line) => Date.parse(lineTime(line)) >= now.getTime() - 30 * DAY_MS);
    this.cards = this.cards.filter((line) => Date.parse(line.at) >= now.getTime() - CARD_DAYS * DAY_MS);
  }
  summarize(now: Date, days: number): Summary {
    const summary = createSummary(days, this.first);
    const totals: Totals = { stages: new Map(), issues: new Map(), models: new Map(), stageModels: new Map(), buckets: new Map() };
    const jobs = reconcileJobs(this.records);
    for (const job of jobs) {
      if (Date.parse(job.endedAt) < now.getTime() - days * DAY_MS) continue;
      addJob(summary, totals, job);
      addRetry(summary, jobs, job);
    }
    addWaiting(summary, this.records, now, days, this.tickIntervalMs * 3);
    summary.delivery = summarizeDelivery(this.cards, jobs, now, days);
    summary.stages = [...totals.stages.values()];
    summary.issues = [...totals.issues.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
    summary.models = [...totals.models.values()];
    summary.stageModels = [...totals.stageModels.values()];
    summary.buckets = [...totals.buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
    summary.activity.sort((a, b) => b.at.localeCompare(a.at));
    return summary;
  }
  readPosts(now: Date, channel: string): { id: number; text: string; at: string }[] {
    return this.records.filter((line): line is Extract<LedgerLine, { kind: 'post' }> => line.kind === 'post' && line.channel === channel && Date.parse(line.at) >= now.getTime() - 30 * DAY_MS)
      .sort((a, b) => b.at.localeCompare(a.at)).map((line) => ({ id: line.id, text: line.text, at: line.at }));
  }
}
