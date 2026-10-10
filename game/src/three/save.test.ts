import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { newWorld, update } from '../sim/world';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { inOverdrive } from '../sim/stats';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import { canStowPart, moveItem, storePart, stowPart, stowSpot, takeFromStorage } from '../sim/inventory';
import { buyStockPart } from '../sim/economy';
import { makePart } from '../sim/factory';
import type { GridItem, World } from '../sim/types';
import { advanceContracts, siteOf, type Contract } from '../sim/market';
import { advanceJobs } from '../sim/jobs';
import { CHASSIS } from '../data/chassis';
import { CRATE_MASS } from '../data/goods';
import { addGoods } from '../sim/inventory';
import { goodsCount } from '../sim/grid';
import { itemMass, vehicleMass } from '../sim/mass';
import { clearGame, clearSlot, hasSave, loadWorld, packExplored, SaveError, unpackExplored, saveKey, saveInTown, isDayStart, saveOf, savedRunId, saveWorld, SaveHold, writeSave } from './save';
import { memoryBackend, SaveSlots } from './save-db';
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';
import { TEST_MAP } from '../test/map';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { breakProp, oldSpotOf, oldSpotPicks, oldStockId } from '../sim/salvage';
import { sunAt } from '../sim/sun';
import { practiceContacts, refreshVision } from '../sim/vision';
import { TIME } from '../data/time';
import { MIGRATIONS, SAVE_FORMAT, SAVE_MAJOR } from './save-migrations';
import SAVED_SHAPE from './save-shape.json';
import { allSlots, type SlotId } from './save-slots';
import { lostQuestNames, newGameShape, questNames } from '../test/save-shape';
import { chooseQuestOption, QUESTS, questView, startQuest } from '../sim/quests';
import { defaultSetup, parseSetup } from '../sim/settings';

const SLOTS = allSlots(3);
const RUN = 'run-1';

function makeSlots(): SaveSlots {
  return new SaveSlots(memoryBackend(), new Map());
}

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

type Saved = { player: { explored: unknown }; obstacles: { id: string }[]; vehicles: object[]; broken: object[] };

function savedWorldOf(slots: SaveSlots, slot: SlotId): Saved {
  return (slots.get(slot) as { world: Saved }).world;
}

describe('game save', () => {
  it('saves by hand on any turn and clears for a new game', () => {
    const slots = makeSlots();
    const world = { ...newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')), turn: 7 };
    writeSave(slots, 'auto', world, RUN, 1000);
    expect(hasSave(slots, SLOTS)).toBe(true);
    expect(loadWorld(slots, 'auto', TEST_MAP)).toEqual(world);
    clearSlot(slots, 'auto');
    expect(hasSave(slots, SLOTS)).toBe(false);
  });

  it('clears the save and the seen tips for a new game, and keeps sound settings', () => {
    const slots = makeSlots();
    const storage = makeStorage();
    writeSave(slots, 'auto', newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')), RUN, 1000);
    storage.setItem('roam.tips', JSON.stringify(['waypoint']));
    storage.setItem('roam.tipsOff', '1');
    storage.setItem('roam-sound', '{}');
    clearGame(slots, storage);
    expect(slots.has('auto')).toBe(false);
    expect([storage.getItem('roam.tips'), storage.getItem('roam.tipsOff'), storage.getItem('roam-sound')]).toEqual([null, null, '{}']);
  });

  it('saves a command on a town pad at once, and not out in the open', () => {
    const slots = makeSlots();
    const open = emptyWorld({ x: 30, y: 30 });
    saveInTown(slots, open, RUN, 1000);
    expect(hasSave(slots, SLOTS)).toBe(false);
    const inTown = emptyWorld(sitePads(REGION.towns[0])[0]);
    saveInTown(slots, inTown, RUN, 1000);
    expect(hasSave(slots, SLOTS)).toBe(true);
  });

  it('loads a save that holds an aim at a missing part as a body shot', () => {
    const slots = makeSlots();
    const world = emptyWorld();
    const foe = world.vehicles[1] ?? addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
    world.vehicles[0].weaponOrders = { w1: { targetId: foe.id, aim: 'gone-part' } };
    writeSave(slots, 'auto', world, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP);
    expect(loaded?.vehicles[0].weaponOrders.w1).toEqual({ targetId: foe.id, aim: 'body' });
  });

  it('loads a save with overdrive on and a worn engine as not overdriving, and clears the flag on the next update', () => {
    const slots = makeSlots();
    const world = emptyWorld();
    world.player.overdrive = true;
    mountedParts(world.vehicles[0], 'engine')[0].hp = 5;
    writeSave(slots, 'auto', world, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    expect(inOverdrive(loaded, playerVehicle(loaded))).toBe(false);
    expect(update(loaded, () => {}).player.overdrive).toBe(false);
  });

  it('keeps a held haul with the reward and deadline it was accepted with, through a reload and a turn before its deadline', () => {
    const slots = makeSlots();
    const world = emptyWorld();
    // Terms of the old rule: a tier 3 wage and a window of eight times the estimate.
    const haul: Contract = { id: 'ct-h', shop: 'bowl', kind: 'haul', good: 'tools', units: 8, to: 'granary', reward: 1328, deadline: 934, window: 934, rush: false, tier: 3 };
    world.player.contracts = [haul];
    writeSave(slots, 'auto', world, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP);
    if (!loaded) throw new Error('Expected saved haul');
    expect(loaded.player.contracts).toEqual([haul]);
    const after = update(loaded, (d) => advanceContracts(d));
    expect(after.player.contracts).toEqual([haul]);
  });
  it('keeps a held bounty across a reload, and a knockout after it fulfils the bounty once', () => {
    const slots = makeSlots();
    const world = emptyWorld();
    const raider = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const bounty: Contract = { id: 'ct-b', shop: 'bowl', kind: 'bounty', template: 'buggy', reward: 100, deadline: 900, window: 900, tier: 1, fulfilled: false };
    world.player.contracts = [bounty];
    writeSave(slots, 'auto', world, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP);
    if (!loaded) throw new Error('Expected saved bounty');
    expect(loaded.player.contracts).toEqual([bounty]);
    const after = update(loaded, (d) => {
      d.events = [{ t: 'npcKnockout', vehicle: raider.id, by: d.player.vehicleId }];
      advanceContracts(d);
    });
    expect(after.events.filter((e) => e.t === 'contract')).toEqual([{ t: 'contract', contract: { ...bounty, fulfilled: true }, outcome: 'fulfilled' }]);
    expect(after.player.money).toBe(loaded.player.money);
    writeSave(slots, 'auto', after, RUN, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)?.player.contracts).toEqual([{ ...bounty, fulfilled: true }]);
  });

  it('loads light and heavy crates, a haul, a cost basis and hidden goods as they were saved', () => {
    const slots = makeSlots();
    const world = emptyWorld();
    const truck = world.vehicles[0];
    const held = goodsCount(truck);
    expect(addGoods(world, truck, 'electronics', 3)).toBe(3);
    expect(addGoods(world, truck, 'tools', 2)).toBe(2);
    const haul: Contract = { id: 'ct-h', shop: 'bowl', kind: 'haul', good: 'salt', units: 4, to: 'nose', reward: 900, deadline: 900, window: 900, rush: false, tier: 1 };
    expect(addGoods(world, truck, 'salt', 4)).toBe(4);
    world.player.contracts = [haul];
    world.player.costBasis = { electronics: 5000, tools: 3500, salt: 867 };
    world.salvage.push({ id: 'sv-x', pos: { x: 34, y: 30 }, radius: 1, goods: { scrap: 2 }, parts: [], hidden: { goods: { batteries: 3 }, parts: [], fuel: 0, supplies: 0 } });
    writeSave(slots, 'auto', world, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    const loadedTruck = loaded.vehicles[0];
    expect(loadedTruck.items).toEqual(truck.items);
    expect(goodsCount(loadedTruck)).toEqual({ ...held, electronics: 3, tools: 2, salt: 4 });
    expect(loaded.player.contracts).toEqual([haul]);
    expect(loaded.player.money).toBe(world.player.money);
    expect(loaded.player.xp).toBe(world.player.xp);
    expect(loaded.player.costBasis).toEqual(world.player.costBasis);
    expect(loaded.salvage.find((s) => s.id === 'sv-x')?.hidden.goods).toEqual({ batteries: 3 });
    expect(loaded.events).toEqual(world.events);
    const crates = Object.values(held).reduce((sum, n) => sum + n, 0) + 9;
    const partsMass = loadedTruck.items.filter((it) => it.kind === 'part').reduce((sum, it) => sum + itemMass(it), 0);
    expect(vehicleMass(loadedTruck)).toBe(CHASSIS[loadedTruck.chassisId].mass + partsMass + crates * CRATE_MASS);
  });

  it('resumes a pending refit after loading without losing progress', () => {
    const slots = makeSlots();
    const world = emptyWorld();
    const weapon = world.vehicles[0].items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon) throw new Error('Expected weapon');
    const to = { x: 3, y: CHASSIS.scout.layout.length, rot: 1 as const };
    const next = moveItem(world, weapon.id, to);
    advanceJobs(next);
    writeSave(slots, 'auto', next, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP);
    if (!loaded) throw new Error('Expected saved refit');
    expect(loaded.vehicles[0].job).toEqual(next.vehicles[0].job);
    for (let turn = 0; turn < 4; turn++) advanceJobs(loaded);
    expect(loaded.vehicles[0].job).toBeNull();
    expect(loaded.vehicles[0].items.find((item) => item.id === weapon.id)).toMatchObject(to);
  });

  it('keeps a part bought into storage at a stall, and takes it out after loading', () => {
    const slots = makeSlots();
    let world = emptyWorld(sitePads(siteOf('pump-station'))[0]);
    world.player.money = 100000;
    const part = world.shops['pump-station'].stock[0];
    while (canStowPart(world.vehicles[0], makePart(world, part.defId, 0))) stowPart(world, world.vehicles[0], makePart(world, part.defId, 0));
    world = buyStockPart(world, part.id);
    writeSave(slots, 'auto', world, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP);
    if (!loaded) throw new Error('Expected save');
    expect(loaded.player.storage.find((p) => p.id === part.id)).toEqual({ ...part });
    const stored = loaded.player.storage.find((p) => p.id === part.id)!;
    const probe: GridItem = { id: 'probe', x: 0, y: 0, rot: 0, kind: 'part', part: stored };
    let freed = loaded;
    let spot = stowSpot(freed.vehicles[0], probe);
    while (!spot) {
      const filler = freed.vehicles[0].items.filter((it) => it.kind === 'part').at(-1);
      if (!filler) throw new Error('Expected room for the stored part');
      freed = storePart(freed, filler.id);
      spot = stowSpot(freed.vehicles[0], probe);
    }
    const back = takeFromStorage(freed, part.id, spot);
    expect(back.vehicles[0].items.some((it) => it.kind === 'part' && it.part.id === part.id)).toBe(true);
  });

  it.each(['dustwell', 'green-pit'])('keeps the shop of the outpost %s across a save and a load and awards nothing', (id) => {
    const slots = makeSlots();
    const world = emptyWorld(sitePads(siteOf(id))[0]);
    world.player.money = 100000;
    const bought = buyStockPart(world, world.shops[id].stock[0].id);
    const xp = structuredClone(bought.player.xp);
    writeSave(slots, 'auto', bought, RUN, 1000);
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    expect(loaded.shops[id]).toEqual(bought.shops[id]);
    expect(loaded.player.money).toBe(bought.player.money);
    expect(loaded.player.xp).toEqual(xp);
    expect(loaded.events).toEqual([]);
  });

  it('stores explored as a string', () => {
    const slots = makeSlots();
    writeSave(slots, 'auto', newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')), RUN, 1000);
    expect(typeof savedWorldOf(slots, 'auto').player.explored).toBe('string');
  });

  it('rejects explored of the wrong length', () => {
    const slots = makeSlots();
    writeSave(slots, 'auto', newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')), RUN, 1000);
    const save = slots.get('auto') as { world: Saved };
    save.world.player.explored = 'AAAA';
    slots.put('auto', save);
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
  });

  it('returns null when there is no saved game', () => {
    expect(loadWorld(makeSlots(), 'auto', TEST_MAP)).toBeNull();
  });

  it('restores the complete world including fields added later', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const expanded = { ...world, futureFeature: { progress: 7 } };
    saveWorld(slots, { ...expanded, turn: 21 }, RUN, 20, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)).toEqual({ ...expanded, turn: 21 });
  });

  it('rejects a save that did not parse in local storage as unreadable, without replacing it', () => {
    const slots = makeSlots();
    slots.put('auto', '{');
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(/unreadable/);
    expect(slots.get('auto')).toBe('{');
  });

  it('rejects another major format, a newer minor format and incomplete worlds', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const saved = saveOf(world).world;
    const cases = [
      [{ major: SAVE_MAJOR - 1, minor: 0 }, saved, /incompatible/],
      [{ major: SAVE_MAJOR + 1, minor: 0 }, saved, /incompatible/],
      [{ major: SAVE_MAJOR, minor: MIGRATIONS.length + 1 }, saved, /newer/],
      [{ major: SAVE_MAJOR, minor: -1 }, saved, /noFormat/],
      [SAVE_FORMAT, { turn: 21 }, /invalidWorld/],
    ] as const;
    for (const [format, savedWorld, error] of cases) {
      slots.put('auto', { format, world: savedWorld });
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(error);
    }
  });

  it('stocks every old-world loot spot of a save from before them, once', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const ids = oldSpotPicks(TEST_MAP).map(oldStockId);
    const saved = JSON.parse(JSON.stringify(saveOf(world))).world;
    saved.salvage = saved.salvage.filter((stock: { id: string }) => !oldSpotOf(stock));
    slots.put('auto', { format: { major: SAVE_MAJOR, minor: MIGRATIONS.length - 1 }, world: saved, savedAt: 1000, runId: RUN });
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    const oldIds = (w: World): string[] => w.salvage.filter((stock) => oldSpotOf(stock)).map((stock) => stock.id);
    expect(oldIds(loaded)).toEqual(ids);
    expect(loaded.salvage).toHaveLength(world.salvage.length);
    writeSave(slots, 'auto', loaded, RUN, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)).toEqual(loaded);
  });

  it('refuses a save holding only some old-world loot spots', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const saved = JSON.parse(JSON.stringify(saveOf(world))).world;
    const first = oldStockId(oldSpotPicks(TEST_MAP)[0]);
    saved.salvage = saved.salvage.filter((stock: { id: string }) => stock.id !== first);
    slots.put('auto', { format: SAVE_FORMAT, world: saved, savedAt: 1000, runId: RUN });
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(/partial/);
  });

  it('records the saved shape of the current format', () => {
    const format = `${SAVE_FORMAT.major}.${SAVE_FORMAT.minor}`;
    expect(SAVED_SHAPE.format, 'Run npm run save:shape after a new save format').toBe(format);
    expect(newGameShape(), 'The saved shape changed. Add a migration step in src/three/save-migrations.ts, then run npm run save:shape').toEqual(SAVED_SHAPE.shape);
  });

  it('records the saved quest names, so a lost name needs a new format', () => {
    expect(questNames(QUESTS), 'Saved quest names changed. A removed, renamed or retyped name needs a migration step. Then run npm run save:shape').toEqual(SAVED_SHAPE.quests);
  });

  it('finds a removed, retyped or lost checkpoint name against the recorded names', () => {
    const recorded = { world: { heard: 'boolean' as const }, local: { bowl: { trust: 'number' as const } }, checkpoints: { bowl: ['start', 'start.talk'] } };
    const current = { world: {}, local: { bowl: { trust: 'string' as const } }, checkpoints: { bowl: ['start'] } };
    expect(lostQuestNames(recorded, current)).toEqual(['World variable heard (boolean)', 'Quest bowl variable trust (number)', 'Quest bowl checkpoint start.talk']);
  });

  it('saves quest variables and the checkpoint but never ink state, and resumes there on load', () => {
    const slots = makeSlots();
    const start = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const mid = chooseQuestOption(startQuest(start, QUESTS, 'bowl_hattie', 'start'), QUESTS, 0);
    writeSave(slots, 'auto', mid, 'run', 1);
    const stored = JSON.stringify(slots.get('auto'));
    expect(stored).not.toContain('"live"');
    expect(stored).not.toContain('inkVersion');
    const loaded = loadWorld(slots, 'auto', TEST_MAP);
    expect(loaded?.player.quests.session).toEqual(mid.player.quests.session);
    expect(loaded?.player.notes).toEqual(mid.player.notes);
    expect(loaded && questView(loaded, QUESTS).choices).toEqual(questView(mid, QUESTS).choices);
    expect(loaded?.player.money).toBe(mid.player.money);
    expect(loaded?.events).toEqual([]);
  });

  it('rejects a save holding a quest variable or checkpoint this version does not know', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const cases = [
      [{ world: { gone: true }, local: {}, session: null }, /badQuests: World variable gone is not declared/],
      [{ world: {}, local: {}, session: { quest: 'bowl_hattie', checkpoint: 'nowhere', seed: 1 } }, /badQuests: Quest bowl_hattie has no checkpoint nowhere/],
      [{ world: {}, local: [], session: null }, /badQuests/],
    ] as const;
    for (const [quests, error] of cases) {
      const saved = saveOf(world).world as { player: Record<string, unknown> };
      slots.put('auto', { format: SAVE_FORMAT, world: { ...saved, player: { ...saved.player, quests } } });
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(error);
    }
  });

  it('rejects a save missing a field required for future turns', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    for (const field of ['nextId', 'rngState', 'spawnTimer', 'weather', 'broken'] as const) {
      const saved = { ...saveOf(world).world } as Record<string, unknown>;
      delete saved[field];
      slots.put('auto', { format: SAVE_FORMAT, world: saved });
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(/invalidWorld/);
    }
  });

  it('keeps baked props out of the save and rebuilds them from the map', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const baked = new Set(mapObstacles(TEST_MAP).map((o) => o.id));
    writeSave(slots, 'auto', world, RUN, 1000);
    const saved: { id: string }[] = savedWorldOf(slots, 'auto').obstacles;

    expect(baked.size).toBeGreaterThan(0);
    expect(saved.filter((o) => baked.has(o.id))).toEqual([]);
    expect(saved.length).toBe(world.obstacles.length - baked.size);
    expect(loadWorld(slots, 'auto', TEST_MAP)!.obstacles).toEqual(world.obstacles);
  });

  it('rejects a save that holds a baked prop', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    writeSave(slots, 'auto', world, RUN, 1000);
    const save = slots.get('auto') as { world: Saved };
    save.world.obstacles.push(mapObstacles(TEST_MAP)[0]);
    slots.put('auto', save);

    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(/baked/);
  });

  it('keeps a broken baked fence broken across a save and a load', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const fence = world.obstacles.find(isBreakable);
    if (!fence || !isBakedObstacle(fence)) throw new Error('The map needs a baked fence or junk pile');
    breakProp(world, fence.id, world.player.vehicleId);
    writeSave(slots, 'auto', world, RUN, 1000);

    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;

    expect(loaded.obstacles.map((o) => o.id)).not.toContain(fence.id);
    expect(loaded.obstacles).toEqual(world.obstacles);
    expect(loaded.broken).toEqual(world.broken);
  });

  it('stores no trails, visible tiles, last turn events, removed vehicles or broken prop copies, and rebuilds them on load', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const fence = world.obstacles.find(isBreakable)!;
    breakProp(world, fence.id, world.player.vehicleId);
    world.vehicles[0].trail = [{ x: 1, y: 2, heading: 0 }];
    world.events = [{ t: 'wake' }];
    world.removed = [world.vehicles[1]];
    writeSave(slots, 'auto', world, RUN, 1000);
    const saved = savedWorldOf(slots, 'auto');

    expect(saved).not.toHaveProperty('events');
    expect(saved).not.toHaveProperty('removed');
    expect(saved.player).not.toHaveProperty('visible');
    expect(saved.vehicles.filter((v: object) => 'trail' in v)).toEqual([]);
    expect(saved.broken).toEqual([{ id: fence.id, turn: world.broken[0].turn }]);
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    expect(loaded.player.visible).toEqual(world.player.visible);
    expect(loaded.broken).toEqual(world.broken);
    expect([loaded.events, loaded.removed, loaded.vehicles[0].trail]).toEqual([[], [], []]);
  });

  it('rebuilds contacts on load without paying perception XP for them again', () => {
    const slots = makeSlots();
    const world = emptyWorld({ x: 30, y: 30 });
    world.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    const buggy = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 45, y: 30 });
    buggy.speed = 6;
    practiceContacts(world, refreshVision(world));
    writeSave(slots, 'auto', world, RUN, 1000);

    expect(savedWorldOf(slots, 'auto').player).not.toHaveProperty('contacts');
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    expect(loaded.player.contacts).toEqual(world.player.contacts);
    expect(loaded.player.clouds).toEqual(world.player.clouds);
    expect([loaded.player.xp, loaded.player.repeats]).toEqual([world.player.xp, world.player.repeats]);
    practiceContacts(loaded, refreshVision(loaded));
    expect(loaded.player.xp).toEqual(world.player.xp);
  });

  it('rejects a save whose broken props do not match the map', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const rock = mapObstacles(TEST_MAP).find((o) => o.kind === 'rock')!;
    const fence = world.obstacles.find(isBreakable)!;
    const stranger = { ...fence, id: 'fence-999999' };

    for (const obstacle of [rock, stranger]) {
      writeSave(slots, 'auto', { ...world, broken: [{ obstacle, turn: 1 }] }, RUN, 1000);
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
      expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(/broken/);
    }
  });

  it('rejects a save made on another map', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    writeSave(slots, 'auto', world, RUN, 1000);
    const otherMap = { ...TEST_MAP, hash: 'ffffffff' };
    expect(() => loadWorld(slots, 'auto', otherMap)).toThrow(SaveError);
    expect(() => loadWorld(slots, 'auto', otherMap)).toThrow(/map/);
    expect(loadWorld(slots, 'auto', TEST_MAP)).toEqual(world);
  });

  it('saves only after each twentieth completed turn', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    saveWorld(slots, { ...world, turn: 20 }, RUN, 20, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)).toBeNull();
    saveWorld(slots, { ...world, turn: 21 }, RUN, 20, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)?.turn).toBe(21);
    saveWorld(slots, { ...world, turn: 22 }, RUN, 20, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)?.turn).toBe(21);
    saveWorld(slots, { ...world, turn: 41 }, RUN, 20, 1000);
    expect(loadWorld(slots, 'auto', TEST_MAP)?.turn).toBe(41);
  });

  it('never saves a dead world', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    saveWorld(slots, { ...world, turn: 21 }, RUN, 20, 1000);
    const previous = slots.get('auto');
    const dead = { ...world, turn: 41, player: { ...world.player, health: 0, state: 'dead' as const } };
    saveWorld(slots, dead, RUN, 20, 1000);
    expect(slots.get('auto')).toEqual(previous);
    expect(() => writeSave(slots, 'auto', dead, RUN, 1000)).toThrow(/dead/);
    expect(slots.get('auto')).toEqual(previous);
  });

  it('rejects an invalid interval instead of skipping saves', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    expect(() => saveWorld(slots, world, RUN, 0, 1000)).toThrow(/interval/);
  });

  it('stores no terrain and restores far routes', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const npc = world.vehicles.find((v) => v.brain);
    if (!npc?.brain) throw new Error('The start world needs an NPC');
    npc.brain.farRoute = { dest: { x: 300, y: 200 }, points: [{ x: 290, y: 205 }, { x: 300, y: 200 }], offRoad: false };
    saveWorld(slots, { ...world, turn: 21 }, RUN, 20, 1000);
    expect(savedWorldOf(slots, 'auto')).not.toHaveProperty('terrain');
    const loaded = loadWorld(slots, 'auto', TEST_MAP)!;
    expect(loaded).toEqual({ ...world, turn: 21 });
    expect(loaded.terrain).toBe(world.terrain);
  });

  it('writes the day start autosave on the first turn of a day only', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    expect([319, 320, 321, 770].map(isDayStart)).toEqual([false, true, false, true]);
    saveWorld(slots, { ...world, turn: 319 }, RUN, 20, 1000);
    saveWorld(slots, { ...world, turn: 321 }, RUN, 20, 1000);
    expect(slots.has('day')).toBe(false);
    saveWorld(slots, { ...world, turn: 320 }, RUN, 20, 1000);
    expect(loadWorld(slots, 'day', TEST_MAP)?.turn).toBe(320);
  });

  it('writes only the autosave on the interval and in town, and never a manual slot', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    saveWorld(slots, { ...world, turn: 21 }, RUN, 20, 1000);
    saveInTown(slots, emptyWorld(sitePads(REGION.towns[0])[0]), RUN, 1000);
    const written = SLOTS.filter((slot: SlotId) => hasSave(slots, [slot]));
    expect(written).toEqual(['auto']);
  });

  it('writes no slot for a dead world', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const dead = { ...world, turn: 320, player: { ...world.player, health: 0, state: 'dead' as const } };
    saveWorld(slots, dead, RUN, 20, 1000);
    expect(hasSave(slots, SLOTS)).toBe(false);
  });

  it('keeps the manual slots and the sound settings when a new game clears the autosaves', () => {
    const slots = makeSlots();
    const storage = makeStorage();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    for (const slot of SLOTS) writeSave(slots, slot, world, RUN, 1000);
    storage.setItem('roam-sound', '{}');
    clearGame(slots, storage);
    expect(SLOTS.filter((slot) => hasSave(slots, [slot]))).toEqual(['slot1', 'slot2', 'slot3']);
    expect(storage.getItem('roam-sound')).toBe('{}');
  });

  it('loads a save from before slots, with no savedAt, as the autosave', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    slots.put('auto', saveOf(world));
    expect(loadWorld(slots, 'auto', TEST_MAP)).toEqual(world);
  });

  it('holds the run id, and gives a save from before run ids one from its seed', () => {
    const slots = makeSlots();
    const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    writeSave(slots, 'auto', world, RUN, 1000);
    expect(savedRunId(slots.get('auto'))).toBe(RUN);
    expect(savedRunId(saveOf(world))).toBe('legacy-1337');
    expect(savedRunId('{')).toBeNull();
  });
});

describe('saved world settings', () => {
  const tuned = (damage: number, fuelUse: number) => parseSetup({ mode: 'roaming', settings: { damage, fuelUse, supplyUse: 1 } });

  function storedWith(setup: unknown): SaveSlots {
    const slots = makeSlots();
    const save = JSON.parse(JSON.stringify(saveOf(newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')))));
    save.world.setup = setup;
    if (setup === undefined) delete save.world.setup;
    slots.put('auto', save);
    return slots;
  }

  it('keeps each slot its own setup across a save and a load', () => {
    const slots = makeSlots();
    writeSave(slots, 'slot1', newWorld(1337, startKit('standard'), TEST_MAP, tuned(1.5, 2)), RUN, 1000);
    writeSave(slots, 'slot2', newWorld(1337, startKit('standard'), TEST_MAP, tuned(0.5, 1)), RUN, 1000);

    expect(loadWorld(slots, 'slot1', TEST_MAP)?.setup).toEqual(tuned(1.5, 2));
    expect(loadWorld(slots, 'slot2', TEST_MAP)?.setup).toEqual(tuned(0.5, 1));
  });

  it('gives a save from format 2.13 the default Roaming setup, once', () => {
    const slots = makeSlots();
    const save = JSON.parse(JSON.stringify(saveOf(newWorld(1337, startKit('standard'), TEST_MAP, tuned(2, 2)))));
    delete save.world.setup;
    save.world.events = [];
    save.world.removed = [];
    for (const vehicle of save.world.vehicles) vehicle.trail = [];
    slots.put('auto', { ...save, format: { major: SAVE_MAJOR, minor: 13 } });
    writeSave(slots, 'slot1', newWorld(1337, startKit('standard'), TEST_MAP, tuned(2, 2)), RUN, 1000);

    expect(loadWorld(slots, 'auto', TEST_MAP)?.setup).toEqual(defaultSetup('roaming'));
    expect(loadWorld(slots, 'slot1', TEST_MAP)?.setup).toEqual(tuned(2, 2));
  });

  it.each([
    ['NaN, which JSON stores as null', { mode: 'roaming', settings: { damage: NaN, fuelUse: 1, supplyUse: 1 } }],
    ['zero', { mode: 'roaming', settings: { damage: 1, fuelUse: 0, supplyUse: 1 } }],
    ['a runaway value', { mode: 'roaming', settings: { damage: 10, fuelUse: 1, supplyUse: 1 } }],
    ['an unknown mode', { mode: 'campaign', settings: { damage: 1, fuelUse: 1, supplyUse: 1 } }],
    ['no setup at the current format', undefined],
  ])('rejects a save with %s as a save error', (_, setup) => {
    expect(() => loadWorld(storedWith(setup), 'auto', TEST_MAP)).toThrow(SaveError);
    expect(() => loadWorld(storedWith(setup), 'auto', TEST_MAP)).toThrow(/badSetup/);
  });
});

describe('saveKey', () => {
  it('keeps the plain key for an unscoped build', () => {
    expect(saveKey('')).toBe('roam.save');
  });

  it('adds the scope to the key', () => {
    expect(saveKey('factory')).toBe('roam.save.factory');
  });

  it('throws a SaveError when a migration step cannot read an old save', () => {
    const slots = makeSlots();
    slots.put('auto', { format: { major: SAVE_MAJOR, minor: 0 }, world: { vehicles: 5, player: 7 } });
    expect(() => loadWorld(slots, 'auto', TEST_MAP)).toThrow(SaveError);
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

describe('full browser storage', () => {
  it('keeps the slot in memory and reports the failure when the backend refuses a write', async () => {
    const backend = memoryBackend();
    const slots = new SaveSlots(backend, new Map());
    const errors: unknown[] = [];
    slots.onError = (err) => errors.push(err);
    const world = { ...newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')), turn: 21 };
    writeSave(slots, 'auto', world, RUN, 1000);
    await slots.flush();
    const quota = new DOMException('quota', 'QuotaExceededError');
    backend.put = () => Promise.reject(quota);
    writeSave(slots, 'auto', { ...world, turn: 22 }, RUN, 2000);
    await slots.flush();
    expect(errors).toEqual([quota]);
    expect((await backend.readAll()).has('auto')).toBe(true);
  });
});
