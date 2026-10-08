import { moveCard } from '../card-events';
import { rmSync } from 'node:fs';
import { deployDev } from '../deploy';
import { readState, updateState } from '../state';
import { BRANCH, FEEDBACK_HEADING, RELEASE_CANDIDATE_LABEL, type Ctx } from '../types';
import { BASE_BRANCH, agentLog, workDir } from './common';
import { revertResolving } from './merge-resolve';
import { requireRelease } from './release-common';

export async function remove(ctx: Ctx, issue: number): Promise<void> {
  const removal = readState(ctx.statePath).pendingRemovals.find((item) => item.issue === issue);
  if (!removal) throw new Error(`No removal of issue #${issue} is queued`);
  const release = requireRelease(ctx);
  await ctx.repo.fetch();
  const onRelease = await revertResolving(ctx, 'remove', issue, release.branch);
  if (onRelease) updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
  const onDev = await revertResolving(ctx, 'remove', issue, BASE_BRANCH);
  if (!onRelease && !onDev) throw new Error(`Neither ${release.branch} nor ${BASE_BRANCH} has a merge of issue #${issue}`);
  await deployDev(ctx, agentLog(ctx, issue, 'remove'));
  await ctx.repo.deleteBranch(BRANCH(issue));
  rmSync(workDir(ctx, issue), { recursive: true, force: true });
  rmSync(`${ctx.cfg.home}/work/check-issue-${issue}`, { recursive: true, force: true });
  await ctx.github.reopen(issue);
  await ctx.github.removeLabel(issue, RELEASE_CANDIDATE_LABEL);
  await ctx.github.comment(issue, `${FEEDBACK_HEADING}\n\nRemoved from release ${release.day} by ${removal.by}:\n\n${removal.text}`);
  await moveCard(ctx, issue, 'Design', 'removed');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null, removed: [...state.release.removed, issue] } }));
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Issue #${issue} is out of release ${release.day} and back in design. A new candidate follows when the release tasks are done.`);
}
