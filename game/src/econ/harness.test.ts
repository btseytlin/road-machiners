import { describe, expect, it } from 'vitest';
import { exploratoryRatio, runPolicy, type PolicyName, type RunReport } from './harness';

const POLICIES: PolicyName[] = ['idle', 'haulOnly', 'salvageOnly', 'contractsOnly', 'greedy'];

// runPolicy is deterministic for a given (seed, policy, days) triple, and several tests below only read a
// different field off the same combination another test already ran. This cache lets each combination run once.
// The one place two independent runs matter, the determinism test right below, calls runPolicy directly instead.
const cache = new Map<string, RunReport>();
function run(seed: number, policy: PolicyName, days: number): RunReport {
  const key = `${seed}:${policy}:${days}`;
  let report = cache.get(key);
  if (!report) {
    report = runPolicy(seed, policy, days);
    cache.set(key, report);
  }
  return report;
}

describe('runPolicy', () => {
  it('gives the same report for the same seed and policy (IV6: world RNG only)', () => {
    const a = runPolicy(3, 'greedy', 1);
    const b = runPolicy(3, 'greedy', 1);
    expect(a).toEqual(b);
    cache.set('3:greedy:1', a);
  });

  it('gives a different report for a different seed', () => {
    const a = run(3, 'greedy', 1);
    const b = run(4, 'greedy', 1);
    expect(a).not.toEqual(b);
  });

  for (const policy of POLICIES) {
    it(`${policy} never lets money go negative without a recorded debt event`, () => {
      const r = run(1, policy, 1);
      const wentNegative = r.perDay.some((d) => d.money < 0);
      expect(!wentNegative || r.telemetry.debtEvents > 0).toBe(true);
    });
  }

  it('haulOnly trades goods over a day', () => {
    const r = run(1, 'haulOnly', 1);
    expect(r.telemetry.trades).toBeGreaterThan(0);
  });

  // Map loot is thin, so a load worth selling takes more than one day to gather.
  it('salvageOnly searches and sells over two days', () => {
    const r = run(1, 'salvageOnly', 2);
    expect(r.telemetry.trades).toBeGreaterThan(0);
  });

  it('contractsOnly accepts at least one contract over a few days', () => {
    const r = run(1, 'contractsOnly', 3);
    expect(r.telemetry.contractsAccepted).toBeGreaterThan(0);
  });

  it('greedy performs a core action (trading, contracting or fighting) over a day', () => {
    const r = run(1, 'greedy', 1);
    const acted = r.telemetry.trades + r.telemetry.contractsAccepted + r.telemetry.fights;
    expect(acted).toBeGreaterThan(0);
  });

  it('reports one day per requested day, in order', () => {
    const r = run(1, 'haulOnly', 3);
    expect(r.perDay.map((d) => d.day)).toEqual([1, 2, 3]);
  });

  it('greedy buys an upgrade within three days on most seeds', () => {
    // One seed tests where the random stream lands, not the policy.
    const buying = [1, 2, 3, 4, 5, 6].filter((seed) => run(seed, 'greedy', 3).telemetry.upgradesBought > 0);
    expect(buying.length).toBeGreaterThanOrEqual(4);
  });

  it('idle never trades, fights or accepts a contract', () => {
    const r = run(1, 'idle', 1);
    expect(r.telemetry.trades + r.telemetry.fights + r.telemetry.contractsAccepted).toBe(0);
  });

  it('computes an exploratory_ratio from greedy and monotonous runs', () => {
    const reports = [1, 2, 3].flatMap((seed) => (['idle', 'haulOnly', 'greedy'] as PolicyName[]).map((policy) => run(seed, policy, 1)));
    expect(exploratoryRatio(reports)).not.toBeNull();
  });
});
