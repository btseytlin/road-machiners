import { appendLedger } from './ledger';
import { ADHOC_LABEL, HOTFIX_LABEL, RELEASE_LABEL, RELEASE_TASK_LABEL, type Column, type Ctx } from './types';

// Why a card changed column. Each name is one edge of the card lifecycle, so the dashboard can tell the normal path from a loop back
// and an early end without reading any text. A line holds no actor, comment or reason.
export const CARD_STEPS = [
  'entered', 'accepted', 'triage-wont-do', 'bundled', 'unbundled', 'questions', 'planned', 'design-wont-do', 'built', 'patched', 'patch-replan',
  'rebuild', 'plan-wrong', 'review-failed', 'posted', 'hardened', 'approved', 'conflict', 'patch', 'redesign', 'merged', 'denied', 'dropped',
  'moved', 'merge-ordered', 'removed', 'shipped', 'reported',
] as const;
export type CardStep = typeof CARD_STEPS[number];
// Cards that do not run the feature path. The dashboard leaves them out of the delivery numbers.
export type CardFlow = 'hotfix' | 'release-task' | 'release' | 'adhoc';

export function cardFlow(labels: string[]): CardFlow | undefined {
  if (labels.includes(RELEASE_LABEL)) return 'release';
  if (labels.includes(RELEASE_TASK_LABEL)) return 'release-task';
  if (labels.includes(HOTFIX_LABEL)) return 'hotfix';
  return labels.includes(ADHOC_LABEL) ? 'adhoc' : undefined;
}

// Every column change goes through here, so the ledger holds when each card entered each column. The line follows the move,
// so a failed move records nothing. A resumed job that repeats a move writes the same line again, and readers drop the copy.
export async function moveCard(ctx: Ctx, issue: number, to: Column, step: CardStep, flow?: CardFlow): Promise<void> {
  await ctx.github.move(issue, to);
  recordCard(ctx, issue, to, step, flow);
}

export async function addCard(ctx: Ctx, issue: number, to: Column, flow?: CardFlow): Promise<void> {
  await ctx.github.addCard(issue, to);
  recordCard(ctx, issue, to, 'entered', flow);
}

function recordCard(ctx: Ctx, issue: number, to: Column, step: CardStep, flow: CardFlow | undefined): void {
  appendLedger(ctx.cfg.home, { kind: 'card', issue, step, to, at: ctx.now().toISOString(), ...(flow === undefined ? {} : { flow }) });
}
