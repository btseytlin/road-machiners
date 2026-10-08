import { isFailedOutcome, lineTime, type AgentUsage, type LedgerLine } from './ledger';
import { QUEUE_OF, type JobStage, type Queue, type Route } from './types';

// Every number the weekly waste review shows. The agent explains them and never computes its own.
export type WasteNumbers = {
  from: string;
  to: string;
  jobs: number;
  costUsd: number;
  stages: StageNumbers[]; // most expensive first
  models: { model: string; runs: number; costUsd: number }[]; // most expensive first
  waits: QueueWait[]; // longest total first
  reruns: { issue: number; stage: JobStage; runs: number }[]; // most runs first
  routes: Record<Route, number>;
  issues: { issue: number; costUsd: number; jobs: number; wallMinutes: number }[]; // the five most expensive
};
export type StageNumbers = { stage: JobStage; runs: number; failed: number; wallMinutes: number; agentMinutes: number; costUsd: number };
// A handoff is the gap between a job that finished and the next job on the same issue: the time the card waited for a free worker.
export type QueueWait = { queue: Queue; handoffs: number; medianMinutes: number; maxMinutes: number; totalMinutes: number; worstIssue: number };

type JobLine = Extract<LedgerLine, { kind: 'job' }>;
type RouteLine = Extract<LedgerLine, { kind: 'route' }>;

const TOP_ISSUES = 5;
const MINUTE_MS = 60_000;

const minutesBetween = (from: string, to: string): number => Math.round((new Date(to).getTime() - new Date(from).getTime()) / MINUTE_MS);
const cost = (agents: AgentUsage[]): number => agents.reduce((sum, agent) => sum + agent.costUsd, 0);
const byCost = <T extends { costUsd: number }>(a: T, b: T): number => b.costUsd - a.costUsd;

// The lines that ended in [from, to).
export function wasteNumbers(lines: LedgerLine[], from: Date, to: Date): WasteNumbers {
  const inside = lines.filter((line) => new Date(lineTime(line)).getTime() >= from.getTime() && new Date(lineTime(line)).getTime() < to.getTime());
  const jobs = inside.filter((line): line is JobLine => line.kind === 'job');
  const routes = inside.filter((line): line is RouteLine => line.kind === 'route');
  return {
    from: from.toISOString(), to: to.toISOString(), jobs: jobs.length, costUsd: cost(jobs.flatMap((line) => line.agents)),
    stages: stageNumbers(jobs), models: modelNumbers(jobs), waits: queueWaits(jobs), reruns: reruns(jobs), routes: routeCounts(routes), issues: issueNumbers(jobs),
  };
}

function group<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

function stageNumbers(jobs: JobLine[]): StageNumbers[] {
  return [...group(jobs, (line) => line.stage)].map(([stage, lines]) => ({
    stage, runs: lines.length, failed: lines.filter((line) => isFailedOutcome(line.outcome)).length,
    wallMinutes: lines.reduce((sum, line) => sum + minutesBetween(line.startedAt, line.endedAt), 0),
    agentMinutes: Math.round(lines.flatMap((line) => line.agents).reduce((sum, agent) => sum + agent.minutes, 0)),
    costUsd: cost(lines.flatMap((line) => line.agents)),
  })).sort(byCost);
}

function modelNumbers(jobs: JobLine[]): WasteNumbers['models'] {
  return [...group(jobs.flatMap((line) => line.agents), (agent) => agent.model)].map(([model, runs]) => ({ model, runs: runs.length, costUsd: cost(runs) })).sort(byCost);
}

// After checks the card waits for the committee, not for a worker, so that gap is no handoff. A failed job hands off to nobody.
function handoffs(jobs: JobLine[]): { queue: Queue; issue: number; minutes: number }[] {
  const card = jobs.filter((line): line is JobLine & { issue: number } => line.issue !== null && QUEUE_OF[line.stage] !== 'branch');
  return [...group(card, (line) => line.issue)].flatMap(([issue, lines]) => {
    const ordered = [...lines].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return ordered.slice(1).flatMap((line, index) => {
      const before = ordered[index];
      if (before.outcome !== 'done' || before.stage === 'checks') return [];
      return [{ queue: QUEUE_OF[line.stage], issue, minutes: minutesBetween(before.endedAt, line.startedAt) }];
    });
  });
}

function queueWaits(jobs: JobLine[]): QueueWait[] {
  return [...group(handoffs(jobs), (handoff) => handoff.queue)].map(([queue, list]) => {
    const sorted = [...list].sort((a, b) => a.minutes - b.minutes);
    const worst = sorted[sorted.length - 1];
    const totalMinutes = sorted.reduce((sum, handoff) => sum + handoff.minutes, 0);
    return { queue, handoffs: sorted.length, medianMinutes: sorted[Math.floor(sorted.length / 2)].minutes, maxMinutes: worst.minutes, totalMinutes, worstIssue: worst.issue };
  }).sort((a, b) => b.totalMinutes - a.totalMinutes);
}

function reruns(jobs: JobLine[]): WasteNumbers['reruns'] {
  const card = jobs.filter((line): line is JobLine & { issue: number } => line.issue !== null && QUEUE_OF[line.stage] !== 'branch');
  return [...group(card, (line) => `${line.issue} ${line.stage}`)].filter(([, lines]) => lines.length > 1)
    .map(([, lines]) => ({ issue: lines[0].issue, stage: lines[0].stage, runs: lines.length })).sort((a, b) => b.runs - a.runs);
}

function routeCounts(routes: RouteLine[]): Record<Route, number> {
  const counts: Record<Route, number> = { answer: 0, patch: 0, redesign: 0 };
  for (const line of routes) counts[line.route] += 1;
  return counts;
}

function issueNumbers(jobs: JobLine[]): WasteNumbers['issues'] {
  const card = jobs.filter((line): line is JobLine & { issue: number } => line.issue !== null && QUEUE_OF[line.stage] !== 'branch');
  return [...group(card, (line) => line.issue)].map(([issue, lines]) => ({
    issue, costUsd: cost(lines.flatMap((line) => line.agents)), jobs: lines.length,
    wallMinutes: lines.reduce((sum, line) => sum + minutesBetween(line.startedAt, line.endedAt), 0),
  })).sort(byCost).slice(0, TOP_ISSUES);
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

export function formatNumbers(n: WasteNumbers): string {
  const head = `Factory numbers for ${n.from.slice(0, 10)} to ${n.to.slice(0, 10)}.`;
  if (n.jobs === 0) return `${head}\n\nNo jobs ended in this window.`;
  return [
    head,
    `${n.jobs} jobs, ${usd(n.costUsd)} of agent cost.`,
    section('Stages, most expensive first', n.stages.map((s) => `- ${s.stage}: ${s.runs} runs, ${s.failed} failed, ${s.wallMinutes} min of job time, ${s.agentMinutes} min of agent time, ${usd(s.costUsd)}`)),
    section('Models', n.models.map((m) => `- ${m.model}: ${m.runs} agent runs, ${usd(m.costUsd)}`)),
    section('Wait for a free worker after the previous job, per queue', n.waits.map((w) => `- ${w.queue}: ${w.handoffs} handoffs, median ${w.medianMinutes} min, max ${w.maxMinutes} min (#${w.worstIssue}), total ${w.totalMinutes} min`)),
    section('Stages that ran more than once on one issue', n.reruns.map((r) => `- #${r.issue} ${r.stage}: ${r.runs} runs`)),
    section('Routed approval replies', Object.entries(n.routes).map(([route, count]) => `- ${route}: ${count}`)),
    section('Most expensive issues', n.issues.map((i) => `- #${i.issue}: ${usd(i.costUsd)}, ${i.jobs} jobs, ${i.wallMinutes} min`)),
  ].join('\n\n');
}

function section(title: string, lines: string[]): string {
  return `${title}:\n${lines.length > 0 ? lines.join('\n') : '- none'}`;
}
