import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { withLockSync } from './lock';
import type { FactoryState, Job, PlaytestState, ReleaseState } from './types';

export const EMPTY_STATE: FactoryState = { jobs: [], approvalPosts: {}, lastRelease: null, release: null, releasePost: null, pendingShip: null, pendingRemovals: [], pendingApprovals: {}, approvedResolving: {}, pendingChanges: [], pendingIncidents: [], bundles: {}, adhocReplies: {}, lastTickError: null, failures: [], builds: {}, jobStarts: [], cardStarts: {}, postCaptions: {}, devBuild: null, devFailed: null, devError: null, interrupted: [], postOnly: [], unroutedReplies: {}, textPosts: [], lastWasteReview: null, held: {} };

// A state update is a few file operations, so a writer that waits this long found a stuck lock.
const STATE_LOCK_MS = 30_000;

// Fields of the stages before one session ran each stage. `testPhase` maps an issue to its step, and only `post` lives on as `postOnly`.
type OldFields = { job?: Omit<Job, 'id'> | null; testPhase?: Record<string, string>; patching?: unknown; visualSendBacks?: unknown };
type SavedState = Partial<FactoryState> & OldFields;

export function readState(path: string): FactoryState {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE);
  const { job, testPhase, patching: _patching, visualSendBacks: _visualSendBacks, ...saved } = JSON.parse(readFileSync(path, 'utf8')) as SavedState;
  // A file from before parallel jobs holds one `job`. Its log name serves as its id.
  const jobs = (saved.jobs ?? (job ? [{ ...job, id: basename(job.log, '.log') }] : [])).map(renameTesting);
  // Fields an old file lacks take the empty value.
  const release = saved.release ? fillRelease(saved.release) : null;
  return { ...structuredClone(EMPTY_STATE), ...saved, jobs, release, postOnly: saved.postOnly ?? postPhases(testPhase) };
}

function postPhases(testPhase: Record<string, string> | undefined): number[] {
  return Object.entries(testPhase ?? {}).filter(([, phase]) => phase === 'post').map(([issue]) => Number(issue));
}

// The seed of a release is its cut day as YYYYMMDD, so each release plays a seed of its own and every run of it plays the same one.
export function newPlaytest(day: string): PlaytestState {
  return { seed: Number(day.replaceAll('-', '')), runs: 0, passed: null, blocked: null, notes: [] };
}

// A release cut before the playtest has no playtest yet and no candidate commit. Its post, if any, stays, and the next tick drops it, since it names no commit.
// A release cut before the factory recorded its tasks has none recorded, and the board alone holds its playtest.
function fillRelease(release: Partial<ReleaseState> & Pick<ReleaseState, 'day'>): ReleaseState {
  return { ...release, candidateSha: release.candidateSha ?? null, tasks: release.tasks ?? [], playtest: release.playtest ? dropStreak(release.playtest) : newPlaytest(release.day) } as ReleaseState;
}

// The playtest counted runs since the last pass before one job did all its plays. The count means nothing now.
function dropStreak(playtest: PlaytestState & { streak?: number }): PlaytestState {
  const { streak: _streak, ...rest } = playtest;
  return rest;
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
