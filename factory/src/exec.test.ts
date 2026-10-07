import { describe, expect, it } from 'vitest';
import { realRun } from './exec';

describe('realRun', () => {
  it('kills a program that runs past its timeout and names the timeout', async () => {
    const started = Date.now();
    const result = await realRun('sleep', ['30'], { timeoutMs: 200 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('sleep timed out after 200 ms and was killed');
  });

  it('returns a program that ends in time unchanged', async () => {
    expect(await realRun('echo', ['hi'], { timeoutMs: 5000 })).toEqual({ code: 0, stdout: 'hi\n', stderr: '' });
  });
});
