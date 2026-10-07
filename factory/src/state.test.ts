import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readState, updateState } from './state';

describe('state', () => {
  it('reads an old state file without adhocReplies', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: null, pendingApprovals: {}, pendingChanges: [] }));
    expect(readState(path).adhocReplies).toEqual({});
  });

  it('reads an old state file without builds or jobStarts', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: null, pendingApprovals: {}, pendingChanges: [] }));
    const state = readState(path);
    expect([state.builds, state.jobStarts]).toEqual([{}, []]);
  });

  it('reads a state file that still holds the dropped capNoticed flag', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    const starts = ['2026-01-10T11:00:00.000Z'];
    writeFileSync(path, JSON.stringify({ jobs: [], jobStarts: starts, capNoticed: true }));
    expect(readState(path).jobStarts).toEqual(starts);
  });

  it('reads an old state file without the release fields, with lastMaintenance left in it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: '2026-01-01T00:00:00Z', pendingApprovals: {}, pendingChanges: [] }));
    const state = readState(path);
    expect([state.release, state.pendingShip, state.pendingRemovals]).toEqual([null, null, []]);
  });

  it('gives a release cut before the playtest its playtest, seeded by its day, and no candidate commit', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ release: { issue: 3, branch: 'release/2026-10-07', day: '2026-10-07', postId: 9, removed: [] } }));
    expect(readState(path).release).toEqual({ issue: 3, branch: 'release/2026-10-07', day: '2026-10-07', postId: 9, removed: [], candidateSha: null, playtest: { seed: 20261007, runs: 0, passed: null, blocked: null, notes: [] } });
  });

  it('turns the single job of an old state file into the job list', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    const job = { stage: 'testing', issue: 8, pid: 5, startedAt: 's', log: '/h/logs/testing-8-x.log' };
    writeFileSync(path, JSON.stringify({ job }));
    const state = readState(path);
    expect(state.jobs).toEqual([{ ...job, stage: 'verify', id: 'testing-8-x' }]);
    expect('job' in state).toBe(false);
    writeFileSync(path, JSON.stringify({ job: null }));
    expect(readState(path).jobs).toEqual([]);
  });

  it('keeps every update of writers that interleave', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    updateState(path, (s) => {
      expect(() => updateState(path, (inner) => inner)).toThrow('already held by this process');
      return { ...s, approvalPosts: { '1': 1 } };
    });
    for (let n = 2; n <= 5; n += 1) updateState(path, (s) => ({ ...s, approvalPosts: { ...s.approvalPosts, [String(n)]: n } }));
    expect(Object.keys(readState(path).approvalPosts)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('starts empty and keeps updates', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    expect(readState(path).jobs).toEqual([]);
    updateState(path, (s) => ({ ...s, approvalPosts: { '7': 12 } }));
    expect(readState(path).approvalPosts).toEqual({ '7': 12 });
  });
});
