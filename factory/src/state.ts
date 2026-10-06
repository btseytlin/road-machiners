import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { withLockSync } from './lock';
import type { FactoryState, Job } from './types';

export const EMPTY_STATE: FactoryState = {
  jobs: [],
  approvalPosts: {},
  lastRelease: null,
  release: null,
  pendingShip: null,
  pendingRemovals: [],
  pendingApprovals: {},
  approvedResolving: {},
  pendingChanges: [],
  pendingIncidents: [],
  bundles: {},
  adhocReplies: {},
  lastTickError: null,
  failures: [],
  builds: {},
  jobStarts: [],
  capNoticed: false,
  postCaptions: {},
  devBuild: null,
  devFailed: null,
  interrupted: [],
  testPhase: {},
  patching: {},
  unroutedReplies: {},
  visualSendBacks: {},
  lastWasteReview: null,
};

// A state update is a few file operations, so a writer that waits this long found a stuck lock.
const STATE_LOCK_MS = 30_000;

type SavedState = Partial<FactoryState> & { job?: Omit<Job, 'id'> | null };

export function readState(path: string): FactoryState {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE);
  const { job, ...saved } = JSON.parse(readFileSync(path, 'utf8')) as SavedState;
  // A file from before parallel jobs holds one `job`. Its log name serves as its id.
  const jobs = (saved.jobs ?? (job ? [{ ...job, id: basename(job.log, '.log') }] : [])).map(renameTesting);
  // Fields an old file lacks take the empty value.
  return { ...structuredClone(EMPTY_STATE), ...saved, jobs };
}

// Testing split into verify and checks. A testing job saved before the split ran the agent half first, so the tick checks and resumes it as verify.
function renameTesting(job: Job): Job {
  return (job.stage as string) === 'testing' ? { ...job, stage: 'verify' } : job;
}

// Writes a temp file and renames it, so a crash never leaves half a state file.
export function writeState(path: string, state: FactoryState): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, path);
}

// Jobs run in parallel processes, so a read and its write happen under one lock and no update is lost.
export function updateState(path: string, change: (state: FactoryState) => FactoryState): FactoryState {
  return withLockSync(join(dirname(path), 'state.lock'), STATE_LOCK_MS, () => {
    const next = change(readState(path));
    writeState(path, next);
    return next;
  });
}
