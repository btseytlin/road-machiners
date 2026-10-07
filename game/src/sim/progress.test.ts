import { describe, expect, it } from 'vitest';
import { TIME } from '../data/time';
import { MAX_RANK, type PerkId, RANK_COSTS, XP_RULES, XP_SOURCES } from '../data/skills';
import {
  affordableRanks, buyCheapestRanks, buyRank, canBuyRank, choosePerk, cumulativeCost, hasPerk, pendingPerkPairs, practice, rankCost, ranksCoveredBy, skillEffect,
  skillLevel, vehicleHasPerk, xpFor, xpTodayOf,
} from './progress';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

describe('rank costs', () => {
  it('price each rank from the table', () => {
    expect(rankCost(1)).toBe(RANK_COSTS[0]);
    expect(rankCost(MAX_RANK)).toBe(RANK_COSTS[MAX_RANK - 1]);
    expect(() => rankCost(0)).toThrow();
    expect(() => rankCost(MAX_RANK + 1)).toThrow();
  });

  it('add up to the cumulative cost of a rank', () => {
    expect(cumulativeCost(0)).toBe(0);
    expect(cumulativeCost(2)).toBe(RANK_COSTS[0] + RANK_COSTS[1]);
  });

  it('cover the ranks an XP total pays for, up to the top rank', () => {
    expect(ranksCoveredBy(cumulativeCost(2) - 1)).toBe(1);
    expect(ranksCoveredBy(cumulativeCost(2))).toBe(2);
    expect(ranksCoveredBy(cumulativeCost(MAX_RANK) * 10)).toBe(MAX_RANK);
  });
});

describe('skill levels', () => {
  it('are the bought ranks', () => {
    const w = emptyWorld();
    w.player.ranks.social = 2;
    expect(skillLevel(w, 'social')).toBe(2);
  });
});

describe('buying a rank', () => {
  it('spends the next rank cost from the pool and announces the rank', () => {
    const w = emptyWorld();
    w.player.xp = RANK_COSTS[0] + 5;
    const next = buyRank(w, 'driving');
    expect(next.player.ranks.driving).toBe(1);
    expect(next.player.xp).toBe(5);
    expect(next.events).toContainEqual({ t: 'skillUp', skill: 'driving', level: 1 });
    expect(w.player.ranks.driving).toBe(0);
  });

  it('buys ranks in order, each at its own cost', () => {
    const w = emptyWorld();
    w.player.xp = cumulativeCost(2);
    const next = buyRank(buyRank(w, 'machining'), 'machining');
    expect(next.player.ranks.machining).toBe(2);
    expect(next.player.xp).toBe(0);
  });

  it('refuses a rank the pool cannot pay, and leaves the world as it was', () => {
    const w = emptyWorld();
    w.player.xp = RANK_COSTS[0] - 1;
    expect(canBuyRank(w, 'driving')).toEqual({ id: 'needsXp', cost: RANK_COSTS[0], have: RANK_COSTS[0] - 1 });
    expect(() => buyRank(w, 'driving')).toThrow();
    expect(w.player.xp).toBe(RANK_COSTS[0] - 1);
    expect(w.player.ranks.driving).toBe(0);
  });

  it('refuses a rank past the top', () => {
    const w = emptyWorld();
    w.player.ranks.social = MAX_RANK;
    w.player.xp = 1e6;
    expect(canBuyRank(w, 'social')).not.toBeNull();
    expect(() => buyRank(w, 'social')).toThrow();
  });

  it('refuses a rank while the player is knocked out', () => {
    const w = emptyWorld();
    w.player.xp = 1e6;
    w.player.state = 'knockedOut';
    expect(canBuyRank(w, 'social')).not.toBeNull();
    expect(() => buyRank(w, 'social')).toThrow();
  });

  it('lists the skills whose next rank the pool pays for', () => {
    const w = emptyWorld();
    w.player.xp = RANK_COSTS[1];
    w.player.ranks.driving = 1;
    w.player.ranks.social = 2;
    expect(affordableRanks(w)).toEqual(['driving', 'perception', 'machining', 'toughness']);
    w.player.xp = RANK_COSTS[0] - 1;
    expect(affordableRanks(w)).toEqual([]);
  });

  it('spends the pool on the cheapest ranks first, ties in skill order, until none is affordable', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 1;
    w.player.xp = 4 * RANK_COSTS[0] + 3;

    const next = buyCheapestRanks(w);

    expect(next.player.ranks).toEqual({ ...w.player.ranks, perception: 1, social: 1, machining: 1, toughness: 1 });
    expect(next.player.xp).toBe(3);
    expect(buyCheapestRanks(next)).toBe(next);
  });
});

describe('xpFor', () => {
  const fresh = { xp: 0, xpToday: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 }, xpDay: 1, repeats: {} };

  it('pays an unscaled source its weight per unit', () => {
    expect(xpFor(fresh, 'profit', 100, null, 'bowl:salt', 1)).toBeCloseTo(XP_SOURCES.profit.weight * 100);
  });

  it('rejects a difficulty on an unscaled source', () => {
    expect(() => xpFor(fresh, 'profit', 100, 0.5, 'bowl:salt', 1)).toThrow();
  });

  it('pays past the daily cap at the over-cap rate', () => {
    const capped = { ...fresh, xpToday: { ...fresh.xpToday, social: XP_RULES.dailyCap } };
    expect(xpFor(capped, 'profit', 100, null, 'bowl:salt', 1)).toBeCloseTo(XP_SOURCES.profit.weight * 100 * XP_RULES.overCap);
  });

  it('splits a gain that crosses the daily cap', () => {
    const near = { ...fresh, xpToday: { ...fresh.xpToday, social: XP_RULES.dailyCap - 10 } };
    const units = 100 / XP_SOURCES.profit.weight; // 100 XP at the full rate
    expect(xpFor(near, 'profit', units, null, 'bowl:salt', 1)).toBeCloseTo(10 + 90 * XP_RULES.overCap);
  });

  it('forgets the cap on a new day', () => {
    const capped = { ...fresh, xpToday: { ...fresh.xpToday, social: XP_RULES.dailyCap } };
    expect(xpFor(capped, 'profit', 100, null, 'bowl:salt', 1 + TIME.turnsPerDay)).toBeCloseTo(XP_SOURCES.profit.weight * 100);
  });

  it('rejects negative amounts', () => {
    expect(() => xpFor(fresh, 'profit', -1, null, 'bowl:salt', 1)).toThrow();
  });
});

describe('repeats on one target', () => {
  it('each earlier event on a target multiplies the pay by its repeat factor', () => {
    const w = emptyWorld();
    for (let i = 0; i < 3; i++) practice(w, 'profit', 10, null, 'bowl:salt');
    const pay = w.events.flatMap((e) => (e.t === 'practice' ? [e.xp] : []));
    const r = XP_SOURCES.profit.repeat;
    expect(pay[1] / pay[0]).toBeCloseTo(r);
    expect(pay[2] / pay[0]).toBeCloseTo(r * r);
  });

  it('every source decays on a repeated target, so no source pays forever', () => {
    for (const [source, def] of Object.entries(XP_SOURCES)) {
      expect(def.repeat, source).toBeGreaterThanOrEqual(0);
      expect(def.repeat, source).toBeLessThan(1);
    }
  });

  it('another target pays in full', () => {
    const w = emptyWorld();
    practice(w, 'profit', 10, null, 'bowl:salt');
    practice(w, 'profit', 10, null, 'nose:salt');
    const pay = w.events.flatMap((e) => (e.t === 'practice' ? [e.xp] : []));
    expect(pay[1]).toBeCloseTo(pay[0]);
  });

  it('the count halves every half-life, so a target pays again with game time', () => {
    const w = emptyWorld();
    practice(w, 'profit', 10, null, 'bowl:salt');
    w.turn += XP_RULES.repeatHalfLife;
    practice(w, 'profit', 10, null, 'bowl:salt');
    const pay = w.events.flatMap((e) => (e.t === 'practice' ? [e.xp] : []));
    expect(pay[1] / pay[0]).toBeCloseTo(XP_SOURCES.profit.repeat ** 0.5);
  });

  it('spamming a decaying target pays a bounded total', () => {
    const w = emptyWorld();
    for (let i = 0; i < 500; i++) practice(w, 'profit', 10, null, 'bowl:salt');
    expect(w.player.xp).toBeLessThan((XP_SOURCES.profit.weight * 10) / (1 - XP_SOURCES.profit.repeat) + 1e-6);
  });

  it('a once-only target never pays again, even days later', () => {
    const w = emptyWorld();
    practice(w, 'call', 1, null, 'v2:directions');
    w.turn += 30 * TIME.turnsPerDay;
    practice(w, 'call', 1, null, 'v2:directions');
    expect(w.player.xp).toBeCloseTo(XP_SOURCES.call.weight);
  });

  it('a new day forgets faded decaying targets but keeps once-only ones', () => {
    const w = emptyWorld();
    practice(w, 'profit', 10, null, 'bowl:salt');
    practice(w, 'call', 1, null, 'v2:directions');
    w.turn += 30 * TIME.turnsPerDay;
    practice(w, 'heat', 1, 0.5, '1,1');
    expect(Object.keys(w.player.repeats).sort()).toEqual(['call:v2:directions', 'heat:1,1']);
  });

  it('rejects a practice with no target', () => {
    expect(() => practice(emptyWorld(), 'profit', 10, null, '')).toThrow(/target/);
  });
});

describe('practice', () => {
  it('adds XP to the pool and the family day and logs it', () => {
    const w = emptyWorld();
    practice(w, 'discover', 1, null, 'bowl');
    expect(w.player.xp).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.player.xpToday.perception).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.player.xpBySource.discover).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.events).toContainEqual({ t: 'practice', source: 'discover', amount: 1, difficulty: null, target: 'bowl', xp: XP_SOURCES.discover.weight });
  });

  it('never raises a rank', () => {
    const w = emptyWorld();
    w.player.xp = RANK_COSTS[0] - 1;
    practice(w, 'search', 1, null, 'stock');
    expect(w.player.ranks.machining).toBe(0);
    expect(w.events.some((e) => e.t === 'skillUp')).toBe(false);
  });

  it('keeps the daily cap per activity family', () => {
    const w = emptyWorld();
    w.player.xpToday.social = XP_RULES.dailyCap;
    practice(w, 'discover', 1, null, 'bowl');
    expect(w.player.xp).toBeCloseTo(XP_SOURCES.discover.weight);
    practice(w, 'call', 1, null, 'v2:directions');
    expect(w.player.xp).toBeCloseTo(XP_SOURCES.discover.weight + XP_SOURCES.call.weight * XP_RULES.overCap);
  });

  it('resets the daily count on a new day', () => {
    const w = emptyWorld();
    w.player.xpToday.social = XP_RULES.dailyCap;
    w.turn += TIME.turnsPerDay;
    practice(w, 'profit', 10, null, 'bowl:salt');
    expect(w.player.xpToday.social).toBeCloseTo(XP_SOURCES.profit.weight * 10);
  });
});

describe('skillEffect', () => {
  it('scales with rank for the player truck', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 3;
    expect(skillEffect(w, w.vehicles[0], 'driving', 'turnRate')).toBeCloseTo(0.3);
  });

  it('is zero for other trucks', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 3;
    const npc = addVehicle(w, 'traders', 'hauler', [], { x: 40, y: 40 });
    expect(skillEffect(w, npc, 'driving', 'turnRate')).toBe(0);
  });
});

describe('skill effects on the truck', () => {
  it('driving raises the turn rate', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const before = vehicleStats(w, me).turnSlow;
    w.player.ranks.driving = 2;
    expect(vehicleStats(w, me).turnSlow).toBeGreaterThan(before);
  });
});

describe('choosing a perk', () => {
  it('adds a perk once the skill reaches its rank', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 2;
    const next = choosePerk(w, 'rammer');
    expect(hasPerk(next, 'rammer')).toBe(true);
    expect(hasPerk(w, 'rammer')).toBe(false);
  });

  it('refuses a perk above the skill rank', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 3;
    expect(() => choosePerk(w, 'steadyAim')).toThrow(/rank 4/);
  });

  it('refuses a second perk from the same pair', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 2;
    const next = choosePerk(w, 'rammer');
    expect(() => choosePerk(next, 'coldRunning')).toThrow(/rammer/);
    expect(() => choosePerk(next, 'rammer')).toThrow(/rammer/);
  });

  it('refuses an unknown perk', () => {
    const w = emptyWorld();
    expect(() => choosePerk(w, 'flying' as PerkId)).toThrow(/Unknown perk flying/);
  });

  it('refuses a pick while the player is knocked out', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 2;
    w.player.state = 'knockedOut';
    expect(() => choosePerk(w, 'rammer')).toThrow();
  });
});

describe('open perk pairs', () => {
  it('lists no pair below rank 2', () => {
    expect(pendingPerkPairs(emptyWorld())).toEqual([]);
  });

  it('lists each reached pair until it has a pick', () => {
    const w = emptyWorld();
    w.player.ranks.social = 4;
    expect(pendingPerkPairs(w)).toEqual([
      { skill: 'social', level: 2, perks: ['marketEars', 'rumorMill'] },
      { skill: 'social', level: 4, perks: ['paidTruce', 'bountyTalk'] },
    ]);
    const next = choosePerk(w, 'paidTruce');
    expect(pendingPerkPairs(next)).toEqual([{ skill: 'social', level: 2, perks: ['marketEars', 'rumorMill'] }]);
  });
});

describe('perks on vehicles', () => {
  it('apply to the player truck only', () => {
    const w = emptyWorld();
    w.player.perks.push('rammer');
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    expect(vehicleHasPerk(w, w.vehicles[0], 'rammer')).toBe(true);
    expect(vehicleHasPerk(w, npc, 'rammer')).toBe(false);
  });
});

describe('xpTodayOf', () => {
  it('counts only XP earned on the current day', () => {
    const w = emptyWorld();
    practice(w, 'discover', 1, null, 'bowl');
    expect(xpTodayOf(w, 'perception')).toBeCloseTo(XP_SOURCES.discover.weight);
    w.turn += TIME.turnsPerDay;
    expect(xpTodayOf(w, 'perception')).toBe(0);
  });
});
