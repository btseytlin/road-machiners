import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../data/physics';
import { BROKEN_WING, BROKEN_WING_POINT, REGION, scalePoint } from '../data/region';
import { START_KITS } from '../data/start';
import { TERRAIN, type DeckSpec } from '../data/terrain';
import { FALLEN_SUN_DECKS } from '../data/territory';
import { bridgeCut, buildDecks, crossesRail, deckAt, deckById, deckCenterAt, DECKS, nearRail, propBase, underDeck, type Deck } from './bridge';
import { blockingBoxes, boxDistance, propBoxes, type PosedBox } from './mapgen';
import { territoryPieces } from './territory';
import type { Obstacle } from './types';
import { route, routeLength } from './path';
import { dist, segmentDist } from './vec';
import { deckHeight, deckSegments, groundAt, heightAt, isCliff, markHeightAt, tileAt, type Terrain } from './terrain';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { defaultSetup } from './settings';

const B = deckById('canyon-bridge');
const at = (along: number, across: number) => ({
  x: B.from.x + B.axis.x * along - B.axis.y * across,
  y: B.from.y + B.axis.y * along + B.axis.x * across,
});

describe('the deck list', () => {
  it('holds Canyon Bridge first, with the geometry it had as the one bridge, then the Broken Wing deck, then the Fallen Sun decks', () => {
    const from = scalePoint({ x: 97.9, y: 75.1 });
    const to = scalePoint({ x: 101.5, y: 71.5 });
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const axis = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const off = { x: -axis.y * 4, y: axis.x * 4 };

    expect(DECKS.map((d) => d.id)).toEqual(['canyon-bridge', 'broken-wing', ...FALLEN_SUN_DECKS.map((d) => d.id)]);
    expect(DECKS[0]).toEqual({
      id: 'canyon-bridge',
      from,
      to,
      width: 8,
      cut: { abutment: 1, ramp: 1.5 },
      skirt: false,
      lips: [],
      axis,
      length,
      stations: [{ at: from, along: 0, rise: 0 }, { at: to, along: length, rise: 0 }],
      rails: [
        [{ x: from.x - off.x, y: from.y - off.y }, { x: to.x - off.x, y: to.y - off.y }],
        [{ x: from.x + off.x, y: from.y + off.y }, { x: to.x + off.x, y: to.y + off.y }],
      ],
    });
  });

  it('fails loudly on an unknown deck id', () => {
    expect(() => deckById('no-such-deck')).toThrow('Unknown deck no-such-deck');
  });
});

describe('the Broken Wing deck', () => {
  const W = deckById('broken-wing');
  const on = (along: number, across: number) => ({
    x: W.from.x + W.axis.x * along - W.axis.y * across,
    y: W.from.y + W.axis.y * along + W.axis.x * across,
  });

  it('lies along the Broken Wing road between the deck ends BROKEN_WING places, with a skirt and no cut', () => {
    expect(W.from).toEqual(BROKEN_WING_POINT(-BROKEN_WING.deckHalf, 0));
    expect(W.to).toEqual(BROKEN_WING_POINT(BROKEN_WING.deckHalf, 0));
    expect(W.width).toBe(6);
    expect(W.cut).toBeNull();
    expect(W.skirt).toBe(true);
    expect(W.stations.map((s) => s.rise)).toEqual([0, 0]);
    expect(W.lips).toEqual([]);
  });

  it('is the deck under every point of its outline, and no deck holds a point beside or past it', () => {
    for (let along = 0.25; along < W.length; along += 0.5)
      for (let across = -W.width / 2 + 0.25; across < W.width / 2; across += 0.5) {
        const p = on(along, across);
        expect(deckAt(p.x, p.y)?.deck.id).toBe('broken-wing');
        expect(deckAt(p.x, p.y)?.along).toBeCloseTo(along, 9);
      }
    for (const [along, across] of [[W.length / 2, W.width / 2 + 0.5], [W.length / 2, -W.width / 2 - 0.5], [-0.5, 0], [W.length + 0.5, 0]]) {
      const p = on(along, across);
      expect(deckAt(p.x, p.y)).toBeNull();
    }
  });

  it('keeps the road flattening under and beside it, unlike Canyon Bridge', () => {
    for (let along = -2; along <= W.length + 2; along += 0.5)
      for (let across = -W.width; across <= W.width; across += 0.5) {
        const p = on(along, across);
        expect(bridgeCut(p.x, p.y)).toBe(0);
      }
  });
});

describe('Canyon Bridge', () => {
  const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  const t = w.terrain;

  it('finds points near a rail as the distance to each rail does, on and around the deck', () => {
    const reach = 1.3;
    for (let along = -4; along <= B.length + 4; along += 0.37)
      for (let across = -B.width - 4; across <= B.width + 4; across += 0.29) {
        const p = at(along, across);
        const near = B.rails.some(([a, b]) => segmentDist(p, a, b) < reach);
        expect(nearRail(p.x, p.y, reach)).toBe(near);
      }
  });

  it('puts the deck on a straight line between the ground at both ends', () => {
    const [{ h0, h1 }] = deckSegments(t, B);
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const p = at(f * B.length, 1);
      expect(heightAt(t, p.x, p.y)).toBeCloseTo(h0 + (h1 - h0) * f, 9);
    }
  });

  it('cuts the causeway, so the canyon floor lies far below the deck', () => {
    const mid = at(B.length / 2, 0);
    expect(groundAt(t, mid.x, mid.y)).toBeLessThan(heightAt(t, mid.x, mid.y) - 3);
    // Beside the deck the cut ground is low too, while the abutments stay at deck level.
    const beside = at(B.length / 2, B.width + 4);
    expect(groundAt(t, beside.x, beside.y)).toBeLessThan(heightAt(t, mid.x, mid.y) - 3);
    for (const along of [0, B.length]) {
      const end = at(along, 0);
      expect(Math.abs(groundAt(t, end.x, end.y) - heightAt(t, end.x, end.y))).toBeLessThan(1e-9);
    }
  });

  it('keeps marks beside the deck level with it for a truck up on the deck, not for one in the canyon', () => {
    const onDeck = at(B.length / 2, 0);
    const floor = at(B.length / 2, B.width + 4);
    const deck = heightAt(t, onDeck.x, onDeck.y);
    expect(markHeightAt(t, onDeck, floor.x, floor.y)).toBe(deck);
    expect(markHeightAt(t, floor, floor.x, floor.y)).toBe(groundAt(t, floor.x, floor.y));
    // Past the deck ends a mark lies on the ground.
    const past = at(-3, 0);
    expect(markHeightAt(t, onDeck, past.x, past.y)).toBe(heightAt(t, past.x, past.y));
  });

  it('lays every mark of a truck far from all decks on the map, however far a deck reaches between its ends', () => {
    const far = (p: { x: number; y: number }) => DECKS.every((d) => segmentDist(p, d.from, d.to) > d.width / 2 + TERRAIN.vision.radius);
    let checked = 0;
    for (let y = 2; y < t.size - 2; y += 3)
      for (let x = 2; x < t.size - 2; x += 3) {
        const origin = { x, y };
        if (!far(origin)) continue;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          expect(markHeightAt(t, origin, x + dx, y + dy)).toBe(heightAt(t, x + dx, y + dy));
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(1000);
  });

  it('makes deck tiles drivable road', () => {
    for (let along = 0.5; along < B.length; along += 0.5) {
      const p = at(along, 0);
      const tile = tileAt(t, p);
      expect(isCliff(t, tile)).toBe(false);
      expect(t.types[tile]).toBe('road');
    }
  });

  it('routes the widest truck across the deck between the rails', () => {
    const radius = 0.95;
    const start = at(-8, 0);
    const goal = at(B.length + 2, 0);
    const points = [start, ...route(w, start, goal, radius, [])];
    expect(points.at(-1)).toEqual(goal);
    for (let i = 1; i < points.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const x = points[i - 1].x + (points[i].x - points[i - 1].x) * (k / 20);
        const y = points[i - 1].y + (points[i].y - points[i - 1].y) * (k / 20);
        const along = (x - B.from.x) * B.axis.x + (y - B.from.y) * B.axis.y;
        if (along < 0 || along > B.length) continue;
        expect(deckAt(x, y), `${x},${y}`).not.toBeNull();
        const across = (y - B.from.y) * B.axis.x - (x - B.from.x) * B.axis.y;
        expect(Math.abs(across)).toBeLessThan(B.width / 2 - radius);
      }
    }
  });

  it('reaches the deck from the canyon floor only over an end, never across a rail', () => {
    const deck = at(B.length / 2, 0);
    const floor = at(B.length / 2, B.width + 6);
    const points = [floor, ...route(w, floor, deck, 0.5, [])];
    expect(points.at(-1)).toEqual(deck);
    for (let i = 1; i < points.length; i++) expect(crossesRail(points[i - 1], points[i], 0)).toBe(false);
    expect(routeLength(floor, points.slice(1))).toBeGreaterThan(B.length / 2);
  });
});

describe('deckCenterAt', () => {
  const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    expect(p.x).toBeCloseTo(q.x, 9);
    expect(p.y).toBeCloseTo(q.y, 9);
  };

  it('maps a point beside the rail to the centre line at the same distance along', () => {
    near(deckCenterAt(B, at(5, 3.9).x, at(5, 3.9).y, 1), at(5, 0));
    near(deckCenterAt(B, at(5, -7).x, at(5, -7).y, 1), at(5, 0));
  });

  it('clamps points past either end to the margin from that end', () => {
    near(deckCenterAt(B, at(-3, 2).x, at(-3, 2).y, 1), at(1, 0));
    near(deckCenterAt(B, at(B.length + 3, -2).x, at(B.length + 3, -2).y, 1), at(B.length - 1, 0));
  });

  it('gives the same point again for its own result', () => {
    for (const p of [at(-2, 1), at(4, 3), at(B.length + 1, -3)]) {
      const once = deckCenterAt(B, p.x, p.y, Math.SQRT1_2);
      near(deckCenterAt(B, once.x, once.y, Math.SQRT1_2), once);
    }
  });

  it('with a margin of half a tile diagonal, always lands in a tile whose centre is on the deck', () => {
    for (const deck of DECKS) {
      for (let along = -2; along <= deck.length + 2; along += 0.37) {
        for (let across = -deck.width; across <= deck.width; across += 0.41) {
          const p = { x: deck.from.x + deck.axis.x * along - deck.axis.y * across, y: deck.from.y + deck.axis.y * along + deck.axis.x * across };
          const c = deckCenterAt(deck, p.x, p.y, Math.SQRT1_2);
          expect(deckAt(Math.floor(c.x) + 0.5, Math.floor(c.y) + 0.5)?.deck).toBe(deck);
        }
      }
    }
  });

  it('fails loudly on a negative margin or one that leaves no segment', () => {
    expect(() => deckCenterAt(B, B.from.x, B.from.y, -1)).toThrow();
    expect(() => deckCenterAt(B, B.from.x, B.from.y, B.length / 2)).toThrow();
  });
});

// A test deck along +x at y 50, 4 tiles wide, through stations given as [x, rise].
const spec = (id: string, stations: [number, number][], skirt = true): DeckSpec => ({ id, line: stations.map(([x, rise]) => ({ at: { x, y: 50 }, rise })), width: 4, cut: null, skirt });

describe('raised deck ends', () => {
  it('makes a raised end a lip across the deck, from rail end to rail end', () => {
    const [flap] = buildDecks([spec('flap', [[10, 0], [15, 0.6]])]);

    expect(flap.lips).toEqual([[{ x: 15, y: 48 }, { x: 15, y: 52 }]]);
  });

  it('makes both ends lips when both are raised, and no lip at an end on the ground', () => {
    const [both, ground] = buildDecks([spec('both', [[10, 0.5], [15, 0.5]]), spec('ground', [[30, 0], [35, 0]])]);

    expect(both.lips).toEqual([[{ x: 10, y: 48 }, { x: 10, y: 52 }], [{ x: 15, y: 48 }, { x: 15, y: 52 }]]);
    expect(ground.lips).toEqual([]);
  });

  it('makes lips only at the raised ends of a deck that climbs, runs level and comes down, never at a change of grade', () => {
    const [wing, ramp] = buildDecks([spec('wing', [[10, 0], [18, 1.5], [40, 1.5], [48, 0]]), spec('ramp', [[60, 0], [68, 1.5], [90, 1.5]])]);

    expect(wing.lips).toEqual([]);
    expect(ramp.lips).toEqual([[{ x: 90, y: 48 }, { x: 90, y: 52 }]]);
    expect(wing.stations).toEqual([{ at: { x: 10, y: 50 }, along: 0, rise: 0 }, { at: { x: 18, y: 50 }, along: 8, rise: 1.5 }, { at: { x: 40, y: 50 }, along: 30, rise: 1.5 }, { at: { x: 48, y: 50 }, along: 38, rise: 0 }]);
  });

  it('fails loudly on a deck with one station, a station that is not a number, a station off its line or out of order, a sunk station or a raised deck without a skirt', () => {
    expect(() => buildDecks([spec('one', [[10, 0]])])).toThrow('Deck one needs at least two stations');
    expect(() => buildDecks([{ ...spec('bent', [[10, 0], [20, 0]]), line: [{ at: { x: 10, y: 50 }, rise: 0 }, { at: { x: 15, y: 50.01 }, rise: 0 }, { at: { x: 20, y: 50 }, rise: 0 }] }])).toThrow('Deck bent has station 1 off its line');
    expect(() => buildDecks([spec('back', [[10, 0], [25, 0], [20, 0]])])).toThrow('Deck back has station 2 out of order');
    expect(() => buildDecks([spec('sunk', [[10, 0], [15, -0.2]])])).toThrow('Deck sunk has a negative rise');
    expect(() => buildDecks([spec('blank', [[10, 0], [15, Number.NaN]])])).toThrow('Deck blank has a station that is not a number');
    expect(() => buildDecks([{ ...spec('lost', [[10, 0], [20, 0]]), line: [{ at: { x: 10, y: 50 }, rise: 0 }, { at: { x: Number.NaN, y: 50 }, rise: 0 }, { at: { x: 20, y: 50 }, rise: 0 }] }])).toThrow('Deck lost has a station that is not a number');
    expect(() => buildDecks([spec('bare', [[10, 0], [15, 0.3]], false)])).toThrow('Deck bare is raised but not skirted');
  });

  it('fails loudly on two decks that meet end to end or overlap, since one surface is one deck', () => {
    expect(() => buildDecks([spec('up', [[10, 0], [18, 1.5]]), spec('span', [[18, 1.5], [40, 1.5]])])).toThrow('Decks up and span touch');
    expect(() => buildDecks([spec('a', [[10, 0], [20, 0]]), { ...spec('b', [[0, 0], [1, 0]]), line: [{ at: { x: 12, y: 53 }, rise: 0 }, { at: { x: 22, y: 53 }, rise: 0 }] }])).toThrow('Decks a and b touch');
    expect(() => buildDecks([spec('a', [[10, 0], [20, 0]]), { ...spec('b', [[0, 0], [1, 0]]), line: [{ at: { x: 15, y: 40 }, rise: 0 }, { at: { x: 15, y: 60 }, rise: 0 }] }])).toThrow('Decks a and b touch');
    expect(() => buildDecks([spec('a', [[10, 0], [20, 0]]), spec('b', [[24.01, 0], [30, 0]])])).not.toThrow();
  });

  it('gives the Fallen Sun flap a lip at its raised end that blocks like a rail', () => {
    const flap = deckById(FALLEN_SUN_DECKS[0].id);
    expect(flap.lips).toHaveLength(1);
    const [a, b] = flap.lips[0];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const past = { x: mid.x + flap.axis.x * 0.5, y: mid.y + flap.axis.y * 0.5 };
    const before = { x: mid.x - flap.axis.x * 2, y: mid.y - flap.axis.y * 2 };
    const beyond = { x: mid.x + flap.axis.x * 4, y: mid.y + flap.axis.y * 4 };

    // Half a tile past the lip's middle lies 1.5 tiles from either rail, but within reach of the lip.
    expect(flap.rails.every(([c, d]) => segmentDist(past, c, d) > 1)).toBe(true);
    expect(nearRail(past.x, past.y, 1)).toBe(true);
    expect(crossesRail(before, beyond, 0)).toBe(true);
  });

  it('gives the low end of the flap no lip, so a truck drives onto it there', () => {
    const flap = deckById(FALLEN_SUN_DECKS[0].id);
    const before = { x: flap.from.x - flap.axis.x * 3, y: flap.from.y - flap.axis.y * 3 };
    const onto = { x: flap.from.x + flap.axis.x * 2, y: flap.from.y + flap.axis.y * 2 };

    expect(flap.stations[0].rise).toBe(0);
    expect(crossesRail(before, onto, 0)).toBe(false);
  });
});

describe('the height a prop stands on', () => {
  const t = TEST_MAP.terrain;
  const span = deckById('fallen-sun-wing');
  const piece = territoryPieces(REGION.locations.find((l) => l.id === 'fallen-sun') as never).find((p) => segmentDist(p.pos, span.from, span.to) < span.width / 2)!;
  const pier: Obstacle = { id: 'hullDrum-7', kind: 'landmark', look: 'hullDrum', pos: piece.pos, r: piece.r, yaw: piece.yaw };
  const top = Math.max(...propBoxes(pier).map((b) => b.z1)) / PHYSICS.metersPerTile;

  // The baked map with the ground under the pier sunk into a pit, as its seat in the furrow's gouge levels it, so the
  // pier's top lies a little under the deck line.
  function withPit(): Terrain {
    const on = deckAt(pier.pos.x, pier.pos.y)!;
    const floor = deckHeight(t, on.deck, on.along) - top - 0.1;
    const heights = [...t.heights];
    const reach = Math.max(...propBoxes(pier).map((b) => dist(b.center, pier.pos) + Math.hypot(b.half.x, b.half.y))) + 1;
    for (let j = Math.floor(pier.pos.y - reach); j <= pier.pos.y + reach; j++) {
      for (let i = Math.floor(pier.pos.x - reach); i <= pier.pos.x + reach; i++) if (propBoxes(pier).some((box) => boxDistance(box, { x: i, y: j }) < 1)) heights[j * (t.size + 1) + i] = floor;
    }
    return { ...t, heights };
  }

  it('stands a pier under the wing on the ground under the deck, so its boxes under the deck line block nothing', () => {
    const pit = withPit();
    const boxes = propBoxes(pier);
    const blocking = blockingBoxes(pier, pit);
    const inside = (b: (typeof boxes)[number]) => Math.abs((b.center.y - span.from.y) * span.axis.x - (b.center.x - span.from.x) * span.axis.y) < span.width / 2;

    expect(propBase(pit, pier)).toBe(groundAt(pit, pier.pos.x, pier.pos.y));
    expect(heightAt(pit, pier.pos.x, pier.pos.y) - propBase(pit, pier)).toBeGreaterThan(top);
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.length).toBeLessThan(boxes.length);
    for (const b of boxes.filter(inside)) expect(blocking).not.toContain(b);
  });

  it('stands a wreck on Canyon Bridge on the bridge, over the canyon', () => {
    const mid = at(B.length / 2, 0);
    const wreck: Obstacle = { id: 'wreck-npc-1', kind: 'wreck', pos: mid, r: 0.8 };

    expect(propBase(t, wreck)).toBe(heightAt(t, mid.x, mid.y));
    expect(propBase(t, wreck)).toBeGreaterThan(groundAt(t, mid.x, mid.y) + 3);
  });

  it('stands a prop off every deck on the ground, as before', () => {
    const rock: Obstacle = { id: 'rock3', kind: 'rock', pos: at(B.length / 2, 30), r: 1 };

    expect(propBase(t, rock)).toBe(heightAt(t, rock.pos.x, rock.pos.y));
  });
});

describe('a box under the Fallen Sun\'s wing', () => {
  const t = TEST_MAP.terrain;
  const wing = deckById('fallen-sun-wing');

  it('is under the deck when its footprint spans a change of grade, judged against the whole wing (IV6)', () => {
    for (const s of wing.stations.slice(1, -1)) {
      const box: PosedBox = { center: s.at, axis: wing.axis, half: { x: 1.5, y: 1.5 }, z0: 0, z1: 1 };
      const base = groundAt(t, s.at.x, s.at.y);

      expect(heightAt(t, s.at.x, s.at.y) - base).toBeGreaterThan(1 / PHYSICS.metersPerTile);
      expect(underDeck(box, base, t), `station at ${s.along}`).toBe(true);
    }
  });
});

describe('marks beside a deck that climbs, runs level and comes down', () => {
  const t = TEST_MAP.terrain;
  const wing = deckById('fallen-sun-wing');
  const on = (deck: Deck, along: number, across: number) => ({
    x: deck.from.x + deck.axis.x * along - deck.axis.y * across,
    y: deck.from.y + deck.axis.y * along + deck.axis.x * across,
  });

  it('stay level with the wing past each change of grade, for a truck on the wing 1 tile before it (finding 1)', () => {
    for (const s of wing.stations.slice(1, -1)) {
      const truck = on(wing, s.along - 1, 0);
      for (const d of [-0.5, 0.5, 2, 4])
        for (const across of [6, 8, -6, -8]) {
          const p = on(wing, s.along + d, across);
          const deck = deckHeight(t, wing, s.along + d);
          expect(markHeightAt(t, truck, p.x, p.y), `station ${s.along} ${d} ${across}`).toBeCloseTo(Math.max(deck, heightAt(t, p.x, p.y)), 9);
        }
    }
  });

  // Every mark beside the truck's deck follows that deck's rule: on the deck line where the truck is nearer it than the
  // ground, else on the ground. Marks on the deck line step no more than the deck does, so no mark tears from the deck.
  it('follow the one deck beside every Fallen Sun deck for a truck on it, and step with the deck line (IV4)', () => {
    let lifted = 0;
    for (const spec of FALLEN_SUN_DECKS) {
      const deck = deckById(spec.id);
      const segments = deckSegments(t, deck);
      const steepest = Math.max(...segments.map((g) => Math.abs(g.h1 - g.h0) / g.length));
      const trucks = [...deck.stations.map((s) => Math.min(deck.length - 0.5, Math.max(0.5, s.along))), ...deck.stations.slice(1, -1).map((s) => s.along - 1), deck.length / 2];
      for (const along of trucks) {
        const truck = on(deck, along, 0);
        const from = heightAt(t, truck.x, truck.y);
        for (const side of [-1, 1])
          for (let across = deck.width / 2 + 0.25; across <= deck.width / 2 + 8; across += 0.5) {
            let last: number | null = null;
            // From an eighth of a tile in, so no mark lies on an end, where rounding may put it off the deck.
            for (let a = 0.125; a < deck.length; a += 0.25) {
              const p = on(deck, a, side * across);
              if (dist(p, truck) > TERRAIN.vision.radius) {
                last = null;
                continue;
              }
              const line = deckHeight(t, deck, a);
              const ground = heightAt(t, p.x, p.y);
              const onLine = ground < line && Math.abs(from - line) < Math.abs(from - ground);
              const mark = markHeightAt(t, truck, p.x, p.y);
              const where = `${deck.id} truck ${along} mark ${a},${side * across}`;
              expect(mark, where).toBeCloseTo(onLine ? line : ground, 9);
              if (onLine && last !== null) expect(Math.abs(mark - last), where).toBeLessThanOrEqual(steepest * 0.25 + 1e-6);
              if (onLine) lifted++;
              last = onLine ? mark : null;
            }
          }
      }
    }
    expect(lifted).toBeGreaterThan(5000);
  });
});
