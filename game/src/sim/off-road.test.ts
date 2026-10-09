import { describe, expect, it } from 'vitest';
import { advanceFar } from './far';
import { corePart, mountedParts } from './grid';
import { onRouteRoad, terrainNav } from './nav/layer';
import { topGoal } from './npc-activities';
import { keepsOffRoads } from './off-road';
import { sitePads } from './sites';
import { addVehicle, editableTerrain, emptyWorld, npcBrain } from './testkit';
import { npcHomeSite } from './tow';
import type { Faction, NpcActivity, Vehicle, World } from './types';
import { dist } from './vec';
import { endTurn } from './world';
import { worldLine } from './progression/turn-log';

function driver(w: World, faction: Faction, goal: NpcActivity['kind'] | null): Vehicle {
  const v = addVehicle(w, faction, 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
  v.brain = npcBrain('test', { x: 60, y: 60 }, []);
  if (goal) v.brain.goals = [{ kind: goal, targetId: null, destination: { x: 60, y: 60 }, phase: 'travel', reason: 'test' }];
  return v;
}

describe('keepsOffRoads', () => {
  it('holds for a raider that retreats or flees', () => {
    const w = emptyWorld();
    expect(keepsOffRoads(w, driver(w, 'raiders', 'retreat'))).toBe(true);
    expect(keepsOffRoads(w, driver(w, 'raiders', 'flee'))).toBe(true);
  });

  it('holds for a stranded raider whatever its goal', () => {
    const w = emptyWorld();
    const dry = driver(w, 'raiders', 'sell');
    dry.resources!.fuel = 0;
    const geared = driver(w, 'raiders', 'fight');
    corePart(geared, 'transmission').hp = 0;
    const engineless = driver(w, 'raiders', null);
    mountedParts(engineless, 'engine')[0].hp = 0;
    expect([dry, geared, engineless].map((v) => keepsOffRoads(w, v))).toEqual([true, true, true]);
  });

  it('leaves a healthy raider not hunting on the roads', () => {
    const w = emptyWorld();
    for (const goal of ['sell', 'fight', null] as const) expect(keepsOffRoads(w, driver(w, 'raiders', goal))).toBe(false);
  });

  it('sends a raider out on a raid, a patrol or an investigation off the roads', () => {
    const w = emptyWorld();
    for (const goal of ['raid', 'patrol', 'investigate'] as const) {
      const v = driver(w, 'raiders', goal);
      v.brain!.traits = ['raider'];
      expect(keepsOffRoads(w, v)).toBe(true);
    }
  });

  it('leaves other factions and the player on the roads', () => {
    const w = emptyWorld();
    const trader = driver(w, 'traders', 'travel');
    trader.resources!.fuel = 0;
    expect(keepsOffRoads(w, trader)).toBe(false);
    expect(keepsOffRoads(w, driver(w, 'nose', 'flee'))).toBe(false);
    w.player.fuel = 0;
    expect(keepsOffRoads(w, w.vehicles[0])).toBe(false);
  });
});

describe('the recorder world log', () => {
  it('tells which trucks keep off roads and which stand on a road', () => {
    const w = emptyWorld();
    w.turn = 20;
    const runner = driver(w, 'raiders', 'flee');
    const healthy = driver(w, 'raiders', 'sell');
    const trucks = worldLine(w, [])!.trucks!;
    expect(trucks.find((t) => t.id === runner.id)).toMatchObject({ offRoad: true, onRoad: true });
    expect(trucks.find((t) => t.id === healthy.id)).toMatchObject({ offRoad: false, onRoad: true });
  });
});

describe('raiders keeping off roads in the turn pipeline', () => {
  function campRoad(): World {
    const w = emptyWorld();
    const t = editableTerrain(w);
    for (let i = 0; i < t.types.length; i++) {
      const x = (i % t.size) + 0.5;
      const y = Math.floor(i / t.size) + 0.5;
      t.types[i] = Math.abs(x - 325) < 3 && y > 200 && y < 384 ? 'road' : 'hardpan';
    }
    return w;
  }

  function raider(w: World, pos: { x: number; y: number }): Vehicle {
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], pos, Math.PI / 2);
    v.brain = npcBrain('buggy', pos, ['raider']);
    return v;
  }

  function play(w: World, turns: number, each: (w: World) => boolean | void): World {
    for (let i = 0; i < turns; i++) {
      w = endTurn(w, (x) => {
        for (const v of x.vehicles) advanceFar(x, v);
      });
      if (each(w)) break;
    }
    return w;
  }

  const byId = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;
  const onRoad = (w: World, v: Vehicle) => onRouteRoad(terrainNav(w.terrain), v.pos.x, v.pos.y);

  it('takes a raider retreating after a knockout beside the road to its camp, where it lies up to refit', () => {
    let w = campRoad();
    const id = raider(w, { x: 325, y: 345 }).id;
    const start = byId(w, id);
    start.defeat = { phase: 'retreat', turns: 3, unseen: 0, foes: [], gaveUp: true };
    const pad = sitePads(npcHomeSite(start)!)[0];
    const road: number[] = [];
    let turn = 0;
    w = play(w, 14, (w) => {
      const v = byId(w, id);
      turn++;
      if (v.brain!.goals.at(-1)?.kind === 'rearm') return true;
      if (v.order) expect(v.brain!.farRoute?.offRoad).toBe(true);
      if (onRoad(w, v)) road.push(turn);
    });
    expect(Math.max(0, ...road)).toBeLessThanOrEqual(4);
    const v = byId(w, id);
    expect(v.brain!.goals.at(-1)?.kind).toBe('rearm');
    expect(dist(v.pos, pad)).toBeLessThan(3);
  }, 120_000);

  it('sends a stranded raider beside the road while a stranded trader and a raider not hunting keep their roads', () => {
    let w = campRoad();
    const dry = raider(w, { x: 325, y: 300 });
    dry.resources!.fuel = 0;
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 326, y: 250 }, Math.PI / 2);
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    trader.resources!.fuel = 0;
    const patrol = raider(w, { x: 325, y: 220 });
    patrol.brain!.goals = [{ kind: 'sell', targetId: 'kiln', destination: { x: 325, y: 370 }, phase: 'travel', reason: 'test patrol' }];
    w = play(w, 7, (w) => {
      expect(byId(w, trader.id).brain!.farRoute?.offRoad).toBe(false);
      expect(byId(w, patrol.id).brain!.farRoute?.offRoad).toBe(false);
      expect(onRoad(w, byId(w, patrol.id))).toBe(true);
      expect(byId(w, dry.id).brain!.farRoute?.offRoad).toBe(true);
    });
    expect(topGoal(byId(w, dry.id))?.kind).toBe('resupply');
    expect(onRoad(w, byId(w, dry.id))).toBe(false);
    byId(w, patrol.id).resources!.fuel = 0;
    w = play(w, 6, () => {});
    expect(byId(w, patrol.id).brain!.farRoute?.offRoad).toBe(true);
    expect(onRoad(w, byId(w, patrol.id))).toBe(false);
  }, 120_000);
});
