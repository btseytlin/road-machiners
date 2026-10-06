import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as observations from './observability';
const homes: string[] = [];
function createHome(): string { mkdirSync('tmp', { recursive: true }); const home = mkdtempSync('tmp/observability-'); homes.push(home); return home; }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
it('keeps the start of an activity across heartbeats and journals only changes', () => {
  expect(observations).toHaveProperty('recordObservation');
  const home = createHome();
  const data = { type: 'activity' as const, activity: 'tests' as const, phase: 'running' as const, source: 'runner' as const };
  observations.recordObservation(home, 'job-1', data, new Date('2026-10-04T12:00:00Z'));
  observations.recordObservation(home, 'job-1', data, new Date('2026-10-04T12:00:10Z'));
  expect(observations.readObservation(home, 'job-1')).toMatchObject({ since: '2026-10-04T12:00:00.000Z', at: '2026-10-04T12:00:10.000Z', data });
  expect(readFileSync(join(home, 'ledger.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
});
it('does not replace newer activity with an out-of-order report', () => {
  expect(observations).toHaveProperty('recordObservation');
  const home = createHome();
  const data = { type: 'activity' as const, activity: 'tests' as const, phase: 'completed' as const, source: 'runner' as const };
  observations.recordObservation(home, 'job-2', data, new Date('2026-10-04T12:00:10Z'));
  expect(() => observations.recordObservation(home, 'job-2', { ...data, phase: 'running' }, new Date('2026-10-04T12:00:00Z'))).toThrow('Out-of-order');
  expect(observations.readObservation(home, 'job-2')?.data).toEqual(data);
});
it('links repeat attempts without letting an old attempt replace a newer one', () => {
  expect(observations).toHaveProperty('recordAttempt');
  const home = createHome();
  const first = { id: 'design-1-a', stage: 'design' as const, issue: 1, startedAt: '2026-10-04T12:00:00Z' };
  observations.recordAttempt(home, first, 'started', new Date('2026-10-04T12:00:00Z'));
  observations.recordAttempt(home, first, 'failed', new Date('2026-10-04T12:01:00Z'));
  const second = { ...first, id: 'design-1-b', startedAt: '2026-10-04T12:02:00Z' };
  expect(observations.recordAttempt(home, second, 'started', new Date('2026-10-04T12:02:00Z'))).toBe(first.id);
  observations.recordAttempt(home, first, 'done', new Date('2026-10-04T12:03:00Z'));
  expect(observations.readObservation(home, 'attempt-design-1')?.data).toMatchObject({ jobId: second.id, outcome: 'started', previousId: first.id });
});
it('rejects traversal and unknown activity names instead of persisting arbitrary text', () => {
  expect(observations).toHaveProperty('recordObservation');
  const home = createHome();
  expect(() => observations.readObservation(home, '../state')).toThrow('producer');
  expect(() => observations.recordObservation(home, 'bad', { type: 'activity', activity: 'reading', phase: 'running', source: 'PRIVATE' } as never)).toThrow('source');
  expect(() => observations.recordObservation(home, 'bad', { type: 'scheduler', status: 'PRIVATE', report: null, counts: {} } as never)).toThrow('scheduler');
  expect(observations.parseAgentStatus('{"type":"factory_status","activity":"PRIVATE secret"}')).toBeNull();
  expect(observations.parseAgentStatus('{"type":"factory_status","activity":"tests"}')).toEqual({ activity: 'tests' });
  expect(observations.parseAgentStatus('{"type":"factory_status","milestone":"PRIVATE secret"}')).toBeNull();
  expect(observations.parseAgentStatus('{"type":"factory_status","milestone":"validating","note":"PRIVATE secret"}')).toBeNull();
  expect(() => observations.recordObservation(home, 'bad', { type: 'activity', activity: 'tests', phase: 'running', source: 'runner', milestone: 'PRIVATE secret' } as never)).toThrow('milestone');
});
