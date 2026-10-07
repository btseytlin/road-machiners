import { writeFileSync } from 'node:fs';
import { readApproval } from '../clone-checks';
import { readShown } from '../evidence';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, OUT_DIR, TASK_FILE, type CardStage, type Ctx, type TestPhase } from '../types';
import { reviewGate } from './review';
import { visualGate } from './visual';
import { HOTFIX_BASE, agentHome, baseBranchFor, catchUpBranch, docsOnly, fillPrompt, guardAndPush, playtestCommand, prepareOutputs, readOutput, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';

// What a testing round does. `preview` gets a card ready to show: the agent plays the feature, fixes what blocks it and captures the evidence, with no review.
// `full` also hardens and reviews before the post. Other approved cards harden in the Hardening column.
export type TestMode = 'preview' | 'full';

// A hotfix ships the moment it is approved, so it gets the full round before its post.
export function testMode(ctx: Ctx, labels: string[]): TestMode {
  return baseBranchFor(ctx, labels) === HOTFIX_BASE ? 'full' : 'preview';
}

// The agent half of testing. It runs in the verify queue, so the test slot stays free for the factory's own checks.
// A card with no phase gets the round of its mode, with the base merged first. A card in phase `fix` gets only the fix of a failed check.
// The full round hardens before it previews, so the evidence comes from the final code.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  if (readState(ctx.statePath).testPhase[String(issue)] === 'fix') return fixRound(ctx, issue, base, 'verify');
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  const merged = await mergeBase(ctx, issue, base, home, 'verify');
  if (await agentRounds(ctx, issue, base, testMode(ctx, item.labels), merged, home)) setPhase(ctx, issue, 'checks');
}

// Plays the rounds of the mode. False means the card went elsewhere, so no checks follow.
// A docs change gets no harden or test round. A conflict with the base still needs the round agent to resolve it.
async function agentRounds(ctx: Ctx, issue: number, base: string, mode: TestMode, merged: string, home: string): Promise<boolean> {
  const docs = readOutput(home, 'merge-conflicts.md') === null && await docsOnly(ctx, issue, base);
  if (mode === 'full') {
    if (!docs) {
      await agentRound(ctx, issue, 'verify', 'harden', 'harden', base, false);
      await requireBaseMerged(ctx, issue, base, merged);
    }
    if (!(await reviewGate(ctx, issue, base, 'verify', async () => { await agentRound(ctx, issue, 'verify', 'test-fix', 'review-fix', base, false); }))) return false;
  }
  if (docs) return docsRound(ctx, issue, base, home, merged);
  const shown = await agentRound(ctx, issue, 'verify', 'test', 'test', base, true);
  await requireBaseMerged(ctx, issue, base, merged);
  return shown;
}

// A docs change has nothing to play. The factory pushes the base merge and writes the post text a test round would write.
async function docsRound(ctx: Ctx, issue: number, base: string, home: string, merged: string): Promise<boolean> {
  await guardAndPush(ctx, issue, base, 'verify');
  await requireBaseMerged(ctx, issue, base, merged);
  const files = await ctx.repo.changedFiles(base, BRANCH(issue));
  const approval = { description: `Docs only, the game does not change: ${files.join(', ')}`, howToTry: 'Read the diff in the pull request.' };
  writeFileSync(`${home}/${OUT_DIR}/approval.json`, JSON.stringify(approval));
  ctx.log('verify', issue, 'the branch changes docs only, so no test round');
  return true;
}

// The checks stage left the end of its log in `.factory/check-failure.md`, next to the approval and evidence of the first round.
// A fix in Testing captures the evidence its post needs. A fix in Hardening leaves no evidence, since no post follows it.
export async function fixRound(ctx: Ctx, issue: number, base: string, stage: 'verify' | 'harden'): Promise<void> {
  if (readOutput(agentHome(workDir(ctx, issue), GAME_DIR), 'check-failure.md') === null) throw new Error(`Issue #${issue} waits for a check fix, but its work clone has no .factory/check-failure.md`);
  if (!(await agentRound(ctx, issue, stage, 'test-fix', 'checks-fix', base, stage === 'verify'))) return;
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
export async function agentRound(ctx: Ctx, issue: number, stage: 'verify' | 'harden', prompt: 'test' | 'harden' | 'test-fix', round: 'test' | 'harden' | 'review-fix' | 'checks-fix', base: string, shows: boolean): Promise<boolean> {
  await runAgent(ctx, issue, stage, round, roundPrompt(ctx, issue, prompt, shows), { evidenceCheck: shows });
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  throwIfNeedsCommittee(home);
  if (shows) readApproval(home);
  await guardAndPush(ctx, issue, base, stage);
  return shows ? showEvidence(ctx, issue, home) : true;
}

function roundPrompt(ctx: Ctx, issue: number, prompt: 'test' | 'harden' | 'test-fix', shows: boolean): string {
  const vars = { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), playtest: playtestCommand(ctx.cfg, false) };
  if (prompt === 'harden') return fillPrompt(prompt, vars);
  const visualRules = fillPrompt('visual-review', { taskFile: TASK_FILE(issue) }).trimEnd();
  if (prompt === 'test') return fillPrompt(prompt, { ...vars, visualRules });
  const evidenceRules = shows ? `${fillPrompt('test-fix-evidence', vars).trimEnd()}\n\n${visualRules}` : 'No post follows this round, so leave the approval and the evidence as they are.';
  return fillPrompt(prompt, { ...vars, evidenceRules });
}

// A shown round's evidence goes through the visual gate. A round with a broken or missing evidence report passes, since evidence never blocks.
async function showEvidence(ctx: Ctx, issue: number, home: string): Promise<boolean> {
  const head = await ctx.repo.headHash(BRANCH(issue));
  const shown = readShown(home, head);
  if (shown.problem !== null) ctx.log('verify', issue, shown.problem);
  if (shown.evidence === null) return true;
  return visualGate(ctx, issue, home, head, shown.evidence);
}
