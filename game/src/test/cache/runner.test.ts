import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testId } from './store';

const GAME = process.cwd();
const RUNNER_FILES = ['scripts/test-cache.mjs', 'src/test/cache/fingerprint.ts', 'src/test/cache/store.ts', 'src/test/cache/select.ts', 'src/test/cache/reads-setup.ts', 'src/test/cache/stall.ts'];
const CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'], maxWorkers: 2, minWorkers: 1, testTimeout: 0 } });
`;
const RUN_LIMIT_MS = 60_000;

let root: string;

function put(rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const passingTest = (name: string) => `import { expect, it } from 'vitest';
import { value } from './${name}';
it('${name} holds', () => expect(value).toBe('${name}'));
`;

const gatedTest = `import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
it('waits for the gate', async () => {
  while (!existsSync(join(process.cwd(), 'gate-open'))) await new Promise((done) => setTimeout(done, 50));
});
`;

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'TEST_CACHE_READS' && key !== 'TEST_STALL_MINUTES'));
  return { ...env, ...extra };
}

const runnerArgs = [join(GAME, 'node_modules', '.bin', 'vite-node'), 'scripts/test-cache.mjs', '--', '--cache', 'cache'];

function runCached(extra: Record<string, string> = {}): { code: number | null; out: string } {
  const result = spawnSync(runnerArgs[0]!, runnerArgs.slice(1), { cwd: root, env: childEnv(extra), encoding: 'utf8', timeout: RUN_LIMIT_MS });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const cached = (test: string) => existsSync(join(root, 'cache', 'entries', testId(test)));

async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + RUN_LIMIT_MS;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('the condition never held');
    await new Promise((wait) => setTimeout(wait, 100));
  }
}

beforeEach(() => {
  mkdirSync(join(GAME, 'tmp'), { recursive: true });
  root = mkdtempSync(join(GAME, 'tmp', 'runner-'));
  for (const file of RUNNER_FILES) cpSync(join(GAME, file), join(root, file));
  symlinkSync(join(GAME, 'node_modules'), join(root, 'node_modules'));
  put('package-lock.json', '{}');
  put('vitest.config.ts', CONFIG);
  for (const name of ['a', 'b']) {
    put(`src/${name}.ts`, `export const value = '${name}';\n`);
    put(`src/${name}.test.ts`, passingTest(name));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('test:cached', { timeout: 4 * RUN_LIMIT_MS }, () => {
  it('keeps the passes of finished files when the run is killed, and the rerun on the same inputs runs only the rest', async () => {
    put('src/gated.test.ts', gatedTest);
    const run = spawn(runnerArgs[0]!, runnerArgs.slice(1), { cwd: root, env: childEnv({}), detached: true, stdio: 'ignore' });
    const exited = new Promise((done) => run.on('exit', done));
    try {
      await until(() => cached('src/a.test.ts') && cached('src/b.test.ts'));
    } finally {
      process.kill(-run.pid!, 'SIGKILL');
      await exited;
    }
    expect(cached('src/gated.test.ts')).toBe(false);

    put('gate-open', '');
    const rerun = runCached();

    expect(rerun.out).toContain('[test-cache] ran 1, skipped 2');
    expect(rerun.code).toBe(0);
  });

  it('runs a test again after its source changes, and every test after the config changes', () => {
    expect(runCached().out).toContain('[test-cache] ran 2, skipped 0');

    put('src/a.ts', `export const value = 'a';\nexport const extra = 1;\n`);
    expect(runCached().out).toContain('[test-cache] ran 1, skipped 1');

    put('vitest.config.ts', CONFIG.replace('maxWorkers: 2', 'maxWorkers: 1'));
    expect(runCached().out).toContain('[test-cache] ran 2, skipped 0');
  });

  it('records no pass for a failed assertion and fails the run, while the passing files keep theirs', () => {
    put('src/fails.test.ts', `import { expect, it } from 'vitest';\nit('is wrong', () => expect(1).toBe(2));\n`);

    const first = runCached();
    const second = runCached();

    expect(first.code).toBe(1);
    expect(cached('src/fails.test.ts')).toBe(false);
    expect(second.out).toContain('[test-cache] ran 1, skipped 2');
    expect(second.code).toBe(1);
  });

  it('stops a run whose test never finishes and names it, and keeps the passes of the other files', () => {
    put('src/hangs.test.ts', `import { it } from 'vitest';\nit('waits forever', () => new Promise(() => {}));\n`);

    const run = runCached({ TEST_STALL_MINUTES: '0.25' });

    expect(run.code).toBe(1);
    expect(run.out).toContain('[test-cache] StallError: no test finished in 0.25 minutes. Still running: src/hangs.test.ts > waits forever');
    expect([cached('src/a.test.ts'), cached('src/b.test.ts'), cached('src/hangs.test.ts')]).toEqual([true, true, false]);
  });
});
