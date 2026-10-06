import { describe, expect, it } from 'vitest';
import { damageScale, defaultSetup, fuelUseScale, parseSetup, repairSetup, setupLabel, supplyUseScale } from './settings';
import { emptyWorld } from './testkit';

const roaming = (settings: Record<string, unknown>) => ({ mode: 'roaming', settings: { damage: 1, fuelUse: 1, supplyUse: 1, ...settings } });

describe('parseSetup', () => {
  it('keeps a setup on the grid inside its bounds', () => {
    const setup = parseSetup(roaming({ damage: 1.5, fuelUse: 2, supplyUse: 0.5 }));

    expect(setup).toEqual({ mode: 'roaming', settings: { damage: 1.5, fuelUse: 2, supplyUse: 0.5 } });
  });

  it('accepts the default Roaming setup at 100% for every setting', () => {
    expect(parseSetup(defaultSetup('roaming'))).toEqual({ mode: 'roaming', settings: { damage: 1, fuelUse: 1, supplyUse: 1 } });
  });

  it.each([
    ['below the minimum', { damage: 0.25 }, /damage.*0\.25/],
    ['above the maximum', { fuelUse: 2.25 }, /fuelUse.*2\.25/],
    ['off the step grid', { supplyUse: 1.1 }, /supplyUse.*1\.1/],
    ['NaN', { damage: NaN }, /damage/],
    ['Infinity', { damage: Infinity }, /damage/],
    ['negative', { fuelUse: -1 }, /fuelUse/],
    ['zero', { fuelUse: 0 }, /fuelUse/],
    ['a string', { damage: '1.5' }, /damage/],
    ['missing', { damage: undefined }, /damage/],
    ['an unknown key', { speed: 1 }, /speed/],
  ])('throws on a setting %s', (_, settings, message) => {
    expect(() => parseSetup(roaming(settings))).toThrow(message);
  });

  it('throws on an unknown or missing mode', () => {
    expect(() => parseSetup({ ...roaming({}), mode: 'campaign' })).toThrow(/mode.*campaign/);
    expect(() => parseSetup({ settings: roaming({}).settings })).toThrow(/mode/);
  });

  it('throws on a setup that is not an object, or settings that are not', () => {
    expect(() => parseSetup(null)).toThrow(/setup/);
    expect(() => parseSetup({ mode: 'roaming', settings: 2 })).toThrow(/settings/);
  });

  it('throws on an unknown setup field', () => {
    expect(() => parseSetup({ ...roaming({}), seed: 4 })).toThrow(/seed/);
  });

  it('returns a copy, so a later edit to the input does not reach the world', () => {
    const raw = roaming({ damage: 1.5 });
    const setup = parseSetup(raw);
    raw.settings.damage = 2;

    expect(setup.settings.damage).toBe(1.5);
  });
});

describe('repairSetup', () => {
  it('keeps a valid setup and resets nothing', () => {
    expect(repairSetup(roaming({ damage: 2 }))).toEqual({ setup: parseSetup(roaming({ damage: 2 })), reset: [] });
  });

  it('puts the default in place of each bad setting and keeps the good ones', () => {
    const { setup, reset } = repairSetup(roaming({ damage: NaN, fuelUse: 1.75, supplyUse: 10 }));

    expect(setup.settings).toEqual({ damage: 1, fuelUse: 1.75, supplyUse: 1 });
    expect(reset).toEqual(['damage', 'supplyUse']);
  });

  it('resets a missing setting and drops an unknown key', () => {
    const { setup, reset } = repairSetup({ mode: 'roaming', settings: { damage: 1.5, fuelUse: 1, speed: 3 } });

    expect(setup.settings).toEqual({ damage: 1.5, fuelUse: 1, supplyUse: 1 });
    expect(reset).toEqual(['supplyUse']);
  });

  it('uses default Roaming and resets every setting when the mode is unknown or the setup is missing', () => {
    for (const raw of [{ ...roaming({ damage: 2 }), mode: 'campaign' }, undefined, 'roaming', { mode: 'roaming' }]) {
      const { setup, reset } = repairSetup(raw);

      expect(setup).toEqual(defaultSetup('roaming'));
      expect(reset).toEqual(['damage', 'fuelUse', 'supplyUse']);
    }
  });
});

describe('scale queries', () => {
  it('read the world setup', () => {
    const w = emptyWorld();
    w.setup = parseSetup(roaming({ damage: 1.5, fuelUse: 2, supplyUse: 0.5 }));

    expect([damageScale(w), fuelUseScale(w), supplyUseScale(w)]).toEqual([1.5, 2, 0.5]);
  });

  it('are 1 in a default world', () => {
    const w = emptyWorld();

    expect([damageScale(w), fuelUseScale(w), supplyUseScale(w)]).toEqual([1, 1, 1]);
  });
});

describe('setupLabel', () => {
  it('names the mode and every setting as a percentage', () => {
    expect(setupLabel(parseSetup(roaming({ damage: 1.5 })))).toBe('Roaming · Damage 150% · Fuel use 100% · Supply use 100%');
  });
});
