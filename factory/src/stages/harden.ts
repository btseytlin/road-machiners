import { cardFlow, moveCard } from '../card-events';
import { BRANCH, GAME_DIR, INCIDENT_LOG, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, baseBranchFor, docsOnly, fillPrompt, guardAndPush, mergeBase, prepareOutputs, readOutput, runAgent, throwIfNeedsCommittee, unfinishedBaseMerge, workDir, writeIssueInput } from './common';

const PRINCIPLES = `${GAME_DIR}/docs/architecture/principles.md`;

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  const { commit: merged, note } = await mergeBase(ctx, issue, base, home, 'harden');
  if (readOutput(home, 'merge-conflicts.md') === null && await docsOnly(ctx, issue, base)) ctx.log('harden', issue, 'a docs change, so no hardening agent');
  else await runAgent(ctx, issue, 'harden', 'harden', await hardenPrompt(ctx, issue, base, note));
  throwIfNeedsCommittee(home);
  await guardAndPush(ctx, issue, base, 'harden');
  const unfinished = await unfinishedBaseMerge(ctx, issue, base, merged);
  if (unfinished !== null) {
    await runAgent(ctx, issue, 'harden', 'harden', `The factory's check of your pushed branch failed. ${unfinished}`, { continue: true });
    throwIfNeedsCommittee(home);
    await guardAndPush(ctx, issue, base, 'harden');
    const still = await unfinishedBaseMerge(ctx, issue, base, merged);
    if (still !== null) throw new Error(still);
  }
  await moveCard(ctx, issue, 'Merging', 'hardened', cardFlow(item.labels));
}

export async function hardenPrompt(ctx: Ctx, issue: number, base: string, baseNote: string): Promise<string> {
  return fillPrompt('harden', {
    issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), base, baseNote,
    incidentLog: await ctx.repo.readFile(BASE_BRANCH, INCIDENT_LOG), principles: await ctx.repo.readFile(BASE_BRANCH, PRINCIPLES),
  });
}
