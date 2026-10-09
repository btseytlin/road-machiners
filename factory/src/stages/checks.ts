import { cardFlow, moveCard } from '../card-events';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { CHECKS_TIMEOUT_MARK } from '../container';
import { readApproval, type Approval } from '../clone-checks';
import { readShown, type Shown } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { checkScope, publishBuild, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, OUT_DIR, type Ctx, type InlineButton, type Stage } from '../types';
import { bundleOf } from './bundle';
import { HOTFIX_BASE, agentHome, agentLog, baseBranchFor, playtestCommand, workDir } from './common';

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

export const buildScript = `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
mkdir -p tmp
step "npm ci"
npm ci
step "build"
SAVE_SCOPE="$BUILD_SCOPE" npm run build
step "done"
`;

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

export async function publishAndPost(ctx: Ctx, issue: number, approval: Approval, home: string, base: string, build: string, unchecked: boolean): Promise<void> {
  const url = publishBuild(ctx, checkDir(ctx, issue), build);
  recordBuild(ctx.statePath, issue, build);
  await post(ctx, issue, approval, readShown(home), url, base, unchecked);
  await moveCard(ctx, issue, 'Approval', 'posted', cardFlow((await ctx.github.issue(issue)).labels));
}

function checkDir(ctx: Ctx, issue: number): string {
  return `${ctx.cfg.home}/work/check-issue-${issue}`;
}

export async function postCheckpoint(ctx: Ctx, issue: number, base: string, build: string, kind: 'docs' | 'preview' | 'full'): Promise<string | null> {
  if (kind === 'docs') return runScript(ctx, issue, base, build, buildScript);
  const playtest = playtestCommand(ctx.cfg, false);
  const script = kind === 'full' ? checkScript(playtest) : previewScript(playtest);
  return checkUntilReal(() => runScript(ctx, issue, base, build, script, 'verify'), (run) => ctx.log('verify', issue, `the checks only timed out, run ${run} of ${CHECK_RUNS}, running them again`));
}

export function testCacheMount(ctx: Ctx): Record<string, string> {
  const cache = `${ctx.cfg.home}/test-cache`;
  mkdirSync(cache, { recursive: true });
  return { [cache]: '/test-cache' };
}

async function runScript(ctx: Ctx, issue: number, base: string, build: string, script: string, stage: Stage = 'checks'): Promise<string | null> {
  checkScope(build);
  const dir = checkDir(ctx, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, dir);
  return runChecks(ctx, { stage, issue }, dir, script, agentLog(ctx, issue, 'checks'), { BUILD_SCOPE: build });
}

const PROGRESS_MS = 5 * 60_000;

export async function runChecks(ctx: Ctx, at: { stage: Stage; issue: number | null }, dir: string, script: string, log: string, env: Record<string, string>): Promise<string | null> {
  const started = Date.now();
  const from = existsSync(log) ? statSync(log).size : 0;
  const progress = setInterval(() => ctx.log(at.stage, at.issue, checksProgress(log, started)), PROGRESS_MS);
  try {
    await ctx.container.shell(dir, script, log, env, testCacheMount(ctx), ctx.cfg.checksTimeoutMinutes);
    return null;
  } catch (error) {
    return checkFailure(log, error, from);
  } finally {
    clearInterval(progress);
  }
}

export function checksProgress(log: string, started: number): string {
  const minutes = Math.round((Date.now() - started) / 60_000);
  if (!existsSync(log)) return `the checks still run after ${minutes} min, with no log yet`;
  const step = readFileSync(log, 'utf8').match(/^\[checks\] .*$/gm)?.at(-1) ?? 'no step yet';
  return `the checks still run after ${minutes} min, log ${Math.round(statSync(log).size / 1024)} KB, last step: ${step}`;
}

const TIMEOUT_LINE = new RegExp(`(Test|Hook) timed out in \\d+ms|Timeout calling "onTaskUpdate"|${CHECKS_TIMEOUT_MARK} [\\d.]+ minute limit`);

export function timeoutOnly(failure: string): boolean {
  const errors = failure.split('\n').filter((line) => /Error:|timed out in/.test(line));
  return errors.length > 0 && errors.every((line) => TIMEOUT_LINE.test(line));
}

export const CHECK_RUNS = 3;

export async function checkUntilReal(check: () => Promise<string | null>, onTimeout: (run: number) => void): Promise<string | null> {
  for (let run = 1; ; run++) {
    const failure = await check();
    if (failure === null || !timeoutOnly(failure)) return failure;
    if (run === CHECK_RUNS) throw new Error(`The factory checks timed out ${CHECK_RUNS} times, under load or in a hung step. No test failed for another reason.\n${failure}`);
    onTimeout(run);
  }
}

const FAILURE_TAIL_LINES = 150;

function checkFailure(log: string, error: unknown, from: number): string {
  const message = error instanceof Error ? error.message : String(error);
  const written = existsSync(log) ? readFileSync(log).subarray(from).toString('utf8') : '';
  const tail = written.trim() === '' ? message : written.split('\n').slice(-FAILURE_TAIL_LINES).join('\n');
  return stripAnsi(tail);
}

export const POST_MARK = 'Ready for approval:';

export const CAPTION_LIMIT = 1024;
const TRIM_MARK = '…';

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
  };
  if (evidence !== null) {
    await postWithEvidence(ctx, evidence, caption, approvalButtons(issue, base), track, { stage: 'checks', issue });
    return;
  }
  track.add(await ctx.telegram.sendButtons(ctx.cfg.committeeChat, caption, approvalButtons(issue, base)));
}

async function pullRequestUrl(ctx: Ctx, issue: number, title: string, approval: Approval, base: string): Promise<string> {
  const open = await ctx.github.pullRequestFor(BRANCH(issue));
  if (open !== null) return open;
  const closes = [issue, ...bundleOf(readState(ctx.statePath), issue)].map((n) => `#${n}`).join(', ');
  const body = `Closes ${closes}.\n\n${approval.description}\n\nHow to try: ${approval.howToTry}\n\nThe factory merges it after the committee approves it and it passes hardening and the merge checks.`;
  return ctx.github.openPullRequest(BRANCH(issue), base, `#${issue} ${title}`, body);
}

export function approvalButtons(issue: number, base: string): InlineButton[][] {
  const approveText = base === HOTFIX_BASE ? 'Approve and ship to players' : 'Approve';
  return [[{ text: approveText, data: `factory:approve:${issue}` }, { text: 'Deny', data: `factory:deny:${issue}` }]];
}

const UNCHECKED_NOTICE = '⚠️ No factory checks ran on this build.';

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
