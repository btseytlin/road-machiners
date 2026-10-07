import { writeFileSync } from 'node:fs';
import { readApproval } from '../clone-checks';
import { readShown } from '../evidence';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, RELEASE_TASK_LABEL, TASK_FILE, type CardStage, type Ctx, type TestPhase } from '../types';
import { reviewGate } from './review';
import { visualGate } from './visual';
import { HOTFIX_BASE, agentHome, baseBranchFor, catchUpBranch, fillPrompt, guardAndPush, playtestCommand, prepareOutputs, readOutput, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';

// What a testing round does. `preview` gets a card ready to show: the agent plays the feature, fixes what blocks it and captures the evidence, with no review.
// `harden` runs after the committee approved: verify, review, nitpicks and cost, with no post after it. `full` does both before the post.
export type TestMode = 'preview' | 'harden' | 'full';

// A hotfix ships the moment it is approved, so it gets the full round before its post. A cleanup task merges with no post, so it only hardens.
// Any other card hardens once a committee approval is recorded for it, and previews before that.
export function testMode(ctx: Ctx, issue: number, labels: string[]): TestMode {
  if (baseBranchFor(ctx, labels) === HOTFIX_BASE) return 'full';
  if (labels.includes(RELEASE_TASK_LABEL) && labels.includes(MAINTENANCE_LABEL)) return 'harden';
  return String(issue) in readState(ctx.statePath).approvedResolving ? 'harden' : 'preview';
}

// The agent half of testing. It runs in the verify queue, so the test slot stays free for the factory's own checks.
// A card with no phase gets the round of its mode, with the base merged first. A card in phase `fix` gets only the fix of a failed check.
// The full round hardens before it previews, so the evidence comes from the final code.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  const mode = testMode(ctx, issue, item.labels);
  if (readState(ctx.statePath).testPhase[String(issue)] === 'fix') return fixRound(ctx, issue, base, mode);
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  const merged = await mergeBase(ctx, issue, base, home, 'verify');
  if (mode === 'preview') {
    const shown = await agentRound(ctx, issue, 'test', 'test', base, true);
    await requireBaseMerged(ctx, issue, base, merged);
    if (!shown) return;
  } else {
    await agentRound(ctx, issue, 'harden', 'harden', base, false);
    await requireBaseMerged(ctx, issue, base, merged);
    if (!(await reviewGate(ctx, issue, base, async () => { await agentRound(ctx, issue, 'test-fix', 'review-fix', base, false); }))) return;
    if (mode === 'full' && !(await agentRound(ctx, issue, 'test', 'test', base, true))) return;
  }
  setPhase(ctx, issue, 'checks');
}

// The checks stage left the end of its log in `.factory/check-failure.md`, next to the approval and evidence of the first round.
// A hardening fix leaves no evidence, since no post follows it.
async function fixRound(ctx: Ctx, issue: number, base: string, mode: TestMode): Promise<void> {
  if (readOutput(agentHome(workDir(ctx, issue), GAME_DIR), 'check-failure.md') === null) throw new Error(`Issue #${issue} waits for a check fix, but its work clone has no .factory/check-failure.md`);
  if (!(await agentRound(ctx, issue, 'test-fix', 'checks-fix', base, mode !== 'harden'))) return;
  setPhase(ctx, issue, 'checks-after-fix');
}

export function setPhase(ctx: Ctx, issue: number, phase: TestPhase): void {
  updateState(ctx.statePath, (state) => ({ ...state, testPhase: { ...state.testPhase, [String(issue)]: phase } }));
  ctx.log('verify', issue, `test phase ${phase}`);
}

// The base moved on since design cut the branch. Testing runs on the branch with the current base merged in,
// so the committee plays what approve will merge, and conflicts reach the agent here instead of failing approve.
// The issue branch itself may have moved on GitHub too, so its new commits come in first and get tested with the rest.
// Returns the base commit it merged.
export async function mergeBase(ctx: Ctx, issue: number, base: string, home: string, stage: CardStage): Promise<string> {
  await catchUpBranch(ctx, issue, stage);
  const { commit, conflicts } = await ctx.repo.mergeBaseIntoWork(workDir(ctx, issue), base);
  if (conflicts.length > 0) writeFileSync(`${home}/${OUT_DIR}/merge-conflicts.md`, `${conflicts.map((file) => `- ${file}`).join('\n')}\n`);
  return commit;
}

// Checks the commit merged above, not the base branch. A parallel approval may move the base on meanwhile, and approve merges that newer base anyway.
export async function requireBaseMerged(ctx: Ctx, issue: number, base: string, commit: string): Promise<void> {
  if (!(await ctx.repo.isMerged(commit, BRANCH(issue)))) throw new Error(`The testing agent left the merge of ${base} at ${commit.slice(0, 7)} into ${BRANCH(issue)} unfinished.`);
}

// `round` names the session, so the review's fix and the checks' fix each resume their own conversation.
// A round that `shows` leaves the approval a post needs, and the evidence and the agent's reading of it when it captured any.
// Missing or broken evidence never fails the round. Returns false when the reading sent the card back, so no post follows.
async function agentRound(ctx: Ctx, issue: number, prompt: 'test' | 'harden' | 'test-fix', round: 'test' | 'harden' | 'review-fix' | 'checks-fix', base: string, shows: boolean): Promise<boolean> {
  const vars = { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), playtest: playtestCommand(ctx.cfg) };
  const visualRules = fillPrompt('visual-review', { taskFile: TASK_FILE(issue) }).trimEnd();
  const evidenceRules = shows ? `${fillPrompt('test-fix-evidence', vars).trimEnd()}\n\n${visualRules}` : 'No post follows this round, so leave the approval and the evidence as they are.';
  await runAgent(ctx, issue, 'verify', round, fillPrompt(prompt, prompt === 'test-fix' ? { ...vars, evidenceRules } : prompt === 'test' ? { ...vars, visualRules } : vars), { evidenceCheck: shows });
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  throwIfNeedsCommittee(home);
  if (shows) readApproval(home);
  await guardAndPush(ctx, issue, base, 'verify');
  if (!shows) return true;
  const head = await ctx.repo.headHash(BRANCH(issue));
  const shown = readShown(home, head);
  if (shown.problem !== null) ctx.log('verify', issue, shown.problem);
  if (shown.evidence === null) return true;
  return visualGate(ctx, issue, home, head, shown.evidence);
}
