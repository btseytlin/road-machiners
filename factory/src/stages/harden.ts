import { cardFlow, moveCard } from '../card-events';
import { BRANCH, GAME_DIR, INCIDENT_LOG, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, baseBranchFor, docsOnly, fillPrompt, guardAndPush, mergeBase, prepareOutputs, readOutput, requireBaseMerged, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';

const PRINCIPLES = `${GAME_DIR}/docs/architecture/principles.md`;

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  const merged = await mergeBase(ctx, issue, base, home, 'harden');
  if (readOutput(home, 'merge-conflicts.md') === null && await docsOnly(ctx, issue, base)) ctx.log('harden', issue, 'a docs change, so no hardening agent');
  else await runAgent(ctx, issue, 'harden', 'harden', await hardenPrompt(ctx, issue, base));
  throwIfNeedsCommittee(home);
  await guardAndPush(ctx, issue, base, 'harden');
  await requireBaseMerged(ctx, issue, base, merged);
  await moveCard(ctx, issue, 'Merging', 'hardened', cardFlow(item.labels));
}

export async function hardenPrompt(ctx: Ctx, issue: number, base: string): Promise<string> {
  return fillPrompt('harden', {
    issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), base,
    incidentLog: await ctx.repo.readFile(BASE_BRANCH, INCIDENT_LOG), principles: await ctx.repo.readFile(BASE_BRANCH, PRINCIPLES),
  });
}
