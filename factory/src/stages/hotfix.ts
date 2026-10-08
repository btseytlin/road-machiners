import { appendLedger } from '../ledger';
import { BRANCH, type Ctx } from '../types';
import { closeBundle } from './bundle';
import { HOTFIX_BASE } from './common';
import { queueIncidents } from './incident';
import { mergeResolving } from './merge-resolve';
import { itchKeys, publish } from './ship';

export async function shipHotfix(ctx: Ctx, issue: number, title: string, by: string): Promise<string> {
  const keys = itchKeys(ctx);
  await ctx.repo.fetch();
  await mergeResolving(ctx, 'approve', [
    { branch: BRANCH(issue), into: HOTFIX_BASE, message: `Hotfix #${issue}: ${title}` },
    { branch: HOTFIX_BASE, into: 'dev', message: `Merge main into dev after hotfix #${issue}` },
  ]);
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
  return `Hotfix #${issue} ${title} is on main and itch.io.`;
}
