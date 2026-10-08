import { cardFlow, moveCard } from '../card-events';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { readApproval, type Approval } from '../clone-checks';
import { readShown, type Shown } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { checkScope, publishBuild, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, OUT_DIR, type Ctx, type InlineButton } from '../types';
import { bundleOf } from './bundle';
import { HOTFIX_BASE, agentHome, agentLog, baseBranchFor, playtestCommand, workDir } from './common';

// Each step logs its start time, so the log shows where the time goes.
// The typecheck runs beside the tests. The build ends the script, so a passing check leaves dist/ ready to publish.
// Only the build gets SAVE_SCOPE, since the tests expect the default save key.
// The game's cached runner skips test files whose inputs already passed, with its cache mounted at /test-cache.
// A branch cut before the runner reached dev has no test:cached script and runs the full suite. Remove that path once no open branch lacks the script.
export const checkScript = (playtest: string) => `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
mkdir -p tmp
step "npm ci"
npm ci
step "tests and typecheck"
npm run typecheck > tmp/typecheck.log 2>&1 &
typecheck=$!
if grep -q '"test:cached"' package.json; then
  npm run test:cached -- --cache /test-cache
else
  step "branch has no test:cached, full suite"
  npm test
fi
step "tests done"
if ! wait "$typecheck"; then cat tmp/typecheck.log; exit 1; fi
step "dev server"
npm run dev -- --port 5173 --strictPort > tmp/dev-server.log 2>&1 &
server=$!
ready=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:5173 > /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then kill "$server"; exit 1; fi
step "playtest"
set +e
${playtest}
code=$?
kill "$server"
if [ "$code" -ne 0 ]; then exit "$code"; fi
set -e
step "build"
SAVE_SCOPE="$BUILD_SCOPE" npm run build
step "done"
`;

// The checkpoint before a committee post: the typecheck, the playtest and the build, with no suite. The suite runs once, before the merge.
export const previewScript = (playtest: string) => `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
mkdir -p tmp
step "npm ci"
npm ci
step "typecheck"
npm run typecheck
step "dev server"
npm run dev -- --port 5173 --strictPort > tmp/dev-server.log 2>&1 &
server=$!
ready=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:5173 > /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then kill "$server"; exit 1; fi
step "playtest"
set +e
${playtest}
code=$?
kill "$server"
if [ "$code" -ne 0 ]; then exit "$code"; fi
set -e
step "build"
SAVE_SCOPE="$BUILD_SCOPE" npm run build
step "done"
`;

// The build alone, for a card a control move put in Approval and for a docs change. No test, typecheck or playtest runs.
export const buildScript = `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
mkdir -p tmp
step "npm ci"
npm ci
step "build"
SAVE_SCOPE="$BUILD_SCOPE" npm run build
step "done"
`;

// A control move put the card in Approval. The branch head is built and posted once, with no checks and no agent. A failed build throws.
// The post says no checks ran. A clone with no approval text gets one that points to the pull request.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  if (!readState(ctx.statePath).postOnly.includes(issue)) throw new Error(`Issue #${issue} is not waiting for a post with no checks`);
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  const build = await ctx.repo.headHash(BRANCH(issue));
  const failure = await runScript(ctx, issue, base, build, buildScript);
  if (failure !== null) throw new Error(`The build failed, no factory checks ran.\n${failure}`);
  await publishAndPost(ctx, issue, approvalOrDefault(home), home, base, build, true);
  updateState(ctx.statePath, (state) => ({ ...state, postOnly: state.postOnly.filter((n) => n !== issue) }));
}

const DEFAULT_APPROVAL: Approval = { description: 'No testing agent wrote notes for this build. The pull request shows what changed.', howToTry: 'Play the build and try the change the issue asks for.' };

function approvalOrDefault(home: string): Approval {
  return existsSync(`${home}/${OUT_DIR}/approval.json`) ? readApproval(home) : DEFAULT_APPROVAL;
}

// Publishes the build the checkpoint left in the check clone, posts it to the committee and moves the card to Approval.
export async function publishAndPost(ctx: Ctx, issue: number, approval: Approval, home: string, base: string, build: string, unchecked: boolean): Promise<void> {
  const url = publishBuild(ctx, checkDir(ctx, issue), build);
  recordBuild(ctx.statePath, issue, build);
  await post(ctx, issue, approval, readShown(home), url, base, unchecked);
  await moveCard(ctx, issue, 'Approval', 'posted', cardFlow((await ctx.github.issue(issue)).labels));
}

function checkDir(ctx: Ctx, issue: number): string {
  return `${ctx.cfg.home}/work/check-issue-${issue}`;
}

// The checkpoint before a post, in a fresh clone of the pushed branch. Agent claims do not count.
// A docs change only builds. A hotfix ships on approval, so it also runs the suite. Timeouts alone rerun with no agent.
// Passing checks leave the build of scope `build` in the clone. Returns null on a pass, or the tail of the log.
export async function postCheckpoint(ctx: Ctx, issue: number, base: string, build: string, kind: 'docs' | 'preview' | 'full'): Promise<string | null> {
  if (kind === 'docs') return runScript(ctx, issue, base, build, buildScript);
  const playtest = playtestCommand(ctx.cfg, false);
  const script = kind === 'full' ? checkScript(playtest) : previewScript(playtest);
  return checkUntilReal(() => runScript(ctx, issue, base, build, script), (run) => ctx.log('verify', issue, `the checks only timed out, run ${run} of ${CHECK_RUNS}, running them again`));
}

// Every run of checkScript mounts the shared test cache, so passes recorded by one job skip tests in the next.
export function testCacheMount(ctx: Ctx): Record<string, string> {
  const cache = `${ctx.cfg.home}/test-cache`;
  mkdirSync(cache, { recursive: true });
  return { [cache]: '/test-cache' };
}

async function runScript(ctx: Ctx, issue: number, base: string, build: string, script: string): Promise<string | null> {
  checkScope(build);
  const dir = checkDir(ctx, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, dir);
  const log = agentLog(ctx, issue, 'checks');
  try {
    await ctx.container.shell(dir, script, log, { BUILD_SCOPE: build }, testCacheMount(ctx));
    return null;
  } catch (error) {
    return checkFailure(log, error);
  }
}

// Vitest's messages when a test, a hook or the runner itself ran out of time.
const TIMEOUT_LINE = /(Test|Hook) timed out in \d+ms|Timeout calling "onTaskUpdate"/;

// Whether every error in a check failure is a timeout. Such a failure says the machine was slow, not that the code is wrong.
// A failure with no error line at all, like a failed playtest or typecheck, is a real one.
export function timeoutOnly(failure: string): boolean {
  const errors = failure.split('\n').filter((line) => /Error:|timed out in/.test(line));
  return errors.length > 0 && errors.every((line) => TIMEOUT_LINE.test(line));
}

// Two reruns ride out a burst of load. A third timeout means the load stays, and Hermes has to look.
export const CHECK_RUNS = 3;

// Runs the checks until they pass or fail for a real reason. Timeouts alone rerun the checks with no agent round,
// since an agent would only raise the time limits. Returns null on a pass, or the real failure. Throws after CHECK_RUNS timeouts.
export async function checkUntilReal(check: () => Promise<string | null>, onTimeout: (run: number) => void): Promise<string | null> {
  for (let run = 1; ; run++) {
    const failure = await check();
    if (failure === null || !timeoutOnly(failure)) return failure;
    if (run === CHECK_RUNS) throw new Error(`The factory checks timed out ${CHECK_RUNS} times, under load. No test failed for another reason.\n${failure}`);
    onTimeout(run);
  }
}

const FAILURE_TAIL_LINES = 150;

export function checkFailure(log: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-FAILURE_TAIL_LINES).join('\n') : message;
  return stripAnsi(tail);
}

// The start of the issue comment of each post. Feedback after the last one belongs to the build it posted.
export const POST_MARK = 'Ready for approval:';

// Telegram caps a photo caption at 1024 characters.
export const CAPTION_LIMIT = 1024;
const TRIM_MARK = '…';

// The approval post is the primary photo with everything in its caption, and the only post with buttons. The full notes also go on the issue.
// Further evidence images follow as a reply photo or album, which no command acts on.
// A post with no screenshot is a text message with the same buttons, mapping and reply routing. It says up front that it has no screenshot.
export async function post(ctx: Ctx, issue: number, approval: Approval, shown: Shown, url: string, base: string, unchecked = false): Promise<void> {
  const { evidence, problem } = shown;
  const item = await ctx.github.issue(issue);
  const link = `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const pr = await pullRequestUrl(ctx, issue, item.title, approval, base);
  const notice = `${problem === null ? '' : `⚠️ ${problem}\n\n`}${unchecked ? `${UNCHECKED_NOTICE}\n\n` : ''}`;
  await ctx.github.comment(issue, `${POST_MARK} ${url}\n\n${notice}${approval.description}\n\nHow to try: ${approval.howToTry}`);
  const caption = approvalCaption(`#${issue} ${item.title}`, url, link, pr, approval, base, evidence === null, unchecked);
  const track = {
    add: (id: number) => updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: { ...state.approvalPosts, [id]: issue }, postCaptions: { ...state.postCaptions, [id]: caption }, textPosts: evidence === null ? [...state.textPosts, String(id)] : state.textPosts })),
    drop: (id: number) => updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: omit(state.approvalPosts, id), postCaptions: omit(state.postCaptions, id), textPosts: state.textPosts.filter((name) => name !== String(id)) })),
  };
  if (evidence !== null) {
    await postWithEvidence(ctx, evidence, caption, approvalButtons(issue, base), track);
    return;
  }
  track.add(await ctx.telegram.sendButtons(ctx.cfg.committeeChat, caption, approvalButtons(issue, base)));
}

function omit<T>(record: Record<string, T>, key: number): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== String(key)));
}

// A feedback round reuses the pull request of the first round.
async function pullRequestUrl(ctx: Ctx, issue: number, title: string, approval: Approval, base: string): Promise<string> {
  const open = await ctx.github.pullRequestFor(BRANCH(issue));
  if (open !== null) return open;
  const closes = [issue, ...bundleOf(readState(ctx.statePath), issue)].map((n) => `#${n}`).join(', ');
  const body = `Closes ${closes}.\n\n${approval.description}\n\nHow to try: ${approval.howToTry}\n\nThe factory merges it when the committee approves.`;
  return ctx.github.openPullRequest(BRANCH(issue), base, `#${issue} ${title}`, body);
}

export function approvalButtons(issue: number, base: string): InlineButton[][] {
  const approveText = base === HOTFIX_BASE ? 'Approve and ship to players' : 'Approve';
  return [[{ text: approveText, data: `factory:approve:${issue}` }, { text: 'Deny', data: `factory:deny:${issue}` }]];
}

const UNCHECKED_NOTICE = '⚠️ No factory checks ran on this build.';

// A hotfix skips dev and the release, so its post opens with a warning the committee cannot miss.
function warningsOf(base: string, noScreenshot: boolean, unchecked: boolean): string {
  const hotfix = base === HOTFIX_BASE ? '⚠️ HOTFIX. Approve merges into main and ships to players at once. Play it with care.\n\n' : '';
  const unseen = noScreenshot ? '⚠️ No screenshot. Judge it by playing.\n\n' : '';
  const unverified = unchecked ? `${UNCHECKED_NOTICE}\n\n` : '';
  return `${hotfix}${unseen}${unverified}`;
}

export function approvalCaption(title: string, url: string, link: string, pr: string, approval: Approval, base: string, noScreenshot = false, unchecked = false): string {
  const warning = warningsOf(base, noScreenshot, unchecked);
  const head = `${warning}${title}\n\nPlay: ${url}\nIssue: ${link}\nPR: ${pr}`;
  const room = CAPTION_LIMIT - head.length - '\n\n'.repeat(2).length - 'How to try: '.length;
  const [description, howToTry] = fitBoth(approval.description, approval.howToTry, room);
  return [head, description, `How to try: ${howToTry}`].join('\n\n');
}

// Shortens the two texts to fit the room, cutting the longer one first. The full texts are on the issue.
function fitBoth(first: string, second: string, room: number): [string, string] {
  if (first.length + second.length <= room) return [first, second];
  const half = Math.floor(room / 2);
  const firstRoom = Math.max(half, room - second.length);
  const cutFirst = cut(first, firstRoom);
  return [cutFirst, cut(second, room - cutFirst.length)];
}

export function cut(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - TRIM_MARK.length).trimEnd()}${TRIM_MARK}`;
}
