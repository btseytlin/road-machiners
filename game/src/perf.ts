// Named timers for work at seams: a turn, a route, the path preview. Plain TypeScript, so sim code
// can use it in Node tests. Never call it inside hot loops; each call costs two clock reads.

export type PerfStat = { last: number; max: number; total: number; calls: number };

const stats = new Map<string, PerfStat>();

function stat(name: string): PerfStat {
  let s = stats.get(name);
  if (!s) {
    s = { last: 0, max: 0, total: 0, calls: 0 };
    stats.set(name, s);
  }
  return s;
}

export function timed<T>(name: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - start;
    const s = stat(name);
    s.last = ms;
    s.max = Math.max(s.max, ms);
    s.total += ms;
    s.calls++;
  }
}

export function count(name: string, n = 1): void {
  stat(name).calls += n;
}

export function perfSnapshot(): Record<string, PerfStat> {
  return Object.fromEntries([...stats].map(([k, v]) => [k, { ...v }]));
}

export function mergePerf(incoming: Record<string, PerfStat>): void {
  for (const [name, measured] of Object.entries(incoming)) {
    const current = stat(name);
    current.last = measured.last;
    current.max = Math.max(current.max, measured.max);
    current.total += measured.total;
    current.calls += measured.calls;
  }
}

export function resetPerf(): void {
  stats.clear();
}
