import { describe, expect, it } from 'vitest';
import { CHASSIS, chassisModifier } from './chassis';
import { PARTS, partModifier, type PartDef, type Unpriced } from './parts';
import { TIME } from './time';
import { TOW } from './tow';
import { ECONOMY, GOODS } from './goods';
import { START_KITS } from './start';
import { GEAR_LEVELS } from './npcs';
import { UNITS } from './units';
import { XP_SOURCES } from './skills';
import { CONTRACTS, EFFORT } from './market';

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

describe('money in cents', () => {
  it('sells 5 L of fuel for exactly 1 M at a town', () => {
    expect(UNITS.fuelLiters).toBe(5);
    expect(ECONOMY.supplyPrice.fuel).toBe(UNITS.centsPerM);
  });

  it('keeps every money amount a whole number of cents', () => {
    const amounts: [string, number][] = [
      ...Object.values(PARTS).map((d): [string, number] => [d.id, d.value]),
      ...Object.values(CHASSIS).map((d): [string, number] => [d.id, d.value]),
      ...Object.values(GOODS).map((d): [string, number] => [d.id, d.value]),
      ...Object.entries(ECONOMY.supplyPrice).map(([id, v]): [string, number] => [`supply ${id}`, v]),
      ...Object.entries(START_KITS).flatMap(([id, kit]): [string, number][] => [
        [`${id} money`, kit.money],
        ...Object.entries(kit.costBasis).map(([g, v]): [string, number] => [`${id} ${g} basis`, v]),
      ]),
      ...Object.entries(GEAR_LEVELS).map(([id, g]): [string, number] => [`${id} gear money`, g.money]),
    ];
    for (const [id, amount] of amounts) expect(Number.isInteger(amount), id).toBe(true);
  });
});

// Before money was cents, 1 money was a third of an M. XP bought with money pays the same for the same deal.
describe('XP per money in cents', () => {
  const OLD_PER_CENT = 3 / 100;

  it('pays profit, free tow and aid XP as before', () => {
    for (const source of ['profit', 'freeTow', 'aid'] as const) expect(XP_SOURCES[source].weight, source).toBeCloseTo(0.8 * OLD_PER_CENT, 10);
  });

  it('pays contract XP as before', () => {
    expect(CONTRACTS.haul.xpPerEffort).toBeCloseTo(0.1 * OLD_PER_CENT, 10);
    expect(CONTRACTS.fetch.xpPerEffort).toBeCloseTo(0.15 * OLD_PER_CENT, 10);
    expect(CONTRACTS.bounty.xpPerEffort).toBeCloseTo(0.25 * OLD_PER_CENT, 10);
  });
});
