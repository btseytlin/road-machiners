import { describe, expect, it } from 'vitest';
import { BROKEN_WING, BROKEN_WING_POINT, scalePoint } from '../data/region';
import { START_KITS } from '../data/start';
import { bridgeCut, crossesRail, deckAt, deckById, DECKS, inLineWith, nearRail, spanAt } from './bridge';
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

  it('lays marks on the ground for a truck far from every deck, even inside a deck stripe', () => {
    const far = { x: 344, y: 264 };
    for (let r = 0.5; r <= 10; r += 0.5) {
      for (let a = 0; a < 360; a += 15) {
        const x = far.x + r * Math.cos((a * Math.PI) / 180);
        const y = far.y + r * Math.sin((a * Math.PI) / 180);
        expect(markHeightAt(t, far, x, y)).toBe(groundAt(t, x, y));
      }
    }
  });

  it('lays a canyon-floor truck marks on the floor under the deck outline', () => {
    const floor = at(B.length / 2, B.width + 4);
    const under = at(B.length / 2, 1);
    expect(markHeightAt(t, floor, under.x, under.y)).toBe(groundAt(t, under.x, under.y));
  });

  it('keeps marks level with the deck for a truck on the road in line before its end', () => {
    const road = at(-2, 0);
    const beside = at(2, B.width / 2 + 2);
    const deck = heightAt(t, at(2, 0).x, at(2, 0).y);
    expect(markHeightAt(t, road, beside.x, beside.y)).toBeGreaterThanOrEqual(deck);
  });

  it('differs from the ground only for an origin in line with the deck spanning the point', () => {
    for (let ox = 0; ox < t.size; ox += 12) {
      for (let oy = 0; oy < t.size; oy += 12) {
        const origin = { x: ox, y: oy };
        for (let r = 0.5; r <= 20; r += 4.5) {
          for (let a = 0; a < 360; a += 45) {
            const x = ox + r * Math.cos((a * Math.PI) / 180);
            const y = oy + r * Math.sin((a * Math.PI) / 180);
            const span = spanAt(x, y);
            if (span !== null && inLineWith(span.deck, origin)) continue;
            expect(markHeightAt(t, origin, x, y)).toBe(span === null ? heightAt(t, x, y) : groundAt(t, x, y));
          }
        }
      }
    }
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
