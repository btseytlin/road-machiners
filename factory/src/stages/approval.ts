import { rmSync } from 'node:fs';
import { cardFlow, moveCard } from '../card-events';
import { appendLedger } from '../ledger';
import { adoptReplyMedia, dropReplyMedia, replyMediaLines } from '../reply-media';
import { readState, updateState } from '../state';
import { BRANCH, FEEDBACK_HEADING, QUESTION_HEADING, MergeConflictError, WONT_DO_LABEL, type Ctx, type Route } from '../types';
import { HOTFIX_BASE, baseBranchFor, mediaDir, workDir } from './common';
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
    const postOnly = state.postOnly.filter((n) => n !== issue);
    // A reply to a closed post can no longer be routed, so it must not turn into a failure later.
    const unroutedReplies = Object.fromEntries(Object.entries(state.unroutedReplies).filter(([, reply]) => reply.issue !== issue));
    return { ...state, approvalPosts, pendingApprovals, builds, approvedResolving, postOnly, unroutedReplies };
  });
  dropReplyMedia(ctx.cfg.home, closed);
}

// The committee approved a preview. A card moves to Hardening under the approver, and Merging takes it from there with no new post.
// A hotfix hardened before its post, so it ships at once. A hotfix that conflicts with main by then goes back to Testing, which merges main again.
export async function approve(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  if (base !== HOTFIX_BASE) return harden(ctx, issue, by, base);
  try {
    const message = await shipHotfix(ctx, issue, item.title, by);
    await closeMerged(ctx, issue, item.labels, message);
  } catch (error) {
    if (!(error instanceof MergeConflictError) || error.branch !== BRANCH(issue)) throw error;
    forgetPosts(ctx, issue, true);
    await ctx.github.comment(issue, `Approved by ${by}, but main moved on and the branch conflicts with it in ${error.files.join(', ')}. Testing merges main again and posts the build again.`);
    await moveCard(ctx, issue, 'Testing', 'conflict', cardFlow(item.labels));
  }
}

async function harden(ctx: Ctx, issue: number, by: string, base: string): Promise<void> {
  forgetPosts(ctx, issue, true);
  updateState(ctx.statePath, (state) => ({ ...state, approvedResolving: { ...state.approvedResolving, [String(issue)]: by } }));
  await ctx.github.comment(issue, `Approved by ${by} in the committee chat. Hardening runs now. Then the factory checks it merged with ${base} and merges it by itself, with no new post.`);
  await moveCard(ctx, issue, 'Hardening', 'approved');
  ctx.log('approve', issue, `approved by ${by}, to Hardening`);
}

// A merged card is done. Its posts, its work clone and its check clone go, and the committee chat hears of it.
export async function closeMerged(ctx: Ctx, issue: number, labels: string[], message: string): Promise<void> {
  await moveCard(ctx, issue, 'Done', 'merged', cardFlow(labels));
  forgetPosts(ctx, issue, true);
  rmSync(workDir(ctx, issue), { recursive: true, force: true });
  rmSync(`${ctx.cfg.home}/work/check-issue-${issue}`, { recursive: true, force: true });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, message);
}

// A routed committee reply. Every route lands on the issue with its route, and the ledger records it.
// An answer leaves the card and its post as they are. A patch or a redesign wins over an approval queued for the same issue,
// since the card leaves Approval. Returns whether it dropped one.
// A patch or a redesign takes the images the member sent with replies to the post. An answer leaves them for a later route.
// A patch goes back to Testing, whose session reads the reply from the issue as its whole task.
export async function routeFeedback(ctx: Ctx, issue: number, by: string, text: string, route: Route, post: number): Promise<boolean> {
  await requireApproval(ctx, issue);
  const state = readState(ctx.statePath);
  await ctx.github.comment(issue, routeComment(ctx, issue, by, text, route, post));
  appendLedger(ctx.cfg.home, { kind: 'route', issue, route, by, at: ctx.now().toISOString() });
  if (route === 'answer') return false;
  await moveCard(ctx, issue, route === 'patch' ? 'Testing' : 'Design', route);
  forgetPosts(ctx, issue, true);
  return String(issue) in state.pendingApprovals;
}

function routeComment(ctx: Ctx, issue: number, by: string, text: string, route: Route, post: number): string {
  if (route === 'answer') return `${QUESTION_HEADING}\n\nFrom ${by}, routed as answer:\n\n${text}`;
  const media = replyMediaLines(adoptReplyMedia(ctx.cfg.home, post, mediaDir(ctx, issue), by));
  return `${FEEDBACK_HEADING}\n\nFrom ${by}, routed as ${route}:\n\n${text}${media}`;
}

export async function deny(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  await closeCard(ctx, issue, `Denied by ${by} in the committee chat.`, 'denied');
}

// Drops the card from the pipeline for good: closed as not planned, in Done, with its bundle sent back to triage.
export async function closeCard(ctx: Ctx, issue: number, comment: string, step: 'denied' | 'dropped'): Promise<void> {
  await ctx.github.comment(issue, comment);
  if ((await ctx.github.pullRequestFor(BRANCH(issue))) !== null) await ctx.github.closePullRequest(BRANCH(issue), comment);
  await ctx.github.addLabel(issue, WONT_DO_LABEL);
  await ctx.github.close(issue, 'not planned');
  await moveCard(ctx, issue, 'Done', step);
  forgetPosts(ctx, issue, true);
  await releaseBundle(ctx, issue, 'was denied');
}
