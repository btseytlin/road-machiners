import { describe, expect, it } from 'vitest';
import { PARTS } from '../../data/parts';
import { CONFIG } from '../../config';
import { blastRadiusOf, planVolley, PROJECTILES, projectileOf, type RoundAim } from './projectiles';

const A = { x: 0, y: 2, z: 0 };
const B = { x: 40, y: 2, z: 0 };
const round = (struck: boolean, offset: number): RoundAim => ({ b: B, struck, offset });
const WINDOW = 1000;
const BURST = 450;
const at = (startMs: number) => ({ startMs, windowMs: WINDOW, burstMaxMs: BURST });

describe('planVolley', () => {
  it('ends hits on the target and sends misses past it to the ground', () => {
    const [hit, miss] = planVolley(projectileOf('mg'), A, [round(true, 0.3), round(false, 3)], at(0), () => -1);
    expect(hit.struck).toBe(true);
    expect(hit.land.x).toBeCloseTo(40);
    expect(hit.land.z).toBeCloseTo(0.3);
    expect(miss.struck).toBe(false);
    expect(miss.land.x).toBeGreaterThan(40);
    expect(miss.land.y).toBe(-1);
  });

  it('lands every round within the shot window', () => {
    for (const key of ['mg', 'shotgun', 'cannon', 'rocketRack']) {
      const rounds = Array.from({ length: 6 }, (_, k) => round(k % 2 === 0, k - 3));
      for (const p of planVolley(projectileOf(key), A, rounds, at(0), () => 0)) {
        expect(p.flightMs).toBeGreaterThan(0);
        expect(p.delayMs + p.flightMs).toBeLessThanOrEqual(WINDOW);
      }
    }
  });

  it('starts at the volley start and fires a machine gun burst a gap apart', () => {
    const rounds = Array.from({ length: 6 }, () => round(true, 0));
    const plans = planVolley(projectileOf('mg'), A, rounds, at(120), () => 0);
    expect(plans[0].delayMs).toBe(120);
    for (let k = 1; k < plans.length; k++) expect(plans[k].delayMs - plans[k - 1].delayMs).toBe(projectileOf('mg').gapMs);
  });

  it('squeezes a 12-round gatling burst into the burst cap', () => {
    const plans = planVolley(projectileOf('gatling'), A, Array.from({ length: 12 }, () => round(true, 0)), at(0), () => 0);
    expect(plans[11].delayMs - plans[0].delayMs).toBeLessThanOrEqual(BURST);
  });

  it('lands 12 rounds of every weapon within the band from the latest start', () => {
    for (const key of Object.keys(PROJECTILES)) {
      for (const p of planVolley(projectileOf(key), A, Array.from({ length: 12 }, () => round(true, 0)), at(CONFIG.combatFireSpreadMs), () => 0)) {
        expect(p.delayMs + p.flightMs).toBeLessThanOrEqual(CONFIG.combatShotMs);
      }
    }
  });

  it('leaves room for the latest start and the longest burst in the band', () => {
    expect(CONFIG.combatFireSpreadMs + CONFIG.combatBurstMaxMs).toBeLessThan(CONFIG.combatShotMs);
  });

  it('throws when the start leaves no time to fire', () => {
    expect(() => planVolley(projectileOf('mg'), A, [round(true, 0)], at(WINDOW), () => 0)).toThrow(/leaves no time/);
  });

  it('flies a cannon shell slower than a machine gun round', () => {
    const [mg] = planVolley(projectileOf('mg'), A, [round(true, 0)], at(0), () => 0);
    const [shell] = planVolley(projectileOf('cannon'), A, [round(true, 0)], at(0), () => 0);
    expect(shell.flightMs).toBeGreaterThan(mg.flightMs);
  });

  it('has a projectile look for every weapon', () => {
    for (const def of Object.values(PARTS)) if (def.kind === 'weapon') expect(() => projectileOf(def.id)).not.toThrow();
  });

  it('fails loud for a weapon with no projectile look', () => {
    expect(() => projectileOf('laser')).toThrow(/No projectile look/);
  });

  it('explodes only rounds with splash, and guard bullets never', () => {
    expect(blastRadiusOf('grenadeLauncher')).toBeGreaterThan(0);
    expect(blastRadiusOf('cannon')).toBeGreaterThan(0);
    expect(blastRadiusOf('mg')).toBe(0);
    expect(blastRadiusOf('guard')).toBe(0);
    expect(blastRadiusOf('harpoon')).toBe(0);
    expect(() => blastRadiusOf('stockEngine')).toThrow();
  });
});
