import { TEST_MAP } from '../test/map';
import { describe, expect, it } from 'vitest';
import { PARTS, partDef } from '../data/parts';
import { CONFIG } from '../config';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { RULES } from '../data/rules';
import { TIME } from '../data/time';
import { ENGINE_HEAT } from '../data/wear';
import { SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { playerVehicle } from './damage';
import { advanceEngineHeat, douseEngine, engineOverheating } from './engine-heat';
import { mountedParts } from './grid';
import { route } from './path';
import { nearestPad } from './sites';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, practiceOf } from './testkit';
import { heatAt } from './sun';
import type { Vec } from './vec';
import { newWorld } from './world';

const NOON = 1 + (((TIME.sunrise + TIME.sunset) / 2 - TIME.startHour) * TIME.turnsPerDay) / 24;
const NIGHT = 1 + ((23 - TIME.startHour) * TIME.turnsPerDay) / 24;

function engine(w: ReturnType<typeof emptyWorld>) {
  return mountedParts(w.vehicles[0]).find((p) => partDef(p.defId).kind === 'engine')!;
}

describe('engine heat', () => {
  it('overheats after some turns of top speed in the noon sun, then damages the engine', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    const hp = engine(w).hp;
    let turns = 0;
    while (w.player.engineHeat < 1) {
      advanceEngineHeat(w);
      turns++;
      expect(turns).toBeLessThan(60);
    }
    expect(turns).toBeGreaterThan(20);
    expect(w.events.some((e) => e.t === 'info' && e.text.startsWith('Engine running hot'))).toBe(true);
    expect(engine(w).hp).toBe(hp - ENGINE_HEAT.overheatDamage);
    advanceEngineHeat(w);
    expect(engine(w).hp).toBe(hp - 2 * ENGINE_HEAT.overheatDamage);
  });

  it('never warms while driving at night', () => {
    const w = emptyWorld();
    w.turn = NIGHT;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    w.player.engineHeat = 0.5;
    advanceEngineHeat(w);
    expect(w.player.engineHeat).toBeCloseTo(0.5 - ENGINE_HEAT.coolDriving);
  });

  it('cools faster parked in the shade than parked in the sun, and never hurts a parked engine', () => {
    const w = emptyWorld();
    w.turn = NOON;
    w.vehicles[0].speed = 0;
    w.player.engineHeat = 1;
    const hp = engine(w).hp;
    advanceEngineHeat(w);
    const sunCooled = 1 - w.player.engineHeat;
    w.turn = NIGHT; // heat 1, the same as shade
    w.player.engineHeat = 1;
    advanceEngineHeat(w);
    expect(1 - w.player.engineHeat).toBeCloseTo(ENGINE_HEAT.coolParked);
    expect(1 - w.player.engineHeat).toBeGreaterThan(sunCooled);
    expect(engine(w).hp).toBe(hp);
  });
});

describe('heat practice', () => {
  it('pays the player per turn driven in heat, harder in hotter sun', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    advanceEngineHeat(w);
    const [event] = practiceOf(w, 'heat');
    expect(event.amount).toBe(1);
    expect(event.difficulty).toBeCloseTo((heatAt(w, me.pos) - 1) / (TIME.sunHeat - 1));
  });

  it('pays nothing while parked or at night', () => {
    const w = emptyWorld();
    w.turn = NOON;
    advanceEngineHeat(w);
    w.turn = NIGHT;
    w.vehicles[0].speed = vehicleStats(w, w.vehicles[0]).maxSpeed;
    advanceEngineHeat(w);
    expect(practiceOf(w, 'heat')).toEqual([]);
  });

  it('pays nothing for an NPC driving in the noon sun', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 50, y: 30 });
    npc.speed = vehicleStats(w, npc).maxSpeed;
    advanceEngineHeat(w);
    expect(practiceOf(w, 'heat')).toEqual([]);
  });
});

describe('machining on engine heat', () => {
  // Heat one turn of top speed in the noon sun adds to a cold engine.
  function heating(machining: number): number {
    const w = emptyWorld();
    w.turn = NOON;
    w.player.skills.machining = machining;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    advanceEngineHeat(w);
    return w.player.engineHeat;
  }

  it('heats the player engine slower at level 5', () => {
    expect(heating(XP_TO_REACH[5])).toBeCloseTo(heating(0) * (1 - 5 * SKILL_EFFECTS.machining.engineHeat));
  });
});

describe('engine heat by engine', () => {
  function heatAfterTurns(engineId: string, turns: number): number {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    const item = me.items.find((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'engine')!;
    if (item.kind !== 'part') throw new Error('engine item is not a part');
    item.part = { ...item.part, defId: engineId, hp: partDef(engineId).hp };
    me.speed = vehicleStats(w, me).maxSpeed;
    for (let i = 0; i < turns; i++) advanceEngineHeat(w);
    return w.player.engineHeat;
  }

  it('a racing V6 runs hotter than a workhorse diesel in the noon sun', () => {
    expect(heatAfterTurns('racingV6', 10)).toBeGreaterThan(heatAfterTurns('workhorseDiesel', 10));
  });
});

describe('engine heat on the road', () => {
  // Point d tiles along the polyline, or null past its end.
  function along(points: Vec[], d: number): Vec | null {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= len) return { x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len };
      d -= len;
    }
    return null;
  }

  it('overheats every engine on the shortest Bowl to Nose trip at top speed from 10:00', () => {
    const base = newWorld(1337, START_KITS[CONFIG.startKit], TEST_MAP);
    base.weather = [];
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    const from = nearestPad(bowl, nose.pos);
    const points = [from, ...route(base, from, nearestPad(nose, from), vehicleStats(base, playerVehicle(base)).radius, [])];
    const engines = Object.values(PARTS).filter((p) => p.kind === 'engine');
    const cool = engines.filter((e) => {
      const w = structuredClone(base);
      const me = playerVehicle(w);
      mountedParts(me, 'engine')[0].defId = e.id;
      w.turn = 1 + ((10 - TIME.startHour) * TIME.turnsPerDay) / 24;
      let d = 0;
      for (let p = along(points, 0); p && w.player.engineHeat < 1; p = along(points, d)) {
        me.pos = p;
        me.speed = vehicleStats(w, me).maxSpeed;
        advanceEngineHeat(w);
        d += me.speed;
        w.turn++;
      }
      return w.player.engineHeat < 1;
    });
    expect(cool.map((e) => e.id)).toEqual([]);
  });
});

describe('engine overdrive', () => {
  it('raises top speed and acceleration for the player only', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 50, y: 30 });
    const normal = vehicleStats(w, me);
    const npcNormal = vehicleStats(w, npc);
    w.player.overdrive = true;
    expect(vehicleStats(w, me).maxSpeed).toBeCloseTo(normal.maxSpeed * RULES.overdriveBoost);
    expect(vehicleStats(w, me).accel).toBeCloseTo(normal.accel * RULES.overdriveBoost);
    expect(vehicleStats(w, npc)).toEqual(npcNormal);
  });

  it('overheats a driving engine even at night', () => {
    const w = emptyWorld();
    w.turn = NIGHT;
    w.player.overdrive = true;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    let turns = 0;
    while (w.player.engineHeat < 1) {
      advanceEngineHeat(w);
      turns++;
      expect(turns).toBeLessThan(40);
    }
    expect(turns).toBeGreaterThan(15);
  });

  it('heats much faster than normal driving in the noon sun', () => {
    const turnsToOverheat = (overdrive: boolean) => {
      const w = emptyWorld();
      w.turn = NOON;
      w.player.overdrive = overdrive;
      const me = w.vehicles[0];
      me.speed = vehicleStats(w, me).maxSpeed;
      let turns = 0;
      while (w.player.engineHeat < 1) {
        advanceEngineHeat(w);
        turns++;
      }
      return turns;
    };
    expect(turnsToOverheat(true)).toBeLessThan(turnsToOverheat(false) / 2);
  });

  it('adds no heat while parked', () => {
    const w = emptyWorld();
    w.turn = NIGHT;
    w.player.overdrive = true;
    w.player.engineHeat = 0.5;
    w.vehicles[0].speed = 0;
    advanceEngineHeat(w);
    expect(w.player.engineHeat).toBeCloseTo(0.5 - ENGINE_HEAT.coolParked);
  });
});

describe('engineOverheating', () => {
  function driving(heat: number) {
    const w = emptyWorld();
    w.turn = NIGHT;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    w.player.engineHeat = heat;
    return w;
  }

  it('is false in the running-hot band before full heat', () => {
    expect(engineOverheating(driving(ENGINE_HEAT.warnAt))).toBe(false);
    expect(engineOverheating(driving(0.99))).toBe(false);
  });

  it('is false at full heat while parked', () => {
    const w = driving(1);
    w.vehicles[0].speed = 0;
    expect(engineOverheating(w)).toBe(false);
  });

  it('is false at full heat with a broken engine', () => {
    const w = driving(1);
    engine(w).hp = 0;
    expect(engineOverheating(w)).toBe(false);
  });

  it('is true at full heat while driving a working engine', () => {
    expect(engineOverheating(driving(1))).toBe(true);
  });

  it('marks exactly the turns that cost the engine HP', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    w.player.engineHeat = 0.98;
    let damaged = 0;
    for (let turn = 0; turn < 12; turn++) {
      if (turn === 6) me.speed = 0;
      const hp = engine(w).hp;
      advanceEngineHeat(w);
      expect(engine(w).hp < hp).toBe(engineOverheating(w));
      if (engine(w).hp < hp) damaged++;
    }
    expect(damaged).toBeGreaterThan(0);
    expect(damaged).toBeLessThan(12);
  });
});

describe('dousing the engine', () => {
  it('spends supplies to cool the engine at once', () => {
    const w = emptyWorld();
    w.player.engineHeat = 0.9;
    const supplies = w.player.supplies;
    const next = douseEngine(w);
    expect(next.player.engineHeat).toBeCloseTo(0.9 - ENGINE_HEAT.douseCool);
    expect(next.player.supplies).toBeCloseTo(supplies - ENGINE_HEAT.douseSupplies);
  });

  it('never cools below cold', () => {
    const w = emptyWorld();
    w.player.engineHeat = 0.1;
    expect(douseEngine(w).player.engineHeat).toBe(0);
  });

  it('refuses without enough supplies', () => {
    const w = emptyWorld();
    w.player.engineHeat = 0.9;
    w.player.supplies = ENGINE_HEAT.douseSupplies / 2;
    expect(() => douseEngine(w)).toThrow(/supplies/);
  });
});

describe('desert rat', () => {
  // Engine heat after one turn of top speed from a cold engine at a turn.
  function heating(turn: number, perks: ReturnType<typeof emptyWorld>['player']['perks']): number {
    const w = emptyWorld();
    w.turn = turn;
    w.player.perks = perks;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    advanceEngineHeat(w);
    return w.player.engineHeat;
  }

  const NINE = 1 + ((9 - TIME.startHour) * TIME.turnsPerDay) / 24;

  it('heats the engine in the noon sun like the 9:00 sun', () => {
    expect(heating(NOON, ['desertRat'])).toBeCloseTo(heating(NINE, []), 2);
    expect(heating(NOON, ['desertRat'])).toBeLessThan(heating(NOON, []));
  });

  it('keeps heat practice at the real sun heat', () => {
    const w = emptyWorld();
    w.turn = NOON;
    w.player.perks = ['desertRat'];
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    advanceEngineHeat(w);
    expect(practiceOf(w, 'heat')[0].difficulty).toBeCloseTo((heatAt(w, me.pos) - 1) / (TIME.sunHeat - 1));
  });
});
