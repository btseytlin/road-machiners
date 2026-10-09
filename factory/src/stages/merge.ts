import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deployDev } from '../deploy';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, RELEASE_CANDIDATE_LABEL, RELEASE_TASK_LABEL, STUCK_LABEL, type AgentSession, type Card, type Ctx, type FactoryState } from '../types';
import { withWorkFolder } from '../work-lock';
import { closeMerged } from './approval';
import { runCost, untilPasses } from './checkpoint';
import { checkScript, checkUntilReal, runChecks } from './checks';
import { guardAgainstAll } from '../diff-guard';
import { BASE_BRANCH, baseBranchFor, fillPrompt, playtestCommand, resetOutputs } from './common';
import { releaseLog } from './release-common';

export async function merge(ctx: Ctx): Promise<void> {
  const batch = await nextBatch(ctx);
  if (batch === null) return ctx.log('merge', null, 'no card waits in Merging');
  try {
    await withWorkFolder(ctx, 'merge-queue', () => mergeBatch(ctx, batch.base, batch.cards));
  } catch (error) {
    for (const card of batch.cards) await ctx.github.addLabel(card.issue, STUCK_LABEL);
    throw error;
  }
}

async function mergeBatch(ctx: Ctx, base: string, cards: Card[]): Promise<void> {
  const dir = join(ctx.cfg.home, 'work', 'merge-queue');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.fetch();
  await ctx.repo.prepareWorkClone(base, base, dir);
  resetOutputs(join(dir, GAME_DIR));
  const clock = newClock();
  const land: Landing = { stage: 'merge', dir, into: base, guardAgainst: [base], agent: landingAgent(ctx, 'merge', dir, base), clock };
  try {
    let spent = 0;
    for (const card of cards) {
      const message = `Merge issue #${card.issue}: ${(await ctx.github.issue(card.issue)).title}`;
      spent += await timed(clock, 'merges', () => mergeIn(ctx, land, { branch: BRANCH(card.issue), message, reason: `issue #${card.issue} was approved` }));
    }
    const fixList = cards.map((card) => `- #${card.issue} on ${BRANCH(card.issue)}`).join('\n');
    await checkAndPush(ctx, land, spent, (failure) => fillPrompt('merge-fix', { into: base, cards: fixList, failure }));
  } finally {
    ctx.log('merge', null, `batch ${cards.map((card) => `#${card.issue}`).join(' ')} took ${clockLine(clock)}`);
  }
  await settle(ctx, base, cards);
}

export type Landing = { stage: 'merge' | 'ship'; dir: string; into: string; guardAgainst: string[]; agent: (prompt: string) => Promise<string>; clock?: Clock };

type Phase = 'merges' | 'checks' | 'fixes' | 'remerges' | 'pushes';
type Clock = Record<Phase, { ms: number; count: number }>;
const PHASES: Phase[] = ['merges', 'checks', 'fixes', 'remerges', 'pushes'];

function newClock(): Clock {
  return Object.fromEntries(PHASES.map((phase) => [phase, { ms: 0, count: 0 }])) as Clock;
}

async function timed<T>(clock: Clock | undefined, phase: Phase, work: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await work();
  } finally {
    if (clock) clock[phase] = { ms: clock[phase].ms + Date.now() - start, count: clock[phase].count + 1 };
  }
}

function clockLine(clock: Clock): string {
  return PHASES.map((phase) => `${phase} ${Math.round(clock[phase].ms / 60_000)} min in ${clock[phase].count}`).join(', ');
}

export async function checkAndPush(ctx: Ctx, land: Landing, spent: number, fixPrompt: (failure: string) => string): Promise<void> {
  let total = spent;
  for (;;) {
    total = await untilPasses(ctx.cfg.mergingBudgetUsd, total, () => timed(land.clock, 'checks', () => mergedChecks(ctx, land)), (failure) => timed(land.clock, 'fixes', () => land.agent(fixPrompt(failure))));
    if (await timed(land.clock, 'pushes', () => pushed(ctx, land))) return;
    total += await timed(land.clock, 'remerges', () => mergeIn(ctx, land, { branch: land.into, message: undefined, reason: `${land.into} moved on GitHub while the checks ran` }));
  }
}

const MERGE_BATCH_CARDS = 3;

async function nextBatch(ctx: Ctx): Promise<{ base: string; cards: Card[] } | null> {
  const cards = await ctx.github.cards();
  let taken: { base: string; cards: Card[] } | null = null;
  updateState(ctx.statePath, (state) => {
    const waiting = waitingMerges(state, cards).filter((card) => !state.jobs.some((job) => job.issue === card.issue));
    if (waiting.length === 0) return state;
    const base = baseBranchFor(ctx, waiting[0]!.labels);
    const batchCards = waiting.filter((card) => baseBranchFor(ctx, card.labels) === base).slice(0, MERGE_BATCH_CARDS);
    taken = { base, cards: batchCards };
    const batch = batchCards.map((card) => card.issue);
    return { ...state, jobs: state.jobs.map((job) => (job.stage === 'merge' ? { ...job, batch } : job)) };
  });
  return taken;
}

export function waitingMerges(state: FactoryState, cards: Card[]): Card[] {
  const shipping = state.jobs.some((job) => job.stage === 'ship');
  const merging = state.jobs.filter((job) => job.stage === 'merge').flatMap((job) => job.batch ?? []);
  return cards.filter((card) =>
    card.column === 'Merging' && !card.labels.includes(STUCK_LABEL) && !(String(card.issue) in state.held) && !(shipping && card.labels.includes(RELEASE_TASK_LABEL)) && !merging.includes(card.issue));
}

export function landingAgent(ctx: Ctx, stage: Landing['stage'], dir: string, into: string): (prompt: string) => Promise<string> {
  const session = newSession(ctx, stage);
  const log = releaseLog(ctx, `${stage}-${into.replaceAll('/', '-')}`);
  return (prompt) => {
    const run = { dir: session.dir, id: session.id, resume: session.resume };
    session.resume = true;
    return ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log, session: run });
  };
}

function newSession(ctx: Ctx, stage: Landing['stage']): AgentSession {
  const dir = join(ctx.cfg.home, 'sessions', stage);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return { dir, id: randomUUID(), resume: false };
}

type Incoming = { branch: string; message: string | undefined; reason: string };

export async function mergeIn(ctx: Ctx, land: Landing, { branch, message, reason }: Incoming): Promise<number> {
  const { commit, conflicts } = await ctx.repo.mergeBranchIntoWork(land.dir, branch, message);
  if (commit === null || conflicts.length === 0) return 0;
  ctx.log(land.stage, null, `${branch} conflicts with ${land.into} in ${conflicts.join(', ')}, an agent resolves it`);
  const cost = runCost(await land.agent(fillPrompt('merge-branches', { into: land.into, branch, reason, files: conflicts.map((file) => `- ${file}`).join('\n') })));
  if ((await ctx.repo.mergeBranchIntoWork(land.dir, branch)).commit !== null) throw new Error(`The ${land.stage} agent left the merge of ${branch} into ${land.into} unfinished.`);
  return cost;
}

async function mergedChecks(ctx: Ctx, land: Landing): Promise<string | null> {
  const log = releaseLog(ctx, `${land.stage}-checks-${land.into.replaceAll('/', '-')}`);
  const script = checkScript(playtestCommand(ctx.cfg, false));
  return checkUntilReal(() => runChecks(ctx, { stage: land.stage, issue: null }, land.dir, script, log, { BUILD_SCOPE: land.stage }), (run) => ctx.log(land.stage, null, `the checks only timed out, run ${run}, running them again`));
}

async function pushed(ctx: Ctx, land: Landing): Promise<boolean> {
  const head = await ctx.repo.fetchFromWork(land.dir, land.into);
  guardAgainstAll(await Promise.all(land.guardAgainst.map((branch) => ctx.repo.diff(branch, head))));
  try {
    await ctx.repo.push(head, land.into);
    return true;
  } catch (error) {
    await ctx.repo.fetch();
    if (await ctx.repo.isMerged(land.into, head)) throw error;
    ctx.log(land.stage, null, `${land.into} moved during the checks, merging it in again`);
    return false;
  }
}

async function settle(ctx: Ctx, base: string, cards: Card[]): Promise<void> {
  const where = base === BASE_BRANCH ? 'dev' : `the release branch ${base}`;
  const play = base === BASE_BRANCH ? `\nPlay it: ${ctx.cfg.publicUrl}/dev` : '';
  for (const card of cards) await settleCard(ctx, card, cards, where, play);
  if (base === BASE_BRANCH) await deployDev(ctx, releaseLog(ctx, 'merge-dev-build'));
  else updateState(ctx.statePath, (next) => (next.release ? { ...next, pendingShip: null, release: { ...next.release, postId: null, removed: next.release.removed.filter((n) => !cards.some((card) => card.issue === n)) } } : next));
}

async function settleCard(ctx: Ctx, card: Card, cards: Card[], where: string, play: string): Promise<void> {
  const by = readState(ctx.statePath).approvedResolving[String(card.issue)] ?? 'the factory';
  const others = cards.filter((other) => other.issue !== card.issue).map((other) => `#${other.issue}`);
  const batch = others.length > 0 ? ` It merged together with ${others.join(', ')}, and the checks passed on the result.` : '';
  await ctx.github.comment(card.issue, `Approved by ${by} and merged into ${where}.${batch} It closes when its release ships.`);
  await ctx.github.addLabel(card.issue, RELEASE_CANDIDATE_LABEL);
  const title = (await ctx.github.issue(card.issue)).title;
  await closeMerged(ctx, card.issue, card.labels, `Issue #${card.issue} ${title} is merged into ${where}.${play}`);
}
