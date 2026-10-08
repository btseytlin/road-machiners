import { QUEUE_OF, type FactoryConfig, type JobStage, type Queue } from './types';

export type Pool = 'light' | 'implement' | 'test';

const POOL_OF: Record<Queue, Pool> = { triage: 'light', design: 'light', branch: 'light', implement: 'implement', verify: 'implement', test: 'test' };

export function poolOf(stage: JobStage): Pool {
  return stage === 'merge' || stage === 'candidate' || stage === 'ship' ? 'test' : POOL_OF[QUEUE_OF[stage]];
}

const ORDER: Pool[] = ['light', 'implement', 'test'];

type Shares = Pick<FactoryConfig, 'cpuLight' | 'cpuImplement' | 'cpuTest'>;

const shareOf = (cfg: Shares, pool: Pool): number => ({ light: cfg.cpuLight, implement: cfg.cpuImplement, test: cfg.cpuTest })[pool];

export function vitestWorkersOf(cfg: Pick<FactoryConfig, 'vitestWorkersImplement' | 'vitestWorkersTest'>, pool: Pool): number | null {
  return { light: null, implement: cfg.vitestWorkersImplement, test: cfg.vitestWorkersTest }[pool];
}

const cpuRange =(first: number, count: number): string => (count === 1 ? String(first) : `${first}-${first + count - 1}`);

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
