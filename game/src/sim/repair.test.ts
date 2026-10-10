import { describe, expect, it } from 'vitest';
import { SKILL_EFFECTS } from '../data/skills';
import { PARTS, partDef } from '../data/parts';
import { GOODS } from '../data/goods';
import { REPAIR } from '../data/wear';
import { addVehicle, emptyWorld } from './testkit';
import { corePart, mountedParts } from './grid';
import { addGoods } from './inventory';
import { makePart } from './factory';
import { maxHp, partValue } from './wear';
import { planPartRepair, repairPlan } from './repair';

function armorPart(v: ReturnType<typeof emptyWorld>['vehicles'][0]) {
  return mountedParts(v).find((p) => partDef(p.defId).kind === 'armor')!;
}

describe('repairPlan', () => {
  it('reports no work when the part is already at the field cap', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = Math.floor(partDef(cage.defId).hp * REPAIR.fieldCapShare);
    expect(repairPlan(w, me, cage.id)).toEqual({ turns: 0, parts: 0, hp: 0, needed: 0 });
  });

  it('never plans above the field cap even when the part is undamaged', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = partDef(cage.defId).hp;
    expect(repairPlan(w, me, cage.id).hp).toBe(0);
  });

  it('spends parts and turns proportional to the HP gained', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const plan = repairPlan(w, me, cage.id);
    const cap = maxHp(cage) * REPAIR.fieldCapShare;
    expect(plan.hp).toBeCloseTo(cap - 1, 5);
    expect(plan.parts).toBeGreaterThan(0);
    expect(plan.turns).toBeGreaterThan(0);
  });

  it('spends fewer parts on a cheap small part than on a costly large one', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const wheel = mountedParts(me).find((p) => p.defId === 'wheel')!;
    const cab = corePart(me, 'cab');
    wheel.hp = 0;
    cab.hp = 0;
    addGoods(w, me, 'parts', 20);
    expect(partDef(cab.defId).value).toBeGreaterThan(partDef(wheel.defId).value);
    expect(repairPlan(w, me, cab.id).parts).toBeGreaterThan(repairPlan(w, me, wheel.id).parts);
  });

  it('spends parts good worth about the value it restores, for every part def', () => {
    const w = emptyWorld();
    for (const defId of Object.keys(PARTS)) {
      const part = makePart(w, defId, 0);
      part.hp = 0;
      const plan = planPartRepair(part, 1, 1, Infinity, Infinity);
      const valueRestored = (plan.hp / partDef(defId).hp) * partValue(part);
      const partsCost = plan.parts * GOODS.parts.value;
      expect(partsCost).toBeGreaterThanOrEqual(valueRestored);
      expect(partsCost - valueRestored).toBeLessThan(GOODS.parts.value);
    }
  });

  it('machining shortens the job and cuts parts use for the player', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    const base = repairPlan(w, me, cage.id);
    w.player.ranks.machining = 3;
    const tuned = repairPlan(w, me, cage.id);
    expect(tuned.parts).toBeLessThanOrEqual(base.parts);
    expect(tuned.turns).toBeLessThanOrEqual(base.turns);
  });
});

describe('field repair cap', () => {
  it('lifts a part past the base field cap for the player at rank 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    const max = maxHp(cage);
    cage.hp = max * REPAIR.fieldCapShare;
    expect(repairPlan(w, me, cage.id).needed).toBe(0);
    w.player.ranks.machining = 5;
    const cap = max * (REPAIR.fieldCapShare + 5 * SKILL_EFFECTS.machining.fieldCap);
    expect(repairPlan(w, me, cage.id).hp).toBeCloseTo(cap - cage.hp, 5);
  });

  it('keeps an NPC part at the base field cap', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    const engine = mountedParts(npc, 'engine')[0];
    engine.hp = Math.ceil(partDef(engine.defId).hp * REPAIR.fieldCapShare);
    w.player.ranks.machining = 5;
    expect(repairPlan(w, npc, engine.id).needed).toBe(0);
  });
});


describe('field repair by armor type', () => {
  it('patches scrap panels to full HP', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['scrapPanels', 'stockEngine'], { x: 40, y: 40 });
    const panels = armorPart(v);
    panels.hp = 1;
    addGoods(w, v, 'parts', 10);
    const plan = repairPlan(w, v, panels.id);
    expect(plan.parts).toBeLessThan(10);
    expect(plan.hp).toBeCloseTo(partDef('scrapPanels').hp - 1, 5);
  });

  it('leaves ceramic plates for a town garage', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['ceramicPlates', 'stockEngine'], { x: 40, y: 40 });
    const plates = armorPart(v);
    plates.hp = 1;
    addGoods(w, v, 'parts', 1);
    expect(repairPlan(w, v, plates.id).needed).toBe(0);
  });
});
