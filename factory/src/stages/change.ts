import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { roundSession } from '../sessions';
import { updateState, readState } from '../state';
import { FACTORY_DIR, OUT_DIR, TASK_DIR, type Ctx } from '../types';
import { prBody, prGuide, prTitle } from './change-pr';
import { RESUME_NOTE, agentHome, agentLog, fillPrompt, isResuming, prepareOutputs, readOutput, useOpenNetwork } from './common';

// Every path a unified diff touches, from its `diff --git a/x b/y` headers.
export function diffPaths(diff: string): string[] {
  const paths: string[] = [];
  for (const match of diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)) paths.push(match[1], match[2]);
  return [...new Set(paths)];
}

// The server runs main's factory code and settings, and deploys each new main. So a factory change starts from main and merges into it.
const CHANGE_BASE = 'main';

// The change agent's task file, in the gitignored task folder of its clone, like a game issue's.
export const CHANGE_TASK_FILE = (id: number): string => `${TASK_DIR}/change-${id}.md`;

// Runs one committee request to change the factory, or anything else in the repo, through up:make and opens a pull request that only a human merges.
export async function change(ctx: Ctx, id: number): Promise<void> {
  const request = readState(ctx.statePath).pendingChanges.find((item) => item.id === id);
  if (!request) throw new Error(`no pending factory change ${id}`);
  const dir = join(ctx.cfg.home, 'work', `change-${id}`);
  const branch = `factory-change/${id}`;
  const resuming = isResuming(ctx, id);
  if (!resuming) rmSync(dir, { recursive: true, force: true });
  await ctx.repo.fetch();
  await ctx.repo.prepareWorkClone(branch, CHANGE_BASE, dir);
  const home = agentHome(dir, FACTORY_DIR);
  prepareOutputs(ctx, id, home);
  writeFileSync(join(home, OUT_DIR, 'request.md'), `Committee request from ${request.by}:\n\n${request.text}\n`);
  await runChangeAgent(ctx, id, dir, resuming);
  const head = await ctx.repo.fetchFromWork(dir, branch);
  if (!(await ctx.repo.hasNewCommits(CHANGE_BASE, head))) throw new Error(`change ${id} made no commits`);
  const paths = diffPaths(await ctx.repo.diff(CHANGE_BASE, head));
  await ctx.repo.push(head, branch);
  const title = prTitle(readOutput(home, 'pr-title.txt'), id);
  const body = prBody(readOutput(home, 'pr-body.md'), request.by, request.text, paths);
  const url = await ctx.github.openPullRequest(branch, CHANGE_BASE, title, body);
  updateState(ctx.statePath, (state) => ({ ...state, pendingChanges: state.pendingChanges.filter((item) => item.id !== id) }));
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Factory change ${id} is ready for review: ${url}`);
  ctx.log('change', id, `opened ${url}`);
}

// The agent runs on the design model, since it designs and plans as well as builds. A resumed job continues its session in the clone it left.
async function runChangeAgent(ctx: Ctx, id: number, dir: string, resuming: boolean): Promise<void> {
  const session = roundSession(ctx.cfg.home, id, 'change', resuming);
  if (session.resume) ctx.log('change', id, `resuming round change, session ${session.id}`);
  const prompt = session.resume ? RESUME_NOTE : fillPrompt('change', { taskFile: CHANGE_TASK_FILE(id), prGuide: prGuide() });
  await ctx.container.agent({ clone: dir, dir: FACTORY_DIR, model: ctx.cfg.designModel, prompt, log: agentLog(ctx, id, 'change'), openNetwork: await useOpenNetwork(ctx, 'change', null), session });
}
