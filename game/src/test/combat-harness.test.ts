import { beforeAll, describe, expect, it } from 'vitest';
import { PARTS } from '../data/parts';
import { RULES } from '../data/rules';
import { mountedParts } from '../sim/grid';
import { initPhysics } from '../phys/drive';
import { runFight, setNumber, type Fight } from './combat-harness';

beforeAll(async () => {
  await initPhysics();
});

const FIGHT: Fight = { kit: 'standard', me: null, enemies: ['buggy'], level: null, foe: null, policy: 'stand', seed: 3, gap: 8, orbit: 6, maxTurns: 4 };

describe('combat harness', () => {
  it('gives the same report for the same fight', () => {
    expect(runFight(FIGHT)).toEqual(runFight(FIGHT));
  });

  it('gives the same report for a seed after other seeds ran', () => {
    const first = runFight(FIGHT);
    runFight({ ...FIGHT, seed: 4 });
    expect(runFight(FIGHT)).toEqual(first);
  });

  it('refuses a seed that is not a whole number', () => {
    expect(() => runFight({ ...FIGHT, seed: 1.5 })).toThrow('Seed must be an integer');
  });

  it('counts the rounds both sides fire', () => {
    const r = runFight(FIGHT);
    expect(r.me.rounds).toBeGreaterThan(0);
    expect(r.them.rounds).toBeGreaterThan(0);
    expect(r.me.hits).toBeLessThanOrEqual(r.me.rounds);
  });

  it('a standing player never moves', () => {
    expect(runFight(FIGHT).me.speed).toBe(0);
  });

  it('sets an existing balance number', () => {
    const old = RULES.leadError;
    setNumber(`RULES.leadError=${old + 1}`);
    expect(RULES.leadError).toBe(old + 1);
    setNumber(`RULES.leadError=${old}`);
  });

  it('builds the next fight from a changed balance number', () => {
    const gunHp = () => {
      let hp = 0;
      runFight({ ...FIGHT, maxTurns: 1 }, (w) => { hp = mountedParts(w.vehicles[0], 'weapon')[0].hp; });
      return hp;
    };
    const old = (PARTS.mg as { hp: number }).hp;
    expect(gunHp()).toBeLessThanOrEqual(old);
    setNumber(`PARTS.mg.hp=${old * 100}`);
    try {
      expect(gunHp()).toBeGreaterThan(old);
    } finally {
      setNumber(`PARTS.mg.hp=${old}`);
    }
  });

  it('refuses a path that names no number', () => {
    expect(() => setNumber('RULES.noSuchRule=1')).toThrow('not a number');
    expect(() => setNumber('NOPE.x=1')).toThrow('Unknown table');
    expect(() => setNumber('RULES.leadError=abc')).toThrow('path=number');
  });
});

describe('foe hp left', () => {
  it('reports a share between 0 and 1 for a won fight', () => {
    // A standing fight the player wins; a charge into a buggy now mostly meets its caltrops or oil.
    const r = runFight({ ...FIGHT, level: 'poor', policy: 'stand', seed: 8, maxTurns: 60 });
    expect(r.outcome).toBe('won');
    expect(r.theirHpLeft).toBeGreaterThan(0);
    expect(r.theirHpLeft).toBeLessThan(1);
  }, 90_000); // takes 10-25s alone and over 30s when the whole suite shares the cores

  it('is null for a fight that is not won', () => {
    expect(runFight({ ...FIGHT, maxTurns: 1 }).theirHpLeft).toBeNull();
  });
});
