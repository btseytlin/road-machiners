// The position model of a card. docs/state.md describes each position and the stores it spans.
import { RELEASE_LABEL, isCleanupTask, type Card, type FactoryState, type Hold, type Job, type JobStage, type ReleasePost, type ReleaseState } from './types';

// The board column is the position. Only a Testing card that a control move sent to Approval has a second one, `post`.
export type Position = 'triage' | 'design' | 'implement' | 'verify' | 'post' | 'approval' | 'harden' | 'merging' | 'done';
export const MOVE_TARGETS = ['triage', 'design', 'implement', 'verify', 'approval', 'harden', 'merging', 'done'] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];

// The job each position runs, as cardStage in tick.ts picks it. A merge job serves every Merging card at once. Done runs nothing.
const POSITION_STAGE: Record<Position, JobStage | null> = {
  triage: 'triage', design: 'design', implement: 'implement', verify: 'verify', post: 'checks', approval: 'approve', harden: 'harden', merging: 'merge', done: null,
};
// Lists the jobs that belong to a card position. Release, change and incident jobs carry an issue too, but no position owns them.
export const CARD_JOBS: JobStage[] = ['triage', 'design', 'implement', 'adhoc', 'verify', 'harden', 'checks'];

// The merge job has no issue, and it merges every free card in Merging. An approve job ships a hotfix.
// Neither is ever killed, since it may stop between its push and its deploy.
export function isMerging(state: FactoryState, card: Card): boolean {
  return state.jobs.some((job) => (job.stage === 'merge' && card.column === 'Merging') || (job.stage === 'approve' && job.issue === card.issue));
}

const COLUMN_POSITION: Record<Card['column'], Position> = {
  Triage: 'triage', Design: 'design', Implementation: 'implement', Testing: 'verify', Approval: 'approval', Hardening: 'harden', Merging: 'merging', Done: 'done',
};

export function cardPosition(card: Card, state: FactoryState): Position {
  if (card.column === 'Testing' && state.postOnly.includes(card.issue)) return 'post';
  return COLUMN_POSITION[card.column];
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
  return state.postOnly.includes(card.issue) && card.column !== 'Testing' ? [`#${card.issue} waits for a post but column ${card.column}`] : [];
}

// An approved card hardens and merges. In Testing it would get a preview and lose its approval.
function hardeningDrift(card: Card, state: FactoryState): string[] {
  const approved = String(card.issue) in state.approvedResolving;
  if (approved && card.column === 'Testing') return [`#${card.issue} approved but column Testing`];
  if (!approved && needsApproval(card)) return [`#${card.issue} column ${card.column} but no approval`];
  return [];
}

// A cleanup task hardens and merges with no post, so it holds no approval.
function needsApproval(card: Card): boolean {
  return (card.column === 'Hardening' || card.column === 'Merging') && !isCleanupTask(card.labels);
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
  return [...lines, ...releasePostDrift(state.releasePost)];
}

function releasePostDrift(post: ReleasePost | null): string[] {
  if (post === null || (post.postId === null) === (post.draft === null)) return [];
  return [`release ${post.day} public post with a draft post id but no draft text, or text but no post`];
}

function openReleaseDrift(release: ReleaseState, cards: Card[]): string[] {
  const lines: string[] = [];
  if (!cards.some((card) => card.issue === release.issue)) lines.push(`release tracking card #${release.issue} missing`);
  if (release.postId !== null && release.candidateSha !== release.playtest.passed) lines.push(`candidate post of ${release.candidateSha ?? 'no commit'} that the playtest did not pass`);
  return [...lines, ...missingTasks(release, cards)];
}

// The board lists a new card within a minute. A recorded task still missing holds the playtest until a member puts it back or ends it.
function missingTasks(release: ReleaseState, cards: Card[]): string[] {
  return release.tasks.filter((issue) => !cards.some((card) => card.issue === issue)).map((issue) => `release task #${issue} missing from the board`);
}
