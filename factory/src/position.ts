// The position model of a card. docs/state.md describes each position and the stores it spans.
import { RELEASE_LABEL, isCleanupTask, type Card, type FactoryState, type Hold, type Job, type JobStage, type ReleasePost, type ReleaseState, type StuckRecord } from './types';

export type Position = 'triage' | 'design' | 'implement' | 'verify' | 'post' | 'approval' | 'harden' | 'merging' | 'done';
export const MOVE_TARGETS = ['triage', 'design', 'implement', 'verify', 'approval', 'harden', 'merging', 'done'] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];

const POSITION_STAGE: Record<Position, JobStage | null> = {
  triage: 'triage', design: 'design', implement: 'implement', verify: 'verify', post: 'checks', approval: 'approve', harden: 'harden', merging: 'merge', done: null,
};
export const CARD_JOBS: JobStage[] = ['triage', 'design', 'implement', 'adhoc', 'verify', 'harden', 'checks'];

export const inMergeBatch = (job: Job, card: Card): boolean => job.stage === 'merge' && card.column === 'Merging' && (job.batch?.includes(card.issue) ?? false);

export function isMerging(state: FactoryState, card: Card): boolean {
  return state.jobs.some((job) => inMergeBatch(job, card) || (job.stage === 'approve' && job.issue === card.issue));
}

const COLUMN_POSITION: Record<Card['column'], Position> = {
  Triage: 'triage', Design: 'design', Implementation: 'implement', Testing: 'verify', Approval: 'approval', Hardening: 'harden', Merging: 'merging', Done: 'done',
};

export function cardPosition(card: Card, state: FactoryState): Position {
  if (card.column === 'Testing' && state.postOnly.includes(card.issue)) return 'post';
  return COLUMN_POSITION[card.column];
}

export function cardDrift(card: Card, state: FactoryState): string[] {
  if (card.labels.includes(RELEASE_LABEL)) return [];
  return [...phaseDrift(card, state), ...hardeningDrift(card, state), ...approvalDrift(card, state), ...jobDrift(card, state), ...heldCardDrift(card, state)];
}

export function runningJobs(card: Card, state: FactoryState): Job[] {
  return state.jobs.filter((job) => job.issue === card.issue);
}

function phaseDrift(card: Card, state: FactoryState): string[] {
  return state.postOnly.includes(card.issue) && card.column !== 'Testing' ? [`#${card.issue} waits for a post but column ${card.column}`] : [];
}

function hardeningDrift(card: Card, state: FactoryState): string[] {
  const approved = String(card.issue) in state.approvedResolving;
  if (approved && card.column === 'Testing') return [`#${card.issue} approved but column Testing`];
  if (!approved && needsApproval(card)) return [`#${card.issue} column ${card.column} but no approval`];
  return [];
}

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

function runsStage(position: Position, expected: JobStage | null, stage: JobStage): boolean {
  return stage === expected || (stage === 'adhoc' && position === 'implement');
}

const heldBy = (issue: string, hold: Hold): string => `#${issue} held by ${hold.by} (${hold.reason})`;

function heldCardDrift(card: Card, state: FactoryState): string[] {
  const hold = state.held[String(card.issue)];
  if (hold === undefined) return [];
  const lines = card.column === 'Done' ? [`${heldBy(String(card.issue), hold)} but column Done`] : [];
  return [...lines, ...runningJobs(card, state).map((job) => `${heldBy(String(card.issue), hold)} but a ${job.stage} job is running`)];
}

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

function missingTasks(release: ReleaseState, cards: Card[]): string[] {
  return release.tasks.filter((issue) => !cards.some((card) => card.issue === issue)).map((issue) => `release task #${issue} missing from the board`);
}

export function stuckText(record: StuckRecord | undefined): string {
  if (record === undefined) return 'none';
  const released = record.released === null ? '' : `, released ${record.released}`;
  const refused = record.refused === null ? '' : `, refused: ${record.refused.split('\n')[0]}`;
  return `${record.kind} in ${record.column}, incident ${record.incident}, tries ${record.tries}${released}${refused}: ${record.cause.split('\n')[0]} (log ${record.log ?? 'none'})`;
}
