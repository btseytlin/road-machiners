import { describe, expect, it } from 'vitest';
import { isAlive, killJob } from './jobs';
import type { Run } from './types';

describe('isAlive', () => {
  it('is true for this process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it('is false for a pid that does not exist', () => {
    expect(isAlive(2 ** 22 - 1)).toBe(false);
  });
});

describe('killJob', () => {
  it('removes only the containers of that job', async () => {
    const calls: string[][] = [];
    const run: Run = async (_cmd, args) => {
      calls.push(args);
      return { code: 0, stdout: args[0] === 'ps' ? 'abc\ndef\n' : '', stderr: '' };
    };
    await killJob(run, 2 ** 22 - 1, 'testing-8-x');
    expect(calls).toEqual([['ps', '-q', '--filter', 'label=factory-job=testing-8-x'], ['rm', '-f', 'abc'], ['rm', '-f', 'def']]);
  });

  it('counts a container already being removed or gone as removed, and fails on any other docker error', async () => {
    const answer = (stderr: string): Run => async (_cmd, args) => (args[0] === 'ps' ? { code: 0, stdout: 'abc\n', stderr: '' } : { code: 1, stdout: '', stderr });
    await killJob(answer('Error response from daemon: removal of container abc is already in progress'), 2 ** 22 - 1, 'x');
    await killJob(answer('Error response from daemon: No such container: abc'), 2 ** 22 - 1, 'x');
    await expect(killJob(answer('permission denied'), 2 ** 22 - 1, 'x')).rejects.toThrow('docker rm abc failed');
  });
});
