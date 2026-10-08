import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession, JobStage } from './types';

const STAGE_FILE = 'resumes';
const ERROR_FILE = 'stopped-on';

export function sessionsDir(home: string, issue: number): string {
  return join(home, 'sessions', `issue-${issue}`);
}

export function roundSession(home: string, issue: number, round: string, resuming: boolean): AgentSession {
  const dir = sessionsDir(home, issue);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${round}.id`);
  const stored = resuming && existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
  if (stored === '') throw new Error(`The session id file ${file} is empty`);
  if (stored !== null && savedSession(dir, stored)) return { dir, id: stored, resume: true };
  const id = randomUUID();
  const temp = `${file}.tmp`;
  writeFileSync(temp, id);
  renameSync(temp, file);
  return { dir, id, resume: false };
}

function savedSession(dir: string, id: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, `${id}.jsonl`)));
}

export function markResumed(home: string, issue: number, stage: JobStage, error: string | null = null): void {
  const dir = sessionsDir(home, issue);
  mkdirSync(dir, { recursive: true });
  if (error !== null) writeFileSync(join(dir, ERROR_FILE), error);
  writeFileSync(join(dir, `${STAGE_FILE}.tmp`), stage);
  renameSync(join(dir, `${STAGE_FILE}.tmp`), join(dir, STAGE_FILE));
}

export function resumeError(home: string, issue: number): string | null {
  const file = join(sessionsDir(home, issue), ERROR_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function resumedStage(home: string, issue: number): string | null {
  const file = join(sessionsDir(home, issue), STAGE_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function clearSessions(home: string, issue: number): void {
  rmSync(sessionsDir(home, issue), { recursive: true, force: true });
}
