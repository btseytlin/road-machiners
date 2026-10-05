import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readShown, type Evidence } from './evidence';
import { OUT_DIR } from './types';
import { readVisualReview } from './visual-review';

export type Approval = { description: string; howToTry: string };

export function readApproval(home: string): Approval {
  const raw = readOutput(home, 'approval.json');
  if (raw === null) throw new Error('The testing stage wrote no .factory/approval.json');
  return parseApproval(JSON.parse(raw));
}

function parseApproval(data: unknown): Approval {
  const { description, howToTry } = (data ?? {}) as Record<string, unknown>;
  if (typeof description !== 'string' || typeof howToTry !== 'string') throw new Error('.factory/approval.json needs string fields description and howToTry');
  return { description, howToTry };
}

function readOutput(home: string, name: string): string | null {
  const path = join(home, OUT_DIR, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// The rounds that leave evidence for a post. `test` also leaves the visual review. `patch` leaves evidence with no review.
export type CloneRound = 'test' | 'patch';
export const CLONE_ROUNDS: readonly CloneRound[] = ['test', 'patch'];

// What the factory checks after the stage and a clone cannot answer alone.
export const HOST_ONLY_CHECKS = [
  'the guard on the pushed diff: factory paths and a SAVE_MAJOR bump',
  'the merge of the base branch into the work branch',
  'the fresh-clone tests, typecheck, playtest and build',
] as const;

export type CloneReport = { failures: string[]; notes: string[] };

// Runs every check that reads only the clone's files and git state, the same functions the factory calls after the stage.
// It keeps going after a failure, so one run lists them all. A visual review that sends the card back is a valid outcome, so it is a note.
// Missing or broken evidence does not stop the card, but the post then drops the images, so the check reports it for the agent to fix.
export function checkClone(home: string, head: string, round: CloneRound): CloneReport {
  const report: CloneReport = { failures: [], notes: [] };
  attempt(report.failures, () => readApproval(home));
  const shown = readShown(home, head);
  if (shown.problem !== null) report.failures.push(`${shown.problem} The post drops the images it cannot show.`);
  if (round === 'test') checkReview(home, head, shown.evidence, report);
  return report;
}

// The factory reads the review against the same evidence the post shows.
function checkReview(home: string, head: string, evidence: Evidence | null, report: CloneReport): void {
  if (evidence === null) {
    report.notes.push('The visual review is not checked, since there is no screenshot.');
    return;
  }
  const review = attempt(report.failures, () => readVisualReview(home, head, evidence));
  if (review?.visual === true && review.sendBack !== null) report.notes.push(`The visual review sends the card back to ${review.sendBack.to}. That is a valid outcome.`);
}

// A failed check goes into `failures`, and the run goes on.
function attempt<T>(failures: string[], check: () => T): T | null {
  try {
    return check();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}
