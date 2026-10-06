import { describe, expect, it } from 'vitest';
import { playerVehicle } from '../damage';
import { repairCost } from '../economy';
import { mountedParts } from '../grid';
import { partDef } from '../../data/parts';
import { surrenderTo } from '../parley';
import { addVehicle, emptyWorld, npcBrain } from '../testkit';
import { maxHp } from '../wear';
import { update } from '../world';
import { emptyLedger } from './orders';
import { DayTally, fightTotals, ledgerTotals, netWorth, tierDays, wageByTier, worthOf, worthTotal, type DayRow } from './record';

const row = (day: number, netWorth: number, tier: DayRow['tier'], extra: Partial<DayRow> = {}): DayRow => ({
  day, turns: day === 0 ? 0 : 450, money: 0, netWorth, tier, chassis: 'scout', fightsWon: 0, knockouts: 0, gearLost: 0, deaths: 0, stalls: 0, ledger: emptyLedger(),
  worth: { money: 0, cargo: 0, gear: 0, storage: 0, chassis: netWorth }, ...extra,
});

describe('wageByTier', () => {
  it('splits net worth gains by the tier held at the start of each period', () => {
    const rows = [row(0, 1000, 1), row(1, 1450, 1), row(2, 1900, 2), row(3, 3250, 2)];

    const wage = wageByTier(rows);

    expect(wage[1]).toBeCloseTo((450 + 450) / 900);
    expect(wage[2]).toBeCloseTo(1350 / 450);
  });

  it('has no wage for a tier the run never held', () => {
    expect(wageByTier([row(0, 1000, 1), row(1, 1450, 1)])[3]).toBeNull();
  });

  it('weights a partial last period by its turns', () => {
    const rows = [row(0, 0, 1), row(1, 450, 1), row(2, 480, 1, { turns: 30 })];

    expect(wageByTier(rows)[1]).toBeCloseTo(480 / 480);
  });
});

describe('tierDays', () => {
  it('names the first day each tier is held', () => {
    const rows = [row(0, 0, 1), row(1, 0, 1), row(2, 0, 2), row(3, 0, 2)];

    expect(tierDays(rows)).toEqual({ 1: 0, 2: 2, 3: null });
  });
});

describe('fightTotals', () => {
  it('sums the counts over every row', () => {
    const rows = [row(1, 0, 1, { fightsWon: 2, knockouts: 1 }), row(2, 0, 1, { fightsWon: 1, gearLost: 3, deaths: 1 })];

    expect(fightTotals(rows)).toEqual({ fightsWon: 3, knockouts: 1, gearLost: 3, deaths: 1, stalls: 0 });
  });
});

describe('netWorth', () => {
  it('counts damage to the truck at its repair bill', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const before = worthOf(w);
    const damaged = update(w, (draft) => {
      for (const p of mountedParts(playerVehicle(draft))) p.hp = Math.ceil(maxHp(p) / 2);
    });

    const after = worthOf(damaged);

    expect(after.chassis).toBe(before.chassis - repairCost(damaged));
    expect(after.chassis).toBeGreaterThan(before.chassis / 2);
    expect(netWorth(damaged)).toBe(worthTotal(after));
  });
});

describe('DayTally', () => {
  it('counts gear a surrender hands to a robber as lost, and gear the bot sells as kept', () => {
    const start = emptyWorld({ x: 100, y: 100 });
    const robber = addVehicle(start, 'raiders', 'buggy', ['mg'], { x: 104, y: 100 });
    robber.brain = npcBrain('buggy', robber.pos, ['raider']);
    const gear = () => mountedParts(playerVehicle(start)).filter((p) => partDef(p.defId).kind !== 'core').length;
    expect(gear()).toBeGreaterThan(0);
    const robbed = update(start, (w) => surrenderTo(w, playerVehicle(w), w.vehicles.find((v) => v.id === robber.id)!));
    const sold = update(start, (w) => {
      const me = playerVehicle(w);
      me.items = me.items.filter((it) => it.kind !== 'part' || partDef(it.part.defId).kind === 'core');
    });

    const robbedTally = new DayTally();
    robbedTally.note(start, robbed, [], emptyLedger());
    const soldTally = new DayTally();
    soldTally.note(start, sold, [], emptyLedger());

    expect(robbedTally.close(1, robbed).gearLost).toBeGreaterThan(0);
    expect(soldTally.close(1, sold).gearLost).toBe(0);
  });
});

describe('ledgerTotals', () => {
  it('adds each key over the rows', () => {
    const spent = (fuel: number, goodsSold: number) => ({ ...emptyLedger(), fuel, goodsSold });
    const rows = [row(1, 0, 1, { ledger: spent(-30, 100) }), row(2, 0, 1, { ledger: spent(-20, 50) })];

    expect(ledgerTotals(rows)).toMatchObject({ fuel: -50, goodsSold: 150, repairs: 0 });
  });
});
