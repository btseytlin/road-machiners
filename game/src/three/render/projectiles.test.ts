import { describe, expect, it } from 'vitest';
import { PARTS } from '../../data/parts';
import { CONFIG } from '../../config';
import { blastRadiusOf, planVolley, PROJECTILES, projectileOf, roundAims, roundSpec, type RoundAim } from './projectiles';

const A = { x: 0, y: 2, z: 0 };
const B = { x: 40, y: 2, z: 0 };
const LAND = { x: 40, y: 0, z: 5 };
const round = (struck: boolean, offset: number): RoundAim => (struck ? { impact: 'truck', b: B, offset } : { impact: 'ground', land: { ...LAND, z: offset } });
const WINDOW = 1000;
const BURST = 450;
const at = (startMs: number) => ({ startMs, windowMs: WINDOW, burstMaxMs: BURST });

describe('planVolley', () => {
  it('ends hits on the target and lands misses at the sim point', () => {
    const [hit, miss] = planVolley(projectileOf('mg'), A, [round(true, 0.3), round(false, 3)], at(0), () => -1, 0);
    expect(hit.impact).toBe('truck');
    expect(hit.land.x).toBeCloseTo(40);
    expect(hit.land.z).toBeCloseTo(0.3);
    expect(miss.impact).toBe('ground');
    expect(miss.land.x).toBeGreaterThan(38.9);
    expect(miss.land.x).toBeLessThan(41.1);
    expect(miss.land.y).toBe(-1);
  });

  it('lands a splash miss exactly on the sim point at ground height', () => {
    const [miss] = planVolley(projectileOf('rocketRack'), A, [round(false, 4)], at(0), () => -1, 3);
    expect(miss.land.y).toBe(0);
    expect(miss.land.x).toBe(40);
    expect(miss.land.z).toBe(4);
  });

  it('keeps a plain miss across the line exact and within the depth along it', () => {
    const rounds = Array.from({ length: 200 }, () => round(false, 4));
    for (const p of planVolley(projectileOf('mg'), A, rounds, { startMs: 0, windowMs: 1e9, burstMaxMs: 1e9 }, () => -1, 0)) {
      expect(Math.abs(p.land.x - 40)).toBeLessThanOrEqual(1.01);
      expect(p.land.z).toBeCloseTo(4, 0);
      expect(p.land.y).toBe(-1);
    }
  });

  it('lands an unseen round on its point', () => {
    const [p] = planVolley(projectileOf('mg'), A, [{ impact: 'none', land: LAND }], at(0), () => 0, 0);
    expect(p.impact).toBe('none');
    expect(p.land).toEqual(LAND);
  });

  it('lands every round within the shot window', () => {
    for (const key of ['mg', 'shotgun', 'cannon', 'rocketRack']) {
      const rounds = Array.from({ length: 6 }, (_, k) => round(k % 2 === 0, k - 3));
      for (const p of planVolley(projectileOf(key), A, rounds, at(0), () => 0, 0)) {
        expect(p.flightMs).toBeGreaterThan(0);
        expect(p.delayMs + p.flightMs).toBeLessThanOrEqual(WINDOW);
      }
    }
  });

  it('starts at the volley start and fires a machine gun burst a gap apart', () => {
    const rounds = Array.from({ length: 6 }, () => round(true, 0));
    const plans = planVolley(projectileOf('mg'), A, rounds, at(120), () => 0, 0);
    expect(plans[0].delayMs).toBe(120);
    for (let k = 1; k < plans.length; k++) expect(plans[k].delayMs - plans[k - 1].delayMs).toBe(projectileOf('mg').gapMs);
  });

  it('squeezes a 12-round gatling burst into the burst cap', () => {
    const plans = planVolley(projectileOf('gatling'), A, Array.from({ length: 12 }, () => round(true, 0)), at(0), () => 0, 0);
    expect(plans[11].delayMs - plans[0].delayMs).toBeLessThanOrEqual(BURST);
  });

  it('lands 12 rounds of every weapon within the band from the latest start', () => {
    for (const key of Object.keys(PROJECTILES)) {
      for (const p of planVolley(projectileOf(key), A, Array.from({ length: 12 }, () => round(true, 0)), at(CONFIG.combatFireSpreadMs), () => 0, 0)) {
        expect(p.delayMs + p.flightMs).toBeLessThanOrEqual(CONFIG.combatShotMs);
      }
    }
  });

  it('leaves room for the latest start and the longest burst in the band', () => {
    expect(CONFIG.combatFireSpreadMs + CONFIG.combatBurstMaxMs).toBeLessThan(CONFIG.combatShotMs);
  });

  it('throws when the start leaves no time to fire', () => {
    expect(() => planVolley(projectileOf('mg'), A, [round(true, 0)], at(WINDOW), () => 0, 0)).toThrow(/leaves no time/);
  });

  it('flies a cannon shell slower than a machine gun round', () => {
    const [mg] = planVolley(projectileOf('mg'), A, [round(true, 0)], at(0), () => 0, 0);
    const [shell] = planVolley(projectileOf('cannon'), A, [round(true, 0)], at(0), () => 0, 0);
    expect(shell.flightMs).toBeGreaterThan(mg.flightMs);
  });

  it('has a projectile look for every weapon', () => {
    for (const def of Object.values(PARTS)) if (def.kind === 'weapon') expect(() => projectileOf(def.id)).not.toThrow();
  });

  it('fails loud for a weapon with no projectile look', () => {
    expect(() => projectileOf('laser')).toThrow(/No projectile look/);
  });

  it('explodes only rounds with splash', () => {
    expect(blastRadiusOf('grenadeLauncher')).toBeGreaterThan(0);
    expect(blastRadiusOf('cannon')).toBeGreaterThan(0);
    expect(blastRadiusOf('mg')).toBe(0);
    expect(blastRadiusOf('harpoon')).toBe(0);
    expect(() => blastRadiusOf('stockEngine')).toThrow();
  });
});

describe('roundAims', () => {
  const missAt = (offset: number) => ({ x: 40, y: 0, z: offset });
  const r = (struck: string | null, offset = 2) => ({ struck, offset, hits: [], blast: [], crit: false }) as never;
  const other = { x: 10, y: 1, z: 10 };

  it('says what each round hit', () => {
    const aims = roundAims(B, 't', [r('t'), r(null), r('o'), r('hidden')], (id) => (id === 'o' ? other : null), missAt);
    expect(aims[0]).toEqual({ impact: 'truck', b: B, offset: 2 });
    expect(aims[1]).toEqual({ impact: 'ground', land: missAt(2) });
    expect(aims[2]).toEqual({ impact: 'truck', b: other, offset: 0 });
    expect(aims[3]).toEqual({ impact: 'none', land: missAt(2) });
  });
});

describe('roundSpec', () => {
  it('throws one casing per shotgun shell and one per round of other guns', () => {
    const casings = (id: string) => [0, 1, 2].map((k) => roundSpec(PROJECTILES[id], k).casing);
    expect(casings('shotgun')).toEqual(['small', null, null]);
    expect(casings('mg')).toEqual(['small', 'small', 'small']);
  });
});
