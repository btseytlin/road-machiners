import { describe, expect, it } from 'vitest';
import { makePart } from '../sim/factory';
import { corePart, coreParts, mountedParts } from '../sim/grid';
import { mountPart } from '../sim/inventory';
import { gunDraw, maxSpeedSteps, workingEngineCapacity } from '../sim/stats';
import { addVehicle, emptyWorld } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { getHudReadout, powerChip, speedNotes, speedRows } from './hud-readout';
import { kph } from './units';
import { vehicleStats } from '../sim/stats';
import { t, type Msg } from '../text/msg';
import { resolve } from '../text/resolve';

const en = (msg: Msg): string => resolve(msg, 'en');
const CLEAR = t('weather.clear');

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

describe('max speed breakdown', () => {
  it('ends in the number the HUD shows, with chained running speeds, in every case', () => {
    for (const [name, tweak] of Object.entries(CASES)) {
      const { w, v } = playerWith(tweak);
      const rows = getHudReadout(w).maxSpeedRows;
      const last = rows[rows.length - 1];
      expect(last.kph, name).toBe(getHudReadout(w).maxSpeed);
      expect(last.kph, name).toBe(kph(vehicleStats(w, v).maxSpeed));
      expect(rows.filter((r) => r.total), name).toHaveLength(1);
    }
  });

  it('starts from the chassis base and shows engine effects as km/h', () => {
    const { w, v } = playerWith();
    const rows = speedRows(CLEAR, maxSpeedSteps(w, v));
    expect([en(rows[0].label), en(rows[0].effect)]).toEqual(['Chassis', 'base']);
    expect(en(rows[1].effect)).toMatch(/^[+−]\d+ km\/h$/);
  });

  it('words each cause with its numbers', () => {
    const { w, v } = playerWith((world, truck) => {
      CASES.wheels(world, truck);
      CASES.guns(world, truck);
    });
    const labels = speedRows(CLEAR, maxSpeedSteps(w, v)).map((r) => en(r.label));
    expect(labels.some((l) => /^Load [\d,]+ kg \/ [\d,]+ kg$/.test(l))).toBe(true);
    expect(labels.some((l) => /^Gun power [\d.]+ \/ [\d.]+$/.test(l))).toBe(true);
    expect(labels).toContain('2 broken wheels');
    const stalled = playerWith(CASES.stalled);
    expect(speedRows(CLEAR, maxSpeedSteps(stalled.w, stalled.v)).map((r) => en(r.label))).toContain('Engine stalled: pushed at crawl speed');
  });

  it('keeps the limp cases consistent with the HUD number', () => {
    for (const name of ['brokenEngine', 'stalled', 'transmission']) {
      const { w, v } = playerWith(CASES[name]);
      const rows = speedRows(CLEAR, maxSpeedSteps(w, v));
      expect(rows[rows.length - 1].kph, name).toBe(getHudReadout(w).maxSpeed);
    }
  });

  it('notes low and empty fuel apart from the number', () => {
    const { w, v } = playerWith();
    w.player.fuel = 0;
    expect(speedNotes(w, v, maxSpeedSteps(w, v)).map(en).join(' ')).toContain('Empty tank');
  });

  it('explains gun power without a cost per gun', () => {
    const { w, v } = playerWith(CASES.guns);
    expect(speedNotes(w, v, maxSpeedSteps(w, v)).map(en).join(' ')).toContain('one total, not a cost per gun');
  });
});

describe('power chip', () => {
  const words = (c: ReturnType<typeof powerChip>) => ({ ...c, text: en(c.text), detail: en(c.detail) });
  const chip = (tweak: (w: World, v: Vehicle) => void) => {
    const { w, v } = playerWith(tweak);
    return words(powerChip(maxSpeedSteps(w, v), v));
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
    const c = words(powerChip(maxSpeedSteps(w, v), v));
    expect(gunDraw(v)).toBeGreaterThan(workingEngineCapacity(v)!);
    expect(c.over).toBe(true);
    expect(c.text).toContain('over by');
  });

  it('counts no draw from a broken gun', () => {
    const { w, v } = playerWith((world, truck) => void mountPart(world, truck, makePart(world, 'mg', 0)));
    const working = en(powerChip(maxSpeedSteps(w, v), v).text);
    mountedParts(v, 'weapon')[0].hp = 0;
    expect(en(powerChip(maxSpeedSteps(w, v), v).text)).not.toBe(working);
    expect(en(powerChip(maxSpeedSteps(w, v), v).text)).toMatch(/^0 \//);
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
