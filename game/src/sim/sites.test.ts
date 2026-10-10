import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { clickOrder } from './steering';
import { canUseSite, edgeCrossings, isInTerritory, isNearOutpost, nearestPad, OUTPOSTS, siteEdgeCrossings, siteGap, siteGates, sitePads, siteUnder } from './sites';
import { dist } from './vec';

const SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
const PAD = REGION.sites.pad;

describe('outposts', () => {
  it('are the trading stalls, not towns', () => {
    expect(OUTPOSTS.map((o) => o.id).sort()).toEqual(['dustwell', 'granary', 'green-pit', 'pump-station', 'salvage-yard']);
  });
  it('are near within reach of a gate and not beyond it', () => {
    const gate = siteGates(OUTPOSTS[0])[0];
    expect(isNearOutpost({ x: gate.x + 3, y: gate.y }, 4)).toBe(true);
    expect(isNearOutpost({ x: gate.x + 3, y: gate.y }, 2)).toBe(false);
    expect(isNearOutpost(REGION.towns[0].pos, 4)).toBe(false);
  });
});

describe('site gates and pads', () => {
  it('gives every site a gate on its edge', () => {
    for (const site of SITES) {
      const gates = siteGates(site);
      expect(gates.length, site.id).toBeGreaterThan(0);
      for (const gate of gates) expect(dist(gate, site.pos), site.id).toBeCloseTo(site.radius, 6);
    }
  });

  it('gives towns and large locations a gate per road, and small locations one gate', () => {
    const large = SITES.filter((l) => 'kind' in l && l.radius >= REGION.sites.multiGateRadius);
    expect(large).toEqual([]);
    for (const site of SITES) {
      const roads = REGION.roads.filter((road) => road.some((p) => dist(p, site.pos) <= site.radius)).length;
      if (large.includes(site as never) || REGION.towns.includes(site as never)) expect(siteGates(site).length, site.id).toBe(roads);
      else expect(siteGates(site).length, site.id).toBe(1);
    }
  });

  it('lets no road pass through a location', () => {
    for (const site of SITES) {
      for (const road of REGION.roads) {
        const inside = road.map((p) => dist(p, site.pos) <= site.radius);
        if (!inside.some(Boolean)) continue;
        expect(inside[0] || inside[inside.length - 1], `${site.id} sits on a through road`).toBe(true);
      }
    }
  });

  it('puts each pad outside its site, touching the gate', () => {
    for (const site of SITES) {
      const gates = siteGates(site);
      sitePads(site).forEach((pad, i) => {
        expect(dist(pad, site.pos), site.id).toBeCloseTo(site.radius + PAD.length / 2, 6);
        expect(dist(pad, gates[i]), site.id).toBeCloseTo(PAD.length / 2, 6);
      });
    }
  });

  it('lets a truck use a site only on a pad', () => {
    for (const site of SITES) {
      const pad = sitePads(site)[0];
      const a = Math.atan2(pad.y - site.pos.y, pad.x - site.pos.x);
      const at = (along: number, across: number) => ({
        x: pad.x + Math.cos(a) * along - Math.sin(a) * across,
        y: pad.y + Math.sin(a) * along + Math.cos(a) * across,
      });
      expect(canUseSite(pad, site), site.id).toBe(true);
      expect(canUseSite(at(PAD.length / 2 - 0.01, PAD.width / 2 - 0.01), site), site.id).toBe(true);
      expect(canUseSite(at(PAD.length / 2 + 0.01, 0), site), site.id).toBe(false);
      expect(canUseSite(at(0, PAD.width / 2 + 0.01), site), site.id).toBe(false);
    }
  });

  it('refuses use from beside an open site, away from its gates', () => {
    const oasis = REGION.locations.find((l) => l.kind === 'oasis')!;
    const gateAngles = siteGates(oasis).map((g) => Math.atan2(g.y - oasis.pos.y, g.x - oasis.pos.x));
    let best = 0;
    let bestGap = -1;
    for (let a = -Math.PI; a < Math.PI; a += 0.01) {
      const gap = Math.min(...gateAngles.map((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g)))));
      if (gap > bestGap) [best, bestGap] = [a, gap];
    }
    const beside = { x: oasis.pos.x + Math.cos(best) * (oasis.radius + 1), y: oasis.pos.y + Math.sin(best) * (oasis.radius + 1) };
    expect(canUseSite(beside, oasis)).toBe(false);
  });

  it('finds the pad nearest a point', () => {
    const ship = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    for (const pad of sitePads(ship)) {
      const near = { x: pad.x + 1, y: pad.y };
      expect(nearestPad(ship, near)).toEqual(pad);
    }
  });
});

describe('clicks on a site', () => {
  it('finds the site under a point', () => {
    const bowl = REGION.towns[0];
    expect(siteUnder(bowl.pos)?.id).toBe(bowl.id);
    expect(siteUnder(sitePads(bowl)[0])).toBeNull();
  });

  it('turns a click inside a site into a stop at its pad nearest the truck', () => {
    const town = REGION.towns[0];
    const pad = sitePads(town)[1] ?? sitePads(town)[0];
    const from = { x: pad.x + 20 * (pad.x - town.pos.x) / dist(pad, town.pos), y: pad.y + 20 * (pad.y - town.pos.y) / dist(pad, town.pos) };
    expect(clickOrder(town.pos, false, { pos: from, order: null })).toEqual({ kind: 'stopAt', dest: pad });
  });

  it('keeps a click on open ground as a drive-through order', () => {
    const dest = { x: 5, y: 5 };
    expect(siteUnder(dest)).toBeNull();
    expect(clickOrder(dest, false, { pos: { x: 1, y: 1 }, order: null })).toEqual({ kind: 'through', dest });
  });
});

describe('territories', () => {
  const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
  const rim = { x: fallenSun.pos.x + fallenSun.radius, y: fallenSun.pos.y };

  it('have no gates, pads or edge, and no truck can use one', () => {
    expect(fallenSun.kind).toBe('territory');
    expect(siteGates(fallenSun)).toEqual([]);
    expect(sitePads(fallenSun)).toEqual([]);
    expect(canUseSite(rim, fallenSun)).toBe(false);
    expect(canUseSite(fallenSun.pos, fallenSun)).toBe(false);
  });

  it('hold a point inside their edge, not one outside it', () => {
    const orchard = REGION.locations.find((l) => l.id === 'orchard')!;
    expect(isInTerritory(fallenSun.pos)).toBe(true);
    expect(isInTerritory(orchard.pos)).toBe(true);
    expect(isInTerritory({ x: fallenSun.pos.x + fallenSun.radius + 1, y: fallenSun.pos.y })).toBe(false);
    expect(isInTerritory(REGION.towns[0].pos)).toBe(false);
  });
});

describe('site edges', () => {
  const pump = REGION.locations.find((l) => l.id === 'pump-station')!;
  const orchard = REGION.locations.find((l) => l.id === 'orchard')!;

  it('measures a circle site from its circle, negative inside', () => {
    expect(siteGap(pump, pump.pos)).toBeCloseTo(-pump.radius, 9);
    expect(siteGap(pump, { x: pump.pos.x + pump.radius + 2, y: pump.pos.y })).toBeCloseTo(2, 9);
    const [a, b] = [{ x: pump.pos.x - 100, y: pump.pos.y + 3 }, { x: pump.pos.x + 100, y: pump.pos.y + 3 }];
    expect(siteEdgeCrossings(pump, a, b)).toEqual(edgeCrossings(a, b, pump.pos, pump.radius));
  });

  it('measures an outlined site from its outline', () => {
    if (orchard.kind !== 'territory' || !orchard.outline) throw new Error('The orchard has no outline');
    const corner = { x: orchard.pos.x + orchard.outline[0].x, y: orchard.pos.y + orchard.outline[0].y };
    expect(siteGap(orchard, orchard.pos)).toBeLessThan(0);
    expect(Math.abs(siteGap(orchard, corner))).toBeLessThan(1e-9);
    const [a, b] = [{ x: orchard.pos.x - 80, y: orchard.pos.y }, { x: orchard.pos.x + 80, y: orchard.pos.y }];
    const crossings = siteEdgeCrossings(orchard, a, b);
    expect(crossings).toHaveLength(2);
    expect(crossings[0].x).toBeLessThan(crossings[1].x);
    for (const p of crossings) expect(Math.abs(siteGap(orchard, p))).toBeLessThan(1e-9);
  });

  it('measures a site with the same id but its own outline from that outline', () => {
    if (orchard.kind !== 'territory') throw new Error('The orchard is not a territory');
    siteGap(orchard, orchard.pos);
    const square = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const small = { ...orchard, radius: Math.hypot(5, 5), outline: square };
    expect(siteGap(small, orchard.pos)).toBeCloseTo(-5, 9);
    expect(siteGap(small, { x: orchard.pos.x + 8, y: orchard.pos.y })).toBeCloseTo(3, 9);
  });
});
