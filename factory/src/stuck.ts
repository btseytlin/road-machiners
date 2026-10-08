import { updateState } from './state';
import { STUCK_LABEL, type Ctx, type FactoryState } from './types';

export async function clearStuck(ctx: Ctx, issue: number): Promise<void> {
  await ctx.github.removeLabel(issue, STUCK_LABEL);
  updateState(ctx.statePath, (state: FactoryState) => ({ ...state, failures: state.failures.filter((row) => row.issue !== issue) }));
}
