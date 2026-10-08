import { describe, expect, it } from 'vitest';
import { TIME } from '../data/time';
import { DEG } from './vec';
import { addVehicle, emptyWorld } from './testkit';
import { cappedHeatAt, clockOf, heatAt, inShade, sunAt, type Sun } from './sun';

function turnFor(hour: number): number {
  return 1 + ((hour - TIME.startHour) * TIME.turnsPerDay) / 24;
}

describe('clockOf', () => {
  it('wraps a day at turnsPerDay turns', () => {
    const day1 = clockOf(1);
    expect(day1.day).toBe(1);
    expect(day1.hour).toBeCloseTo(TIME.startHour);
    const nextDay = clockOf(1 + TIME.turnsPerDay);
    expect(nextDay.day).toBe(2);
    expect(nextDay.hour).toBeCloseTo(TIME.startHour);
  });
});

describe('sunAt', () => {
  it('is null at night and set at noon', () => {
    expect(sunAt(turnFor(2))).toBeNull();
    const noon = sunAt(turnFor((TIME.sunrise + TIME.sunset) / 2));
    expect(noon).not.toBeNull();
    expect(noon!.elevation).toBeCloseTo(TIME.noonElevation * DEG, 2);
  });

  it('crosses the north at noon, the side away from the camera', () => {
    const noon = sunAt(turnFor((TIME.sunrise + TIME.sunset) / 2))!;
    expect(noon.dir.x).toBeCloseTo(0);
    expect(noon.dir.y).toBeCloseTo(-1);
  });
});

describe('inShade', () => {
  it('shades a tile behind a tall hill in the morning but not at noon', () => {
    const w = emptyWorld();
    const heights = [...w.terrain.heights];
    const size = w.terrain.size;
    for (let j = 9; j <= 11; j++) for (let i = 19; i <= 22; i++) heights[j * (size + 1) + i] = 5;
    w.terrain = { ...w.terrain, heights };
    const pos = { x: 10, y: 10 };
    const morning: Sun = { dir: { x: 1, y: 0 }, elevation: 5 * DEG };
    const noon: Sun = { dir: { x: 1, y: 0 }, elevation: 70 * DEG };
    expect(inShade(w, pos, morning)).toBe(true);
    expect(inShade(w, pos, noon)).toBe(false);
  });

  it('shades the tile behind a rock', () => {
    const w = emptyWorld();
    w.obstacles = [{ id: 'r1', pos: { x: 20, y: 10 }, r: 1, kind: 'rock' }];
    const pos = { x: 10, y: 10 };
    const low: Sun = { dir: { x: 1, y: 0 }, elevation: 3 * DEG };
    expect(inShade(w, pos, low)).toBe(true);
  });
});

describe('heatAt', () => {
  it('is 1 at night and above 1 in full sun', () => {
    const w = emptyWorld();
    w.turn = turnFor(2);
    const pos = w.vehicles[0].pos;
    expect(heatAt(w, pos)).toBe(1);
    w.turn = turnFor((TIME.sunrise + TIME.sunset) / 2);
    expect(heatAt(w, pos)).toBeGreaterThan(1);
  });

  it('is 1 in shade even under full sun', () => {
    const w = emptyWorld();
    w.turn = turnFor((TIME.sunrise + TIME.sunset) / 2);
    const heights = [...w.terrain.heights];
    const size = w.terrain.size;
    const sun = sunAt(w.turn)!;
    const pos = w.vehicles[0].pos;
    const bx = Math.round(pos.x + sun.dir.x * 3);
    const by = Math.round(pos.y + sun.dir.y * 3);
    for (let j = by - 1; j <= by + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) heights[j * (size + 1) + i] = 50;
    w.terrain = { ...w.terrain, heights };
    expect(heatAt(w, pos)).toBe(1);
  });
});

describe('cappedHeatAt', () => {
  it('caps the sun height share, so noon sun heats like a lower sun', () => {
    const w = emptyWorld();
    const pos = { x: 30, y: 30 };
    w.turn = turnFor((TIME.sunrise + TIME.sunset) / 2);
    expect(cappedHeatAt(w, pos, 0.5)).toBeCloseTo(1 + (heatAt(w, pos) - 1) * 0.5);
    expect(cappedHeatAt(w, pos, 1)).toBe(heatAt(w, pos));
  });

  it('leaves a sun lower than the cap as it is, and night at 1', () => {
    const w = emptyWorld();
    const pos = { x: 30, y: 30 };
    w.turn = turnFor(TIME.sunrise + 1);
    expect(cappedHeatAt(w, pos, 0.9)).toBe(heatAt(w, pos));
    w.turn = turnFor(2);
    expect(cappedHeatAt(w, pos, 0.5)).toBe(1);
  });
});
