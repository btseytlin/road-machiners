import { moveCard } from '../card-events';
import { rmSync, writeFileSync } from 'node:fs';
import { updateState } from '../state';
import { BRANCH, GAME_DIR, INCIDENT_LOG, OUT_DIR, REVIEW_HEADING, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, fillPrompt, fitComment, runAgent, workDir } from './common';

const PRINCIPLES = `${GAME_DIR}/docs/architecture/principles.md`;
// /code-review files a bug under this category. Its other categories are cleanups, which the harden round already covers.
const BLOCKING = 'correctness';

// The ReportFindings input, as /code-review sends it. Its schema requires the file, summary and failure scenario.
export type Finding = { file: string; line?: number; category?: string; summary: string; failure_scenario: string; verdict?: string };
export type Review = { passed: boolean; text: string };
type StreamEvent = { type?: string; message?: { content?: { type?: string; name?: string; input?: { findings?: Finding[] } }[] } };

// /code-review reports through its ReportFindings tool, from a forked agent, so the findings are in the stream and in no file.
// The last report counts, since a review may report again after its own check. A run with no report fails loud.
export function readFindings(stream: string): Finding[] {
  const reports = stream.split('\n').filter((line) => line.includes('"ReportFindings"')).flatMap((line) => {
    const event = JSON.parse(line) as StreamEvent;
    if (event.type !== 'assistant') return [];
    return (event.message?.content ?? []).filter((block) => block.type === 'tool_use' && block.name === 'ReportFindings').map((block) => block.input?.findings);
  });
  const findings = reports.at(-1);
  if (!Array.isArray(findings)) throw new Error('The review round reported no findings with ReportFindings');
  return findings;
}

// A correctness finding blocks the change. A finding with no category blocks too, since nothing says it is only a cleanup.
export function judge(findings: Finding[]): Review {
  const passed = findings.every((finding) => finding.category !== undefined && finding.category !== BLOCKING);
  if (findings.length === 0) return { passed, text: 'The review found nothing.' };
  return { passed, text: findings.map(findingLine).join('\n') };
}

function findingLine(finding: Finding): string {
  const tags = [finding.category ?? 'uncategorized', finding.verdict].filter((tag) => tag !== undefined).join(', ');
  return `- [${tags}] ${finding.file}:${finding.line ?? '?'}: ${finding.summary}\n  ${finding.failure_scenario}`;
}

// Runs Claude Code's /code-review once over the whole branch, with the incident log and the principles pasted in, so
// the review cannot skip them. Both come from dev, where incidents land, so a hotfix branch from main gets them too.
async function reviewRound(ctx: Ctx, issue: number, base: string): Promise<Review> {
  const prompt = fillPrompt('review', {
    issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), base,
    incidentLog: await ctx.repo.readFile(BASE_BRANCH, INCIDENT_LOG), principles: await ctx.repo.readFile(BASE_BRANCH, PRINCIPLES),
  });
  // A review only reads, so a resumed job reviews again from the start.
  return judge(readFindings(await runAgent(ctx, issue, 'verify', 'review', prompt, { skill: '/code-review', fresh: true })));
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
  await moveCard(ctx, issue, 'Design', 'review-failed');
  return false;
}
