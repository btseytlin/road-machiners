import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import type { Refusal, SimNote } from '../sim/types';
import { type Locale, type Msg } from './msg';
import { goalText, moneyReasonText, noteText, refusalText, vehicleTitle } from './names';
import { resolve } from './resolve';

const both = (msg: Msg): Record<Locale, string> => ({ en: resolve(msg, 'en'), ru: resolve(msg, 'ru') });

function scene() {
  const w = emptyWorld();
  const npc = addVehicle(w, 'roamers', 'buggy', ['mg', 'stockEngine'], { x: 5, y: 5 });
  npc.brain = { ...npcBrain('roamer', npc.pos, ['roamer']), driver: 'Ada Voss' };
  return { w, npc };
}

describe('truck titles', () => {
  it('reads an NPC as its profession and driver, with the driver name as it is', () => {
    const { w, npc } = scene();
    expect(both(vehicleTitle(w, npc))).toEqual({ en: 'Roamer Ada Voss', ru: 'Бродяга Ada Voss' });
  });

  it('reads the player truck as the player\'s own', () => {
    const w = emptyWorld();
    expect(both(vehicleTitle(w, w.vehicles[0]))).toEqual({ en: 'Your truck', ru: 'Ваш грузовик' });
  });

  it('reads a truck without a driver as its chassis', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'roamers', 'buggy', [], { x: 5, y: 5 });
    expect(both(vehicleTitle(w, v)).en).toBe('Buggy');
  });

  it('throws for an unknown template', () => {
    const { w, npc } = scene();
    npc.brain!.templateId = 'nope';
    expect(() => resolve(vehicleTitle(w, npc), 'en')).toThrow(/nope/);
  });
});

describe('sim ids in words', () => {
  it('words a goal reason in both languages', () => {
    expect(both(goalText('lowFuel'))).toEqual({ en: 'Low fuel', ru: 'Мало топлива' });
    expect(both(goalText('legacy'))).toEqual({ en: 'Busy', ru: 'Занят' });
  });

  it('words notes with their numbers formatted for each language', () => {
    const leak: SimNote = { id: 'tankLeak', fuel: 1.25 };
    expect(both(noteText(leak))).toEqual({ en: 'Fuel tank leaks: fuel -1.3', ru: 'Бак течёт, топливо −1,3.' });
    expect(both(noteText({ id: 'filledSupplies', site: 'dustwell' }))).toEqual({ en: 'Filled supplies at Dustwell', ru: 'Припасы пополнены: Пыльный колодец' });
  });

  it('words a tow fee with the towed truck', () => {
    const { w, npc } = scene();
    expect(both(moneyReasonText(w, { kind: 'towing', vehicle: npc.id }))).toEqual({ en: 'towing Roamer Ada Voss', ru: 'буксировка: Бродяга Ada Voss' });
  });

  it('words refusals, naming who loots and why a part does not fit', () => {
    const { w, npc } = scene();
    const looting: Refusal = { id: 'looting', by: npc.id, place: 'wreck' };
    expect(both(refusalText(w, looting))).toEqual({ en: 'Roamer Ada Voss is looting this wreck', ru: 'Эти обломки уже грабит Бродяга Ada Voss' });
    expect(both(refusalText(w, { id: 'badLayout', cause: { id: 'noFit' } })).en).toBe('Does not fit there. Items would fall off the grid or overlap.');
    expect(both(refusalText(w, { id: 'needsXp', cost: 1200, have: 30 }))).toEqual({ en: 'Needs 1,200 XP, you have 30 XP', ru: 'Нужно опыта: 1 200, у вас: 30' });
  });
});
