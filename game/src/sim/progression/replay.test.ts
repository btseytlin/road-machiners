import { describe, expect, it, onTestFinished } from 'vitest';
import { SKILL_IDS, TARGET_DAYS, TARGET_TOLERANCE, XP_RULES, XP_SOURCES } from '../../data/skills';
import { TIME } from '../../data/time';
import { cumulativeCost } from '../progress';
import { clockOf } from '../sun';
import type { SkillId } from '../types';
import type { TraceLine } from './record';
import { parseRunEnd, replay, targetMisses, type Curve, type SkillCurve } from './replay';

// Sets search XP to one per amount and the daily cap to 100, with half pay past it, until the test ends.
function simpleSearchXp(): void {
  const rules = { ...XP_RULES };
  const search = { ...XP_SOURCES.search };
  Object.assign(XP_RULES, { dailyCap: 100, overCap: 0.5 });
  Object.assign(XP_SOURCES.search, { weight: 1 });
  onTestFinished(() => {
    Object.assign(XP_RULES, rules);
    Object.assign(XP_SOURCES.search, search);
  });
}

const search = (turn: number, amount: number): TraceLine => ({ turn, source: 'search', amount, difficulty: null, target: `stock-${turn}` });

describe('replay', () => {
  it('reaches each level on the turn its running XP crosses the level cost, with the daily cap per day', () => {
    simpleSearchXp();
    const dayTwo = TIME.turnsPerDay * 0.75;
    expect(clockOf(40).day).toBe(1);
    expect(clockOf(dayTwo).day).toBe(2);
    const trace = [
      search(10, 100), // 100: the cap is used up
      search(40, 400), // half pay past the cap: 300
      search(dayTwo, 50), // a new day pays in full: 350
      search(dayTwo + 10, 150), // 50 in full and 100 at half pay: 450
    ];
    const totals = [100, 300, 350, 450];
    const turns = [10, 40, dayTwo, dayTwo + 10];
    const firstTurn = (level: number) => turns[totals.findIndex((xp) => xp >= cumulativeCost(level))] ?? null;

    const curve = replay(trace, 2 * TIME.turnsPerDay);

    expect(curve.machining.total).toBe(450);
    expect(curve.machining.levels).toEqual([1, 2, 3, 4, 5].map(firstTurn));
    expect(curve.machining.perDay).toBe(225);
    expect(curve.driving).toEqual({ levels: [null, null, null, null, null], total: 0, perDay: 0 });
  });

  it('scales a scaled source by its difficulty', () => {
    const curve = replay([{ turn: 5, source: 'hit', amount: 1, difficulty: 1, target: 'v2' }], 200);

    expect(curve.perception.total).toBe(Math.min(XP_SOURCES.hit.weight * XP_RULES.hard, XP_RULES.dailyCap));
  });

  it('pays less for repeats on one target, and a once-only target pays once', () => {
    const hits = replay([1, 2].map((turn) => ({ turn, source: 'hit' as const, amount: 1, difficulty: 1, target: 'v2' })), 200);
    expect(hits.perception.total).toBeCloseTo(XP_SOURCES.hit.weight * XP_RULES.hard * (1 + XP_SOURCES.hit.repeat ** 1));
    const found = replay([1, 2].map((turn) => ({ turn, source: 'discover' as const, amount: 1, difficulty: null, target: 'bowl' })), 200);
    expect(found.perception.total).toBe(XP_SOURCES.discover.weight);
  });

  it('rejects a trace out of turn order', () => {
    expect(() => replay([search(20, 1), search(10, 1)], 200)).toThrow(/turn order/);
  });

  it('rejects a trace line past the recorded turns', () => {
    expect(() => replay([search(202, 1)], 200)).toThrow(/past the end/);
  });

  it('counts XP per day up to the death turn it is given', () => {
    const curve = replay([search(10, 1)], TIME.turnsPerDay / 2);

    expect(curve.machining.perDay).toBe(curve.machining.total * 2);
  });
});

describe('parseRunEnd', () => {
  it('reads a death marker and passes over trace lines', () => {
    expect(parseRunEnd({ end: 'death', turn: 57 })).toEqual({ end: 'death', turn: 57 });
    expect(parseRunEnd(search(10, 1))).toBeNull();
  });

  it('reads an error marker with its message', () => {
    expect(parseRunEnd({ end: 'error', turn: 57, message: 'No free engine mount' })).toEqual({ end: 'error', turn: 57, message: 'No free engine mount' });
    expect(() => parseRunEnd({ end: 'error', turn: 57 })).toThrow(/Bad run end/);
  });

  it('rejects a malformed marker', () => {
    expect(() => parseRunEnd({ end: 'stall', turn: 57 })).toThrow(/Bad run end/);
  });
});

describe('targetMisses', () => {
  const never = (): SkillCurve => ({ levels: [null, null, null, null, null], total: 0, perDay: 0 });
  const curveWith = (skill: SkillId, levels: (number | null)[]): Curve => {
    const curve = Object.fromEntries(SKILL_IDS.map((id) => [id, never()])) as Curve;
    curve[skill] = { levels, total: 0, perDay: 0 };
    return curve;
  };
  const day = (d: number) => d * TIME.turnsPerDay;
  const offOnly = (misses: string[]) => misses.filter((m) => !m.startsWith('social'));
  const pastWindow = (target: number) => day(Math.ceil(target * (1 + TARGET_TOLERANCE)) + 1);

  it('passes a main skill that reaches each level on its target day', () => {
    const levels = [day(1), day(TARGET_DAYS.main[2]), day(5), day(TARGET_DAYS.main[4]), null];
    const misses = targetMisses(curveWith('social', levels), 'trader', day(10));
    expect(misses.filter((m) => m.startsWith('social'))).toEqual([]);
  });

  it('flags a level reached too early or too late', () => {
    const early = targetMisses(curveWith('social', [1, 2, 3, day(TARGET_DAYS.main[4]), null]), 'trader', day(10));
    expect(early).toContain(`social rank 2: day 0.0, target day ${TARGET_DAYS.main[2]}, too early`);
    const late = targetMisses(curveWith('social', [day(1), day(TARGET_DAYS.main[2]), day(5), null, null]), 'trader', pastWindow(TARGET_DAYS.main[4]));
    expect(late).toContain(`social rank 4: never, target day ${TARGET_DAYS.main[4]}, too late`);
  });

  it('does not flag an unreached level whose window starts after the run', () => {
    const misses = targetMisses(curveWith('social', [day(1), day(TARGET_DAYS.main[2]), day(5), day(TARGET_DAYS.main[4]), null]), 'trader', pastWindow(TARGET_DAYS.off[2]));
    expect(misses.some((m) => m.startsWith('social rank 5'))).toBe(false);
    expect(offOnly(misses).length).toBeGreaterThan(0); // off skills that never level still miss
  });
});
