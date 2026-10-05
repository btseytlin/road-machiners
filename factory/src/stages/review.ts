import { rmSync, writeFileSync } from 'node:fs';
import { updateState } from '../state';
import { BRANCH, GAME_DIR, INCIDENT_LOG, OUT_DIR, REVIEW_HEADING, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, fillPrompt, fitComment, readOutput, runAgent, workDir } from './common';

export const PASS_LINE = 'REVIEW_VERDICT: PASS';
export const FAIL_LINE = 'REVIEW_VERDICT: FAIL';
const PRINCIPLES = `${GAME_DIR}/docs/architecture/principles.md`;

export type Review = { passed: boolean; text: string };

// The review ends with exactly one verdict line. A review that names both verdicts, or none at its end, fails loud.
export function parseReview(text: string | null): Review {
  if (text === null) throw new Error('The review round wrote no .factory/review.md');
  const lines = text.trimEnd().split('\n').map((line) => line.trim());
  const last = lines.at(-1);
  if (last !== PASS_LINE && last !== FAIL_LINE) throw new Error(`review.md must end with ${PASS_LINE} or ${FAIL_LINE}`);
  if (lines.includes(PASS_LINE) && lines.includes(FAIL_LINE)) throw new Error('review.md names both verdicts');
  return { passed: last === PASS_LINE, text: text.trimEnd() };
}

// Runs Claude Code's /code-review once over the whole branch, with the incident log and the principles pasted in, so
// the review cannot skip them. Both come from dev, where incidents land, so a hotfix branch from main gets them too.
async function reviewRound(ctx: Ctx, issue: number, base: string): Promise<Review> {
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  rmSync(`${home}/${OUT_DIR}/review.md`, { force: true });
  const prompt = fillPrompt('review', {
    issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), base,
    incidentLog: await ctx.repo.readFile(BASE_BRANCH, INCIDENT_LOG), principles: await ctx.repo.readFile(BASE_BRANCH, PRINCIPLES),
  });
  // A review only reads and its file is cleared above, so a resumed job reviews again from the start.
  await runAgent(ctx, issue, 'verify', 'review', prompt, { model: ctx.cfg.designModel, skill: '/code-review', fresh: true });
  return parseReview(readOutput(home, 'review.md'));
}

// One adversarial review of the whole branch. A FAIL gets one fix round and one more review. Returns whether the
// change passed. A second FAIL sends the card back to Design, since two blocks in a row point at the design, not
// at the code. A card already redesigned once for the review throws instead, so the stage stops it for Hermes.
export async function reviewGate(ctx: Ctx, issue: number, base: string, fixRound: () => Promise<void>): Promise<boolean> {
  const first = await reviewRound(ctx, issue, base);
  if (first.passed) return true;
  const findingsFile = `${agentHome(workDir(ctx, issue), GAME_DIR)}/${OUT_DIR}/review-findings.md`;
  writeFileSync(findingsFile, `${first.text}\n`);
  await fixRound();
  const again = await reviewRound(ctx, issue, base);
  rmSync(findingsFile);
  if (again.passed) return true;
  const redesigned = (await ctx.github.comments(issue)).some((comment) => comment.body.startsWith(REVIEW_HEADING));
  if (redesigned) throw new Error(`The review failed the change twice again after a redesign.\n${again.text}`);
  const intro = 'The review failed this change twice. A fix round did not clear it, so the flaw is in the design. Revise the design to remove the root cause behind these findings, not to patch each one.';
  await ctx.github.comment(issue, `${REVIEW_HEADING}\n\n${intro}\n\n${fitComment(again.text, 'the review round log')}`);
  // A redesign changes what the committee approved, so the approval goes and the new build gets its own post.
  updateState(ctx.statePath, (state) => {
    const approvedResolving = { ...state.approvedResolving };
    delete approvedResolving[String(issue)];
    return { ...state, approvedResolving };
  });
  await ctx.github.move(issue, 'Design');
  return false;
}
