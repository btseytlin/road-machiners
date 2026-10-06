import { describe, expect, it } from 'vitest';
import { WEATHER } from '../data/weather';
import { TIME } from '../data/time';
import { hitOdds } from './combat';
import { heatAt } from './sun';
import { addVehicle, emptyWorld } from './testkit';
import { sightRadius } from './vision';
import { vehicleStats } from './stats';
import type { WeatherEvent, World } from './types';
import { advanceWeather, makeWeather, stormStrength, weatherAt } from './weather';

const FADE = WEATHER.sim.stormFadeTurns;
type Storm = Extract<WeatherEvent, { kind: 'storm' }>;

// A still storm of `turns` turns spawned this turn over pos, as advanceWeather would leave it.
function stormOver(w: World, id: string, pos: { x: number; y: number }, radius: number, turns: number): Storm {
  const s: Storm = { id, kind: 'storm', pos: { ...pos }, radius, vel: { x: 0, y: 0 }, turnsLeft: turns, born: w.turn };
  w.weather.push(s);
  return s;
}

// Plays one turn of a storm's life the way the turn pipeline does: the turn advances, then the weather.
function nextTurn(w: World, s: Storm): void {
  w.turn++;
  s.turnsLeft--;
}

function turnFor(hour: number): number {
  return 1 + ((hour - TIME.startHour) * TIME.turnsPerDay) / 24;
}

describe('advanceWeather', () => {
  it('moves an active storm and counts down', () => {
    const w = emptyWorld();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 10, y: 10 }, radius: 5, vel: { x: 1, y: 0.5 }, turnsLeft: 5, born: w.turn }];
    advanceWeather(w);
    const s = w.weather.find((e) => e.id === 'w1');
    expect(s).toBeDefined();
    expect(s!.kind === 'storm' && s!.pos.x).toBeCloseTo(11);
    expect(s!.kind === 'storm' && s!.pos.y).toBeCloseTo(10.5);
    expect(s!.turnsLeft).toBe(4);
  });

  it('ends an event whose turns run out and logs it', () => {
    const w = emptyWorld();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 10, y: 10 }, radius: 5, vel: { x: 1, y: 0 }, turnsLeft: 1, born: w.turn }];
    advanceWeather(w);
    // A new event may start the same turn, so check for this one.
    expect(w.weather.some((e) => e.id === 'w1')).toBe(false);
    expect(w.events.some((e) => e.t === 'weather' && e.outcome === 'ended' && e.event.id === 'w1')).toBe(true);
  });

  it('runs several storms at once, never above the limit', () => {
    const w = emptyWorld();
    let most = 0;
    for (let i = 0; i < 20000; i++) {
      advanceWeather(w);
      most = Math.max(most, w.weather.filter((e) => e.kind === 'storm').length);
    }
    expect(most).toBe(WEATHER.sim.maxActive.storm);
  });

  it('never has a heat wave and overcast at once', () => {
    const w = emptyWorld();
    for (let i = 0; i < 20000; i++) {
      advanceWeather(w);
      const kinds = w.weather.map((e) => e.kind);
      expect(kinds.includes('heatwave') && kinds.includes('overcast')).toBe(false);
    }
    expect(w.events.length).toBeGreaterThan(0);
  });

  it('replays the same weather for the same seed and turn count', () => {
    const w1 = emptyWorld();
    const w2 = emptyWorld();
    for (let i = 0; i < 300; i++) advanceWeather(w1);
    for (let i = 0; i < 300; i++) advanceWeather(w2);
    expect(w1.weather).toEqual(w2.weather);
    expect(w1.rngState).toBe(w2.rngState);
  });
});

describe('weatherAt', () => {
  it('shrinks sight and speed, adds spread and raises wear inside a storm, and leaves the rest of the map clear', () => {
    const w = emptyWorld();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 30, y: 30 }, radius: 5, vel: { x: 0, y: 0 }, turnsLeft: 100, born: w.turn - 100 }];
    const inside = weatherAt(w, { x: 30, y: 30 });
    expect(inside.sight).toBeLessThan(1);
    expect(inside.spread).toBeGreaterThan(0);
    expect(inside.speed).toBeLessThan(1);
    expect(inside.wear).toBeGreaterThan(1);
    const outside = weatherAt(w, { x: 80, y: 80 });
    expect(outside).toEqual({ sight: 1, spread: 0, speed: 1, wear: 1, heat: 1 });
  });

  it('fades the storm effects in from its edge to full strength over stormEdge tiles', () => {
    const w = emptyWorld();
    const radius = 60;
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 100, y: 100 }, radius, vel: { x: 0, y: 0 }, turnsLeft: 100, born: w.turn - 100 }];
    const full = WEATHER.sim.effects.storm;
    const at = (d: number) => weatherAt(w, { x: 100 + d, y: 100 });
    expect(at(radius + 1).speed).toBe(1);
    expect(at(radius).speed).toBe(1);
    expect(at(radius - WEATHER.sim.stormEdge / 2).speed).toBeCloseTo((1 + full.speed) / 2);
    expect(at(radius - WEATHER.sim.stormEdge).speed).toBeCloseTo(full.speed);
    expect(at(0).speed).toBeCloseTo(full.speed);
  });

  it('a truck in a storm sees less and scatters more', () => {
    const w = emptyWorld();
    const before = sightRadius(w, w.vehicles[0]);
    w.weather = [{ id: 'w1', kind: 'storm', pos: { ...w.vehicles[0].pos }, radius: 5, vel: { x: 0, y: 0 }, turnsLeft: 100, born: w.turn - 100 }];
    expect(sightRadius(w, w.vehicles[0])).toBeLessThan(before);
    const me = w.vehicles[0];
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: me.pos.x + 3, y: me.pos.y }, Math.PI);
    const mg = vehicleStats(w, me).weapons[0];
    const odds = hitOdds(w, me, mg, buggy, 'body');
    expect(odds.causes.weather).toBeGreaterThan(0);
  });
});

describe('stormStrength', () => {
  it('builds 1/F a turn from the spawn turn, holds at 1 and clears to 1/F on the last turn', () => {
    const w = emptyWorld();
    const s = stormOver(w, 'w1', { x: 30, y: 30 }, 60, 3 * FADE);
    const seen: number[] = [];
    while (s.turnsLeft > 0) {
      seen.push(stormStrength(w, s));
      nextTurn(w, s);
    }
    expect(seen).toHaveLength(3 * FADE);
    expect(seen[0]).toBeCloseTo(1 / FADE);
    expect(seen[FADE - 1]).toBe(1);
    expect(seen[2 * FADE]).toBe(1);
    expect(seen[3 * FADE - 1]).toBeCloseTo(1 / FADE);
    for (let i = 1; i < FADE; i++) expect(seen[i] - seen[i - 1]).toBeCloseTo(1 / FADE);
    for (let i = 2 * FADE + 1; i < 3 * FADE; i++) expect(seen[i - 1] - seen[i]).toBeCloseTo(1 / FADE);
  });

  it('peaks below full strength in a storm shorter than two fades', () => {
    const w = emptyWorld();
    const s = stormOver(w, 'w1', { x: 30, y: 30 }, 60, 10);
    let peak = 0;
    while (s.turnsLeft > 0) {
      peak = Math.max(peak, stormStrength(w, s));
      nextTurn(w, s);
    }
    expect(peak).toBeCloseTo(5 / FADE);
  });

  it('throws for a storm born in the future or one that has ended', () => {
    const w = emptyWorld();
    const s = stormOver(w, 'w1', { x: 30, y: 30 }, 60, 10);
    expect(() => stormStrength(w, { ...s, born: w.turn + 1 })).toThrow();
    expect(() => stormStrength(w, { ...s, turnsLeft: 0 })).toThrow();
  });

  it('a spawned storm is born on the current turn', () => {
    const w = emptyWorld();
    w.turn = 77;
    expect(makeWeather(w, 'storm')).toMatchObject({ born: 77 });
  });
});

describe('weatherAt over a storm\'s life', () => {
  it('scales every storm effect by the strength, and equals the full effect at strength 1', () => {
    const w = emptyWorld();
    const s = stormOver(w, 'w1', { x: 100, y: 100 }, 60, 3 * FADE);
    const full = WEATHER.sim.effects.storm;
    const lerp = (to: number, k: number) => 1 + (to - 1) * k;
    for (let i = 0; i < 9; i++) nextTurn(w, s);
    const k = stormStrength(w, s);
    expect(k).toBeCloseTo(10 / FADE);
    const mid = weatherAt(w, s.pos);
    expect(mid.sight).toBeCloseTo(lerp(full.sight, k));
    expect(mid.speed).toBeCloseTo(lerp(full.speed, k));
    expect(mid.wear).toBeCloseTo(lerp(full.wear, k));
    expect(mid.spread).toBeCloseTo(full.spread * k);
    // At half the edge depth the time strength multiplies the edge falloff.
    const edge = weatherAt(w, { x: 100 + 60 - WEATHER.sim.stormEdge / 2, y: 100 });
    expect(edge.speed).toBeCloseTo(lerp(full.speed, k / 2));
    while (stormStrength(w, s) < 1) nextTurn(w, s);
    expect(weatherAt(w, s.pos)).toEqual({ sight: full.sight, spread: full.spread, speed: full.speed, wear: full.wear, heat: 1 });
  });

  it('one storm clearing leaves an overlapping storm\'s share unchanged', () => {
    const w = emptyWorld();
    const pos = { x: 100, y: 100 };
    const strong = stormOver(w, 'w1', pos, 60, 200);
    strong.born = w.turn - 100;
    const ending = stormOver(w, 'w2', pos, 60, 1);
    ending.born = w.turn - 100;
    const both = weatherAt(w, pos);
    const full = WEATHER.sim.effects.storm;
    const tail = 1 + (full.speed - 1) / FADE;
    expect(both.speed).toBeCloseTo(full.speed * tail);
    w.weather = w.weather.filter((e) => e.id !== 'w2');
    expect(weatherAt(w, pos).speed).toBeCloseTo(full.speed);
  });

  it('a parked truck loses speed and sight step by step as a storm builds over it', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const clearSpeed = vehicleStats(w, me).maxSpeed;
    const clearSight = sightRadius(w, me);
    const s = stormOver(w, 'w1', me.pos, 60, 3 * FADE);
    const speeds: number[] = [];
    const sights: number[] = [];
    for (let i = 0; i < FADE; i++) {
      speeds.push(vehicleStats(w, me).maxSpeed);
      sights.push(sightRadius(w, me));
      nextTurn(w, s);
    }
    expect(speeds[0]).toBeLessThan(clearSpeed);
    expect(speeds[0]).toBeGreaterThan(clearSpeed * WEATHER.sim.effects.storm.speed);
    expect(sights[0]).toBeLessThan(clearSight);
    for (let i = 1; i < FADE; i++) {
      expect(speeds[i]).toBeLessThan(speeds[i - 1]);
      expect(sights[i]).toBeLessThanOrEqual(sights[i - 1]);
    }
    expect(speeds[FADE - 1]).toBeCloseTo(clearSpeed * WEATHER.sim.effects.storm.speed);
  });
});

describe('heat and weather', () => {
  it('a heat wave raises heat', () => {
    const w = emptyWorld();
    w.turn = turnFor((TIME.sunrise + TIME.sunset) / 2);
    const pos = w.vehicles[0].pos;
    const before = heatAt(w, pos);
    w.weather = [{ id: 'h1', kind: 'heatwave', turnsLeft: 10 }];
    expect(heatAt(w, pos)).toBeGreaterThan(before);
  });

  it('overcast removes sun heat', () => {
    const w = emptyWorld();
    w.turn = turnFor((TIME.sunrise + TIME.sunset) / 2);
    const pos = w.vehicles[0].pos;
    expect(heatAt(w, pos)).toBeGreaterThan(1);
    w.weather = [{ id: 'o1', kind: 'overcast', turnsLeft: 10 }];
    expect(heatAt(w, pos)).toBe(1);
  });
});
