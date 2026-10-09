import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { testId } from './store';

type Fn = (this: unknown, ...args: unknown[]) => unknown;
const INSTALLED = Symbol.for('roam.test-cache.reads');
const READS = Symbol.for('roam.test-cache.read-set');
const SYNC = ['readFileSync', 'readdirSync', 'existsSync', 'statSync', 'lstatSync', 'openSync', 'readFile', 'createReadStream'];
const PROMISES = ['readFile', 'readdir'];
const store = globalThis as unknown as Record<symbol, Set<string>>;

function pathOf(arg: unknown): string | undefined {
  if (typeof arg === 'string') return resolve(arg.startsWith('file://') ? fileURLToPath(arg) : arg);
  if (arg instanceof URL) return fileURLToPath(arg);
  if (Buffer.isBuffer(arg)) return resolve(arg.toString());
  return undefined;
}

function wrap(target: object, name: string): void {
  const owner = target as Record<string, Fn>;
  const original = owner[name];
  if (!original) throw new Error(`node:fs has no ${name} to record`);
  owner[name] = function (this: unknown, first: unknown, ...rest: unknown[]) {
    const path = pathOf(first);
    if (path) store[READS]!.add(path);
    return original.call(this, first, ...rest);
  };
}

if (!(INSTALLED in store)) {
  (store as Record<symbol, unknown>)[INSTALLED] = true;
  for (const name of SYNC) wrap(fs, name);
  for (const name of PROMISES) wrap(fs.promises, name);
  syncBuiltinESMExports();
}
store[READS] = new Set();

afterAll(() => {
  const dir = process.env.TEST_CACHE_READS;
  if (!dir) throw new Error('TEST_CACHE_READS is not set. Run the tests through npm run test:cached.');
  const test = relative(process.cwd(), expect.getState().testPath ?? '');
  fs.writeFileSync(join(dir, `${testId(test)}.json`), JSON.stringify([...store[READS]!]));
});
