import { QUEUE_OF, type FactoryConfig, type JobStage, type Queue } from './types';

// Job containers are pinned to whole CPUs by pool, with docker's --cpuset-cpus. Pinning, unlike a CPU quota, also shows inside the container:
// node's availableParallelism() follows it, so the game's test runner starts one worker per CPU it got.
export type Pool = 'light' | 'implement' | 'test';

// Testing agents run focused tests and the preview checks like implement agents, so they share that pool.
const POOL_OF: Record<Queue, Pool> = { triage: 'light', design: 'light', branch: 'light', implement: 'implement', verify: 'implement', test: 'test' };

// The merge job runs in the branch queue, since it moves a base. It runs the only full suite of a card, so it takes the test pool.
export function poolOf(stage: JobStage): Pool {
  return stage === 'merge' ? 'test' : POOL_OF[QUEUE_OF[stage]];
}

const ORDER: Pool[] = ['light', 'implement', 'test'];

type Shares = Pick<FactoryConfig, 'cpuLight' | 'cpuImplement' | 'cpuTest'>;

const shareOf = (cfg: Shares, pool: Pool): number => ({ light: cfg.cpuLight, implement: cfg.cpuImplement, test: cfg.cpuTest })[pool];

// Light jobs run no test suite, so their containers keep the game's own rule of one test worker per CPU.
export function vitestWorkersOf(cfg: Pick<FactoryConfig, 'vitestWorkersImplement' | 'vitestWorkersTest'>, pool: Pool): number | null {
  return { light: null, implement: cfg.vitestWorkersImplement, test: cfg.vitestWorkersTest }[pool];
}

const cpuRange =(first: number, count: number): string => (count === 1 ? String(first) : `${first}-${first + count - 1}`);

// The CPUs of each pool, as cpuset strings like "2-3". Pools take consecutive CPUs in ORDER, so the light pool sits on CPU 0.
// Throws when the pools need more CPUs than the server has, since an overlap would void the guarantee.
export function cpuSets(cfg: Shares, cores: number): Record<Pool, string> {
  const counts = ORDER.map((pool) => Math.max(1, Math.round(shareOf(cfg, pool) * cores)));
  const needed = counts.reduce((sum, count) => sum + count, 0);
  if (needed > cores) throw new Error(`The CPU pools need ${needed} CPUs (${ORDER.map((pool, i) => `${pool} ${counts[i]}`).join(', ')}), and the server has ${cores}. Lower the FACTORY_CPU_* shares or add CPUs.`);
  let first = 0;
  const sets = ORDER.map((pool, i) => {
    const set = cpuRange(first, counts[i]);
    first += counts[i];
    return [pool, set];
  });
  return Object.fromEntries(sets) as Record<Pool, string>;
}
