import { BRANCH, GAME_DIR, TASK_FILE, type Ctx } from '../types';
import { agentHome, baseBranchOf, fillPrompt, guardAndPush, prepareOutputs, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  const base = await baseBranchOf(ctx, issue);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, clone);
  const home = agentHome(clone, GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  await runAgent(ctx, issue, 'implement', 'implement', fillPrompt('implement', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  throwIfNeedsCommittee(home);
  const head = await ctx.repo.fetchFromWork(clone, BRANCH(issue));
  if (await ctx.repo.isMerged(head, BRANCH(issue))) throw new Error('The implementation stage made no new commits');
  await guardAndPush(ctx, issue, base, 'implement');
  await ctx.github.move(issue, 'Testing');
}
