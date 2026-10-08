import { describe, expect, it } from 'vitest';
import { FORTRESS, FORTRESS_SITES, FORTRESS_STYLES, type FortressSite } from '../data/fortress';
import { REGION } from '../data/region';
import { siteGates, type Site } from './sites';
import { DEG, dist, segmentDist, type Vec } from './vec';
import { fortressFootprint, fortressGates, fortressOutline, insideCurtain, fortressPieces, onFortressRock, type FortressPiece } from './fortress';
import { PHYSICS } from '../data/physics';
import { boxDistance, propBoxes, propObstacle, type PosedBox } from './mapgen';
import { noseRocks } from './nose';
import BEFORE from './fortress-pieces-42b6c9fe.json';
import BEFORE_8D from './fortress-pieces-8d024493.json';

const SITES: Site[] = [...REGION.towns, ...REGION.locations];
const FORTS = SITES.filter((s) => s.id in FORTRESS_SITES);
const EPS = 1e-6;
const isFlush = (s: Site) => FORTRESS_STYLES[FORTRESS_SITES[s.id].style].flush;
const FLUSH = FORTS.filter(isFlush);
const CASTLES = FORTS.filter((s) => !isFlush(s));
const siteOf = (id: string): Site => FORTS.find((s) => s.id === id)!;
const KEPT = ['green-pit', 'pump-station', 'south-lock', 'scrapjaw', 'kiln'];

function covers(site: Site, piece: FortressPiece, p: Vec): boolean {
  const c = fortressFootprint(site, piece);
  return c.every((a, i) => {
    const b = c[(i + 1) % c.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPS;
  });
}

const ROCK_BOXES = new Map<string, PosedBox[]>([['nose', noseRocks(siteOf('nose')).flatMap((p, k) => propBoxes(propObstacle(p, k)).filter((b) => b.z0 < PHYSICS.truckClearance))]]);

function closed(site: Site, pieces: FortressPiece[], p: Vec): boolean {
  return pieces.some((piece) => covers(site, piece, p)) || (ROCK_BOXES.get(site.id) ?? []).some((b) => boxDistance(b, p) === 0);
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

    const reach = Math.max(...pieces.flatMap((p) => fortressFootprint(site, p).map((c) => dist(site.pos, c))));
    expect(reach).toBeLessThanOrEqual(site.radius);
  });

  it.each(CASTLES.map((s) => [s.id, s] as const))('%s puts one gatehouse at each gate, its outer face on the circle (IV1)', (_, site) => {
    const gates = fortressPieces(site).filter((p) => p.kind === 'gate');

    expect(gates).toHaveLength(siteGates(site).length);
    for (const g of siteGates(site)) {
      const out = outward(site, g);
      const { depth } = FORTRESS_STYLES[FORTRESS_SITES[site.id].style].gate;
      const house = gates.find((p) => dist(g, { x: p.pos.x + (out.x * depth) / 2, y: p.pos.y + (out.y * depth) / 2 }) < EPS);
      expect(house).toBeDefined();
      expect(Math.sin(house!.yaw) * out.x - Math.cos(house!.yaw) * out.y).toBeCloseTo(1, 9);
      for (const c of fortressFootprint(site, house!)) expect((c.x - g.x) * out.x + (c.y - g.y) * out.y).toBeLessThanOrEqual(EPS);
    }
  });

  it.each(FLUSH.map((s) => [s.id, s] as const))('%s puts one gatehouse at each gate, its outer face on the curtain line on the gate bearing (IV1)', (_, site) => {
    const outline = fortressOutline(site);
    const houses = fortressPieces(site).filter((p) => p.kind === 'gate');
    const gates = fortressGates(site);

    expect(houses).toHaveLength(siteGates(site).length);
    expect(gates.map((g) => g.gate)).toEqual(siteGates(site));
    for (const g of gates) {
      const bearingOf = (p: Vec) => Math.atan2(p.y - site.pos.y, p.x - site.pos.x);
      expect(bearingOf(g.face)).toBeCloseTo(bearingOf(g.gate), 9);
      expect(Math.min(...outline.map((a, i) => segmentDist(g.face, a, outline[(i + 1) % outline.length])))).toBeLessThan(EPS);
      const house = houses.find((h) => {
        const c = fortressFootprint(site, h);
        return dist(g.face, { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 }) < EPS;
      });
      expect(house, `${site.id} gate at ${g.gate.x},${g.gate.y}`).toBeDefined();
      expect(dist(g.gate, site.pos)).toBeGreaterThan(dist(g.face, site.pos));
    }
  });

  it.each(FLUSH.map((s) => [s.id, s] as const))('%s keeps every gatehouse in its circle', (_, site) => {
    const houses = fortressPieces(site).filter((p) => p.kind === 'gate');
    const reach = Math.max(...houses.flatMap((p) => fortressFootprint(site, p).map((c) => dist(site.pos, c))));
    expect(reach).toBeLessThanOrEqual(site.radius);
  });

  it.each(['dustwell', 'salvage-yard'])('puts the %s gate mid-side on its square', (id) => {
    const site = siteOf(id);
    const outline = fortressOutline(site);
    for (const g of fortressGates(site)) {
      const ends = outline.map((a, i) => [a, outline[(i + 1) % outline.length]] as const).find(([a, b]) => segmentDist(g.face, a, b) < EPS)!;
      expect(dist(g.face, ends[0])).toBeCloseTo(dist(g.face, ends[1]), 6);
    }
  });

  it('puts each Bowl gate mid-curtain between two bastions, clear of every gorge and tower', () => {
    const site = siteOf('bowl');
    const outline = fortressOutline(site);
    const { width } = FORTRESS_STYLES.patchwork.gate;
    expect(outline).toHaveLength(30);
    for (const g of fortressGates(site)) {
      const side = outline.findIndex((a, i) => segmentDist(g.face, a, outline[(i + 1) % outline.length]) < EPS);
      expect(side % 5).toBe(4);
      for (const corner of [outline[side], outline[(side + 1) % 30]]) expect(dist(g.face, corner)).toBeGreaterThanOrEqual(width / 2 + FORTRESS.gateClearance);
    }
    expect(fortressPieces(site).filter((p) => p.kind === 'tower')).toHaveLength(18);
  });

  it('gives Granary a ring with no towers', () => {
    const pieces = fortressPieces(siteOf('granary'));
    expect(pieces.filter((p) => p.kind === 'tower')).toEqual([]);
    expect(pieces.filter((p) => p.kind === 'wall').length).toBeGreaterThan(0);
  });

  it('lays Nose flush, with no bastion or inner gate (IV23)', () => {
    const pieces = fortressPieces(siteOf('nose'));
    expect(FORTRESS_STYLES.shipMetal.flush).toBe(true);
    expect(pieces.filter((p) => p.kind === 'bastion' || p.kind === 'inner')).toEqual([]);
    expect(pieces.filter((p) => p.kind === 'gate')).toHaveLength(2);
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s lays only the pieces its style builds (IV19)', (_, site) => {
    const { pieces } = FORTRESS_STYLES[FORTRESS_SITES[site.id].style];
    for (const p of fortressPieces(site)) expect(pieces).toContain(p.kind);
  });

  it.each(Object.keys(BEFORE_8D))('lays %s exactly as at 8d024493 (IV26)', (id) => {
    expect(fortressPieces(siteOf(id))).toEqual((BEFORE_8D as Record<string, FortressPiece[]>)[id]);
  });

  it.each(KEPT)('lays %s exactly as at 42b6c9fe (IV16)', (id) => {
    expect(fortressPieces(siteOf(id))).toEqual((BEFORE as Record<string, FortressPiece[]>)[id]);
  });

  it('sizes each gatehouse from its style', () => {
    for (const site of FORTS) {
      const { width } = FORTRESS_STYLES[FORTRESS_SITES[site.id].style].gate;
      for (const h of fortressPieces(site).filter((p) => p.kind === 'gate')) expect(h.r, site.id).toBe(width / 2);
      for (const g of fortressGates(site)) expect(g.width, site.id).toBe(width);
    }
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s closes its outline with pieces and rock', (_, site) => {
    const outline = fortressOutline(site);
    const pieces = fortressPieces(site);
    expect(outline.length).toBeGreaterThanOrEqual(4);

    const open: Vec[] = [];
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const steps = Math.ceil(dist(a, b) / 0.1);
      for (let k = 0; k < steps; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
        if (!closed(site, pieces, p)) open.push(p);
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
        if (closed(site, pieces, p)) continue;
        if (dist(site.pos, p) >= site.radius - step) escaped = true;
        todo.push(next);
      }
    }
    expect(escaped).toBe(false);
  });

  it.each(FORTS.map((s) => [s.id, s] as const))('%s buries both ends of every wall in a neighbor or the rock', (_, site) => {
    const pieces = fortressPieces(site);
    const walls = pieces.filter((p) => p.kind === 'wall');
    expect(walls.length).toBeGreaterThan(0);

    const loose = walls.flatMap((w) =>
      [1, -1]
        .map((side) => ({ x: w.pos.x + side * w.r * Math.cos(w.yaw), y: w.pos.y + side * w.r * Math.sin(w.yaw) }))
        .filter((end) => !closed(site, pieces.filter((other) => other !== w), end)),
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
    const site = CASTLES.find((s) => FORTRESS_SITES[s.id].shape === 'square')!;
    const g = siteGates(site)[0];
    const toGate = Math.atan2(g.y - site.pos.y, g.x - site.pos.x);
    const toSide = Math.asin(FORTRESS_STYLES[FORTRESS_SITES[site.id].style].gate.width / 2 / (site.radius - FORTRESS.inset));
    const cornered = { ...site, id: 'test-cornered', pos: { ...site.pos } };
    FORTRESS_SITES['test-cornered'] = { ...FORTRESS_SITES[site.id], turn: (toGate + toSide) / DEG };

    try {
      expect(() => fortressPieces(cornered)).toThrow(/corner/);
    } finally {
      delete FORTRESS_SITES['test-cornered'];
    }
  });

  describe('bastioned outlines', () => {
    const bowl = (): Site => siteOf('bowl');
    const test = (def: FortressSite, run: (site: Site) => void): void => {
      const site = { ...bowl(), id: 'test-bastions', pos: { ...bowl().pos } };
      FORTRESS_SITES['test-bastions'] = def;
      try {
        run(site);
      } finally {
        delete FORTRESS_SITES['test-bastions'];
      }
    };
    const bastions = FORTRESS_SITES.bowl.bastions!;

    it('throws when a gate lies by a gorge', () => {
      const g = siteGates(bowl())[0];
      const toGate = Math.atan2(g.y - bowl().pos.y, g.x - bowl().pos.x) / DEG;
      test({ ...FORTRESS_SITES.bowl, bastions: { ...bastions, gorge: 6.5, capitals: bastions.capitals.map((c) => (c === -44.52 ? toGate + 4 : c)) } }, (site) => expect(() => fortressPieces(site)).toThrow(/corner|short/));
    });

    it('throws when a bastion tower leaves the circle', () => {
      test({ ...FORTRESS_SITES.bowl, bastions: { ...bastions, salient: bowl().radius } }, (site) => expect(() => fortressPieces(site)).toThrow(/circle/));
    });

    it('throws when a curtain is too short for its gorges', () => {
      test({ ...FORTRESS_SITES.bowl, bastions: { ...bastions, gorge: 9 } }, (site) => expect(() => fortressPieces(site)).toThrow(/short/));
    });

    it('throws when the faces of a bastion cross', () => {
      test({ ...FORTRESS_SITES.bowl, bastions: { ...bastions, salient: 12, gorge: 4 } }, (site) => expect(() => fortressPieces(site)).toThrow(/crosses/));
    });
  });

  it('throws when a style lacks a piece its outline needs (IV19)', () => {
    const site = siteOf('granary');
    const squared = { ...site, id: 'test-squared', pos: { ...site.pos } };
    FORTRESS_SITES['test-squared'] = { shape: 'square', turn: 45, style: 'ring' };

    try {
      expect(() => fortressPieces(squared)).toThrow(/tower/);
    } finally {
      delete FORTRESS_SITES['test-squared'];
    }
  });

  it('throws for a site that is no fortress', () => {
    const site = SITES.find((s) => !(s.id in FORTRESS_SITES))!;

    expect(() => fortressOutline(site)).toThrow(/fortress/);
  });
});

function unflanked(site: Site): Vec[] {
  const outline = fortressOutline(site);
  const towers = fortressPieces(site).filter((p) => p.kind === 'tower').map((p) => p.pos);
  const inside = (p: Vec): boolean => insideCurtain(site, p, 0);
  const missed: Vec[] = [];
  const pieces = fortressPieces(site);
  for (const piece of pieces.filter((p) => p.kind === 'wall' || p.kind === 'gate')) {
    const [a, b] = fortressFootprint(site, piece);
    const length = dist(a, b);
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const n = { x: u.y, y: -u.x };
    for (let d = 0; d <= length + EPS; d += 0.5) {
      const foot = { x: a.x + u.x * d + n.x * 0.5, y: a.y + u.y * d + n.y * 0.5 };
      if (pieces.some((o) => o !== piece && covers(site, o, foot))) continue;
      const seen = towers.some((t) => {
        const out = (t.x - a.x) * n.x + (t.y - a.y) * n.y;
        if (out < FORTRESS.flankMin) return false;
        for (let k = 0; k <= 40; k++) {
          const q = { x: t.x + ((foot.x - t.x) * k) / 40, y: t.y + ((foot.y - t.y) * k) / 40 };
          if (inside(q) && outlineDist(outline, q) > 0.1) return false;
        }
        return true;
      });
      if (!seen) missed.push(foot);
    }
  }
  return missed;
}

function outlineDist(outline: Vec[], p: Vec): number {
  return Math.min(...outline.map((a, i) => segmentDist(p, a, outline[(i + 1) % outline.length])));
}

describe('flanking (IV25)', () => {
  it('has a tower that sees the foot of every Bowl wall and gatehouse', () => {
    expect(unflanked(siteOf('bowl'))).toEqual([]);
  });

  it('fails on a convex square with a tower on each corner', () => {
    expect(unflanked(siteOf('dustwell')).length).toBeGreaterThan(0);
  });
});

describe('Nose towers (IV30)', () => {
  it('stand at most 26 m apart along the curtain, outside the gatehouses and the rock', () => {
    const site = siteOf('nose');
    const angle = (p: Vec): number => Math.atan2(p.y - site.pos.y, p.x - site.pos.x);
    const pieces = fortressPieces(site);
    const towers = pieces.filter((p) => p.kind === 'tower').map((p) => p.pos).sort((a, b) => angle(a) - angle(b));
    const gates = pieces.filter((p) => p.kind === 'gate').map((p) => angle(p.pos));
    const between = (a: number, b: number, g: number): boolean => (a <= b ? g > a && g < b : g > a || g < b);
    let checked = 0;
    towers.forEach((t, i) => {
      const next = towers[(i + 1) % towers.length];
      if (gates.some((g) => between(angle(t), angle(next), g))) return;
      if (onFortressRock(site, { x: (t.x + next.x) / 2, y: (t.y + next.y) / 2 })) return;
      expect(dist(t, next) * 4, `tower ${i}`).toBeLessThanOrEqual(26);
      checked++;
    });
    expect(checked).toBeGreaterThan(12);
  });
});
