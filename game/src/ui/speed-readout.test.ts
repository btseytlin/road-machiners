import { describe, expect, it } from 'vitest';
import { makePart } from '../sim/factory';
import { corePart, coreParts, mountedParts } from '../sim/grid';
import { mountPart } from '../sim/inventory';
import { RULES } from '../data/rules';
import { lowFuelSpeed } from '../sim/far';
import { fuelCap, gunDraw, maxSpeedSteps, workingEngineCapacity } from '../sim/stats';
import { addVehicle, emptyWorld } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { getHudReadout, powerChip, speedNotes, speedRows, speedTip, type TipLine } from './hud-readout';
import { kph } from './units';

function playerWith(tweak: (w: World, v: Vehicle) => void = () => undefined): { w: World; v: Vehicle } {
  const w = emptyWorld();
  const v = w.vehicles[0];
  v.items = v.items.filter((it) => it.kind !== 'part' || !mountedParts(v, 'weapon').includes(it.part));
  tweak(w, v);
  return { w, v };
}

const CASES: Record<string, (w: World, v: Vehicle) => void> = {
  plain: () => undefined,
  guns: (w, v) => void mountPart(w, v, makePart(w, 'mg', 0)),
  wheels: (_w, v) => coreParts(v, 'wheel').slice(0, 2).forEach((p) => (p.hp = 0)),
  overdrive: (w) => void (w.player.overdrive = true),
  transmission: (_w, v) => void (corePart(v, 'transmission').hp = 0),
  brokenEngine: (_w, v) => void (mountedParts(v, 'engine')[0].hp = 0),
  stalled: (w, v) => void (v.stalledUntil = w.turn + 3),
  storm: (w, v) => {
    w.weather = [{ id: 'w1', kind: 'storm', pos: { ...v.pos }, radius: 20, vel: { x: 0, y: 0 }, turnsLeft: 9, born: w.turn }];
    v.stormExposure = { w1: 1 };
  },
};

const SHORT_VALUE = /^([+−]\d+ km\/h|\d+ km\/h|crawl( \d+ km\/h)?|max \d+ km\/h)$/;

function expectShort(lines: TipLine[], name: string): void {
  expect(lines[0], name).toMatchObject({ label: 'Base', tone: 'base' });
  for (const line of lines) {
    expect(line.value, name).toMatch(SHORT_VALUE);
    expect(`${line.label}: ${line.value}`.length, name).toBeLessThanOrEqual(40);
    expect(line.label, name).not.toMatch(/Chassis|Guns draw/);
  }
}

describe('max speed tooltip', () => {
  it('adds the row deltas to the HUD number in every driving case', () => {
    for (const [name, tweak] of Object.entries(CASES)) {
      const { w, v } = playerWith(tweak);
      const steps = maxSpeedSteps(w, v);
      if (steps.some((s) => s.kind === 'limp')) continue;
      const rows = speedRows('Clear', steps);
      const total = rows.reduce((sum, r) => sum + r.delta, kph(steps[0].speed));
      expect(String(total), name).toBe(getHudReadout(w).maxSpeed);
      expect(rows.every((r) => r.delta !== 0), name).toBe(true);
    }
  });

  it('shows only short signed lines, never the table or the paragraph', () => {
    const fuels: [string, (w: World) => void][] = [['empty', (w) => void (w.player.fuel = 0)], ['low', (w) => void (w.player.fuel = 1)]];
    for (const [name, tweak] of Object.entries(CASES)) {
      const { w } = playerWith(tweak);
      expectShort(getHudReadout(w).maxSpeedTip, name);
    }
    for (const [name, fuel] of fuels) {
      const { w } = playerWith(CASES.guns);
      fuel(w);
      expectShort(getHudReadout(w).maxSpeedTip, name);
    }
  });

  it('words wheels and guns as short lines', () => {
    const { w } = playerWith((world, truck) => {
      CASES.wheels(world, truck);
      CASES.guns(world, truck);
    });
    const tip = getHudReadout(w).maxSpeedTip;
    expect(tip).toContainEqual({ label: '2 broken wheels', value: expect.stringMatching(/^−\d+ km\/h$/), tone: 'bad' });
    expect(tip).toContainEqual({ label: 'Guns power', value: expect.stringMatching(/^−\d+ km\/h$/), tone: 'bad' });
    const stalled = playerWith(CASES.stalled);
    expect(getHudReadout(stalled.w).maxSpeedTip).toContainEqual({ label: 'Engine stalled', value: `crawl ${getHudReadout(stalled.w).maxSpeed} km/h`, tone: 'plain' });
  });

  it('notes an empty and a low tank apart from the number', () => {
    const empty = playerWith();
    empty.w.player.fuel = 0;
    expect(getHudReadout(empty.w).maxSpeedTip).toContainEqual({ label: 'Empty tank', value: 'crawl', tone: 'bad' });
    const low = playerWith();
    low.w.player.fuel = fuelCap(low.v) * RULES.lowFuelThreshold * 0.5;
    const steps = maxSpeedSteps(low.w, low.v);
    expect(getHudReadout(low.w).maxSpeedTip).toContainEqual({ label: 'Low fuel', value: `max ${kph(lowFuelSpeed(steps[steps.length - 1].speed))} km/h`, tone: 'bad' });
  });

  it('starts with the base and adds one row per cause, so the rows add up to the HUD number', () => {
    expect(speedTip(100, [], [])).toEqual([{ label: 'Base', value: '100 km/h', tone: 'base' }]);
    for (const [name, tweak] of Object.entries(CASES)) {
      const { w, v } = playerWith(tweak);
      const steps = maxSpeedSteps(w, v);
      if (steps.some((s) => s.kind === 'limp')) continue;
      const tip = getHudReadout(w).maxSpeedTip;
      expect(tip[0].value, name).toBe(`${kph(steps[0].speed)} km/h`);
      expect(tip.length, name).toBe(1 + speedRows('Clear', steps).length + speedNotes(w, v, steps).length);
    }
  });

  it('keeps no table in the readout', () => {
    const { w, v } = playerWith(CASES.guns);
    const readout = getHudReadout(w);
    expect(readout).not.toHaveProperty('maxSpeedRows');
    expect(readout).not.toHaveProperty('maxSpeedNotes');
    for (const row of speedRows('Clear', maxSpeedSteps(w, v))) expect(Object.keys(row).sort()).toEqual(['delta', 'label', 'value']);
  });
});

describe('power chip', () => {
  const chip = (tweak: (w: World, v: Vehicle) => void) => {
    const { w, v } = playerWith(tweak);
    return powerChip(maxSpeedSteps(w, v), v);
  };

  it('shows no speed cost without guns', () => {
    expect(chip(CASES.plain).text).toMatch(/^0 \/ \d+(\.\d)? power, no speed cost$/);
  });

  it('shows draw, capacity and the speed cost with guns', () => {
    const c = chip((w, v) => {
      mountPart(w, v, makePart(w, 'mg', 0));
      mountPart(w, v, makePart(w, 'mg', 0));
    });
    expect(c.text).toMatch(/power, −\d+% speed$/);
    expect(c.over).toBe(false);
    expect(c.detail).toContain('Cost: −');
  });

  it('flags an overload with the excess', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    for (let i = 0; i < 16; i++) mountPart(w, v, makePart(w, 'mg', 0));
    const c = powerChip(maxSpeedSteps(w, v), v);
    expect(gunDraw(v)).toBeGreaterThan(workingEngineCapacity(v)!);
    expect(c.over).toBe(true);
    expect(c.text).toContain('over by');
  });

  it('counts no draw from a broken gun', () => {
    const { w, v } = playerWith((world, truck) => void mountPart(world, truck, makePart(world, 'mg', 0)));
    const working = powerChip(maxSpeedSteps(w, v), v).text;
    mountedParts(v, 'weapon')[0].hp = 0;
    expect(powerChip(maxSpeedSteps(w, v), v).text).not.toBe(working);
    expect(powerChip(maxSpeedSteps(w, v), v).text).toMatch(/^0 \//);
  });

  it('names a broken engine instead of showing power', () => {
    const c = chip(CASES.brokenEngine);
    expect(c.text).toBe('No working engine');
    expect(c.over).toBe(false);
  });

  it('says a stalled engine costs no speed yet', () => {
    expect(chip(CASES.stalled).text).toContain('while stalled');
  });
});
