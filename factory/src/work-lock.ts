/** Locks one shared folder under work/ while a job uses it, so jobs that share no folder run side by side. A job waits for a folder at most as long as a branch job may run. */
import { withLock } from './lock';
import { WORK_LOCK, type Ctx } from './types';

export function withWorkFolder<T>(ctx: Ctx, name: string, work: () => Promise<T>): Promise<T> {
  return withLock(WORK_LOCK(ctx.cfg.home, name), ctx.cfg.branchTimeoutMinutes * 60_000, work);
}
