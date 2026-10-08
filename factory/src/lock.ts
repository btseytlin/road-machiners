import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isAlive } from './jobs';

const POLL_MS = 100;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

type Attempt = 'taken' | 'mine' | 'busy';

function tryTake(dir: string): Attempt {
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return ownerState(dir);
  }
  writeFileSync(join(dir, 'owner'), String(process.pid));
  return 'taken';
}

function ownerState(dir: string): Attempt {
  const inode = statSync(dir, { throwIfNoEntry: false })?.ino;
  const owner = readOwner(dir);
  if (owner === process.pid) return 'mine';
  if (owner !== null && !isAlive(owner)) dropStale(dir, inode);
  return 'busy';
}

function dropStale(dir: string, inode: number | undefined): void {
  if (statSync(dir, { throwIfNoEntry: false })?.ino === inode) rmSync(dir, { recursive: true, force: true });
}

function readOwner(dir: string): number | null {
  try {
    return Number(readFileSync(join(dir, 'owner'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function timedOut(dir: string, started: number, timeoutMs: number): void {
  if (Date.now() - started > timeoutMs) throw new Error(`Lock ${dir} stayed busy for ${Math.round(timeoutMs / 1000)} s. Its owner pid is ${readOwner(dir) ?? 'unknown'}.`);
}

export function withLockSync<T>(dir: string, timeoutMs: number, work: () => T): T {
  mkdirSync(dirname(dir), { recursive: true });
  const started = Date.now();
  for (;;) {
    const attempt = tryTake(dir);
    if (attempt === 'mine') throw new Error(`Lock ${dir} is already held by this process.`);
    if (attempt === 'taken') break;
    timedOut(dir, started, timeoutMs);
    Atomics.wait(sleeper, 0, 0, POLL_MS);
  }
  try {
    return work();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function withLock<T>(dir: string, timeoutMs: number, work: () => Promise<T>, onWait?: (owner: number | null) => void): Promise<T> {
  mkdirSync(dirname(dir), { recursive: true });
  const started = Date.now();
  while (tryTake(dir) !== 'taken') {
    onWait?.(readOwner(dir));
    timedOut(dir, started, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  try {
    return await work();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
