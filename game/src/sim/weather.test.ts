import { describe, expect, it } from 'vitest';
import { WEATHER } from '../data/weather';
import { TIME } from '../data/time';
import { hitOdds } from './combat';
import { heatAt } from './sun';
import { addVehicle, emptyWorld, settleStorms } from './testkit';
import { sightRadius } from './vision';
import { vehicleStats } from './stats';
import type { WeatherEvent, World } from './types';
import { advanceExposure, advanceWeather, makeWeather, stormDepth, stormShare, stormStrength, weatherAt, weatherOn } from './weather';

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
    settleStorms(w);
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
    advanceExposure(w);
    const speeds: number[] = [];
    const sights: number[] = [];
    for (let i = 0; i < FADE; i++) {
      speeds.push(vehicleStats(w, me).maxSpeed);
      sights.push(sightRadius(w, me));
      nextTurn(w, s);
      advanceExposure(w);
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

describe('storm exposure', () => {
  const STEP = 1 / WEATHER.sim.stormExposeTurns;
  const full = WEATHER.sim.effects.storm;

  // A still storm at full strength over pos, with plenty of turns left.
  function fullStorm(w: World, id: string, pos: { x: number; y: number }, radius = 60): Storm {
    const s = stormOver(w, id, pos, radius, 400);
    s.born = w.turn - FADE;
    return s;
  }

  // One turn as the pipeline plays it: the turn advances, the storms count down, then exposure steps.
  function turn(w: World): void {
    w.turn++;
    for (const e of w.weather) e.turnsLeft--;
    w.weather = w.weather.filter((e) => e.turnsLeft > 0);
    advanceExposure(w);
  }

  it('a truck parked in a full storm feels it build 0.1 a turn, its speed and sight with it, up to the settled effect', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    const clearSpeed = vehicleStats(w, me).maxSpeed;
    const clearSight = sightRadius(w, me);
    fullStorm(w, 'w1', me.pos);
    expect(vehicleStats(w, me).maxSpeed).toBe(clearSpeed);
    const shares: number[] = [];
    const speeds: number[] = [];
    for (let i = 0; i < WEATHER.sim.stormExposeTurns; i++) {
      turn(w);
      shares.push(me.stormExposure.w1);
      speeds.push(vehicleStats(w, me).maxSpeed);
    }
    shares.forEach((k, i) => expect(k).toBeCloseTo((i + 1) * STEP));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1]);
    expect(me.stormExposure.w1).toBe(1);
    expect(weatherOn(w, me)).toEqual(weatherAt(w, me.pos));
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(clearSpeed * full.speed);
    expect(sightRadius(w, me)).toBeCloseTo(clearSight * full.sight);
  });

  it('a truck that leaves a full storm eases off 0.1 a turn and keeps no share once out', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    const s = fullStorm(w, 'w1', me.pos);
    settleStorms(w);
    me.pos = { x: 300, y: 100 };
    const shares: number[] = [];
    for (let i = 0; i < WEATHER.sim.stormExposeTurns; i++) {
      turn(w);
      shares.push(stormShare(me));
    }
    expect(stormStrength(w, s)).toBe(1);
    shares.forEach((k, i) => expect(k).toBeCloseTo(1 - (i + 1) * STEP));
    expect(me.stormExposure).toEqual({});
    expect(weatherOn(w, me)).toEqual({ sight: 1, spread: 0, speed: 1, wear: 1, heat: 1 });
  });

  it('a truck dithering across the edge moves at most one step a turn and stays in (0, 1]', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    fullStorm(w, 'w1', { x: 100, y: 100 }, 30);
    let last = 0;
    for (let i = 0; i < 20; i++) {
      me.pos = i % 2 === 0 ? { x: 100, y: 100 } : { x: 200, y: 100 };
      turn(w);
      const k = stormShare(me);
      expect(Math.abs(k - last)).toBeLessThanOrEqual(STEP + 1e-9);
      if (me.stormExposure.w1 !== undefined) {
        expect(me.stormExposure.w1).toBeGreaterThan(0);
        expect(me.stormExposure.w1).toBeLessThanOrEqual(1);
      }
      last = k;
    }
  });

  it('a truck parked in a new storm follows its strength on every turn of its life', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    const s = stormOver(w, 'w1', me.pos, 60, 70);
    advanceExposure(w);
    while (s.turnsLeft > 0) {
      expect(me.stormExposure.w1).toBeCloseTo(stormStrength(w, s));
      turn(w);
    }
    expect(me.stormExposure).toEqual({});
  });

  it('a storm that ends with a truck in it leaves at most 1/F on its last turn and no share after', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    const s = fullStorm(w, 'w1', me.pos);
    s.turnsLeft = 2 * FADE;
    settleStorms(w);
    while (s.turnsLeft > 1) turn(w);
    expect(me.stormExposure.w1).toBeLessThanOrEqual(1 / FADE + 1e-9);
    w.weather[0].turnsLeft = 1;
    advanceWeather(w);
    for (const v of w.vehicles) expect(v.stormExposure.w1).toBeUndefined();
  });

  it('one storm ending leaves the share and effect of an overlapping storm', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    fullStorm(w, 'w1', me.pos);
    const ending = fullStorm(w, 'w2', me.pos);
    ending.turnsLeft = 2;
    settleStorms(w);
    expect(weatherOn(w, me).speed).toBeCloseTo(full.speed * (1 + (full.speed - 1) * (2 / FADE)));
    turn(w);
    turn(w);
    expect(me.stormExposure).toEqual({ w1: 1 });
    expect(weatherOn(w, me).speed).toBeCloseTo(full.speed);
  });

  it('throws on a share outside (0, 1]', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    for (const bad of [0, 1.5, Number.NaN]) {
      me.stormExposure = { w1: bad };
      expect(() => weatherOn(w, me)).toThrow();
    }
  });

  it('an NPC truck gets the same shares as the player truck in the same spot', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { ...me.pos });
    fullStorm(w, 'w1', me.pos);
    for (let i = 0; i < 4; i++) turn(w);
    expect(npc.stormExposure).toEqual(me.stormExposure);
    expect(weatherOn(w, npc)).toEqual(weatherOn(w, me));
  });

  it('stormDepth is the edge falloff times the strength, 0 outside', () => {
    const w = emptyWorld();
    const s = stormOver(w, 'w1', { x: 100, y: 100 }, 60, 400);
    expect(stormDepth(w, s, { x: 200, y: 100 })).toBe(0);
    expect(stormDepth(w, s, { x: 100 + 60 - WEATHER.sim.stormEdge / 2, y: 100 })).toBeCloseTo(0.5 / FADE);
  });

  it('a truck can shake off a storm at least as fast as a storm clears', () => {
    expect(WEATHER.sim.stormExposeTurns).toBeLessThanOrEqual(WEATHER.sim.stormFadeTurns);
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
