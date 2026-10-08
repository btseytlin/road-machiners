import { STEP_FUNCTION, phaseLine } from '../activity';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAndDeploy, recordBuild } from '../deploy';
import { readShown, type Evidence } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { readState, updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx, type ReleaseState } from '../types';
import { bundleOf } from './bundle';
import { agentHome, fillPrompt, playtestCommand, readOutput, resetOutputs } from './common';
import { candidateDir, changeLines, featureLine, openReleaseTasks, releaseFeatures, releaseLog, requireRelease, trackingLink, type Feature } from './release-common';

export const CANDIDATE_SCOPE = 'rc';

const SERVER_TRIES = 60;

const playtestScript = (playtest: string) => `set -u
${STEP_FUNCTION}
${phaseLine('Playing the candidate')}
mkdir -p ${OUT_DIR}
step "npm ci"
npm ci
step "dev server"
npm run dev > ${OUT_DIR}/dev-server.log 2>&1 &
server=$!
ready=0
for i in $(seq 1 ${SERVER_TRIES}); do
  if curl -sf http://localhost:5173 > /dev/null; then ready=1; break; fi
  sleep 1
done
status=1
if [ "$ready" = 1 ]; then
  status=0
  step "playtest"
  ${playtest} || status=$?
else
  echo "dev server did not start in ${SERVER_TRIES} seconds"
fi
kill "$server" || true
[ "$status" = 0 ] || exit "$status"
shot=$(ls -t .playtest/*.png | head -n 1)
cp "$shot" ${OUT_DIR}/screenshot.png
step "done"
`;

export async function candidate(ctx: Ctx, issue: number): Promise<void> {
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  const sha = await requirePlaytested(ctx, release);
  const features = await releaseFeatures(ctx, release);
  const dir = candidateDir(ctx);
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone(release.branch, release.branch, dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(join(home, OUT_DIR, 'changelog.md'), await changelogInput(ctx, features));
  const log = releaseLog(ctx, 'candidate');
  await ctx.container.shell(dir, playtestScript(playtestCommand(ctx.cfg, true)), log);
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.designModel, prompt: fillPrompt('release', {}), log });
  const notes = readOutput(home, 'release.md');
  if (notes === null) throw new Error('release agent wrote no .factory/release.md');
  const changes = changeLines(notes, features).join('\n') || 'No changes in this candidate.';
  const url = await buildAndDeploy(ctx, dir, CANDIDATE_SCOPE, log, 'candidate');
  recordBuild(ctx.statePath, issue, CANDIDATE_SCOPE);
  const pr = (await ctx.github.pullRequestFor(release.branch)) ?? await ctx.github.openPullRequest(release.branch, 'main', `Release ${release.day}`, `The release candidate of ${release.day}. The factory merges it when the committee presses Ship.`);
  if (await staleBuild(ctx, release, sha)) return;
  await ctx.github.comment(issue, `Release candidate: ${url}\n\n${changes}`);
  const caption = candidateCaption(release.day, url, trackingLink(ctx, issue), pr, features.length);
  const buttons = [[{ text: 'Ship', data: `factory:ship:${issue}` }]];
  const evidence = candidateEvidence(ctx, issue, home);
  const photoId = await postWithEvidence(ctx, evidence, caption, buttons, {
    add: (id) => updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, postId: id, candidateSha: sha }, postCaptions: { ...state.postCaptions, [id]: caption } })),
    drop: (id) => updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, postId: null, candidateSha: null }, postCaptions: Object.fromEntries(Object.entries(state.postCaptions).filter(([name]) => name !== String(id))) })),
  });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, changes, photoId);
}

async function requirePlaytested(ctx: Ctx, release: ReleaseState): Promise<string> {
  await ctx.repo.fetch();
  const sha = await ctx.repo.headHash(release.branch);
  const passed = release.playtest.passed;
  if (passed !== sha) throw new Error(`The release playtest has not passed the release head ${sha}${passed ? `, only ${passed}` : ''}, so no candidate builds`);
  return sha;
}

async function staleBuild(ctx: Ctx, release: ReleaseState, sha: string): Promise<boolean> {
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) {
    ctx.log('candidate', release.issue, `not posted, release tasks opened during the build: ${open.map((n) => `#${n}`).join(', ')}`);
    return true;
  }
  await ctx.repo.fetch();
  const head = await ctx.repo.headHash(release.branch);
  if (head === sha) return false;
  ctx.log('candidate', release.issue, `not posted, the release moved from ${sha} to ${head} during the build`);
  return true;
}

function candidateEvidence(ctx: Ctx, issue: number, home: string): Evidence {
  const { evidence, problem } = readShown(home);
  if (problem !== null) ctx.log('candidate', issue, problem);
  if (evidence === null) throw new Error(`The release agent wrote no usable .factory/screenshot.png: ${problem ?? 'no reason'}`);
  return evidence;
}

async function changelogInput(ctx: Ctx, features: Feature[]): Promise<string> {
  const state = readState(ctx.statePath);
  const lines: string[] = [];
  for (const feature of features) {
    lines.push(featureLine(feature));
    for (const bundled of bundleOf(state, feature.issue)) lines.push(`  bundled: #${bundled} ${(await ctx.github.issue(bundled)).title}`);
  }
  return `${lines.join('\n')}\n`;
}

export function candidateCaption(day: string, url: string, link: string, pr: string, count: number): string {
  const head = `ROAM release candidate ${day}\n\nPlay: ${url}\nPR: ${pr}\nIssue: ${link}`;
  const changes = count === 0 ? 'No changes in this candidate.' : `${count} changes, listed in the message under this post.`;
  return [head, changes].join('\n\n');
}
