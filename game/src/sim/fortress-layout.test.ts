import { describe, expect, it } from 'vitest';
import { FORTRESS, FORTRESS_SITES } from '../data/fortress';
import { REGION } from '../data/region';
import { siteGates, type Site } from './sites';
import { DEG, dist, type Vec } from './vec';
import { fortressFootprint, fortressOutline, fortressPieces, type FortressPiece } from './fortress';

const SITES: Site[] = [...REGION.towns, ...REGION.locations];
const FORTS = SITES.filter((s) => s.id in FORTRESS_SITES);
const EPS = 1e-6;

// Whether p lies on or inside the convex footprint of a piece.
function covers(piece: FortressPiece, p: Vec): boolean {
  const c = fortressFootprint(piece);
  return c.every((a, i) => {
    const b = c[(i + 1) % c.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPS;
  });
}

function outward(site: Site, p: Vec): Vec {
  const d = dist(site.pos, p);
  return { x: (p.x - site.pos.x) / d, y: (p.y - site.pos.y) / d };
}

describe('fortress data', () => {
  it('names the ten inhabited sites', () => {
    expect(Object.keys(FORTRESS_SITES).sort()).toEqual(['bowl', 'dustwell', 'granary', 'green-pit', 'kiln', 'nose', 'pump-station', 'salvage-yard', 'scrapjaw', 'south-lock']);
    expect(FORTS).toHaveLength(10);
  });
});

describe('fortress layout', () => {
  it.each(FORTS.map((s) => [s.id, s] as const))('%s lays out without a gate on a corner', (_, site) => {
    expect(() => fortressPieces(site)).not.toThrow();
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s keeps every piece but the gatehouses inside its circle', (_, site) => {
    const pieces = fortressPieces(site).filter((p) => p.kind !== 'gate');
    expect(pieces.length).toBeGreaterThan(0);

    const reach = Math.max(...pieces.flatMap((p) => fortressFootprint(p).map((c) => dist(site.pos, c))));
    expect(reach).toBeLessThanOrEqual(site.radius);
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s puts one gatehouse at each gate, its outer face on the circle', (_, site) => {
    const gates = fortressPieces(site).filter((p) => p.kind === 'gate');

    expect(gates).toHaveLength(siteGates(site).length);
    for (const g of siteGates(site)) {
      const out = outward(site, g);
      const house = gates.find((p) => dist(g, { x: p.pos.x + (out.x * FORTRESS.gate.depth) / 2, y: p.pos.y + (out.y * FORTRESS.gate.depth) / 2 }) < EPS);
      expect(house).toBeDefined();
      // The model's +y side, the outer face, looks out of the site.
      expect(Math.sin(house!.yaw) * out.x - Math.cos(house!.yaw) * out.y).toBeCloseTo(1, 9);
      // The whole outer face lies on the tangent at the gate, the inner edge of the pad.
      for (const c of fortressFootprint(house!)) expect((c.x - g.x) * out.x + (c.y - g.y) * out.y).toBeLessThanOrEqual(EPS);
    }
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s closes its outline with pieces', (_, site) => {
    const outline = fortressOutline(site);
    const pieces = fortressPieces(site);
    expect(outline.length).toBeGreaterThanOrEqual(4);

    const open: Vec[] = [];
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const steps = Math.ceil(dist(a, b) / 0.1);
      for (let k = 0; k < steps; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
        if (!pieces.some((piece) => covers(piece, p))) open.push(p);
      }
    });
    expect(open).toEqual([]);
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s leaves no way from its center out to the circle', (_, site) => {
    const pieces = fortressPieces(site);
    const step = 0.2;
    const n = Math.ceil((site.radius * 2) / step);
    const at = (i: number, j: number): Vec => ({ x: site.pos.x - site.radius + i * step, y: site.pos.y - site.radius + j * step });

    const seen = new Uint8Array(n * n);
    const todo = [Math.floor(n / 2) * n + Math.floor(n / 2)];
    seen[todo[0]] = 1;
    let escaped = false;
    while (todo.length > 0 && !escaped) {
      const cell = todo.pop()!;
      const i = cell % n;
      const j = Math.floor(cell / n);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        const next = nj * n + ni;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n || seen[next]) continue;
        seen[next] = 1;
        const p = at(ni, nj);
        if (pieces.some((piece) => covers(piece, p))) continue;
        if (dist(site.pos, p) >= site.radius - step) escaped = true;
        todo.push(next);
      }
    }
    expect(escaped).toBe(false);
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s buries both ends of every wall in a neighbor', (_, site) => {
    const pieces = fortressPieces(site);
    const walls = pieces.filter((p) => p.kind === 'wall');
    expect(walls.length).toBeGreaterThan(0);

    const loose = walls.flatMap((w) =>
      [1, -1]
        .map((side) => ({ x: w.pos.x + side * w.r * Math.cos(w.yaw), y: w.pos.y + side * w.r * Math.sin(w.yaw) }))
        .filter((end) => !pieces.some((other) => other !== w && covers(other, end))),
    );
    expect(loose).toEqual([]);
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s stretches every wall within the allowed range', (_, site) => {
    const walls = fortressPieces(site).filter((p) => p.kind === 'wall');
    expect(walls.length).toBeGreaterThan(0);

    for (const w of walls) {
      expect((2 * w.r) / FORTRESS.wallLength).toBeGreaterThanOrEqual(FORTRESS.stretch[0]);
      expect((2 * w.r) / FORTRESS.wallLength).toBeLessThanOrEqual(FORTRESS.stretch[1]);
    }
  });

  it('puts towers at the corners of a square and bastions at the points of a star', () => {
    const square = FORTS.find((s) => FORTRESS_SITES[s.id].shape === 'square')!;
    const star = FORTS.find((s) => FORTRESS_SITES[s.id].shape === 'star')!;

    expect(fortressOutline(square)).toHaveLength(4);
    expect(fortressOutline(star)).toHaveLength(FORTRESS.starPoints * 2);
    expect(fortressPieces(star).filter((p) => p.kind === 'bastion').length).toBeGreaterThan(0);
    expect(fortressPieces(star).filter((p) => p.kind === 'tower')).toEqual([]);
    expect(fortressPieces(square).filter((p) => p.kind === 'tower').length).toBeGreaterThan(0);
  });

  it('throws when a corner lies on the edge of a gatehouse', () => {
    const site = FORTS.find((s) => FORTRESS_SITES[s.id].shape === 'square')!;
    const g = siteGates(site)[0];
    const toGate = Math.atan2(g.y - site.pos.y, g.x - site.pos.x);
    // A square corner on the side face of the gatehouse.
    const toSide = Math.asin(FORTRESS.gate.width / 2 / (site.radius - FORTRESS.inset));
    const cornered = { ...site, id: 'test-cornered', pos: { ...site.pos } };
    FORTRESS_SITES['test-cornered'] = { ...FORTRESS_SITES[site.id], turn: (toGate + toSide) / DEG };

    try {
      expect(() => fortressPieces(cornered)).toThrow(/corner/);
    } finally {
      delete FORTRESS_SITES['test-cornered'];
    }
  });

  it('throws for a site that is no fortress', () => {
    const site = SITES.find((s) => !(s.id in FORTRESS_SITES))!;

    expect(() => fortressOutline(site)).toThrow(/fortress/);
  });
});
