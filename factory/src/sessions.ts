import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveTranscripts } from './transcript-archive';
import type { AgentSession, JobStage } from './types';

const STAGE_FILE = 'resumes';
const ERROR_FILE = 'stopped-on';

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

// The tick names the stage whose process died, and a failed job names its own stage, so only a job of that stage resumes these sessions.
// A failed job also leaves its error, so the resumed agent learns what stopped it.
export function markResumed(home: string, issue: number, stage: JobStage, error: string | null = null): void {
  const dir = sessionsDir(home, issue);
  mkdirSync(dir, { recursive: true });
  if (error !== null) writeFileSync(join(dir, ERROR_FILE), error);
  writeFileSync(join(dir, `${STAGE_FILE}.tmp`), stage);
  renameSync(join(dir, `${STAGE_FILE}.tmp`), join(dir, STAGE_FILE));
}

// The error that stopped the job these sessions resume, or null when its process died with none.
export function resumeError(home: string, issue: number): string | null {
  const file = join(sessionsDir(home, issue), ERROR_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

// The stage that resumes in these sessions, or null when none does.
export function resumedStage(home: string, issue: number): string | null {
  const file = join(sessionsDir(home, issue), STAGE_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function clearSessions(home: string, issue: number): void {
  archiveTranscripts(home, sessionsDir(home, issue));
  rmSync(sessionsDir(home, issue), { recursive: true, force: true });
}
