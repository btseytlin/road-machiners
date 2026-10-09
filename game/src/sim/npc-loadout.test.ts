import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { NPC_UTILITY_PARTS, type UtilityRoll } from '../data/npc-utilities';
import { CHASSIS } from '../data/chassis';
import { GEAR_LEVEL_IDS, GEAR_LEVELS, MAX_GUN_SLOWDOWN, MIN_NPC_SPEED, NPC_WEAR, NPCS, PRIORITY_TOP, type GearLevel, type LoadoutPriorities, type NpcTemplate } from '../data/npcs';
import { PARTS, partDef, type UtilityDef } from '../data/parts';
import { START_KITS } from '../data/start';
import { newWorld } from './world';
import { CONDITION } from '../data/wear';
import { everyGunFires } from './armor';
import { makeVehicle } from './factory';
import { coreParts, freeCells, goodsCount, gridOf, isMounted, mountedParts, placementError } from './grid';
import { itemMass, loadFactor, vehicleMass } from './mass';
import { generateNpcLoadout, sampleWeighted } from './npc-loadout';
import { spawnAt, spawnInitial, spawnNpcs } from './spawn';
import { openSides, reachedSides } from './armor';
import { mountedItems } from './grid';
import type { EngineDef, WeaponDef } from '../data/parts';
import { gunDrag, isStranded, npcMassRoom, speedShare } from './stats';
import { wornDef } from './wear';
import { addGoods, cargoRoom, removeGoods } from './inventory';
import { CRATE_MASS } from '../data/goods';
import { emptyWorld, npcBrain } from './testkit';
import type { Vehicle, World } from './types';
import { TEST_MAP } from '../test/map';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { budget } from '../test/budget';
import { defaultSetup } from './settings';

const TINY = {
  ...CHASSIS.scout,
  id: 'tiny',
  layout: CHASSIS.scout.layout.map((row, y) => (y === 0 || y === CHASSIS.scout.layout.length - 1 ? row : row.replace(/D/g, (_m, at: number) => (y === 1 && at === 4 ? 'D' : 'X')))),
};
const SHAPES = TRUCK_SHAPES as Record<string, unknown>;

let fixture: World;
beforeAll(() => {
  fixture = emptyWorld();
  CHASSIS.tiny = TINY;
  SHAPES.base_tiny = TRUCK_SHAPES.base_scout;
});
afterAll(() => { delete CHASSIS.tiny; delete SHAPES.base_tiny; });

function describeLoadout(v: Vehicle): string {
  return JSON.stringify({ chassis: v.chassisId, parts: mountedParts(v).map((p) => p.defId), goods: v.items.filter((i) => i.kind === 'good').map((i) => i.good) });
}

describe('NPC equipment generation', () => {
  it('spawns at least five equipment combinations for each base trait', () => {
    const seen: Record<string, Set<string>> = Object.fromEntries(Object.values(NPCS).map((t) => [t.traits[0], new Set<string>()]));
    for (let seed = 1; seed <= 40; seed++) {
      const world = structuredClone(fixture);
      world.rngState = seed;
      spawnInitial(world);
      for (const v of world.vehicles) {
        if (v.brain) seen[NPCS[v.brain.templateId].traits[0]].add(describeLoadout(v));
      }
    }
    for (const [role, variants] of Object.entries(seen)) expect(variants.size, role).toBeGreaterThanOrEqual(5);
  }, budget(180_000));

  it.each(Object.values(NPCS))('fits $id equipment and cargo within its budget and rated mass', (template) => {
    for (let seed = 1; seed <= 32; seed++) {
      const world = { ...fixture, rngState: seed };
      const beforeId = world.nextId;
      const loadout = generateNpcLoadout(world, template);
      expect(world.nextId).toBe(beforeId);
      const v = makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      expect(mountedParts(v, 'engine')).toHaveLength(1);
      expect(mountedParts(v, 'weapon').length).toBeGreaterThanOrEqual(1);
      for (const item of v.items) expect(placementError(gridOf(v), v.items, item, item.id)).toBeNull();
      const loose = v.items.filter((item) => item.kind === 'part' && !isMounted(v.chassisId, item));
      expect(loose).toHaveLength(loadout.spares.length);
      expect(goodsCount(v)).toEqual(loadout.cargo);
      expect(vehicleMass(v)).toBeLessThanOrEqual(CHASSIS[v.chassisId].ratedMass);
      const cost = CHASSIS[v.chassisId].value + loadout.parts.reduce((sum, p) => sum + PARTS[p.defId].value, 0);
      expect(cost).toBeLessThanOrEqual(template.loadout.budget * Math.max(1, GEAR_LEVELS[loadout.level].budget));
      expect(v.resources?.money).toBe(fixture.player.money);
    }
  });

  it('loads a trader with crates of one mass, within its rated mass', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const world = { ...fixture, rngState: seed };
      const loadout = generateNpcLoadout(world, NPCS.trader);
      const v = makeVehicle(world, { ...loadout, name: 'trader', faction: NPCS.trader.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      const crates = Object.values(loadout.cargo).reduce((sum, n) => sum + n, 0);
      expect(crates).toBeGreaterThan(0);
      const goodsMass = v.items.filter((it) => it.kind === 'good').reduce((sum, it) => sum + itemMass(it), 0);
      expect(goodsMass).toBe(crates * CRATE_MASS);
      expect(vehicleMass(v)).toBeLessThanOrEqual(CHASSIS[v.chassisId].ratedMass);
    }
  });

  it.each(['tractor', 'hauler', 'bus'])('leaves a trader on a %s room for a crate once it sells its goods', (chassisId) => {
    for (let seed = 1; seed <= 24; seed++) {
      const world = { ...fixture, rngState: seed, marketRng: { rngState: seed * 7919 + 1 } };
      const loadout = generateNpcLoadout(world, NPCS.trader, chassisId);
      const v = makeVehicle(world, { ...loadout, name: 'trader', faction: NPCS.trader.faction, brain: npcBrain('trader', { x: 50, y: 50 }, ['trader']), pos: { x: 50, y: 50 }, heading: 0 });
      for (const [good, n] of Object.entries(goodsCount(v))) if (good !== 'parts') removeGoods(v, good, n);
      expect(cargoRoom(v), `seed ${seed} ${loadout.level} ${describeLoadout(v)}`).toBeGreaterThan(0);
    }
  });

  const withPriorities = (template: NpcTemplate, change: Partial<LoadoutPriorities>): NpcTemplate => ({ ...template, loadout: { ...template.loadout, priorities: { ...template.loadout.priorities, ...change } } });
  const rolled = (template: NpcTemplate, level: GearLevel | null, seed: number): Vehicle => {
    const world = { ...fixture, rngState: seed, marketRng: { rngState: seed * 104729 + 1 } };
    const loadout = generateNpcLoadout(world, template, null, level);
    return makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
  };
  const average = (template: NpcTemplate, level: GearLevel | null, of: (v: Vehicle) => number) => {
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) total += of(rolled(template, level, seed));
    return total / 12;
  };
  const guns = (v: Vehicle) => mountedItems(v, 'weapon').filter((item) => !(partDef(item.part.defId) as WeaponDef).line).length;

  describe('loadout priorities', () => {
    it('gives a template with no firepower priority few guns past its main one', () => {
      const template = withPriorities(NPCS.gunwagon, { firepower: 0 });
      for (const level of GEAR_LEVEL_IDS) expect(average(template, level, guns)).toBeLessThanOrEqual(1.6);
    }, budget(120_000));

    it.each([['gunwagon', 0.75], ['trader', 0.75], ['buggy', 0.35], ['courier', 0.75]])('gives most %s trucks a gun that fires at the rear', (id, share) => {
      const rearGun = (v: Vehicle) => (mountedItems(v, 'weapon').some((g) => reachedSides(partDef(g.part.defId) as WeaponDef).includes('rear') && openSides(v, g).includes('rear')) ? 1 : 0);
      expect(average(NPCS[id], 'standard', rearGun)).toBeGreaterThanOrEqual(share);
    }, budget(120_000));

    it('lets a poor driver buy some armor', () => {
      const armor = (v: Vehicle) => (mountedItems(v, 'armor').length > 0 ? 1 : 0);
      expect(average(NPCS.courier, 'poor', armor)).toBeGreaterThanOrEqual(0.75);
    }, budget(120_000));

    it('gives more guns for more firepower', () => {
      const low = average(withPriorities(NPCS.gunwagon, { firepower: 1 }), 'standard', guns);
      const high = average(withPriorities(NPCS.gunwagon, { firepower: PRIORITY_TOP }), 'standard', guns);
      expect(high).toBeGreaterThan(low);
    }, budget(120_000));

    it('stops extra guns before they slow a loaded truck past the limit', () => {
      for (let seed = 1; seed <= 12; seed++) {
        const v = rolled(NPCS.gunwagon, 'loaded', seed);
        const engine = mountedItems(v, 'engine')[0];
        expect(1 - gunDrag(v, (partDef(engine.part.defId) as EngineDef).capacity), describeLoadout(v)).toBeLessThanOrEqual(MAX_GUN_SLOWDOWN);
      }
    }, budget(120_000));

    it('leaves more cargo room for more cargo priority', () => {
      const room = (template: NpcTemplate) => average(template, 'loaded', (v) => npcMassRoom(v, speedShare(template.loadout.priorities)));
      expect(room(withPriorities(NPCS.trader, { cargo: PRIORITY_TOP }))).toBeGreaterThan(room(withPriorities(NPCS.trader, { cargo: 0 })));
    }, budget(120_000));

    it('keeps a faster truck for more speed priority', () => {
      const speed = (template: NpcTemplate) => average(template, 'heavy', topSpeed);
      expect(speed(withPriorities(NPCS.gunwagon, { speed: PRIORITY_TOP }))).toBeGreaterThan(speed(withPriorities(NPCS.gunwagon, { speed: 0 })));
    }, budget(120_000));
  });

  function topSpeed(v: Vehicle): number {
    const engine = wornDef<EngineDef>(mountedParts(v, 'engine')[0]);
    return (CHASSIS[v.chassisId].maxSpeed + engine.speedBonus) * loadFactor(v) * gunDrag(v, engine.capacity);
  }

  it.each(Object.values(NPCS))('keeps $id at MIN_NPC_SPEED on its worn engine at every gear level', (template) => {
    for (const level of GEAR_LEVEL_IDS) {
      for (let seed = 1; seed <= 12; seed++) {
        const v = rolled(template, level, seed);
        expect(topSpeed(v), `${level} ${describeLoadout(v)}`).toBeGreaterThanOrEqual(MIN_NPC_SPEED - 1e-9);
      }
    }
  }, budget(120_000));

  it('rolls engine wear by the same odds as other parts', () => {
    const wears = Object.values(NPCS).flatMap((template) => Array.from({ length: 12 }, (_, i) => mountedParts(rolled(template, 'standard', i + 1), 'engine')[0].wear));
    const worn = wears.filter((wear) => wear >= 3).length / wears.length;
    const odds = NPC_WEAR.filter((w) => w.value >= 3).reduce((sum, w) => sum + w.weight, 0) / NPC_WEAR.reduce((sum, w) => sum + w.weight, 0);
    expect(worn).toBeGreaterThan(odds * 0.8);
  }, budget(120_000));

  it('gives an NPC no cargo past its speed floor, and the player any', () => {
    const rolls = Array.from({ length: 20 }, (_, i) => {
      const world = { ...structuredClone(fixture), rngState: i + 1 };
      const npc = spawnAt(world, NPCS.gunwagon, { ...generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded'), cargo: {}, spares: [] }, { x: 50, y: 50 });
      return { world, npc };
    });
    const { world, npc } = rolls.find(({ npc }) => Math.floor(npcMassRoom(npc) / CRATE_MASS) < freeCells(npc))!;
    const room = npcMassRoom(npc);
    const added = addGoods(world, npc, 'tools', 1000);
    expect(added).toBe(Math.floor(room / CRATE_MASS));
    const player = spawnAt(world, NPCS.gunwagon, { ...generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded'), cargo: {}, spares: [] }, { x: 60, y: 50 });
    player.brain = null;
    const playerFree = freeCells(player);
    expect(addGoods(world, player, 'tools', 1000)).toBe(playerFree);
  });

  it.each(Object.values(NPCS))('gives $id only guns that can fire', (template) => {
    for (let seed = 1; seed <= 32; seed++) {
      const world = { ...fixture, rngState: seed };
      const loadout = generateNpcLoadout(world, template);
      const v = makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      expect(everyGunFires(v), describeLoadout(v)).toBe(true);
    }
  });

  it('filters an oversized weapon before rolling, even with a high weight', () => {
    const template = structuredClone(NPCS.buggy);
    template.loadout.chassis = [{ value: 'tiny', weight: 1 }];
    template.loadout.engine = [{ value: 'stockEngine', weight: 1 }];
    template.loadout.weapon = [{ value: 'cannon', weight: 1000 }, { value: 'mg', weight: 1 }];
    const loadout = generateNpcLoadout({ ...fixture }, template);
    expect(loadout.parts.map((p) => p.defId)).toContain('mg');
    expect(loadout.parts.map((p) => p.defId)).not.toContain('cannon');
  });

  it('reserves the budget for both required parts before choosing an engine', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.budget = CHASSIS.hauler.value + PARTS.stockEngine.value + PARTS.mg.value;
    template.loadout.chassis = [{ value: 'hauler', weight: 1 }];
    template.loadout.engine = [{ value: 'turbine', weight: 1000 }, { value: 'stockEngine', weight: 1 }];
    template.loadout.weapon = [{ value: 'mg', weight: 1 }];
    const loadout = generateNpcLoadout({ ...fixture }, template, null, 'poor');
    expect(loadout.parts.map((p) => p.defId)).toEqual(['stockEngine', 'mg']);
  });

  it('rejects impossible required equipment without consuming RNG or IDs', () => {
    const template = structuredClone(NPCS.buggy);
    template.loadout.chassis = [{ value: 'tiny', weight: 1 }];
    template.loadout.weapon = [{ value: 'cannon', weight: 1 }];
    const world = { ...fixture };
    expect(() => generateNpcLoadout(world, template)).toThrow(/No valid required/);
    expect(world).toEqual(fixture);
  });

  it.each([
    ['unknown cargo', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'missing', count: 1 }, weight: 1 }]; }],
    ['wrong part kind', (t: NpcTemplate) => { t.loadout.weapon = [{ value: 'stockEngine', weight: 1 }]; }],
    ['negative count', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'scrap', count: -1 }, weight: 1 }]; }],
    ['invalid budget', (t: NpcTemplate) => { t.loadout.budget = Infinity; }],
    ['empty chassis pool', (t: NpcTemplate) => { t.loadout.chassis = []; }],
    ['unknown chassis', (t: NpcTemplate) => { t.loadout.chassis = [{ value: 'missing', weight: 1 }]; }],
    ['invalid optional weight', (t: NpcTemplate) => { t.loadout.armor = [{ value: 'plates', weight: 0 }]; }],
    ['an unknown gear level', (t: NpcTemplate) => { t.loadout.levels = [{ value: 'shiny' as GearLevel, weight: 1 }]; }],
    ['no firepower or armor priority', (t: NpcTemplate) => { t.loadout.priorities = { ...t.loadout.priorities, firepower: 0, armor: 0 }; }],
    ['impossible optional part', (t: NpcTemplate) => { t.loadout.chassis = [{ value: 'tiny', weight: 1 }]; t.loadout.cargoPart = [{ value: 'heavyFrame', weight: 1 }]; }],
    ['impossible cargo', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'scrap', count: 1000 }, weight: 1 }]; }],
    ['a core part in the spare pool', (t: NpcTemplate) => { t.loadout.spares = { pool: [{ value: 'cab', weight: 1 }], count: [{ value: 1, weight: 1 }] }; }],
    ['a negative spare count', (t: NpcTemplate) => { t.loadout.spares = { pool: [{ value: null, weight: 1 }], count: [{ value: -1, weight: 1 }] }; }],
  ] as const)('fails loudly on %s without changing the input world', (_name, invalidate) => {
    const world = { ...fixture };
    const template = structuredClone(NPCS.buggy);
    invalidate(template);
    expect(() => generateNpcLoadout(world, template)).toThrow();
    expect(world).toEqual(fixture);
  });

  it('uses the same generator for periodic spawns without exceeding existing caps', () => {
    const world = structuredClone(fixture);
    for (let attempt = 0; attempt < Math.max(...Object.values(NPCS).map((t) => t.cap)) + 2; attempt++) {
      for (const template of Object.values(NPCS)) world.spawnTimer[template.id] = 1;
      spawnNpcs(world);
      world.vehicles.filter((v) => v.brain).forEach((v, i) => { v.pos = { x: 5 + (i % 40) * 4, y: world.size - 5 - Math.floor(i / 40) * 4 }; });
    }
    for (const template of Object.values(NPCS)) {
      const vehicles = world.vehicles.filter((v) => v.brain?.templateId === template.id);
      expect(vehicles.length, template.id).toBe(template.cap);
      expect(new Set(vehicles.map(describeLoadout)).size).toBeGreaterThan(1);
    }
  });

  it('repeats the same initial traffic and RNG state for the same seed', () => {
    const a = structuredClone(fixture);
    const b = structuredClone(fixture);
    spawnInitial(a);
    spawnInitial(b);
    expect(a.vehicles).toEqual(b.vehicles);
    expect(a.rngState).toBe(b.rngState);
  });
});

describe('part wear', () => {
  it.each(Object.values(NPCS))('rolls a wear step within the world wear table for every mounted, non-core part of $id', (template) => {
    const rolled = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const loadout = generateNpcLoadout({ ...fixture, rngState: seed, marketRng: { rngState: seed * 7919 } }, template);
      const shift = GEAR_LEVELS[loadout.level].wearShift;
      const allowed = new Set(NPC_WEAR.map((entry) => Math.min(CONDITION.maxWear, Math.max(0, entry.value + shift))));
      for (const { defId: id, wear } of loadout.parts) {
        expect(wear, id).toBeGreaterThanOrEqual(0);
        expect(wear, id).toBeLessThanOrEqual(CONDITION.maxWear);
        expect(allowed, id).toContain(wear);
        rolled.add(wear);
      }
    }
    expect(rolled.size, `${template.id} wear variety`).toBeGreaterThan(1);
  });

  it('rolls the same wear for the same seed', () => {
    const loadoutA = generateNpcLoadout({ ...fixture, rngState: 7 }, NPCS.trader);
    const loadoutB = generateNpcLoadout({ ...fixture, rngState: 7 }, NPCS.trader);
    expect(loadoutA.parts).toEqual(loadoutB.parts);
    expect(loadoutA.spares).toEqual(loadoutB.spares);
  });

  it('makes pristine parts rare and near-junk parts common at the standard level', () => {
    const wears: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      for (const p of generateNpcLoadout({ ...fixture, rngState: seed, marketRng: { rngState: seed * 7919 } }, NPCS.trader, null, 'standard').parts) wears.push(p.wear);
    }
    const share = (wear: number) => wears.filter((w) => w === wear).length / wears.length;
    expect(share(0)).toBeLessThan(0.08);
    expect(share(CONDITION.maxWear)).toBeGreaterThan(0.4);
  });

  it('a poor level wears parts more than a loaded one', () => {
    const mean = (level: GearLevel) => {
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 20; seed++) {
        for (const p of generateNpcLoadout({ ...fixture, rngState: seed, marketRng: { rngState: seed * 7919 } }, NPCS.merc, null, level).parts) [sum, n] = [sum + p.wear, n + 1];
      }
      return sum / n;
    };
    expect(mean('poor')).toBeGreaterThan(mean('loaded'));
  });
});

describe('trader spare parts', () => {
  it('carries rolled spares when it has grid room and rated mass to spare', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.chassis = [{ value: 'hauler', weight: 1 }];
    template.loadout.cargoPart = [{ value: null, weight: 1 }];
    template.loadout.goods = [{ value: null, weight: 1 }];
    template.loadout.spares = { pool: [{ value: 'mg', weight: 1 }], count: [{ value: 2, weight: 1 }] };
    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, template, null, 'poor');
    expect(loadout.spares.length).toBeGreaterThan(0);
    for (const spare of loadout.spares) {
      expect(spare.defId).toBe('mg');
      expect(spare.wear).toBeGreaterThanOrEqual(0);
      expect(spare.wear).toBeLessThanOrEqual(CONDITION.maxWear);
    }
  });

  it('carries no spares once cargo and repair parts already fill the grid', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.chassis = [{ value: 'buggy', weight: 1 }];
    template.loadout.cargoPart = [{ value: null, weight: 1 }];
    template.loadout.spares = { pool: [{ value: 'mg', weight: 1 }], count: [{ value: 3, weight: 1 }] };
    let free = 1;
    for (let i = 0; i < 10; i++) {
      template.loadout.goods = [{ value: { good: 'textiles', count: free }, weight: 1 }];
      const rolled = generateNpcLoadout({ ...fixture, rngState: 3 }, template);
      const room = freeCells(makeVehicle(fixture, { ...rolled, spares: [], cargo: { parts: rolled.cargo.parts }, name: 'probe', faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 }));
      if (room === free) break;
      free = room;
    }
    template.loadout.goods = [{ value: { good: 'textiles', count: free }, weight: 1 }];
    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, template);
    expect(loadout.cargo.textiles).toBe(free);
    expect(loadout.spares).toEqual([]);
  });

  it('never rolls spares for a template with no spare table', () => {
    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, NPCS.buggy);
    expect(loadout.spares).toEqual([]);
  });
});

describe('weighted equipment rolls', () => {
  it('draws rare equipment less often than common equipment', () => {
    const rng = { rngState: 42 };
    const pool = [{ value: 'common', weight: 9 }, { value: 'rare', weight: 1 }];
    const rolls = Array.from({ length: 1000 }, () => sampleWeighted(rng, pool));
    const rare = rolls.filter((value) => value === 'rare').length;
    expect(rare).toBeGreaterThan(0);
    expect(rare).toBeLessThan(200);
  });

  it.each([0, -1, NaN, Infinity])('rejects weight %s before consuming randomness', (weight) => {
    const rng = { rngState: 42 };
    expect(() => sampleWeighted(rng, [{ value: 'bad', weight }])).toThrow(/weights/);
    expect(rng.rngState).toBe(42);
  });

  it('rejects an empty pool and overflowing total', () => {
    const rng = { rngState: 42 };
    expect(() => sampleWeighted(rng, [])).toThrow(/Empty/);
    expect(() => sampleWeighted(rng, [{ value: 'a', weight: Number.MAX_VALUE }, { value: 'b', weight: Number.MAX_VALUE }])).toThrow(/total/);
    expect(rng.rngState).toBe(42);
  });
});

describe('spawned NPCs', () => {
  it('carry the rolled wear and spares into the world', () => {
    const world = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const npcs = world.vehicles.filter((v) => v.brain !== null);
    const parts = npcs.flatMap((v) => v.items.flatMap((it) => (it.kind === 'part' && partDef(it.part.defId).kind !== 'core' ? [it.part] : [])));
    expect(parts.some((p) => p.wear > 0)).toBe(true);
    const traders = [1, 2, 3, 4].flatMap((seed) => newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming')).vehicles.filter((v) => v.brain?.templateId === 'trader'));
    expect(traders.some((v) => v.items.some((it) => it.kind === 'part' && !isMounted(v.chassisId, it)))).toBe(true);
  });
});

describe('NPC gun placement', () => {
  it('never mounts a gun where no open side lets its arc fire', () => {
    for (const id of ['gunwagon', 'buggy', 'noseArmy', 'merc']) {
      for (let seed = 1; seed <= 40; seed++) {
        const w = emptyWorld();
        w.rngState = seed * 7919;
        const v = spawnAt(w, NPCS[id], generateNpcLoadout(w, NPCS[id]), { x: 40, y: 30 });
        for (const item of mountedItems(v, 'weapon')) {
          const reach = reachedSides(partDef(item.part.defId) as WeaponDef);
          expect(openSides(v, item).some((side) => reach.includes(side)), `${id} seed ${seed} ${item.part.defId}`).toBe(true);
        }
      }
    }
  });
});

describe('NPC loadout tables', () => {
  it('every chassis in every table rolls a loadout', () => {
    for (const tpl of Object.values(NPCS)) {
      for (const { value } of tpl.loadout.chassis) {
        expect(() => generateNpcLoadout(emptyWorld(), tpl, value), `${tpl.id} on ${value}`).not.toThrow();
      }
    }
  });

  it('every chassis in every table holds the speed floor on its most worn engine', () => {
    for (const tpl of Object.values(NPCS)) {
      for (const { value } of tpl.loadout.chassis) {
        for (let seed = 1; seed <= 8; seed++) {
          const world = { ...emptyWorld(), rngState: seed, marketRng: { rngState: seed * 104729 + 1 } };
          expect(() => generateNpcLoadout(world, tpl, value, 'poor'), `${tpl.id} on ${value}`).not.toThrow();
        }
      }
    }
  }, budget(120_000));

  it('every rolled truck can drive: one working engine, one transmission, a cab, a tank and wheels', () => {
    for (const tpl of Object.values(NPCS)) {
      for (const { value } of tpl.loadout.chassis) {
        for (let seed = 1; seed <= 8; seed++) {
          const world = emptyWorld();
          world.rngState = seed;
          const v = spawnAt(world, tpl, generateNpcLoadout(world, tpl, value), { x: 40, y: 30 });
          const label = `${tpl.id} on ${value} seed ${seed}: ${describeLoadout(v)}`;
          expect(coreParts(v, 'transmission'), label).toHaveLength(1);
          expect(coreParts(v, 'cab'), label).toHaveLength(1);
          expect(coreParts(v, 'tank'), label).toHaveLength(1);
          expect(coreParts(v, 'wheel').length, label).toBeGreaterThanOrEqual(4);
          expect(mountedParts(v, 'engine'), label).toHaveLength(1);
          expect(isStranded(world, v), label).toBe(false);
        }
      }
    }
  });
});

describe('raider gear levels', () => {
  it('never roll the poor level', () => {
    for (const template of Object.values(NPCS).filter((t) => t.traits.includes('raider'))) {
      expect(template.loadout.levels.map((l) => l.value), template.id).not.toContain('poor');
    }
  });
});

describe('armed choice cache', () => {
  const rolled = (id: string, seed: number, level: GearLevel) => {
    const w = emptyWorld();
    w.rngState = seed;
    const loadout = generateNpcLoadout(w, NPCS[id], null, level);
    return { loadout, rngState: w.rngState, marketRng: w.marketRng, nextId: w.nextId };
  };

  it('gives the same loadout for the same inputs in any call order', () => {
    const first = rolled('gunwagon', 3, 'loaded');
    rolled('trader', 5, 'poor');
    expect(rolled('gunwagon', 3, 'loaded')).toEqual(first);
  });

  it('reads the pools of a table edited in place', () => {
    const template: NpcTemplate = structuredClone(NPCS.gunwagon);
    const mainGun = () => generateNpcLoadout(emptyWorld(), template, null, 'poor').parts.find((p) => partDef(p.defId).kind === 'weapon')!.defId;
    expect(template.loadout.weapon.map((w) => w.value)).toContain(mainGun());
    template.loadout.weapon = [{ value: 'mg', weight: 1 }];
    expect(mainGun()).toBe('mg');
  });
});

function withUtilityPool(templateId: string, pool: UtilityRoll[]): void {
  const saved = NPC_UTILITY_PARTS[templateId];
  NPC_UTILITY_PARTS[templateId] = pool;
  onTestFinished(() => { NPC_UTILITY_PARTS[templateId] = saved; });
}

describe('NPC utility parts', () => {
  const utilitiesOf = (parts: { defId: string }[]) => parts.filter((p) => partDef(p.defId).kind === 'utility').map((p) => p.defId);

  it('rejects a utility pool that names a part of another kind', () => {
    withUtilityPool('merc', [{ value: 'mg', weight: 1 }, { value: null, weight: 1 }]);

    expect(() => generateNpcLoadout(emptyWorld(), NPCS.merc)).toThrow(/utility/);
  });

  it('rejects a template with no utility pool', () => {
    const template: NpcTemplate = { ...structuredClone(NPCS.merc), id: 'nobody' };

    expect(() => generateNpcLoadout(emptyWorld(), template)).toThrow(/no utility pool/);
  });

  it.each(Object.values(NPCS))('mounts at most one utility on $id, from its own pool', (template) => {
    const pool = NPC_UTILITY_PARTS[template.id].map((entry) => entry.value);
    for (let seed = 1; seed <= 16; seed++) {
      const utilities = utilitiesOf(generateNpcLoadout({ ...fixture, rngState: seed }, template).parts);
      expect(utilities.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const id of utilities) expect(pool, `seed ${seed}`).toContain(id);
    }
  });

  it('mounts the utilities its pool offers over many rolls', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) for (const id of utilitiesOf(generateNpcLoadout({ ...fixture, rngState: seed }, NPCS.scavenger).parts)) seen.add(id);

    expect([...seen].sort()).toEqual(['patcherCrane', 'scrapersKnife']);
  });

  it('rolls the emitter only at the heavy and loaded gear levels', () => {
    const emitter = NPC_UTILITY_PARTS.merc.find((entry) => entry.value === 'emitter');
    if (!emitter) throw new Error('Mercs roll no emitter');
    withUtilityPool('merc', [{ ...emitter, weight: 1000 }, { value: null, weight: 0.001 }]);
    const template = NPCS.merc;
    const emitters = (level: GearLevel) => {
      let count = 0;
      for (let seed = 1; seed <= 40; seed++) count += utilitiesOf(generateNpcLoadout({ ...fixture, rngState: seed }, template, null, level).parts).filter((id) => id === 'emitter').length;
      return count;
    };

    expect(emitters('standard')).toBe(0);
    expect(emitters('heavy')).toBeGreaterThan(0);
    expect(emitters('loaded')).toBeGreaterThan(0);
  }, 120_000);

  it('mounts the claymore ram on some gunwagons', () => {
    let rams = 0;
    for (let seed = 1; seed <= 200; seed++) rams += generateNpcLoadout({ ...fixture, rngState: seed }, NPCS.gunwagon).parts.filter((p) => p.defId === 'claymoreRam').length;

    expect(rams).toBeGreaterThan(0);
  }, 120_000);
});

type UtilityShares = { any: number; active: number; emitter: number };
type TemplateCensus = { shares: UtilityShares; byLevel: Partial<Record<GearLevel, UtilityShares>>; emitterBelowHeavy: number; tier2AtPoor: number };

const CENSUS_SPAWNS = 300;
const COMBAT_TEMPLATES = ['buggy', 'gunwagon', 'vulture', 'merc', 'bowlFarmer', 'noseArmy', 'convoyGuard'];

function mountedUtilities(parts: { defId: string }[]): (UtilityDef | WeaponDef)[] {
  return parts.map((p) => partDef(p.defId)).filter((def): def is UtilityDef | WeaponDef => def.kind === 'utility' || (def.kind === 'weapon' && def.line !== undefined));
}

function levelShares(template: NpcTemplate, level: GearLevel, census: TemplateCensus): UtilityShares {
  const shares = { any: 0, active: 0, emitter: 0 };
  for (let seed = 1; seed <= CENSUS_SPAWNS; seed++) {
    const utilities = mountedUtilities(generateNpcLoadout({ ...fixture, rngState: seed }, template, null, level).parts);
    if (utilities.length > 0) shares.any += 1 / CENSUS_SPAWNS;
    if (utilities.some((def) => def.kind === 'weapon' || def.reload !== null)) shares.active += 1 / CENSUS_SPAWNS;
    if (utilities.some((def) => def.id === 'emitter')) {
      shares.emitter += 1 / CENSUS_SPAWNS;
      if (level !== 'heavy' && level !== 'loaded') census.emitterBelowHeavy++;
    }
    if (level === 'poor' && utilities.some((def) => def.tier === 2)) census.tier2AtPoor++;
  }
  return shares;
}

function levelOf(census: TemplateCensus, level: GearLevel): UtilityShares {
  const shares = census.byLevel[level];
  if (!shares) throw new Error(`The census has no ${level} spawns`);
  return shares;
}

function templateCensus(template: NpcTemplate): TemplateCensus {
  const census: TemplateCensus = { shares: { any: 0, active: 0, emitter: 0 }, byLevel: {}, emitterBelowHeavy: 0, tier2AtPoor: 0 };
  const total = template.loadout.levels.reduce((sum, entry) => sum + entry.weight, 0);
  for (const { value: level, weight } of template.loadout.levels) {
    const shares = levelShares(template, level, census);
    census.byLevel[level] = shares;
    census.shares.any += (shares.any * weight) / total;
    census.shares.active += (shares.active * weight) / total;
    census.shares.emitter += (shares.emitter * weight) / total;
  }
  return census;
}

describe('NPC utility census (IV25)', () => {
  const census: Record<string, TemplateCensus> = {};
  beforeAll(async () => {
    for (const template of Object.values(NPCS)) {
      census[template.id] = templateCensus(template);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }, budget(300_000));

  it('puts a utility on at least 65% of NPC trucks across templates', () => {
    const shares = Object.values(census).map((c) => c.shares.any);
    const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;

    expect(mean).toBeGreaterThanOrEqual(0.65);
  });

  it.each(COMBAT_TEMPLATES)('mounts an active utility on at least half of %s trucks', (id) => {
    expect(census[id].shares.active).toBeGreaterThanOrEqual(0.5);
  });

  it('mounts the emitter on some heavy and loaded mercs', () => {
    const levels = NPCS.merc.loadout.levels.filter((entry) => entry.value === 'heavy' || entry.value === 'loaded');
    const total = levels.reduce((sum, entry) => sum + entry.weight, 0);
    const share = levels.reduce((sum, entry) => sum + (levelOf(census.merc, entry.value).emitter * entry.weight) / total, 0);

    expect(share).toBeGreaterThanOrEqual(0.04);
  });

  it('never mounts the emitter below heavy gear or a tier-2 utility at poor gear', () => {
    for (const [id, c] of Object.entries(census)) {
      expect(c.emitterBelowHeavy, id).toBe(0);
      expect(c.tier2AtPoor, id).toBe(0);
    }
  });

  it('gates every tier-2 roll away from poor gear and the emitter to heavy and loaded gear', () => {
    for (const [id, pool] of Object.entries(NPC_UTILITY_PARTS)) {
      for (const roll of pool) {
        if (roll.value === null) continue;
        const tier = partDef(roll.value).tier;
        const levels = roll.levels ?? GEAR_LEVEL_IDS;
        if (tier >= 2) expect(levels, `${id} ${roll.value}`).not.toContain('poor');
        if (roll.value === 'emitter') expect([...levels].sort(), id).toEqual(['heavy', 'loaded']);
      }
    }
  });
});

describe('loadout fingerprint', () => {
  const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

  it('rolls the same loadouts and RNG streams for every template', () => {
    const w = emptyWorld();
    const loadouts = Object.values(NPCS).flatMap((template) => Array.from({ length: 5 }, () => generateNpcLoadout(w, template)));
    expect(sha({ loadouts, rng: [w.rngState, w.marketRng, w.nextId] })).toBe('13489a7cf172a9a6');
  }, budget(180_000));

  it('populates a new world the same way', () => {
    const w = newWorld(7, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    expect(sha({ vehicles: w.vehicles, shops: w.shops, rng: [w.rngState, w.marketRng, w.nextId] })).toBe('0dff9e172fcd7f68');
  }, budget(60_000));
});
