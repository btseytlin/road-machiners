import { writeFileSync } from 'node:fs';
import { moveCard } from '../card-events';
import { readApproval } from '../clone-checks';
import { BRANCH, FEEDBACK_HEADING, GAME_DIR, OUT_DIR, TASK_FILE, type Ctx, type IssueComment } from '../types';
import { runCost, untilPasses } from './checkpoint';
import { POST_MARK, postCheckpoint, publishAndPost } from './checks';
import { hardenPrompt } from './harden';
import { HOTFIX_BASE, agentHome, baseBranchFor, docsOnly, fillPrompt, guardAndPush, mergeBase, playtestCommand, prepareOutputs, readOutput, requireBaseMerged, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';

const ROUND = 'test';

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  await writeIssueInput(ctx, issue, home);
  const merged = await mergeBase(ctx, issue, base, home, 'verify');
  if (readOutput(home, 'merge-conflicts.md') === null && await docsOnly(ctx, issue, base)) return docsRound(ctx, issue, base, home, merged);
  const hotfix = base === HOTFIX_BASE;
  const spent = await firstRounds(ctx, issue, base, hotfix);
  if (await redesigned(ctx, issue, home)) return;
  let build = '';
  await untilPasses(ctx.cfg.testingBudgetUsd, spent, async () => {
    build = await pushed(ctx, issue, base, merged);
    return checkpoint(ctx, issue, base, build, hotfix ? 'full' : 'preview', home);
  }, (failure) => fixRound(ctx, issue, home, failure));
  await publishAndPost(ctx, issue, readApproval(home), home, base, build, false);
}

async function firstRounds(ctx: Ctx, issue: number, base: string, hotfix: boolean): Promise<number> {
  let spent = 0;
  if (hotfix) spent += runCost(await runAgent(ctx, issue, 'verify', ROUND, await hardenPrompt(ctx, issue, base)));
  const vars = { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), playtest: playtestCommand(ctx.cfg, false), task: taskText(await ctx.github.comments(issue)) };
  spent += runCost(await runAgent(ctx, issue, 'verify', ROUND, fillPrompt('test', vars), { continue: hotfix }));
  return spent;
}

export function taskText(comments: IssueComment[]): string {
  const sincePost = [...comments].reverse();
  const lastPost = sincePost.findIndex((comment) => comment.body.startsWith(POST_MARK));
  const patch = (lastPost === -1 ? sincePost : sincePost.slice(0, lastPost)).find((comment) => comment.body.startsWith(FEEDBACK_HEADING));
  if (patch === undefined) return 'This round gets the change ready to show to the committee. They play it and approve it, send feedback or deny it.\nPlay the feature end to end in the browser, as the task file describes it.';
  return [
    'The committee played the last build and replied with the change below. It is the whole task of this round.',
    'Make that change and keep the rest as the committee played it. Check what you changed, and capture the views that show it.',
    'Lead the description in `.factory/approval.json` with what this round changed, so the committee knows where to look.',
    'Add one line under "Patches" in the Conclusion of the task file: what the committee asked and what you changed.',
    patch.body,
  ].join('\n');
}

async function redesigned(ctx: Ctx, issue: number, home: string): Promise<boolean> {
  throwIfNeedsCommittee(home);
  const reason = readOutput(home, 'needs-redesign.md');
  if (reason === null) return false;
  await ctx.github.comment(issue, `${FEEDBACK_HEADING}\n\nThe testing agent found that the plan must change:\n\n${reason.trim()}`);
  await moveCard(ctx, issue, 'Design', 'plan-wrong');
  return true;
}

async function pushed(ctx: Ctx, issue: number, base: string, merged: string): Promise<string> {
  await guardAndPush(ctx, issue, base, 'verify');
  await requireBaseMerged(ctx, issue, base, merged);
  return ctx.repo.headHash(BRANCH(issue));
}

async function checkpoint(ctx: Ctx, issue: number, base: string, build: string, kind: 'preview' | 'full', home: string): Promise<string | null> {
  try {
    readApproval(home);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return postCheckpoint(ctx, issue, base, build, kind);
}

async function fixRound(ctx: Ctx, issue: number, home: string, failure: string): Promise<string> {
  const prompt = `The factory's checks of your pushed branch failed. Fix the cause, commit, and end again. The end of the log:\n\n${failure}`;
  const stream = await runAgent(ctx, issue, 'verify', ROUND, prompt, { continue: true });
  throwIfNeedsCommittee(home);
  return stream;
}

async function docsRound(ctx: Ctx, issue: number, base: string, home: string, merged: string): Promise<void> {
  await guardAndPush(ctx, issue, base, 'verify');
  await requireBaseMerged(ctx, issue, base, merged);
  const files = await ctx.repo.changedFiles(base, BRANCH(issue));
  const approval = { description: `Docs only, the game does not change: ${files.join(', ')}`, howToTry: 'Read the diff in the pull request.' };
  writeFileSync(`${home}/${OUT_DIR}/approval.json`, JSON.stringify(approval));
  ctx.log('verify', issue, 'the branch changes docs only, so no test round');
  const build = await ctx.repo.headHash(BRANCH(issue));
  const failure = await postCheckpoint(ctx, issue, base, build, 'docs');
  if (failure !== null) throw new Error(`The build of a docs change failed.\n${failure}`);
  await publishAndPost(ctx, issue, approval, home, base, build, false);
}
