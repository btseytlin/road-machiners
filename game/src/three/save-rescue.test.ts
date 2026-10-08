import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { playerVehicle } from '../sim/damage';
import { TEST_MAP } from '../test/map';
import { townAt } from '../sim/sites';
import { newWorld } from '../sim/world';
import { loadWorld, saveOf } from './save';
import { readCarried, rescueSave } from './save-rescue';
import FORMAT_2_0 from './save-fixtures/format-2-0.json';
import FORMAT_2_1 from './save-fixtures/format-2-1.json';

const KIT = startKit('standard');
const fresh = () => 5;

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

type SavedWorld = { mapHash: string; player: { vehicleId: string; money: number }; vehicles: { id: string; items: { x: number }[] }[] };

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
  it('turns a save from another map into a world that then loads', () => {
    const storage = makeStorage();
    const save = currentSave();
    save.world.mapHash = 'other';
    storage.setItem('roam.save', JSON.stringify(save));
    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow();
    const rescued = rescueSave(storage, 'auto', TEST_MAP, KIT, fresh, 1000)!;
    expect(townAt(rescued.world)).not.toBeNull();
    expect(rescued.world.player.money).toBe(4321);
    const loaded = loadWorld(storage, 'auto', TEST_MAP)!;
    expect(loaded.player.skills.driving).toBe(800);
    expect(playerVehicle(loaded).chassisId).toBe(KIT.chassis);
  });

  it('reads and writes the slot it is given', () => {
    const storage = makeStorage();
    storage.setItem('roam.save:slot2', JSON.stringify(currentSave()));
    const rescued = rescueSave(storage, 'slot2', TEST_MAP, KIT, fresh, 1234)!;
    expect(JSON.parse(storage.getItem('roam.save:slot2')!).savedAt).toBe(1234);
    expect(loadWorld(storage, 'slot2', TEST_MAP)!.player.money).toBe(rescued.world.player.money);
    expect(storage.getItem('roam.save')).toBeNull();
  });

  it('gives nothing for an unparsable or non-object save', () => {
    const storage = makeStorage();
    expect(rescueSave(storage, 'auto', TEST_MAP, KIT, fresh, 1000)).toBeNull();
    storage.setItem('roam.save', '{"nope');
    expect(rescueSave(storage, 'auto', TEST_MAP, KIT, fresh, 1000)).toBeNull();
    storage.setItem('roam.save', '[1]');
    expect(rescueSave(storage, 'auto', TEST_MAP, KIT, fresh, 1000)).toBeNull();
  });
});
