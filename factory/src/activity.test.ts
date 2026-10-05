import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import * as activity from './activity';
import { readObservation } from './observability';
import type { Run } from './types';
const homes: string[] = [];
function createHome() { mkdirSync('tmp', { recursive: true }); const home = mkdtempSync('tmp/activity-'); homes.push(home); return home; }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
it('reports structured tool activity across chunk boundaries without publishing arguments', async () => {
  expect(activity).toHaveProperty('createObservedRun');
  const home = createHome();
  const run: Run = async (_cmd, _args, opts) => {
    const event = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test -- PRIVATE_TOKEN' } }] } }) + '\n';
    opts?.onStdout?.(event.slice(0, 25));
    opts?.onStdout?.(event.slice(25));
    const current = readObservation(home, 'job-1');
    expect(current?.data).toMatchObject({ type: 'activity', activity: 'tests', phase: 'running' });
    expect(JSON.stringify(current)).not.toContain('PRIVATE');
    return { code: 0, stdout: 'original output', stderr: '' };
  };
  const observed = activity.createObservedRun(run, home, 'job-1', 10000, 1024 * 1024);
  expect(await observed('docker', ['run', 'factory-agent'])).toEqual({ code: 0, stdout: 'original output', stderr: '' });
  expect(readObservation(home, 'job-1')?.data).toMatchObject({ phase: 'completed' });
});
it('keeps an agent milestone while runner events change the current operation', async () => {
  const home = createHome();
  const observed = activity.createObservedRun(async (_command, _args, opts) => {
    opts?.onStdout?.('{"type":"factory_status","milestone":"validating"}\n');
    opts?.onStdout?.(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test PRIVATE_TOKEN' } }] } }) + '\n');
    const current = readObservation(home, 'job-milestone');
    expect(current?.data).toMatchObject({ activity: 'tests', milestone: 'validating', source: 'runner', phase: 'running' });
    expect(JSON.stringify(current)).not.toContain('PRIVATE_TOKEN');
    return { code: 0, stdout: '', stderr: '' };
  }, home, 'job-milestone', 10000, 1024 * 1024);
  await observed('docker', ['run', 'factory-agent']);
  expect(readObservation(home, 'job-milestone')?.data).toMatchObject({ milestone: 'validating', phase: 'completed' });
});
it('clears the active operation on command failure without replacing its result', async () => {
  expect(activity).toHaveProperty('createObservedRun');
  const home = createHome();
  const observed = activity.createObservedRun(async () => ({ code: 1, stdout: '', stderr: 'PRIVATE error' }), home, 'job-2', 10000, 1024 * 1024);
  expect((await observed('git', ['fetch'])).code).toBe(1);
  expect(readObservation(home, 'job-2')?.data).toMatchObject({ activity: 'git', phase: 'failed' });
  expect(JSON.stringify(readObservation(home, 'job-2'))).not.toContain('PRIVATE');
});
it('recognizes machine check steps and rejects arbitrary status text', () => {
  expect(activity).toHaveProperty('readActivityLine');
  expect(activity.readActivityLine('[checks] 12:10:00 playtest')).toEqual({ activity: 'playtest', source: 'runner' });
  expect(activity.readActivityLine('{"type":"factory_status","activity":"install"}')).toEqual({ activity: 'install', source: 'agent' });
  expect(activity.readActivityLine('{"type":"factory_status","milestone":"validating"}')).toEqual({ milestone: 'validating', source: 'agent' });
  const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"type":"factory_status","milestone":"reviewing"}\n' }] }] } };
  expect(activity.readActivityLine(JSON.stringify(toolResult))).toEqual({ milestone: 'reviewing', source: 'agent' });
  expect(activity.readActivityLine('PRIVATE prompt and secrets')).toBeNull();
});

it('finds a milestone in chained command output, as agents send it in the factory', () => {
  // Shape copied from a factory job log: `factory-status reading; factory-status milestone understanding; wc -l ...`.
  const text = '{"type":"factory_status","activity":"reading"}\n{"type":"factory_status","milestone":"understanding"}\n  120 .factory-tasks/issue-157.md\nPRIVATE {"type":"factory_status","milestone":"planning"}\n';
  const chained = { type: 'user', message: { content: [{ type: 'tool_result', content: text }] } };
  expect(activity.readActivityLine(JSON.stringify(chained))).toEqual({ milestone: 'understanding', source: 'agent' });
  const activityOnly = { type: 'user', message: { content: [{ type: 'tool_result', content: '{"type":"factory_status","activity":"investigate"}\n ✓ src/fog.test.ts (3 tests)' }] } };
  expect(activity.readActivityLine(JSON.stringify(activityOnly))).toEqual({ activity: 'investigate', source: 'agent' });
  const plain = { type: 'user', message: { content: [{ type: 'tool_result', content: 'tests passed' }] } };
  expect(activity.readActivityLine(JSON.stringify(plain))).toEqual({ activity: 'model', source: 'runner' });
});
