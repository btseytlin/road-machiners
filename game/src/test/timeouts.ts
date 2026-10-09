// Vitest time limits. Locally a test gets 30 s and a hook 10 s. TEST_TIMEOUTS=shared, which the factory sets on its loaded server,
// gives 5 min and 2 min: about six times the slowest test and ten times the slowest setup measured on idle cores, and a ninth of the
// factory's 45 min limit on a whole run. No value turns the limits off, so a hung test fails by name instead of stalling the run.
export type TimeoutMode = 'local' | 'shared';
export type Limits = { testTimeout: number; hookTimeout: number };

export const LOCAL_LIMITS: Limits = { testTimeout: 30_000, hookTimeout: 10_000 };
export const SHARED_LIMITS: Limits = { testTimeout: 300_000, hookTimeout: 120_000 };

export function timeoutMode(env: NodeJS.ProcessEnv = process.env): TimeoutMode {
  const raw = env.TEST_TIMEOUTS ?? '';
  if (raw === '') return 'local';
  if (raw === 'shared') return 'shared';
  throw new Error(`TEST_TIMEOUTS must be unset or "shared", got "${raw}". No value turns the test time limits off.`);
}

export function testLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  return timeoutMode(env) === 'shared' ? SHARED_LIMITS : LOCAL_LIMITS;
}
