import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessions, roundSession, sessionsDir } from './sessions';

const HOME = resolve('tmp/factory-sessions-test');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function save(dir: string, id: string): void {
  mkdirSync(`${dir}/-work-game`, { recursive: true });
  writeFileSync(`${dir}/-work-game/${id}.jsonl`, '{}\n');
}

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});

describe('sessions', () => {
  it('keeps the sessions of an issue under the factory home', () => {
    expect(sessionsDir('/h', 7)).toBe('/h/sessions/issue-7');
  });

  it('starts a round with a fresh id and writes it before the run', () => {
    const session = roundSession(HOME, 7, 'design', false);
    expect(session).toEqual({ dir: sessionsDir(HOME, 7), id: expect.stringMatching(UUID), resume: false });
    expect(readFileSync(`${session.dir}/design.id`, 'utf8')).toBe(session.id);
    expect(readdirSync(session.dir)).toEqual(['design.id']);
  });

  it('reuses the stored id of a round when resuming and Claude Code saved the conversation', () => {
    const first = roundSession(HOME, 7, 'test', false);
    save(first.dir, first.id);
    expect(roundSession(HOME, 7, 'test', true)).toEqual({ dir: first.dir, id: first.id, resume: true });
  });

  it('starts fresh when resuming a round whose container died before its first save', () => {
    const first = roundSession(HOME, 7, 'test', false);
    const again = roundSession(HOME, 7, 'test', true);
    expect(again.resume).toBe(false);
    expect(again.id).not.toBe(first.id);
  });

  it('starts a fresh session for a round with no stored id, even when resuming', () => {
    const first = roundSession(HOME, 7, 'test', false);
    const fix = roundSession(HOME, 7, 'test-fix', true);
    expect(fix.resume).toBe(false);
    expect(fix.id).not.toBe(first.id);
    expect(readFileSync(`${fix.dir}/test-fix.id`, 'utf8')).toBe(fix.id);
  });

  it('replaces the stored id when not resuming', () => {
    const first = roundSession(HOME, 7, 'test', false);
    const again = roundSession(HOME, 7, 'test', false);
    expect(again.id).not.toBe(first.id);
    expect(readFileSync(`${first.dir}/test.id`, 'utf8')).toBe(again.id);
  });

  it('clears the sessions of one issue only, and tolerates none', () => {
    roundSession(HOME, 7, 'design', false);
    roundSession(HOME, 8, 'design', false);
    clearSessions(HOME, 7);
    clearSessions(HOME, 9);
    expect(existsSync(sessionsDir(HOME, 7))).toBe(false);
    expect(existsSync(sessionsDir(HOME, 8))).toBe(true);
  });

  it('rejects a stored id file that is empty', () => {
    const { dir, id } = roundSession(HOME, 7, 'design', false);
    save(dir, id);
    writeFileSync(`${dir}/design.id`, '');
    expect(() => roundSession(HOME, 7, 'design', true)).toThrow('empty');
  });
});
