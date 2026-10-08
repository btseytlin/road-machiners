import { moveCard } from '../card-events';
import { readState, updateState } from '../state';
import { BUNDLED_LABEL, HOTFIX_LABEL, NEEDS_INFO_LABEL, STUCK_LABEL, type Card, type Ctx, type FactoryState } from '../types';

export function bundleOf(state: FactoryState, lead: number): number[] {
  return state.bundles[String(lead)] ?? [];
}

export function bundleCandidates(state: FactoryState, cards: Card[], lead: number): number[] {
  const busy = new Set(state.jobs.map((job) => job.issue));
  const blocked = [STUCK_LABEL, NEEDS_INFO_LABEL, HOTFIX_LABEL, BUNDLED_LABEL];
  return cards
    .filter((card) => card.column === 'Triage' && card.issue !== lead && !busy.has(card.issue) && bundleOf(state, card.issue).length === 0)
    .filter((card) => !blocked.some((label) => card.labels.includes(label)))
    .map((card) => card.issue)
    .sort((a, b) => a - b);
}

export async function addToBundle(ctx: Ctx, lead: number, issues: number[], reason: string): Promise<void> {
  for (const issue of issues) {
    await ctx.github.comment(issue, `Triage bundled this into #${lead}, which carries it from here: ${reason}\n\nIt closes when #${lead} ships.`);
    await ctx.github.addLabel(issue, BUNDLED_LABEL);
    await moveCard(ctx, issue, 'Done', 'bundled');
  }
  updateState(ctx.statePath, (state) => ({ ...state, bundles: { ...state.bundles, [String(lead)]: [...bundleOf(state, lead), ...issues] } }));
}

export async function closeBundle(ctx: Ctx, lead: number, note: string): Promise<number[]> {
  const issues = bundleOf(readState(ctx.statePath), lead);
  for (const issue of issues) {
    await ctx.github.comment(issue, `${note} It shipped as part of #${lead}.`);
    await ctx.github.close(issue, 'completed');
  }
  forgetBundle(ctx, lead);
  return issues;
}

export async function releaseBundle(ctx: Ctx, lead: number, why: string): Promise<void> {
  for (const issue of bundleOf(readState(ctx.statePath), lead)) {
    await ctx.github.comment(issue, `#${lead} ${why}, so this issue goes back to triage on its own.`);
    await ctx.github.removeLabel(issue, BUNDLED_LABEL);
    await moveCard(ctx, issue, 'Triage', 'unbundled');
  }
  forgetBundle(ctx, lead);
}

function forgetBundle(ctx: Ctx, lead: number): void {
  updateState(ctx.statePath, (state) => {
    const bundles = { ...state.bundles };
    delete bundles[String(lead)];
    return { ...state, bundles };
  });
}
