import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lineTime, type AgentUsage, type LedgerLine, type ModelUsage } from '../ledger';
import type { JobStage } from '../types';

const DAY_MS = 86_400_000;
type Job = Extract<LedgerLine, { kind: 'job' }>;
type Counts = { input: number; output: number; cacheRead: number; cacheWrite: number };
type Summary = {
  days: number; since: string | null; completed: number; failed: number; timeouts: number; workerMs: number;
  cost: number | null; tokens: Counts | null; missingUsage: number; collectionFaults: number;
  models: ModelUsage[]; stages: { stage: string; workerMs: number; cost: number | null }[];
  issues: { issue: number; workerMs: number; cost: number | null }[];
  daily: { day: string; cost: number; tokens: Counts }[];
  activity: { stage: JobStage; issue: number | null; outcome: string; at: string }[];
};
type StageRow = Summary['stages'][number];
type IssueRow = Summary['issues'][number];
type DailyRow = Summary['daily'][number];
type Totals = { stages: Map<string, StageRow>; issues: Map<number, IssueRow>; models: Map<string, ModelUsage>; daily: Map<string, DailyRow> };
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
  return { days, since, completed: 0, failed: 0, timeouts: 0, workerMs: 0, cost: null, tokens: null, missingUsage: 0, collectionFaults: 0, models: [], stages: [], issues: [], daily: [], activity: [] };
}
function addCost(summary: Summary, stage: StageRow, issue: IssueRow | null, cost: number): void {
  summary.cost = (summary.cost ?? 0) + cost;
  stage.cost = (stage.cost ?? 0) + cost;
  if (issue) issue.cost = (issue.cost ?? 0) + cost;
}
function addAgent(summary: Summary, totals: Totals, job: Job, agent: AgentUsage, stage: StageRow, issue: IssueRow | null): void {
  addCost(summary, stage, issue, agent.costUsd);
  if (!agent.modelUsage?.length) { summary.missingUsage++; return; }
  addMeasuredUsage(summary, totals, job.endedAt.slice(0, 10), agent.costUsd, agent.modelUsage);
}
function addMeasuredUsage(summary: Summary, totals: Totals, day: string, cost: number, measurements: ModelUsage[]): void {
  summary.tokens ??= createCounts();
  const daily = totals.daily.get(day) ?? { day, cost: 0, tokens: createCounts() };
  daily.cost += cost;
  totals.daily.set(day, daily);
  for (const usage of measurements) addModel(summary.tokens, totals.models, daily.tokens, usage);
}
function addModel(tokens: Counts, models: Map<string, ModelUsage>, daily: Counts, usage: ModelUsage): void {
  addCounts(tokens, usage);
  addCounts(daily, usage);
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
  summary.failed += Number(job.outcome !== 'done');
  summary.timeouts += Number(job.outcome === 'timeout');
  const publicIssue = getPublicIssue(job);
  summary.activity.push({ stage: job.stage, issue: publicIssue, outcome: job.outcome === 'done' ? 'finished' : job.outcome, at: job.endedAt });
  const { stage, issue } = getJobRows(totals, job, publicIssue, duration);
  for (const agent of job.agents) addAgent(summary, totals, job, agent, stage, issue);
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

export class DashboardHistory {
  private offset = 0;
  private remainder = '';
  private records: LedgerLine[] = [];
  private first: string | null = null;
  constructor(private readonly home: string) {}
  private consumeLine(text: string, now: Date): void {
    if (!text.trim()) return;
    const line = JSON.parse(text) as LedgerLine;
    if (!['job', 'route', 'post'].includes(line.kind)) throw new Error('Invalid ledger line');
    const at = lineTime(line);
    if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid ledger timestamp');
    this.first ??= at;
    if (Date.parse(at) >= now.getTime() - 30 * DAY_MS) this.records.push(line);
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
    if (size < this.offset) { this.offset = 0; this.remainder = ''; this.records = []; this.first = null; }
    if (size > this.offset) {
      const stream = createReadStream(path, { start: this.offset, end: size - 1, encoding: 'utf8' });
      for await (const chunk of stream) this.consumeChunk(chunk, now);
      this.offset = size;
    }
    this.records = this.records.filter((line) => Date.parse(lineTime(line)) >= now.getTime() - 30 * DAY_MS);
  }
  summarize(now: Date, days: number): Summary {
    const summary = createSummary(days, this.first);
    const totals: Totals = { stages: new Map(), issues: new Map(), models: new Map(), daily: new Map() };
    for (const line of this.records) {
      if (line.kind === 'job' && Date.parse(line.endedAt) >= now.getTime() - days * DAY_MS) addJob(summary, totals, line);
    }
    summary.stages = [...totals.stages.values()];
    summary.issues = [...totals.issues.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
    summary.models = [...totals.models.values()];
    summary.daily = [...totals.daily.values()].sort((a, b) => a.day.localeCompare(b.day));
    summary.activity.sort((a, b) => b.at.localeCompare(a.at));
    return summary;
  }
  readPosts(now: Date): { id: number; text: string; at: string }[] {
    return this.records.filter((line): line is Extract<LedgerLine, { kind: 'post' }> => line.kind === 'post' && Date.parse(line.at) >= now.getTime() - 30 * DAY_MS)
      .sort((a, b) => b.at.localeCompare(a.at)).map((line) => ({ id: line.id, text: line.text, at: line.at }));
  }
}
