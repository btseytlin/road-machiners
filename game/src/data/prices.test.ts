import { describe, expect, it } from 'vitest';
import { CHASSIS, chassisModifier } from './chassis';
import { PARTS, partModifier, type PartDef, type Unpriced } from './parts';
import { EFFORT } from './market';
import { TIME } from './time';
import { TOW } from './tow';

function bumped(def: Unpriced<PartDef>, field: string): Unpriced<PartDef> {
  const copy = structuredClone(def) as Record<string, unknown>;
  if (field === 'damage') (copy.round as { damage: number }).damage += 1;
  else if (field === 'turns' || field === 'reach') bumpUtility(copy, field);
  else copy[field] = (copy[field] as number) + 1;
  return copy as Unpriced<PartDef>;
}

// A utility's priced stats: how long its effect lasts and how far it reaches, by its shot, its farthest point or
// its radius.
function bumpUtility(copy: Record<string, unknown>, field: 'turns' | 'reach'): void {
  const effect = copy.effect as Record<string, number>;
  const shot = copy.shot as { range: number } | undefined;
  if (field === 'turns') effect.turns += 1;
  else if (shot) shot.range += 1;
  else if ('maxRange' in effect) effect.maxRange += 1;
  else effect.radius += 1;
}

// A passive utility has no priced stat. An oil spill's reach is the shared slick in OIL, not a stat of the part.
function pricedStats(def: PartDef): string[] {
  if (def.kind === 'utility' && def.reload === null) return [];
  if (def.kind === 'utility' && def.effect.type === 'oil') return ['turns'];
  return PRICED_STATS[def.kind];
}

const PRICED_STATS: Record<PartDef['kind'], string[]> = {
  weapon: ['damage', 'range'],
  engine: ['speedBonus', 'accelBonus'],
  armor: ['armor', 'blastArmor'],
  cargo: ['extraRows'],
  store: ['amount'],
  scanner: ['range'],
  utility: ['turns', 'reach'],
  core: ['hp'],
};

describe('item prices', () => {
  it('prices every part at its base plus its stat modifier', () => {
    for (const def of Object.values(PARTS)) expect(def.value, def.id).toBe(Math.round(def.base + partModifier(def)));
    for (const def of Object.values(CHASSIS)) expect(def.value, def.id).toBe(Math.round(def.base + chassisModifier(def)));
  });

  it('raises the value when a priced stat grows', () => {
    for (const def of Object.values(PARTS)) {
      for (const field of pricedStats(def)) {
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

  // These grids have more rows or columns than their models, so they count more deck cells for the same deck.
  const FINER_GRID = ['buggy', 'courier', 'jeep', 'wagon'];
  // The carrier is an armored hull. Its price holds what it cost before the cab rules cut its deck to 18 cells.
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

describe('tow fees', () => {
  it('price the tower time at the tier-1 wage', () => {
    const turn = EFFORT.wage[1] * TOW.wages;
    expect(TOW.base).toBeCloseTo(TOW.approachTurns * turn);
    expect(TOW.perTile).toBeCloseTo(TOW.turnsPerTile * turn);
    expect(TOW.maxFee).toBeCloseTo(TOW.capTurns * turn);
  });

  it('never cost more than a day of tier-1 earnings', () => {
    expect(TOW.maxFee).toBeLessThanOrEqual(EFFORT.wage[1] * TIME.turnsPerDay);
  });
});
