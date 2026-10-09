import { CommitteeDecisionError } from './diff-guard';
import { UsageLimitError } from './pause';
import { BudgetError } from './stages/checkpoint';
import { updateState } from './state';
import { STUCK_LABEL, type Ctx, type FactoryState, type Failure, type JobStage, type Stage } from './types';

const ANSI = new RegExp(String.raw`\u001b\[[0-9;]*[A-Za-z]`, 'g');
const FAILURE_LINE = /FAIL|Error|error:|failed|×/;
const SUMMARY_LINES = 6;
const SUMMARY_CHARS = 800;
const FAILURE_KEEP_MS = 24 * 3_600_000;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function summarizeError(message: string): string {
  const lines = stripAnsi(message).split('\n').map((line) => line.trim()).filter(Boolean);
  const failures = lines.filter((line) => FAILURE_LINE.test(line));
  const picked = (failures.length ? failures : lines.slice(-SUMMARY_LINES)).slice(0, SUMMARY_LINES);
  return picked.join('\n').slice(0, SUMMARY_CHARS);
}

export function failureIssue(stage: JobStage, issue: number | null, state: FactoryState): number | null {
  if (stage === 'change') return null;
  if (stage === 'release') return state.release?.issue ?? null;
  return issue;
}

export async function reportFailure(ctx: Ctx, stage: Stage, issue: number | null, error: unknown, log: string | null, batch: number[]): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  ctx.log(stage, issue, `failed: ${message}`);
  const failure: Failure = { stage, issue, error: summarizeError(message), log, at: ctx.now().toISOString(), ...causeOf(error, batch) };
  updateState(ctx.statePath, (state) => ({ ...state, failures: [...state.failures, failure] }));
  if (issue !== null && !(error instanceof UsageLimitError)) await ctx.github.addLabel(issue, STUCK_LABEL);
}

function causeOf(error: unknown, batch: number[]): Pick<Failure, 'batch' | 'decision'> {
  const decision = error instanceof BudgetError || error instanceof CommitteeDecisionError;
  return { ...(batch.length > 0 ? { batch } : {}), ...(decision ? { decision } : {}) };
}

export function pruneFailures(now: Date): (state: FactoryState) => FactoryState {
  return (state) => ({ ...state, failures: state.failures.filter((failure) => now.getTime() - new Date(failure.at).getTime() < FAILURE_KEEP_MS) });
}
