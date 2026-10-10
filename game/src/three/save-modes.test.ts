import { describe, expect, it, vi } from 'vitest';
import { startKit } from '../data/start';
import { defaultSetup } from '../sim/settings';
import { playerVehicle } from '../sim/damage';
import { FURY_ROAD } from '../data/modes';
import { betweenLevels, outpostPad, waitForRoad } from '../sim/fury-road';
import { highwayHash } from '../sim/highway';
import { furyRoadWorld } from '../sim/testkit';
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
  me.pos = outpostPad(world, world.furyRoad!.window + 1);
  me.speed = 0;
  return endTurn(world, () => {});
}

describe('a saved world by mode', () => {
  it('loads a Roaming world back on Icarus with no run', () => {
    const world = newWorld(21, startKit('standard'), TEST_MAP, defaultSetup('roaming'));

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP);

    expect(loaded).toEqual(world);
    expect(loaded?.furyRoad).toBeNull();
    expect(loaded?.terrain).toBe(TEST_MAP.terrain);
  });

  it('loads a Fury Road world back on its own highway window', () => {
    const world = furyRoadWorld(21);

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP);

    expect(loaded).toEqual(world);
    expect(loaded?.mapHash).toBe(highwayHash(21, 0));
  });

  it('gives back the same run mid-stretch, with a group racing in, and awards nothing on load', () => {
    let world = furyRoadWorld(21);
    for (let t = 0; t < FURY_ROAD.pacing.quiet + 2; t++) world = endTurn(world, () => {});
    expect(world.furyRoad!.groups[0].spawned).toBe(true);

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP)!;

    expect(loaded).toEqual({ ...world, events: [], removed: [] });
    expect(loaded.furyRoad?.quietFrom).toBe(world.furyRoad!.quietFrom);
    expect(loaded.furyRoad?.groups[0].engaged).toEqual(world.furyRoad!.groups[0].engaged);
  });

  it('pays an outpost once across a save and a load between levels, and awards nothing on load', () => {
    const world = arrived(furyRoadWorld(21));

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP)!;
    const next = endTurn(loaded, () => {});

    expect(loaded).toEqual({ ...world, events: [], removed: [] });
    expect(loaded.furyRoad?.window).toBe(0);
    expect(betweenLevels(loaded)).toBe(true);
    expect(next.player.money).toBe(world.player.money);
    expect(next.player.xp).toBe(world.player.xp);
    expect(next.events.some((e) => e.t === 'outpostReached' || e.t === 'money' || e.t === 'practice')).toBe(false);
  });

  it('loads the run right after the wait on the opened window', () => {
    const world = waitForRoad(arrived(furyRoadWorld(21)));

    const loaded = loadWorld(saved(world), 'auto', TEST_MAP)!;
    const next = endTurn(loaded, () => {});

    expect(loaded).toEqual({ ...world, events: [], removed: [] });
    expect(loaded.mapHash).toBe(highwayHash(21, 1));
    expect(next.player.money).toBe(world.player.money);
    expect(next.events.some((e) => e.t === 'outpostReached' || e.t === 'money' || e.t === 'roadOpened')).toBe(false);
  });
});

describe('the map of a saved world', () => {
  const furyRoad = furyRoadWorld(21);

  it('throws on a highway hash that no longer matches the generator', () => {
    expect(() => mapFor({ ...furyRoad, mapHash: 'highway:0:21:0' }, TEST_MAP)).toThrow(SaveError);
  });

  it('throws on a Fury Road world with no run or on Icarus, and on a Roaming world on a highway', () => {
    expect(() => mapFor({ ...furyRoad, furyRoad: null }, TEST_MAP)).toThrow(/Icarus roads/);
    expect(() => mapFor({ ...furyRoad, mapHash: TEST_MAP.hash }, TEST_MAP)).toThrow(SaveError);
    expect(() => mapFor({ ...furyRoad, setup: defaultSetup('roaming') }, TEST_MAP)).toThrow(SaveError);
  });

  it('gives a Roaming world the Icarus map', () => {
    expect(mapFor({ seed: 4, mapHash: TEST_MAP.hash, setup: defaultSetup('roaming'), furyRoad: null }, TEST_MAP)).toBe(TEST_MAP);
  });
});

describe('the window swap in the game', () => {
  function runOn(world: World): Run {
    const log = { flush: () => Promise.resolve() } as unknown as RunLog;
    return { slots: new SaveSlots(memoryBackend(), new Map()), runId: 'run-1', log, mapHash: world.mapHash };
  }

  it('asks for a boot of the autosave only when the map has moved', async () => {
    const world = furyRoadWorld(21);
    const run = runOn(world);
    const session = new Map<string, string>();
    const storage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) } as Storage;
    const reload = vi.fn();

    expect(changeMapIfMoved(run, world, new SaveHold(), storage, reload)).toBe(false);
    expect(takeBootRequest(storage, SAVE_KEY)).toBeNull();

    const paid = arrived(world);
    expect(changeMapIfMoved(run, paid, new SaveHold(), storage, reload)).toBe(false);

    const moved = waitForRoad(paid);
    expect(changeMapIfMoved(run, moved, new SaveHold(), storage, reload)).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(takeBootRequest(storage, SAVE_KEY)).toEqual({ slot: 'auto', reason: 'road' });
    expect(loadWorld(run.slots, 'auto', TEST_MAP)?.furyRoad?.window).toBe(1);
  });

  it('refuses to reboot while saves are held', () => {
    const world = furyRoadWorld(21);
    const run = runOn(world);
    const hold = new SaveHold();
    hold.noteError();

    expect(() => changeMapIfMoved(run, waitForRoad(arrived(world)), hold, {} as Storage, () => {})).toThrow(/held/);
  });

  it('throws on a map that moved with no road opened', () => {
    const world = furyRoadWorld(21);
    const run = runOn(world);

    expect(() => changeMapIfMoved(run, { ...world, mapHash: highwayHash(21, 1) }, new SaveHold(), {} as Storage, () => {})).toThrow(/no road opened/);
  });
});
