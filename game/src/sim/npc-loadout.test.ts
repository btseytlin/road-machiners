import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { GEAR_LEVELS, MAX_GUN_SLOWDOWN, MIN_NPC_SPEED_SHARE, NPC_WEAR, NPCS, type GearLevel, type NpcTemplate } from '../data/npcs';
import { PARTS, partDef } from '../data/parts';
import { START_KITS } from '../data/start';
import { newWorld } from './world';
import { CONDITION } from '../data/wear';
import { everyGunFires } from './armor';
import { makeVehicle } from './factory';
import { coreParts, freeCells, goodsCount, gridOf, isMounted, mountedParts, placementError } from './grid';
import { loadFactor, vehicleMass } from './mass';
import { generateNpcLoadout, sampleWeighted } from './npc-loadout';
import { spawnAt, spawnInitial, spawnNpcs } from './spawn';
import { openSides, reachedSides } from './armor';
import { mountedItems } from './grid';
import type { EngineDef, WeaponDef } from '../data/parts';
import { gunDrag, isStranded, npcMassRoom } from './stats';
import { addGoods } from './inventory';
import { GOODS } from '../data/goods';
import { emptyWorld } from './testkit';
import type { Vehicle, World } from './types';
import { TEST_MAP } from '../test/map';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { budget } from '../test/budget';

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
  }, budget(180_000)); // 40 full spawns, each trying every engine and gun pair of every template

  it.each(Object.values(NPCS))('fits $id equipment and cargo within its budget and rated mass', (template) => {
    for (let seed = 1; seed <= 32; seed++) {
      const world = { ...fixture, rngState: seed };
      const beforeId = world.nextId;
      const loadout = generateNpcLoadout(world, template);
      expect(world.nextId).toBe(beforeId);
      const v = makeVehicle(world, { ...loadout, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      expect(mountedParts(v, 'engine')).toHaveLength(1);
      expect(mountedParts(v, 'weapon').length).toBeGreaterThanOrEqual(template.loadout.minGuns);
      for (const item of v.items) expect(placementError(gridOf(v), v.items, item, item.id)).toBeNull();
      const loose = v.items.filter((item) => item.kind === 'part' && !isMounted(v.chassisId, item));
      expect(loose).toHaveLength(loadout.spares.length);
      expect(goodsCount(v)).toEqual(loadout.cargo);
      expect(vehicleMass(v)).toBeLessThanOrEqual(CHASSIS[v.chassisId].ratedMass);
      const cost = CHASSIS[v.chassisId].value + loadout.parts.reduce((sum, p) => sum + PARTS[p.defId].value, 0);
      expect(cost).toBeLessThanOrEqual(template.loadout.budget * Math.max(1, GEAR_LEVELS[loadout.level].budget)); // the required build may pass a poor level's budget
      expect(v.resources?.money).toBe(fixture.player.money);
    }
  });

  describe('gun fill chance', () => {
    const gunsAt = (level: GearLevel) => {
      const template = NPCS.gunwagon;
      let total = 0;
      const rolls = 12;
      for (let seed = 1; seed <= rolls; seed++) total += generateNpcLoadout({ ...fixture, rngState: seed }, template, null, level).parts.filter((p) => partDef(p.defId).kind === 'weapon').length;
      return total / rolls;
    };

    it('a poor truck carries only the guns its template requires', () => {
      expect(gunsAt('poor')).toBe(NPCS.gunwagon.loadout.minGuns);
    });

    it('more fill chance gives more guns, and a loaded truck reaches many', () => {
      const [light, standard, heavy, loaded] = (['light', 'standard', 'heavy', 'loaded'] as const).map(gunsAt);
      // The gunwagon decks are small, so the higher levels can fill every deck spot and tie.
      expect(light).toBeLessThan(standard);
      expect(standard).toBeLessThanOrEqual(heavy);
      expect(heavy).toBeLessThanOrEqual(loaded);
      expect(light).toBeLessThan(loaded);
      expect(loaded).toBeGreaterThan(NPCS.gunwagon.loadout.minGuns);
    }, budget(120_000));

    it('stops extra guns before they slow a loaded truck past the limit', () => {
      for (let seed = 1; seed <= 12; seed++) {
        const world = { ...fixture, rngState: seed };
        const loadout = generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded');
        const v = makeVehicle(world, { ...loadout, faction: 'raiders', brain: null, pos: { x: 50, y: 50 }, heading: 0 });
        const engine = mountedItems(v, 'engine')[0];
        expect(1 - gunDrag(v, (partDef(engine.part.defId) as EngineDef).capacity), describeLoadout(v)).toBeLessThanOrEqual(MAX_GUN_SLOWDOWN);
      }
    }, budget(120_000));
  });

  it.each(Object.values(NPCS))('keeps $id above the speed floor at every gear level', (template) => {
    for (const level of Object.keys(GEAR_LEVELS) as GearLevel[]) {
      for (let seed = 1; seed <= 12; seed++) {
        const world = { ...fixture, rngState: seed };
        const loadout = generateNpcLoadout(world, template, null, level);
        const v = makeVehicle(world, { ...loadout, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
        const engine = mountedItems(v, 'engine')[0];
        const share = loadFactor(v) * gunDrag(v, (partDef(engine.part.defId) as EngineDef).capacity);
        expect(share, `${level} ${describeLoadout(v)}`).toBeGreaterThanOrEqual(MIN_NPC_SPEED_SHARE - 0.02);
      }
    }
  }, budget(120_000));

  it('gives an NPC no cargo past its speed floor, and the player any', () => {
    const world = { ...fixture, rngState: 3 };
    const npc = spawnAt(world, NPCS.gunwagon, { ...generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded'), cargo: {}, spares: [] }, { x: 50, y: 50 });
    const room = npcMassRoom(npc);
    const free = freeCells(npc);
    const added = addGoods(world, npc, 'tools', 1000);
    expect(added * GOODS.tools.mass).toBeLessThanOrEqual(room);
    expect(added).toBeLessThan(free);
    const player = spawnAt(world, NPCS.gunwagon, { ...generateNpcLoadout(world, NPCS.gunwagon, null, 'loaded'), cargo: {}, spares: [] }, { x: 60, y: 50 });
    player.brain = null;
    const playerFree = freeCells(player);
    expect(addGoods(world, player, 'tools', 1000)).toBe(playerFree);
  });

  it.each(Object.values(NPCS))('gives $id only guns that can fire', (template) => {
    for (let seed = 1; seed <= 32; seed++) {
      const world = { ...fixture, rngState: seed };
      const loadout = generateNpcLoadout(world, template);
      const v = makeVehicle(world, { ...loadout, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
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
    const loadout = generateNpcLoadout({ ...fixture }, template, null, 'poor'); // a poor roll adds nothing past the required build
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
    ['no guns required', (t: NpcTemplate) => { t.loadout.minGuns = 0; }],
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
      expect(vehicles).toHaveLength(template.cap);
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
    // A poor truck carries the least armor, which leaves rated mass for spares.
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
    template.loadout.goods = [{ value: null, weight: 1 }];
    template.loadout.spares = { pool: [{ value: 'mg', weight: 1 }], count: [{ value: 0, weight: 1 }] };
    const bare = generateNpcLoadout({ ...fixture, rngState: 3 }, template);
    const free = freeCells(makeVehicle(fixture, { ...bare, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 }));
    template.loadout.goods = [{ value: { good: 'textiles', count: free }, weight: 1 }];
    template.loadout.spares = { pool: [{ value: 'mg', weight: 1 }], count: [{ value: 3, weight: 1 }] };
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
    const world = newWorld(1, START_KITS.standard, TEST_MAP);
    const npcs = world.vehicles.filter((v) => v.brain !== null);
    const parts = npcs.flatMap((v) => v.items.flatMap((it) => (it.kind === 'part' && partDef(it.part.defId).kind !== 'core' ? [it.part] : [])));
    expect(parts.some((p) => p.wear > 0)).toBe(true);
    const traders = npcs.filter((v) => v.brain!.templateId === 'trader');
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

  it('reads the pools and minimum of a table edited in place', () => {
    const template: NpcTemplate = structuredClone(NPCS.gunwagon);
    const roll = () => generateNpcLoadout(emptyWorld(), template, null, 'poor');
    const guns = () => roll().parts.filter((p) => partDef(p.defId).kind === 'weapon').map((p) => p.defId);
    expect(guns().length).toBe(template.loadout.minGuns);
    template.loadout.weapon = [{ value: 'mg', weight: 1 }];
    template.loadout.extraGun = [{ value: 'mg', weight: 1 }];
    expect(guns()).toEqual(Array(template.loadout.minGuns).fill('mg'));
    template.loadout.minGuns = 1;
    expect(guns()).toEqual(['mg']);
  });
});
