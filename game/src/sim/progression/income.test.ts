import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { POLICIES, type Policy } from './bot';
import { INCOME_KIT, INCOME_SKILL_RANK, largestTraderLoad, playIncome, SAMPLE_TURNS, sampleWorld, type IncomeRun } from './income';
import { addVehicle, emptyWorld, npcBrain } from '../testkit';
import { addGoods } from '../inventory';
import { startWorld } from './record';
import { TRAITS } from '../../data/npcs';
import { formatIncomeReport, gateReport, pairedDifference } from './income-report';

const SHORT_TURNS = 30;
const RUN_TIMEOUT = 300_000; // a new world takes about 400 ms and a turn about 40 ms, many times that on a loaded host
const LABEL = { candidate: 'test', commit: 'abc' };

describe('playIncome', () => {
  it('reconciles its ledger and gives a finite rate on a short run', () => {
    const run = playIncome(1337, 'robber', SHORT_TURNS / TIME.turnsPerDay, LABEL);

    const net = run.endWorth - run.startWorth;
    expect(run.hours).toBeCloseTo((SHORT_TURNS * 24) / TIME.turnsPerDay);
    expect(Number.isFinite(net / run.hours)).toBe(true);
    expect(Object.values(run.ledger).every(Number.isFinite)).toBe(true);
    expect(run.walletsByDay.trader[0].length).toBeGreaterThan(0);
    expect(run).toMatchObject(LABEL);
    expect(run.samples).toHaveLength(1 + SHORT_TURNS / SAMPLE_TURNS);
    for (const s of run.samples) expect(Number.isFinite(s.haulIndex) && Number.isFinite(s.salvageIndex)).toBe(true);
    expect(run.samples[0].targets.some((t) => t.kind === 'trader')).toBe(true);
    expect(run.npcKnockoutsByDay).toEqual([]);
    expect(run.towsByDay).toEqual([]);
  }, RUN_TIMEOUT);

  it('keeps the robber blind to the cargo samples', () => {
    expect(readFileSync(new URL('./bot.ts', import.meta.url), 'utf8')).not.toMatch(/from '\.\/income/);
  });
});

describe('sampleWorld', () => {
  it('counts the goods a trader carries while it delivers a load it bought', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 160, y: 60 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    trader.brain.goals = [{ kind: 'sell', targetId: 'nose', destination: { x: 0, y: 0 }, phase: 'travel', reason: 'deliver purchased cargo' }];
    addGoods(w, trader, 'electronics', 4);
    expect(sampleWorld(w).targets).toEqual([expect.objectContaining({ kind: 'trader', guarded: false, qualifies: true, boughtGoods: 4 })]);
    trader.brain.goals[0].reason = 'load cargo at its source';
    expect(sampleWorld(w).targets[0].boughtGoods).toBe(0);
  });
});

describe('largestTraderLoad', () => {
  // G4 compares this with the hauler's mean net per day. It moves with the trader stake and the start prices.
  it('is the trader stake at the best ratio of the player sell price to the trader buy price', () => {
    const load = largestTraderLoad(startWorld(1, INCOME_KIT, INCOME_SKILL_RANK));
    expect(load).toBeGreaterThan(TRAITS.trader.tradeStake);
    expect(load).toBeCloseTo(143424.3, 1);
  }, RUN_TIMEOUT);
});

function fakeRun(policy: Policy, seed: number, rate = 10 * seed, label = LABEL): IncomeRun {
  return {
    seed,
    policy,
    days: 1,
    hours: 24,
    startWorth: 3000,
    endWorth: 3000 + 24 * rate,
    ledger: { 'sell goods': 500, repair: -100 },
    daily: [24 * rate],
    attempts: [{ turn: 10, target: 'v1', kind: 'trader', guarded: false, answer: 'comply', outcome: 'pile', goodsValue: 400, repairSpent: 0 }],
    knockouts: 0,
    death: null,
    walletsByDay: { trader: [[1000, 400], [900]], convoy: [[1000], []] },
    samples: [],
    npcKnockoutsByDay: [],
    towsByDay: [],
    ...label,
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

describe('pairedDifference', () => {
  it('gives the mean difference by seed, its 80% t-interval and the ratio of the means', () => {
    // Differences 10, 20 and 30: mean 20, SE 10 / sqrt(3), t at 2 degrees of freedom 1.886.
    const robber = [fakeRun('robber', 1, 60), fakeRun('robber', 2, 70), fakeRun('robber', 3, 80)];
    const hauler = [fakeRun('trader', 1, 50), fakeRun('trader', 2, 50), fakeRun('trader', 3, 50)];

    const paired = pairedDifference(robber, hauler);

    const half = (1.886 * 10) / Math.sqrt(3);
    expect(paired.seeds).toEqual([1, 2, 3]);
    expect(paired.meanDiff).toBeCloseTo(20, 9);
    expect(paired.ci80[0]).toBeCloseTo(20 - half, 9);
    expect(paired.ci80[1]).toBeCloseTo(20 + half, 9);
    expect(paired.ratio).toBeCloseTo(70 / 50, 9);
  });

  it('fails loud on runs of mixed builds or unpaired seeds', () => {
    const other = { candidate: 'test', commit: 'def' };
    expect(() => pairedDifference([fakeRun('robber', 1), fakeRun('robber', 2, 20, other)], [fakeRun('trader', 1), fakeRun('trader', 2)])).toThrow(/mixes builds/);
    expect(() => pairedDifference([fakeRun('robber', 1), fakeRun('robber', 3)], [fakeRun('trader', 1), fakeRun('trader', 2)])).toThrow(/Unpaired/);
  });
});

describe('gateReport', () => {
  function g1(ratio: number): string {
    const robber = [1, 2, 3].map((s) => fakeRun('robber', s, ratio * (40 + s)));
    const hauler = [1, 2, 3].map((s) => fakeRun('trader', s, 40 + s));
    return gateReport([...robber, ...hauler], [], 0);
  }

  it('passes G1 on a ratio of 1.2 and misses it on 1.6', () => {
    expect(g1(1.2)).toContain('| G1 Robbery is modestly best | pass |');
    expect(g1(1.6)).toContain('| G1 Robbery is modestly best | miss |');
  });
});
