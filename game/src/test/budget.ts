import { timeoutsOff } from './timeouts';

export function budget(ms: number): number {
  return timeoutsOff() ? 0 : ms;
}
