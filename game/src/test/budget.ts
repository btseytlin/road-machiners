// A slow test's own time limit, for a test that finishes but needs more than the default.
// On the factory's shared server it doubles, and is never below the shared default.
import { SHARED_LIMITS, timeoutMode } from './timeouts';

export function budget(ms: number, env: NodeJS.ProcessEnv = process.env): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`A test budget must be a finite number of ms above 0, got ${ms}.`);
  return timeoutMode(env) === 'shared' ? Math.max(SHARED_LIMITS.testTimeout, ms * 2) : ms;
}
