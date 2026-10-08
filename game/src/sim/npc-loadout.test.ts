import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { NPC_UTILITY_PARTS } from '../data/npc-utilities';
import { CHASSIS } from '../data/chassis';
import { GEAR_LEVEL_IDS, GEAR_LEVELS, MIN_NPC_SPEED, NPCS, PRIORITY_TOP, type GearLevel, type LoadoutPriorities, type NpcTemplate, type Weighted } from '../data/npcs';
import { PARTS, partDef, type EngineDef, type UtilityDef, type WeaponDef } from '../data/parts';
import { START_KITS } from '../data/start';
import { newWorld } from './world';
import { CONDITION } from '../data/wear';
import { everyGunFires, gunSpans } from './armor';
import { makeVehicle } from './factory';
import { baseGrid, coreParts, facingOf, freeCells, goodsCount, gridOf, isMounted, itemCells, mountedItems, mountedParts, placementError } from './grid';
import { loadFactor, vehicleMass } from './mass';
import { generateNpcLoadout, sampleWeighted } from './npc-loadout';
import { spawnAt, spawnInitial, spawnNpcs } from './spawn';
import { gunDrag, isStranded, npcMassRoom, vehicleStats } from './stats';
import { wornDef } from './wear';
import { addGoods } from './inventory';
import { GOODS } from '../data/goods';
import { emptyWorld } from './testkit';
import type { Vehicle, World } from './types';
import { TEST_MAP } from '../test/map';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { budget } from '../test/budget';
import { defaultSetup } from './settings';

// A scout with one deck cell, where a cannon or a heavy frame cannot mount. It borrows the scout's collision boxes.
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

// The value of a loadout's mounted, non-core parts: what its gear money bought.
const gearCost = (parts: { defId: string }[]) => parts.reduce((sum, p) => sum + PARTS[p.defId].value, 0);

describe('NPC equipment generation', () => {
  it('spawns at least five equipment combinations for each base trait', () => {
    const seen: Record<string, Set<string>> = Object.fromEntries(Object.values(NPCS).map((t) => [t.traits[0], new Set<string>()]));
    for (let seed = 1; seed <= 8; seed++) {
      const world = structuredClone(fixture);
      world.rngState = seed;
      spawnInitial(world);
      for (const v of world.vehicles) {
        if (v.brain) seen[NPCS[v.brain.templateId].traits[0]].add(describeLoadout(v));
      }
    }
    for (const [role, variants] of Object.entries(seen)) expect(variants.size, role).toBeGreaterThanOrEqual(5);
  }, budget(120_000));

  it.each(Object.values(NPCS))('fits $id equipment and cargo within its gear money and rated mass', (template) => {
    for (let seed = 1; seed <= 8; seed++) {
      const world = { ...fixture, rngState: seed };
      const beforeId = world.nextId;
      const loadout = generateNpcLoadout(world, template);
      expect(world.nextId).toBe(beforeId);
      const v = makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      expect(mountedParts(v, 'engine')).toHaveLength(1);
      for (const item of v.items) expect(placementError(gridOf(v), v.items, item, item.id)).toBeNull();
      const loose = v.items.filter((item) => item.kind === 'part' && !isMounted(v.chassisId, item));
      expect(loose).toHaveLength(loadout.spares.length);
      expect(goodsCount(v)).toEqual(loadout.cargo);
      expect(vehicleMass(v)).toBeLessThanOrEqual(CHASSIS[v.chassisId].ratedMass);
      expect(gearCost(loadout.parts)).toBeLessThanOrEqual(GEAR_LEVELS[loadout.level].money);
      expect(v.resources?.money).toBe(fixture.player.money);
    }
  });

  // A copy of a template with some of its priorities changed.
  const withPriorities = (template: NpcTemplate, change: Partial<LoadoutPriorities>): NpcTemplate => ({ ...template, loadout: { ...template.loadout, priorities: { ...template.loadout.priorities, ...change } } });
  const rolled = (template: NpcTemplate, level: GearLevel | null, seed: number): Vehicle => {
    const world = { ...fixture, rngState: seed, marketRng: { rngState: seed * 104729 + 1 } };
    const loadout = generateNpcLoadout(world, template, null, level);
    return makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
  };
  const ROLLS = 8;
  const average = (template: NpcTemplate, level: GearLevel | null, of: (v: Vehicle) => number) => {
    let total = 0;
    for (let seed = 1; seed <= ROLLS; seed++) total += of(rolled(template, level, seed));
    return total / ROLLS;
  };
  // The guns a driver chose to carry. The harpoon is gear from its utility roll, not one of its guns.
  const guns = (v: Vehicle) => mountedItems(v, 'weapon').filter((item) => !(partDef(item.part.defId) as WeaponDef).line).length;
  // The share of the chassis edge cells that carry armor.
  const edgeCells = (v: Vehicle) => baseGrid(v.chassisId).cells.flat().filter((cell) => cell === 'F' || cell === 'L' || cell === 'R' || cell === 'B').length;
  const coverage = (v: Vehicle) => mountedItems(v, 'armor').reduce((sum, item) => sum + itemCells(item).length, 0) / edgeCells(v);
  // The top speed on the truck's worn engine with its gear, in calm weather.
  const topSpeed = (v: Vehicle) => vehicleStats(fixture, v).maxSpeed;

  describe('loadout priorities', () => {
    it('gives more armor coverage for more armor priority', () => {
      const armor = (priority: number) => average(withPriorities(NPCS.gunwagon, { armor: priority }), 'standard', coverage);
      expect(armor(PRIORITY_TOP)).toBeGreaterThan(armor(0));
    }, budget(120_000));

    it('keeps a faster truck for more speed priority', () => {
      const speed = (priority: number) => average(withPriorities(NPCS.merc, { speed: priority }), 'standard', topSpeed);
      expect(speed(PRIORITY_TOP)).toBeGreaterThan(speed(0));
    }, budget(120_000));

    it('gives more guns for more firepower priority', () => {
      const firepower = (priority: number) => average(withPriorities(NPCS.gunwagon, { firepower: priority }), 'standard', guns);
      expect(firepower(PRIORITY_TOP)).toBeGreaterThan(firepower(0));
    }, budget(120_000));
  });

  it('armors at least 80% of the edge cells on most loaded trucks', () => {
    const choices = Object.values(NPCS).flatMap((template) => template.loadout.chassis.map((c) => ({ template, chassisId: c.value })));
    const covered = choices.filter(({ template, chassisId }, i) => {
      const world = { ...fixture, rngState: i + 1, marketRng: { rngState: (i + 1) * 104729 + 1 } };
      const loadout = generateNpcLoadout(world, template, chassisId, 'loaded');
      return coverage(makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 })) >= 0.8;
    });
    expect(covered.length / choices.length).toBeGreaterThan(0.6);
  }, budget(120_000));

  it('keeps a poor truck within its gear money', () => {
    for (const template of Object.values(NPCS)) {
      for (let seed = 1; seed <= 4; seed++) {
        const loadout = generateNpcLoadout({ ...fixture, rngState: seed }, template, null, 'poor');
        expect(gearCost(loadout.parts), template.id).toBeLessThanOrEqual(GEAR_LEVELS.poor.money);
      }
    }
  });

  it('lets a poor driver buy some armor', () => {
    const armor = (v: Vehicle) => (mountedItems(v, 'armor').length > 0 ? 1 : 0);
    expect(average(NPCS.courier, 'poor', armor)).toBeGreaterThanOrEqual(0.75);
  }, budget(120_000));

  it('mounts some guns facing a flank or the rear', () => {
    let turned = 0;
    for (const template of [NPCS.gunwagon, NPCS.merc, NPCS.convoyGuard]) {
      for (let seed = 1; seed <= 8; seed++) {
        const v = rolled(template, 'standard', seed);
        for (const item of mountedItems(v, 'weapon')) {
          if (facingOf(item) === 0) continue;
          turned++;
          expect(gunSpans(v, item).length).toBeGreaterThan(0);
        }
      }
    }
    expect(turned).toBeGreaterThan(0);
  }, budget(120_000));

  // Wagons on worn heavy diesels spawned barely faster than a crawl and could not patrol or reach a stranded truck.
  it.each(Object.values(NPCS))('keeps $id at MIN_NPC_SPEED on its worn engine at every gear level', (template) => {
    for (const level of GEAR_LEVEL_IDS) {
      for (let seed = 1; seed <= 3; seed++) {
        const v = rolled(template, level, seed);
        const engine = wornDef<EngineDef>(mountedParts(v, 'engine')[0]);
        const speed = (CHASSIS[v.chassisId].maxSpeed + engine.speedBonus) * loadFactor(v) * gunDrag(v, engine.capacity);
        expect(speed, `${level} ${describeLoadout(v)}`).toBeGreaterThanOrEqual(MIN_NPC_SPEED - 1e-9);
      }
    }
  }, budget(120_000));

  // A floor met by handing out fresh engines would make every NPC engine worth stripping.
  it('rolls engine wear by the same odds as other parts', () => {
    const wears = Object.values(NPCS).flatMap((template) => Array.from({ length: 8 }, (_, i) => mountedParts(rolled(template, 'standard', i + 1), 'engine')[0].wear));
    const table = GEAR_LEVELS.standard.wear;
    const worn = wears.filter((wear) => wear >= 3).length / wears.length;
    const odds = table.filter((w) => w.value >= 3).reduce((sum, w) => sum + w.weight, 0) / table.reduce((sum, w) => sum + w.weight, 0);
    expect(worn).toBeGreaterThan(odds * 0.8);
  }, budget(120_000));

  it('gives an NPC no cargo past its speed floor, and the player any', () => {
    // The first roll whose speed floor holds fewer tools than its free cells, so the floor is what stops the load.
    const rolls = Array.from({ length: 20 }, (_, i) => {
      const world = { ...structuredClone(fixture), rngState: i + 1 };
      const npc = spawnAt(world, NPCS.gunwagon, { ...generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded'), cargo: {}, spares: [] }, { x: 50, y: 50 });
      return { world, npc };
    });
    const { world, npc } = rolls.find(({ npc }) => Math.floor(npcMassRoom(npc) / GOODS.tools.mass) < freeCells(npc))!;
    const room = npcMassRoom(npc);
    const added = addGoods(world, npc, 'tools', 1000);
    expect(added).toBe(Math.floor(room / GOODS.tools.mass));
    const player = spawnAt(world, NPCS.gunwagon, { ...generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded'), cargo: {}, spares: [] }, { x: 60, y: 50 });
    player.brain = null;
    const playerFree = freeCells(player);
    expect(addGoods(world, player, 'tools', 1000)).toBe(playerFree);
  });

  it.each(Object.values(NPCS))('gives $id only guns that can fire', (template) => {
    for (let seed = 1; seed <= 8; seed++) {
      const world = { ...fixture, rngState: seed };
      const loadout = generateNpcLoadout(world, template);
      const v = makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      expect(everyGunFires(v), describeLoadout(v)).toBe(true);
    }
  });

  it.each([
    ['unknown cargo', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'missing', count: 1 }, weight: 1 }]; }],
    ['wrong part kind', (t: NpcTemplate) => { t.loadout.cargoPart = [{ value: 'stockEngine', weight: 1 }]; }],
    ['negative count', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'scrap', count: -1 }, weight: 1 }]; }],
    ['empty chassis pool', (t: NpcTemplate) => { t.loadout.chassis = []; }],
    ['unknown chassis', (t: NpcTemplate) => { t.loadout.chassis = [{ value: 'missing', weight: 1 }]; }],
    ['invalid optional weight', (t: NpcTemplate) => { t.loadout.cargoPart = [{ value: null, weight: 0 }]; }],
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
      // Spawned drivers leave the gates before the next round, as they drive off in play.
      world.vehicles.filter((v) => v.brain).forEach((v, i) => { v.pos = { x: 5 + (i % 40) * 4, y: world.size - 5 - Math.floor(i / 40) * 4 }; });
    }
    for (const template of Object.values(NPCS)) {
      const vehicles = world.vehicles.filter((v) => v.brain?.templateId === template.id);
      expect(vehicles.length, template.id).toBe(template.cap);
      expect(new Set(vehicles.map(describeLoadout)).size).toBeGreaterThan(1);
    }
  }, budget(120_000));

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
  it.each(Object.values(NPCS))('rolls a wear step within the level wear table for every mounted, non-core part of $id', (template) => {
    const rolled = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      const loadout = generateNpcLoadout({ ...fixture, rngState: seed, marketRng: { rngState: seed * 7919 } }, template);
      const allowed = new Set(GEAR_LEVELS[loadout.level].wear.map((entry) => entry.value));
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

  it('gives the same loadout for the same inputs in any call order', () => {
    const rolled = (id: string, seed: number, level: GearLevel) => {
      const w = emptyWorld();
      w.rngState = seed;
      const loadout = generateNpcLoadout(w, NPCS[id], null, level);
      return { loadout, rngState: w.rngState, marketRng: w.marketRng, nextId: w.nextId };
    };
    const first = rolled('gunwagon', 3, 'loaded');
    rolled('trader', 5, 'poor');
    expect(rolled('gunwagon', 3, 'loaded')).toEqual(first);
  });

  it('makes pristine parts rare and near-junk parts common at the standard level', () => {
    const wears: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      for (const p of generateNpcLoadout({ ...fixture, rngState: seed, marketRng: { rngState: seed * 7919 } }, NPCS.trader, null, 'standard').parts) wears.push(p.wear);
    }
    const share = (wear: number) => wears.filter((w) => w === wear).length / wears.length;
    expect(share(0)).toBeLessThan(0.08);
    expect(share(CONDITION.maxWear)).toBeGreaterThan(0.4);
  });

  it('a poor level wears parts more than a loaded one', () => {
    const mean = (level: GearLevel) => {
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 12; seed++) {
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
    // A plate mounts only on edge cells, so on a free deck cell it is a spare.
    template.loadout.spares = { pool: [{ value: 'steelPlate', weight: 1 }], count: [{ value: 2, weight: 1 }] };
    // A poor truck carries the least armor, which leaves rated mass for spares.
    const loadout = generateNpcLoadout({ ...fixture, rngState: 5 }, template, null, 'poor');
    expect(loadout.spares.length).toBeGreaterThan(0);
    for (const spare of loadout.spares) {
      expect(spare.defId).toBe('steelPlate');
      expect(spare.wear).toBeGreaterThanOrEqual(0);
      expect(spare.wear).toBeLessThanOrEqual(CONDITION.maxWear);
    }
  });

  it('carries no more spares than the rated mass takes', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.chassis = [{ value: 'buggy', weight: 1 }];
    template.loadout.cargoPart = [{ value: null, weight: 1 }];
    template.loadout.goods = [{ value: null, weight: 1 }];
    const heaviest = Object.values(PARTS).filter((d) => d.kind !== 'core').reduce((a, d) => (d.mass > a.mass ? d : a));
    // More of the heaviest part than any buggy can hold.
    const count = Math.ceil(CHASSIS.buggy.ratedMass / heaviest.mass);
    template.loadout.spares = { pool: [{ value: heaviest.id, weight: 1 }], count: [{ value: count, weight: 1 }] };

    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, template, null, 'standard');
    const truck = makeVehicle(fixture, { ...loadout, cargo: {}, name: 'probe', faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });

    expect(loadout.spares.length).toBeLessThan(count);
    expect(vehicleMass(truck)).toBeLessThanOrEqual(CHASSIS.buggy.ratedMass);
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
    // A world rolls about five traders, and a trader often carries no spare, so one world may roll none. Four worlds
    // roll about twenty.
    const traders = [1, 2, 3, 4].flatMap((seed) => newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming')).vehicles.filter((v) => v.brain?.templateId === 'trader'));
    expect(traders.some((v) => v.items.some((it) => it.kind === 'part' && !isMounted(v.chassisId, it)))).toBe(true);
  });
});

describe('NPC gun placement', () => {
  it('never mounts a gun where no open side lets its arc fire', () => {
    for (const id of ['gunwagon', 'buggy', 'noseArmy', 'merc']) {
      for (let seed = 1; seed <= 10; seed++) {
        const w = emptyWorld();
        w.rngState = seed * 7919;
        const v = spawnAt(w, NPCS[id], generateNpcLoadout(w, NPCS[id]), { x: 40, y: 30 });
        for (const item of mountedItems(v, 'weapon')) {
          expect(gunSpans(v, item).length, `${id} seed ${seed} ${item.part.defId}`).toBeGreaterThan(0);
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

  // A refit keeps the driver's chassis. A chassis with no engine that holds MIN_NPC_SPEED at its most worn wear
  // would throw in play. The poor level wears most and has the least gear money.
  it('every chassis in every table holds the speed floor on its most worn engine', () => {
    for (const tpl of Object.values(NPCS)) {
      for (const { value } of tpl.loadout.chassis) {
        for (let seed = 1; seed <= 3; seed++) {
          const world = { ...emptyWorld(), rngState: seed, marketRng: { rngState: seed * 104729 + 1 } };
          expect(() => generateNpcLoadout(world, tpl, value, 'poor'), `${tpl.id} on ${value}`).not.toThrow();
        }
      }
    }
  }, budget(120_000));

  it('every rolled truck can drive: one working engine, one transmission, a cab, a tank and wheels', () => {
    for (const tpl of Object.values(NPCS)) {
      for (const { value } of tpl.loadout.chassis) {
        for (let seed = 1; seed <= 2; seed++) {
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
  }, budget(120_000));
});

describe('raider gear levels', () => {
  it('never roll the poor level', () => {
    for (const template of Object.values(NPCS).filter((t) => t.traits.includes('raider'))) {
      expect(template.loadout.levels.map((l) => l.value), template.id).not.toContain('poor');
    }
  });
});

// Swaps a template's utility pool until the test ends.
function withUtilityPool(templateId: string, pool: Weighted<string | null>[]): void {
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
    for (let seed = 1; seed <= 8; seed++) {
      const utilities = utilitiesOf(generateNpcLoadout({ ...fixture, rngState: seed }, template).parts);
      expect(utilities.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const id of utilities) expect(pool, `seed ${seed}`).toContain(id);
    }
  });

  it('mounts the utilities its pool offers over many rolls', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (const id of utilitiesOf(generateNpcLoadout({ ...fixture, rngState: seed }, NPCS.scavenger).parts)) seen.add(id);

    expect([...seen].sort()).toEqual(['patcherCrane', 'scrapersKnife']);
  }, budget(120_000));

  it('puts a utility on most NPC trucks across templates', () => {
    const shares = Object.values(NPCS).map((template) => {
      let withUtility = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const parts = generateNpcLoadout({ ...fixture, rngState: seed }, template).parts;
        if (parts.some((p) => (partDef(p.defId) as UtilityDef | WeaponDef).kind === 'utility' || (partDef(p.defId) as WeaponDef).line !== undefined)) withUtility++;
      }
      return withUtility / 12;
    });

    expect(shares.reduce((sum, share) => sum + share, 0) / shares.length).toBeGreaterThanOrEqual(0.5);
  }, budget(120_000));

  // Small neighboring seeds roll alike at first, so the sample spans 80 of them.
  it('mounts the claymore ram on some gunwagons', () => {
    let rams = 0;
    for (let seed = 1; seed <= 80; seed++) rams += generateNpcLoadout({ ...fixture, rngState: seed }, NPCS.gunwagon).parts.filter((p) => p.defId === 'claymoreRam').length;

    expect(rams).toBeGreaterThan(0);
  }, budget(120_000));
});
