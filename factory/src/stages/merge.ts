import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deployDev } from '../deploy';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, RELEASE_CANDIDATE_LABEL, STUCK_LABEL, type AgentSession, type Card, type Ctx } from '../types';
import { closeMerged } from './approval';
import { runCost, untilPasses } from './checkpoint';
import { checkFailure, checkScript, checkUntilReal, testCacheMount } from './checks';
import { BASE_BRANCH, baseBranchFor, fillPrompt, guardDiff, playtestCommand, resetOutputs } from './common';
import { releaseLog } from './release-common';

// The merge queue. A merge job takes every Merging card of one base at that moment, merges them into a clone of the base,
// runs the full checks on the result and pushes only a result that passed. One agent session resolves the conflicts and fixes the failures,
// within the Merging budget. A base that moved during the checks is merged in again and checked again, so the base never takes untested code.
// A failed batch labels each of its cards stuck, so the tick does not start the same merge again until Hermes looks.
export async function merge(ctx: Ctx): Promise<void> {
  const batch = await nextBatch(ctx);
  if (batch === null) return ctx.log('merge', null, 'no card waits in Merging');
  try {
    await mergeBatch(ctx, batch.base, batch.cards);
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
  const session = newSession(ctx);
  const agent = (prompt: string): Promise<string> => runMergeAgent(ctx, dir, base, session, prompt);
  let spent = 0;
  for (const card of cards) spent += await mergeIn(ctx, dir, base, BRANCH(card.issue), `issue #${card.issue} was approved`, agent);
  const fixList = cards.map((card) => `- #${card.issue} on ${BRANCH(card.issue)}`).join('\n');
  for (;;) {
    await untilPasses(ctx.cfg.mergingBudgetUsd, spent, () => mergedChecks(ctx, dir, base), (failure) => agent(fillPrompt('merge-fix', { into: base, cards: fixList, failure })));
    if (await pushed(ctx, dir, base)) break;
    spent += await mergeIn(ctx, dir, base, base, `${base} moved on GitHub while the checks ran`, agent);
  }
  await settle(ctx, base, cards);
}

// The Merging cards of the base of the first one, in board order. Release tasks and dev cards never share a batch.
async function nextBatch(ctx: Ctx): Promise<{ base: string; cards: Card[] } | null> {
  const waiting = (await ctx.github.cards()).filter((card) => card.column === 'Merging');
  if (waiting.length === 0) return null;
  const base = baseBranchFor(ctx, waiting[0]!.labels);
  return { base, cards: waiting.filter((card) => baseBranchFor(ctx, card.labels) === base) };
}

function newSession(ctx: Ctx): AgentSession {
  const dir = join(ctx.cfg.home, 'sessions', 'merge');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return { dir, id: randomUUID(), resume: false };
}

// Every round after the first continues the same conversation, so the agent keeps what it learned about the batch.
async function runMergeAgent(ctx: Ctx, dir: string, base: string, session: AgentSession, prompt: string): Promise<string> {
  const run = { dir: session.dir, id: session.id, resume: session.resume };
  session.resume = true;
  return ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log: releaseLog(ctx, `merge-${base.replaceAll('/', '-')}`), session: run });
}

// Merges a branch into the clone. A conflict goes to the agent, and an unfinished merge fails the job. Returns what the agent cost.
async function mergeIn(ctx: Ctx, dir: string, base: string, branch: string, reason: string, agent: (prompt: string) => Promise<string>): Promise<number> {
  const { commit, conflicts } = await ctx.repo.mergeBranchIntoWork(dir, branch);
  if (commit === null || conflicts.length === 0) return 0;
  ctx.log('merge', null, `${branch} conflicts with ${base} in ${conflicts.join(', ')}, an agent resolves it`);
  const cost = runCost(await agent(fillPrompt('merge-branches', { into: base, branch, reason, files: conflicts.map((file) => `- ${file}`).join('\n') })));
  if ((await ctx.repo.mergeBranchIntoWork(dir, branch)).commit !== null) throw new Error(`The merge agent left the merge of ${branch} into ${base} unfinished.`);
  return cost;
}

// The full suite, the typecheck, the playtest and the build on the merged result. Timeouts alone rerun with no agent.
async function mergedChecks(ctx: Ctx, dir: string, base: string): Promise<string | null> {
  const log = releaseLog(ctx, `merge-checks-${base.replaceAll('/', '-')}`);
  const script = checkScript(playtestCommand(ctx.cfg, false));
  return checkUntilReal(async () => {
    try {
      await ctx.container.shell(dir, script, log, { BUILD_SCOPE: 'merge' }, testCacheMount(ctx));
      return null;
    } catch (error) {
      return checkFailure(log, error);
    }
  }, (run) => ctx.log('merge', null, `the checks only timed out, run ${run}, running them again`));
}

// The diff guard runs on everything the base takes. False when GitHub rejected the push because the base moved.
async function pushed(ctx: Ctx, dir: string, base: string): Promise<boolean> {
  const head = await ctx.repo.fetchFromWork(dir, base);
  guardDiff(await ctx.repo.diff(base, head));
  try {
    await ctx.repo.push(head, base);
    return true;
  } catch (error) {
    await ctx.repo.fetch();
    if (await ctx.repo.isMerged(base, head)) throw error;
    ctx.log('merge', null, `${base} moved during the checks, merging it in again`);
    return false;
  }
}

// Each merged card is done. A dev merge rebuilds /dev/. A release merge drops the candidate post, which lacks the new work.
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
