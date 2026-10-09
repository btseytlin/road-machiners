import { stepScript } from '../activity';
import { moveCard } from '../card-events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deployDev } from '../deploy';
import { must } from '../exec';
import { releasePostDir } from '../release-post';
import { reportEnv, takeMaps } from '../sourcemaps';
import { updateState } from '../state';
import { BUG_LABEL, GAME_DIR, OUT_DIR, RELEASE_CANDIDATE_LABEL, type Ctx, type ReleasePost, type ReleaseState } from '../types';
import { withWorkFolder } from '../work-lock';
import { closeBundle } from './bundle';
import { agentLog, fillPrompt, resetOutputs } from './common';
import { checkAndPush, landingAgent, mergeIn, type Landing } from './merge';
import { queueIncidents } from './incident';
import { mergeResolving } from './merge-resolve';
import { candidateDir, changeLines, openReleaseTasks, releaseFeatures, releaseLog, requireRelease, type Feature } from './release-common';

export type ItchKeys = { itchTarget: string; butlerKey: string };

export function itchKeys(ctx: Ctx): ItchKeys {
  const { itchTarget, butlerKey } = ctx.cfg;
  if (!itchTarget || !butlerKey) throw new Error('A release needs ITCH_TARGET in factory/settings.env and BUTLER_API_KEY in factory/.env.');
  return { itchTarget, butlerKey };
}

async function requireShippable(ctx: Ctx, issue: number, by: string | null): Promise<ReleaseState> {
  if (by === null) throw new Error('Nobody asked to ship. A ship needs a Ship from a committee member.');
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  if (release.postId === null) throw new Error('The release has no current candidate post, so there is nothing to ship.');
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) throw new Error(`Release tasks are still open: ${open.map((n) => `#${n}`).join(', ')}.`);
  return release;
}

async function requirePlayed(ctx: Ctx, release: ReleaseState): Promise<void> {
  const head = await ctx.repo.headHash(release.branch);
  if (release.candidateSha !== head) throw new Error(`The release moved to ${head} after the candidate of ${release.candidateSha ?? 'an unknown commit'} was posted, so the committee has not played it. A new candidate follows.`);
}

function landRelease(ctx: Ctx, release: ReleaseState): Promise<void> {
  return withWorkFolder(ctx, 'ship-main', () => mergeRelease(ctx, release));
}

async function mergeRelease(ctx: Ctx, release: ReleaseState): Promise<void> {
  const dir = join(ctx.cfg.home, 'work', 'ship-main');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('main', 'main', dir);
  resetOutputs(join(dir, GAME_DIR));
  const land: Landing = { stage: 'ship', dir, into: 'main', guardAgainst: ['main', release.branch], agent: landingAgent(ctx, 'ship', dir, 'main') };
  const conflicts = await mergeIn(ctx, land, { branch: release.branch, message: `Release ${release.day}`, reason: `release ${release.day} ships` });
  await checkAndPush(ctx, land, conflicts, (failure) => fillPrompt('ship-fix', { release: release.branch, failure }));
}

export function publish(ctx: Ctx, keys: ItchKeys, logName: string): Promise<void> {
  return withWorkFolder(ctx, 'release-main', () => buildAndPush(ctx, keys, logName));
}

async function buildAndPush(ctx: Ctx, keys: ItchKeys, logName: string): Promise<void> {
  const dir = join(ctx.cfg.home, 'work', 'release-main');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('main', 'main', dir);
  const log = releaseLog(ctx, logName);
  await ctx.container.shell(dir, stepScript('Building the release', [['npm ci', 'npm ci'], ['build', 'npm run build']]), log, { SAVE_SCOPE: '', ...reportEnv(ctx.cfg, 'release') });
  await takeMaps(ctx, dir, 'release');
  const version = await ctx.repo.headHash('main');
  const args = ['push', join(dir, GAME_DIR, 'dist'), `${keys.itchTarget}:html5`, '--userversion', version];
  must(await ctx.run('butler', args, { env: { BUTLER_API_KEY: keys.butlerKey }, logPath: log }), 'butler push');
}

export async function ship(ctx: Ctx, issue: number, by: string | null): Promise<void> {
  const keys = itchKeys(ctx);
  const release = await requireShippable(ctx, issue, by);
  const clone = join(candidateDir(ctx), GAME_DIR, OUT_DIR);
  const screenshot = join(clone, 'screenshot.png');
  const notesPath = join(clone, 'release.md');
  if (!existsSync(screenshot) || !existsSync(notesPath)) throw new Error('The candidate screenshot or notes are gone from its work clone, so the public post cannot be made.');
  await ctx.repo.fetch();
  await requirePlayed(ctx, release);
  const features = await shippingFeatures(ctx, release);
  const changelog = changeLines(readFileSync(notesPath, 'utf8'), features).join('\n');
  await landRelease(ctx, release);
  await mergeResolving(ctx, 'ship', [{ branch: 'main', into: 'dev', message: `Merge main into dev after release ${release.day}` }]);
  await publish(ctx, keys, 'ship');
  const kept = join(releasePostDir(ctx.cfg.home, release.day), 'screenshot.png');
  mkdirSync(dirname(kept), { recursive: true });
  copyFileSync(screenshot, kept);
  const post: ReleasePost = { issue, day: release.day, changelog, screenshot: kept, postId: null, draft: null };
  await ctx.github.createRelease(`release-${release.day}`, 'main', `ROAM release ${release.day}`, changelog);
  await deployDev(ctx, agentLog(ctx, issue, 'ship'));
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
  await moveCard(ctx, issue, 'Done', 'shipped', 'release');
  updateState(ctx.statePath, (state) => {
    const builds = { ...state.builds };
    delete builds[String(issue)];
    return { ...state, release: null, releasePost: post, lastRelease: ctx.now().toISOString(), builds };
  });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Release ${release.day} shipped with ${features.length} changes. Hermes drafts the public post next.`);
  ctx.log('ship', issue, `shipped ${features.length} changes`);
}

async function shippingFeatures(ctx: Ctx, release: ReleaseState): Promise<Feature[]> {
  const sha = await ctx.repo.headHash(release.branch);
  if (release.shipping?.sha === sha) return release.shipping.features;
  const features = await releaseFeatures(ctx, release);
  updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, shipping: { sha, features } } }));
  return features;
}

async function anyBug(ctx: Ctx, issues: number[]): Promise<boolean> {
  for (const issue of issues) if ((await ctx.github.issue(issue)).labels.includes(BUG_LABEL)) return true;
  return false;
}
