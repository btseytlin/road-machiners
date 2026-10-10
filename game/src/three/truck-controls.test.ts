import { describe, expect, it } from 'vitest';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { aidData, addState } from '../sim/states';
import { playerAid } from '../sim/aid';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import type { World } from '../sim/types';
import { TruckContext, TruckControls, type ContextHost } from './truck-controls';

function scene(aidX: number) {
  const w = emptyWorld({ x: 30, y: 30 });
  const a = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: aidX, y: 30 });
  const b = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 34, y: 30 });
  for (const v of [a, b]) v.brain = npcBrain('trader', v.pos, ['trader']);
  addState(w, 'aid', a.id, w.player.vehicleId, { kind: 'aid', giver: 'player', fuel: 5, supplies: 0, price: 0, free: true, agreed: true, started: false, work: 1, workLeft: 1 });
  return { w, a, b };
}

function host(w: World) {
  const calls = { applied: [] as World[], trades: [] as string[] };
  const h = {
    world: () => w,
    playing: () => false,
    apply: (next: World) => { calls.applied.push(next); },
    pushEvents: () => undefined,
    note: () => undefined,
    openTrade: (id: string) => { calls.trades.push(id); },
    openTown: () => undefined,
    openOutpost: () => undefined,
    openDowned: () => undefined,
    openLoot: () => undefined,
  } satisfies ContextHost;
  return { h, calls };
}

describe('the E key on a deal', () => {
  it('does nothing beside another driver while the agreed one is away', () => {
    const { w } = scene(90);
    const { h, calls } = host(w);
    new TruckContext(h).use();
    expect(calls.applied).toEqual([]);
  });

  it('starts the handover with the agreed driver when another is also in reach', () => {
    const { w, a } = scene(26);
    const { h, calls } = host(w);
    new TruckContext(h).use();
    expect(calls.applied).toHaveLength(1);
    const next = calls.applied[0];
    expect(playerAid(next)).toMatchObject({ holder: a.id });
    expect(aidData(playerAid(next)!).started).toBe(true);
  });

  it('opens the trade for the shown driver only', () => {
    const { w, b } = scene(90);
    addState(w, 'trade', b.id, w.player.vehicleId, { kind: 'none' });
    const { h, calls } = host(w);
    new TruckContext(h).use();
    expect(calls.trades).toEqual([b.id]);
  });
});

function controlsOf(world: World) {
  const host = { world, revs: 0, applied: 0 };
  const c = new TruckControls({
    world: () => host.world,
    apply: (next) => { host.world = next; host.applied++; },
    commit: (next) => { host.world = next; },
    refreshPlan: () => {},
    doused: () => {},
    revved: () => { host.revs++; },
  });
  return { c, host };
}

describe('the overdrive key', () => {
  it('switches overdrive on with a rev, and off again', () => {
    const { c, host } = controlsOf(emptyWorld());
    c.toggleOverdrive();
    expect(host.world.player.overdrive).toBe(true);
    expect(host.revs).toBe(1);
    c.toggleOverdrive();
    expect(host.world.player.overdrive).toBe(false);
    expect(host.revs).toBe(1);
  });

  it('does nothing while the engine is too worn', () => {
    const w = emptyWorld();
    mountedParts(playerVehicle(w), 'engine')[0].hp = 1;
    const { c, host } = controlsOf(w);
    c.toggleOverdrive();
    expect(host.world.player.overdrive).toBe(false);
    expect(host.applied).toBe(0);
    expect(host.revs).toBe(0);
  });
});
