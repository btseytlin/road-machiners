import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { changesSaveMajor } from '../save-guard';
import { GAME_DIR, MergeConflictError, RevertConflictError, type Ctx, type MergeStep, type Resolution, type Stage } from '../types';
import { factoryPaths } from '../diff-guard';
import { agentHome, fillPrompt, resetOutputs } from './common';
import { releaseLog } from './release-common';

const ISSUE_BRANCH = /^factory\/issue-\d+$/;

export async function mergeResolving(ctx: Ctx, stage: Stage, steps: MergeStep[]): Promise<void> {
  const resolutions: Resolution[] = [];
  for (;;) {
    try {
      await ctx.repo.merge(steps, resolutions);
      return;
    } catch (error) {
      if (!(error instanceof MergeConflictError) || ISSUE_BRANCH.test(error.branch)) throw error;
      resolutions.push(...error.done, await resolve(ctx, stage, error));
    }
  }
}

export async function revertResolving(ctx: Ctx, stage: Stage, issue: number, branch: string): Promise<boolean> {
  const resolutions: Resolution[] = [];
  for (;;) {
    try {
      return await ctx.repo.revertIssueMerge(issue, branch, resolutions);
    } catch (error) {
      if (!(error instanceof RevertConflictError)) throw error;
      resolutions.push(await resolve(ctx, stage, error));
    }
  }
}

async function resolve(ctx: Ctx, stage: Stage, conflict: MergeConflictError | RevertConflictError): Promise<Resolution> {
  const slug = conflict.into.replaceAll('/', '-');
  const dir = join(ctx.cfg.home, 'work', `merge-${slug}`);
  ctx.log(stage, null, `${conflict.message} An agent resolves it.`);
  await ctx.repo.openConflict(dir, conflict);
  resetOutputs(agentHome(dir, GAME_DIR));
  const files = conflict.files.map((file) => `- ${file}`).join('\n');
  const prompt = conflict instanceof MergeConflictError
    ? fillPrompt('merge-branches', { into: conflict.into, branch: conflict.branch, reason: conflict.step.message, files })
    : fillPrompt('revert-merge', { into: conflict.into, issue: String(conflict.issue), files });
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log: releaseLog(ctx, `merge-${slug}`) });
  const { resolution, diff } = await ctx.repo.closeConflict(dir, conflict);
  const leaked = factoryPaths(diff);
  if (leaked.length) throw new Error(`The agent's resolution on ${conflict.into} touches paths an agent may not push: ${leaked.join(', ')}`);
  if (conflict instanceof MergeConflictError && changesSaveMajor(diff)) {
    throw new Error(`The agent's resolution on ${conflict.into} bumps SAVE_MAJOR in game/src/three/save-migrations.ts. The committee must decide on a major save bump before this can go on.`);
  }
  rmSync(dir, { recursive: true, force: true });
  ctx.log(stage, null, `resolved on ${conflict.into} at ${resolution.head.slice(0, 7)}`);
  return resolution;
}
