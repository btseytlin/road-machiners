import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Input } from './fingerprint';

const KINDS = new Set(['file', 'dir', 'missing']);

export const testId = (test: string): string => createHash('sha1').update(test).digest('hex');

export function entryPath(cache: string, test: string, fingerprint: string): string {
  return join(cache, 'entries', testId(test), `${fingerprint}.json`);
}

function readEntry(file: string): Input[] {
  let entry: unknown;
  try {
    entry = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Corrupt test cache entry ${file}: ${(error as Error).message}`);
  }
  const inputs = (entry as { inputs?: unknown } | null)?.inputs;
  const valid = Array.isArray(inputs) && inputs.every((input) => typeof input?.path === 'string' && KINDS.has(input?.kind));
  if (!valid) throw new Error(`Corrupt test cache entry ${file}: inputs must be a list of { path, kind }`);
  return inputs as Input[];
}

export function passedFingerprints(cache: string, test: string): Input[][] {
  const dir = join(cache, 'entries', testId(test));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => readEntry(join(dir, name)));
}

// A hit touches the entry, since the factory prunes the folder by age.
export function hasPass(cache: string, test: string, fingerprint: string): boolean {
  const file = entryPath(cache, test, fingerprint);
  if (!existsSync(file)) return false;
  const now = new Date();
  utimesSync(file, now, now);
  return true;
}

// Checks jobs share the folder, so the entry appears whole or not at all.
export function recordPass(cache: string, test: string, fingerprint: string, inputs: Input[]): void {
  const file = entryPath(cache, test, fingerprint);
  mkdirSync(join(file, '..'), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ inputs }));
  renameSync(temp, file);
}
