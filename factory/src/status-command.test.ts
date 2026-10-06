import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseAgentStatus } from './observability';
it('emits only an allowed activity from the agent reporting command', () => {
  expect(existsSync('docker/factory-status')).toBe(true);
  const output = execFileSync('sh', ['docker/factory-status', 'review'], { encoding: 'utf8' });
  expect(parseAgentStatus(output)).toEqual({ activity: 'review' });
});
it('emits a safe milestone without publishing the task or command', () => {
  const output = execFileSync('sh', ['docker/factory-status', 'milestone', 'validating'], { encoding: 'utf8' });
  expect(parseAgentStatus(output)).toEqual({ milestone: 'validating' });
});
it('rejects arbitrary notes and extra arguments', () => {
  expect(existsSync('docker/factory-status')).toBe(true);
  for (const args of [['PRIVATE secret'], ['review', 'PRIVATE note'], ['milestone', 'PRIVATE note'], ['milestone', 'validating', 'PRIVATE note']]) {
    const result = spawnSync('sh', ['docker/factory-status', ...args], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('PRIVATE');
  }
});
