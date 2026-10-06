import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAndDeploy, recordBuild } from '../deploy';
import { readEvidence, type Evidence } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { readState, updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { bundleOf } from './bundle';
import { agentHome, fillPrompt, playtestCommand, readOutput, resetOutputs } from './common';
import { candidateDir, changeLines, featureLine, openReleaseTasks, releaseFeatures, releaseLog, requireRelease, trackingLink, type Feature } from './release-common';

// The build of the candidate lives under this web folder, kept while the tracking card waits in Approval.
export const CANDIDATE_SCOPE = 'rc';

const SERVER_TRIES = 60;

// Starts the dev server with a bounded wait, plays the game, keeps the newest screenshot, then stops the server.
const playtestScript = (playtest: string) => `set -u
mkdir -p ${OUT_DIR}
npm ci
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
  ${playtest} || status=$?
else
  echo "dev server did not start in ${SERVER_TRIES} seconds"
fi
kill "$server" || true
[ "$status" = 0 ] || exit "$status"
shot=$(ls -t .playtest/*.png | head -n 1)
cp "$shot" ${OUT_DIR}/screenshot.png
`;

// Posts the release branch as a playable candidate. Ship acts on this post alone.
export async function candidate(ctx: Ctx, issue: number): Promise<void> {
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  await ctx.repo.fetch();
  const features = await releaseFeatures(ctx, release);
  const dir = candidateDir(ctx);
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone(release.branch, release.branch, dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(join(home, OUT_DIR, 'changelog.md'), await changelogInput(ctx, features));
  const log = releaseLog(ctx, 'candidate');
  await ctx.container.shell(dir, playtestScript(playtestCommand(ctx.cfg)), log);
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.designModel, prompt: fillPrompt('release', {}), log });
  const notes = readOutput(home, 'release.md');
  if (notes === null) throw new Error('release agent wrote no .factory/release.md');
  const changes = changeLines(notes, features).join('\n') || 'No changes in this candidate.';
  const url = await buildAndDeploy(ctx, dir, CANDIDATE_SCOPE, log);
  recordBuild(ctx.statePath, issue, CANDIDATE_SCOPE);
  const pr = (await ctx.github.pullRequestFor(release.branch)) ?? await ctx.github.openPullRequest(release.branch, 'main', `Release ${release.day}`, `The release candidate of ${release.day}. The factory merges it when the committee presses Ship.`);
  // A reply to the old post can open a release task while this build runs. This build lacks that task, so it is not posted.
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) return ctx.log('candidate', issue, `not posted, release tasks opened during the build: ${open.map((n) => `#${n}`).join(', ')}`);
  await ctx.github.comment(issue, `Release candidate: ${url}\n\n${changes}`);
  const caption = candidateCaption(release.day, url, trackingLink(ctx, issue), pr, features.length);
  const buttons = [[{ text: 'Ship', data: `factory:ship:${issue}` }]];
  const evidence = await candidateEvidence(ctx, issue, home, release.branch);
  const photoId = await postWithEvidence(ctx, evidence, caption, buttons, {
    add: (id) => updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, postId: id }, postCaptions: { ...state.postCaptions, [id]: caption } })),
    drop: (id) => updateState(ctx.statePath, (state) => ({ ...state, release: state.release && { ...state.release, postId: null }, postCaptions: Object.fromEntries(Object.entries(state.postCaptions).filter(([name]) => name !== String(id))) })),
  });
  // A caption holds 1024 characters, so the whole changelog goes in a message under the post. It splits only past Telegram's message limit.
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, changes, photoId);
}

// The release agent may add views of the changes in `.factory/evidence.json`. Those are optional, so a manifest that fails a rule is logged and the one screenshot stands.
async function candidateEvidence(ctx: Ctx, issue: number, home: string, branch: string): Promise<Evidence> {
  try {
    return readEvidence(home, await ctx.repo.headHash(branch));
  } catch (error) {
    ctx.log('candidate', issue, `evidence manifest ignored: ${error instanceof Error ? error.message : String(error)}`);
    return { images: [{ path: join(home, OUT_DIR, 'screenshot.png'), description: '', covers: [], sheet: false }], features: [] };
  }
}

// One line per change, with the issues bundled into it indented under it, so the changelog sums up a bundle in one line.
async function changelogInput(ctx: Ctx, features: Feature[]): Promise<string> {
  const state = readState(ctx.statePath);
  const lines: string[] = [];
  for (const feature of features) {
    lines.push(featureLine(feature));
    for (const bundled of bundleOf(state, feature.issue)) lines.push(`  bundled: #${bundled} ${(await ctx.github.issue(bundled)).title}`);
  }
  return `${lines.join('\n')}\n`;
}

// The candidate post. The changelog follows in a message under it.
export function candidateCaption(day: string, url: string, link: string, pr: string, count: number): string {
  const head = `ROAM release candidate ${day}\n\nPlay: ${url}\nPR: ${pr}\nIssue: ${link}`;
  const changes = count === 0 ? 'No changes in this candidate.' : `${count} changes, listed in the message under this post.`;
  return [head, changes].join('\n\n');
}
