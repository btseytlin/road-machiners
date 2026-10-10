import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { playerVehicle } from '../sim/damage';
import { TEST_MAP } from '../test/map';
import { townAt } from '../sim/sites';
import { carriedWorld, newWorld } from '../sim/world';
import { loadWorld, saveOf, savedRunId } from './save';
import { memoryBackend, SaveSlots } from './save-db';
import { readCarried, rescueSave } from './save-rescue';
import FORMAT_2_0 from './save-fixtures/format-2-0.json';
import FORMAT_2_1 from './save-fixtures/format-2-1.json';
import FORMAT_2_9 from './save-fixtures/format-2-9.json';
import { MIGRATIONS } from './save-migrations';
import { defaultSetup } from '../sim/settings';

const KIT = startKit('standard');
const fresh = () => 5;
const freshRun = () => 'new-run';
const makeSlots = () => new SaveSlots(memoryBackend(), new Map());

type SavedWorld = { mapHash: string; player: { vehicleId: string; money: number }; vehicles: { id: string; items: { x: number }[] }[] };

function currentSave(): { format: unknown; world: SavedWorld } {
  const world = newWorld(1337, KIT, TEST_MAP, defaultSetup('roaming'));
  world.player.money = 4321;
  world.player.xp = 150;
  world.player.ranks.driving = 2;
  return JSON.parse(JSON.stringify(saveOf(world)));
}

describe('readCarried', () => {
  it('reads a current save with another map hash', () => {
    const save = currentSave();
    save.world.mapHash = 'other';
    const carried = readCarried(save);
    expect(carried.money).toBe(4321);
    expect(carried.xp).toBe(150);
    expect(carried.ranks.driving).toBe(2);
    expect(carried.truck?.chassisId).toBe(KIT.chassis);
    expect(carried.truck?.items.some((it) => it.kind === 'part' && it.part.defId === 'mg')).toBe(true);
  });

  it('reads skill XP from before format 2.10 as the 9 to 10 step does', () => {
    const old = readCarried({ format: { major: 2, minor: 9 }, world: FORMAT_2_9 });
    const migrated = readCarried({ format: { major: 2, minor: 10 }, world: MIGRATIONS[9](FORMAT_2_9) });
    expect(old.ranks).toEqual({ driving: 0, perception: 1, machining: 2, toughness: 5, social: 3 });
    expect(old.xp).toBe(1549);
    expect({ xp: old.xp, ranks: old.ranks }).toEqual({ xp: migrated.xp, ranks: migrated.ranks });
  });

  it('keeps old perks whose rank holds and drops the rest', () => {
    const world = { ...FORMAT_2_9, player: { ...FORMAT_2_9.player, perks: ['welder', 'desertRat', 'steadyAim'] } };
    const { world: rescued } = carriedWorld(readCarried({ world }), KIT, () => TEST_MAP, fresh);
    expect(rescued.player.perks).toEqual(['welder', 'desertRat']);
    expect(rescued.player.ranks.toughness).toBe(5);
  });

  it('reads old formats and a fake major format', () => {
    for (const world of [FORMAT_2_0, FORMAT_2_1]) {
      const carried = readCarried({ format: { major: 2, minor: 0 }, world });
      expect(carried.money).toBe(Math.round((world.player.money * 100) / 3));
    }
    expect(readCarried({ format: { major: 99, minor: 0 }, world: FORMAT_2_1 }).money).toBe(FORMAT_2_1.player.money);
  });

  it('turns money and cost basis from before format 2.30 into cents, as the 29 to 30 step does', () => {
    const world = { player: { money: 1000, costBasis: { scrap: 10.5 } } };
    for (const format of [undefined, { major: 1, minor: 20 }, { major: 2, minor: 29 }]) {
      const carried = readCarried({ format, world });
      expect(carried.money, JSON.stringify(format)).toBe(33333);
      expect(carried.costBasis.scrap, JSON.stringify(format)).toBeCloseTo(350);
    }
    const current = readCarried({ format: { major: 2, minor: 30 }, world });
    expect(current.money).toBe(1000);
    expect(current.costBasis).toEqual({ scrap: 10.5 });
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
    expect(loaded.player.xp).toBe(150);
    expect(loaded.player.ranks.driving).toBe(2);
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

  it('carries valid world settings over to the new world and its save', () => {
    const slots = makeSlots();
    const save = currentSave() as ReturnType<typeof currentSave> & { world: { setup: unknown } };
    save.world.mapHash = 'other';
    save.world.setup = { mode: 'roaming', settings: { damage: 1.5, fuelUse: 2, supplyUse: 0.75 } };
    slots.put('auto', save);
    const rescued = rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)!;

    expect(rescued.report.settingsReset).toEqual([]);
    expect(loadWorld(slots, 'auto', TEST_MAP)!.setup).toEqual(save.world.setup);
  });

  it('resets bad world settings to their defaults, keeps the good ones and reports each reset', () => {
    const slots = makeSlots();
    const save = currentSave() as ReturnType<typeof currentSave> & { world: { setup: unknown } };
    save.world.setup = { mode: 'roaming', settings: { damage: null, fuelUse: 1.5, supplyUse: 40 } };
    slots.put('auto', save);
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(/badSetup/);
    const rescued = rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)!;

    expect(rescued.report.settingsReset).toEqual(['damage', 'supplyUse']);
    expect(loadWorld(slots, 'auto', TEST_MAP)!.setup.settings).toEqual({ damage: 1, fuelUse: 1.5, supplyUse: 1 });
  });

  it('gives a save from before world settings the default Roaming setup and reports no reset', () => {
    const slots = makeSlots();
    slots.put('auto', { format: { major: 2, minor: 1 }, world: FORMAT_2_1 });
    const rescued = rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 1000)!;

    expect(rescued.world.setup).toEqual(defaultSetup('roaming'));
    expect(rescued.report.settingsReset).toEqual([]);
  });

  it('lists quest variables this version does not declare as lost and closes any open quest', () => {
    const slots = makeSlots();
    const save = currentSave() as unknown as { format: unknown; world: SavedWorld & { player: { quests: unknown } } };
    save.world.mapHash = 'old-map';
    save.world.player.quests = {
      world: { retired_flag: true },
      local: { bowl_hattie: { paid: 'yes' }, gone_quest: { n: 1 } },
      session: { quest: 'bowl_hattie', checkpoint: 'start.hub', seed: 3 },
    };
    slots.put('auto', save);
    const rescued = rescueSave(slots, 'auto', TEST_MAP, KIT, fresh, freshRun, 2000);
    expect(rescued?.world.player.quests).toEqual({ world: {}, local: {}, session: null, live: null });
    expect(rescued?.report.lost).toEqual(expect.arrayContaining(['retired_flag', 'bowl_hattie.paid', 'gone_quest.n']));
    expect(loadWorld(slots, 'auto', TEST_MAP)?.player.quests.session).toBeNull();
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
