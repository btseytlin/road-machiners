import { rmSync } from 'node:fs';
import { deployDev } from '../deploy';
import { appendLedger } from '../ledger';
import { adoptReplyMedia, dropReplyMedia, replyMediaLines } from '../reply-media';
import { readState, updateState } from '../state';
import { BRANCH, FEEDBACK_HEADING, QUESTION_HEADING, MergeConflictError, RELEASE_CANDIDATE_LABEL, WONT_DO_LABEL, type Ctx, type FactoryState, type Route } from '../types';
import { BASE_BRANCH, HOTFIX_BASE, agentLog, baseBranchFor, mediaDir, workDir } from './common';
import { releaseBundle } from './bundle';
import { shipHotfix } from './hotfix';

async function requireApproval(ctx: Ctx, issue: number): Promise<void> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Approval') throw new Error(`Issue #${issue} is not in Approval, it is in ${card?.column ?? 'no column'}`);
}

function forgetPosts(ctx: Ctx, issue: number, dropPending: boolean): void {
  const closed = Object.entries(readState(ctx.statePath).approvalPosts).filter(([, number]) => number === issue).map(([post]) => Number(post));
  updateState(ctx.statePath, (state) => {
    const approvalPosts = Object.fromEntries(Object.entries(state.approvalPosts).filter(([, number]) => number !== issue));
    const pendingApprovals = { ...state.pendingApprovals };
    if (dropPending) delete pendingApprovals[String(issue)];
    const builds = { ...state.builds };
    delete builds[String(issue)];
    const approvedResolving = { ...state.approvedResolving };
    delete approvedResolving[String(issue)];
    const testPhase = { ...state.testPhase };
    delete testPhase[String(issue)];
    // A reply to a closed post can no longer be routed, so it must not turn into a failure later.
    const unroutedReplies = Object.fromEntries(Object.entries(state.unroutedReplies).filter(([, reply]) => reply.issue !== issue));
    return { ...state, approvalPosts, pendingApprovals, builds, approvedResolving, testPhase, unroutedReplies };
  });
  dropReplyMedia(ctx.cfg.home, closed);
}

export async function approve(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  if (base !== HOTFIX_BASE && !(String(issue) in readState(ctx.statePath).approvedResolving)) return harden(ctx, issue, by, base);
  const message = await mergeOrResolve(ctx, issue, item.title, by, base);
  if (message === null) return;
  await ctx.github.move(issue, 'Done');
  forgetPosts(ctx, issue, true);
  rmSync(workDir(ctx, issue), { recursive: true, force: true });
  rmSync(`${ctx.cfg.home}/work/check-issue-${issue}`, { recursive: true, force: true });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, message);
}

// The committee approved a preview, which had no review yet. The card goes back to Testing to harden under the same approver,
// and the checks after it queue the merge with no new post. A hotfix hardened before its post, so it merges at once instead.
async function harden(ctx: Ctx, issue: number, by: string, base: string): Promise<void> {
  forgetPosts(ctx, issue, true);
  updateState(ctx.statePath, (state) => ({ ...state, approvedResolving: { ...state.approvedResolving, [String(issue)]: by } }));
  await ctx.github.comment(issue, `Approved by ${by} in the committee chat. The review, the fixes and the full testing run now. Then the factory merges it into ${base} by itself, with no new post.`);
  await ctx.github.move(issue, 'Testing');
  ctx.log('approve', issue, `approved by ${by}, back to Testing to harden`);
}

// Parallel work moves the base on after testing, so the branch may conflict with it. That is routine work, not an incident.
// The card goes back to Testing, which merges the base, lets the agent resolve the conflict and runs the checks again.
// Testing then queues the merge under the same approver, with no new post. Returns null in that case.
async function mergeOrResolve(ctx: Ctx, issue: number, title: string, by: string, base: string): Promise<string | null> {
  try {
    return await mergeApproved(ctx, issue, title, by, base);
  } catch (error) {
    if (!(error instanceof MergeConflictError) || error.branch !== BRANCH(issue)) throw error;
    forgetPosts(ctx, issue, true);
    updateState(ctx.statePath, (state) => ({ ...state, approvedResolving: { ...state.approvedResolving, [String(issue)]: by } }));
    await ctx.github.comment(issue, `${base} moved on since testing, and the branch conflicts with it in ${error.files.join(', ')}. Testing merges ${base} again and resolves the conflict. Then the approval by ${by} merges it, with no new post.`);
    await ctx.github.move(issue, 'Testing');
    ctx.log('approve', issue, `conflict with ${base}, back to Testing to resolve`);
    return null;
  }
}

// A hotfix ships at once. Other work stays open with the label until its release ships to main. Ship closes it and drops the label.
async function mergeApproved(ctx: Ctx, issue: number, title: string, by: string, base: string): Promise<string> {
  if (base === HOTFIX_BASE) return shipHotfix(ctx, issue, title, by);
  await ctx.repo.fetch();
  await ctx.repo.merge([{ branch: BRANCH(issue), into: base, message: `Merge issue #${issue}: ${title}` }]);
  const message = base === BASE_BRANCH ? await mergedIntoDev(ctx, issue, title, by) : await mergedIntoRelease(ctx, issue, title, by, base);
  await ctx.github.addLabel(issue, RELEASE_CANDIDATE_LABEL);
  return message;
}

// The pushed dev holds the branch head, so GitHub marks the pull request merged by itself.
async function mergedIntoDev(ctx: Ctx, issue: number, title: string, by: string): Promise<string> {
  await deployDev(ctx, agentLog(ctx, issue, 'approve'));
  await ctx.github.comment(issue, `Approved by ${by} in the committee chat and merged into dev. It closes when its release ships.`);
  return `Issue #${issue} ${title} is merged into dev.\nPlay it: ${ctx.cfg.publicUrl}/dev`;
}

// Release work never reaches dev by itself, so dev stays as it is until Ship. A feature back after a removal is in the release again.
// The played candidate lacks this work, so its post can no longer ship. The tick builds a new one.
async function mergedIntoRelease(ctx: Ctx, issue: number, title: string, by: string, branch: string): Promise<string> {
  updateState(ctx.statePath, (state) => (state.release ? { ...state, pendingShip: null, release: { ...state.release, postId: null, removed: state.release.removed.filter((n) => n !== issue) } } : state));
  await ctx.github.comment(issue, `Approved by ${by} and merged into the release branch ${branch}. It closes when the release ships.`);
  return `Issue #${issue} ${title} is merged into the release ${branch}.`;
}

// A routed committee reply. Every route lands on the issue with its route, and the ledger records it.
// An answer leaves the card and its post as they are. A patch or a redesign wins over an approval queued for the same issue,
// since the card leaves Approval. Returns whether it dropped one.
// A patch or a redesign takes the images the member sent with replies to the post. An answer leaves them for a later route.
export async function routeFeedback(ctx: Ctx, issue: number, by: string, text: string, route: Route, post: number): Promise<boolean> {
  await requireApproval(ctx, issue);
  const state = readState(ctx.statePath);
  // Checked before anything is written, so a refused patch leaves no comment or ledger line behind.
  const played = route === 'patch' ? playedBuild(state, issue) : null;
  await ctx.github.comment(issue, routeComment(ctx, issue, by, text, route, post));
  appendLedger(ctx.cfg.home, { kind: 'route', issue, route, by, at: ctx.now().toISOString() });
  if (route === 'answer') return false;
  if (played !== null) updateState(ctx.statePath, (next) => ({ ...next, patching: { ...next.patching, [String(issue)]: played } }));
  await ctx.github.move(issue, route === 'patch' ? 'Implementation' : 'Design');
  forgetPosts(ctx, issue, true);
  return String(issue) in state.pendingApprovals;
}

function routeComment(ctx: Ctx, issue: number, by: string, text: string, route: Route, post: number): string {
  if (route === 'answer') return `${QUESTION_HEADING}\n\nFrom ${by}, routed as answer:\n\n${text}`;
  const media = replyMediaLines(adoptReplyMedia(ctx.cfg.home, post, mediaDir(ctx, issue), by));
  return `${FEEDBACK_HEADING}\n\nFrom ${by}, routed as ${route}:\n\n${text}${media}`;
}

// The patch checks its diff against the build the committee played, so the card keeps that commit.
function playedBuild(state: FactoryState, issue: number): string {
  const played = state.builds[String(issue)];
  if (played === undefined) throw new Error(`Issue #${issue} has no recorded build, so a patch has nothing to start from`);
  return played;
}

export async function deny(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  const comment = `Denied by ${by} in the committee chat.`;
  await ctx.github.comment(issue, comment);
  if ((await ctx.github.pullRequestFor(BRANCH(issue))) !== null) await ctx.github.closePullRequest(BRANCH(issue), comment);
  await ctx.github.addLabel(issue, WONT_DO_LABEL);
  await ctx.github.close(issue, 'not planned');
  await ctx.github.move(issue, 'Done');
  forgetPosts(ctx, issue, true);
  await releaseBundle(ctx, issue, 'was denied');
}
