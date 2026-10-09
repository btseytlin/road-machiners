// While a merge job runs, a waiting Merging card takes the newest base into its issue branch, so its own merge batch meets fewer conflicts.
// A conflict goes to an agent through mergeResolving, which guards the resolution and pushes only the issue branch. docs/process.md has the rules.
import { readState, updateState } from '../state';
import { BRANCH, type Ctx } from '../types';
import { baseBranchFor } from './common';
import { waitingMerges } from './merge';
import { mergeResolving } from './merge-resolve';

export async function catchUp(ctx: Ctx, issue: number): Promise<void> {
  const card = (await ctx.github.cards()).find((other) => other.issue === issue);
  if (card === undefined || !waitingMerges(readState(ctx.statePath), [card]).length) return ctx.log('catch-up', issue, 'the card no longer waits in Merging');
  if (!claim(ctx, issue)) return ctx.log('catch-up', issue, 'no merge job runs, or it took the card or caught it up already');
  const base = baseBranchFor(ctx, card.labels);
  await ctx.repo.fetch();
  if (await ctx.repo.isMerged(base, BRANCH(issue))) return ctx.log('catch-up', issue, `${BRANCH(issue)} already holds ${base}`);
  await mergeBase(ctx, issue, base);
  ctx.log('catch-up', issue, `${BRANCH(issue)} took ${base}`);
}

async function mergeBase(ctx: Ctx, issue: number, base: string): Promise<void> {
  try {
    await mergeResolving(ctx, 'catch-up', [{ branch: base, into: BRANCH(issue), message: `Merge ${base} into ${BRANCH(issue)} while it waits in Merging` }]);
  } catch (error) {
    throw new Error(`The catch-up of #${issue} with ${base} failed, and its merge job merges it as before: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function claim(ctx: Ctx, issue: number): boolean {
  let claimed = false;
  updateState(ctx.statePath, (state) => {
    const merge = state.jobs.find((job) => job.stage === 'merge');
    if (merge?.batch === undefined || merge.batch.includes(issue) || (merge.caughtUp ?? []).includes(issue)) return state;
    claimed = true;
    return { ...state, jobs: state.jobs.map((job) => (job === merge ? { ...job, caughtUp: [...(job.caughtUp ?? []), issue] } : job)) };
  });
  return claimed;
}
