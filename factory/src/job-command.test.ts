import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { outputsNote } from './container';

it('ships factory-job in the agent image and tells every agent to use it', () => {
  expect(readFileSync('docker/Dockerfile', 'utf8')).toContain('COPY --chmod=755 factory-job /usr/local/bin/factory-job');
  expect(outputsNote('game', 30)).toContain('factory-job start <name> <activity> <minutes>');
  expect(outputsNote('game', 30)).toContain('The limit is at most 30 minutes.');
  expect(outputsNote('game', 30)).toContain('Never end your run while a job is running');
});

it('refuses a time limit above the factory cap, or no cap at all', () => {
  const start = ['docker/factory-job', 'start', 'ok', 'tests', '31', 'true'];
  const over = spawnSync('sh', start, { encoding: 'utf8', env: { ...process.env, FACTORY_JOB_MAX_MINUTES: '30' } });
  expect(over.status).toBe(2);
  expect(over.stderr).toContain('at most 30 minutes');
  const unset = spawnSync('sh', start, { encoding: 'utf8', env: { ...process.env, FACTORY_JOB_MAX_MINUTES: '' } });
  expect(unset.status).not.toBe(0);
  expect(unset.stderr).toContain('FACTORY_JOB_MAX_MINUTES is not set');
});

it('rejects bad arguments before it starts anything', () => {
  for (const args of [[], ['start', 'bad name', 'tests', '5', 'true'], ['start', 'ok', 'tests', '0', 'true'], ['start', 'ok', 'tests', 'soon', 'true'], ['start', 'ok', 'tests', '5'], ['check'], ['nope', 'ok']]) {
    const result = spawnSync('sh', ['docker/factory-job', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  }
});
