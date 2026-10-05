import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deployDev } from '../deploy';
import { must } from '../exec';
import { appendLedger } from '../ledger';
import { updateState } from '../state';
import { BUG_LABEL, GAME_DIR, OUT_DIR, RELEASE_CANDIDATE_LABEL, type Ctx, type MergeStep, type ReleaseState } from '../types';
import { closeBundle } from './bundle';
import { agentLog } from './common';
import { queueIncidents } from './incident';
import { candidateDir, changeLines, openReleaseTasks, releaseFeatures, releaseLog, requireRelease } from './release-common';

export type ItchKeys = { itchTarget: string; butlerKey: string };

// Checked first, so a ship without them stops before it merges anything into main.
export function itchKeys(ctx: Ctx): ItchKeys {
  const { itchTarget, butlerKey } = ctx.cfg;
  if (!itchTarget || !butlerKey) throw new Error('A release needs ITCH_TARGET in factory/settings.env and BUTLER_API_KEY in factory/.env.');
  return { itchTarget, butlerKey };
}

// IV1 and IV3: a member pressed Ship on the current candidate post, and no release task is still open.
async function requireShippable(ctx: Ctx, issue: number, by: string | null): Promise<ReleaseState> {
  if (by === null) throw new Error('Nobody asked to ship. A ship needs a Ship from a committee member.');
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  if (release.postId === null) throw new Error('The release has no current candidate post, so there is nothing to ship.');
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) throw new Error(`Release tasks are still open: ${open.map((n) => `#${n}`).join(', ')}.`);
  return release;
}

// The release merges into main with no conflict once it holds all of main. The cut and hotfixes keep it so, but factory
// work lands on main directly. A game change on main was never in the played candidate, so Ship stops on it. Anything
// else merges into the release first. Returns that merge, or nothing when the release holds main already.
async function takeMain(ctx: Ctx, branch: string): Promise<MergeStep[]> {
  if (await ctx.repo.isMerged('main', branch)) return [];
  const unplayed = (await ctx.repo.changedFiles(branch, 'main')).filter((file) => file.startsWith(`${GAME_DIR}/`));
  if (unplayed.length > 0) throw new Error(`main changed ${unplayed.length} game files that ${branch} lacks, like ${unplayed[0]}, so the candidate was not played with them. Merge main into ${branch} and build a new candidate.`);
  return [{ branch: 'main', into: branch, message: `Merge main into ${branch} before the ship` }];
}

// Builds main in a fresh clone inside the container, so build code never runs next to the butler key.
// The empty save scope keeps the itch save key. Only the butler call gets the key.
export async function publish(ctx: Ctx, keys: ItchKeys, logName: string): Promise<void> {
  const dir = join(ctx.cfg.home, 'work', 'release-main');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('main', 'main', dir);
  const log = releaseLog(ctx, logName);
  await ctx.container.shell(dir, 'npm ci && npm run build', log, { SAVE_SCOPE: '' });
  const version = await ctx.repo.headHash('main');
  const args = ['push', join(dir, GAME_DIR, 'dist'), `${keys.itchTarget}:html5`, '--userversion', version];
  must(await ctx.run('butler', args, { env: { BUTLER_API_KEY: keys.butlerKey }, logPath: log }), 'butler push');
}

// Ships the release branch to main and itch.io, then posts the changelog and brings main back into dev.
export async function ship(ctx: Ctx, issue: number, by: string | null): Promise<void> {
  const keys = itchKeys(ctx);
  const release = await requireShippable(ctx, issue, by);
  const clone = join(candidateDir(ctx), GAME_DIR, OUT_DIR);
  const screenshot = join(clone, 'screenshot.png');
  const notesPath = join(clone, 'release.md');
  if (!existsSync(screenshot) || !existsSync(notesPath)) throw new Error('The candidate screenshot or notes are gone from its work clone, so the public post cannot be made.');
  await ctx.repo.fetch();
  const features = await releaseFeatures(ctx, release);
  // A changelog that does not match the release fails here, before anything public happens.
  const changelog = changeLines(readFileSync(notesPath, 'utf8'), features).join('\n');
  // One atomic push moves the release, main and dev, so a conflict or a rejected push fails here with nothing changed.
  await ctx.repo.merge([
    ...(await takeMain(ctx, release.branch)),
    { branch: release.branch, into: 'main', message: `Release ${release.day}` },
    { branch: 'main', into: 'dev', message: `Merge main into dev after release ${release.day}` },
  ]);
  await publish(ctx, keys, 'ship');
  const channel = ctx.cfg.publicChannel;
  await ctx.telegram.sendPhoto(channel, screenshot, `ROAM release ${release.day}`);
  const postId = await ctx.telegram.sendMessage(channel, changelog);
  appendLedger(ctx.cfg.home, { kind: 'post', id: postId, text: changelog, at: ctx.now().toISOString() });
  // Only the factory pushes main, so main still holds the release merge here.
  await ctx.github.createRelease(`release-${release.day}`, 'main', `ROAM release ${release.day}`, changelog);
  await deployDev(ctx, agentLog(ctx, issue, 'ship'));
  // Each shipped issue stayed open as a release candidate since its approval. It is on main and itch.io now, so it closes.
  // A lead whose bundle holds a bug gets an incident job too, since the lead's merge carries the fix.
  const bugs: number[] = [];
  for (const feature of features) {
    const shipped = `Shipped in release ${release.day}. It is on main and itch.io.`;
    await ctx.github.comment(feature.issue, shipped);
    await ctx.github.removeLabel(feature.issue, RELEASE_CANDIDATE_LABEL);
    await ctx.github.close(feature.issue, 'completed');
    const bundled = await closeBundle(ctx, feature.issue, shipped);
    if (await anyBug(ctx, [feature.issue, ...bundled])) bugs.push(feature.issue);
  }
  queueIncidents(ctx, bugs);
  await ctx.github.comment(issue, `Shipped by ${by} in the committee chat. Release ${release.day} is on main and itch.io.`);
  await ctx.github.close(issue, 'completed');
  await ctx.github.move(issue, 'Done');
  updateState(ctx.statePath, (state) => {
    const builds = { ...state.builds };
    delete builds[String(issue)];
    return { ...state, release: null, lastRelease: ctx.now().toISOString(), builds };
  });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Release ${release.day} shipped with ${features.length} changes.`);
  ctx.log('ship', issue, `shipped ${features.length} changes`);
}

async function anyBug(ctx: Ctx, issues: number[]): Promise<boolean> {
  for (const issue of issues) if ((await ctx.github.issue(issue)).labels.includes(BUG_LABEL)) return true;
  return false;
}
