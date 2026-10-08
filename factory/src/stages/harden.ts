import { cardFlow, moveCard } from '../card-events';
import { readState } from '../state';
import { BRANCH, GAME_DIR, isCleanupTask, type Ctx } from '../types';
import { approvedAlready, queueMerge } from './checks';
import { agentHome, baseBranchFor, catchUpBranch, docsOnly, fillPrompt, guardAndPush, prepareOutputs, runAgent, workDir, writeIssueInput } from './common';
import { reviewGate } from './review';
import { agentRound, fixRound, requireBaseMerged, setPhase } from './verify';

// The agent half of the Hardening column. The committee approved the card, and Testing already checked the build it played.
// Hardening runs the harden round and the review. The checks run again only when the branch head moved past that build, and then on the current base merged in.
// A cleanup task skips Testing, so it has no build and always gets the checks. It gets no harden round, and neither does a docs change.
// Phase `fix` runs the fix of a failed check, and `resolve` resolves a conflict that stopped approve.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  const approver = approvedAlready(ctx, issue, item.labels);
  if (approver === null) throw new Error(`Issue #${issue} is in Hardening with no recorded approval`);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  const phase = readState(ctx.statePath).testPhase[String(issue)];
  if (phase === 'fix') return fixRound(ctx, issue, base, 'harden');
  if (phase === 'resolve') return resolveRound(ctx, issue, base);
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  await catchUpBranch(ctx, issue, 'harden');
  await hardenRound(ctx, issue, base, item.labels);
  if (!(await reviewGate(ctx, issue, base, 'harden', async () => { await agentRound(ctx, issue, 'harden', 'test-fix', 'review-fix', base, false); }))) return;
  const head = await ctx.repo.headHash(BRANCH(issue));
  if (head !== readState(ctx.statePath).builds[String(issue)]) return checkIntegrated(ctx, issue, base);
  ctx.log('harden', issue, `the head is still the checked build ${head}, so no checks run`);
  await moveCard(ctx, issue, 'Approval', 'hardened', cardFlow(item.labels));
  queueMerge(ctx, issue, approver);
}

// The design and build of a cleanup task already were the cleanup, and a docs change has no code to verify, so the review alone checks them.
async function hardenRound(ctx: Ctx, issue: number, base: string, labels: string[]): Promise<void> {
  if (isCleanupTask(labels) || await docsOnly(ctx, issue, base)) return ctx.log('harden', issue, 'a cleanup task or a docs change, so no harden round');
  await agentRound(ctx, issue, 'harden', 'harden', 'harden', base, false);
}

// Approve hit a conflict with the base. The change already passed hardening and the review, and only the merge is new.
// A merge agent resolves the conflict, and the checks test the result before approve merges it.
async function resolveRound(ctx: Ctx, issue: number, base: string): Promise<void> {
  prepareOutputs(ctx, issue, agentHome(workDir(ctx, issue), GAME_DIR));
  await checkIntegrated(ctx, issue, base);
}

// The checks are long, and the base moves on meanwhile. Merging the current base first lets them test what approve merges,
// so approve meets a conflict only when the base moved again during the checks. A head still on the played build gets no merge, so it needs no checks.
async function checkIntegrated(ctx: Ctx, issue: number, base: string): Promise<void> {
  await catchUpBranch(ctx, issue, 'harden');
  const { commit, conflicts } = await ctx.repo.mergeBaseIntoWork(workDir(ctx, issue), base);
  ctx.log('harden', issue, `merged ${base} at ${commit.slice(0, 7)}${conflicts.length > 0 ? ` with conflicts in ${conflicts.join(', ')}` : ''}`);
  if (conflicts.length > 0) {
    const files = conflicts.map((file) => `- ${file}`).join('\n');
    const source = `The factory merged the current ${base} into your branch. It holds work merged after this issue was tested.`;
    await runAgent(ctx, issue, 'harden', 'base-merge', fillPrompt('branch-merge', { issue: String(issue), branch: BRANCH(issue), source, files }));
  }
  await guardAndPush(ctx, issue, base, 'harden');
  await requireBaseMerged(ctx, issue, base, commit);
  setPhase(ctx, issue, 'checks');
}
