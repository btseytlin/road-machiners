import { availableParallelism } from 'node:os';

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget. A machine with fewer cores gets one worker per core, since more workers starve each other and vitest's worker calls time out.
// The factory pins its containers to their own CPUs, and availableParallelism() counts only those.
// The factory also sets TEST_WORKERS per container, so the test runs of all its jobs fit the server's memory. A set value wins.
export function testWorkers(): number {
  const raw = process.env.TEST_WORKERS;
  if (raw === undefined) return Math.min(6, availableParallelism());
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1) throw new Error(`TEST_WORKERS must be a whole number of 1 or more, got "${raw}".`);
  return workers;
}
