import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession, JobStage } from './types';

const STAGE_FILE = 'resumes';

// The agent's Claude Code sessions of one issue live here, mounted into its containers. They outlive a container, so a resumed job can continue a conversation.
export function sessionsDir(home: string, issue: number): string {
  return join(home, 'sessions', `issue-${issue}`);
}

// The session of one agent round. A resuming job reuses the id the round stored, when Claude Code saved that conversation. Any other round gets a fresh id, written to `<round>.id` before the run.
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

// Claude Code saves a conversation as `<working folder>/<id>.jsonl` under the projects folder. A container that died before its first save left none.
function savedSession(dir: string, id: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, `${id}.jsonl`)));
}

// The tick names the stage whose process died, so only a job of that stage resumes these sessions.
export function markResumed(home: string, issue: number, stage: JobStage): void {
  const dir = sessionsDir(home, issue);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${STAGE_FILE}.tmp`), stage);
  renameSync(join(dir, `${STAGE_FILE}.tmp`), join(dir, STAGE_FILE));
}

// The stage that resumes in these sessions, or null when none does.
export function resumedStage(home: string, issue: number): string | null {
  const file = join(sessionsDir(home, issue), STAGE_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function clearSessions(home: string, issue: number): void {
  rmSync(sessionsDir(home, issue), { recursive: true, force: true });
}
