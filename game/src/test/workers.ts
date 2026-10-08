import { availableParallelism } from 'node:os';

export function testWorkers(): number {
  const raw = process.env.TEST_WORKERS;
  if (raw === undefined) return Math.min(6, availableParallelism());
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1) throw new Error(`TEST_WORKERS must be a whole number of 1 or more, got "${raw}".`);
  return workers;
}
