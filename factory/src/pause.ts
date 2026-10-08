import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const pauseFile = (home: string): string => `${home}/paused`;

export class UsageLimitError extends Error {}

export function pauseForUsageLimit(home: string, message: string): void {
  try { writeFileSync(pauseFile(home), `Hermes: Claude weekly usage limit; ${message}\n`, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export function pausedReason(home: string): string | null {
  const path = pauseFile(home);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim() || 'no reason given';
}

export function pausePid(text: string): number | null {
  const line = text.split('\n').find((row) => row.startsWith('pid:'));
  if (line === undefined) return null;
  const pid = Number(line.slice('pid:'.length).trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`The pause file names no valid process in "${line}".`);
  return pid;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

export function liftEndedPause(home: string, alive: (pid: number) => boolean = pidAlive): string | null {
  const reason = pausedReason(home);
  if (reason === null) return null;
  const pid = pausePid(reason);
  if (pid === null || alive(pid)) return null;
  rmSync(pauseFile(home));
  return reason;
}
