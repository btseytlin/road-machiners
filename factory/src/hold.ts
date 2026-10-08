// A hold stops one card without a failure. `factory pause-card` stops the card's job and keeps its work clone and sessions,
// and the tick starts no job on the issue until `resume-card` lifts the hold. The stopped stage then continues in its sessions.
import { killJob } from './jobs';
import { recordJob } from './ledger';
import { CARD_JOBS } from './position';
import { markResumed } from './sessions';
import { readState, updateState } from './state';
import { interruptJob } from './tick';
import { RELEASE_LABEL, type Card, type Ctx, type FactoryState, type Hold, type Job } from './types';

function requireHoldable(state: FactoryState, card: Card | undefined, issue: number): void {
  if (card === undefined) throw new Error(`Issue #${issue} is not on the board.`);
  if (card.labels.includes(RELEASE_LABEL)) throw new Error(`Issue #${issue} is the release tracking card. The release flow owns it.`);
  if (card.column === 'Done') throw new Error(`Issue #${issue} is Done and runs nothing.`);
  const hold = state.held[String(issue)];
  if (hold !== undefined) throw new Error(`Issue #${issue} is held already, by ${hold.by} since ${hold.at}: ${hold.reason}`);
  const branchJob = branchJobOf(state, card);
  if (branchJob !== undefined) throw new Error(`Issue #${issue} runs a ${branchJob.stage} job, which a hold never stops. Repeat the order after it ends.`);
}

function branchJobOf(state: FactoryState, card: Card): Job | undefined {
  return state.jobs.find((job) => (job.issue === card.issue && !CARD_JOBS.includes(job.stage)) || (job.stage === 'merge' && card.column === 'Merging'));
}

export async function holdCard(ctx: Ctx, issue: number, by: string, reason: string): Promise<string> {
  const card = (await ctx.github.cards()).find((row) => row.issue === issue);
  requireHoldable(readState(ctx.statePath), card, issue);
  const killed = readState(ctx.statePath).jobs.filter((job) => job.issue === issue);
  for (const job of killed) await killJob(ctx.run, job.pid, job.id);
  let stopped: Job[] = [];
  updateState(ctx.statePath, (state) => {
    stopped = state.jobs.filter((job) => killed.some((row) => row.id === job.id));
    const after = stopped.reduce((next, job) => interruptJob(next, { ...job, issue }), state);
    const hold: Hold = { by, reason, at: ctx.now().toISOString(), stage: stopped[0]?.stage ?? null };
    return { ...after, held: { ...after.held, [issue]: hold } };
  });
  for (const job of stopped) {
    markResumed(ctx.cfg.home, issue, job.stage);
    recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), job, 'held');
  }
  if (stopped.length === 0) return 'Held. No job ran on it, and the factory starts none until resume-card.';
  return `Held. Its ${stopped[0].stage} job stopped. Its work clone and agent sessions stay, and the factory starts no job on it until resume-card.`;
}

export function releaseHold(ctx: Ctx, issue: number): string {
  const hold = readState(ctx.statePath).held[String(issue)];
  if (hold === undefined) throw new Error(`Issue #${issue} is not held.`);
  updateState(ctx.statePath, (state) => ({ ...state, held: Object.fromEntries(Object.entries(state.held).filter(([key]) => key !== String(issue))) }));
  if (hold.stage === null) return 'Released the hold. The next tick runs its stage.';
  return `Released the hold. The next tick runs its stage, and a ${hold.stage} job continues the stopped agent sessions.`;
}
