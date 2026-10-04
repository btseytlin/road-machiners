import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { XP_TO_REACH } from '../data/skills';
import { makeVehicle } from '../sim/factory';
import { addGoods, removeAllGoods } from '../sim/inventory';
import { loadFactor, vehicleMass } from '../sim/mass';
import { corePart, mountedParts } from '../sim/grid';
import { addVehicle, editableTerrain, emptyWorld, npcBrain, partHp } from '../sim/testkit';
import type { MoveOrder, World } from '../sim/types';
import { angleDiff, bearing, dist, type Vec } from '../sim/vec';
import { REGION } from '../data/region';
import { endTurn, setDirect, setMoveOrder } from '../sim/world';
import { PHYSICS } from '../data/physics';
import { chassisDef } from '../data/chassis';
import { bodyOf } from '../sim/body';
import { buildDrive, freeDrive, initPhysics, routeAim, simulateTurn, syncDrive, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';
import { playerTow, unhitch } from '../sim/tow';
import { callVehicle, chooseOption, currentOptions } from '../sim/dialogue';
import { TOW } from '../data/tow';
import { NPCS } from '../data/npcs';
import { soundRange } from '../sim/detect';

beforeAll(async () => {
  await initPhysics();
});

// Plays n turns through the real turn pipeline with physics movement, carrying one Drive from turn
// to turn as the game does, so the body keeps its speed.
function play(w: World, n: number): { w: World; d: Drive } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  return { w, d };
}

describe('impact geometry', () => {
  it('captures rear-end contacts and relative closing speed before the turn ends', () => {
    const world = emptyWorld({ x: 35, y: 30 });
    const target = world.vehicles[0];
    target.speed = 2;
    const attacker = addVehicle(world, 'raiders', 'scout', ['mg', 'stockEngine', 'ram'], { x: 30, y: 30 });
    attacker.speed = 7;
    attacker.order = null;
    const drive = buildDrive(world);
    const result = simulateTurn(drive, world);
    try {
      const crash = result.crashes.find((hit) => [hit.a, hit.b].includes(attacker.id));
      if (!crash) throw new Error('Expected rear-end collision');
      const front = crash.a === attacker.id ? crash.contact.a : crash.contact.b;
      const rear = crash.a === target.id ? crash.contact.a : crash.contact.b;
      expect(front?.side).toBe('front');
      expect(rear?.side).toBe('rear');
      expect(crash.impact).toBeCloseTo((7 - 2) * PHYSICS.metersPerTile, 0);
      expect(structuredClone(crash)).toEqual(crash);
    } finally {
      freeDrive(result.next);
      freeDrive(drive);
    }
  });
});

function ordered(order: MoveOrder, speed = 0, heading = 0): World {
  const w = emptyWorld();
  w.vehicles[0].speed = speed;
  w.vehicles[0].heading = heading;
  return setMoveOrder(w, order);
}

const me = (w: World) => w.vehicles[0];
const HILL_GRADE = 0.2; // height per tile, steeper than 90% of the generated map's slopes
const LIMP_GRADE = 0.35; // height per tile, a steep bank beside a road

describe('physics turns', () => {
  // A handle that once belonged to a collider, as a record left behind by a removal would hold.
  const staleHandle = (d: Drive) => {
    const collider = d.world.createCollider(RAPIER.ColliderDesc.ball(1));
    const { handle } = collider;
    d.world.removeCollider(collider, false);
    return handle;
  };

  it('a synced obstacle record with no collider throws and names the prop', () => {
    const w = emptyWorld();
    const d = buildDrive(w);
    try {
      d.obstacles.rock1 = [staleHandle(d)];
      expect(() => syncDrive(d, w)).toThrow(/Obstacle rock1 has no collider/);
    } finally {
      freeDrive(d);
    }
  });

  it('a vehicle record with no body throws and names the vehicle', () => {
    const w = emptyWorld();
    const d = buildDrive(w);
    try {
      d.bodies[me(w).id] = staleHandle(d);
      expect(() => syncDrive(d, w)).toThrow(/Vehicle .* has no body/);
    } finally {
      freeDrive(d);
    }
  });

  it('a truck knocked out while driving brakes to a stop', () => {
    // One drive carried from turn to turn, as in the game, so the body keeps its speed.
    let w = ordered({ kind: 'stopAt', dest: { x: 200, y: 30 } });
    let d = buildDrive(w);
    const turn = () => {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
    };
    for (let i = 0; i < 3; i++) turn();
    expect(me(w).speed).toBeGreaterThan(1);
    corePart(me(w), 'cab').hp = 0;
    turn();
    expect(w.player.state).toBe('knockedOut');
    // A few turns of braking, then the truck stands still.
    for (let i = 0; i < 3; i++) turn();
    const at = { ...me(w).pos };
    turn();
    freeDrive(d);
    expect(dist(me(w).pos, at)).toBeLessThan(0.05);
  });

  it('two traders meeting head-on on a road both get past', () => {
    const bowl = REGION.towns[0];
    const nose = REGION.towns[1];
    const toNose = bearing(bowl.pos, nose.pos);
    const mid = { x: (bowl.pos.x + nose.pos.x) / 2, y: (bowl.pos.y + nose.pos.y) / 2 };
    const at = (d: number) => ({ x: mid.x + Math.cos(toNose) * d, y: mid.y + Math.sin(toNose) * d });
    // The player watches from the side, so both traders drive in physics.
    const w = emptyWorld({ x: mid.x + Math.cos(toNose + Math.PI / 2) * 12, y: mid.y + Math.sin(toNose + Math.PI / 2) * 12 });
    const east = addVehicle(w, 'traders', 'hauler', ['stockEngine'], at(-1.5), toNose);
    const west = addVehicle(w, 'traders', 'hauler', ['stockEngine'], at(1.5), toNose + Math.PI);
    east.brain = { ...npcBrain('trader', east.pos, ['trader']), goals: [{ kind: 'sell', targetId: 'nose', destination: { ...nose.pos }, reason: 'test', phase: 'travel' }] };
    west.brain = { ...npcBrain('trader', west.pos, ['trader']), goals: [{ kind: 'sell', targetId: 'bowl', destination: { ...bowl.pos }, reason: 'test', phase: 'travel' }] };
    const along = (p: Vec) => (p.x - mid.x) * Math.cos(toNose) + (p.y - mid.y) * Math.sin(toNose);
    // Ten turns cover a stop, a detour around the stopped truck and the drive past it.
    const { w: after } = play(w, 10);
    expect(along(after.vehicles.find((v) => v.id === east.id)!.pos)).toBeGreaterThan(5);
    expect(along(after.vehicles.find((v) => v.id === west.id)!.pos)).toBeLessThan(-5);
  });

  it('turns an NPC around for a destination behind it', () => {
    // The player stands within the live radius of the whole drive, so the NPC keeps its physics body.
    const w = emptyWorld({ x: 20, y: 50 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 30, y: 30 });
    npc.order = { kind: 'stopAt', dest: { x: 10, y: 30 } };
    // Four seconds turn a pickup around nose first on flat ground, and it is driving toward the point.
    const result = play(w, 4);
    const actor = result.w.vehicles.find((v) => v.id === npc.id)!;
    expect(Math.abs(angleDiff(actor.heading, Math.PI))).toBeLessThan(Math.PI / 2);
    expect(actor.speed).toBeGreaterThan(0);
    freeDrive(result.d);
  });

  it('limits and charges NPC fuel through the physics turn pipeline', () => {
    const initial = emptyWorld();
    const npc = addVehicle(initial, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.order = { kind: 'through', dest: { x: 25, y: 10 } };
    const dry = structuredClone(initial);
    dry.vehicles[1].resources!.fuel = 0;
    const fueled = play(initial, 2);
    const empty = play(dry, 2);
    expect(fueled.w.vehicles[1].resources!.fuel).toBeLessThan(npc.resources!.fuel);
    expect(fueled.w.vehicles[1].pos.x).toBeGreaterThan(empty.w.vehicles[1].pos.x);
    expect(empty.w.vehicles[1].resources!.fuel).toBe(0);
    freeDrive(fueled.d);
    freeDrive(empty.d);
  });

  it('a new truck sits still on flat ground', () => {
    const { w } = play(emptyWorld(), 2);
    expect(dist(me(w).pos, { x: 30, y: 30 })).toBeLessThan(0.1);
    expect(me(w).speed).toBeLessThan(0.1);
  });

  it('a parked truck without an order brakes instead of rolling faster down a slope', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    w.terrain = structuredClone(w.terrain);
    const n = w.terrain.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) w.terrain.heights[j * (n + 1) + i] = i * HILL_GRADE;
    me(w).heading = Math.PI; // facing downhill
    const { w: after, d } = play(w, 8);
    freeDrive(d);
    // Brakes slip a little on this steep grade, but the truck never picks up speed.
    expect(me(after).speed).toBeLessThan(0.05);
    expect(dist(me(after).pos, { x: 40, y: 30 })).toBeLessThan(0.6);
  });

  describe('mud driving', () => {
    // The mud-at-skill-0 run backs both tests below, so it is simulated once and read twice
    // instead of twice over independently.
    const order: MoveOrder = { kind: 'through', dest: { x: 60, y: 30 } };
    let mudSkill0: World;
    let roadSkill0: World;
    let mudSkill5: World;

    beforeAll(() => {
      const w = emptyWorld();
      editableTerrain(w).types.fill('mud');
      const mud = play(setMoveOrder(w, order), 3);
      mudSkill0 = mud.w;
      freeDrive(mud.d);
      const road = play(ordered(order), 3);
      roadSkill0 = road.w;
      freeDrive(road.d);
      w.player.skills.driving = XP_TO_REACH[5];
      const skilled = play(setMoveOrder(w, order), 3);
      mudSkill5 = skilled.w;
      freeDrive(skilled.d);
    }, 30_000); // three physics runs share this hook; the default 10s hook timeout is too tight under load

    it('mud covers less ground than road at the same order', () => {
      expect(me(mudSkill0).pos.x - 30).toBeLessThan(me(roadSkill0).pos.x - 30);
    });

    it('a player at driving level 5 covers more mud than at level 0', () => {
      expect(me(mudSkill5).pos.x).toBeGreaterThan(me(mudSkill0).pos.x);
    });
  });

  it('a far click speeds up, a mid click holds speed', () => {
    const far = play(ordered({ kind: 'through', dest: { x: 45, y: 30 } }, 3), 1).w;
    expect(me(far).speed).toBeGreaterThan(3.5);
    const mid = play(ordered({ kind: 'through', dest: { x: 35, y: 30 } }, 3), 1).w;
    expect(Math.abs(me(mid).speed - 3)).toBeLessThan(0.5);
  });

  it('steers toward a side click that starts behind a moving truck', () => {
    const dest = { x: 29, y: 34 };
    const initial = ordered({ kind: 'through', dest }, 4);
    const result = play(initial, 1);
    expect(me(result.w).order).toEqual({ kind: 'through', dest });
    expect(me(result.w).heading).toBeGreaterThan(initial.vehicles[0].heading);
    freeDrive(result.d);
  });

  it('a fast truck slows to curve onto a drive-through point inside its turning circle', () => {
    const { w, d } = play(ordered({ kind: 'through', dest: { x: 36, y: 35 } }, 7.8), 2);
    expect(me(w).order).toBeNull();
    freeDrive(d);
  });

  it('a fast truck that misses a drive-through point wide drives on instead of circling back', () => {
    const dest = { x: 33, y: 32 };
    let w = ordered({ kind: 'through', dest }, 7.8);
    let d = buildDrive(w);
    let turned = 0;
    for (let i = 0; i < 3; i++) {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      freeDrive(d);
      d = r!.next;
      turned = Math.max(turned, Math.abs(angleDiff(me(w).heading, 0)));
    }
    freeDrive(d);
    expect(me(w).order).toBeNull();
    expect(turned).toBeLessThan(Math.PI / 2);
  });

  it('from rest, a close drive-through click is reached instead of stopping short', () => {
    const { w, d } = play(ordered({ kind: 'through', dest: { x: 33, y: 30.5 } }), 8);
    expect(me(w).order).toBeNull();
    freeDrive(d);
  });

  it('a fast truck brakes before a sharp route corner instead of running into the wall past it', () => {
    let w = ordered({ kind: 'stopAt', dest: { x: 45, y: 48 } }, 7.8);
    // A wall on the right forces the route east to a corner, and a wall past the corner catches overshoot.
    for (let x = 26; x <= 43; x += 1.2) w.obstacles.push({ id: `s${x}`, pos: { x, y: 32 }, r: 0.7, kind: 'rock' });
    for (let y = 20; y <= 55; y += 1.2) w.obstacles.push({ id: `e${y}`, pos: { x: 48, y }, r: 0.7, kind: 'rock' });
    let d = buildDrive(w);
    let crashes = 0;
    for (let i = 0; i < 10 && me(w).order; i++) {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      crashes += w.events.filter((e) => e.t === 'collision').length;
      freeDrive(d);
      d = r!.next;
    }
    freeDrive(d);
    expect(crashes).toBe(0);
    expect(me(w).order).toBeNull();
  });

  it('a stop order stops on the point', () => {
    const { w } = play(ordered({ kind: 'stopAt', dest: { x: 38, y: 31 } }), 8);
    expect(dist(me(w).pos, { x: 38, y: 31 })).toBeLessThan(RULES.arriveRadius + 0.3);
    expect(me(w).order).toBeNull();
  });

  it('a stop order at a point no truck can reach arrives at the closest point the route reaches', () => {
    const dest = { x: 40, y: 31 };
    const start = ordered({ kind: 'stopAt', dest });
    start.obstacles.push({ id: 'boulder', kind: 'rock', pos: dest, r: 3 });
    const { w, d } = play(start, 12);
    expect(me(w).order).toBeNull();
    expect(dist(me(w).pos, dest)).toBeLessThan(6);
    freeDrive(d);
  });

  it('a course point behind, beyond throttle reach, turns the truck around', () => {
    const dest = { x: 30 - RULES.throttleZones.reach * 2, y: 31 };
    const { w, d } = play(ordered({ kind: 'through', dest }), 4);
    expect(Math.abs(angleDiff(me(w).heading, Math.PI))).toBeLessThan(Math.PI / 4);
    expect(me(w).speed).toBeGreaterThan(0);
    freeDrive(d);
  });

  it('a click behind outside the reverse cone turns the truck around nose first', () => {
    // One continuous drive: the truck first steps forward (still nose-first outbound), then over
    // the rest of the turns comes fully around onto the point behind it.
    const dest = { x: 26, y: 33 };
    let w = ordered({ kind: 'through', dest });
    let d = buildDrive(w);
    for (let i = 0; i < 16; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      if (i === 0) expect(me(w).pos.x).toBeGreaterThan(30);
    }
    expect(me(w).order).toBeNull();
    freeDrive(d);
  });

  it('facing a wall, a click back and to the side backs the truck out instead of pushing into the wall', () => {
    const w = ordered({ kind: 'through', dest: { x: 28, y: 27 } });
    const at = me(w).pos;
    w.obstacles = [-3, -2, -1, 0, 1, 2, 3].map((i) => ({ id: `r${i}`, pos: { x: at.x + 1.8, y: at.y + i * 1.2 }, r: 0.7, kind: 'rock' as const }));
    // The truck rolls forward one or two turns until a rock stops it, then backs out; a rock's turn decides which.
    const { w: after, d } = play(w, 14);
    expect(me(after).order).toBeNull();
    freeDrive(d);
  });

  it('after backing to a close click behind, a far click behind turns the truck around nose first', () => {
    let w = ordered({ kind: 'through', dest: { x: 24, y: 30 } });
    let d = buildDrive(w);
    const step = () => {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
    };
    step();
    const backedTo = me(w).pos.x;
    w = setMoveOrder(w, { kind: 'through', dest: { x: 5, y: 30 } });
    for (let i = 0; i < 8; i++) step();
    expect(Math.abs(angleDiff(me(w).heading, Math.PI))).toBeLessThan(Math.PI / 4);
    expect(me(w).pos.x).toBeLessThan(backedTo);
    freeDrive(d);
  });

  it('a truck blocked in front backs out about a tile, then turns nose first toward a far point behind', () => {
    const dest = { x: 5, y: 40 };
    let w = ordered({ kind: 'through', dest });
    const at = me(w).pos;
    w.obstacles = [-3, -2, -1, 0, 1, 2, 3].map((i) => ({ id: `r${i}`, pos: { x: at.x + 1.8, y: at.y + i * 1.2 }, r: 0.7, kind: 'rock' as const }));
    let d = buildDrive(w);
    let run = 0;
    let longest = 0;
    let heading = 0;
    for (let i = 0; i < 14; i++) {
      const before = me(w).pos;
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      const m = me(w);
      if (m.order) heading = angleDiff(m.heading, bearing(m.pos, dest));
      const moved = { x: m.pos.x - before.x, y: m.pos.y - before.y };
      const backing = moved.x * Math.cos(m.heading) + moved.y * Math.sin(m.heading) < -0.05;
      run = backing ? run + dist(before, m.pos) : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(RULES.reverse.distance + 1);
    expect(Math.abs(heading)).toBeLessThan(Math.PI / 4);
    freeDrive(d);
  });

  it('route aiming drops points the truck has passed, even ones still far away', () => {
    const route = [{ x: 5, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 2 }];
    expect(routeAim(route, { x: 7, y: -1 })).toEqual({ x: 10, y: 2 });
    expect(routeAim(route, { x: 3, y: 0 })).toEqual({ x: 10, y: 2 });
    expect(routeAim(route, { x: 25, y: 2 })).toEqual({ x: 20, y: 2 });
  });

  it('from rest, a click behind backs toward it rear first', () => {
    const { w } = play(ordered({ kind: 'through', dest: { x: 24, y: 31 } }), 9);
    expect(dist(me(w).pos, { x: 24, y: 31 })).toBeLessThan(RULES.passRadius + 0.5);
    expect(Math.abs(angleDiff(me(w).heading, 0))).toBeLessThan(Math.PI / 4);
  });

  it('tiles seen while driving stay explored', () => {
    const w0 = ordered({ kind: 'through', dest: { x: 50, y: 30 } }, 6);
    w0.player.explored.fill(0);
    const { w } = play(w0, 1);
    const mid = Math.round((30 + me(w).pos.x) / 2);
    expect(w.player.explored[30 * w.size + mid]).toBe(1);
    expect(w.player.explored[30 * w.size + mid + 12]).toBe(Number(me(w).pos.x + 10 >= mid + 12));
  });

  it('a frame acceleration is the speed change over its physics step', () => {
    const w = ordered({ kind: 'through', dest: { x: 60, y: 40 } }, 0);
    const d = buildDrive(w);
    const frames = simulateTurn(d, w).frames[me(w).id];
    freeDrive(d);
    const speed = (i: number) => Math.hypot(frames[i + 1].pos.x - frames[i].pos.x, frames[i + 1].pos.z - frames[i].pos.z) * PHYSICS.stepsPerSecond;
    const along = frames.map((f) => Math.hypot(f.acc.x, f.acc.z));
    // A truck starting from rest speeds up, so early frames carry forward acceleration and speed grows.
    expect(speed(20)).toBeGreaterThan(speed(5));
    expect(Math.max(...along.slice(0, 30))).toBeGreaterThan(1);
  });

  it('a brake order stops the truck and clears', () => {
    const { w } = play(ordered({ kind: 'brake' }, 4), 3);
    expect(me(w).speed).toBeLessThan(0.1);
    expect(me(w).order).toBeNull();
  });

  it('a truck at top speed swerving hard stays upright and on the ground', () => {
    let w = ordered({ kind: 'through', dest: { x: 34, y: 40 } }, 6);
    let d = buildDrive(w);
    for (let i = 0; i < 4; i++) {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      for (const f of r!.frames[me(w).id]) {
        const q = f.rot;
        expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(Math.cos(Math.PI / 6)); // tilt under 30 degrees
        expect(f.wheels.some((wh) => wh.suspension < PHYSICS.truck.suspensionRest + PHYSICS.truck.suspensionTravel)).toBe(true);
      }
      freeDrive(d);
      d = r!.next;
      w = setMoveOrder(w, { kind: 'through', dest: i % 2 ? { x: me(w).pos.x + 4, y: me(w).pos.y + 10 } : { x: me(w).pos.x - 4, y: me(w).pos.y - 10 } });
    }
  });

  it('the same state and orders give the same turn', () => {
    const w = ordered({ kind: 'through', dest: { x: 38, y: 33 } }, 2, 0.3);
    const d = buildDrive(w);
    const a = simulateTurn(d, w);
    const b = simulateTurn(d, w);
    expect(a.frames[me(w).id].at(-1)).toEqual(b.frames[me(w).id].at(-1));
  });

  it('ramming a rock is a crash that damages parts', () => {
    let w = emptyWorld();
    w.obstacles = [{ id: 'rock1', pos: { x: 36, y: 30 }, r: 0.8, kind: 'rock' }];
    w.vehicles[0].speed = 5;
    w.vehicles[0].direct = true; // a careless driver skips the route planner
    w = setMoveOrder(w, { kind: 'through', dest: { x: 45, y: 30 } });
    const hp = partHp(me(w));
    let crashes = 0;
    let d = buildDrive(w);
    for (let i = 0; i < 3; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      crashes += w.events.filter((e) => e.t === 'collision' && e.b === 'rock1').length;
      freeDrive(d);
      d = next!;
    }
    expect(crashes).toBeGreaterThan(0);
    expect(partHp(me(w))).toBeLessThan(hp);
  });

  it('in manual mode the truck drives into a truck parked on its path; off, it routes around', () => {
    const drive = (manual: boolean) => {
      let w = ordered({ kind: 'through', dest: { x: 45, y: 30 } }, 3);
      const parked = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 37, y: 30 }, Math.PI / 2);
      w = setDirect(w, manual);
      let d = buildDrive(w);
      const hits: string[] = [];
      for (let i = 0; i < 4; i++) {
        let next: Drive | null = null;
        w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
        hits.push(...w.events.flatMap((e) => (e.t === 'collision' ? [e.b] : [])));
        freeDrive(d);
        d = next!;
      }
      freeDrive(d);
      return { hits, parked: parked.id, w };
    };
    const on = drive(true);
    expect(on.hits).toContain(on.parked);
    expect(me(on.w).direct).toBe(true);
    const off = drive(false);
    expect(off.hits).toEqual([]);
    expect(me(off.w).pos.x).toBeGreaterThan(38);
  });

  it('a careful driver follows the route around a rock wall', () => {
    let w = ordered({ kind: 'stopAt', dest: { x: 40, y: 30 } });
    w.obstacles = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, pos: { x: 34, y: 28 + i * 1.5 }, r: 0.8, kind: 'rock' as const }));
    let d = buildDrive(w);
    let crashes = 0;
    for (let i = 0; i < 12 && me(w).order; i++) {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      crashes += w.events.filter((e) => e.t === 'collision').length;
      freeDrive(d);
      d = r!.next;
    }
    expect(crashes).toBe(0);
    expect(dist(me(w).pos, { x: 40, y: 30 })).toBeLessThan(RULES.arriveRadius + 0.3);
  });

  it('a site stops the truck at its edge; its buildings are scenery', () => {
    let w = ordered({ kind: 'through', dest: { x: 45, y: 30 } }, 4);
    w.obstacles = [
      { id: 'site-test', pos: { x: 40, y: 30 }, r: 3, kind: 'site' },
      { id: 'bld-test-0', pos: { x: 35.5, y: 30 }, r: 0.6, kind: 'building' },
    ];
    w.vehicles[0].direct = true; // drive straight at the site instead of around it
    let d = buildDrive(w);
    expect(d.obstacles['bld-test-0']).toBeUndefined();
    const hits: string[] = [];
    for (let i = 0; i < 4; i++) {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      hits.push(...w.events.flatMap((e) => (e.t === 'collision' ? [e.b] : [])));
      freeDrive(d);
      d = r!.next;
    }
    expect(hits).toContain('site-test');
    expect(hits).not.toContain('bld-test-0');
    expect(dist(me(w).pos, { x: 40, y: 30 })).toBeGreaterThan(3);
  });

  it('a truck without an engine is pushed toward the click at limp speed, burns no fuel and makes no sound', () => {
    const w0 = ordered({ kind: 'stopAt', dest: { x: 38, y: 30 } });
    w0.vehicles[0].items = w0.vehicles[0].items.filter((it) => it.kind !== 'part' || partDef(it.part.defId).kind !== 'engine');
    const fuel = w0.player.fuel;
    const { w, d } = play(w0, 3);
    expect(me(w).pos.x).toBeGreaterThan(30 + RULES.limpSpeed);
    expect(me(w).speed).toBeLessThanOrEqual(RULES.limpSpeed + 0.3);
    expect(w.player.fuel).toBe(fuel);
    expect(soundRange(w, me(w))).toBe(0);
    freeDrive(d);
  });

  it('an empty tank still crawls toward the click', () => {
    const w0 = ordered({ kind: 'through', dest: { x: 45, y: 30 } });
    w0.player.fuel = 0;
    const { w } = play(w0, 2);
    expect(me(w).pos.x).toBeGreaterThan(30.5);
    expect(me(w).speed).toBeLessThanOrEqual(RULES.limpSpeed + 0.3);
  });

  it('low fuel halves the top speed', () => {
    const w0 = ordered({ kind: 'through', dest: { x: 59, y: 30 } }, 5);
    w0.player.fuel = 2; // under the low-fuel share of the tank, enough to drive
    const { w } = play(w0, 2);
    expect(me(w).speed).toBeLessThan(5);
  });

  it('a truck loaded with scrap covers less distance from rest than an empty one', () => {
    const empty = ordered({ kind: 'through', dest: { x: 59, y: 30 } });
    removeAllGoods(me(empty));
    const loaded = ordered({ kind: 'through', dest: { x: 59, y: 30 } });
    addGoods(loaded, me(loaded), 'scrap', 999);
    expect(vehicleMass(me(loaded))).toBeGreaterThan(vehicleMass(me(empty)));
    const a = play(empty, 2).w;
    const b = play(loaded, 2).w;
    expect(me(b).pos.x - 30).toBeLessThan(me(a).pos.x - 30);
  });

  it('the physics body mass follows the loadout on sync', () => {
    const w = emptyWorld();
    const d = buildDrive(w);
    const body = () => d.world.getRigidBody(d.bodies[me(w).id]);
    expect(body().mass()).toBeCloseTo(vehicleMass(me(w)), 0);
    addGoods(w, me(w), 'scrap', 999);
    syncDrive(d, w);
    expect(body().mass()).toBeCloseTo(vehicleMass(me(w)), 0);
    freeDrive(d);
  });

  it('a fully loaded hauler still climbs a hill', () => {
    const w0 = emptyWorld({ x: 26, y: 30 });
    w0.terrain = structuredClone(w0.terrain);
    const n = w0.terrain.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) w0.terrain.heights[j * (n + 1) + i] = Math.max(0, i - 28) * HILL_GRADE;
    const hauler = makeVehicle(w0, { name: 'hauler', faction: 'player', chassisId: 'hauler', parts: ['mg', 'stockEngine', 'plates', 'trailerBox'].map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {}, pos: { x: 26, y: 30 }, heading: 0, brain: null });
    w0.vehicles[0] = { ...hauler, id: me(w0).id };
    addGoods(w0, me(w0), 'scrap', 999);
    expect(loadFactor(me(w0))).toBeLessThan(1);
    w0.player.fuel = 999;
    const { w } = play(setMoveOrder(w0, { kind: 'through', dest: { x: 58, y: 30 } }), 6);
    // Up the slope, which starts at x 28, and still moving rather than stalling. Overload slows it hard.
    expect(me(w).pos.x).toBeGreaterThan(30);
    expect(me(w).speed).toBeGreaterThan(0.5);
  });

  it('a limping courier crawls up a bank as steep as any chassis limps up', () => {
    const w0 = emptyWorld({ x: 26, y: 30 });
    w0.terrain = structuredClone(w0.terrain);
    const n = w0.terrain.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) w0.terrain.heights[j * (n + 1) + i] = Math.max(0, i - 28) * LIMP_GRADE;
    const courier = makeVehicle(w0, { name: 'courier', faction: 'player', chassisId: 'courier', parts: [{ defId: 'stockEngine', wear: 0 }], spares: [], cargo: {}, pos: { x: 26, y: 30 }, heading: 0, brain: null });
    w0.vehicles[0] = { ...courier, id: me(w0).id };
    mountedParts(me(w0), 'engine')[0].hp = 0;
    const { w } = play(setMoveOrder(w0, { kind: 'through', dest: { x: 58, y: 30 } }), 12);
    expect(me(w).pos.x).toBeGreaterThan(32);
    expect(me(w).speed).toBeGreaterThan(0.5);
  }, 90_000); // twelve physics turns take 5s alone and over 30s when the whole suite shares the cores

  it('a click in the hold zone keeps its speed up a hill', () => {
    let w = emptyWorld({ x: 29, y: 30 });
    const t = editableTerrain(w);
    const n = t.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) t.heights[j * (n + 1) + i] = Math.max(0, i - 28) * HILL_GRADE;
    let d = buildDrive(w);
    const speeds: number[] = [];
    for (let i = 0; i < 8; i++) {
      // Each turn the player clicks the middle of the hold zone again.
      w = setMoveOrder(w, { kind: 'through', dest: { x: me(w).pos.x + RULES.throttleZones.reach / 2, y: 30 } });
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      speeds.push(me(w).speed);
    }
    freeDrive(d);
    expect(speeds[7]).toBeGreaterThan(speeds[1] * 0.95);
  }, 90_000); // physics turns up a hill take over 30s when the whole suite shares the cores

  it('new vehicles and obstacles join the physics world', () => {
    const w = emptyWorld();
    const d = buildDrive(w);
    addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
    w.obstacles.push({ id: 'wreck1', pos: { x: 20, y: 20 }, r: 0.6, kind: 'wreck' });
    syncDrive(d, w);
    expect(Object.keys(d.bodies)).toHaveLength(2);
    expect(d.obstacles.wreck1).toBeDefined();
    w.vehicles.pop();
    syncDrive(d, w);
    expect(Object.keys(d.bodies)).toHaveLength(1);
  });

  it('a hitched player leaves physics and returns on unhitch', () => {
    let w = emptyWorld();
    w.player.fuel = 0;
    // A spawned driver could open its own call and hold the turns.
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    let d = buildDrive(w);
    const turn = () => {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      freeDrive(d);
      d = r!.next;
      return r!;
    };
    for (let i = 0; i < 30 && !playerTow(w); i++) turn();
    expect(playerTow(w)).not.toBeNull();
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Deal. Hitch me up.'));
    const start = { ...me(w).pos };
    for (let i = 0; i < 10; i++) {
      const r = turn();
      expect(d.bodies[me(w).id]).toBeUndefined();
      expect(r.frames[me(w).id]).toBeUndefined();
    }
    expect(dist(me(w).pos, start)).toBeGreaterThan(3);
    w = unhitch(w);
    for (let i = 0; i < 3; i++) turn();
    expect(d.bodies[me(w).id]).toBeDefined();
    freeDrive(d);
  });

  it('an NPC on the player rope leaves physics, trails the player and returns when let go', () => {
    let w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 26, y: 30 }, 0);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.fuel = 0;
    let d = buildDrive(w);
    const turn = () => {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      freeDrive(d);
      d = r!.next;
      return r!;
    };
    const pick = (text: string) => { w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === text)); };
    w = callVehicle(w, npc.id);
    pick('Need a tow to town?');
    pick('Deal. Hitch up.');
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 60, y: 30 } });
    const start = { ...npc.pos };
    for (let i = 0; i < 6; i++) {
      const r = turn();
      expect(d.bodies[npc.id]).toBeUndefined();
      expect(r.frames[npc.id]).toBeUndefined();
    }
    const towed = w.vehicles.find((v) => v.id === npc.id)!;
    expect(dist(towed.pos, start)).toBeGreaterThan(3);
    expect(dist(towed.pos, me(w).pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
    w = callVehicle(w, npc.id);
    pick('I am letting you off the rope here.');
    pick('Over and out.');
    for (let i = 0; i < 3; i++) turn();
    expect(d.bodies[npc.id]).toBeDefined();
    freeDrive(d);
  });
});

describe('stranded trucks', () => {
  // Plays turns from d and collects each turn's strandedTurns of the player truck.
  function strandedRun(w: World, d: Drive, turns: number): { w: World; counts: number[] } {
    const counts: number[] = [];
    for (let i = 0; i < turns; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      counts.push(w.vehicles[0].strandedTurns!);
    }
    freeDrive(d);
    return { w, counts };
  }

  const expected = [...Array.from({ length: RULES.stranded.turns }, (_, i) => i + 1), 0];

  it('sets a truck back on its wheels after it ends the stranded turns flipped', () => {
    const w = emptyWorld();
    const d = buildDrive(w);
    d.world.getRigidBody(d.bodies[w.vehicles[0].id]).setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); // upside down
    expect(strandedRun(w, d, RULES.stranded.turns + 1).counts).toEqual(expected);
  });

  it('sets a truck lying on top of another truck down on free ground beside it', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 30, y: 30 });
    const d = buildDrive(w);
    // The player truck rests level on the hauler's roof, with its wheels in the air.
    const under = d.world.getRigidBody(d.bodies[npc.id]).translation();
    const top = d.world.getRigidBody(d.bodies[w.vehicles[0].id]);
    top.setTranslation({ x: under.x, y: under.y + bodyOf('hauler').half.y + bodyOf(w.vehicles[0].chassisId).half.y * 2, z: under.z }, true);
    const { w: after, counts } = strandedRun(w, d, RULES.stranded.turns + 1);
    expect(counts).toEqual(expected);
    const me = after.vehicles[0];
    const hauler = after.vehicles.find((v) => v.id === npc.id)!;
    expect(dist(me.pos, hauler.pos)).toBeGreaterThan(chassisDef(me.chassisId).radius + chassisDef('hauler').radius);
  });
});
