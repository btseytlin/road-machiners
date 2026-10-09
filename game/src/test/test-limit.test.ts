import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { budget } from './budget';
import { GRACE_MS } from './test-limit';

const CASES = 'src/test/fixtures/limits';

function runCase(name: string): { code: number | null; output: string; ms: number } {
  const { TEST_TIMEOUTS: _limits, FORCE_COLOR: _color, ...rest } = process.env;
  const env = { ...rest, NO_COLOR: '1' };
  const started = Date.now();
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', `${CASES}/vitest.config.ts`, `${CASES}/${name}.case.ts`], { env, encoding: 'utf8', timeout: 60_000 });
  return { code: run.status, output: `${run.stdout}${run.stderr}`, ms: Date.now() - started };
}

describe('test time limits in the real runner', () => {
  it('fails a test that never settles by name within seconds', () => {
    const run = runCase('async-hang');
    expect(run.code).toBe(1);
    expect(run.output).toContain('FAIL  src/test/fixtures/limits/async-hang.case.ts > waits forever on a promise');
    expect(run.output).toContain('Test timed out in 1000ms');
    expect(run.ms).toBeLessThan(30_000);
  }, budget(60_000));

  it('fails a hook that never settles', () => {
    const run = runCase('hook-hang');
    expect(run.code).toBe(1);
    expect(run.output).toContain('Hook timed out in 1000ms');
  }, budget(60_000));

  it('kills a synchronous loop past its limit and names the test', () => {
    const run = runCase('sync-spin');
    expect(run.code).not.toBe(0);
    expect(run.output).toContain('[test-limit] FAIL src/test/fixtures/limits/sync-spin.case.ts > a job queue > spins forever without yielding');
    expect(run.output).toContain('past its 1 s limit');
    expect(run.ms).toBeLessThan(GRACE_MS + 30_000);
  }, budget(60_000));

  it('lets a slow test that finishes pass under its explicit budget', () => {
    const run = runCase('slow-budget');
    expect(run.output).toContain('1 passed');
    expect(run.code).toBe(0);
  }, budget(60_000));
});
