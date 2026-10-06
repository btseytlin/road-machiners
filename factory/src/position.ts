// The position model of a card. docs/state.md describes each position and the stores it spans.
import type { Card, FactoryState, JobStage } from './types';

export type Position = 'triage' | 'design' | 'implement' | 'patch' | 'verify' | 'fix' | 'checks' | 'post' | 'approval' | 'done';
export const MOVE_TARGETS = ['triage', 'design', 'implement', 'verify', 'checks', 'approval', 'done'] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];

// The job each position runs, as cardStage in tick.ts picks it. Done runs nothing.
const POSITION_STAGE: Record<Position, JobStage | null> = {
  triage: 'triage', design: 'design', implement: 'implement', patch: 'patch', verify: 'verify', fix: 'verify', checks: 'checks', post: 'checks', approval: 'approve', done: null,
};
// Jobs that belong to a card position. Release, change and incident jobs carry an issue too, but no position owns them.
const CARD_JOBS: JobStage[] = ['triage', 'design', 'implement', 'adhoc', 'patch', 'verify', 'checks', 'approve'];

export function cardPosition(card: Card, state: FactoryState): Position {
  const key = String(card.issue);
  if (card.column === 'Testing') return testingPosition(state.testPhase[key]);
  if (card.column === 'Implementation') return key in state.patching ? 'patch' : 'implement';
  return { Triage: 'triage', Design: 'design', Approval: 'approval', Done: 'done' }[card.column] as Position;
}

function testingPosition(phase: string | undefined): Position {
  if (phase === 'fix' || phase === 'post') return phase;
  return phase === 'checks' || phase === 'checks-after-fix' ? 'checks' : 'verify';
}

export function cardDrift(card: Card, state: FactoryState): string[] {
  return [...phaseDrift(card, state), ...approvalDrift(card, state), ...jobDrift(card, state)];
}

function phaseDrift(card: Card, state: FactoryState): string[] {
  const key = String(card.issue);
  const lines: string[] = [];
  if (key in state.testPhase && card.column !== 'Testing') lines.push(`#${card.issue} testPhase ${state.testPhase[key]} but column ${card.column}`);
  if (key in state.patching && card.column !== 'Implementation') lines.push(`#${card.issue} patching set but column ${card.column}`);
  return lines;
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

export function releaseDrift(state: FactoryState, cards: Card[]): string[] {
  const lines: string[] = [];
  const release = state.release;
  if (release !== null && !cards.some((card) => card.issue === release.issue)) lines.push(`release tracking card #${release.issue} missing`);
  if (state.pendingShip !== null && (release === null || release.postId === null)) lines.push('pending ship but no current candidate post');
  return lines;
}
