import { chassisDef } from '../data/chassis';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { corePart, coreParts, mountedParts } from './grid';
import type { Vehicle, World } from './types';
import { addState } from './states';
import { canOverdrive, fuelCap, groundSpeed, gunDraw, gunDrag, inOverdrive, isStranded, maxSpeedSteps, workingEngineCapacity, suppliesCap, vehicleStats } from './stats';
import { endTurn } from './world';
import { CHASSIS } from '../data/chassis';
import { PARTS, type EngineDef, type StoreDef } from '../data/parts';
import { makePart } from './factory';
import { mountPart, stowPart } from './inventory';
import { addVehicle, emptyWorld } from './testkit';
import { maxHp, wornDef } from './wear';

describe('worn parts in vehicle stats', () => {
  it('a worn engine gives a lower top speed and acceleration', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    const fresh = vehicleStats(w, v);
    mountedParts(v, 'engine')[0].wear = 2;
    const worn = vehicleStats(w, v);
    expect(worn.maxSpeed).toBeLessThan(fresh.maxSpeed);
    expect(worn.accel).toBeLessThan(fresh.accel);
  });

  it('a worn gun scatters more', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 40, y: 40 });
    const fresh = vehicleStats(w, v).weapons[0].def.spread;
    mountedParts(v, 'weapon')[0].wear = 2;
    expect(vehicleStats(w, v).weapons[0].def.spread).toBeGreaterThan(fresh);
  });
});

describe('the overdrive engine cutoff', () => {
  function wornEngine() {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const engine = mountedParts(me, 'engine')[0];
    engine.wear = 2;
    engine.hp = maxHp(engine);
    const blocked = Math.floor(RULES.overdriveMinEngineShare * maxHp(engine));
    return { w, me, engine, blocked, allowed: blocked + 1 };
  }

  it('blocks at 15% of the worn max HP and below, and allows one HP above', () => {
    const { me, engine, blocked, allowed } = wornEngine();
    expect(maxHp(engine)).toBeLessThan(PARTS.stockEngine.hp);
    engine.hp = blocked;
    expect(canOverdrive(me)).toBe(false);
    engine.hp = blocked - 1;
    expect(canOverdrive(me)).toBe(false);
    engine.hp = allowed;
    expect(canOverdrive(me)).toBe(true);
  });

  it('blocks with a broken engine and with no engine', () => {
    const { w, me, engine } = wornEngine();
    engine.hp = 0;
    expect(canOverdrive(me)).toBe(false);
    const bare = addVehicle(w, 'raiders', 'scout', [], { x: 40, y: 40 });
    expect(canOverdrive(bare)).toBe(false);
  });

  it('gives no boost with the flag on and a blocked engine', () => {
    const { w, me, engine, blocked, allowed } = wornEngine();
    engine.hp = blocked;
    const off = vehicleStats(w, me);
    w.player.overdrive = true;
    expect(inOverdrive(w, me)).toBe(false);
    const on = vehicleStats(w, me);
    expect(on.maxSpeed).toBe(off.maxSpeed);
    expect(on.accel).toBe(off.accel);
    engine.hp = allowed;
    expect(inOverdrive(w, me)).toBe(true);
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(off.maxSpeed * RULES.overdriveBoost);
  });

  it('leaves plain driving on a badly worn engine as it was', () => {
    const { w, me, engine } = wornEngine();
    const healthy = vehicleStats(w, me);
    engine.hp = 4;
    const low = vehicleStats(w, me);
    expect(low.maxSpeed).toBe(healthy.maxSpeed);
    expect(low.accel).toBe(healthy.accel);
  });
});

describe('driving on rough ground', () => {
  it('keeps the full ground penalty at rank 0', () => {
    const w = emptyWorld();
    expect(groundSpeed(vehicleStats(w, w.vehicles[0]), 0.5)).toBeCloseTo(0.5);
  });

  it('cuts the ground penalty for the player at rank 5', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 5;
    const cut = 5 * SKILL_EFFECTS.driving.roughSpeed;
    expect(groundSpeed(vehicleStats(w, w.vehicles[0]), 0.5)).toBeCloseTo(1 - 0.5 * (1 - cut));
  });

  it('leaves road speed at full', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 5;
    expect(groundSpeed(vehicleStats(w, w.vehicles[0]), 1)).toBe(1);
  });

  it('leaves an NPC truck with the full penalty', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 5;
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    expect(groundSpeed(vehicleStats(w, npc), 0.5)).toBeCloseTo(0.5);
  });
});

describe('crawling when stranded', () => {
  it('crawls at limp speed at rank 0', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(RULES.limpSpeed);
  });

  it('crawls faster without an engine at rank 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    w.player.ranks.driving = 5;
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(RULES.limpSpeed * (1 + 5 * SKILL_EFFECTS.driving.crawl));
  });

  it('crawls faster with a broken transmission at rank 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = 0;
    w.player.ranks.driving = 5;
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(RULES.limpSpeed * (1 + 5 * SKILL_EFFECTS.driving.crawl));
  });

  it('leaves a stranded NPC truck at limp speed', () => {
    const w = emptyWorld();
    w.player.ranks.driving = 5;
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    mountedParts(npc, 'engine')[0].hp = 0;
    expect(vehicleStats(w, npc).maxSpeed).toBeCloseTo(RULES.limpSpeed);
  });
});


describe('a stalled engine', () => {
  it('crawls at limp speed while stalled, but is not stranded', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    v.stalledUntil = w.turn;
    const stats = vehicleStats(w, v);
    expect(stats.maxSpeed).toBeCloseTo(RULES.limpSpeed);
    expect(stats.accel).toBeCloseTo(RULES.limpSpeed * chassisDef('scout').accel);
    expect(stats.fuelPerTile).toBe(0);
    expect(isStranded(w, v)).toBe(false);
  });

  it('drives again after its last stalled turn', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    const fresh = vehicleStats(w, v).maxSpeed;
    v.stalledUntil = w.turn - 1;
    expect(vehicleStats(w, v).maxSpeed).toBe(fresh);
  });

  it('stalls the drive of exactly the turn after the ram', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    const fresh = vehicleStats(w, v).maxSpeed;
    v.stalledUntil = w.turn + PERK_NUMBERS.rammer.stallTurns;
    const speeds: number[] = [];
    const drive = (d: typeof w) => void speeds.push(vehicleStats(d, d.vehicles.find((x) => x.id === v.id)!).maxSpeed);
    endTurn(endTurn(w, drive), drive);
    expect(speeds[0]).toBeCloseTo(RULES.limpSpeed);
    expect(speeds[1]).toBe(fresh);
  });
});


describe('store capacity', () => {
  const jerrycans = PARTS.jerrycans as StoreDef;
  const locker = PARTS.supplyLocker as StoreDef;

  it('a bare truck holds the chassis tank and the base supplies', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    expect(fuelCap(v)).toBe(CHASSIS.scout.fuelCap);
    expect(suppliesCap(v)).toBe(RULES.baseSupplies);
  });

  it('each mounted store adds its room to its own cap', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'jerrycans', 'jerrycans', 'supplyLocker'], { x: 40, y: 40 });
    expect(mountedParts(v, 'store')).toHaveLength(3);
    expect(fuelCap(v)).toBe(CHASSIS.hauler.fuelCap + 2 * jerrycans.amount);
    expect(suppliesCap(v)).toBe(RULES.baseSupplies + locker.amount);
  });

  it('a broken store keeps its room', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine', 'jerrycans'], { x: 40, y: 40 });
    mountedParts(v, 'store')[0].hp = 0;
    expect(fuelCap(v)).toBe(CHASSIS.scout.fuelCap + jerrycans.amount);
  });

  it('a store stowed off a deck mount adds nothing', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    expect(stowPart(w, v, makePart(w, 'jerrycans', 0))).toBe(true);
    expect(mountedParts(v, 'store')).toHaveLength(0);
    expect(fuelCap(v)).toBe(CHASSIS.scout.fuelCap);
    expect(mountPart(w, v, makePart(w, 'supplyLocker', 0))).toBe(true);
    expect(suppliesCap(v)).toBe(RULES.baseSupplies + locker.amount);
  });
});

describe('gun power draw', () => {
  const speedWith = (chassis: string, parts: string[]) => {
    const w = emptyWorld();
    return vehicleStats(w, addVehicle(w, 'raiders', chassis, parts, { x: 40, y: 40 })).maxSpeed;
  };

  it('a gun draws 1 plus half per extra cell, times 1 plus a quarter per tier above 1', () => {
    for (const def of Object.values(PARTS)) {
      if (def.kind === 'weapon') expect(def.draw, def.id).toBeCloseTo((1 + 0.5 * (def.w * def.h - 1)) * (1 + 0.25 * (def.tier - 1)));
    }
  });

  it('every engine has a capacity, and a higher tier engine at least matches a lower tier one', () => {
    const engines = Object.values(PARTS).filter((d) => d.kind === 'engine');
    for (const e of engines) expect(e.capacity, e.id).toBeGreaterThan(0);
    const capacityOf = (id: string) => (PARTS[id] as EngineDef).capacity;
    expect(capacityOf('heavyDiesel')).toBeGreaterThan(capacityOf('stockEngine'));
  });

  it('no guns cost no speed', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    expect(gunDrag(v, 7)).toBe(1);
  });

  it('two light guns on a stock engine cost between 5 and 15 percent', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine', 'mg', 'mg'], { x: 40, y: 40 });
    expect(1 - gunDrag(v, 7)).toBeGreaterThan(0.05);
    expect(1 - gunDrag(v, 7)).toBeLessThan(0.15);
  });

  it('draw at or past the capacity caps the loss at 60 percent', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    for (let i = 0; i < 6; i++) expect(mountPart(w, v, makePart(w, 'mg', 0))).toBe(true);
    expect(gunDrag(v, 7)).toBeCloseTo(1 - RULES.gunDragMax);
  });

  it('a broken gun draws nothing', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine', 'mg', 'mg'], { x: 40, y: 40 });
    const both = gunDrag(v, 7);
    mountedParts(v, 'weapon')[0].hp = 0;
    expect(gunDrag(v, 7)).toBeGreaterThan(both);
  });

  it('guns lower top speed and acceleration, and a bigger engine loses less', () => {
    const w = emptyWorld();
    const bare = vehicleStats(w, addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 }));
    const armed = vehicleStats(w, addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'cannon'], { x: 40, y: 40 }));
    expect(armed.maxSpeed).toBeLessThan(bare.maxSpeed);
    expect(armed.accel).toBeLessThan(bare.accel);
    const share = (engine: string) => speedWith('hauler', [engine, 'cannon']) / speedWith('hauler', [engine]);
    expect(share('heavyDiesel')).toBeGreaterThan(share('stockEngine'));
  });
});

describe('max speed steps', () => {
  type Scenario = { build: () => { w: World; v: Vehicle }; kinds: string[] };
  const base = (parts: string[], chassis = 'scout') => {
    const w = emptyWorld();
    return { w, v: addVehicle(w, 'raiders', chassis, parts, { x: 40, y: 40 }) };
  };
  const SCENARIOS: Record<string, Scenario> = {
    bare: { build: () => base([]), kinds: ['limp'] },
    stock: { build: () => base(['stockEngine']), kinds: ['chassis', 'engine', 'load', 'guns'] },
    manyGuns: { build: () => base(['stockEngine', 'mg', 'mg', 'mg'], 'hauler'), kinds: ['chassis', 'engine', 'load', 'guns'] },
    brokenGun: {
      build: () => {
        const s = base(['stockEngine', 'mg', 'mg']);
        mountedParts(s.v, 'weapon')[0].hp = 0;
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns'],
    },
    overload: {
      build: () => {
        const s = base(['stockEngine'], 'hauler');
        for (let i = 0; i < 16; i++) mountPart(s.w, s.v, makePart(s.w, 'mg', 0));
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns'],
    },
    heavy: {
      build: () => {
        const s = base(['stockEngine']);
        for (let i = 0; i < 400; i++) s.v.items.push({ id: `g${i}`, x: 0, y: 0, rot: 0, kind: 'good', good: 'scrap' });
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns', 'floor'],
    },
    worn: {
      build: () => {
        const s = base(['stockEngine']);
        mountedParts(s.v, 'engine')[0].wear = 2;
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns'],
    },
    wheels: {
      build: () => {
        const s = base(['stockEngine']);
        coreParts(s.v, 'wheel').slice(0, 2).forEach((p) => (p.hp = 0));
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'wheels', 'guns'],
    },
    overdrive: {
      build: () => {
        const s = base(['stockEngine']);
        s.w.player.vehicleId = s.v.id;
        s.w.player.overdrive = true;
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns', 'overdrive'],
    },
    transmission: {
      build: () => {
        const s = base(['stockEngine']);
        corePart(s.v, 'transmission').hp = 0;
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns', 'transmission'],
    },
    brokenEngine: {
      build: () => {
        const s = base(['stockEngine']);
        mountedParts(s.v, 'engine')[0].hp = 0;
        return s;
      },
      kinds: ['limp'],
    },
    stalled: {
      build: () => {
        const s = base(['stockEngine']);
        s.v.stalledUntil = s.w.turn + 3;
        return s;
      },
      kinds: ['limp'],
    },
    storm: {
      build: () => {
        const s = base(['stockEngine']);
        s.w.weather = [{ id: 'w1', kind: 'storm', pos: { ...s.v.pos }, radius: 20, vel: { x: 0, y: 0 }, turnsLeft: 10, born: s.w.turn }];
        s.v.stormExposure = { w1: 1 };
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns', 'weather'],
    },
    towing: {
      build: () => {
        const s = base(['stockEngine']);
        const other = addVehicle(s.w, 'raiders', 'scout', ['stockEngine'], { x: 44, y: 40 });
        addState(s.w, 'tow', s.v.id, other.id, { kind: 'tow', site: 'bowl', fee: 10, waived: 0, hitched: true });
        return s;
      },
      kinds: ['chassis', 'engine', 'load', 'guns', 'towing'],
    },
  };

  const FROZEN: Record<string, number> = {
    bare: 1.04, stock: 9.875716226804332, manyGuns: 4.906412009420447, brokenGun: 8.703054785359077, overload: 3.046229250680652,
    heavy: 1, worn: 9.217335145017376, wheels: 7.135204973866129, overdrive: 13.134702581649762, transmission: 1.04,
    brokenEngine: 1.04, stalled: 1.04, storm: 5.925429736082600, towing: 5.9254297360826,
  };

  it('keeps every max speed bit for bit and ends the steps on it', () => {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      const { w, v } = sc.build();
      const steps = maxSpeedSteps(w, v);
      expect(vehicleStats(w, v).maxSpeed, name).toBeCloseTo(FROZEN[name], 10);
      expect(steps[steps.length - 1].speed, name).toBe(vehicleStats(w, v).maxSpeed);
    }
  });

  it('lists the expected step kinds in order', () => {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      const { w, v } = sc.build();
      const kinds = maxSpeedSteps(w, v).map((s) => s.kind);
      expect(kinds, name).toEqual(sc.kinds);
    }
  });

  it('each step follows from the one before', () => {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      const { w, v } = sc.build();
      const steps = maxSpeedSteps(w, v);
      steps.forEach((s, i) => {
        const before = i === 0 ? 0 : steps[i - 1].speed;
        if (s.kind === 'load' || s.kind === 'guns' || s.kind === 'wheels' || s.kind === 'overdrive' || s.kind === 'weather' || s.kind === 'towing') {
          expect(s.speed, `${name} ${s.kind}`).toBeCloseTo(before * s.factor, 10);
        }
        if (s.kind === 'engine') expect(s.speed, name).toBeCloseTo(steps[0].speed + wornDef<EngineDef>(mountedParts(v, 'engine')[0]).speedBonus, 10);
        if (s.kind === 'floor') expect(s.speed, name).toBe(RULES.minSpeedCap);
        if (s.kind === 'transmission') expect(s.speed, name).toBeLessThan(before);
      });
    }
  });

  it('starts with the chassis, or limp with the cause', () => {
    const cause = (name: string) => {
      const { w, v } = SCENARIOS[name].build();
      const first = maxSpeedSteps(w, v)[0];
      return first.kind === 'limp' ? first.cause : first.kind;
    };
    expect(cause('stock')).toBe('chassis');
    expect(cause('bare')).toBe('noEngine');
    expect(cause('brokenEngine')).toBe('brokenEngine');
    expect(cause('stalled')).toBe('stalled');
  });

  it('gun draw ignores broken guns, and a broken or missing engine gives no capacity', () => {
    const { v } = SCENARIOS.brokenGun.build();
    const one = SCENARIOS.stock.build().v;
    expect(gunDraw(v)).toBeGreaterThan(0);
    const both = base(['stockEngine', 'mg', 'mg']).v;
    expect(gunDraw(v)).toBeCloseTo(gunDraw(both) / 2);
    expect(gunDraw(one)).toBe(0);
    expect(workingEngineCapacity(v)).toBe((PARTS.stockEngine as EngineDef).capacity);
    expect(workingEngineCapacity(SCENARIOS.bare.build().v)).toBeNull();
    expect(workingEngineCapacity(SCENARIOS.brokenEngine.build().v)).toBeNull();
  });
});
