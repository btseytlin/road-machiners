import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { playerVehicle } from '../sim/damage';
import { TEST_MAP } from '../test/map';
import { townAt } from '../sim/sites';
import { newWorld } from '../sim/world';
import { loadWorld, saveOf, savedRunId } from './save';
import { memoryBackend, SaveSlots } from './save-db';
import { readCarried, rescueSave } from './save-rescue';
import FORMAT_2_0 from './save-fixtures/format-2-0.json';
import FORMAT_2_1 from './save-fixtures/format-2-1.json';

const KIT = startKit('standard');
const fresh = () => 5;
const freshRun = () => 'new-run';
const makeSlots = () => new SaveSlots(memoryBackend(), new Map());

type SavedWorld = { mapHash: string; player: { vehicleId: string; money: number }; vehicles: { id: string; items: { x: number }[] }[] };

// A current save of a played world, as JSON.
function currentSave(): { format: unknown; world: SavedWorld } {
  const world = newWorld(1337, KIT, TEST_MAP);
  world.player.money = 4321;
  world.player.skills.driving = 800;
  return JSON.parse(JSON.stringify(saveOf(world)));
}

describe('readCarried', () => {
  it('reads a current save with another map hash', () => {
    const save = currentSave();
    save.world.mapHash = 'other';
    const carried = readCarried(save);
    expect(carried.money).toBe(4321);
    expect(carried.skills.driving).toBe(800);
    expect(carried.truck?.chassisId).toBe(KIT.chassis);
    expect(carried.truck?.items.some((it) => it.kind === 'part' && it.part.defId === 'mg')).toBe(true);
  });

  it('reads old formats and a fake major format', () => {
    for (const world of [FORMAT_2_0, FORMAT_2_1]) {
      const carried = readCarried({ format: { major: 2, minor: 0 }, world });
      expect(carried.money).toBe(world.player.money);
    }
    expect(readCarried({ format: { major: 99, minor: 0 }, world: FORMAT_2_1 }).money).toBe(FORMAT_2_1.player.money);
  });

  it('reads garbage without throwing and keeps what is valid', () => {
    const junk = [null, undefined, [], 'x', 5, {}, { world: [] }, { world: { player: 'x' } }, { world: { player: { money: 'rich', skills: [], perks: [1, 'rebuild'], storage: [3] } } }];
    for (const raw of junk) expect(() => readCarried(raw)).not.toThrow();
    expect(readCarried(junk[8]).perks).toEqual(['rebuild']);
    expect(readCarried(junk[8]).money).toBeNull();
    expect(readCarried(junk[3]).truck).toBeNull();
  });

  it('drops items with float coordinates and negative numbers', () => {
    const save = currentSave();
    const truck = save.world.vehicles.find((v) => v.id === save.world.player.vehicleId)!;
    truck.items[0].x = 1.5;
    save.world.player.money = -5;
    const carried = readCarried(save);
    expect(carried.truck!.items).toHaveLength(truck.items.length - 1);
    expect(carried.money).toBeNull();
  });
});

describe('rescueSave', () => {
  it('turns a save from another map into a world that then loads, in the same run', () => {
    const slots = makeSlots();
    const save = currentSave();
    save.world.mapHash = 'other';
    slots.put('auto', { ...save, runId: 'old-run' });
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow();
    const rescued = rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)!;
    expect(townAt(rescued.world)).not.toBeNull();
    expect(rescued.world.player.money).toBe(4321);
    expect(rescued.runId).toBe('old-run');
    expect(savedRunId(slots.get('auto'))).toBe('old-run');
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    expect(loaded.player.skills.driving).toBe(800);
    expect(playerVehicle(loaded).chassisId).toBe(KIT.chassis);
  });

  it('reads and writes the slot it is given', () => {
    const slots = makeSlots();
    slots.put('slot2', currentSave());
    const rescued = rescueSave(slots, 'slot2', TEST_MAP, KIT, fresh, freshRun, 1234)!;
    expect((slots.get('slot2') as { savedAt: number }).savedAt).toBe(1234);
    expect(loadWorld(slots, 'slot2', TEST_MAP)!.player.money).toBe(rescued.world.player.money);
    expect(slots.has('auto')).toBe(false);
  });

  it('gives nothing for an unparsable or non-object save', () => {
    const slots = makeSlots();
    expect(rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)).toBeNull();
    slots.put('auto', '{"nope');
    expect(rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)).toBeNull();
    slots.put('auto', [1]);
    expect(rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)).toBeNull();
  });
});
