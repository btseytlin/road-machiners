import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import * as live from './live';
import { recordObservation } from '../observability';
import { EMPTY_STATE } from '../state';
const homes: string[] = [];
function createHome() { mkdirSync('tmp', { recursive: true }); const home = mkdtempSync('tmp/live-'); homes.push(home); return home; }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
it('projects worker activity with freshness and no internal identity or private task reference', () => {
  expect(live).toHaveProperty('readLiveOperations');
  const home = createHome();
  const state = structuredClone(EMPTY_STATE);
  state.jobs.push({ id: 'PRIVATE-change-job', stage: 'change', issue: 987, pid: 4, log: 'PRIVATE/path', startedAt: '2026-10-04T12:00:00Z' });
  recordObservation(home, 'PRIVATE-change-job', { type: 'activity', activity: 'editing', phase: 'running', source: 'runner' }, new Date('2026-10-04T12:00:00Z'));
  const result = live.readLiveOperations(home, state, new Date('2026-10-04T12:01:00Z'), 10000, 60000);
  expect(result.workers[0]).toMatchObject({ activity: 'editing', status: 'stale' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(JSON.stringify(result)).not.toContain('987');
});
it('projects a safe worker milestone without copying private job fields', () => {
  const home = createHome();
  const state = structuredClone(EMPTY_STATE);
  state.jobs.push({ id: 'PRIVATE-job', stage: 'change', issue: 987, pid: 4, log: 'PRIVATE/path', startedAt: '2026-10-04T12:00:00Z' });
  recordObservation(home, 'PRIVATE-job', { type: 'activity', activity: 'tests', milestone: 'validating', phase: 'running', source: 'runner' }, new Date('2026-10-04T12:00:00Z'));
  const result = live.readLiveOperations(home, state, new Date('2026-10-04T12:00:01Z'), 10000, 60000);
  expect(result.workers[0]).toMatchObject({ activity: 'tests', milestone: 'validating', status: 'ok' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('projects only allowlisted manager intent and rejects free text', () => {
  const home = createHome();
  recordObservation(home, 'manager', { type: 'manager', activity: 'command', intent: 'investigate', phase: 'running', issue: null });
  const result = live.readLiveOperations(home, structuredClone(EMPTY_STATE), new Date(), 10000, 60000);
  expect(result.manager).toMatchObject({ activity: 'command', intent: 'investigate' });
  expect(() => recordObservation(home, 'manager', { type: 'manager', activity: 'command', intent: 'PRIVATE' as 'investigate', phase: 'running', issue: null })).toThrow('Invalid manager intent');
});
it('does not invent idle manager activity when no reports exist', () => {
  expect(live).toHaveProperty('readLiveOperations');
  const result = live.readLiveOperations(createHome(), structuredClone(EMPTY_STATE), new Date(), 10000, 60000);
  expect(result.manager).toBeNull();
  expect(result.scheduler).toBeNull();
});
