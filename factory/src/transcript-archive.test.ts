import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeRun, runProjectsDir } from './ledger';
import { clearSessions, sessionsDir } from './sessions';
import { archiveTranscripts, sweepTranscripts, transcriptsDir } from './transcript-archive';

const HOME = resolve('tmp/factory-transcript-archive-test');
const NOW = new Date('2026-01-30T00:00:00Z');

function save(projects: string, id: string, text: string): void {
  mkdirSync(join(projects, '-work-game', id, 'subagents'), { recursive: true });
  writeFileSync(join(projects, '-work-game', `${id}.jsonl`), text);
  writeFileSync(join(projects, '-work-game', id, 'subagents', 'agent-1.jsonl'), 'sub\n');
}

const archived = (id: string): string => readFileSync(join(transcriptsDir(HOME), id, `${id}.jsonl`), 'utf8');
const subagent = (id: string): boolean => existsSync(join(transcriptsDir(HOME), id, id, 'subagents', 'agent-1.jsonl'));

function age(id: string, days: number): void {
  const at = new Date(NOW.getTime() - days * 24 * 3_600_000);
  utimesSync(join(transcriptsDir(HOME), id, `${id}.jsonl`), at, at);
}

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});

describe('archiveTranscripts', () => {
  it('keeps an issue session and its subagents after the sessions are cleared', () => {
    save(sessionsDir(HOME, 7), 'design-id', 'main\n');
    writeFileSync(join(sessionsDir(HOME, 7), 'design.id'), 'design-id');
    clearSessions(HOME, 7);
    expect(existsSync(sessionsDir(HOME, 7))).toBe(false);
    expect([archived('design-id'), subagent('design-id')]).toEqual(['main\n', true]);
  });

  it('keeps the session of a run with no issue after the run closes', () => {
    save(runProjectsDir(HOME, 'job-5'), 'waste-id', 'main\n');
    closeRun(HOME, 'job-5', { model: 'opus', costUsd: 1, minutes: 2 });
    expect(existsSync(runProjectsDir(HOME, 'job-5'))).toBe(false);
    expect([archived('waste-id'), subagent('waste-id')]).toEqual(['main\n', true]);
  });

  it('replaces the copy of a resumed session with its longer file', () => {
    save(sessionsDir(HOME, 7), 'test-id', 'one\n');
    archiveTranscripts(HOME, sessionsDir(HOME, 7));
    save(sessionsDir(HOME, 7), 'test-id', 'one\ntwo\n');
    archiveTranscripts(HOME, sessionsDir(HOME, 7));
    expect(archived('test-id')).toBe('one\ntwo\n');
  });

  it('does nothing for a folder Claude Code never wrote', () => {
    archiveTranscripts(HOME, join(HOME, 'missing'));
    expect(existsSync(transcriptsDir(HOME))).toBe(false);
  });
});

describe('sweepTranscripts', () => {
  it('removes sessions archived longer ago than the limit and keeps the rest', () => {
    save(sessionsDir(HOME, 7), 'old', 'x\n');
    save(sessionsDir(HOME, 7), 'new', 'x\n');
    archiveTranscripts(HOME, sessionsDir(HOME, 7));
    age('old', 11);
    age('new', 9);
    expect(sweepTranscripts(HOME, NOW, 10)).toEqual(['old']);
    expect([existsSync(join(transcriptsDir(HOME), 'old')), existsSync(join(transcriptsDir(HOME), 'new'))]).toEqual([false, true]);
  });

  it('removes nothing when no session was ever archived', () => {
    expect(sweepTranscripts(HOME, NOW, 10)).toEqual([]);
  });
});
