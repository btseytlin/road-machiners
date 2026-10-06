import { describe, expect, it } from 'vitest';
import { classify, isSteadyCruise, recordTraffic, slowCause, summarize, type TrafficRun, type TrafficSample } from './traffic-speed';

const sample = (over: Partial<TrafficSample> = {}): TrafficSample => ({
  seed: 1, turn: 1, vehicle: 'n1', templateId: 'trader', chassisId: 'hauler', layer: 'far',
  startKph: 60, endKph: 60, drivenKph: 60, maxKph: 65, fuelShare: 0.8, lowFuel: false, mobility: 1, brokenWheels: 0,
  gunDrag: 1, loadFactor: 1, weatherSpeed: 1, onRoad: true, stranded: false, towing: false, towed: false, inCombat: false, goal: 'sell',
  ...over,
});

const run = (samples: TrafficSample[], over: Partial<TrafficRun> = {}): TrafficRun => ({
  seed: 1, layer: 'far', turns: 10, samples, npcTurns: 100, resupplyStarts: 0, maxDry: 0, collisions: 0, ...over,
});

describe('traffic speed classes', () => {
  it('sorts ordinary cars by condition and keeps heavy roles and towing rigs apart', () => {
    expect(classify(sample())).toBe('healthyOrdinary');
    expect(classify(sample({ lowFuel: true }))).toBe('lowFuelOrdinary');
    expect(classify(sample({ mobility: 0.5 }))).toBe('wornOrdinary');
    expect(classify(sample({ brokenWheels: 1 }))).toBe('wornOrdinary');
    expect(classify(sample({ templateId: 'noseArmy', chassisId: 'scout' }))).toBe('heavyRole');
    expect(classify(sample({ chassisId: 'wagon' }))).toBe('heavyRole');
    expect(classify(sample({ towing: true }))).toBe('towing');
    expect(classify(sample({ templateId: 'raider' }))).toBe('other');
  });

  it('counts only an even pace on open road, outside storms and fights, as steady cruise', () => {
    expect(isSteadyCruise(sample())).toBe(true);
    expect(isSteadyCruise(sample({ startKph: 40, endKph: 60 }))).toBe(false);
    expect(isSteadyCruise(sample({ weatherSpeed: 0.6 }))).toBe(false);
    expect(isSteadyCruise(sample({ inCombat: true }))).toBe(false);
    expect(isSteadyCruise(sample({ onRoad: false }))).toBe(false);
    expect(isSteadyCruise(sample({ drivenKph: 3, startKph: 3, endKph: 3 }))).toBe(false);
  });

  it('names why a moving truck drove under 45 km/h', () => {
    expect(slowCause(sample({ weatherSpeed: 0.6 }))).toBe('storm');
    expect(slowCause(sample({ maxKph: 40 }))).toBe('topSpeed');
    expect(slowCause(sample({ startKph: 10, endKph: 50 }))).toBe('accelerating');
    expect(slowCause(sample({ startKph: 50, endKph: 10 }))).toBe('slowing');
  });
});

describe('traffic speed summary', () => {
  it('gives percentiles, the share under 45 and the low-fuel share per class', () => {
    const speeds = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const healthy = speeds.map((kph) => sample({ startKph: kph, endKph: kph, drivenKph: kph }));
    const low = sample({ lowFuel: true, drivenKph: 30, startKph: 30, endKph: 30 });
    const s = summarize([run([...healthy, low], { collisions: 2 })]);
    expect(s.steady.healthyOrdinary.count).toBe(10);
    expect(s.steady.healthyOrdinary.median).toBe(80);
    expect(s.steady.healthyOrdinary.p10).toBe(40);
    expect(s.steady.healthyOrdinary.below45).toBeCloseTo(0.2);
    expect(s.steady.lowFuelOrdinary.median).toBe(30);
    expect(s.lowFuelShare).toBeCloseTo(1 / 11);
    expect(s.collisionsPer100NpcTurns).toBeCloseTo(2);
  });

  it('splits the slow healthy samples by cause', () => {
    const slow = [sample({ drivenKph: 20, startKph: 10, endKph: 30 }), sample({ drivenKph: 20, weatherSpeed: 0.6 })];
    const s = summarize([run([...slow, sample()])]);
    expect(s.healthySlowCauses.accelerating).toBeCloseTo(0.5);
    expect(s.healthySlowCauses.storm).toBeCloseTo(0.5);
  });

  it('refuses runs of different layers', () => {
    expect(() => summarize([run([]), run([], { layer: 'physics' })])).toThrow();
  });
});

describe('traffic speed run', () => {
  it('gives the same report for the same seed and turns', async () => {
    const a = summarize([await recordTraffic(1, 20, 'far')]);
    const b = summarize([await recordTraffic(1, 20, 'far')]);
    expect(a.cruising.healthyOrdinary.count).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 120_000);
});
