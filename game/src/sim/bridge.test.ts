import { describe, expect, it } from 'vitest';
import { BROKEN_WING, BROKEN_WING_POINT, scalePoint } from '../data/region';
import { START_KITS } from '../data/start';
import { bridgeCut, crossesRail, deckAt, deckById, deckCenterAt, DECKS, nearRail } from './bridge';
import { route, routeLength } from './path';
import { segmentDist } from './vec';
import { deckEnds, groundAt, heightAt, isCliff, markHeightAt, tileAt } from './terrain';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';

const B = deckById('canyon-bridge');
const at = (along: number, across: number) => ({
  x: B.from.x + B.axis.x * along - B.axis.y * across,
  y: B.from.y + B.axis.y * along + B.axis.x * across,
});

describe('the deck list', () => {
  it('holds Canyon Bridge first, with the geometry it had as the one bridge, then the Broken Wing deck', () => {
    const from = scalePoint({ x: 97.9, y: 75.1 });
    const to = scalePoint({ x: 101.5, y: 71.5 });
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const axis = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const off = { x: -axis.y * 4, y: axis.x * 4 };

    expect(DECKS.map((d) => d.id)).toEqual(['canyon-bridge', 'broken-wing']);
    expect(DECKS[0]).toEqual({
      id: 'canyon-bridge',
      from,
      to,
      width: 8,
      cut: { abutment: 1, ramp: 1.5 },
      skirt: false,
      axis,
      length,
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
  const w = newWorld(1337, START_KITS.standard, TEST_MAP);
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
    const [h0, h1] = deckEnds(t, B);
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
