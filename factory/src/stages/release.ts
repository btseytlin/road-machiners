import { addCard } from '../card-events';
import { updateState } from '../state';
import { MAINTENANCE_LABEL, RELEASE_LABEL, RELEASE_TASK_LABEL, type Ctx } from '../types';
import { fillPrompt } from './common';
import { featureLine, featureMerges } from './release-common';

// The two cleanup tasks of a release. Each runs the normal stages on the release branch and needs no committee post.
const CLEANUP_TASKS = [
  { title: 'Optimize one slow spot', prompt: 'release-optimize' },
  { title: 'Code janitor pass', prompt: 'release-janitor' },
] as const;

// The cut. It opens a release when dev has features main lacks, and stops there. The committee decides the rest.
export async function release(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  // Recorded first, so a failed cut waits a full interval instead of cutting again on the next tick.
  updateState(ctx.statePath, (state) => ({ ...state, lastRelease: now.toISOString() }));
  await ctx.repo.fetch();
  await bringMainIntoDev(ctx);
  const features = featureMerges(await ctx.repo.mergeLog('dev', 'main'));
  if (features.length === 0) {
    ctx.log('release', null, 'nothing new on dev, skipped');
    return;
  }
  const day = now.toISOString().slice(0, 10);
  const branch = `release/${day}`;
  await ctx.repo.createBranch(branch, 'dev');
  const body = `The factory cut branch ${branch} from dev.\n\nFeatures:\n${features.map((feature) => `- ${featureLine(feature)}`).join('\n')}\n\nThe candidate post in the committee chat comes when the cleanup tasks are done.`;
  const tracking = await ctx.github.createIssue(`Release ${day}`, body, [RELEASE_LABEL]);
  // Set at once, so a failure below still names this issue and the tick sees an open release.
  updateState(ctx.statePath, (state) => ({ ...state, release: { issue: tracking, branch, day, postId: null, removed: [] } }));
  await addCard(ctx, tracking, 'Approval', 'release');
  for (const task of CLEANUP_TASKS) {
    const n = await ctx.github.createIssue(`${task.title} (release ${day})`, fillPrompt(task.prompt, {}), [RELEASE_TASK_LABEL, MAINTENANCE_LABEL]);
    await addCard(ctx, n, 'Design', 'release-task');
  }
  ctx.log('release', tracking, `cut ${branch} with ${features.length} features`);
}

// main can hold work dev lacks, like a merge made by hand on GitHub. The release merges into main at Ship, so the cut
// must hold main already. Otherwise the committee plays a candidate without that work. A conflict fails the cut before any branch exists.
async function bringMainIntoDev(ctx: Ctx): Promise<void> {
  if (await ctx.repo.isMerged('main', 'dev')) return;
  await ctx.repo.merge([{ branch: 'main', into: 'dev', message: 'Merge main into dev before the release cut' }]);
  ctx.log('release', null, 'merged main into dev before the cut');
}
