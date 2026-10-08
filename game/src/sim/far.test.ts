import { beforeAll, describe, expect, it } from 'vitest';
import { heatAt } from './sun';
import { PERF } from '../data/perf';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { TERRAIN } from '../data/terrain';
import { buildDrive, bodyState, freeDrive, initPhysics, syncDrive, TURN_STEPS, type Drive, type TurnResult } from '../phys/drive';
import { PHYSICS } from '../data/physics';
import { physicsMove } from '../phys/turn';
import { advanceFar, fuelLimit, fuelLimited, isNear } from './far';
import { getResources } from './resources';
import { fuelCap, vehicleStats } from './stats';
import { addVehicle, editableTerrain, emptyWorld, npcBrain } from './testkit';
import type { Obstacle, Pose, World } from './types';
import { dist } from './vec';
import { endTurn } from './world';
import { addState } from './states';
import { REGION } from '../data/region';

beforeAll(async () => {
  await initPhysics();
});

const LIVE = TERRAIN.vision.radius + PERF.liveMargin;

// Plays n turns through the real turn pipeline with physics movement.
function play(w: World, n: number): { w: World; d: Drive; last: TurnResult } {
  let d = buildDrive(w);
  let last: TurnResult | null = null;
  for (let i = 0; i < n; i++) {
    let r: TurnResult | null = null;
    w = endTurn(w, physicsMove(d, (x) => (r = x)));
    freeDrive(d);
    d = r!.next;
    last = r;
  }
  return { w, d, last: last! };
}

function pathLength(trail: Pose[]): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++) total += dist(trail[i - 1], trail[i]);
  return total;
}

// Player at (30, 30); one NPC inside the live radius and one far beyond it.
function mixedWorld(): World {
  const w = emptyWorld();
  const near = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 });
  near.order = { kind: 'through', dest: { x: 50, y: 34 } };
  const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 30 + LIVE + 40, y: 80 });
  far.order = { kind: 'stopAt', dest: { x: 30 + LIVE + 60, y: 90 } };
  return w;
}

describe('far NPC travel', () => {
  it('counts the player and vehicles inside sight plus the live margin as near', () => {
    const w = emptyWorld();
    const inside = addVehicle(w, 'traders', 'scout', [], { x: 30 + LIVE - 0.5, y: 30 });
    const outside = addVehicle(w, 'traders', 'scout', [], { x: 30 + LIVE + 0.5, y: 30 });
    expect(isNear(w, w.vehicles[0])).toBe(true);
    expect(isNear(w, inside)).toBe(true);
    expect(isNear(w, outside)).toBe(false);
  });

  it('gives the same turn result for the same world and orders, near and far alike (IV2)', () => {
    const a = play(mixedWorld(), 3);
    const b = play(mixedWorld(), 3);
    const pick = (w: World) => w.vehicles.map((v) => ({ id: v.id, pos: v.pos, heading: v.heading, speed: v.speed, trail: v.trail, order: v.order, fuel: getResources(w, v).fuel }));
    expect(pick(a.w)).toEqual(pick(b.w));
    expect(a.w.vehicles[2].pos).not.toEqual(mixedWorld().vehicles[2].pos);
    freeDrive(a.d);
    freeDrive(b.d);
  });

  it('keeps a body for every near vehicle and none for far ones after each sync (IV3)', () => {
    const w = mixedWorld();
    const d = buildDrive(w);
    expect(Object.keys(d.bodies).sort()).toEqual([w.vehicles[0].id, w.vehicles[1].id].sort());
    w.vehicles[1].pos = { x: 30, y: 30 + LIVE + 5 };
    syncDrive(d, w);
    expect(Object.keys(d.bodies)).toEqual([w.vehicles[0].id]);
    expect(d.memory[w.vehicles[1].id]).toBeUndefined();
    freeDrive(d);
  });

  it('simulates only near vehicles in physics', () => {
    const { w, d, last } = play(mixedWorld(), 1);
    expect(Object.keys(d.bodies).sort()).toEqual([w.vehicles[0].id, w.vehicles[1].id].sort());
    expect(w.vehicles[2].trail).toHaveLength(RULES.substeps + 1);
    freeDrive(d);
  });

  it('stops a far vehicle at the map edge when its goal lies beyond it', () => {
    const w = emptyWorld();
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 4 });
    far.speed = 2;
    far.order = { kind: 'through', dest: { x: 120, y: -17 } };
    const radius = vehicleStats(w, far).radius;
    for (let turn = 0; turn < 10 && far.order; turn++) {
      advanceFar(w, far);
      expect(far.pos.y).toBeGreaterThanOrEqual(radius);
    }
    expect(far.pos.y).toBeCloseTo(radius, 6);
  });

  it('moves a far vehicle no farther than its speed allows and burns fuel for that distance at the heat where it ends (IV4)', () => {
    const w = emptyWorld();
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    far.speed = 2;
    far.order = { kind: 'through', dest: { x: 200, y: 120 } };
    const s = vehicleStats(w, far);
    for (let turn = 0; turn < 4; turn++) {
      const start = { ...far.pos };
      const before = { fuel: getResources(w, far).fuel, speed: far.speed };
      advanceFar(w, far);
      const moved = pathLength(far.trail);
      expect(far.trail[0]).toMatchObject(start);
      expect(far.trail).toHaveLength(RULES.substeps + 1);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThanOrEqual(Math.max(before.speed, far.speed) + 1e-9);
      expect(far.speed).toBeLessThanOrEqual(s.maxSpeed);
      expect(far.speed).toBeLessThanOrEqual(before.speed + s.accel + 1e-9);
      expect(before.fuel - getResources(w, far).fuel).toBeCloseTo(moved * s.fuelPerTile * heatAt(w, far.pos), 9);
    }
  });

  it('crawls without fuel and burns nothing below empty', () => {
    const w = emptyWorld();
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    far.resources!.fuel = 0;
    far.order = { kind: 'through', dest: { x: 200, y: 120 } };
    advanceFar(w, far);
    expect(far.speed).toBeLessThanOrEqual(RULES.limpSpeed);
    expect(far.resources!.fuel).toBe(0);
  });

  it('lets a player with an empty tank crawl faster at driving rank 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    w.player.fuel = 0;
    const order = { kind: 'through', dest: { x: 200, y: 30 } } as const;
    expect(fuelLimited(w, me, vehicleStats(w, me), 0, order).maxSpeed).toBeCloseTo(RULES.limpSpeed);
    w.player.ranks.driving = 5;
    const crawl = RULES.limpSpeed * (1 + 5 * SKILL_EFFECTS.driving.crawl);
    expect(fuelLimited(w, me, vehicleStats(w, me), 0, order).maxSpeed).toBeCloseTo(crawl);
  });

  it('names the fuel limit: low, empty or none', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const s = vehicleStats(w, me);
    w.player.fuel = fuelCap(me);
    expect(fuelLimit(w, me, s.fuelPerTile > 0)).toBeNull();
    w.player.fuel = fuelCap(me) * RULES.lowFuelThreshold * 0.5;
    expect(fuelLimit(w, me, s.fuelPerTile > 0)).toBe('low');
    w.player.fuel = 0;
    expect(fuelLimit(w, me, s.fuelPerTile > 0)).toBe('empty');
  });

  it('a brake order or no order slows a far vehicle where it stands', () => {
    const w = emptyWorld();
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    far.speed = 5;
    far.order = { kind: 'brake' };
    const s = vehicleStats(w, far);
    advanceFar(w, far);
    expect(far.pos).toEqual({ x: 120, y: 120 });
    expect(far.speed).toBeCloseTo(Math.max(0, 5 - s.brake), 9);
    for (let i = 0; i < 10 && far.order; i++) advanceFar(w, far);
    expect(far.order).toBeNull();
    expect(far.speed).toBe(0);
  });

  it('reaches a distant site over turns and reports arrival', () => {
    let w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    const site = { x: 150, y: 140 };
    npc.order = { kind: 'stopAt', dest: site };
    let d = buildDrive(w);
    let arrived = false;
    for (let i = 0; i < 40 && !arrived; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      arrived = w.events.some((e) => e.t === 'arrived' && e.vehicle === npc.id);
    }
    const v = w.vehicles.find((x) => x.id === npc.id)!;
    expect(arrived).toBe(true);
    expect(v.order).toBeNull();
    expect(dist(v.pos, site)).toBeLessThan(RULES.arriveRadius);
    expect(d.bodies[npc.id]).toBeUndefined();
    freeDrive(d);
  });

  it('a far NPC keeps its goal stack across a turn and still drives by it', () => {
    let w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 30 + LIVE + 40, y: 80 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    const goals = [
      { kind: 'raid' as const, targetId: null, destination: { x: 30 + LIVE + 70, y: 80 }, phase: 'travel' as const, reason: 'long-term goal' },
      { kind: 'investigate' as const, targetId: w.player.vehicleId, destination: { x: 30 + LIVE + 60, y: 80 }, phase: 'travel' as const, reason: 'interruption' },
    ];
    npc.brain.goals = structuredClone(goals);
    // The investigation needs a hostile target, so the NPC holds a feud toward the player.
    w.states.push({ id: 'feud-test', kind: 'feud', holder: npc.id, other: w.player.vehicleId, turnsLeft: 10, born: w.turn, data: { kind: 'feud', robbery: false } });
    const { w: after, d } = play(w, 1);
    w = after;
    const v = w.vehicles.find((x) => x.id === npc.id)!;
    expect(d.bodies[npc.id]).toBeUndefined();
    expect(v.brain!.goals.map((g) => [g.kind, g.reason])).toEqual(goals.map((g) => [g.kind, g.reason]));
    expect(v.pos.x).toBeGreaterThan(npc.pos.x);
    freeDrive(d);
  });

  it('stores the route and reuses it while the destination holds', () => {
    const w = emptyWorld();
    w.obstacles = [{ id: 'rock1', pos: { x: 135, y: 120 }, r: 3, kind: 'rock' }];
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    far.brain = npcBrain('trader', { x: 0, y: 0 }, ['trader']);
    far.order = { kind: 'stopAt', dest: { x: 150, y: 120 } };
    advanceFar(w, far);
    const stored = far.brain.farRoute!;
    expect(stored.dest).toEqual({ x: 150, y: 120 });
    expect(stored.points.length).toBeGreaterThan(1);
    const marker = { x: 150, y: 120 };
    stored.points = [marker];
    advanceFar(w, far);
    expect(far.brain.farRoute!.points).toEqual([marker]);
    far.order = { kind: 'stopAt', dest: { x: 150, y: 100 } };
    advanceFar(w, far);
    expect(far.brain.farRoute!.dest).toEqual({ x: 150, y: 100 });
  });

  it('drops a kept road route once a raider runs dry, and plans one off the road to the same point', () => {
    const w = emptyWorld();
    const t = editableTerrain(w);
    for (let i = 0; i < t.types.length; i++) t.types[i] = Math.abs(Math.floor(i / t.size) + 0.5 - 120) < 3 ? 'road' : 'hardpan';
    const far = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 120, y: 120 });
    far.brain = npcBrain('raider', { x: 0, y: 0 }, ['raider']);
    far.brain.goals = [{ kind: 'sell', targetId: null, destination: null, phase: 'travel', reason: 'test patrol' }];
    far.order = { kind: 'stopAt', dest: { x: 180, y: 120 } };
    advanceFar(w, far);
    expect(far.brain.farRoute!.offRoad).toBe(false);
    const marker = { x: 180, y: 120 };
    far.brain.farRoute!.points = [marker];
    advanceFar(w, far);
    expect(far.brain.farRoute!.points).toEqual([marker]);
    far.resources!.fuel = 0;
    advanceFar(w, far);
    const route = far.brain.farRoute!;
    expect(route.offRoad).toBe(true);
    expect(route.dest).toEqual(marker);
    expect(route.points.length).toBeGreaterThan(1);
    expect(route.points.slice(0, -1).every((p) => Math.abs(p.y - 120) >= 3)).toBe(true);
  });

  it('throws on a kept far route without its road style', () => {
    const w = emptyWorld();
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    far.brain = npcBrain('trader', { x: 0, y: 0 }, ['trader']);
    far.order = { kind: 'stopAt', dest: { x: 150, y: 120 } };
    far.brain.farRoute = { dest: { x: 150, y: 120 }, points: [{ x: 150, y: 120 }] } as NonNullable<typeof far.brain.farRoute>;
    expect(() => advanceFar(w, far)).toThrow(/offRoad/);
  });

  it('adds a body at the sim pose when a far vehicle crosses into range', () => {
    let w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 30 + LIVE + 6, y: 30 });
    npc.order = { kind: 'through', dest: { x: 20, y: 30 } };
    npc.speed = 4;
    npc.heading = Math.PI;
    let d = buildDrive(w);
    expect(d.bodies[npc.id]).toBeUndefined();
    let crossed = false;
    for (let i = 0; i < 6 && !crossed; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      crossed = isNear(w, w.vehicles.find((x) => x.id === npc.id)!);
    }
    expect(crossed).toBe(true);
    syncDrive(d, w);
    const v = w.vehicles.find((x) => x.id === npc.id)!;
    const body = bodyState(d, npc.id);
    expect(dist(body.pos, v.pos)).toBeLessThan(1e-3);
    expect(Math.abs(body.heading - v.heading)).toBeLessThan(1e-3);
    freeDrive(d);
  });
  it('gives far vehicles frames along their trail, so the view never jumps', () => {
    const { w, last } = play(mixedWorld(), 1);
    const far = w.vehicles[2];
    const frames = last.frames[far.id];
    expect(frames).toHaveLength(TURN_STEPS);
    const S = PHYSICS.metersPerTile;
    const end = frames[frames.length - 1].pos;
    expect(Math.hypot(end.x / S - far.pos.x, end.z / S - far.pos.y)).toBeLessThan(1e-6);
    for (let i = 1; i < frames.length; i++) {
      const step = Math.hypot(frames[i].pos.x - frames[i - 1].pos.x, frames[i].pos.z - frames[i - 1].pos.z) / S;
      expect(step).toBeLessThanOrEqual(pathLength(far.trail) / RULES.substeps + 1e-6);
    }
    for (const v of w.vehicles) expect(last.frames[v.id]).toHaveLength(TURN_STEPS);
  });
});

describe('far travel contact', () => {
  function far() {
    const w = emptyWorld();
    const mover = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    mover.speed = 4;
    return { w, mover };
  }

  it('holds just short of a faster truck in the way and keeps its speed', () => {
    const { w, mover } = far();
    const ahead = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 122.5, y: 120 });
    ahead.speed = 2 * vehicleStats(w, mover).maxSpeed; // faster, so the route planner does not steer around it
    mover.order = { kind: 'through', dest: { x: 200, y: 120 } };
    advanceFar(w, mover);
    const contact = vehicleStats(w, mover).radius + vehicleStats(w, ahead).radius;
    expect(dist(mover.pos, ahead.pos)).toBeGreaterThanOrEqual(contact);
    expect(mover.pos.x).toBeGreaterThan(120);
    expect(mover.speed).toBeGreaterThan(0);
    expect(mover.order).not.toBeNull();
  });

  it('overtakes a slower truck in the way', () => {
    const { w, mover } = far();
    const slow = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 124, y: 120 });
    slow.speed = 1;
    mover.order = { kind: 'through', dest: { x: 200, y: 120 } };
    const contact = vehicleStats(w, mover).radius + vehicleStats(w, slow).radius;
    for (let turn = 0; turn < 4; turn++) {
      advanceFar(w, mover);
      expect(dist(mover.pos, slow.pos)).toBeGreaterThanOrEqual(contact);
    }
    expect(mover.pos.x).toBeGreaterThan(slow.pos.x + contact);
    expect(mover.speed).toBeGreaterThan(slow.speed);
  });

  it('arrives next to a truck parked on its stop point', () => {
    const { w, mover } = far();
    addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 123, y: 120 });
    mover.order = { kind: 'stopAt', dest: { x: 123, y: 120 } };
    advanceFar(w, mover);
    expect(mover.order).toBeNull();
    expect(mover.speed).toBe(0);
  });

  it('lets two trucks on the same point drive apart', () => {
    const { w, mover } = far();
    addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    mover.order = { kind: 'through', dest: { x: 200, y: 120 } };
    advanceFar(w, mover);
    expect(mover.pos.x).toBeGreaterThan(121);
  });
});

describe('far NPCs and breakable props', () => {
  // A fence line along map y at x, 60 tiles long: going around it costs far more than smashing through.
  function fenceLine(x: number, y: number): Obstacle[] {
    return Array.from({ length: 64 }, (_, k) => ({ id: `fence-${k}`, pos: { x, y: y - 30 + k * 0.95 }, r: 0.5, kind: 'landmark' as const, look: 'fence' as const, yaw: Math.PI / 2 }));
  }

  it('breaks a fence on its route and drives on', () => {
    const w = emptyWorld();
    const x = 30 + LIVE + 50;
    w.obstacles = fenceLine(x, 80);
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: x - 10, y: 80 });
    npc.order = { kind: 'stopAt', dest: { x: x + 10, y: 80 } };

    for (let i = 0; i < 12 && npc.order; i++) advanceFar(w, npc);

    expect(w.broken.length).toBeGreaterThan(0);
    expect(w.broken.every((b) => !w.obstacles.includes(b.obstacle))).toBe(true);
    expect(npc.pos.x).toBeGreaterThan(x);
    expect(w.events.some((e) => e.t === 'collision' && e.a === npc.id && w.broken.some((b) => b.obstacle.id === e.b))).toBe(true);
  });

  it('leaves a fence beside its route standing', () => {
    const w = emptyWorld();
    const x = 30 + LIVE + 50;
    // Yaw 0 lays the fence along map x, two tiles beside the straight way.
    const fence: Obstacle = { id: 'fence-0', pos: { x, y: 80 }, r: 0.5, kind: 'landmark', look: 'fence', yaw: 0 };
    w.obstacles = [fence];
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: x - 10, y: 82 });
    npc.order = { kind: 'stopAt', dest: { x: x + 10, y: 82 } };

    for (let i = 0; i < 12 && npc.order; i++) advanceFar(w, npc);

    expect(w.obstacles).toEqual([fence]);
    expect(w.broken).toEqual([]);
  });
});

describe('far tower and its rope', () => {
  // A tower boxed in by parked trucks on three sides, with its hitched client parked behind it on the fourth.
  function boxedTower() {
    const w = emptyWorld();
    const tower = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
    const client = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 118, y: 120 });
    for (const pos of [{ x: 122, y: 120 }, { x: 120, y: 122 }, { x: 120, y: 118 }]) addVehicle(w, 'traders', 'scout', ['stockEngine'], pos);
    addState(w, 'tow', tower.id, client.id, { kind: 'tow', site: REGION.towns[0].id, fee: 0, waived: 0, hitched: true });
    tower.order = { kind: 'stopAt', dest: { x: 60, y: 120 } };
    return { w, tower, client };
  }

  it('drives out past the truck on its own rope instead of arriving where it stands', () => {
    const { w, tower } = boxedTower();
    advanceFar(w, tower);
    expect(tower.pos.x).toBeLessThan(119);
    expect(tower.order).not.toBeNull();
  });

  it('still counts a parked truck on another tower rope as a blocker', () => {
    const { w, tower, client } = boxedTower();
    const other = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 200, y: 200 });
    w.states = w.states.map((s) => (s.kind === 'tow' ? { ...s, holder: other.id } : s));
    advanceFar(w, tower);
    expect(dist(tower.pos, { x: 120, y: 120 })).toBeLessThan(dist(client.pos, { x: 120, y: 120 }) - 1);
  });
});
