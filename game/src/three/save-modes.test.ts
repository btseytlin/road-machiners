import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { defaultSetup } from '../sim/settings';
import { playerVehicle } from '../sim/damage';
import { endTurn, newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { loadWorld, writeSave } from './save';
import { memoryBackend, SaveSlots } from './save-db';

function roundTrip(kit: string, mode: 'roaming' | 'gauntlet') {
  const slots = new SaveSlots(memoryBackend(), new Map());
  const world = newWorld(21, startKit(kit), TEST_MAP, defaultSetup(mode));
  writeSave(slots, 'auto', world, 'run-1', 1000);
  return { world, loaded: loadWorld(slots, 'auto', TEST_MAP) };
}

describe('a saved world by mode', () => {
  it('loads a Roaming world back with no run', () => {
    const { world, loaded } = roundTrip('standard', 'roaming');

    expect(loaded).toEqual(world);
    expect(loaded?.gauntlet).toBeNull();
  });

  it('loads a Gauntlet world back with the same course, rows and outposts', () => {
    const { world, loaded } = roundTrip('gauntlet', 'gauntlet');

    expect(loaded).toEqual(world);
    expect(loaded?.obstacles.filter((o) => o.id.startsWith('run-'))).toEqual(world.obstacles.filter((o) => o.id.startsWith('run-')));
    expect(loaded?.gauntlet?.outposts).toHaveLength(4);
  });

  it('pays an outpost once, across a save and a load, and awards nothing on load', () => {
    const slots = new SaveSlots(memoryBackend(), new Map());
    let world = newWorld(21, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
    const me = playerVehicle(world);
    me.pos = { ...world.gauntlet!.outposts[0].pad };
    me.speed = 0;
    world = endTurn(world, () => {});
    writeSave(slots, 'auto', world, 'run-1', 1000);

    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    const next = endTurn(loaded, () => {});

    expect(loaded).toEqual({ ...world, events: [], removed: [] });
    expect(loaded.gauntlet?.outposts[0].paid).toBe(true);
    expect(next.player.money).toBe(world.player.money);
    expect(next.events.some((e) => e.t === 'outpostReached' || e.t === 'money' || e.t === 'practice')).toBe(false);
  });
});
