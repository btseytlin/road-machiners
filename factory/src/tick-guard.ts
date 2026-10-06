import { summarizeError } from './fail';
import { reportObservation, reportScheduler } from './observability';
import { updateState } from './state';
import type { Ctx } from './types';

// Runs one tick. A crash records its summary for Hermes's incident watch, then crashes on, so the timer sees it too. The factory posts nothing.
export async function guardTick(ctx: Ctx, tickOnce: () => Promise<void>): Promise<void> {
  reportObservation(ctx.cfg.home, 'tick', { type: 'activity', activity: 'starting', phase: 'running', source: 'runner' }, ctx.now());
  try {
    await tickOnce();
    reportObservation(ctx.cfg.home, 'tick', { type: 'activity', activity: 'finished', phase: 'completed', source: 'runner' }, ctx.now());
    updateState(ctx.statePath, (state) => ({ ...state, lastTickError: null }));
  } catch (error) {
    reportScheduler(ctx.cfg.home, 'failed', ctx.now());
    const summary = summarizeError(error instanceof Error ? error.message : String(error));
    updateState(ctx.statePath, (state) => ({ ...state, lastTickError: summary }));
    throw error;
  }
}
