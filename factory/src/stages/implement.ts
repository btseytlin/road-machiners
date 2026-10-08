import { moveCard } from '../card-events';
import { BRANCH, GAME_DIR, TASK_FILE, isCleanupTask, type Ctx } from '../types';
import { agentHome, baseBranchOf, fillPrompt, guardAndPush, prepareOutputs, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';

export const IMPLEMENT_DISALLOWED = ['Agent'];

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  const base = await baseBranchOf(ctx, issue);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, clone);
  const home = agentHome(clone, GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  await runAgent(ctx, issue, 'implement', 'implement', fillPrompt('implement', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }), { disallowedTools: IMPLEMENT_DISALLOWED });
  throwIfNeedsCommittee(home);
  const head = await ctx.repo.fetchFromWork(clone, BRANCH(issue));
  if (await ctx.repo.isMerged(head, base)) throw new Error(`The implementation stage left ${BRANCH(issue)} with no commits beyond ${base}`);
  await guardAndPush(ctx, issue, base, 'implement');
  await moveCard(ctx, issue, isCleanupTask((await ctx.github.issue(issue)).labels) ? 'Hardening' : 'Testing', 'built');
}
