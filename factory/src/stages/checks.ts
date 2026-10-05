import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readEvidence, type Evidence } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { checkScope, publishBuild, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, RELEASE_TASK_LABEL, type Ctx, type InlineButton, type TestPhase, type VisualWaiver } from '../types';
import { consumeWaiver, visualWaiverOf, waiverNotice } from '../visual-waiver';
import { bundleOf } from './bundle';
import { HOTFIX_BASE, agentHome, agentLog, baseBranchFor, playtestCommand, workDir } from './common';
import { readApproval, setPhase, type Approval } from './verify';

// Each step logs its start time, so the log shows where the time goes.
// The typecheck runs beside the tests. The build ends the script, so a passing check leaves dist/ ready to publish.
// Only the build gets SAVE_SCOPE, since the tests expect the default save key.
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

// The machine half of testing. It runs no agent, so it holds the test slot only for the checks and the build.
// It checks the branch head that verify or a patch pushed, with the approval and evidence they left in the work clone.
// A first failure hands the card to verify for one fix round. A failure after that fix stops the card.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const phase = checksPhase(ctx, issue);
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  const build = await ctx.repo.headHash(BRANCH(issue));
  // An approved card merges with no post, so only a card that will be posted needs the approval and the evidence. They are read before the checks, so a bad manifest fails fast.
  const approver = approvedAlready(ctx, issue, item.labels);
  // A committee waiver of the screenshot takes the place of the evidence, and the post says so.
  const waiver = approver === null ? visualWaiverOf(ctx, issue) : null;
  const shown = approver === null ? { approval: readApproval(home, waiver !== null), evidence: waiver === null ? readEvidence(home, build) : null } : null;
  // Timeouts alone rerun here. A real failure goes to verify for one fix round. Three timeouts throw with the phase kept, so a retry runs the checks again.
  const failure = await checkPatiently(ctx, issue, base, build);
  if (failure !== null) return failed(ctx, issue, home, phase, failure);
  const url = publishBuild(ctx, checkDir(ctx, issue), build);
  recordBuild(ctx.statePath, issue, build);
  if (shown !== null) await post(ctx, issue, shown.approval, shown.evidence, url, base, waiver);
  if (waiver !== null) consumeWaiver(ctx, issue);
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

// The merge runs as an approve job in the branch queue, like a member's approval, so it never races another branch job.
function queueMerge(ctx: Ctx, issue: number, by: string): void {
  updateState(ctx.statePath, (state) => ({ ...state, pendingApprovals: { ...state.pendingApprovals, [String(issue)]: by } }));
  ctx.log('checks', issue, `approved by ${by} already, merge queued`);
}

function checkDir(ctx: Ctx, issue: number): string {
  return `${ctx.cfg.home}/work/check-issue-${issue}`;
}

// The host runs its own checks in a fresh clone of the pushed branch. Agent claims do not count.
// Passing checks leave the build of scope `build` in the clone. Returns null when they pass, or the tail of the check log when they fail.
async function runChecks(ctx: Ctx, issue: number, base: string, build: string): Promise<string | null> {
  checkScope(build);
  const dir = checkDir(ctx, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, dir);
  const log = agentLog(ctx, issue, 'checks');
  try {
    await ctx.container.shell(dir, checkScript(playtestCommand(ctx.cfg)), log, { BUILD_SCOPE: build });
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
const CHECK_RUNS = 3;

// Runs the checks until they pass or fail for a real reason. Timeouts alone rerun the checks with no agent round,
// since an agent would only raise the time limits. Returns null on a pass, or the real failure. Throws after CHECK_RUNS timeouts.
async function checkPatiently(ctx: Ctx, issue: number, base: string, build: string): Promise<string | null> {
  for (let run = 1; ; run++) {
    const failure = await runChecks(ctx, issue, base, build);
    if (failure === null || !timeoutOnly(failure)) return failure;
    if (run === CHECK_RUNS) throw new Error(`The factory checks timed out ${CHECK_RUNS} times, under load. No test failed for another reason.\n${failure}`);
    ctx.log('checks', issue, `the checks only timed out, run ${run} of ${CHECK_RUNS}, running them again`);
  }
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
// A waived post has no image, so it is a text message with the same buttons, mapping and reply routing. It says up front that the screenshot was waived.
export async function post(ctx: Ctx, issue: number, approval: Approval, evidence: Evidence | null, url: string, base: string, waiver: VisualWaiver | null = null): Promise<void> {
  const item = await ctx.github.issue(issue);
  const link = `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const pr = await pullRequestUrl(ctx, issue, item.title, approval, base);
  const waived = waiver === null ? '' : `${WAIVED_COMMENT}\n${waiverNotice(waiver)}\n\n`;
  await ctx.github.comment(issue, `Ready for approval: ${url}\n\n${waived}${approval.description}\n\nHow to try: ${approval.howToTry}`);
  const caption = approvalCaption(`#${issue} ${item.title}`, url, link, pr, approval, base, waiver);
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

const WAIVED_COMMENT = '⚠️ The committee waived the screenshot for this build. The player-visible behavior has no visual evidence.';

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

export function approvalCaption(title: string, url: string, link: string, pr: string, approval: Approval, base: string, waiver: VisualWaiver | null = null): string {
  // A hotfix skips dev and the release, so its post opens with a warning the committee cannot miss.
  const hotfix = base === HOTFIX_BASE ? '⚠️ HOTFIX. Approve merges into main and ships to players at once. Play it with care.\n\n' : '';
  const waived = waiver === null ? '' : `⚠️ SCREENSHOT WAIVED by ${waiver.byName ?? waiver.by}. Player-visible behavior has no visual evidence, so judge it by playing.\n\n`;
  const warning = `${hotfix}${waived}`;
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
