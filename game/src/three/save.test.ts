import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
import { addVehicle, emptyWorld } from '../sim/testkit';
import { moveItem } from '../sim/inventory';
import { advanceJobs } from '../sim/jobs';
import { CHASSIS } from '../data/chassis';
import { clearGame, clearSlot, hasSave, loadWorld, packExplored, SaveError, unpackExplored, saveKey, saveInTown, isDayStart, saveOf, saveWorld, SaveHold, writeSave } from './save';
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';
import { TEST_MAP } from '../test/map';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { breakProp } from '../sim/salvage';
import { MIGRATIONS, SAVE_FORMAT, SAVE_MAJOR } from './save-migrations';
import SAVED_SHAPE from './save-shape.json';
import { allSlots, type SlotId } from './save-slots';
import { newGameShape } from '../test/save-shape';

const SLOTS = allSlots(3);

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

describe('local game save', () => {
  it('saves by hand on any turn and clears for a new game', () => {
    const storage = makeStorage();
    const world = { ...newWorld(1337, startKit('standard'), TEST_MAP), turn: 7 };
    writeSave(storage, 'auto', world, 1000);
    expect(hasSave(storage, SLOTS)).toBe(true);
    expect(loadWorld(storage, 'auto', TEST_MAP)).toEqual(world);
    clearSlot(storage, 'auto');
    expect(hasSave(storage, SLOTS)).toBe(false);
  });

  it('clears the save and the seen tips for a new game, and keeps sound settings', () => {
    const storage = makeStorage();
    writeSave(storage, 'auto', newWorld(1337, startKit('standard'), TEST_MAP), 1000);
    storage.setItem('roam.tips', JSON.stringify(['waypoint']));
    storage.setItem('roam-sound', '{}');
    clearGame(storage);
    expect([storage.getItem('roam.save'), storage.getItem('roam.tips'), storage.getItem('roam-sound')]).toEqual([null, null, '{}']);
  });

  it('saves a command on a town pad at once, and not out in the open', () => {
    const storage = makeStorage();
    const open = emptyWorld({ x: 30, y: 30 });
    saveInTown(storage, open, 1000);
    expect(hasSave(storage, SLOTS)).toBe(false);
    const inTown = emptyWorld(sitePads(REGION.towns[0])[0]);
    saveInTown(storage, inTown, 1000);
    expect(hasSave(storage, SLOTS)).toBe(true);
  });

  it('loads a save that holds an aim at a missing part as a body shot', () => {
    const storage = makeStorage();
    const world = emptyWorld();
    const foe = world.vehicles[1] ?? addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
    world.vehicles[0].weaponOrders = { w1: { targetId: foe.id, aim: 'gone-part' } };
    writeSave(storage, 'auto', world, 1000);
    const loaded = loadWorld(storage, 'auto', TEST_MAP);
    expect(loaded?.vehicles[0].weaponOrders.w1).toEqual({ targetId: foe.id, aim: 'body' });
  });

  it('resumes a pending refit after loading without losing progress', () => {
    const storage = makeStorage();
    const world = emptyWorld();
    const weapon = world.vehicles[0].items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon) throw new Error('Expected weapon');
    const to = { x: 1, y: CHASSIS.scout.layout.length, rot: 0 as const };
    const next = moveItem(world, weapon.id, to);
    advanceJobs(next);
    writeSave(storage, 'auto', next, 1000);
    const loaded = loadWorld(storage, 'auto', TEST_MAP);
    if (!loaded) throw new Error('Expected saved refit');
    expect(loaded.vehicles[0].job).toEqual(next.vehicles[0].job);
    for (let turn = 0; turn < 4; turn++) advanceJobs(loaded);
    expect(loaded.vehicles[0].job).toBeNull();
    expect(loaded.vehicles[0].items.find((item) => item.id === weapon.id)).toMatchObject(to);
  });

  it('stores explored as a string', () => {
    const storage = makeStorage();
    writeSave(storage, 'auto', newWorld(1337, startKit('standard'), TEST_MAP), 1000);
    expect(typeof JSON.parse(storage.getItem('roam.save')!).world.player.explored).toBe('string');
  });

  it('rejects explored of the wrong length', () => {
    const storage = makeStorage();
    writeSave(storage, 'auto', newWorld(1337, startKit('standard'), TEST_MAP), 1000);
    const raw = JSON.parse(storage.getItem('roam.save')!);
    raw.world.player.explored = 'AAAA';
    storage.setItem('roam.save', JSON.stringify(raw));
    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(SaveError);
  });

  it('returns null when there is no saved game', () => {
    expect(loadWorld(makeStorage(), 'auto', TEST_MAP)).toBeNull();
  });

  it('restores the complete world including fields added later', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const expanded = { ...world, futureFeature: { progress: 7 } };
    saveWorld(storage, { ...expanded, turn: 21 }, 20, 1000);
    expect(loadWorld(storage, 'auto', TEST_MAP)).toEqual({ ...expanded, turn: 21 });
  });

  it('rejects malformed JSON without replacing the saved data', () => {
    const storage = makeStorage();
    storage.setItem('roam.save', '{');
    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow();
    expect(storage.getItem('roam.save')).toBe('{');
  });

  it('rejects another major format, a newer minor format and incomplete worlds', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const saved = JSON.parse(JSON.stringify(saveOf(world))).world;
    const cases = [
      [{ major: SAVE_MAJOR - 1, minor: 0 }, saved, /new game/],
      [{ major: SAVE_MAJOR + 1, minor: 0 }, saved, /new game/],
      [{ major: SAVE_MAJOR, minor: MIGRATIONS.length + 1 }, saved, /newer/],
      [{ major: SAVE_MAJOR, minor: -1 }, saved, /format/],
      [SAVE_FORMAT, { turn: 21 }, /world/],
    ] as const;
    for (const [format, savedWorld, error] of cases) {
      storage.setItem('roam.save', JSON.stringify({ format, world: savedWorld }));
      expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(error);
    }
  });

  it('records the saved shape of the current format', () => {
    const format = `${SAVE_FORMAT.major}.${SAVE_FORMAT.minor}`;
    expect(SAVED_SHAPE.format, 'Run npm run save:shape after a new save format').toBe(format);
    expect(newGameShape(), 'The saved shape changed. Add a migration step in src/three/save-migrations.ts, then run npm run save:shape').toEqual(SAVED_SHAPE.shape);
  });

  it('rejects a save missing a field required for future turns', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    for (const field of ['nextId', 'rngState', 'spawnTimer', 'weather', 'broken'] as const) {
      const incomplete = { ...world };
      delete (incomplete as Partial<typeof world>)[field];
      const { terrain: _terrain, ...saved } = incomplete;
      storage.setItem('roam.save', JSON.stringify({ format: SAVE_FORMAT, world: saved }));
      expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(/world/);
    }
  });

  it('keeps baked props out of the save and rebuilds them from the map', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const baked = new Set(mapObstacles(TEST_MAP).map((o) => o.id));
    writeSave(storage, 'auto', world, 1000);
    const saved: { id: string }[] = JSON.parse(storage.getItem('roam.save')!).world.obstacles;

    expect(baked.size).toBeGreaterThan(0);
    expect(saved.filter((o) => baked.has(o.id))).toEqual([]);
    expect(saved.length).toBe(world.obstacles.length - baked.size);
    expect(loadWorld(storage, 'auto', TEST_MAP)!.obstacles).toEqual(world.obstacles);
  });

  it('rejects a save that holds a baked prop', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    writeSave(storage, 'auto', world, 1000);
    const raw = JSON.parse(storage.getItem('roam.save')!);
    raw.world.obstacles.push(mapObstacles(TEST_MAP)[0]);
    storage.setItem('roam.save', JSON.stringify(raw));

    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(SaveError);
    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(/baked/);
  });

  it('keeps a broken baked fence broken across a save and a load', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const fence = world.obstacles.find(isBreakable);
    if (!fence || !isBakedObstacle(fence)) throw new Error('The map needs a baked fence or junk pile');
    breakProp(world, fence.id, world.player.vehicleId);
    writeSave(storage, 'auto', world, 1000);

    const loaded = loadWorld(storage, 'auto', TEST_MAP)!;

    expect(loaded.obstacles.map((o) => o.id)).not.toContain(fence.id);
    expect(loaded.obstacles).toEqual(world.obstacles);
    expect(loaded.broken).toEqual(world.broken);
  });

  it('rejects a save whose broken props do not match the map', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const rock = mapObstacles(TEST_MAP).find((o) => o.kind === 'rock')!;
    const fence = world.obstacles.find(isBreakable)!;
    const stranger = { ...fence, id: 'fence-999999' };

    for (const obstacle of [rock, stranger]) {
      writeSave(storage, 'auto', { ...world, broken: [{ obstacle, turn: 1 }] }, 1000);
      expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(/broken/);
    }
  });

  it('rejects a save made on another map', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    writeSave(storage, 'auto', world, 1000);
    const otherMap = { ...TEST_MAP, hash: 'ffffffff' };
    expect(() => loadWorld(storage, 'auto', otherMap)).toThrow(SaveError);
    expect(() => loadWorld(storage, 'auto', otherMap)).toThrow(/map/);
    expect(loadWorld(storage, 'auto', TEST_MAP)).toEqual(world);
  });

  it('saves only after each twentieth completed turn', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 20 }, 20, 1000);
    expect(loadWorld(storage, 'auto', TEST_MAP)).toBeNull();
    saveWorld(storage, { ...world, turn: 21 }, 20, 1000);
    expect(loadWorld(storage, 'auto', TEST_MAP)?.turn).toBe(21);
    saveWorld(storage, { ...world, turn: 22 }, 20, 1000);
    expect(loadWorld(storage, 'auto', TEST_MAP)?.turn).toBe(21);
    saveWorld(storage, { ...world, turn: 41 }, 20, 1000);
    expect(loadWorld(storage, 'auto', TEST_MAP)?.turn).toBe(41);
  });

  it('never saves a dead world', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 21 }, 20, 1000);
    const previous = storage.getItem('roam.save');
    const dead = { ...world, turn: 41, player: { ...world.player, health: 0, state: 'dead' as const } };
    saveWorld(storage, dead, 20, 1000);
    expect(storage.getItem('roam.save')).toBe(previous);
    expect(() => writeSave(storage, 'auto', dead, 1000)).toThrow(/dead/);
    expect(storage.getItem('roam.save')).toBe(previous);
  });

  it('rejects an invalid interval instead of skipping saves', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    expect(() => saveWorld(storage, world, 0, 1000)).toThrow(/interval/);
  });

  it('leaves the last save intact when storage rejects a write', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 21 }, 20, 1000);
    const previous = storage.getItem('roam.save');
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => saveWorld(storage, { ...world, turn: 41 }, 20, 1000)).toThrow(/Quota exceeded/);
    expect(storage.getItem('roam.save')).toBe(previous);
  });

  it('stores no terrain and restores far routes', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const npc = world.vehicles.find((v) => v.brain);
    if (!npc?.brain) throw new Error('The start world needs an NPC');
    npc.brain.farRoute = { dest: { x: 300, y: 200 }, points: [{ x: 290, y: 205 }, { x: 300, y: 200 }] };
    saveWorld(storage, { ...world, turn: 21 }, 20, 1000);
    expect(JSON.parse(storage.getItem('roam.save')!).world).not.toHaveProperty('terrain');
    const loaded = loadWorld(storage, 'auto', TEST_MAP)!;
    expect(loaded).toEqual({ ...world, turn: 21 });
    expect(loaded.terrain).toBe(world.terrain);
  });

  it('fits every slot of a world on the full map in the local storage quota', () => {
    const storage = makeStorage();
    const world = { ...newWorld(1337, startKit('standard'), TEST_MAP), size: REGION.size };
    world.player = { ...world.player, explored: new Uint8Array(REGION.size * REGION.size).fill(1) };
    for (const slot of SLOTS) writeSave(storage, slot, world, 1000);
    const total = SLOTS.reduce((sum, slot) => sum + storage.getItem(slot === 'auto' ? 'roam.save' : `roam.save:${slot}`)!.length, 0);
    expect(total).toBeLessThan(5_000_000);
  });

  it('writes the day start autosave on the first turn of a day only', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    expect([319, 320, 321, 770].map(isDayStart)).toEqual([false, true, false, true]);
    saveWorld(storage, { ...world, turn: 319 }, 20, 1000);
    saveWorld(storage, { ...world, turn: 321 }, 20, 1000);
    expect(storage.getItem('roam.save:day')).toBeNull();
    saveWorld(storage, { ...world, turn: 320 }, 20, 1000);
    expect(loadWorld(storage, 'day', TEST_MAP)?.turn).toBe(320);
  });

  it('writes only the autosave on the interval and in town, and never a manual slot', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    saveWorld(storage, { ...world, turn: 21 }, 20, 1000);
    saveInTown(storage, emptyWorld(sitePads(REGION.towns[0])[0]), 1000);
    const written = SLOTS.filter((slot: SlotId) => hasSave(storage, [slot]));
    expect(written).toEqual(['auto']);
  });

  it('writes no slot for a dead world', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const dead = { ...world, turn: 320, player: { ...world.player, health: 0, state: 'dead' as const } };
    saveWorld(storage, dead, 20, 1000);
    expect(hasSave(storage, SLOTS)).toBe(false);
  });

  it('keeps the manual slots and the sound settings when a new game clears the autosaves', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    for (const slot of SLOTS) writeSave(storage, slot, world, 1000);
    storage.setItem('roam-sound', '{}');
    clearGame(storage);
    expect(SLOTS.filter((slot) => hasSave(storage, [slot]))).toEqual(['slot1', 'slot2', 'slot3']);
    expect(storage.getItem('roam-sound')).toBe('{}');
  });

  it('loads a save from before slots, with no savedAt, as the autosave', () => {
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    storage.setItem('roam.save', JSON.stringify(saveOf(world)));
    expect(loadWorld(storage, 'auto', TEST_MAP)).toEqual(world);
  });
});

describe('saveKey', () => {
  it('keeps the plain key for an unscoped build', () => {
    expect(saveKey('')).toBe('roam.save');
  });

  it('adds the scope to the key', () => {
    expect(saveKey('factory')).toBe('roam.save.factory');
  });

  it('throws a SaveError for a save that does not parse', () => {
    const storage = makeStorage();
    storage.setItem('roam.save', '{"format":');
    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(SaveError);
  });

  it('throws a SaveError when a migration step cannot read an old save', () => {
    const storage = makeStorage();
    storage.setItem('roam.save', JSON.stringify({ format: { major: SAVE_MAJOR, minor: 0 }, world: { vehicles: 5, player: 7 } }));
    expect(() => loadWorld(storage, 'auto', TEST_MAP)).toThrow(SaveError);
  });
});

function pattern(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 7 + (i >> 3)) % 3 === 0 ? 1 : 0);
}

describe('explored bitset', () => {
  it('round-trips any length', () => {
    for (const length of [1, 8, 9, 360_000]) {
      const explored = pattern(length);
      expect(unpackExplored(packExplored(explored), length)).toEqual(explored);
    }
  });

  it('packs 360,000 tiles into 60,000 characters', () => {
    expect(packExplored(new Uint8Array(360_000)).length).toBe(60_000);
  });

  it('rejects the wrong length and a non-string as a SaveError', () => {
    const packed = packExplored(pattern(16));
    expect(() => unpackExplored(packed, 40)).toThrow(SaveError);
    expect(() => unpackExplored([0, 1], 2)).toThrow(SaveError);
    expect(() => unpackExplored('!!!', 8)).toThrow(SaveError);
  });

  it('refuses to pack a value other than 0 or 1', () => {
    expect(() => packExplored(Uint8Array.from([0, 2]))).toThrow(/not 0 or 1/);
  });
});

describe('SaveHold', () => {
  it('starts free', () => {
    expect(new SaveHold().held).toBe(false);
  });

  it('holds after an error until a turn that began after it finishes clean', () => {
    const hold = new SaveHold();
    hold.noteError();
    hold.finishTurn();
    expect(hold.held).toBe(true);
    hold.beginTurn();
    hold.finishTurn();
    expect(hold.held).toBe(false);
  });

  it('stays held when an error happens during the turn', () => {
    const hold = new SaveHold();
    hold.noteError();
    hold.beginTurn();
    hold.noteError();
    hold.finishTurn();
    expect(hold.held).toBe(true);
  });

  it('holds again on an error after a clean turn', () => {
    const hold = new SaveHold();
    hold.beginTurn();
    hold.finishTurn();
    hold.noteError();
    expect(hold.held).toBe(true);
  });
});
