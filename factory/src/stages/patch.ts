import { readEvidence } from '../evidence';
import { readState, updateState } from '../state';
import { visualWaiverOf } from '../visual-waiver';
import { BRANCH, FEEDBACK_HEADING, GAME_DIR, TASK_FILE, type Ctx } from '../types';
import { agentHome, baseBranchFor, fillPrompt, guardAndPush, prepareOutputs, readOutput, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';
import { mergeBase, readApproval, requireBaseMerged, setPhase } from './verify';

// Applies a small committee reply to a card the committee already played, in one agent run on the build model.
// It skips design and the code review, since the plan stands and the branch passed the review before. The factory checks run next as usual.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const played = readState(ctx.statePath).patching[String(issue)];
  if (played === undefined) throw new Error(`Issue #${issue} has no patch queued`);
  const base = baseBranchFor(ctx, (await ctx.github.issue(issue)).labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  const merged = await mergeBase(ctx, issue, base, home);
  await runAgent(ctx, issue, 'patch', 'patch', fillPrompt('patch', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), played }));
  throwIfNeedsCommittee(home);
  const redesign = readOutput(home, 'needs-redesign.md');
  if (redesign !== null) return toDesign(ctx, issue, redesign);
  const waived = visualWaiverOf(ctx, issue) !== null;
  readApproval(home, waived);
  await guardAndPush(ctx, issue, base, 'patch');
  await requireBaseMerged(ctx, issue, base, merged);
  if (!waived) readEvidence(home, await ctx.repo.headHash(BRANCH(issue)));
  endPatch(ctx, issue);
  setPhase(ctx, issue, 'checks');
  await ctx.github.move(issue, 'Testing');
}

// The agent found that the reply changes the plan. Design reads its reason next to the committee feedback.
async function toDesign(ctx: Ctx, issue: number, reason: string): Promise<void> {
  await ctx.github.comment(issue, `${FEEDBACK_HEADING}\n\nThe patch found that this reply needs a new plan:\n\n${reason.trim()}`);
  endPatch(ctx, issue);
  await ctx.github.move(issue, 'Design');
}

function endPatch(ctx: Ctx, issue: number): void {
  updateState(ctx.statePath, (state) => ({ ...state, patching: Object.fromEntries(Object.entries(state.patching).filter(([key]) => key !== String(issue))) }));
}
