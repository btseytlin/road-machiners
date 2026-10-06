import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { outputsNote } from './container';

// The running job needs Linux setsid and GNU timeout, so only the argument checks run on any host.
it('ships factory-job in the agent image and tells every agent to use it', () => {
  expect(readFileSync('docker/Dockerfile', 'utf8')).toContain('COPY --chmod=755 factory-job /usr/local/bin/factory-job');
  expect(outputsNote('game')).toContain('factory-job start <name> <activity> <minutes>');
  expect(outputsNote('game')).toContain('Never end your run while a job is running');
});

it('rejects bad arguments before it starts anything', () => {
  for (const args of [[], ['start', 'bad name', 'tests', '5', 'true'], ['start', 'ok', 'tests', '0', 'true'], ['start', 'ok', 'tests', 'soon', 'true'], ['start', 'ok', 'tests', '5'], ['check'], ['nope', 'ok']]) {
    const result = spawnSync('sh', ['docker/factory-job', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  }
});
