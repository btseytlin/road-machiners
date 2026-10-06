import { chassisDef } from '../data/chassis';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { corePart, mountedParts } from './grid';
import { fuelCap, groundSpeed, gunDrag, isStranded, suppliesCap, vehicleStats } from './stats';
import { endTurn } from './world';
import { CHASSIS } from '../data/chassis';
import { PARTS, type EngineDef, type StoreDef } from '../data/parts';
import { makePart } from './factory';
import { mountPart, stowPart } from './inventory';
import { addVehicle, emptyWorld } from './testkit';

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

  // A ram stalls through world.turn + stallTurns. The pipeline counts the turn up before it moves, so that is the
  // next turn's drive, and the one after runs free.
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
    for (let i = 0; i < 16; i++) expect(mountPart(w, v, makePart(w, 'mg', 0))).toBe(true);
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
