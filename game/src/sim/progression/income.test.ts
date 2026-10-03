import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { POLICIES, type Policy } from './bot';
import { formatIncomeReport, playIncome, type IncomeRun } from './income';

const SHORT_TURNS = 60;
const RUN_TIMEOUT = 120_000; // a new world takes about 400 ms and a turn about 40 ms, slower beside other heavy files

describe('playIncome', () => {
  it('reconciles its ledger and gives a finite rate on a short run', () => {
    const run = playIncome(1337, 'robber', SHORT_TURNS / TIME.turnsPerDay);

    const net = run.endWorth - run.startWorth;
    expect(run.hours).toBeCloseTo((SHORT_TURNS * 24) / TIME.turnsPerDay);
    expect(Number.isFinite(net / run.hours)).toBe(true);
    expect(Object.values(run.ledger).every(Number.isFinite)).toBe(true);
    expect(run.walletsByDay.trader[0].length).toBeGreaterThan(0);
  }, RUN_TIMEOUT);
});

function fakeRun(policy: Policy, seed: number): IncomeRun {
  return {
    seed,
    policy,
    days: 1,
    hours: 24,
    startWorth: 3000,
    endWorth: 3000 + 240 * seed,
    ledger: { 'sell goods': 500, repair: -100 },
    daily: [240 * seed],
    attempts: [{ turn: 10, target: 'v1', kind: 'trader', guarded: false, answer: 'comply', outcome: 'pile', goodsValue: 400, repairSpent: 0 }],
    knockouts: 0,
    death: null,
    walletsByDay: { trader: [[1000, 400], [900]], convoy: [[1000], []] },
  };
}

describe('formatIncomeReport', () => {
  it('names every policy it got runs for', () => {
    const runs = POLICIES.flatMap((policy) => [fakeRun(policy, 1), fakeRun(policy, 2)]);

    const report = formatIncomeReport(runs);

    for (const policy of POLICIES) expect(report).toContain(`## ${policy}`);
  });

  it('gives the mean net per hour over seeds', () => {
    const report = formatIncomeReport([fakeRun('trader', 1), fakeRun('trader', 2)]);

    expect(report).toContain('| trader | 2 | 2 | 15 | 5 |');
  });
});
