import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readApproval, type Approval } from '../clone-checks';
import { readShown, type Shown } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { checkScope, publishBuild, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, RELEASE_TASK_LABEL, STUCK_LABEL, type Ctx, type InlineButton, type TestPhase } from '../types';
import { bundleOf } from './bundle';
import { HOTFIX_BASE, agentHome, agentLog, baseBranchFor, playtestCommand, workDir } from './common';
import { setPhase } from './verify';

// Each step logs its start time, so the log shows where the time goes.
// The typecheck runs beside the tests. The script ends after the playtest, and BUILD_SCRIPT follows it, so a frame rate under the minimum can still build.
// The host line before the playtest records the load the frame rate was measured under. The container sees the host's load and memory.
const checkScript = (playtest: string) => `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
mkdir -p tmp
step "npm ci"
npm ci
step "tests and typecheck"
npm run typecheck > tmp/typecheck.log 2>&1 &
typecheck=$!
npm test
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
step "host: $(nproc) cpus, load $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null), $(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null) MB memory available"
step "playtest"
set +e
${playtest}
code=$?
kill "$server"
exit "$code"
`;

// A passing check leaves dist/ ready to publish. Only the build gets SAVE_SCOPE, since the tests expect the default save key.
const BUILD_SCRIPT = `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
step "build"
SAVE_SCOPE="$BUILD_SCOPE" npm run build
step "done"
`;

// The machine half of testing. It runs no agent, so it holds the test slot only for the checks and the build.
// It checks the branch head that verify or a patch pushed, with the approval and evidence they left in the work clone.
// A first failure hands the card to verify for one fix round. A failure after that fix stops the card.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const phase = checksPhase(ctx, issue);
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  const build = await ctx.repo.headHash(BRANCH(issue));
  // An approved card merges with no post, so only a card that will be posted needs the approval. It is read before the checks, so a missing one fails fast.
  const approver = approvedAlready(ctx, issue, item.labels);
  const approval = approver === null ? readApproval(home) : null;
  // Timeouts and browser crashes alone rerun here. A real failure goes to verify for one fix round. Three cut-short runs throw with the phase kept, so a retry runs the checks again.
  const { failure, lowFps } = await checkPatiently(ctx, issue, base, build);
  if (failure !== null) return failed(ctx, issue, home, phase, failure);
  const url = publishBuild(ctx, checkDir(ctx, issue), build);
  recordBuild(ctx.statePath, issue, build);
  if (lowFps !== null) await recordLowFps(ctx, issue, build, lowFps);
  if (approval !== null) await post(ctx, issue, approval, readShown(home, build), url, base);
  clearPhase(ctx, issue);
  await ctx.github.move(issue, 'Approval');
  if (approver !== null) queueMerge(ctx, issue, approver);
}

function checksPhase(ctx: Ctx, issue: number): TestPhase {
  const phase = readState(ctx.statePath).testPhase[String(issue)];
  if (phase !== 'checks' && phase !== 'checks-after-fix') throw new Error(`Issue #${issue} is not ready for checks, its test phase is ${phase ?? 'none'}`);
  return phase;
}

// The phase goes on a second failure too, so a retry after Hermes clears the stuck label starts again from verify.
async function failed(ctx: Ctx, issue: number, home: string, phase: TestPhase, failure: string): Promise<void> {
  if (phase === 'checks-after-fix') {
    clearPhase(ctx, issue);
    throw new Error(`The factory checks failed twice.\n${failure}`);
  }
  writeFileSync(`${home}/${OUT_DIR}/check-failure.md`, failure);
  setPhase(ctx, issue, 'fix');
}

function clearPhase(ctx: Ctx, issue: number): void {
  updateState(ctx.statePath, (state) => ({ ...state, testPhase: omit(state.testPhase, issue) }));
}

// Who approved the card before this round, or null when it needs a committee post.
// Cleanup tasks on the release branch skip the post, since the committee plays them in the candidate.
// A card approved after its preview, or before a conflict sent it back here, keeps its approval.
function approvedAlready(ctx: Ctx, issue: number, labels: string[]): string | null {
  if (labels.includes(RELEASE_TASK_LABEL) && labels.includes(MAINTENANCE_LABEL)) return 'the factory';
  return readState(ctx.statePath).approvedResolving[String(issue)] ?? null;
}

// The way back for an approved card whose checks failed twice, often from a loaded host. It runs no agent round.
// The next tick runs the fresh-clone checks on the branch head as it stands. A pass publishes the build and queues the merge of the recorded approval.
// The phase is checks-after-fix, so a real failure stops the card again instead of starting another fix round.
export async function queueRecheck(ctx: Ctx, issue: number): Promise<string> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Testing' || !card.labels.includes(STUCK_LABEL)) throw new Error(`Issue #${issue} is no stuck card in Testing.`);
  const approver = approvedAlready(ctx, issue, card.labels);
  if (approver === null) throw new Error(`Issue #${issue} has no recorded approval, so it must post first. Remove the stuck label to start again from verify.`);
  if (readState(ctx.statePath).jobs.some((job) => job.issue === issue)) throw new Error(`A job runs on #${issue}. Wait for it to end.`);
  setPhase(ctx, issue, 'checks-after-fix');
  await ctx.github.comment(issue, `Recheck: the factory checks run again on the unchanged branch in a fresh clone, with no agent round. A pass publishes the build and queues the merge approved by ${approver}. A failure stops the card again.`);
  await ctx.github.removeLabel(issue, STUCK_LABEL);
  return `Recheck of #${issue} is queued. The checks run on a coming tick.`;
}

// The merge runs as an approve job in the branch queue, like a member's approval, so it never races another branch job.
function queueMerge(ctx: Ctx, issue: number, by: string): void {
  updateState(ctx.statePath, (state) => ({ ...state, pendingApprovals: { ...state.pendingApprovals, [String(issue)]: by } }));
  ctx.log('checks', issue, `approved by ${by} already, merge queued`);
}

function checkDir(ctx: Ctx, issue: number): string {
  return `${ctx.cfg.home}/work/check-issue-${issue}`;
}

// `failure` is null when the checks pass, or the tail of the check log. `lowFps` is set when they passed with a frame rate under the minimum.
type CheckResult = { failure: string | null; lowFps: LowFps | null };

// The host runs its own checks in a fresh clone of the pushed branch. Agent claims do not count.
// Passing checks leave the build of scope `build` in the clone. A playtest that finished every turn and failed only the frame rate still builds.
async function runChecks(ctx: Ctx, issue: number, base: string, build: string): Promise<CheckResult> {
  checkScope(build);
  const dir = checkDir(ctx, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, dir);
  const log = agentLog(ctx, issue, 'checks');
  const failure = await shellStep(ctx, dir, checkScript(playtestCommand(ctx.cfg)), log);
  const lowFps = failure === null ? null : lowFpsOf(failure);
  if (failure !== null && lowFps === null) return { failure, lowFps };
  if (lowFps !== null) ctx.log('checks', issue, `${lowFpsLine(lowFps)} Host: ${lowFps.host}.`);
  return { failure: await shellStep(ctx, dir, BUILD_SCRIPT, log, { BUILD_SCOPE: build }), lowFps };
}

// Returns null when the script passes, or the tail of the check log.
async function shellStep(ctx: Ctx, dir: string, script: string, log: string, env: Record<string, string> = {}): Promise<string | null> {
  try {
    await ctx.container.shell(dir, script, log, env);
    return null;
  } catch (error) {
    return checkFailure(log, error);
  }
}

// The committee waived the playtest's frame-rate minimum, since a loaded host fails it on sound builds. It is advisory: measured and recorded, never blocking.
// Every other playtest problem, and a playtest that never finished, still fails the checks.
export type LowFps = { fps: number; min: number; host: string };
export type PlaytestVerdict = { kind: 'low-fps'; lowFps: LowFps } | { kind: 'browser-crash' } | { kind: 'other' };

const OTHER: PlaytestVerdict = { kind: 'other' };
// Step lines of the check script, and the lines the game's playtest prints: a summary after a finished run, then FAIL and one problem per line.
const RUN_START = /^\[checks\] \S+ npm ci$/;
const PLAYTEST_STEP = /^\[checks\] \S+ playtest$/;
const HOST_STEP = /^\[checks\] \S+ host: (.*)$/;
const SUMMARY = /^turns \d+, fps [\d.]+$/;
const LOW_FPS = /^fps ([\d.]+) under ([\d.]+)$/;
// npm's report of the failed script, and the shell's note on the killed dev server, end the playtest's own lines.
const PLAYTEST_END = /^npm (error|ERR!)|Terminated/;
// Playwright's errors when Chromium crashed or closed under the playtest. Such a run never finished, so it is no frame-rate failure and never passes.
const BROWSER_CRASH = /Target crashed|Page crashed|Target page, context or browser has been closed|Browser has been closed|browser has disconnected/i;

// Reads the last run in a check failure. `low-fps`: the playtest finished and its only problem is the frame rate.
// `browser-crash`: the playtest never finished, since its browser went away. `other`: any other failure.
export function playtestVerdict(failure: string): PlaytestVerdict {
  const lines = lastRun(failure.split('\n').map((line) => line.trim()));
  const start = lines.findIndex((line) => PLAYTEST_STEP.test(line));
  if (start < 0) return OTHER;
  const played = lines.slice(start + 1);
  if (!played.some((line) => SUMMARY.test(line))) return played.some((line) => BROWSER_CRASH.test(line)) ? { kind: 'browser-crash' } : OTHER;
  const host = lines.slice(0, start).map((line) => HOST_STEP.exec(line)?.[1]).find((match) => match !== undefined) ?? 'not recorded';
  return lowFpsOnly(played, host);
}

// The log appends every run, so a rerun's tail can hold the end of the run before it.
function lastRun(lines: string[]): string[] {
  const starts = lines.flatMap((line, index) => (RUN_START.test(line) ? [index] : []));
  return starts.length === 0 ? lines : lines.slice(starts[starts.length - 1]);
}

function lowFpsOnly(played: string[], host: string): PlaytestVerdict {
  const fail = played.lastIndexOf('FAIL');
  if (fail < 0) return OTHER;
  const after = played.slice(fail + 1);
  const end = after.findIndex((line) => PLAYTEST_END.test(line));
  // The summary goes to stdout and the problems to stderr, so the summary can land among them.
  // Only blank lines at the end are dropped. A blank line among the problems is an empty console error, which blocks.
  const problems = trimEnd(end < 0 ? after : after.slice(0, end)).filter((line) => !SUMMARY.test(line));
  const low = problems.length === 1 ? LOW_FPS.exec(problems[0]) : null;
  return low === null ? OTHER : { kind: 'low-fps', lowFps: { fps: Number(low[1]), min: Number(low[2]), host } };
}

function trimEnd(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end -= 1;
  return lines.slice(0, end);
}

function lowFpsOf(failure: string): LowFps | null {
  const verdict = playtestVerdict(failure);
  return verdict.kind === 'low-fps' ? verdict.lowFps : null;
}

function lowFpsLine(low: LowFps): string {
  return `Playtest frame rate ${low.fps} fps, under the ${low.min} fps minimum. It is advisory under the committee's waiver, so it does not block the card.`;
}

// The issue keeps the measured frame rate, the host load and the waiver, so a reviewer can tell a slow build from a busy host.
async function recordLowFps(ctx: Ctx, issue: number, build: string, low: LowFps): Promise<void> {
  const body = [
    `${lowFpsLine(low)}`,
    `The playtest of build ${build} finished every turn with no crash screen, page error or blank canvas, and the tests, typecheck and build passed.`,
    `Host during the playtest: ${low.host}.`,
    'The committee waived the frame-rate minimum because a loaded host fails it on sound builds. A playtest that fails in any other way, or never finishes, still blocks the card.',
  ];
  await ctx.github.comment(issue, body.join('\n\n'));
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
const CHECK_RUNS = 3;

// Runs the checks until they pass or fail for a real reason. Timeouts alone, or a crashed playtest browser, rerun the unchanged build
// with no agent round, since an agent would only raise the time limits. Throws after CHECK_RUNS such runs, and none of them passed.
async function checkPatiently(ctx: Ctx, issue: number, base: string, build: string): Promise<CheckResult> {
  for (let run = 1; ; run++) {
    const result = await runChecks(ctx, issue, base, build);
    const cut = result.failure === null ? null : cutShort(result.failure);
    if (cut === null) return result;
    if (run === CHECK_RUNS) throw new Error(`${CUT_SHORT[cut]}\n${result.failure}`);
    ctx.log('checks', issue, `the checks were cut short by ${cut}, run ${run} of ${CHECK_RUNS}, running them again on the unchanged build`);
  }
}

type CutShort = 'timeouts' | 'a browser crash';
const CUT_SHORT: Record<CutShort, string> = {
  timeouts: `The factory checks timed out ${CHECK_RUNS} times, under load. No test failed for another reason.`,
  'a browser crash': `The playtest browser crashed before the playtest finished, after ${CHECK_RUNS} runs, under load or low memory. It is no frame-rate failure, and no run passed. Retry once the load falls.`,
};

// Why a failure says the host was overloaded, not that the code is wrong. Null for a real failure.
function cutShort(failure: string): CutShort | null {
  if (timeoutOnly(failure)) return 'timeouts';
  return playtestVerdict(failure).kind === 'browser-crash' ? 'a browser crash' : null;
}

const FAILURE_TAIL_LINES = 150;

function checkFailure(log: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-FAILURE_TAIL_LINES).join('\n') : message;
  return stripAnsi(tail);
}

// Telegram caps a photo caption at 1024 characters.
export const CAPTION_LIMIT = 1024;
const TRIM_MARK = '…';

// The approval post is the primary photo with everything in its caption, and the only post with buttons. The full notes also go on the issue.
// Further evidence images follow as a reply photo or album, which no command acts on.
// A post with no screenshot is a text message with the same buttons, mapping and reply routing. It says up front that it has no screenshot.
export async function post(ctx: Ctx, issue: number, approval: Approval, shown: Shown, url: string, base: string): Promise<void> {
  const { evidence, problem } = shown;
  const item = await ctx.github.issue(issue);
  const link = `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const pr = await pullRequestUrl(ctx, issue, item.title, approval, base);
  const notice = problem === null ? '' : `⚠️ ${problem}\n\n`;
  await ctx.github.comment(issue, `Ready for approval: ${url}\n\n${notice}${approval.description}\n\nHow to try: ${approval.howToTry}`);
  const caption = approvalCaption(`#${issue} ${item.title}`, url, link, pr, approval, base, evidence === null);
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

export function approvalCaption(title: string, url: string, link: string, pr: string, approval: Approval, base: string, noScreenshot = false): string {
  // A hotfix skips dev and the release, so its post opens with a warning the committee cannot miss.
  const hotfix = base === HOTFIX_BASE ? '⚠️ HOTFIX. Approve merges into main and ships to players at once. Play it with care.\n\n' : '';
  const unseen = noScreenshot ? '⚠️ No screenshot. Judge it by playing.\n\n' : '';
  const warning = `${hotfix}${unseen}`;
  const head = `${warning}${title}\n\nPlay: ${url}\nIssue: ${link}\nPR: ${pr}`;
  const action = base === HOTFIX_BASE ? 'Approve ships this hotfix to main and itch.io at once.' : `Approve runs the review and full testing, then merges into ${base}.`;
  const tail = `${action} Deny closes the issue. Reply to this post to ask a question or ask for a change.`;
  const room = CAPTION_LIMIT - head.length - tail.length - '\n\n'.repeat(3).length - 'How to try: '.length;
  const [description, howToTry] = fitBoth(approval.description, approval.howToTry, room);
  return [head, description, `How to try: ${howToTry}`, tail].join('\n\n');
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
