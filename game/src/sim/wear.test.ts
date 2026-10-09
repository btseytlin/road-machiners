import { describe, expect, it } from 'vitest';
import { partDef, type ArmorDef, type CargoDef, type EngineDef, type ScannerDef, type WeaponDef } from '../data/parts';
import { CONDITION, WEAR } from '../data/wear';
import { REGION } from '../data/region';
import { TERRAIN_TYPES, type TerrainTypeId } from '../data/terrain';
import { addVehicle, emptyWorld, editableTerrain, practiceOf } from './testkit';
import { corePart, mountedParts } from './grid';
import { isStranded } from './stats';
import { addState } from './states';
import { tileAt } from './terrain';
import type { PartInstance, Vehicle, World } from './types';
import { applyWear, carryHp, damagePart, isJunk, maxHp, rebuildJunk, restorePart, wornDef } from './wear';

function drive(v: Vehicle, len: number): void {
  v.trail = [
    { x: v.pos.x, y: v.pos.y, heading: 0 },
    { x: v.pos.x + len, y: v.pos.y, heading: 0 },
  ];
  v.speed = len;
}

function totalHp(v: Vehicle): number {
  return mountedParts(v).reduce((a, p) => a + p.hp, 0);
}

function setTerrainUnder(w: World, v: Vehicle, len: number, type: TerrainTypeId): void {
  const tile = tileAt(w.terrain, { x: v.pos.x + len / 2, y: v.pos.y });
  editableTerrain(w).types[tile] = type;
}

describe('wear', () => {
  it('takes no wear while parked', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.trail = [{ x: me.pos.x, y: me.pos.y, heading: 0 }];
    me.speed = 0;
    const before = totalHp(me);
    applyWear(w);
    expect(totalHp(me)).toBe(before);
  });

  it('wears parts over a long drive', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    drive(me, 1000);
    const before = totalHp(me);
    applyWear(w);
    expect(totalHp(me)).toBeLessThan(before);
  });

  it('wears scree more than road over many seeds', () => {
    let roadLoss = 0;
    let screeLoss = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const road = emptyWorld();
      road.rngState = seed;
      drive(road.vehicles[0], 5);
      setTerrainUnder(road, road.vehicles[0], 5, 'road');
      const before = totalHp(road.vehicles[0]);
      applyWear(road);
      roadLoss += before - totalHp(road.vehicles[0]);

      const scree = emptyWorld();
      scree.rngState = seed;
      drive(scree.vehicles[0], 5);
      setTerrainUnder(scree, scree.vehicles[0], 5, 'scree');
      const before2 = totalHp(scree.vehicles[0]);
      applyWear(scree);
      screeLoss += before2 - totalHp(scree.vehicles[0]);
    }
    expect(screeLoss).toBeGreaterThan(roadLoss);
  });

  it('replays the same breakdown from the same seed', () => {
    const a = emptyWorld();
    a.rngState = 7;
    drive(a.vehicles[0], 2000);
    applyWear(a);

    const b = emptyWorld();
    b.rngState = 7;
    drive(b.vehicles[0], 2000);
    applyWear(b);

    expect(a.events).toEqual(b.events);
    expect(mountedParts(a.vehicles[0])).toEqual(mountedParts(b.vehicles[0]));
    expect(a.events.some((e) => e.t === 'breakdown')).toBe(true);
  });

  it('never wears or breaks the cab below 1 HP', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = emptyWorld();
      w.rngState = seed;
      const me = w.vehicles[0];
      for (const p of mountedParts(me)) p.hp = 1;
      drive(me, 2000);
      applyWear(w);
      expect(corePart(me, 'cab').hp).toBe(1);
    }
  });

  it('costs each part about a third of its max HP over an hour of off-road driving', () => {
    const w = emptyWorld();
    w.rngState = 3;
    const me = w.vehicles[0];
    const tiles = 7.8;
    setTerrainUnder(w, me, tiles, 'hardpan');
    for (let turn = 0; turn < 2900; turn++) {
      drive(me, tiles);
      applyWear(w);
    }
    const parts = mountedParts(me);
    const lostShare = parts.reduce((a, p) => a + 1 - p.hp / partDef(p.defId).hp, 0) / parts.length;
    const breakdowns = w.events.filter((e) => e.t === 'breakdown').length;
    expect(lostShare).toBeGreaterThan(0.2);
    expect(lostShare).toBeLessThan(0.45);
    expect(breakdowns).toBeGreaterThanOrEqual(1);
    expect(breakdowns).toBeLessThanOrEqual(6);
  });

  it('fails the engine or the transmission outright and strands the truck', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const chance = WEAR.failureChancePerTile;
    (WEAR as { failureChancePerTile: number }).failureChancePerTile = 1;
    try {
      drive(me, 5);
      applyWear(w);
    } finally {
      (WEAR as { failureChancePerTile: number }).failureChancePerTile = chance;
    }
    const driveParts = [mountedParts(me, 'engine')[0], corePart(me, 'transmission')];
    const failed = driveParts.filter((p) => p.hp === 0);
    expect(failed).toHaveLength(1);
    expect(failed[0].wear).toBe(1);
    expect(isStranded(w, me)).toBe(true);
    expect(w.events).toContainEqual({ t: 'breakdown', vehicle: me.id, part: failed[0].id });
  });

  it('fails a truck about once in two hours of off-road driving', () => {
    let failures = 0;
    const hours = 10;
    for (let seed = 1; seed <= hours; seed++) {
      const w = emptyWorld();
      w.rngState = seed;
      const me = w.vehicles[0];
      const tiles = 7.8;
      setTerrainUnder(w, me, tiles, 'hardpan');
      const driveParts = [mountedParts(me, 'engine')[0], corePart(me, 'transmission')];
      for (let turn = 0; turn < 2900; turn++) {
        drive(me, tiles);
        applyWear(w);
        const failed = driveParts.find((p) => p.hp === 0);
        if (!failed) continue;
        failures++;
        restorePart(failed, maxHp(failed));
      }
    }
    expect(failures).toBeGreaterThanOrEqual(2);
    expect(failures).toBeLessThanOrEqual(10);
  });

  it('wears NPCs too', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 50, y: 50 });
    drive(npc, 1000);
    const before = totalHp(npc);
    applyWear(w);
    expect(totalHp(npc)).toBeLessThan(before);
  });
});

function part(defId: string, wear: number, hp = partDef(defId).hp): PartInstance {
  return { id: 'p1', defId, hp, wear };
}

const SIM_SOURCES = import.meta.glob<string>('./**/*.ts', { query: '?raw', import: 'default', eager: true });

describe('wear on break', () => {
  it('adds one wear step when a part drops to 0 HP', () => {
    const p = part('mg', 0);
    damagePart(p, 999, 0);
    expect(p).toMatchObject({ hp: 0, wear: 1 });
  });

  it('adds no wear to damage that leaves the part working', () => {
    const p = part('mg', 0);
    damagePart(p, 5, 0);
    expect(p).toMatchObject({ hp: partDef('mg').hp - 5, wear: 0 });
  });

  it('adds no wear to a part that was already broken', () => {
    const p = part('mg', 1, 0);
    damagePart(p, 5, 0);
    expect(p).toMatchObject({ hp: 0, wear: 1 });
  });

  it('stops at the floor without wear', () => {
    const p = part('cab', 0);
    damagePart(p, 999, 1);
    expect(p).toMatchObject({ hp: 1, wear: 0 });
  });

  it('never raises HP to the floor', () => {
    const p = part('cab', 0, 0.5);
    damagePart(p, 1, 1);
    expect(p.hp).toBe(0.5);
  });

  it('refuses negative damage', () => {
    expect(() => damagePart(part('mg', 0), -1, 0)).toThrow();
  });

  it('adds no wear on repair of a damaged working part', () => {
    const p = part('mg', 0, 3);
    restorePart(p, maxHp(p));
    expect(p).toMatchObject({ hp: partDef('mg').hp, wear: 0 });
  });
});

describe('stat loss per wear step', () => {
  it('keeps a pristine part at its def', () => {
    expect(maxHp(part('plates', 0))).toBe(partDef('plates').hp);
    expect(wornDef(part('plates', 0))).toEqual(partDef('plates'));
  });

  it('lowers max HP by a share of def HP per step', () => {
    const def = partDef('cab');
    expect(maxHp(part('cab', 2))).toBe(Math.round(def.hp * (1 - 2 * CONDITION.hpLoss)));
  });

  it('widens weapon spread', () => {
    const def = partDef('mg') as WeaponDef;
    expect(wornDef<WeaponDef>(part('mg', 2)).spread).toBeCloseTo(def.spread * (1 + 2 * CONDITION.statLoss.spread));
  });

  it('cuts engine speed and accel bonus', () => {
    const def = partDef('stockEngine') as EngineDef;
    const worn = wornDef<EngineDef>(part('stockEngine', 2));
    expect(worn.speedBonus).toBeCloseTo(def.speedBonus - 2 * CONDITION.statLoss.speedBonus);
    expect(worn.accelBonus).toBeCloseTo(def.accelBonus - 2 * CONDITION.statLoss.accelBonus);
  });

  it('lowers armor on armor parts', () => {
    const def = partDef('plates') as ArmorDef;
    expect(wornDef<ArmorDef>(part('plates', 2)).armor).toBeCloseTo(def.armor * (1 - 2 * CONDITION.statLoss.armor));
  });

  it('shortens scanner range', () => {
    const def = partDef('scanner') as ScannerDef;
    expect(wornDef<ScannerDef>(part('scanner', 2)).range).toBeCloseTo(def.range * (1 - 2 * CONDITION.statLoss.scannerRange));
  });

  it('costs cargo and core parts max HP only', () => {
    const cargo = partDef('rack') as CargoDef;
    expect(wornDef(part('rack', 2))).toEqual({ ...cargo, hp: maxHp(part('rack', 2)) });
    expect(wornDef(part('cab', 2))).toEqual({ ...partDef('cab'), hp: maxHp(part('cab', 2)) });
  });
});

describe('junk', () => {
  it('is junk only past the last wear step', () => {
    expect(isJunk(part('mg', CONDITION.maxWear))).toBe(false);
    expect(isJunk(part('mg', CONDITION.maxWear + 1))).toBe(true);
  });

  it('turns junk when a part at the last wear step breaks', () => {
    const p = part('mg', CONDITION.maxWear);
    damagePart(p, 999, 0);
    expect(isJunk(p)).toBe(true);
  });

  it('keeps a built-in core part at the last wear step when it breaks', () => {
    const p = part('transmission', CONDITION.maxWear);
    damagePart(p, 999, 0);
    expect(p.wear).toBe(CONDITION.maxWear);
    expect(isJunk(p)).toBe(false);
  });

  it('refuses to restore a junk part from 0 HP', () => {
    const p = part('mg', CONDITION.maxWear + 1, 0);
    expect(() => restorePart(p, 5)).toThrow(/junk/);
    expect(p.hp).toBe(0);
  });

  it('rebuilds a broken part at the last wear step', () => {
    const p = part('mg', CONDITION.maxWear, 0);
    restorePart(p, 999);
    expect(p.hp).toBe(maxHp(p));
  });

  it('rebuilds a junk part once to the last wear step at full HP', () => {
    const p = part('mg', CONDITION.maxWear + 1, 0);
    rebuildJunk(p);
    expect(p).toMatchObject({ wear: CONDITION.maxWear, hp: maxHp(p), rebuilt: true });
    expect(isJunk(p)).toBe(false);
  });

  it('refuses to rebuild a part that is not junk or was rebuilt before', () => {
    expect(() => rebuildJunk(part('mg', CONDITION.maxWear, 0))).toThrow(/not junk/);
    const again = { ...part('mg', CONDITION.maxWear + 1, 0), rebuilt: true as const };
    expect(() => rebuildJunk(again)).toThrow(/rebuilt/);
    expect(again.hp).toBe(0);
  });

  it('refuses to lower HP through a restore', () => {
    expect(() => restorePart(part('mg', 0, 10), 5)).toThrow();
  });
});

describe('HP ownership', () => {
  it('lets no sim file but wear.ts write part HP', () => {
    const hpWrite = /\.hp\s*(?:[-+*/]?=(?!=)|\+\+|--)/;
    const writers = Object.entries(SIM_SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && path !== './wear.ts')
      .filter(([, source]) => hpWrite.test(source))
      .map(([path]) => path);
    expect(Object.keys(SIM_SOURCES).length).toBeGreaterThan(20);
    expect(writers).toEqual([]);
  });
});

describe('rough ground practice', () => {
  const wears = Object.values(TERRAIN_TYPES).map((t) => t.wear);
  const roughness = (type: TerrainTypeId) => (TERRAIN_TYPES[type].wear - Math.min(...wears)) / (Math.max(...wears) - Math.min(...wears));

  it('pays the player for tiles driven off the road, harder on rougher ground', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    setTerrainUnder(w, me, 6, 'hardpan');
    drive(me, 6);
    applyWear(w);
    const [event] = practiceOf(w, 'roughTiles');
    expect(event.amount).toBeCloseTo(6);
    expect(event.difficulty).toBeCloseTo(roughness('hardpan'));
  });

  it('pays nothing on the road', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    drive(me, 6);
    applyWear(w);
    expect(practiceOf(w, 'roughTiles')).toEqual([]);
  });

  it('pays nothing while the player is towed', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const tower = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 50, y: 50 });
    addState(w, 'tow', tower.id, me.id, { kind: 'tow', site: REGION.towns[0].id, fee: 10, waived: 0, hitched: true });
    setTerrainUnder(w, me, 6, 'hardpan');
    drive(me, 6);
    applyWear(w);
    expect(practiceOf(w, 'roughTiles')).toEqual([]);
  });

  it('pays nothing for an NPC driving rough ground', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 50, y: 50 });
    setTerrainUnder(w, npc, 6, 'scree');
    drive(npc, 6);
    applyWear(w);
    expect(practiceOf(w, 'roughTiles')).toEqual([]);
  });
});

describe('carryHp', () => {
  it('clamps carried HP to the part range and keeps a working part alive', () => {
    const mg = part('mg', 0);
    carryHp(mg, 9999);
    expect(mg.hp).toBe(maxHp(mg));
    carryHp(mg, 0);
    expect(mg.hp).toBe(1);
  });
});
