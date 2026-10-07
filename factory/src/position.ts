// The position model of a card. docs/state.md describes each position and the stores it spans.
import { RELEASE_LABEL, isCleanupTask, type Card, type FactoryState, type Hold, type Job, type JobStage, type ReleaseState } from './types';

export type Position = 'triage' | 'design' | 'implement' | 'patch' | 'verify' | 'fix' | 'checks' | 'post' | 'approval' | 'harden' | 'harden-fix' | 'resolve' | 'harden-checks' | 'done';
export const MOVE_TARGETS = ['triage', 'design', 'implement', 'verify', 'checks', 'approval', 'harden', 'done'] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];

// The job each position runs, as cardStage in tick.ts picks it. Done runs nothing.
const POSITION_STAGE: Record<Position, JobStage | null> = {
  triage: 'triage', design: 'design', implement: 'implement', patch: 'patch', verify: 'verify', fix: 'verify', checks: 'checks', post: 'checks', approval: 'approve',
  harden: 'harden', 'harden-fix': 'harden', resolve: 'harden', 'harden-checks': 'checks', done: null,
};
// Lists the jobs that belong to a card position. Release, change and incident jobs carry an issue too, but no position owns them.
export const CARD_JOBS: JobStage[] = ['triage', 'design', 'implement', 'adhoc', 'patch', 'verify', 'harden', 'checks'];

export function cardPosition(card: Card, state: FactoryState): Position {
  const key = String(card.issue);
  if (card.column === 'Testing') return testingPosition(state.testPhase[key]);
  if (card.column === 'Hardening') return hardeningPosition(state.testPhase[key]);
  if (card.column === 'Implementation') return key in state.patching ? 'patch' : 'implement';
  return { Triage: 'triage', Design: 'design', Approval: 'approval', Done: 'done' }[card.column] as Position;
}

function testingPosition(phase: string | undefined): Position {
  if (phase === 'fix' || phase === 'post') return phase;
  return phase === 'checks' || phase === 'checks-after-fix' ? 'checks' : 'verify';
}

function hardeningPosition(phase: string | undefined): Position {
  if (phase === 'fix') return 'harden-fix';
  if (phase === 'resolve' || phase === 'post') return phase;
  return phase === 'checks' || phase === 'checks-after-fix' ? 'harden-checks' : 'harden';
}

// The release tracking card waits in Approval for the whole release, and its post is release.postId, so no store can disagree about it.
export function cardDrift(card: Card, state: FactoryState): string[] {
  if (card.labels.includes(RELEASE_LABEL)) return [];
  return [...phaseDrift(card, state), ...hardeningDrift(card, state), ...approvalDrift(card, state), ...jobDrift(card, state), ...heldCardDrift(card, state)];
}

// The jobs that run on a card. A job owns its card mid-step, because a stage changes the column and the post before its job entry leaves the state.
export function runningJobs(card: Card, state: FactoryState): Job[] {
  return state.jobs.filter((job) => job.issue === card.issue);
}

function phaseDrift(card: Card, state: FactoryState): string[] {
  const key = String(card.issue);
  const lines: string[] = [];
  if (key in state.testPhase && card.column !== 'Testing' && card.column !== 'Hardening') lines.push(`#${card.issue} testPhase ${state.testPhase[key]} but column ${card.column}`);
  if (key in state.patching && card.column !== 'Implementation') lines.push(`#${card.issue} patching set but column ${card.column}`);
  return lines;
}

// An approved card hardens in Hardening. In Testing it would get a preview and merge with no hardening.
function hardeningDrift(card: Card, state: FactoryState): string[] {
  const approved = String(card.issue) in state.approvedResolving;
  if (approved && card.column === 'Testing') return [`#${card.issue} approved but column Testing`];
  if (card.column === 'Hardening' && !approved && !isCleanupTask(card.labels)) return [`#${card.issue} column Hardening but no approval`];
  return [];
}

function approvalDrift(card: Card, state: FactoryState): string[] {
  const key = String(card.issue);
  const posts = Object.entries(state.approvalPosts).filter(([, issue]) => issue === card.issue).map(([id]) => id);
  const queued = key in state.pendingApprovals;
  if (card.column === 'Approval') return posts.length || queued ? [] : [`#${card.issue} column Approval but no open post and no approval`];
  const lines = posts.map((id) => `#${card.issue} open approval post ${id} but column ${card.column}`);
  if (queued) lines.push(`#${card.issue} queued approval but column ${card.column}`);
  return lines;
}

function jobDrift(card: Card, state: FactoryState): string[] {
  const position = cardPosition(card, state);
  const expected = POSITION_STAGE[position];
  const runs = expected === null ? 'nothing' : expected;
  return state.jobs
    .filter((job) => job.issue === card.issue && CARD_JOBS.includes(job.stage) && !runsStage(position, expected, job.stage))
    .map((job) => `#${card.issue} running ${job.stage} job but position ${position} runs ${runs}`);
}

// Ad hoc jobs run in Implementation in place of implement.
function runsStage(position: Position, expected: JobStage | null, stage: JobStage): boolean {
  return stage === expected || (stage === 'adhoc' && position === 'implement');
}

const heldBy = (issue: string, hold: Hold): string => `#${issue} held by ${hold.by} (${hold.reason})`;

// A held card waits in its column with no job. Done runs nothing, so a hold there is stale.
function heldCardDrift(card: Card, state: FactoryState): string[] {
  const hold = state.held[String(card.issue)];
  if (hold === undefined) return [];
  const lines = card.column === 'Done' ? [`${heldBy(String(card.issue), hold)} but column Done`] : [];
  return [...lines, ...runningJobs(card, state).map((job) => `${heldBy(String(card.issue), hold)} but a ${job.stage} job is running`)];
}

// A hold whose card left the board holds nothing, and `resume-card` lifts it. A job on a held issue escaped the hold.
// Audit skips the card drift of a card with a running job, so it reads the running job from here.
export function holdDrift(state: FactoryState, cards: Card[]): string[] {
  return Object.entries(state.held).flatMap(([issue, hold]) => {
    const gone = cards.some((card) => String(card.issue) === issue) ? [] : [`${heldBy(issue, hold)} but not on the board`];
    const running = state.jobs.filter((job) => String(job.issue) === issue).map((job) => `${heldBy(issue, hold)} but a ${job.stage} job is running`);
    return [...gone, ...running];
  });
}

export function releaseDrift(state: FactoryState, cards: Card[]): string[] {
  const release = state.release;
  const lines = release === null ? [] : openReleaseDrift(release, cards);
  if (state.pendingShip !== null && (release === null || release.postId === null)) lines.push('pending ship but no current candidate post');
  return lines;
}

function openReleaseDrift(release: ReleaseState, cards: Card[]): string[] {
  const lines: string[] = [];
  if (!cards.some((card) => card.issue === release.issue)) lines.push(`release tracking card #${release.issue} missing`);
  if (release.postId !== null && release.candidateSha !== release.playtest.passed) lines.push(`candidate post of ${release.candidateSha ?? 'no commit'} that the playtest did not pass`);
  return lines;
}
