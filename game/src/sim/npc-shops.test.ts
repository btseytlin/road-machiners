import { describe, expect, it } from 'vitest';
import { SHOPS } from '../data/market';
import { REGION } from '../data/region';
import { corePart } from './grid';
import { thinkNpc } from './npc-activities';
import { tradeOffers } from './npc-decisions';
import { sitePads } from './sites';
import { addVehicle, emptyWorld, npcBrain } from './testkit';

const site = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!;

function traderAt(id: string) {
  const w = emptyWorld({ x: 5, y: 5 });
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], sitePads(site(id))[0]);
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  npc.resources!.money = 166_667;
  return { w, npc };
}

describe('NPCs use stalls as well as towns', () => {
  it('fuels at the nearest fuel stall when fuel is its only need', () => {
    const { w, npc } = traderAt('pump-station');
    npc.resources!.fuel = 0;
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply', targetId: 'pump-station' });
  });

  it('repairs at the nearest service stop, a stall included', () => {
    const { w, npc } = traderAt('pump-station');
    npc.resources!.fuel = 0;
    corePart(npc, 'cab').hp = 1;
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply', targetId: 'pump-station' });
  });

  it('sends a truck with no engine past the stall it stands at to a town, since only a town refits it', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = addVehicle(w, 'traders', 'hauler', [], sitePads(site('salvage-yard'))[0]);
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.resources!.money = 166_667;
    const activity = thinkNpc(w, npc);
    expect(activity.kind).toBe('resupply');
    expect(REGION.towns.map((t) => t.id)).toContain(activity.targetId);
  });

  it('sends a damaged raider to a camp', () => {
    const w = emptyWorld({ x: 5, y: 5 });
    const npc = addVehicle(w, 'raiders', 'hauler', [], sitePads(site('pump-station'))[0]);
    npc.brain = npcBrain('raider', npc.pos, ['raider']);
    npc.resources!.money = 166_667;
    corePart(npc, 'cab').hp = 1;
    const activity = thinkNpc(w, npc);
    expect(activity.kind).toBe('resupply');
    expect(REGION.locations.find((l) => l.id === activity.targetId)?.kind).toBe('camp');
  });

  it('offers trade runs through stalls from many sources', () => {
    const { w, npc } = traderAt('bowl');
    const offers = tradeOffers(w, npc);
    const stalls = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);
    expect(offers.some((o) => stalls.includes(o.value.source) || stalls.includes(o.value.sellShop))).toBe(true);
    expect(new Set(offers.map((o) => o.value.source)).size).toBeGreaterThan(1);
  });

  it('offers nothing to a driver with no money above its upkeep reserve', () => {
    const { w, npc } = traderAt('bowl');
    npc.resources!.money = 0;
    expect(tradeOffers(w, npc)).toEqual([]);
  });
});
