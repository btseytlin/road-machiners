import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkScope } from '../deploy';
import { must } from '../exec';
import { roundSession } from '../sessions';
import { updateState } from '../state';
import { BUG_LABEL, GAME_DIR, OUT_DIR, type AgentSession, type Ctx, type PlaytestState, type ReleaseState } from '../types';
import { checkFailure, checkScript, checkUntilReal } from './checks';
import { agentHome, fillPrompt, guardDiff, playtestCommand, readOutput, resetOutputs } from './common';
import { mergeResolving } from './merge-resolve';
import { judge, logFacts, readReview, type Finding, type LogFacts, type Outcome, type Review } from './playtest-review';
import { openReleaseTasks, releaseLog, requireRelease } from './release-common';

// The run logs inside a clone's game folder, where the harness writes them and the agent reads them.
const LOG = `${OUT_DIR}/playtest/log.jsonl`;
const BASELINE_LOG = `${OUT_DIR}/playtest/baseline.jsonl`;
// A GitHub comment holds 65536 characters. The full reports stay in the audit folders.
const COMMENT_LIMIT = 60_000;

export type RunMeta = {
  day: string; run: number; seed: number; turns: number; sha: string; baseline: string; startedAt: string; finishedAt: string;
  outcome: Outcome['outcome']; reason: string; verdict: Review['verdict']; fixes: string[]; bugs: number[]; ending: LogFacts['ending'];
};

// The commit whose run tells an old finding from one the release caused: the last commit this release passed, or main before any pass.
type Baseline = { branch: string; sha: string; kind: string };
// One playtest job. Its agent keeps one session over every round, so its scope stays the one it found on the first play.
// `bugs` maps the title of each old bug the job opened to its issue, since a replay may list the same finding again.
type Session = { release: ReleaseState; dir: string; home: string; start: string; baseline: Baseline; log: string; bugs: Map<string, number>; agent: (prompt: string) => Promise<void> };
type Ending = { outcome: 'clean' | 'blocked'; reason: string; head: string };
type Next = { sha: string; prompt: string };
type Step = Next | { end: Ending };
// `play` counts the plays of this job, from 1. `meta.run` counts the plays of the whole release.
type Round = { meta: RunMeta; outcome: Outcome; sha: string; head: string; play: number };

// The release playtest in one job. It merges main into the release, plays the release head and the baseline side by side, and
// has Opus sort the findings and fix the ones the release caused. The factory replays the seed on each fix in the same agent
// session, up to FACTORY_PLAYTEST_RUNS plays. A clean end lands the fixes on the release after the factory checks, and passes
// that commit. Old bugs become bug issues for dev. Any other end blocks the release for a member.
export async function playtest(ctx: Ctx, issue: number): Promise<void> {
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  if (release.playtest.blocked) throw new Error(`The release playtest is blocked at ${release.playtest.blocked.sha}: ${release.playtest.blocked.reason}`);
  await ctx.repo.fetch();
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) throw new Error(`Release tasks are still open: ${open.map((n) => `#${n}`).join(', ')}. The playtest runs on a release with all its tasks merged.`);
  await takeMain(ctx, release);
  const start = await ctx.repo.headHash(release.branch);
  const dir = join(ctx.cfg.home, 'work', 'release-playtest');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone(release.branch, release.branch, dir);
  if (!(await cloneAt(ctx, dir, start))) return;
  const session = await openSession(ctx, release, dir, start);
  const { plays, end } = await rounds(ctx, session);
  if (end.outcome === 'blocked') return block(ctx, session, plays, end);
  const next = await pass(ctx, session, end.head);
  await ctx.github.comment(release.issue, comment(session, plays, end, next, report(session)));
}

// The release holds all of main before it plays, so a later Ship never brings unplayed game changes in.
async function takeMain(ctx: Ctx, release: ReleaseState): Promise<void> {
  if (await ctx.repo.isMerged('main', release.branch)) return;
  await mergeResolving(ctx, 'playtest', [{ branch: 'main', into: release.branch, message: `Merge main into ${release.branch} before the playtest` }]);
  await ctx.repo.fetch();
  ctx.log('playtest', release.issue, `merged main into ${release.branch} before the playtest`);
}

// The clone takes the branch tip, which may have moved since the factory read the head. The logs, the reviews and the
// audit must name the commit that ran, so a clone of another commit plays nothing and spends no run. The next tick plays the new head.
async function cloneAt(ctx: Ctx, dir: string, sha: string): Promise<boolean> {
  const head = must(await ctx.run('git', ['-C', dir, 'rev-parse', 'HEAD']), 'git rev-parse in the playtest clone').trim();
  if (head.startsWith(sha)) return true;
  ctx.log('playtest', null, `the clone is at ${head.slice(0, sha.length)}, not the release head ${sha}, since the release moved. Nothing played.`);
  return false;
}

async function openSession(ctx: Ctx, release: ReleaseState, dir: string, start: string): Promise<Session> {
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(join(home, OUT_DIR, 'playtest-history.md'), history(ctx, release));
  writeFileSync(join(home, OUT_DIR, 'open-bugs.md'), await openBugs(ctx));
  let agentSession: AgentSession = roundSession(ctx.cfg.home, release.issue, `playtest-${release.playtest.runs + 1}`, false);
  const log = releaseLog(ctx, 'playtest');
  const agent = async (prompt: string): Promise<void> => {
    await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.designModel, prompt, log, session: agentSession });
    agentSession = { ...agentSession, resume: true };
  };
  return { release, dir, home, start, baseline: await baselineOf(ctx, release), log, bugs: new Map(), agent };
}

async function baselineOf(ctx: Ctx, release: ReleaseState): Promise<Baseline> {
  if (release.playtest.passed !== null) return { branch: release.branch, sha: release.playtest.passed, kind: 'the last commit this release passed' };
  return { branch: 'main', sha: await ctx.repo.headHash('main'), kind: 'main, since this release has not passed yet' };
}

// Plays until a play ends clean or blocked, at most FACTORY_PLAYTEST_RUNS times.
async function rounds(ctx: Ctx, session: Session): Promise<{ plays: RunMeta[]; end: Ending }> {
  const plays: RunMeta[] = [];
  let next: Next = { sha: session.start, prompt: firstPrompt(ctx, session) };
  for (let play = 1; ; play++) {
    const round = await playRound(ctx, session, next, play);
    plays.push(round.meta);
    const step = await afterRound(ctx, session, round);
    if ('end' in step) return { plays, end: step.end };
    next = step;
  }
}

// One play of the seed and the agent's review of it. The agent may commit fixes during the review.
async function playRound(ctx: Ctx, session: Session, next: Next, play: number): Promise<Round> {
  const last = play === ctx.cfg.playtestRuns;
  const { run } = countPlay(ctx);
  const startedAt = ctx.now().toISOString();
  const facts = play === 1 ? await firstPlay(ctx, session) : await playRelease(ctx, session, next.sha);
  for (const name of ['playtest.json', 'playtest.md']) rmSync(join(session.home, OUT_DIR, name), { force: true });
  await session.agent(next.prompt);
  const review = readReview(readOutput(session.home, 'playtest.json'));
  const head = await cloneHead(ctx, session);
  const outcome = judge(facts, review, { moved: head !== next.sha, last });
  const bugs = await openOldBugs(ctx, session, next.sha, review);
  const { release } = session;
  const meta: RunMeta = { day: release.day, run, seed: release.playtest.seed, turns: ctx.cfg.playtestTurns, sha: next.sha, baseline: session.baseline.sha, startedAt, finishedAt: ctx.now().toISOString(), outcome: outcome.outcome, reason: outcome.reason, verdict: review.verdict, fixes: review.fixes, bugs, ending: facts.ending };
  keepAudit(ctx, release, session.home, meta);
  return { meta, outcome, sha: next.sha, head, play };
}

// A clean play of the head the job started on needs no landing. A clean play of the agent's fixes needs the factory checks first.
async function afterRound(ctx: Ctx, session: Session, round: Round): Promise<Step> {
  const { outcome, sha, head, play } = round;
  if (outcome.outcome === 'blocked') return { end: { outcome: 'blocked', reason: outcome.reason, head: sha } };
  if (outcome.outcome === 'replay') return { sha: head, prompt: replayPrompt(ctx, session, head, play + 1) };
  if (sha === session.start) return { end: { outcome: 'clean', reason: outcome.reason, head: sha } };
  const failure = await checkFixes(ctx, session, sha);
  if (failure === null) return { end: { outcome: 'clean', reason: outcome.reason, head: sha } };
  ctx.log('playtest', session.release.issue, `the factory checks failed on the fixes at ${sha}\n${failure}`);
  if (play === ctx.cfg.playtestRuns) return { end: { outcome: 'blocked', reason: `The factory checks failed on the fixes at ${sha}, and no play is left. The log is ${releaseLog(ctx, 'playtest-checks')}.`, head: sha } };
  return fixChecks(ctx, session, sha, failure, play + 1);
}

// A failed check goes to the same agent, and its fix plays again like any other.
async function fixChecks(ctx: Ctx, session: Session, sha: string, failure: string, play: number): Promise<Step> {
  writeFileSync(join(session.home, OUT_DIR, 'check-failure.md'), failure);
  await session.agent(fillPrompt('release-playtest-checks', { sha }));
  const head = await cloneHead(ctx, session);
  if (head === sha) return { end: { outcome: 'blocked', reason: `The factory checks failed on the fixes at ${sha}, and the agent committed no fix for them.`, head: sha } };
  return { sha: head, prompt: replayPrompt(ctx, session, head, play) };
}

// The first play runs the release head and the baseline side by side. The agent reads both logs.
async function firstPlay(ctx: Ctx, session: Session): Promise<LogFacts> {
  const [facts] = await Promise.all([playRelease(ctx, session, session.start), playBaseline(ctx, session)]);
  return facts;
}

async function playRelease(ctx: Ctx, session: Session, sha: string): Promise<LogFacts> {
  await harness(ctx, session, session.dir, sha);
  const facts = readFacts(ctx, session.release, join(session.home, LOG), sha);
  writeFileSync(join(session.home, OUT_DIR, 'playtest-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  return facts;
}

async function playBaseline(ctx: Ctx, session: Session): Promise<void> {
  const { baseline, home } = session;
  const dir = join(ctx.cfg.home, 'work', 'release-baseline');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone(baseline.branch, baseline.branch, dir);
  must(await ctx.run('git', ['-C', dir, 'checkout', '--quiet', '--detach', baseline.sha]), 'git checkout of the playtest baseline');
  await harness(ctx, session, dir, baseline.sha);
  const log = join(agentHome(dir, GAME_DIR), LOG);
  const facts = readFacts(ctx, session.release, log, baseline.sha);
  mkdirSync(dirname(join(home, BASELINE_LOG)), { recursive: true });
  copyFileSync(log, join(home, BASELINE_LOG));
  writeFileSync(join(home, OUT_DIR, 'playtest-baseline-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
}

async function harness(ctx: Ctx, session: Session, dir: string, sha: string): Promise<void> {
  const { seed } = session.release.playtest;
  await ctx.container.shell(dir, `npm ci && npm run progression:playthrough -- --seed ${seed} --turns ${ctx.cfg.playtestTurns} --sha ${sha} --out ${LOG}`, session.log);
}

function readFacts(ctx: Ctx, release: ReleaseState, path: string, sha: string): LogFacts {
  if (!existsSync(path)) throw new Error(`The progression harness wrote no playtest log at ${sha}`);
  return logFacts(readFileSync(path, 'utf8'), { seed: release.playtest.seed, turns: ctx.cfg.playtestTurns, sha });
}

// The clone's head after the agent, in the short form the release head takes. Factory files the agent committed leave the commit first.
async function cloneHead(ctx: Ctx, session: Session): Promise<string> {
  const untracked = await ctx.repo.untrackFactoryFiles(session.dir);
  if (untracked.length > 0) ctx.log('playtest', session.release.issue, `took factory files out of the fixes: ${untracked.join(', ')}`);
  return ctx.repo.headHash(await ctx.repo.fetchFromWork(session.dir, session.release.branch));
}

// The fixes pass the same diff checks and factory checks as any agent work before they reach the release. Returns the failure, or null.
async function checkFixes(ctx: Ctx, session: Session, sha: string): Promise<string | null> {
  const dirty = must(await ctx.run('git', ['-C', session.dir, 'status', '--porcelain']), 'git status in the playtest clone').trim();
  if (dirty !== '') return `The clone has changes that are not committed, so the checks cannot run on the reviewed commit ${sha}. Commit them or remove them:\n${dirty}`;
  guardDiff(await ctx.repo.diff(session.start, sha));
  checkScope(sha);
  const log = releaseLog(ctx, 'playtest-checks');
  const check = async (): Promise<string | null> => {
    try {
      await ctx.container.shell(session.dir, checkScript(playtestCommand(ctx.cfg, false)), log, { BUILD_SCOPE: sha });
      return null;
    } catch (error) {
      return checkFailure(log, error);
    }
  };
  return checkUntilReal(check, (run) => ctx.log('playtest', session.release.issue, `the checks only timed out, run ${run}, running them again`));
}

// The play is counted before it starts, so a play that times out or crashes still names its audit folder.
function countPlay(ctx: Ctx): { run: number } {
  return { run: setPlaytest(ctx, (playtest) => ({ ...playtest, runs: playtest.runs + 1 })).runs };
}

// A blocked job keeps the reviewed commit and the reason, comments and fails, so the tracking card takes the stuck label and Hermes sees it.
async function block(ctx: Ctx, session: Session, plays: RunMeta[], end: Ending): Promise<void> {
  setPlaytest(ctx, (playtest) => ({ ...playtest, blocked: { sha: end.head, reason: end.reason } }));
  const next = `The release is blocked: ${end.reason} A member decides with factory retry on this issue.`;
  await ctx.github.comment(session.release.issue, comment(session, plays, end, next, report(session)));
  throw new Error(`Release playtest blocked: ${end.reason}`);
}

// Lands the fixes and passes the head, only while it is still the release head. Returns the sentence for the comment.
async function pass(ctx: Ctx, session: Session, head: string): Promise<string> {
  const { release } = session;
  if (head !== session.start && !(await land(ctx, session))) return `The release moved during the playtest, so the fixes were merged into it, and its new head plays next.`;
  await ctx.repo.fetch();
  const now = await ctx.repo.headHash(release.branch);
  if (now !== head) return `The release moved to ${now} during the playtest, so the new head plays next.`;
  setPlaytest(ctx, (playtest) => ({ ...playtest, passed: head }));
  ctx.log('playtest', release.issue, `clean at ${head}`);
  const landed = head === session.start ? '' : 'The factory checks passed on the fixes, and they are on the release. ';
  return `${landed}The candidate builds from ${head}.`;
}

// The reviewed commit goes onto the release as it is, so the release head is the commit the last play passed.
// A release that moved meanwhile gets the fixes as a merge, and plays again. Returns whether the push went through.
async function land(ctx: Ctx, session: Session): Promise<boolean> {
  const { release } = session;
  const commit = await ctx.repo.fetchFromWork(session.dir, release.branch);
  try {
    await ctx.repo.push(commit, release.branch);
    return true;
  } catch (error) {
    await ctx.repo.fetch();
    if ((await ctx.repo.headHash(release.branch)) === session.start) throw error;
    await mergeResolving(ctx, 'playtest', [{ branch: commit, into: release.branch, message: `Merge the release playtest fixes into ${release.branch}` }]);
    return false;
  }
}

function setPlaytest(ctx: Ctx, change: (playtest: PlaytestState) => PlaytestState): PlaytestState {
  const next = updateState(ctx.statePath, (state) => (state.release ? { ...state, release: { ...state.release, playtest: change(state.release.playtest) } } : state));
  if (!next.release) throw new Error('The release closed while its playtest ran');
  return next.release.playtest;
}

// An important bug the baseline has too does not block the release. It becomes a bug issue that waits for votes like any other.
async function openOldBugs(ctx: Ctx, session: Session, sha: string, review: Review): Promise<number[]> {
  const fresh = review.findings.filter((finding) => finding.cause === 'old' && finding.severity === 'important' && finding.known === null && !session.bugs.has(finding.title));
  const opened: number[] = [];
  for (const finding of fresh) {
    const n = await ctx.github.createIssue(finding.title, oldBugBody(session, sha, finding), [BUG_LABEL]);
    appendFileSync(join(session.home, OUT_DIR, 'open-bugs.md'), `- #${n} ${finding.title}\n`);
    session.bugs.set(finding.title, n);
    opened.push(n);
  }
  return opened;
}

export function oldBugBody(session: Pick<Session, 'release' | 'baseline'>, sha: string, finding: Finding): string {
  const { release, baseline } = session;
  return [
    `The release playtest of release ${release.day} found this at ${sha}, seed ${release.playtest.seed}. The report is on the tracking issue #${release.issue}.`,
    `The baseline at ${baseline.sha} has it too, so it is not the release's and does not block it.`,
    `## Evidence\n${finding.evidence}`,
    `## Why it is old\n${finding.why}`,
  ].join('\n\n');
}

async function openBugs(ctx: Ctx): Promise<string> {
  const bugs = await ctx.github.candidates([BUG_LABEL]);
  return ['# Open bug issues', ...(bugs.length ? bugs.map((bug) => `- #${bug.number} ${bug.title}`) : ['- none']), ''].join('\n');
}

function firstPrompt(ctx: Ctx, session: Session): string {
  const { release, start, baseline } = session;
  return fillPrompt('release-playtest', {
    sha: start, seed: String(release.playtest.seed), turns: String(ctx.cfg.playtestTurns), runs: String(ctx.cfg.playtestRuns),
    baseline: baseline.sha, baselineKind: baseline.kind,
  });
}

function replayPrompt(ctx: Ctx, session: Session, sha: string, play: number): string {
  return fillPrompt('release-playtest-replay', { sha, start: session.start, play: String(play), runs: String(ctx.cfg.playtestRuns) });
}

// The plays of earlier jobs and the members' decisions, so the review can tell a fixed problem from a new one.
function history(ctx: Ctx, release: ReleaseState): string {
  const runs = Array.from({ length: release.playtest.runs }, (_, i) => i + 1).flatMap((run) => {
    const path = join(auditDir(ctx, release, run), 'meta.json');
    if (!existsSync(path)) return [`- play ${run}: no record, it did not finish`];
    const meta = JSON.parse(readFileSync(path, 'utf8')) as RunMeta;
    return [`- play ${run} at ${meta.sha}: ${meta.outcome}, ${meta.reason}`];
  });
  const notes = release.playtest.notes.map((note) => `- ${note}`);
  return ['# Earlier plays of this release', ...(runs.length ? runs : ['- none']), '', '# Decisions of the committee', ...(notes.length ? notes : ['- none']), ''].join('\n');
}

export function auditDir(ctx: Ctx, release: ReleaseState, run: number): string {
  return join(ctx.cfg.home, 'playtest', release.day, `run-${run}`);
}

// Every play keeps its logs, facts, review, report and outcome, so a later reader sees what each commit did.
function keepAudit(ctx: Ctx, release: ReleaseState, home: string, meta: RunMeta): void {
  const dir = auditDir(ctx, release, meta.run);
  mkdirSync(dir, { recursive: true });
  for (const name of ['playtest/log.jsonl', 'playtest/baseline.jsonl', 'playtest-facts.json', 'playtest-baseline-facts.json', 'playtest.json', 'playtest.md']) {
    const from = join(home, OUT_DIR, name);
    if (existsSync(from)) copyFileSync(from, join(dir, name.replace('playtest/', '')));
  }
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
}

// The agent's last report covers the whole job. A job whose agent wrote none says so.
function report(session: Session): string {
  return readOutput(session.home, 'playtest.md') ?? 'The agent wrote no report in its last round.';
}

export function comment(session: Pick<Session, 'release' | 'start'>, plays: RunMeta[], end: Ending, next: string, text: string): string {
  const { release } = session;
  const head = `Release playtest: ${end.outcome} after ${plays.length} plays. Seed ${release.playtest.seed}, ${plays[0]?.turns ?? 0} turns, from commit ${session.start} to ${end.head}.`;
  const lines = plays.map((play) => `- play ${play.run} at ${play.sha}: ${play.reason}${play.fixes.length ? `. Fixes: ${play.fixes.join('; ')}` : ''}${play.bugs.length ? `. Old bugs opened: ${play.bugs.map((n) => `#${n}`).join(', ')}` : ''}`);
  const body = `${head}\n${next}\n\n${lines.join('\n')}\n\n${text}`;
  return body.length > COMMENT_LIMIT ? `${body.slice(0, COMMENT_LIMIT)}\n\n(cut, the full reports are in the factory's playtest audit)` : body;
}
