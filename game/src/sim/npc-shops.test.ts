import { describe, expect, it } from 'vitest';
import { SHOPS } from '../data/market';
import { REGION } from '../data/region';
import { corePart } from './grid';
import { thinkNpc } from './npc-activities';
import { tradeOffers } from './npc-decisions';
import { serviceAtStall } from './economy';
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
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    npc.resources!.money = 166_667;
    corePart(npc, 'cab').hp = 1;
    const activity = thinkNpc(w, npc);
    expect(activity.kind).toBe('resupply');
    expect(REGION.locations.find((l) => l.id === activity.targetId)?.kind).toBe('camp');
  });

  it.each(['dustwell', 'green-pit'])('serves a driver at the outpost %s for money, like any stall', (id) => {
    const { w, npc } = traderAt(id);
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    const money = npc.resources!.money;
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply', targetId: id });
    serviceAtStall(w, npc, id, 0);
    expect(npc.resources!.supplies).toBeGreaterThan(0);
    expect(npc.resources!.fuel).toBeGreaterThan(0);
    expect(npc.resources!.money).toBeLessThan(money);
  });

  it('gives a broke driver no free supplies at an outpost', () => {
    const { w, npc } = traderAt('dustwell');
    npc.resources!.supplies = 0;
    npc.resources!.money = 0;
    expect(thinkNpc(w, npc).kind).not.toBe('resupply');
    serviceAtStall(w, npc, 'dustwell', 0);
    expect(npc.resources!.supplies).toBe(0);
  });

  it('offers trade runs through stalls from many sources', () => {
    const { w, npc } = traderAt('bowl');
    const offers = tradeOffers(w, npc);
    const stalls = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);
    expect(offers.some((o) => stalls.includes(o.value.source) || stalls.includes(o.value.sellShop))).toBe(true);
    expect(new Set(offers.map((o) => o.value.source)).size).toBeGreaterThan(1);
  });

  it('has traders buy water at an outpost that makes it', () => {
    const { w, npc } = traderAt('bowl');
    const offers = tradeOffers(w, npc);
    expect(offers.some((o) => o.value.source === 'dustwell' || o.value.source === 'green-pit')).toBe(true);
  });

  it('offers nothing to a driver with no money above its upkeep reserve', () => {
    const { w, npc } = traderAt('bowl');
    npc.resources!.money = 0;
    expect(tradeOffers(w, npc)).toEqual([]);
  });
});
