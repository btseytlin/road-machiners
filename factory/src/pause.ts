import { existsSync, readFileSync, rmSync } from 'node:fs';

// Hermes pauses the factory with this file while it repairs state by hand. Its text says why.
// A line `pid: N` ties the pause to a process Hermes started, such as a step run by hand. The tick lifts the pause once that process ends, so a pause never outlives its work while Hermes is away.
export const pauseFile = (home: string): string => `${home}/paused`;

// The reason the factory is paused, or null when it runs.
export function pausedReason(home: string): string | null {
  const path = pauseFile(home);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim() || 'no reason given';
}

// The process a pause waits for, or null when it names none.
export function pausePid(text: string): number | null {
  const line = text.split('\n').find((row) => row.startsWith('pid:'));
  if (line === undefined) return null;
  const pid = Number(line.slice('pid:'.length).trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`The pause file names no valid process in "${line}".`);
  return pid;
}

// Signal 0 checks that a process exists. EPERM means it exists under another user.
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

// Removes a pause whose process has ended and gives its text, or null when no pause was lifted.
export function liftEndedPause(home: string, alive: (pid: number) => boolean = pidAlive): string | null {
  const reason = pausedReason(home);
  if (reason === null) return null;
  const pid = pausePid(reason);
  if (pid === null || alive(pid)) return null;
  rmSync(pauseFile(home));
  return reason;
}
