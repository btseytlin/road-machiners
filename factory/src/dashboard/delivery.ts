import type { CardStep } from '../card-events';
import type { LedgerLine } from '../ledger';
import type { Column, JobStage } from '../types';

// Delivery numbers come only from card lines, which the factory writes at each move. Job lines give worker time, not calendar time,
// and the board shows only where a card is now, so neither can say when a card entered a column.
type CardLine = Extract<LedgerLine, { kind: 'card' }>;
type JobLine = Extract<LedgerLine, { kind: 'job' }>;
// Testing runs the preview before the committee plays the card, Hardening runs after it approves, and Merging waits for the merge queue.
export type DeliveryStage = 'triage' | 'design' | 'implementation' | 'preview' | 'approval' | 'harden' | 'merge';
type Visit = { stage: DeliveryStage; start: number; end: number | null };
type Stat = { count: number; meanMs: number | null; medianMs: number | null };
type Gate = 'triage' | 'design' | 'committee';

export type DeliverySummary = {
  since: string; issues: number; excluded: number; legacy: number;
  lead: { open: number; openMeanMs: number | null; missingStart: number };
  stages: (Stat & { stage: DeliveryStage; open: number; openMeanMs: number | null })[];
  loops: { step: CardStep; events: number; issues: number }[]; looped: number;
  retries: { stage: JobStage; runs: number; issues: number }[];
  rejections: { gate: Gate; decided: number; rejected: number }[];
};

const DAY_MS = 86_400_000;
const STAGES: DeliveryStage[] = ['triage', 'design', 'implementation', 'preview', 'approval', 'harden', 'merge'];
// Every step has a kind, so a new step does not compile until it is placed. A loop sends a card back to an earlier column.
// A failed job is no loop: it moves nothing and shows under retries.
const STEP_KINDS: Record<CardStep, 'path' | 'loop' | 'end' | 'other'> = {
  entered: 'path', accepted: 'path', planned: 'path', built: 'path', patched: 'path', posted: 'path', approved: 'path', hardened: 'path', merged: 'path',
  questions: 'loop', rebuild: 'loop', 'plan-wrong': 'loop', 'review-failed': 'loop', patch: 'loop', redesign: 'loop', 'patch-replan': 'loop', conflict: 'loop', removed: 'loop', unbundled: 'loop',
  'triage-wont-do': 'end', 'design-wont-do': 'end', bundled: 'end', denied: 'end', dropped: 'end',
  moved: 'other', 'merge-ordered': 'other', shipped: 'other', reported: 'other',
};
export const LOOP_STEPS = (Object.keys(STEP_KINDS) as CardStep[]).filter((step) => STEP_KINDS[step] === 'loop');
// A merge job has no issue, so it has no retries per card.
const RETRY_STAGES: JobStage[] = ['triage', 'design', 'implement', 'verify', 'harden', 'checks'];
// Each gate's passing and refusing steps. A pending card, a failed job, a patch, a redesign, a removal or an operator's drop decides nothing.
const GATES: Record<Gate, { pass: CardStep[]; reject: CardStep[] }> = {
  triage: { pass: ['accepted'], reject: ['triage-wont-do'] },
  design: { pass: ['planned'], reject: ['design-wont-do'] },
  committee: { pass: ['approved', 'merged'], reject: ['denied'] },
};
// The column names the stage, and the step tells the two passes through Approval apart. An operator's move into Testing counts as a preview.
// Older lines: approved cards hardened in Testing before the Hardening column, and a hardened card waited in Approval for its merge before the Merging column.
const COLUMN_STAGE: Record<Column, (step: CardStep) => DeliveryStage | null> = {
  Triage: () => 'triage', Design: () => 'design', Implementation: () => 'implementation',
  Testing: (step) => (step === 'approved' || step === 'conflict' ? 'harden' : 'preview'),
  Approval: (step) => (step === 'hardened' || step === 'merge-ordered' ? 'merge' : 'approval'),
  Hardening: () => 'harden',
  Merging: () => 'merge',
  Done: () => null,
};
const stageOf = (line: CardLine): DeliveryStage | null => COLUMN_STAGE[line.to](line.step);

// A resumed job or a repeated tick writes the same move again, so a line equal to the issue's previous line is a copy.
function dropCopies(lines: CardLine[]): CardLine[] {
  return lines.filter((line, index) => index === 0 || line.step !== lines[index - 1].step || line.to !== lines[index - 1].to);
}

// Lines in time order per issue. Lines with the same time keep the ledger's order.
function groupByIssue(lines: CardLine[]): Map<number, CardLine[]> {
  const issues = new Map<number, CardLine[]>();
  const sorted = [...lines].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const line of sorted) issues.set(line.issue, [...(issues.get(line.issue) ?? []), line]);
  for (const [issue, events] of issues) issues.set(issue, dropCopies(events));
  return issues;
}

// A visit starts when the card enters a column and ends when it enters another. A line into the same column changes no stage.
function readVisits(events: CardLine[]): Visit[] {
  const visits: Visit[] = [];
  let column: Column | null = null;
  for (const line of events) {
    if (line.to === column) continue;
    column = line.to;
    const at = Date.parse(line.at);
    const last = visits.at(-1);
    if (last && last.end === null) last.end = at;
    const stage = stageOf(line);
    if (stage !== null) visits.push({ stage, start: at, end: null });
  }
  return visits;
}

function measure(values: number[]): Stat {
  if (!values.length) return { count: 0, meanMs: null, medianMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length, medianMs };
}
function mean(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

type Window = { start: number; end: number };
const inside = (window: Window, at: number): boolean => at > window.start && at <= window.end;

function summarizeStages(issues: CardLine[][], window: Window): DeliverySummary['stages'] {
  const visits = issues.flatMap(readVisits);
  return STAGES.map((stage) => {
    const own = visits.filter((visit) => visit.stage === stage);
    const done = own.filter((visit) => visit.end !== null && inside(window, visit.end)).map((visit) => visit.end! - visit.start);
    const open = own.filter((visit) => visit.end === null).map((visit) => window.end - visit.start);
    return { stage, ...measure(done), open: open.length, openMeanMs: mean(open) };
  });
}

// A card in flight was accepted by triage and has not merged into dev, the merge that adds release-candidate. It is open since its first acceptance.
// A card closed after acceptance is not open. A merge with no recorded acceptance has no start and is counted apart.
type Lead = { start: number | null; end: number | null; closed: boolean };
function readLead(events: CardLine[]): Lead {
  const accepted = events.find((line) => line.step === 'accepted');
  const start = accepted ? Date.parse(accepted.at) : null;
  const merged = events.find((line) => line.step === 'merged' && (start === null || Date.parse(line.at) >= start));
  return { start, end: merged ? Date.parse(merged.at) : null, closed: events.at(-1)?.to === 'Done' };
}
function summarizeLead(issues: CardLine[][], window: Window): DeliverySummary['lead'] {
  const leads = issues.map(readLead);
  const open = leads.filter((lead) => lead.start !== null && lead.end === null && !lead.closed).map((lead) => window.end - lead.start!);
  const missingStart = leads.filter((lead) => lead.start === null && lead.end !== null && inside(window, lead.end)).length;
  return { open: open.length, openMeanMs: mean(open), missingStart };
}

function summarizeLoops(recent: CardLine[][]): Pick<DeliverySummary, 'loops' | 'looped'> {
  const lines = recent.flat();
  const loops = LOOP_STEPS.map((step) => {
    const own = lines.filter((line) => line.step === step);
    return { step, events: own.length, issues: new Set(own.map((line) => line.issue)).size };
  });
  const looped = recent.filter((events) => events.some((line) => LOOP_STEPS.includes(line.step))).length;
  return { loops, looped };
}

// Each issue counts once per gate, by its latest decision in the window.
function summarizeGate(recent: CardLine[][], gate: Gate): DeliverySummary['rejections'][number] {
  const { pass, reject } = GATES[gate];
  const latest = recent.map((events) => events.filter((line) => pass.includes(line.step) || reject.includes(line.step)).at(-1)).filter((line) => line !== undefined);
  return { gate, decided: latest.length, rejected: latest.filter((line) => reject.includes(line.step)).length };
}

// Runs of a card stage that failed, died or timed out on any issue not known to run another path, which the next tick runs again in the same column. A job a control order stopped is no retry.
function summarizeRetries(jobs: JobLine[], excluded: Set<number>, window: Window): DeliverySummary['retries'] {
  const failed = jobs.filter((job) => job.issue !== null && !excluded.has(job.issue) && RETRY_STAGES.includes(job.stage) && !['done', 'stopped', 'held'].includes(job.outcome) && inside(window, Date.parse(job.endedAt)));
  return RETRY_STAGES.map((stage) => {
    const own = failed.filter((job) => job.stage === stage);
    return { stage, runs: own.length, issues: new Set(own.map((job) => job.issue)).size };
  });
}

// Hotfixes, release tasks, the release tracking card and private tasks run other paths, so any line that names a flow takes the issue out.
function isFeature(events: CardLine[]): boolean { return events.every((line) => line.flow === undefined); }

// Null when no card line exists yet, so the page shows the numbers as unrecorded rather than as zero.
export function summarizeDelivery(cards: CardLine[], jobs: JobLine[], now: Date, days: number): DeliverySummary | null {
  if (!cards.length) return null;
  const window = { start: now.getTime() - days * DAY_MS, end: now.getTime() };
  const all = [...groupByIssue(cards).values()];
  const features = all.filter(isFeature);
  const recent = features.map((events) => events.filter((line) => inside(window, Date.parse(line.at)))).filter((events) => events.length > 0);
  const since = cards.reduce((first, line) => (Date.parse(line.at) < Date.parse(first) ? line.at : first), cards[0].at);
  return {
    since, issues: recent.length,
    excluded: all.filter((events) => !isFeature(events) && events.some((line) => inside(window, Date.parse(line.at)))).length,
    legacy: features.filter((events) => events[0].step !== 'entered' && events.some((line) => inside(window, Date.parse(line.at)))).length,
    lead: summarizeLead(features, window), stages: summarizeStages(features, window), ...summarizeLoops(recent),
    retries: summarizeRetries(jobs, new Set(all.filter((events) => !isFeature(events)).map((events) => events[0].issue)), window),
    rejections: (['triage', 'design', 'committee'] as Gate[]).map((gate) => summarizeGate(recent, gate)),
  };
}
