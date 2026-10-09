import { describe, expect, it, vi } from 'vitest';
import { startKit } from '../data/start';
import { defaultSetup } from '../sim/settings';
import { playerVehicle } from '../sim/damage';
import { outpostPad } from '../sim/gauntlet';
import { highwayHash } from '../sim/highway';
import { gauntletWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import { endTurn, newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { changeMapIfMoved, loadWorld, mapFor, SaveError, SaveHold, SAVE_KEY, writeSave, type Run } from './save';
import type { RunLog } from './run-log';
import { takeBootRequest } from './save-slots';
import { memoryBackend, SaveSlots } from './save-db';

function saved(world: World): SaveSlots {
  const slots = new SaveSlots(memoryBackend(), new Map());
  writeSave(slots, 'auto', world, 'run-1', 1000);
  return slots;
}

function arrived(world: World): World {
  const me = playerVehicle(world);
  me.pos = outpostPad(world, world.gauntlet!.window + 1);
  me.speed = 0;
  return endTurn(world, () => {});
}

describe('a saved world by mode', () => {
  it('loads a Roaming world back on Icarus with no run', () => {
    const world = newWorld(21, startKit('standard'), TEST_MAP, defaultSetup('roaming'));

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP);

    expect(loaded).toEqual(world);
    expect(loaded?.gauntlet).toBeNull();
    expect(loaded?.terrain).toBe(TEST_MAP.terrain);
  });

  it('loads a Gauntlet world back on its own highway window', () => {
    const world = gauntletWorld(21);

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP);

    expect(loaded).toEqual(world);
    expect(loaded?.mapHash).toBe(highwayHash(21, 0));
  });

  it('pays an outpost once across a save and a load, on the moved window, and awards nothing on load', () => {
    const world = arrived(gauntletWorld(21));

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP)!;
    const next = endTurn(loaded, () => {});

    expect(loaded).toEqual({ ...world, events: [], removed: [] });
    expect(loaded.gauntlet?.window).toBe(1);
    expect(loaded.mapHash).toBe(highwayHash(21, 1));
    expect(next.player.money).toBe(world.player.money);
    expect(next.player.xp).toBe(world.player.xp);
    expect(next.events.some((e) => e.t === 'outpostReached' || e.t === 'money' || e.t === 'practice')).toBe(false);
  });
});

describe('the map of a saved world', () => {
  const gauntlet = gauntletWorld(21);

  it('throws on a highway hash that no longer matches the generator', () => {
    expect(() => mapFor({ ...gauntlet, mapHash: 'highway:0:21:0' }, TEST_MAP)).toThrow(SaveError);
  });

  it('throws on a Gauntlet world with no run or on Icarus, and on a Roaming world on a highway', () => {
    expect(() => mapFor({ ...gauntlet, gauntlet: null }, TEST_MAP)).toThrow(/Icarus roads/);
    expect(() => mapFor({ ...gauntlet, mapHash: TEST_MAP.hash }, TEST_MAP)).toThrow(SaveError);
    expect(() => mapFor({ ...gauntlet, setup: defaultSetup('roaming') }, TEST_MAP)).toThrow(SaveError);
  });

  it('gives a Roaming world the Icarus map', () => {
    expect(mapFor({ seed: 4, mapHash: TEST_MAP.hash, setup: defaultSetup('roaming'), gauntlet: null }, TEST_MAP)).toBe(TEST_MAP);
  });
});

describe('the window swap in the game', () => {
  function runOn(world: World): Run {
    const log = { flush: () => Promise.resolve() } as unknown as RunLog;
    return { slots: new SaveSlots(memoryBackend(), new Map()), runId: 'run-1', log, mapHash: world.mapHash };
  }

  it('asks for a boot of the autosave only when the map has moved', async () => {
    const world = gauntletWorld(21);
    const run = runOn(world);
    const session = new Map<string, string>();
    const storage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) } as Storage;
    const reload = vi.fn();

    expect(changeMapIfMoved(run, world, new SaveHold(), storage, reload)).toBe(false);
    expect(takeBootRequest(storage, SAVE_KEY)).toBeNull();

    const moved = arrived(world);
    expect(changeMapIfMoved(run, moved, new SaveHold(), storage, reload)).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(takeBootRequest(storage, SAVE_KEY)).toEqual({ slot: 'auto', reason: 'road' });
    expect(loadWorld(run.slots, 'auto', TEST_MAP)?.gauntlet?.window).toBe(1);
  });

  it('refuses to reboot while saves are held', () => {
    const world = gauntletWorld(21);
    const run = runOn(world);
    const hold = new SaveHold();
    hold.noteError();

    expect(() => changeMapIfMoved(run, arrived(world), hold, {} as Storage, () => {})).toThrow(/held/);
  });
});
