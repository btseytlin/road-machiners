import { describe, expect, it } from 'vitest';
import { CHASSIS, chassisModifier } from './chassis';
import { PARTS, partModifier, type PartDef, type Unpriced } from './parts';

function bumped(def: Unpriced<PartDef>, field: string): Unpriced<PartDef> {
  const copy = structuredClone(def) as Record<string, unknown>;
  if (field === 'damage') (copy.round as { damage: number }).damage += 1;
  else copy[field] = (copy[field] as number) + 1;
  return copy as Unpriced<PartDef>;
}

const PRICED_STATS: Record<PartDef['kind'], string[]> = {
  weapon: ['damage', 'range'],
  engine: ['speedBonus', 'accelBonus'],
  armor: ['armor', 'blastArmor'],
  cargo: ['extraRows'],
  store: ['amount'],
  scanner: ['range'],
  core: ['hp'],
};

describe('item prices', () => {
  it('prices every part at its base plus its stat modifier', () => {
    for (const def of Object.values(PARTS)) expect(def.value, def.id).toBe(Math.round(def.base + partModifier(def)));
    for (const def of Object.values(CHASSIS)) expect(def.value, def.id).toBe(Math.round(def.base + chassisModifier(def)));
  });

  it('raises the value when a priced stat grows', () => {
    for (const def of Object.values(PARTS)) {
      for (const field of PRICED_STATS[def.kind]) {
        expect(partModifier(bumped(def, field)), `${def.id} ${field}`).toBeGreaterThan(partModifier(def));
      }
    }
  });

  it('charges more for heavier grades of a core part', () => {
    expect(PARTS.wheel.value).toBeLessThan(PARTS.wheelMid.value);
    expect(PARTS.wheelMid.value).toBeLessThan(PARTS.wheelHeavy.value);
    expect(PARTS.transmission.value).toBeLessThan(PARTS.transmissionMid.value);
    expect(PARTS.transmissionMid.value).toBeLessThan(PARTS.transmissionHeavy.value);
    expect(PARTS.tankMid.value).toBeLessThan(PARTS.tankHeavy.value);
  });

  const FINER_GRID = ['buggy', 'courier', 'jeep', 'wagon'];
  const KEPT_PRICE = ['carrier'];

  it('never prices a chassis with more deck cells below one of the same tier with fewer', () => {
    const deck = (id: string) => [...CHASSIS[id].layout.join('')].filter((c) => c === 'D').length;
    for (const a of Object.values(CHASSIS).filter((c) => !FINER_GRID.includes(c.id) && !KEPT_PRICE.includes(c.id))) {
      for (const b of Object.values(CHASSIS).filter((c) => !FINER_GRID.includes(c.id) && !KEPT_PRICE.includes(c.id))) {
        if (a.tier === b.tier && deck(a.id) > deck(b.id)) expect(a.value, `${a.id} over ${b.id}`).toBeGreaterThan(b.value);
      }
    }
  });
});
