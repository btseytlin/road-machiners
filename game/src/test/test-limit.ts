// Stops a test whose synchronous loop holds its worker past its time limit. Vitest's own timer cannot fire while a test never
// yields, so a thread beside it watches the start and limit the runner writes, prints the test's name and kills its own fork.
// It arms only in a vitest forks child, so it never kills the vitest process itself.
import { Worker } from 'node:worker_threads';

export const GRACE_MS = 10_000;
const WATCH_MS = 1_000;
const NAME_BYTES = 2_048;

const WATCHER = `
const { writeSync } = require('node:fs');
const { workerData } = require('node:worker_threads');
const clock = new Float64Array(workerData.shared, 0, 3);
const name = new Uint8Array(workerData.shared, 24);
setInterval(() => {
  const [start, limit, length] = clock;
  if (start === 0 || Date.now() < start + limit + workerData.grace) return;
  const test = new TextDecoder().decode(name.slice(0, length));
  const ran = Math.round((Date.now() - start) / 1000);
  writeSync(2, '\\n[test-limit] FAIL ' + test + '\\nTestLimitError: the test ran ' + ran + ' s, past its ' + limit / 1000 + ' s limit, without yielding. ' +
    'Vitest cannot stop such a loop, so its worker was killed and the run ends here. Bound the loop, or give a slow test that finishes an explicit budget().\\n');
  process.kill(process.pid, 'SIGKILL');
}, workerData.every);
`;

type Slot = { clock: Float64Array; name: Uint8Array };
let slot: Slot | null | undefined;

function armed(): Slot | null {
  if (slot !== undefined) return slot;
  if (typeof process.send !== 'function') return (slot = null);
  const shared = new SharedArrayBuffer(24 + NAME_BYTES);
  new Worker(WATCHER, { eval: true, workerData: { shared, grace: GRACE_MS, every: WATCH_MS } }).unref();
  return (slot = { clock: new Float64Array(shared, 0, 3), name: new Uint8Array(shared, 24) });
}

export async function withinLimit(name: string, limitMs: number, run: () => unknown): Promise<void> {
  const watch = armed();
  if (watch === null) {
    await run();
    return;
  }
  const { written } = new TextEncoder().encodeInto(name, watch.name);
  watch.clock.set([Date.now(), limitMs, written]);
  try {
    await run();
  } finally {
    watch.clock[0] = 0;
  }
}
