import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withLock, withLockSync } from './lock';

function tempDir(): string {
  mkdirSync('tmp', { recursive: true });
  return resolve(mkdtempSync('tmp/factory-lock-'));
}

function worker(lockDir: string, counter: string, rounds: number, mode: string): Promise<number> {
  const child = spawn('npx', ['vite-node', 'src/fixtures/lock-worker.ts', lockDir, counter, String(rounds), mode], { stdio: 'ignore' });
  return new Promise((done) => child.on('exit', (code) => done(code ?? -1)));
}

describe('lock', () => {
  it('loses no update when processes race on one counter', async () => {
    const dir = tempDir();
    const counter = join(dir, 'counter');
    writeFileSync(counter, '0');
    const codes = await Promise.all([worker(join(dir, 'l'), counter, 40, 'sync'), worker(join(dir, 'l'), counter, 40, 'async'), worker(join(dir, 'l'), counter, 40, 'sync')]);
    expect(codes).toEqual([0, 0, 0]);
    expect(readFileSync(counter, 'utf8')).toBe('120');
    expect(existsSync(join(dir, 'l'))).toBe(false);
  }, 60_000);

  it('takes over the lock of a dead process', () => {
    const dir = tempDir();
    const lock = join(dir, 'l');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), String(2 ** 22 - 1));
    expect(withLockSync(lock, 1000, () => 'ran')).toBe('ran');
  });

  it('fails loud when a live process keeps the lock', async () => {
    const dir = tempDir();
    const lock = join(dir, 'l');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), String(process.ppid));
    expect(() => withLockSync(lock, 300, () => 'ran')).toThrow(`Its owner pid is ${process.ppid}`);
    const owners: (number | null)[] = [];
    await expect(withLock(lock, 300, async () => 'ran', (owner) => { owners.push(owner); })).rejects.toThrow('stayed busy');
    expect(owners.length).toBeGreaterThan(0);
    expect(new Set(owners)).toEqual(new Set([process.ppid]));
  });

  it('lets async work of one process take turns', async () => {
    const lock = join(tempDir(), 'l');
    const order: string[] = [];
    const step = (name: string) => withLock(lock, 5000, async () => { order.push(`${name} in`); await new Promise((r) => setTimeout(r, 50)); order.push(`${name} out`); });
    await Promise.all([step('a'), step('b')]);
    expect(order).toEqual(['a in', 'a out', 'b in', 'b out']);
  });
});
