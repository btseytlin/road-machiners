import { beforeAll, describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PARTS } from '../data/parts';
import { PERF } from '../data/perf';
import { BREAKABLE, RULES } from '../data/rules';
import { TERRAIN } from '../data/terrain';
import { PHYSICS } from '../data/physics';
import { BROKEN_WING, BROKEN_WING_POINT } from '../data/region';
import { FALLEN_SUN_DECKS } from '../data/territory';
import { WEAR } from '../data/wear';
import { START_KITS } from '../data/start';
import { bodyOf } from '../sim/body';
import { coreParts } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import { maxHp } from '../sim/wear';
import { deckAt, deckById, type Deck } from '../sim/bridge';
import { groundAt, heightAt } from '../sim/terrain';
import { dist, segmentDist, type Vec } from '../sim/vec';
import { propPose, propShape } from '../sim/mapgen';
import { emptyWorld } from '../sim/testkit';
import { atlasOf } from '../sim/atlas';
import { highwayMap } from '../sim/highway';
import { stretchLayout } from '../sim/road-hazards';
import type { LandmarkLook, Obstacle, World } from '../sim/types';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { bodyState, buildDrive, captureDrive, freeDrive, GROUND, initPhysics, RAIL, restoreDrive, syncDrive, toTilesPerTurn, TURN_STEPS, type Break, type Crash, type Drive, type Landing, type TurnResult } from './drive';
import { toMap } from './frames';
import { physicsMove } from './turn';
import { budget } from '../test/budget';
import { defaultSetup } from '../sim/settings';
import { ICARUS_DECKS } from '../sim/bridge';

beforeAll(async () => {
  await initPhysics();
});

const S = PHYSICS.metersPerTile;
const me = (w: World) => w.vehicles[0];

function landmark(id: string, look: LandmarkLook, pos: { x: number; y: number }, r: number, yaw: number): Obstacle {
  return { id, kind: 'landmark', look, pos, r, yaw };
}

function straight(from: { x: number; y: number }, heading: number, to: { x: number; y: number }, props: Obstacle[]): World {
  const w = emptyWorld(from);
  me(w).heading = heading;
  me(w).speed = 2;
  me(w).direct = true;
  w.obstacles = props;
  return setMoveOrder(w, { kind: 'through', dest: to });
}

function paced(from: { x: number; y: number }, to: { x: number; y: number }, pace: number, props: Obstacle[]): World {
  const w = emptyWorld(from);
  me(w).speed = pace;
  me(w).direct = true;
  me(w).order = { kind: 'through', dest: to, pace };
  w.obstacles = props;
  return w;
}

function play(w: World, turns: number): { w: World; hits: string[]; crashes: Crash[]; breaks: Break[]; live: string[]; speeds: number[] } {
  let d = buildDrive(w);
  const hits: string[] = [];
  const crashes: Crash[] = [];
  const breaks: Break[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < turns; i++) {
    let r: TurnResult | null = null;
    const id = me(w).id;
    w = endTurn(w, physicsMove(d, (x) => (r = x)));
    hits.push(...w.events.flatMap((e) => (e.t === 'collision' ? [e.b] : [])));
    crashes.push(...r!.crashes);
    breaks.push(...r!.breaks);
    const frames = r!.frames[id];
    for (let k = 1; k < frames.length; k++) speeds.push(Math.hypot(frames[k].pos.x - frames[k - 1].pos.x, frames[k].pos.z - frames[k - 1].pos.z) * PHYSICS.stepsPerSecond);
    freeDrive(d);
    d = r!.next;
  }
  const live = Object.keys(d.obstacles);
  freeDrive(d);
  return { w, hits, crashes, breaks, live, speeds };
}

const halfWidth = (w: World) => bodyOf(me(w).chassisId).half.z / S;

function propsAt(d: Drive, p: { x: number; y: number; z: number }): string[] {
  return Object.entries(d.obstacles).flatMap(([id, handles]) => (handles.some((h) => d.world.getCollider(h).containsPoint(p)) ? [id] : []));
}

describe('prop colliders follow the model shape', () => {
  const fence = landmark('fence1', 'fence', { x: 40, y: 30 }, 0.5, Math.PI / 2);
  const fenceEnd = 2.02 / S;

  it('a truck driving at the middle of a fence is stopped by it', () => {
    const { w, hits } = play(paced({ x: 37, y: 30 }, { x: 48, y: 30 }, toTilesPerTurn(BREAKABLE.breakSpeed / 2), [fence]), 8);
    expect(hits).toContain('fence1');
    expect(me(w).pos.x).toBeLessThan(40);
  });

  it('a truck passing just beyond the end of a fence is not', () => {
    const y = 30 + fenceEnd + halfWidth(emptyWorld()) + 0.25;
    const { w, hits } = play(straight({ x: 34, y }, 0, { x: 48, y }, [fence]), 5);
    expect(hits).toEqual([]);
    expect(me(w).pos.x).toBeGreaterThan(42);
  });

  it('a truck drives along a fence closer than its length', () => {
    const x = 40 + halfWidth(emptyWorld()) + 0.2;
    const { w, hits } = play(straight({ x, y: 24 }, Math.PI / 2, { x, y: 38 }, [fence]), 5);
    expect(hits).toEqual([]);
    expect(me(w).pos.y).toBeGreaterThan(32);
  });

  it('a truck drives under the end of a billboard board', () => {
    const board = landmark('board1', 'billboard', { x: 40, y: 30 }, 1.5, 0);
    const y = 30 - 5.6 / S;
    const { w, hits } = play(straight({ x: 34, y }, 0, { x: 48, y }, [board]), 5);
    expect(hits).toEqual([]);
    expect(me(w).pos.x).toBeGreaterThan(42);
  });

  it('a gas station canopy is no collider, its posts are', () => {
    const station = landmark('gas1', 'gasStation', { x: 40, y: 30 }, 1.332, 0);
    const w = emptyWorld();
    w.obstacles = [station];
    const d = buildDrive(w);
    const k = propPose(station).scale.x;
    const at = (mx: number, my: number, up: number) => ({ x: 40 * S + mx * k, y: up, z: 30 * S - my * k });
    try {
      expect(propsAt(d, at(-0.5, 0, 1.5))).toEqual([]);
      expect(propsAt(d, at(0, -3.5, 1.5))).toEqual(['gas1']);
    } finally {
      freeDrive(d);
    }
  });

  it('a crash into a prop of many boxes names the prop', () => {
    const tank = landmark('tank1', 'tank', { x: 40, y: 30 }, 1.2, 0);
    const w = straight({ x: 34, y: 30 }, 0, { x: 48, y: 30 }, [tank]);
    const d = buildDrive(w);
    expect(d.obstacles.tank1.length).toBeGreaterThan(1);
    freeDrive(d);
    expect(play(w, 5).hits).toContain('tank1');
  });

  it('removing a prop removes all its colliders', () => {
    const tank = landmark('tank1', 'tank', { x: 40, y: 30 }, 1.2, 0);
    const w = emptyWorld();
    const d = buildDrive(w);
    const count = () => {
      let n = 0;
      d.world.forEachCollider(() => n++);
      return n;
    };
    const empty = count();
    w.obstacles = [tank];
    syncDrive(d, w);
    expect(count() - empty).toBe(propShape(propPose(tank).model).filter((b) => b.z0 * propPose(tank).scale.z < PHYSICS.truckClearance).length);
    w.obstacles = [];
    syncDrive(d, w);
    expect(count()).toBe(empty);
    expect(d.obstacles.tank1).toBeUndefined();
    freeDrive(d);
  });

  it('every truck roof at rest is below the clearance under which props are left out', () => {
    for (const id of Object.keys(CHASSIS)) {
      const b = bodyOf(id);
      const roof = b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY + Math.max(...b.boxes.map((box) => box.at.y + box.half.y));
      expect(roof, id).toBeLessThanOrEqual(PHYSICS.truckRoof + 1e-9);
      expect(PHYSICS.truckRoof, id).toBeLessThan(PHYSICS.truckClearance);
    }
  });

  it('a prop gets colliders only while a truck with a body could reach it this turn', () => {
    const far = 30 + TERRAIN.vision.radius + PERF.liveMargin + PHYSICS.propLiveMargin + 10;
    const w = emptyWorld();
    w.obstacles = [{ id: 'rock1', pos: { x: far, y: 30 }, r: 0.8, kind: 'rock' }];
    const d = buildDrive(w);
    expect(d.obstacles.rock1).toBeUndefined();
    me(w).pos = { x: far - 10, y: 30 };
    syncDrive(d, w);
    expect(d.obstacles.rock1.length).toBeGreaterThan(0);
    me(w).pos = { x: 30, y: 30 };
    syncDrive(d, w);
    expect(d.obstacles.rock1).toBeUndefined();
    freeDrive(d);
  });

  it('the live margin for props covers a turn of the fastest truck plus the longest body', () => {
    const topSpeed = Math.max(...Object.values(CHASSIS).map((c) => c.maxSpeed));
    const bonus = Math.max(...Object.values(PARTS).map((p) => ('speedBonus' in p ? p.speedBonus : 0)));
    const longest = Math.max(...Object.keys(CHASSIS).map((id) => Math.hypot(bodyOf(id).half.x, bodyOf(id).half.z))) / S;
    expect((topSpeed + bonus) * RULES.overdriveBoost + longest).toBeLessThan(PHYSICS.propLiveMargin);
  });
});

describe('breakable props', () => {
  const fence = landmark('fence1', 'fence', { x: 40, y: 30 }, 0.5, Math.PI / 2);
  const fast = toTilesPerTurn(BREAKABLE.breakSpeed * 2);
  const slow = toTilesPerTurn(BREAKABLE.breakSpeed / 2);

  it('a fast truck breaks a fence and drives on through it', () => {
    const { w, crashes, breaks } = play(paced({ x: 34, y: 30 }, { x: 60, y: 30 }, fast, [fence]), 8);

    expect(breaks).toEqual([{ prop: 'fence1', vehicle: me(w).id, step: expect.any(Number) }]);
    expect(crashes).toEqual([]);
    expect(w.obstacles).toEqual([]);
    expect(w.broken.map((b) => b.obstacle)).toEqual([fence]);
    expect(me(w).pos.x).toBeGreaterThan(42);
  });

  it('breaking a fence costs the truck its slowdown share of speed, not a full stop', () => {
    const { w, speeds } = play(paced({ x: 37, y: 30 }, { x: 60, y: 30 }, fast, [fence]), 3);
    const hit = speeds.indexOf(Math.min(...speeds));
    const kept = BREAKABLE.breakSpeed * 2 * (1 - BREAKABLE.slowdown);

    expect(w.broken.length).toBe(1);
    expect(speeds.slice(hit + 1, hit + 6).some((speed) => Math.abs(speed - kept) < 0.5)).toBe(true);
  });

  it('a slow truck stops at a fence, which holds', () => {
    const { w, crashes, breaks } = play(paced({ x: 37, y: 30 }, { x: 60, y: 30 }, slow, [fence]), 8);

    expect(breaks).toEqual([]);
    expect(crashes.map((c) => c.b)).toContain('fence1');
    expect(w.obstacles).toEqual([fence]);
    expect(me(w).pos.x).toBeLessThan(40);
  });

  it('a fast truck crashes into a shack, which does not break', () => {
    const shack = landmark('shack1', 'shack', { x: 40, y: 30 }, 0.9, 0);
    const { w, crashes, breaks } = play(paced({ x: 34, y: 30 }, { x: 60, y: 30 }, fast, [shack]), 5);

    expect(breaks).toEqual([]);
    expect(crashes.map((c) => c.b)).toContain('shack1');
    const hit = crashes.find((c) => c.b === 'shack1')!;
    expect(hit.step).toBeGreaterThan(0);
    expect(hit.step).toBeLessThan(TURN_STEPS);
    expect(me(w).pos.x).toBeLessThan(40);
  });

  it('the physics world a break leaves holds no colliders of the fence', () => {
    expect(play(paced({ x: 34, y: 30 }, { x: 60, y: 30 }, fast, [fence]), 8).live).toEqual([]);
  });

  it('a broken fence that grows back gets new colliders and breaks again', () => {
    let w = paced({ x: 34, y: 30 }, { x: 80, y: 30 }, fast, [fence]);
    let d = buildDrive(w);
    const broke: string[] = [];
    const turn = () => {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      const done = r as TurnResult | null;
      broke.push(...done!.breaks.map((b) => b.prop));
      const next = restoreDrive(captureDrive(done!.next));
      freeDrive(done!.next);
      freeDrive(d);
      d = next;
      syncDrive(d, w);
    };
    try {
      for (let i = 0; i < 4; i++) turn();
      expect(broke).toEqual(['fence1']);
      expect(w.obstacles).toEqual([]);
      w.obstacles = [{ ...fence, pos: { x: me(w).pos.x + 5, y: 30 } }];
      for (let i = 0; i < 6; i++) turn();
      expect(broke).toEqual(['fence1', 'fence1']);
      expect(w.obstacles).toEqual([]);
    } finally {
      freeDrive(d);
    }
  });
});

describe('Broken Wing', () => {
  const deck = deckById('broken-wing');
  const across = (p: Vec) => (p.y - deck.from.y) * deck.axis.x - (p.x - deck.from.x) * deck.axis.y;

  function onMap(from: Vec, heading: number, to: Vec): World {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'), false);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    me(w).pos = { ...from };
    me(w).heading = heading;
    me(w).speed = 2;
    me(w).direct = true;
    w.player.fuel = 999;
    return setMoveOrder(w, { kind: 'through', dest: to });
  }

  function drive(w: World, turns: number): { w: World; hits: string[]; frames: { at: Vec; y: number }[] } {
    let d = buildDrive(w);
    const hits: string[] = [];
    const frames: { at: Vec; y: number }[] = [];
    for (let i = 0; i < turns; i++) {
      let r: TurnResult | null = null;
      const id = me(w).id;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      hits.push(...w.events.flatMap((e) => (e.t === 'collision' ? [e.b] : [])));
      hits.push(...r!.crashes.flatMap((c) => (c.b === GROUND ? [] : [c.b])));
      for (const f of r!.frames[id]) frames.push({ at: toMap(f.pos), y: f.pos.y });
      freeDrive(d);
      d = r!.next;
    }
    freeDrive(d);
    return { w, hits, frames };
  }

  it('a truck drives the road under the hoop, up the root ramp, along the deck and down the tip ramp', () => {
    const end = BROKEN_WING_POINT(50, 0);
    const { w, hits, frames } = drive(onMap(BROKEN_WING_POINT(BROKEN_WING.hoopAt - 8, 0), 0, end), 17);
    expect(hits).toEqual([]);
    expect(me(w).pos.x).toBeGreaterThan(end.x - 2);
    const b = bodyOf(me(w).chassisId);
    const rest = b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY;
    const onDeck = frames.filter((f) => deckAt(ICARUS_DECKS, f.at.x, f.at.y)?.deck.id === deck.id);
    expect(onDeck.length).toBeGreaterThan(0);
    for (const f of onDeck) expect(Math.abs(f.y - heightAt(w.terrain, f.at.x, f.at.y) * S - rest)).toBeLessThan(0.5);
  }, budget(60_000));

  it('a truck on the ground driving at either side of the deck meets the skirt and never gets under the deck', () => {
    for (const side of [1, -1]) {
      const { w, hits, frames } = drive(onMap(BROKEN_WING_POINT(0, side * 7), -side * Math.PI / 2, BROKEN_WING_POINT(0, -side * 10)), 4);
      expect(hits).toContain(RAIL);
      for (const f of frames) expect(side * across(f.at)).toBeGreaterThan(deck.width / 2);
      expect(side * across(me(w).pos)).toBeGreaterThan(deck.width / 2);
    }
  }, budget(60_000));
});

describe('a Fallen Sun flap', () => {
  const flap = deckById(FALLEN_SUN_DECKS[0].id);
  const on = (along: number): Vec => ({ x: flap.from.x + flap.axis.x * along, y: flap.from.y + flap.axis.y * along });
  const alongOf = (p: Vec) => (p.x - flap.from.x) * flap.axis.x + (p.y - flap.from.y) * flap.axis.y;

  type JumpTurn = { landing: Landing | null; upright: boolean; air: number };

  function jump(turns: number): { w: World; hp: Map<string, number>; after: JumpTurn[]; hits: string[]; lipSpeed: number } {
    let w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const [start, end] = [on(-12), on(flap.length + 36)];
    const onRun = (p: Vec, margin: number) => segmentDist(p, start, end) < flap.width / 2 + margin;
    const level = groundAt(w.terrain, flap.from.x, flap.from.y);
    const row = w.terrain.size + 1;
    w.terrain = { ...w.terrain, heights: w.terrain.heights.map((h, k) => (onRun({ x: k % row, y: Math.floor(k / row) }, 6) ? level : h)) };
    w.obstacles = w.obstacles.filter((o) => o.kind === 'site' || !onRun(o.pos, 10));
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    me(w).pos = on(-6);
    me(w).heading = Math.atan2(flap.axis.y, flap.axis.x);
    me(w).speed = vehicleStats(w, me(w)).maxSpeed;
    me(w).direct = true;
    w.player.fuel = 999;
    w = setMoveOrder(w, { kind: 'through', dest: on(flap.length + 30) });
    const hp = new Map(coreParts(me(w), 'wheel').map((p) => [p.id, p.hp]));
    let d = buildDrive(w);
    const after: JumpTurn[] = [];
    const hits: string[] = [];
    let lipSpeed = 0;
    for (let i = 0; i < turns; i++) {
      let r: TurnResult | null = null;
      const id = me(w).id;
      const wasPast = alongOf(me(w).pos) > flap.length;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      hits.push(...r!.crashes.map((c) => c.b));
      const frames = r!.frames[id];
      for (let k = 1; k < frames.length; k++) {
        const a = toMap(frames[k - 1].pos);
        const b = toMap(frames[k].pos);
        if (alongOf(a) <= flap.length && alongOf(b) > flap.length) lipSpeed = dist(a, b) * PHYSICS.stepsPerSecond;
      }
      const b = bodyOf(me(w).chassisId);
      const rest = b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY;
      const air = Math.max(...frames.map((f) => f.pos.y - heightAt(w.terrain, toMap(f.pos).x, toMap(f.pos).y) * S - rest));
      freeDrive(d);
      d = r!.next;
      if (wasPast || alongOf(me(w).pos) > flap.length) after.push({ landing: r!.landings.find((l) => l.vehicle === id) ?? null, upright: bodyState(d, id).upright, air });
    }
    freeDrive(d);
    return { w, hp, after, hits, lipSpeed };
  }

  it('launches a standard truck at road speed off its lip, and lands it upright on its wheels within 2 turns', () => {
    const { w, hp, after, hits, lipSpeed } = jump(3);
    const max = vehicleStats(w, me(w)).maxSpeed;

    expect(lipSpeed).toBeGreaterThan(0.9 * max);
    expect(after.length).toBeGreaterThanOrEqual(2);
    expect(after[0].air).toBeGreaterThan(0.5);
    const landed = after.slice(0, 2).findIndex((a) => a.landing !== null);
    expect(landed).toBeGreaterThanOrEqual(0);
    for (const a of after) expect(a.upright).toBe(true);
    expect(hits).toEqual([]);
    for (const wheel of coreParts(me(w), 'wheel')) {
      expect(hp.get(wheel.id)! - wheel.hp).toBeGreaterThan(0);
      expect(hp.get(wheel.id)! - wheel.hp).toBeLessThan(maxHp(wheel) * WEAR.breakdownHpShare);
    }
  }, 120_000);
});

describe('a Fury Road hull-plate ramp', () => {
  function rampWorld(): { w: World; ramp: Deck } {
    for (let seed = 1; seed <= 40; seed++) {
      const plain = stretchLayout(seed, 1).scenes.filter((s) => s.kind === 'ramp' && s.craters.length === 0).flatMap((s) => s.ramps.map((r) => r.id));
      if (plain.length === 0) continue;
      const w = newWorld(seed, START_KITS.combat, highwayMap(seed, 0), defaultSetup('furyRoad'));
      const ramp = atlasOf(w.terrain).decks.decks.find((d) => plain.includes(d.id));
      if (ramp) return { w, ramp };
    }
    throw new Error('No seed puts a ramp on the first window');
  }

  it('lifts a hauler at road speed off its lip and lands it upright on the highway', () => {
    let { w, ramp } = rampWorld();
    const on = (along: number): Vec => ({ x: ramp.from.x + ramp.axis.x * along, y: ramp.from.y + ramp.axis.y * along });
    const alongOf = (p: Vec) => (p.x - ramp.from.x) * ramp.axis.x + (p.y - ramp.from.y) * ramp.axis.y;
    const [start, end] = [on(-14), on(ramp.length + 24)];
    w.obstacles = w.obstacles.filter((o) => segmentDist(o.pos, start, end) > ramp.width / 2 + 3);
    w.furyRoad!.groups = [];
    me(w).pos = on(-10);
    me(w).heading = Math.atan2(ramp.axis.y, ramp.axis.x);
    me(w).speed = vehicleStats(w, me(w)).maxSpeed;
    me(w).direct = true;
    w.player.fuel = 999;
    w = setMoveOrder(w, { kind: 'through', dest: on(ramp.length + 20) });
    let d = buildDrive(w);
    const hits: string[] = [];
    let air = 0;
    let upright = true;
    for (let i = 0; i < 7; i++) {
      let r: TurnResult | null = null;
      const id = me(w).id;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      hits.push(...r!.crashes.map((c) => c.b));
      const b = bodyOf(me(w).chassisId);
      const rest = b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY;
      air = Math.max(air, ...r!.frames[id].filter((f) => alongOf(toMap(f.pos)) > ramp.length).map((f) => f.pos.y - heightAt(w.terrain, toMap(f.pos).x, toMap(f.pos).y) * S - rest));
      freeDrive(d);
      d = r!.next;
      upright &&= bodyState(d, id).upright;
    }
    freeDrive(d);

    expect(me(w).chassisId).toBe('hauler');
    expect(alongOf(me(w).pos)).toBeGreaterThan(ramp.length + 4);
    expect(air).toBeGreaterThan(0.2);
    expect(upright).toBe(true);
    expect(hits).toEqual([]);
  }, budget(120_000));
});
