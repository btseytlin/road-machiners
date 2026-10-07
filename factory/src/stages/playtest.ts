import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addCard } from '../card-events';
import { must } from '../exec';
import { updateState } from '../state';
import { GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, RELEASE_TASK_LABEL, type Ctx, type PlaytestState, type ReleaseState } from '../types';
import { agentHome, fillPrompt, readOutput, resetOutputs } from './common';
import { judge, logFacts, readReview, type LogFacts, type Outcome, type Review } from './playtest-review';
import { openReleaseTasks, releaseLog, requireRelease } from './release-common';

// The run log inside the clone's game folder, where the harness writes it and the agent reads it.
const LOG = `${OUT_DIR}/playtest/log.jsonl`;
// A GitHub comment holds 65536 characters. The full report stays in the audit folder.
const COMMENT_LIMIT = 60_000;

export type RunMeta = {
  day: string; run: number; seed: number; turns: number; sha: string; startedAt: string; finishedAt: string;
  outcome: Outcome['outcome']; reason: string; verdict: Review['verdict']; task: number | null; ending: LogFacts['ending'];
};

// The release playtest: one deterministic progression run on the release head, an Opus review of its whole log, then
// a pass, a release task with the fix plan, or a block. Each run leaves an audit folder and a comment on the tracking issue.
export async function playtest(ctx: Ctx, issue: number): Promise<void> {
  const release = requireRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the tracking issue of the open release, #${release.issue} is`);
  await ctx.repo.fetch();
  const open = await openReleaseTasks(ctx);
  if (open.length > 0) throw new Error(`Release tasks are still open: ${open.map((n) => `#${n}`).join(', ')}. The playtest runs on a release with all its tasks merged.`);
  const sha = await ctx.repo.headHash(release.branch);
  const dir = join(ctx.cfg.home, 'work', 'release-playtest');
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone(release.branch, release.branch, dir);
  if (await cloneAt(ctx, dir, sha)) await play(ctx, release, sha, dir);
}

// Plays and reviews one run in the clone at sha, keeps its audit record and settles the outcome.
async function play(ctx: Ctx, release: ReleaseState, sha: string, dir: string): Promise<void> {
  const started = startRun(ctx, release, sha);
  const run = started.runs;
  const startedAt = ctx.now().toISOString();
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  const log = releaseLog(ctx, 'playtest');
  const { seed } = release.playtest;
  const turns = ctx.cfg.playtestTurns;
  await ctx.container.shell(dir, `npm ci && npm run progression:playthrough -- --seed ${seed} --turns ${turns} --sha ${sha} --out ${LOG}`, log);
  if (!existsSync(join(home, LOG))) throw new Error('The progression harness wrote no playtest log');
  const facts = logFacts(readFileSync(join(home, LOG), 'utf8'), { seed, turns, sha });
  writeFileSync(join(home, OUT_DIR, 'playtest-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(join(home, OUT_DIR, 'playtest-history.md'), history(ctx, release));
  const prompt = fillPrompt('release-playtest', { seed: String(seed), turns: String(turns), sha, streak: String(started.streak), runs: String(ctx.cfg.playtestRuns) });
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.designModel, prompt, log });
  const review = readReview(readOutput(home, 'playtest.json'));
  const report = readOutput(home, 'playtest.md') ?? review.summary;
  const outcome = atLimit(judge(facts, review), started, ctx.cfg.playtestRuns);
  const task = outcome.outcome === 'fix' ? await openFixTask(ctx, release, run, sha, review) : null;
  const meta: RunMeta = { day: release.day, run, seed, turns, sha, startedAt, finishedAt: ctx.now().toISOString(), outcome: outcome.outcome, reason: outcome.reason, verdict: review.verdict, task, ending: facts.ending };
  keepAudit(ctx, release, home, meta);
  await ctx.github.comment(release.issue, comment(meta, report));
  await settle(ctx, release, sha, outcome);
}

// The clone takes the branch tip, which may have moved since the factory read the head. The log, the review and the
// audit must name the commit that ran, so a clone of another commit plays nothing and spends no run. The next tick plays the new head.
async function cloneAt(ctx: Ctx, dir: string, sha: string): Promise<boolean> {
  const head = must(await ctx.run('git', ['-C', dir, 'rev-parse', 'HEAD']), 'git rev-parse in the playtest clone').trim();
  if (head.startsWith(sha)) return true;
  ctx.log('playtest', null, `the clone is at ${head.slice(0, sha.length)}, not the release head ${sha}, since the release moved. Nothing played.`);
  return false;
}

// The run is counted before it starts, so a run that times out or crashes still spends its budget. The limit holds the
// runs since the last pass, so a fix loop ends, while a committee change after a pass gets a fresh budget.
function startRun(ctx: Ctx, release: ReleaseState, sha: string): PlaytestState {
  if (release.playtest.blocked) throw new Error(`The release playtest is blocked at ${release.playtest.blocked.sha}: ${release.playtest.blocked.reason}`);
  if (release.playtest.streak >= ctx.cfg.playtestRuns) {
    const reason = `The release spent all ${ctx.cfg.playtestRuns} playtest runs since its last pass.`;
    setPlaytest(ctx, (playtest) => ({ ...playtest, blocked: { sha, reason } }));
    throw new Error(reason);
  }
  return setPlaytest(ctx, (playtest) => ({ ...playtest, runs: playtest.runs + 1, streak: playtest.streak + 1 }));
}

// A fix needs a run after it, so the last run of a streak can only pass or block.
function atLimit(outcome: Outcome, playtest: PlaytestState, runs: number): Outcome {
  if (outcome.outcome !== 'fix' || playtest.streak < runs) return outcome;
  return { outcome: 'blocked', reason: `The run ${playtest.streak} of ${runs} since the last pass still has findings to fix: ${outcome.reason}.` };
}

// Clean passes the commit only while it is still the release head. Blocked fails the job, so the tracking card takes the stuck label and Hermes sees it.
async function settle(ctx: Ctx, release: ReleaseState, sha: string, outcome: Outcome): Promise<void> {
  if (outcome.outcome === 'blocked') {
    setPlaytest(ctx, (playtest) => ({ ...playtest, blocked: { sha, reason: outcome.reason } }));
    throw new Error(`Release playtest blocked: ${outcome.reason}`);
  }
  if (outcome.outcome === 'fix') return ctx.log('playtest', release.issue, `findings at ${sha}, fix task opened`);
  await ctx.repo.fetch();
  const head = await ctx.repo.headHash(release.branch);
  if (head !== sha) return ctx.log('playtest', release.issue, `clean at ${sha}, but the release moved to ${head}, so it plays again`);
  setPlaytest(ctx, (playtest) => ({ ...playtest, passed: sha, streak: 0 }));
  ctx.log('playtest', release.issue, `clean at ${sha}`);
}

function setPlaytest(ctx: Ctx, change: (playtest: PlaytestState) => PlaytestState): PlaytestState {
  const next = updateState(ctx.statePath, (state) => (state.release ? { ...state, release: { ...state.release, playtest: change(state.release.playtest) } } : state));
  if (!next.release) throw new Error('The release closed while its playtest ran');
  return next.release.playtest;
}

// The fixes go through a release task, so they run the normal stages, checks and merge into the release. Its merge moves
// the release head, and the next playtest replays the same seed on it.
async function openFixTask(ctx: Ctx, release: ReleaseState, run: number, sha: string, review: Review): Promise<number> {
  const title = `Fix release playtest findings (release ${release.day}, run ${run})`;
  const n = await ctx.github.createIssue(title, fixTaskBody(release, run, sha, review), [RELEASE_TASK_LABEL, MAINTENANCE_LABEL]);
  await addCard(ctx, n, 'Design', 'release-task');
  return n;
}

export function fixTaskBody(release: ReleaseState, run: number, sha: string, review: Review): string {
  const findings = review.findings.map((finding) => `- ${finding.id} (${finding.severity}): ${finding.title}. Evidence: ${finding.evidence}`);
  const plan = [...review.plan].sort((a, b) => a.priority - b.priority).map((step) => `${step.priority}. ${step.finding}: ${step.change} Tests: ${step.tests}`);
  return [
    `The release playtest run ${run} of release ${release.day} found these problems at ${sha}, seed ${release.playtest.seed}. The report is on the tracking issue #${release.issue}.`,
    '## Findings', ...findings,
    '## Fix plan, most important first', ...plan,
    '## Rules',
    '- Make the smallest change that fixes each finding. Fix the important ones. Skip a step that turns out wrong and say why.',
    '- Never remove or disable a feature, and change nothing unrelated, to silence a finding.',
    '- Run the tests near each change, the game typecheck and the build.',
    '- After this task merges, the factory replays the same seed on the new release head and reviews the whole log again.',
  ].join('\n');
}

// The runs before this one and the members' decisions, so the review can tell a fixed problem from a new one.
function history(ctx: Ctx, release: ReleaseState): string {
  const runs = Array.from({ length: release.playtest.runs }, (_, i) => i + 1).flatMap((run) => {
    const path = join(auditDir(ctx, release, run), 'meta.json');
    if (!existsSync(path)) return [`- run ${run}: no record, it did not finish`];
    const meta = JSON.parse(readFileSync(path, 'utf8')) as RunMeta;
    return [`- run ${run} at ${meta.sha}: ${meta.outcome}, ${meta.reason}${meta.task ? `, fix task #${meta.task}` : ''}`];
  });
  const notes = release.playtest.notes.map((note) => `- ${note}`);
  return ['# Earlier runs of this release', ...(runs.length ? runs : ['- none']), '', '# Decisions of the committee', ...(notes.length ? notes : ['- none']), ''].join('\n');
}

export function auditDir(ctx: Ctx, release: ReleaseState, run: number): string {
  return join(ctx.cfg.home, 'playtest', release.day, `run-${run}`);
}

// Every run keeps its log, facts, review, report and outcome, so a later reader sees what each commit did.
function keepAudit(ctx: Ctx, release: ReleaseState, home: string, meta: RunMeta): void {
  const dir = auditDir(ctx, release, meta.run);
  mkdirSync(dir, { recursive: true });
  for (const name of ['playtest/log.jsonl', 'playtest-facts.json', 'playtest.json', 'playtest.md']) {
    const from = join(home, OUT_DIR, name);
    if (existsSync(from)) copyFileSync(from, join(dir, name.replace('playtest/', '')));
  }
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
}

export function comment(meta: RunMeta, report: string): string {
  const head = `Release playtest run ${meta.run}: ${meta.outcome}. Seed ${meta.seed}, ${meta.turns} turns, commit ${meta.sha}, run ended by ${meta.ending}.`;
  const next = { clean: 'The candidate builds from this commit.', fix: `The fixes go to release task #${meta.task}. The same seed plays again after it merges.`, blocked: `The release is blocked: ${meta.reason} A member decides with factory retry on this issue.` }[meta.outcome];
  const text = `${head}\n${next}\n\n${report}`;
  return text.length > COMMENT_LIMIT ? `${text.slice(0, COMMENT_LIMIT)}\n\n(cut, the full report is in the factory's playtest audit)` : text;
}
