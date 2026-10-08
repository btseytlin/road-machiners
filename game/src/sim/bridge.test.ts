import { describe, expect, it } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { START_KITS } from '../data/start';
import { BRIDGE_AXIS, BRIDGE_LENGTH, BRIDGE_RAILS, crossesRail, deckAlong, nearRail } from './bridge';
import { route, routeLength } from './path';
import { segmentDist } from './vec';
import { deckEnds, groundAt, heightAt, isCliff, markHeightAt, tileAt } from './terrain';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';

const B = TERRAIN.features.bridge;
const at = (along: number, across: number) => ({
  x: B.from.x + BRIDGE_AXIS.x * along - BRIDGE_AXIS.y * across,
  y: B.from.y + BRIDGE_AXIS.y * along + BRIDGE_AXIS.x * across,
});

describe('Canyon Bridge', () => {
  const w = newWorld(1337, START_KITS.standard, TEST_MAP);
  const t = w.terrain;

  it('finds points near a rail as the distance to each rail does, on and around the deck', () => {
    const reach = 1.3;
    for (let along = -4; along <= BRIDGE_LENGTH + 4; along += 0.37)
      for (let across = -B.width - 4; across <= B.width + 4; across += 0.29) {
        const p = at(along, across);
        const near = BRIDGE_RAILS.some(([a, b]) => segmentDist(p, a, b) < reach);
        expect(nearRail(p.x, p.y, reach)).toBe(near);
      }
  });

  it('puts the deck on a straight line between the ground at both ends', () => {
    const [h0, h1] = deckEnds(t);
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const p = at(f * BRIDGE_LENGTH, 1);
      expect(heightAt(t, p.x, p.y)).toBeCloseTo(h0 + (h1 - h0) * f, 9);
    }
  });

  it('cuts the causeway, so the canyon floor lies far below the deck', () => {
    const mid = at(BRIDGE_LENGTH / 2, 0);
    expect(groundAt(t, mid.x, mid.y)).toBeLessThan(heightAt(t, mid.x, mid.y) - 3);
    const beside = at(BRIDGE_LENGTH / 2, B.width + 4);
    expect(groundAt(t, beside.x, beside.y)).toBeLessThan(heightAt(t, mid.x, mid.y) - 3);
    for (const along of [0, BRIDGE_LENGTH]) {
      const end = at(along, 0);
      expect(Math.abs(groundAt(t, end.x, end.y) - heightAt(t, end.x, end.y))).toBeLessThan(1e-9);
    }
  });

  it('keeps marks beside the deck level with it for a truck up on the deck, not for one in the canyon', () => {
    const onDeck = at(BRIDGE_LENGTH / 2, 0);
    const floor = at(BRIDGE_LENGTH / 2, B.width + 4);
    const deck = heightAt(t, onDeck.x, onDeck.y);
    expect(markHeightAt(t, onDeck, floor.x, floor.y)).toBe(deck);
    expect(markHeightAt(t, floor, floor.x, floor.y)).toBe(groundAt(t, floor.x, floor.y));
    const past = at(-3, 0);
    expect(markHeightAt(t, onDeck, past.x, past.y)).toBe(heightAt(t, past.x, past.y));
  });

  it('makes deck tiles drivable road', () => {
    for (let along = 0.5; along < BRIDGE_LENGTH; along += 0.5) {
      const p = at(along, 0);
      const tile = tileAt(t, p);
      expect(isCliff(t, tile)).toBe(false);
      expect(t.types[tile]).toBe('road');
    }
  });

  it('routes the widest truck across the deck between the rails', () => {
    const radius = 0.95;
    const start = at(-8, 0);
    const goal = at(BRIDGE_LENGTH + 2, 0);
    const points = [start, ...route(w, start, goal, radius, [])];
    expect(points.at(-1)).toEqual(goal);
    for (let i = 1; i < points.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const x = points[i - 1].x + (points[i].x - points[i - 1].x) * (k / 20);
        const y = points[i - 1].y + (points[i].y - points[i - 1].y) * (k / 20);
        const along = (x - B.from.x) * BRIDGE_AXIS.x + (y - B.from.y) * BRIDGE_AXIS.y;
        if (along < 0 || along > BRIDGE_LENGTH) continue;
        expect(deckAlong(x, y), `${x},${y}`).not.toBeNull();
        const across = (y - B.from.y) * BRIDGE_AXIS.x - (x - B.from.x) * BRIDGE_AXIS.y;
        expect(Math.abs(across)).toBeLessThan(B.width / 2 - radius);
      }
    }
  });

  it('reaches the deck from the canyon floor only over an end, never across a rail', () => {
    const deck = at(BRIDGE_LENGTH / 2, 0);
    const floor = at(BRIDGE_LENGTH / 2, B.width + 6);
    const points = [floor, ...route(w, floor, deck, 0.5, [])];
    expect(points.at(-1)).toEqual(deck);
    for (let i = 1; i < points.length; i++) expect(crossesRail(points[i - 1], points[i], 0)).toBe(false);
    expect(routeLength(floor, points.slice(1))).toBeGreaterThan(BRIDGE_LENGTH / 2);
  });
});
