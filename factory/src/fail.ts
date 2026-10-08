import { UsageLimitError } from './pause';
import { updateState } from './state';
import { STUCK_LABEL, type Ctx, type FactoryState, type JobStage, type Stage } from './types';

const ANSI = new RegExp(String.raw`\u001b\[[0-9;]*[A-Za-z]`, 'g');
const FAILURE_LINE = /FAIL|Error|error:|failed|×/;
const SUMMARY_LINES = 6;
const SUMMARY_CHARS = 800;
// Hermes handles a failure within minutes. A day keeps it in view through an outage of Hermes, and the logs keep it after that.
const FAILURE_KEEP_MS = 24 * 3_600_000;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

// The few lines of an error that say what broke. Tool output is long and colored, and the full text stays in the log.
export function summarizeError(message: string): string {
  const lines = stripAnsi(message).split('\n').map((line) => line.trim()).filter(Boolean);
  const failures = lines.filter((line) => FAILURE_LINE.test(line));
  const picked = (failures.length ? failures : lines.slice(-SUMMARY_LINES)).slice(0, SUMMARY_LINES);
  return picked.join('\n').slice(0, SUMMARY_CHARS);
}

// The issue a failed job labels. Card stages, approve, candidate, ship and remove name theirs in the job.
// The cut names the tracking issue once it exists, and a change has none.
export function failureIssue(stage: JobStage, issue: number | null, state: FactoryState): number | null {
  if (stage === 'change') return null;
  if (stage === 'release') return state.release?.issue ?? null;
  return issue;
}

// A failed stage stops its card. Nothing retries until a human or Hermes removes the label.
// A usage-limit failure already paused the factory, so its card takes no label and runs again after the pause.
// The factory posts nothing. It records the failure first, so Hermes's incident watch sees it even when GitHub broke the stage and the label.
export async function reportFailure(ctx: Ctx, stage: Stage, issue: number | null, error: unknown, log: string | null): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  ctx.log(stage, issue, `failed: ${message}`);
  const failure = { stage, issue, error: summarizeError(message), log, at: ctx.now().toISOString() };
  updateState(ctx.statePath, (state) => ({ ...state, failures: [...state.failures, failure] }));
  if (issue !== null && !(error instanceof UsageLimitError)) await ctx.github.addLabel(issue, STUCK_LABEL);
}

export function pruneFailures(now: Date): (state: FactoryState) => FactoryState {
  return (state) => ({ ...state, failures: state.failures.filter((failure) => now.getTime() - new Date(failure.at).getTime() < FAILURE_KEEP_MS) });
}
