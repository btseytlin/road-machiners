import { readCommittee, type Member } from './committee';
import { appendLedger } from './ledger';
import { readState, updateState } from './state';
import { BRANCH, type Ctx, type FpsWaiver } from './types';

// A committee member can waive the playtest's frame rate minimum for the next checks of one approved issue, and nothing else.
// The checks still run in full. Only a playtest whose one problem is the frame rate passes, flagged on the issue and in the ledger.

// The checks log marks each step. The game's playtest prints `turns N, fps X`, then `FAIL` and one problem per line.
const PLAYTEST_STEP = /^\[checks\] \d\d:\d\d:\d\d playtest$/;
const STEP = /^\[checks\] /;
const FPS_REPORT = /^turns \d+, fps (\d+(?:\.\d+)?)$/;
const FPS_PROBLEM = /^fps (\d+(?:\.\d+)?) under (\d+(?:\.\d+)?)$/;
// npm's report of the failed script and bash's notice of the stopped dev server follow the problems. Neither is a problem.
const WRAPPER_LINE = /^npm (error|ERR!) |^(bash: )?line \d+: +\d+ Terminated\b/;

export type FpsMiss = { fps: number; min: number };

// The measured frame rate when the frame rate is the one thing the checks failed on, or null.
export function fpsOnly(failure: string): FpsMiss | null {
  const output = playtestOutput(failure.split('\n').map((line) => line.trimEnd()));
  if (output === null) return null;
  const fail = output.indexOf('FAIL');
  const miss = onlyProblem(output.slice(fail + 1));
  const reports = output.slice(0, fail).flatMap((line) => FPS_REPORT.exec(line)?.[1] ?? []);
  if (miss === null || reports.length !== 1 || reports[0] !== miss[1]) return null;
  const fps = Number(miss[1]);
  const min = Number(miss[2]);
  return fps < min ? { fps, min } : null;
}

// The lines the playtest step wrote, when it was the step that failed and wrote one FAIL block.
// Tests, typecheck and the dev server come before the playtest step, so reaching it means they passed.
function playtestOutput(lines: string[]): string[] | null {
  const step = lines.map((line) => PLAYTEST_STEP.test(line)).lastIndexOf(true);
  if (step < 0) return null;
  const output = lines.slice(step + 1);
  if (output.some((line) => STEP.test(line))) return null;
  return output.filter((line) => line === 'FAIL').length === 1 ? output : null;
}

function onlyProblem(lines: string[]): RegExpExecArray | null {
  const problems = lines.filter((line) => line.trim() !== '' && !WRAPPER_LINE.test(line));
  return problems.length === 1 ? FPS_PROBLEM.exec(problems[0]) : null;
}

// Records a member's waiver for the issue's branch head as it is now. A later push needs a new waiver.
// The card goes straight to the checks with no agent fix round, and a failure the waiver does not cover stops it again.
export async function grantFpsWaiver(ctx: Ctx, issue: number, member: string, reason: string): Promise<string> {
  if (!ctx.cfg.gpu) throw new Error('The CPU playtest checks no frame rate, so there is nothing to waive.');
  if (reason.trim() === '') throw new Error('A waiver needs a reason.');
  const by = memberName(findMember(ctx, member));
  const state = readState(ctx.statePath);
  if (!(String(issue) in state.approvedResolving)) throw new Error(`Issue #${issue} is no approved card in hardening. Only an approved card can skip the FPS minimum.`);
  if (state.jobs.some((job) => job.issue === issue)) throw new Error(`A job runs on issue #${issue}. Wait until it ends.`);
  const build = await ctx.repo.headHash(BRANCH(issue));
  const waiver: FpsWaiver = { by, reason: reason.trim(), build, at: ctx.now().toISOString() };
  updateState(ctx.statePath, (next) => {
    const phase = next.testPhase[String(issue)];
    const testPhase = phase === undefined || phase === 'fix' ? { ...next.testPhase, [String(issue)]: 'checks-after-fix' as const } : next.testPhase;
    return { ...next, testPhase, fpsWaivers: { ...next.fpsWaivers, [String(issue)]: waiver } };
  });
  await ctx.github.comment(issue, `FPS minimum waived for the next factory checks of build ${build}, authorized by ${by}. Reason: ${waiver.reason}\n\nThe checks still run in full. Only a playtest whose one problem is the frame rate can pass, and the result says it was waived.`);
  appendLedger(ctx.cfg.home, { kind: 'waiver', event: 'granted', check: 'fps', issue, ...waiver });
  ctx.log('checks', issue, `FPS minimum waived for build ${build} by ${by}: ${waiver.reason}`);
  return `The FPS minimum of #${issue} is waived for the next checks of build ${build}. Remove factory-stuck to run them.`;
}

function findMember(ctx: Ctx, member: string): Member {
  const { home, committeeBootstrapTelegram: telegram, committeeBootstrapGithub: github } = ctx.cfg;
  const wanted = member.trim().toLowerCase();
  const found = readCommittee(home, { telegram, github }).find((item) => [item.name, item.github, item.telegram].some((id) => id?.toLowerCase() === wanted));
  if (found === undefined) throw new Error(`${member} is no committee member. Name the member who authorized the waiver.`);
  return found;
}

function memberName(member: Member): string {
  return member.name ?? member.github ?? member.telegram;
}

// The waiver of the issue when it names the checked build.
export function matchingWaiver(ctx: Ctx, issue: number, build: string): FpsWaiver | null {
  const waiver = readState(ctx.statePath).fpsWaivers[String(issue)];
  return waiver?.build === build ? waiver : null;
}

// A waiver serves one checks verdict, whatever it was.
export function dropWaiver(ctx: Ctx, issue: number): void {
  if (!(String(issue) in readState(ctx.statePath).fpsWaivers)) return;
  updateState(ctx.statePath, (state) => ({ ...state, fpsWaivers: withoutWaiver(state.fpsWaivers, issue) }));
}

// A waiver lives only as long as the approval it was granted under, so whatever drops the approval drops the waiver too.
export function withoutWaiver(waivers: Record<string, FpsWaiver>, issue: number): Record<string, FpsWaiver> {
  return Object.fromEntries(Object.entries(waivers).filter(([name]) => name !== String(issue)));
}

// A waived playtest never reads as a pass. The issue, the ledger and the log say what was waived, by whom and at what frame rate.
export async function recordWaivedPass(ctx: Ctx, issue: number, waiver: FpsWaiver, miss: FpsMiss): Promise<void> {
  await ctx.github.comment(issue, `⚠️ FPS gate waived. The factory checks of build ${waiver.build} passed except the playtest frame rate: ${miss.fps} FPS, under the minimum of ${miss.min}. Authorized by ${waiver.by}. Reason: ${waiver.reason}`);
  appendLedger(ctx.cfg.home, { kind: 'waiver', event: 'used', check: 'fps', issue, ...waiver, at: ctx.now().toISOString(), fps: miss.fps });
  ctx.log('checks', issue, `FPS gate waived: ${miss.fps} FPS under ${miss.min}, authorized by ${waiver.by}`);
}
