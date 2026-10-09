import { describe, expect, it } from 'vitest';
import { budget } from './budget';
import { SHARED_LIMITS, testLimits, timeoutMode } from './timeouts';

describe('test time limits', () => {
  it('keeps the local limits when TEST_TIMEOUTS is unset', () => {
    expect(timeoutMode({})).toBe('local');
    expect(testLimits({})).toEqual({ testTimeout: 30_000, hookTimeout: 10_000 });
    expect(budget(60_000, {})).toBe(60_000);
  });

  it('gives the factory server finite limits above the slowest measured test and setup', () => {
    const shared = testLimits({ TEST_TIMEOUTS: 'shared' });
    expect(shared).toEqual(SHARED_LIMITS);
    for (const limit of Object.values(shared)) {
      expect(Number.isFinite(limit)).toBe(true);
      expect(limit).toBeGreaterThan(60_000);
    }
  });

  it('gives a slow test an explicit bounded limit on the factory server, at least the shared default', () => {
    const env = { TEST_TIMEOUTS: 'shared' };
    expect(budget(30_000, env)).toBe(SHARED_LIMITS.testTimeout);
    expect(budget(360_000, env)).toBe(720_000);
  });

  it('refuses any way to turn every limit off', () => {
    expect(() => timeoutMode({ TEST_TIMEOUTS: 'off' })).toThrow('TEST_TIMEOUTS');
    expect(() => budget(0, {})).toThrow('budget');
    expect(() => budget(Number.POSITIVE_INFINITY, { TEST_TIMEOUTS: 'shared' })).toThrow('budget');
  });
});
