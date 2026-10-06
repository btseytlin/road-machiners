import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { makePart } from '../sim/factory';
import { corePart, coreParts, mountedParts } from '../sim/grid';
import { mountPart } from '../sim/inventory';
import { gunDraw, maxSpeedSteps, workingEngineCapacity } from '../sim/stats';
import { addVehicle, emptyWorld } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { getHudReadout, powerChip, speedNotes, speedRows } from './hud-readout';
import { kph } from './units';
import { vehicleStats } from '../sim/stats';

// The test world's player truck, with the given change applied.
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
  storm: (w, v) => void (w.weather = [{ id: 'w1', kind: 'storm', pos: { ...v.pos }, radius: 20, vel: { x: 0, y: 0 }, turnsLeft: 9 }]),
};

describe('max speed breakdown', () => {
  it('ends on the number the HUD shows, and the rows chain', () => {
    for (const [name, tweak] of Object.entries(CASES)) {
      const { w, v } = playerWith(tweak);
      const rows = getHudReadout(w).maxSpeedRows;
      expect(String(rows[rows.length - 1].kph), name).toBe(getHudReadout(w).maxSpeed);
      expect(rows.map((r) => r.kph), name).toEqual(maxSpeedSteps(w, v).map((s) => kph(s.speed)));
    }
  });

  it('words each cause', () => {
    const { w, v } = playerWith(CASES.wheels);
    const labels = speedRows('Clear', maxSpeedSteps(w, v)).map((r) => r.label);
    expect(labels.some((l) => l.startsWith('Gun power'))).toBe(true);
    expect(labels).toContain('2 broken wheels');
    const stalled = playerWith(CASES.stalled);
    expect(speedRows('Clear', maxSpeedSteps(stalled.w, stalled.v))[0].label).toContain('Engine stalled');
  });

  it('explains gun power as one total, never per gun', () => {
    const { w, v } = playerWith();
    const note = speedNotes(w, v, vehicleStats(w, v))[0];
    expect(note).toContain('not a mounting limit');
    expect(note).toContain('one total, not a cost per gun');
    expect(note).toContain(`${Math.round(RULES.gunDragMax * 100)}%`);
  });

  it('notes low and empty fuel apart from the number', () => {
    const { w, v } = playerWith();
    w.player.fuel = 0;
    expect(speedNotes(w, v, vehicleStats(w, v)).join(' ')).toContain('Empty tank');
  });
});

describe('power chip', () => {
  const chip = (tweak: (w: World, v: Vehicle) => void) => {
    const { w, v } = playerWith(tweak);
    return powerChip(maxSpeedSteps(w, v), v);
  };

  it('shows no speed cost without guns', () => {
    expect(chip(CASES.plain).text).toMatch(/^0 \/ \d+(\.\d)? power · no speed cost$/);
  });

  it('shows draw, capacity and the speed cost with guns', () => {
    const c = chip((w, v) => {
      mountPart(w, v, makePart(w, 'mg', 0));
      mountPart(w, v, makePart(w, 'mg', 0));
    });
    expect(c.text).toMatch(/power · −\d+% speed$/);
    expect(c.over).toBe(false);
    expect(c.detail).toContain('not a mounting limit');
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
