import { readState, updateState } from '../state';
import { appendLedger } from '../ledger';
import { BRANCH, type Ctx, type ReleaseState } from '../types';
import { closeBundle } from './bundle';
import { HOTFIX_BASE } from './common';
import { queueIncidents } from './incident';
import { itchKeys, publish } from './ship';

// An approved hotfix is a release of its own. Main takes it and goes to itch.io at once. Then dev and an open release take main, so no later ship drops the fix.
export async function shipHotfix(ctx: Ctx, issue: number, title: string, by: string): Promise<string> {
  const keys = itchKeys(ctx);
  const release = readState(ctx.statePath).release;
  await mergeEverywhere(ctx, issue, title, release);
  await publish(ctx, keys, `hotfix-${issue}`);
  const day = ctx.now().toISOString().slice(0, 10);
  const changelog = `ROAM hotfix ${day}\n\nFixed: #${issue} ${title}`;
  const postId = await ctx.telegram.sendMessage(ctx.cfg.publicChannel, changelog);
  appendLedger(ctx.cfg.home, { kind: 'post', id: postId, channel: ctx.cfg.publicChannel, text: changelog, at: ctx.now().toISOString() });
  await ctx.github.createRelease(`hotfix-${day}-issue-${issue}`, HOTFIX_BASE, `ROAM hotfix ${day}`, changelog);
  const shipped = `Approved by ${by} in the committee chat and shipped as a hotfix. It is on main and itch.io.`;
  await ctx.github.comment(issue, shipped);
  await ctx.github.close(issue, 'completed');
  await closeBundle(ctx, issue, shipped);
  queueIncidents(ctx, [issue]);
  const note = release ? `\nRelease ${release.day} took the fix, so its candidate is built again.` : '';
  return `Hotfix #${issue} ${title} is on main and itch.io.${note}`;
}

// One atomic push moves main, dev and the release together, so a conflict or a rejected push fails the job before anything is public.
async function mergeEverywhere(ctx: Ctx, issue: number, title: string, release: ReleaseState | null): Promise<void> {
  const others = release ? ['dev', release.branch] : ['dev'];
  await ctx.repo.fetch();
  await ctx.repo.merge([
    { branch: BRANCH(issue), into: HOTFIX_BASE, message: `Hotfix #${issue}: ${title}` },
    ...others.map((branch) => ({ branch: HOTFIX_BASE, into: branch, message: `Merge main into ${branch} after hotfix #${issue}` })),
  ]);
  // The candidate the committee played lacks the fix, so the release needs a new one before it can ship.
  if (release) updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
}
