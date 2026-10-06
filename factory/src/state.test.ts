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

  it('reads an old state file without builds, jobStarts or capNoticed', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: null, pendingApprovals: {}, pendingChanges: [] }));
    const state = readState(path);
    expect([state.builds, state.jobStarts, state.capNoticed]).toEqual([{}, [], false]);
  });

  it('reads an old state file without the release fields, with lastMaintenance left in it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: '2026-01-01T00:00:00Z', pendingApprovals: {}, pendingChanges: [] }));
    const state = readState(path);
    expect([state.release, state.pendingShip, state.pendingRemovals]).toEqual([null, null, []]);
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
