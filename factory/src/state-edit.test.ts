import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from './state';
import { editState, setPath } from './state-edit';

const RELEASE = { issue: 11, branch: 'release/x', day: 'x', postId: 42, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } };

describe('setPath', () => {
  it('sets a nested value and leaves the rest of the state as it was', () => {
    const state = { ...structuredClone(EMPTY_STATE), release: RELEASE, interrupted: [5] };
    const next = setPath(state, 'release.postId', null);
    expect(next.release).toEqual({ ...RELEASE, postId: null });
    expect(next.interrupted).toEqual([5]);
    expect(state.release?.postId).toBe(42);
  });

  it('refuses a value of another kind, and a delete outside a map store', () => {
    const state = { ...structuredClone(EMPTY_STATE), release: RELEASE };
    expect(() => setPath(state, 'jobs', { a: 1 })).toThrow('"jobs" holds a array, not a object');
    expect(() => setPath(state, 'release.removed', 5)).toThrow('holds a array, not a number');
    expect(() => setPath(state, 'release.postId', undefined)).toThrow('Only an entry of a map store');
    expect(() => setPath(state, 'release', undefined)).toThrow('Only an entry of a map store');
    expect(setPath(state, 'pendingShip', 'Ann').pendingShip).toBe('Ann');
  });

  it('deletes a key', () => {
    const state = { ...structuredClone(EMPTY_STATE), pendingApprovals: { '5': 'Ann', '6': 'Bob' } };
    expect(setPath(state, 'pendingApprovals.5', undefined).pendingApprovals).toEqual({ '6': 'Bob' });
  });

  it('refuses a store the state does not have, an empty key, and a path through a value that is no object', () => {
    const state = structuredClone(EMPTY_STATE);
    expect(() => setPath(state, 'relase.postId', 1)).toThrow('The state has no store "relase"');
    expect(() => setPath(state, 'release..postId', 1)).toThrow('is not a state path');
    expect(() => setPath(state, 'release.postId', 1)).toThrow('"release" holds no object');
  });
});

describe('editState', () => {
  it('writes the change under the state lock and returns the old value', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'state-edit-')), 'state.json');
    writeState(path, { ...structuredClone(EMPTY_STATE), release: RELEASE });
    expect(editState(path, 'release.postId', 'null')).toEqual({ before: 42, after: null });
    expect(readState(path).release?.postId).toBeNull();
  });
});
