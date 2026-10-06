import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseAgentStatus } from './observability';
it('emits only an allowed activity from the agent reporting command', () => {
  expect(existsSync('docker/factory-status')).toBe(true);
  const output = execFileSync('sh', ['docker/factory-status', 'review'], { encoding: 'utf8' });
  expect(parseAgentStatus(output)).toEqual({ activity: 'review' });
});
it('emits a milestone in the card\'s words', () => {
  const output = execFileSync('sh', ['docker/factory-status', 'milestone', "Building the orchard's buildings, 2 of 3"], { encoding: 'utf8' });
  expect(parseAgentStatus(output)).toEqual({ milestone: "Building the orchard's buildings, 2 of 3" });
});
it('rejects arbitrary notes, unsafe milestones and extra arguments', () => {
  expect(existsSync('docker/factory-status')).toBe(true);
  const unsafe = ['PRIVATE src/game.ts', 'PRIVATE "quoted"', 'PRIVATE $HOME', 'PRIVATE <b>', 'PR', `PRIVATE ${'x'.repeat(80)}`];
  for (const args of [['PRIVATE secret'], ['review', 'PRIVATE note'], ['milestone', 'validating', 'PRIVATE note'], ...unsafe.map((text) => ['milestone', text])]) {
    const result = spawnSync('sh', ['docker/factory-status', ...args], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('PRIVATE');
  }
});
