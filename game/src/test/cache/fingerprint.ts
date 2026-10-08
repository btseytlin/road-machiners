import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Input = { path: string; kind: 'file' | 'dir' | 'missing' };

// The version holds the commit hash, so it differs on every commit and no test result depends on its value.
const PER_COMMIT_DEFINES = new Set(['__GAME_VERSION__']);

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

function testSupportFiles(root: string, dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return testSupportFiles(root, path);
      return entry.name.endsWith('.test.ts') ? [] : [path];
    });
}

// What every test file depends on, so a change here invalidates every cached pass.
export function globalKey(root: string, define: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const files = ['package-lock.json', 'vitest.config.ts', join('scripts', 'test-cache.mjs'), ...testSupportFiles(root, join('src', 'test'))];
  const parts = files.map((file) => `${file}\0${sha256(readFileSync(join(root, file)))}`);
  const defines = Object.entries(define).filter(([name]) => !PER_COMMIT_DEFINES.has(name)).sort(([a], [b]) => a.localeCompare(b));
  parts.push(JSON.stringify(defines), process.version, `TEST_TIMEOUTS=${env.TEST_TIMEOUTS ?? ''}`);
  return sha256(parts.join('\n'));
}

function stateOf(root: string, path: string, states: Map<string, string>): string {
  const known = states.get(path);
  if (known !== undefined) return known;
  const full = join(root, path);
  const stat = statSync(full, { throwIfNoEntry: false });
  let state = 'missing';
  if (stat?.isDirectory()) state = `dir:${readdirSync(full).sort().join('\0')}`;
  else if (stat) state = `file:${sha256(readFileSync(full))}`;
  states.set(path, state);
  return state;
}

// The states map lets one selection pass hash a shared file once.
export function fingerprint(root: string, key: string, inputs: Input[], states = new Map<string, string>()): string {
  const parts = inputs.map((input) => `${input.path}\0${stateOf(root, input.path, states)}`);
  return sha256([key, ...parts].join('\n'));
}
