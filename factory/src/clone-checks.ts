import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEvidence, type Evidence } from './evidence';
import { OUT_DIR } from './types';
import { readVisualReview } from './visual-review';

export type Approval = { description: string; howToTry: string };

// A committee waiver of the screenshot is the only case that accepts an approval with no image.
export function readApproval(home: string, waived = false): Approval {
  const raw = readOutput(home, 'approval.json');
  if (raw === null) throw new Error('The testing stage wrote no .factory/approval.json');
  if (!waived && readOutput(home, 'screenshot.png') === null) throw new Error('The testing stage wrote no .factory/screenshot.png');
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

// The rounds that leave evidence for a post. `test` also leaves the visual review. `patch` leaves evidence with no review. `waived` leaves an approval with no images.
export type CloneRound = 'test' | 'patch' | 'waived';
export const CLONE_ROUNDS: readonly CloneRound[] = ['test', 'patch', 'waived'];

// What the factory checks after the stage and a clone cannot answer alone.
export const HOST_ONLY_CHECKS = [
  'whether the committee waived the screenshot, which the state file holds',
  'the guard on the pushed diff: factory paths and a SAVE_MAJOR bump',
  'the merge of the base branch into the work branch',
  'the fresh-clone tests, typecheck, playtest and build',
] as const;

export type CloneReport = { failures: string[]; notes: string[] };

// Runs every check that reads only the clone's files and git state, the same functions the factory calls after the stage.
// It keeps going after a failure, so one run lists them all. A visual review that sends the card back is a valid outcome, so it is a note.
export function checkClone(home: string, head: string, round: CloneRound): CloneReport {
  const report: CloneReport = { failures: [], notes: [] };
  attempt(report.failures, () => readApproval(home, round === 'waived'));
  if (round !== 'waived') checkEvidence(home, head, round, report);
  return report;
}

function checkEvidence(home: string, head: string, round: CloneRound, report: CloneReport): void {
  const evidence = attempt(report.failures, () => readEvidence(home, head));
  if (round === 'test') checkReview(home, head, evidence, report);
}

// The review reads the shown images from the manifest. A manifest from an older commit still names them, so the review gets checked too.
function checkReview(home: string, head: string, evidence: Evidence | null, report: CloneReport): void {
  const shown = evidence ?? attempt([], () => readEvidence(home, null));
  if (shown === null) {
    report.notes.push('The visual review is not checked, since it needs readable evidence.');
    return;
  }
  const review = attempt(report.failures, () => readVisualReview(home, head, shown));
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
