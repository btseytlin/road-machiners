import { updateState } from '../state';
import { VISUAL_HEADING, type Ctx } from '../types';
import { VISUAL_SEND_BACKS, readVisualReview, type SendBack } from '../visual-review';
import type { Evidence } from '../evidence';
import { fitComment } from './common';

// The testing agent read the final captured images and decided. A change nobody can see passes on its stated reason.
// A look that is wrong never reaches the post: the card goes back to the stage that owns the flaw, with the branch kept.
// Returns whether the round may go on to the checks. Only a send-back stops it. A missing or broken decision is logged, and the card goes on.
export async function visualGate(ctx: Ctx, issue: number, home: string, head: string, evidence: Evidence): Promise<boolean> {
  let review;
  try {
    review = readVisualReview(home, head, evidence);
  } catch (error) {
    ctx.log('verify', issue, `visual review ignored: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
  if (!review.visual) {
    ctx.log('verify', issue, `visual review skipped, nothing visible changed: ${review.reason}`);
    return true;
  }
  if (review.sendBack === null) {
    ctx.log('verify', issue, 'visual review passed');
    updateState(ctx.statePath, (state) => ({ ...state, visualSendBacks: Object.fromEntries(Object.entries(state.visualSendBacks).filter(([key]) => key !== String(issue))) }));
    return true;
  }
  await sendBack(ctx, issue, review.sendBack);
  return false;
}

const TARGETS = { implementation: 'Implementation', design: 'Design' } as const;
const INTROS = {
  implementation: 'The testing agent read the captured gameplay images of the final build and found they do not look right. The plan stands, but the build needs more than a tuning fix. Rebuild what these mismatches name, then recapture and look at the pixels again before you finish.',
  design: 'The testing agent read the captured gameplay images of the final build and found they do not look right, and the cause is in the plan. Revise the design so these mismatches cannot come back, not only the build.',
};

async function sendBack(ctx: Ctx, issue: number, back: SendBack): Promise<void> {
  // The card leaves Testing, so a check-fix phase it was in goes too. Its next trip through Testing starts from verify.
  const sent = (updateState(ctx.statePath, (state) => ({ ...state, testPhase: Object.fromEntries(Object.entries(state.testPhase).filter(([key]) => key !== String(issue))), visualSendBacks: { ...state.visualSendBacks, [String(issue)]: (state.visualSendBacks[String(issue)] ?? 0) + 1 } })).visualSendBacks[String(issue)]) ?? 1;
  const report = back.mismatches.map((mismatch) => `- (${mismatch.scope}) ${mismatch.description}`).join('\n');
  if (sent > VISUAL_SEND_BACKS) throw new Error(`The visual review rejected the build after ${VISUAL_SEND_BACKS} send-backs already. The card stays in Testing for Hermes. Mismatches:\n${report}`);
  await ctx.github.comment(issue, `${VISUAL_HEADING}\n\n${INTROS[back.to]}\n\n${fitComment(report, 'the testing agent log')}`);
  ctx.log('verify', issue, `visual review sent the card back to ${TARGETS[back.to]} (${sent} of ${VISUAL_SEND_BACKS})`);
  await ctx.github.move(issue, TARGETS[back.to]);
}
