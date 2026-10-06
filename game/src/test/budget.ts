import { timeoutsOff } from './timeouts';

// A test's own time limit. Where test time limits are off, it returns 0, which vitest reads as no limit.
export function budget(ms: number): number {
  return timeoutsOff() ? 0 : ms;
}
