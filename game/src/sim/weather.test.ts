import { describe, expect, it } from 'vitest';
import { WEATHER } from '../data/weather';
import { TIME } from '../data/time';
import { hitOdds } from './combat';
import { heatAt } from './sun';
import { addVehicle, emptyWorld } from './testkit';
import { sightRadius } from './vision';
import { vehicleStats } from './stats';
import { advanceWeather, weatherAt } from './weather';

function turnFor(hour: number): number {
  return 1 + ((hour - TIME.startHour) * TIME.turnsPerDay) / 24;
}

describe('advanceWeather', () => {
  it('moves an active storm and counts down', () => {
    const w = emptyWorld();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 10, y: 10 }, radius: 5, vel: { x: 1, y: 0.5 }, turnsLeft: 5 }];
    advanceWeather(w);
    const s = w.weather.find((e) => e.id === 'w1');
    expect(s).toBeDefined();
    expect(s!.kind === 'storm' && s!.pos.x).toBeCloseTo(11);
    expect(s!.kind === 'storm' && s!.pos.y).toBeCloseTo(10.5);
    expect(s!.turnsLeft).toBe(4);
  });

  it('ends an event whose turns run out and logs it', () => {
    const w = emptyWorld();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 10, y: 10 }, radius: 5, vel: { x: 1, y: 0 }, turnsLeft: 1 }];
    advanceWeather(w);
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
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 30, y: 30 }, radius: 5, vel: { x: 0, y: 0 }, turnsLeft: 10 }];
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
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 100, y: 100 }, radius, vel: { x: 0, y: 0 }, turnsLeft: 10 }];
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
    w.weather = [{ id: 'w1', kind: 'storm', pos: { ...w.vehicles[0].pos }, radius: 5, vel: { x: 0, y: 0 }, turnsLeft: 10 }];
    expect(sightRadius(w, w.vehicles[0])).toBeLessThan(before);
    const me = w.vehicles[0];
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: me.pos.x + 3, y: me.pos.y }, Math.PI);
    const mg = vehicleStats(w, me).weapons[0];
    const odds = hitOdds(w, me, mg, buggy, 'body');
    expect(odds.causes.weather).toBeGreaterThan(0);
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
