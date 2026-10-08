import { describe, expect, it } from 'vitest';
import { TIME } from '../data/time';
import { MAX_SKILL_LEVEL, type PerkId, XP_RULES, XP_SOURCES, XP_TO_REACH } from '../data/skills';
import { choosePerk, hasPerk, pendingPerkPairs, practice, skillEffect, skillLevel, vehicleHasPerk, xpFor, xpTodayOf } from './progress';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

describe('skill levels', () => {
  it('follow the XP table', () => {
    const w = emptyWorld();
    w.player.skills.social = XP_TO_REACH[2] - 1;
    expect(skillLevel(w, 'social')).toBe(1);
    w.player.skills.social = XP_TO_REACH[2];
    expect(skillLevel(w, 'social')).toBe(2);
  });

  it('stop at the top level', () => {
    const w = emptyWorld();
    w.player.skills.social = XP_TO_REACH[MAX_SKILL_LEVEL] * 10;
    expect(skillLevel(w, 'social')).toBe(MAX_SKILL_LEVEL);
  });
});

describe('xpFor', () => {
  const fresh = { skills: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 }, xpToday: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 }, xpDay: 1, repeats: {} };

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
    const units = 100 / XP_SOURCES.profit.weight;
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
    expect(w.player.skills.social).toBeLessThan((XP_SOURCES.profit.weight * 10) / (1 - XP_SOURCES.profit.repeat) + 1e-6);
  });

  it('a once-only target never pays again, even days later', () => {
    const w = emptyWorld();
    practice(w, 'call', 1, null, 'v2:directions');
    w.turn += 30 * TIME.turnsPerDay;
    practice(w, 'call', 1, null, 'v2:directions');
    expect(w.player.skills.social).toBeCloseTo(XP_SOURCES.call.weight);
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
  it('adds XP to the source skill and logs it', () => {
    const w = emptyWorld();
    practice(w, 'discover', 1, null, 'bowl');
    expect(w.player.skills.perception).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.player.xpBySource.discover).toBeCloseTo(XP_SOURCES.discover.weight);
    expect(w.events).toContainEqual({ t: 'practice', source: 'discover', amount: 1, difficulty: null, target: 'bowl', xp: XP_SOURCES.discover.weight });
  });

  it('announces each level reached', () => {
    const w = emptyWorld();
    w.player.skills.machining = XP_TO_REACH[1] - 1;
    practice(w, 'search', 1, null, 'stock');
    expect(w.events).toContainEqual({ t: 'skillUp', skill: 'machining', level: 1 });
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
  it('scales with level for the player truck', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[3];
    expect(skillEffect(w, w.vehicles[0], 'driving', 'turnRate')).toBeCloseTo(0.3);
  });

  it('is zero for other trucks', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[3];
    const npc = addVehicle(w, 'traders', 'hauler', [], { x: 40, y: 40 });
    expect(skillEffect(w, npc, 'driving', 'turnRate')).toBe(0);
  });
});

describe('skill effects on the truck', () => {
  it('driving raises the turn rate', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const before = vehicleStats(w, me).turnSlow;
    w.player.skills.driving = XP_TO_REACH[2];
    expect(vehicleStats(w, me).turnSlow).toBeGreaterThan(before);
  });
});

describe('choosing a perk', () => {
  it('adds a perk once the skill reaches its level', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[2];
    const next = choosePerk(w, 'rammer');
    expect(hasPerk(next, 'rammer')).toBe(true);
    expect(hasPerk(w, 'rammer')).toBe(false);
  });

  it('refuses a perk above the skill level', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[3];
    expect(() => choosePerk(w, 'steadyAim')).toThrow(/level 4/);
  });

  it('refuses a second perk from the same pair', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[2];
    const next = choosePerk(w, 'rammer');
    expect(() => choosePerk(next, 'coldRunning')).toThrow(/Rammer/);
    expect(() => choosePerk(next, 'rammer')).toThrow(/Rammer/);
  });

  it('refuses an unknown perk', () => {
    const w = emptyWorld();
    expect(() => choosePerk(w, 'flying' as PerkId)).toThrow(/Unknown perk flying/);
  });

  it('refuses a pick while the player is knocked out', () => {
    const w = emptyWorld();
    w.player.skills.driving = XP_TO_REACH[2];
    w.player.state = 'knockedOut';
    expect(() => choosePerk(w, 'rammer')).toThrow();
  });
});

describe('open perk pairs', () => {
  it('lists no pair below level 2', () => {
    expect(pendingPerkPairs(emptyWorld())).toEqual([]);
  });

  it('lists each reached pair until it has a pick', () => {
    const w = emptyWorld();
    w.player.skills.social = XP_TO_REACH[4];
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
