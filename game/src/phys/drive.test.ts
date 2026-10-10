import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { makePart, makeVehicle } from '../sim/factory';
import { addGoods, mountPart, removeAllGoods } from '../sim/inventory';
import { loadFactor, vehicleMass } from '../sim/mass';
import { corePart, mountedParts } from '../sim/grid';
import { addVehicle, editableTerrain, emptyWorld, npcBrain, partHp } from '../sim/testkit';
import type { MoveOrder, World } from '../sim/types';
import { angleDiff, bearing, DEG, dist, type Vec } from '../sim/vec';
import { REGION } from '../data/region';
import { TERRAIN_TYPES } from '../data/terrain';
import { endTurn, setDirect, setMoveOrder } from '../sim/world';
import { PHYSICS } from '../data/physics';
import { chassisDef } from '../data/chassis';
import { bodyOf } from '../sim/body';
import { buildDrive, freeDrive, initPhysics, restWheels, routeAim, simulateTurn, syncDrive, tailKick, trailFrames, TURN_STEPS, type Drive, type TurnResult } from './drive';
import { headingOf, upOf } from './frames';
import { dropClearance, spillOil, type OilSpill } from '../sim/hazards';
import { OIL, oilSlickLength } from '../data/utilities';
import { physicsMove } from './turn';
import type { VehicleFrame } from './frames';
import { playerTow, unhitch } from '../sim/tow';
import { callVehicle, chooseOption, currentOptions } from '../sim/dialogue';
import { TOW } from '../data/tow';
import { NPCS } from '../data/npcs';
import { soundRange } from '../sim/detect';
import { budget } from '../test/budget';
import { lineKey } from '../text/names';
import { entryText } from '../text/resolve';

// A line's English words, so the tests read like the talk they check.
const en = (line: Parameters<typeof lineKey>[0]): string => entryText('en', lineKey(line));

beforeAll(async () => {
  await initPhysics();
});

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

async function playYielding(w: World, n: number): Promise<{ w: World; d: Drive }> {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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

  function noseRam(arm: boolean, into: 'truck' | 'rock' = 'truck'): World {
    let w = emptyWorld();
    w.vehicles[0].speed = 7;
    w.vehicles[0].heading = 0;
    w.vehicles[0].items = w.vehicles[0].items.filter((i) => !(i.kind === 'part' && i.part.defId === 'cage'));
    const ram = makePart(w, 'claymoreRam', 0);
    if (!mountPart(w, w.vehicles[0], ram)) throw new Error('No front mount for the claymore ram');
    ram.charge = arm ? { reload: 0, armed: true } : { reload: 0 };
    if (into === 'rock') w.obstacles = [{ id: 'rock1', pos: { x: 37, y: 30 }, r: 0.8, kind: 'rock' }];
    else addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 37, y: 30 }, Math.PI / 2).brain = npcBrain('trader', { x: 37, y: 30 }, ['trader']);
    w = setDirect(w, true);
    return setMoveOrder(w, { kind: 'through', dest: { x: 45, y: 30 } });
  }

  function ramTurns(w: World, n: number): { w: World; blasts: string[] } {
    let d = buildDrive(w);
    const blasts: string[] = [];
    for (let i = 0; i < n; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      blasts.push(...w.events.flatMap((e) => (e.t === 'claymore' ? [e.other] : [])));
      freeDrive(d);
      d = next!;
    }
    freeDrive(d);
    return { w, blasts };
  }

  it('counts a nose ram at its full closing speed on the rammer front and the rammed side', () => {
    const world = noseRam(false);
    const [me, parked] = world.vehicles;
    const drive = buildDrive(world);
    const result = simulateTurn(drive, world);
    try {
      const crash = result.crashes.find((hit) => hit.a === me.id && hit.b === parked.id);
      if (!crash) throw new Error('Expected the nose ram');
      expect(crash.impact).toBeGreaterThan(0.8 * 7 * PHYSICS.metersPerTile);
      expect(crash.contact.a.side).toBe('front');
      expect(crash.contact.b?.side).toBe('right');
    } finally {
      freeDrive(result.next);
      freeDrive(drive);
    }
  });

  it('blows an armed claymore ram in a nose ram', () => {
    const { w, blasts } = ramTurns(noseRam(true), 2);
    expect(blasts).toEqual([w.vehicles[1].id]);
  });

  function afterRam(arm: boolean): { gap: number; lowestUp: number } {
    const w = noseRam(arm);
    const d = buildDrive(w);
    const r = simulateTurn(d, w);
    try {
      const [a, b] = w.vehicles.map((v) => r.frames[v.id]);
      const i = Math.min(a.length - 1, r.crashes[0].step + 12);
      return { gap: Math.hypot(a[i].pos.x - b[i].pos.x, a[i].pos.z - b[i].pos.z), lowestUp: Math.min(...[...a, ...b].map((f) => upOf(f.rot))) };
    } finally {
      freeDrive(r.next);
      freeDrive(d);
    }
  }

  it('throws both trucks apart in a claymore blast, without rolling either', () => {
    const plain = afterRam(false);
    const blown = afterRam(true);
    expect(blown.gap).toBeGreaterThan(plain.gap + 3);
    expect(blown.lowestUp).toBeGreaterThan(0.5);
  });

  it('throws each truck back from the other over the next turns', () => {
    const plain = ramTurns(noseRam(false), 2).w;
    const blown = ramTurns(noseRam(true), 2).w;
    expect(blown.vehicles[0].pos.x).toBeLessThan(plain.vehicles[0].pos.x - 1.5);
    expect(blown.vehicles[1].pos.x).toBeGreaterThan(plain.vehicles[1].pos.x + 1);
  });

  it('blows an armed claymore ram against a rock, even when the crash breaks the ram, and throws the truck back', () => {
    const plain = ramTurns(noseRam(false, 'rock'), 2).w;
    const blown = ramTurns(noseRam(true, 'rock'), 2);
    expect(blown.blasts).toEqual(['rock1']);
    expect(blown.w.vehicles[0].pos.x).toBeLessThan(plain.vehicles[0].pos.x - 1.5);
  });
});

function ordered(order: MoveOrder, speed = 0, heading = 0): World {
  const w = emptyWorld();
  w.vehicles[0].speed = speed;
  w.vehicles[0].heading = heading;
  return setMoveOrder(w, order);
}

const me = (w: World) => w.vehicles[0];
const HILL_GRADE = 0.2;
const LIMP_GRADE = 0.35;
const KICK_SEEN = 0.2;

describe('physics turns', () => {
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
      expect(() => syncDrive(d, w)).toThrow(/Obstacle or crater rock1 has no collider/);
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
    const mid = { x: bowl.pos.x + (nose.pos.x - bowl.pos.x) * 0.4, y: bowl.pos.y + (nose.pos.y - bowl.pos.y) * 0.4 };
    const at = (d: number) => ({ x: mid.x + Math.cos(toNose) * d, y: mid.y + Math.sin(toNose) * d });
    const w = emptyWorld({ x: mid.x + Math.cos(toNose + Math.PI / 2) * 12, y: mid.y + Math.sin(toNose + Math.PI / 2) * 12 });
    const east = addVehicle(w, 'traders', 'hauler', ['stockEngine'], at(-1.5), toNose);
    const west = addVehicle(w, 'traders', 'hauler', ['stockEngine'], at(1.5), toNose + Math.PI);
    east.brain = { ...npcBrain('trader', east.pos, ['trader']), goals: [{ kind: 'sell', targetId: 'nose', destination: { ...nose.pos }, reason: 'tripToSite', phase: 'travel' }] };
    west.brain = { ...npcBrain('trader', west.pos, ['trader']), goals: [{ kind: 'sell', targetId: 'bowl', destination: { ...bowl.pos }, reason: 'tripToSite', phase: 'travel' }] };
    const along = (p: Vec) => (p.x - mid.x) * Math.cos(toNose) + (p.y - mid.y) * Math.sin(toNose);
    const { w: after } = play(w, 10);
    expect(along(after.vehicles.find((v) => v.id === east.id)!.pos)).toBeGreaterThan(5);
    expect(along(after.vehicles.find((v) => v.id === west.id)!.pos)).toBeLessThan(-5);
  });

  it('turns an NPC around for a destination behind it', () => {
    const w = emptyWorld({ x: 20, y: 50 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 30, y: 30 });
    npc.order = { kind: 'stopAt', dest: { x: 10, y: 30 } };
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
    me(w).heading = Math.PI;
    const { w: after, d } = play(w, 8);
    freeDrive(d);
    expect(me(after).speed).toBeLessThan(0.05);
    expect(dist(me(after).pos, { x: 40, y: 30 })).toBeLessThan(0.6);
  });

  describe('mud driving', () => {
    const order: MoveOrder = { kind: 'through', dest: { x: 60, y: 30 } };
    let mudSkill0: World;
    let roadSkill0: World;
    let mudSkill5: World;

    beforeAll(async () => {
      const w = emptyWorld();
      editableTerrain(w).types.fill('mud');
      const mud = await playYielding(setMoveOrder(w, order), 3);
      mudSkill0 = mud.w;
      freeDrive(mud.d);
      const road = await playYielding(ordered(order), 3);
      roadSkill0 = road.w;
      freeDrive(road.d);
      w.player.ranks.driving = 5;
      const skilled = await playYielding(setMoveOrder(w, order), 3);
      mudSkill5 = skilled.w;
      freeDrive(skilled.d);
    }, budget(120_000));

    it('mud covers less ground than road at the same order', () => {
      expect(me(mudSkill0).pos.x - 30).toBeLessThan(me(roadSkill0).pos.x - 30);
    });

    it('a player at driving rank 5 covers more mud than at rank 0', () => {
      expect(me(mudSkill5).pos.x).toBeGreaterThan(me(mudSkill0).pos.x);
    });
  });

  describe('glass grip', () => {
    const SPEED = 6;

    function onGround(type: 'sand' | 'glass', order: MoveOrder, turns: number): World {
      const w = emptyWorld({ x: 20, y: 40 });
      editableTerrain(w).types.fill(type);
      w.vehicles[0].speed = SPEED;
      const { w: after, d } = play(setMoveOrder(w, order), turns);
      freeDrive(d);
      return after;
    }

    it('only glass and the mud grounds have less than full grip', () => {
      const slippery = Object.values(TERRAIN_TYPES).filter((t) => t.grip !== 1 || t.sideGrip !== 1).map((t) => t.id);
      expect(slippery).toEqual(['mud', 'dirtyWater', 'toxic', 'glass']);
    });

    function meanSkid(type: 'sand' | 'glass'): number {
      let w = emptyWorld({ x: 20, y: 40 });
      editableTerrain(w).types.fill(type);
      w.vehicles[0].speed = SPEED;
      w = setMoveOrder(w, { kind: 'through', dest: { x: 30, y: 70 } });
      let d = buildDrive(w);
      const frames: VehicleFrame[] = [];
      for (let i = 0; i < 3; i++) {
        let next: Drive | null = null;
        w = endTurn(w, physicsMove(d, (r) => {
          next = r.next;
          frames.push(...r.frames[w.vehicles[0].id]);
        }));
        freeDrive(d);
        d = next!;
      }
      freeDrive(d);
      const skids = frames.slice(1).flatMap((f, i) => {
        const [a, b, q] = [frames[i].pos, f.pos, f.rot];
        if (Math.hypot(b.x - a.x, b.z - a.z) * PHYSICS.stepsPerSecond < 2) return [];
        const nose = Math.atan2(2 * (q.x * q.z - q.w * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        return [Math.abs(angleDiff(Math.atan2(b.z - a.z, b.x - a.x), nose)) * (180 / Math.PI)];
      });
      return skids.reduce((s, x) => s + x, 0) / skids.length;
    }

    it('a turning truck skids sideways on glass and holds its line on sand', () => {
      expect(meanSkid('sand')).toBeLessThan(3);
      expect(meanSkid('glass')).toBeGreaterThan(10);
    });

    it('a braking truck slides further on glass than on sand', () => {
      const sand = onGround('sand', { kind: 'brake' }, 1);
      const glass = onGround('glass', { kind: 'brake' }, 1);
      expect(me(glass).pos.x - 20).toBeGreaterThan((me(sand).pos.x - 20) * 1.5);
      expect(me(glass).speed).toBeGreaterThan(me(sand).speed);
    });

    it('a truck turns wider on glass than on sand with the same click', () => {
      const click: MoveOrder = { kind: 'through', dest: { x: 20, y: 80 } };
      const sand = onGround('sand', click, 1);
      const glass = onGround('glass', click, 1);
      expect(Math.abs(angleDiff(me(glass).heading, Math.PI / 2))).toBeGreaterThan(Math.abs(angleDiff(me(sand).heading, Math.PI / 2)));
    });

    it('a truck sent to a point on glass still arrives and stops', () => {
      const dest = { x: 60, y: 40 };
      const after = onGround('glass', { kind: 'stopAt', dest }, 14);
      expect(dist(me(after).pos, dest)).toBeLessThan(RULES.arriveRadius * 2);
      expect(me(after).speed).toBeLessThan(0.5);
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
    const { w, d } = play(ordered({ kind: 'through', dest: { x: 33, y: 30.5 } }), 12);
    expect(me(w).order).toBeNull();
    freeDrive(d);
  });

  it('a fast truck brakes before a sharp route corner instead of running into the wall past it', () => {
    let w = ordered({ kind: 'stopAt', dest: { x: 45, y: 48 } }, 7.8);
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
    const dest = { x: 26, y: 33 };
    let w = ordered({ kind: 'through', dest });
    let d = buildDrive(w);
    for (let i = 0; i < 24; i++) {
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
    const { w: after, d } = play(w, 22);
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

  it('a truck arriving at a stop point never backs out of it', () => {
    let w = ordered({ kind: 'stopAt', dest: { x: 38, y: 30 } });
    const dest = { x: 38, y: 30 };
    let d = buildDrive(w);
    for (let i = 0; i < 12; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      expect(d.memory[me(w).id].backFrom).toBeNull();
    }
    expect(dist(me(w).pos, dest)).toBeLessThan(RULES.arriveRadius * 2);
    freeDrive(d);
  });

  it('a truck told to creep slower than pushSpeed is not blocked, however slowly it moves', () => {
    let w = ordered({ kind: 'through', dest: { x: 60, y: 30 } });
    let d = buildDrive(w);
    for (let i = 0; i < 6; i++) {
      me(w).order = { kind: 'through', dest: { x: 60, y: 30 }, pace: 0.01 };
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      expect(d.memory[me(w).id].backFrom).toBeNull();
    }
    freeDrive(d);
  });

  it('route aiming drops points the truck has passed, even ones still far away', () => {
    const route = [{ x: 5, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 2 }];
    expect(routeAim(route, { x: 7, y: -1 })).toEqual({ x: 10, y: 2 });
    expect(routeAim(route, { x: 3, y: 0 })).toEqual({ x: 10, y: 2 });
    expect(routeAim(route, { x: 25, y: 2 })).toEqual({ x: 20, y: 2 });
  });

  it('from rest, a click behind backs toward it rear first', () => {
    const { w } = play(ordered({ kind: 'through', dest: { x: 24, y: 31 } }), 14);
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
        expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(Math.cos(Math.PI / 6));
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
    w.vehicles[0].direct = true;
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
    w.vehicles[0].direct = true;
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
    w0.player.fuel = 2;
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

  it('a fully loaded hauler still climbs a hill', async () => {
    const w0 = emptyWorld({ x: 26, y: 30 });
    w0.terrain = structuredClone(w0.terrain);
    const n = w0.terrain.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) w0.terrain.heights[j * (n + 1) + i] = Math.max(0, i - 28) * HILL_GRADE;
    const hauler = makeVehicle(w0, { faction: 'player', chassisId: 'hauler', parts: ['mg', 'stockEngine', 'plates', 'trailerBox'].map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {}, pos: { x: 26, y: 30 }, heading: 0, brain: null });
    w0.vehicles[0] = { ...hauler, id: me(w0).id };
    addGoods(w0, me(w0), 'scrap', 999);
    expect(loadFactor(me(w0))).toBeLessThan(1);
    w0.player.fuel = 999;
    const { w } = await playYielding(setMoveOrder(w0, { kind: 'through', dest: { x: 58, y: 30 } }), 8);
    expect(me(w).pos.x).toBeGreaterThan(30);
    expect(me(w).speed).toBeGreaterThan(0.5);
  }, budget(240_000));

  it('a limping courier crawls up a bank as steep as any chassis limps up', async () => {
    const w0 = emptyWorld({ x: 26, y: 30 });
    w0.terrain = structuredClone(w0.terrain);
    const n = w0.terrain.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) w0.terrain.heights[j * (n + 1) + i] = Math.max(0, i - 28) * LIMP_GRADE;
    const courier = makeVehicle(w0, { faction: 'player', chassisId: 'courier', parts: [{ defId: 'stockEngine', wear: 0 }], spares: [], cargo: {}, pos: { x: 26, y: 30 }, heading: 0, brain: null });
    w0.vehicles[0] = { ...courier, id: me(w0).id };
    mountedParts(me(w0), 'engine')[0].hp = 0;
    const { w } = await playYielding(setMoveOrder(w0, { kind: 'through', dest: { x: 58, y: 30 } }), 12);
    expect(me(w).pos.x).toBeGreaterThan(32);
    expect(me(w).speed).toBeGreaterThan(0.5);
  }, budget(240_000));

  it('a click in the hold zone keeps its speed up a hill', async () => {
    let w = emptyWorld({ x: 29, y: 30 });
    const t = editableTerrain(w);
    const n = t.size;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) t.heights[j * (n + 1) + i] = Math.max(0, i - 28) * HILL_GRADE;
    let d = buildDrive(w);
    const speeds: number[] = [];
    for (let i = 0; i < 8; i++) {
      w = setMoveOrder(w, { kind: 'through', dest: { x: me(w).pos.x + RULES.throttleZones.reach / 2, y: 30 } });
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      speeds.push(me(w).speed);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    freeDrive(d);
    expect(speeds[7]).toBeGreaterThan(speeds[1] * 0.95);
  }, budget(240_000));

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
    w = chooseOption(w, currentOptions(w).findIndex((o) => en(o.line) === 'Deal. Hitch me up.'));
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
    const pick = (text: string) => { w = chooseOption(w, currentOptions(w).findIndex((o) => en(o.line) === text)); };
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
    d.world.getRigidBody(d.bodies[w.vehicles[0].id]).setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    expect(strandedRun(w, d, RULES.stranded.turns + 1).counts).toEqual(expected);
  });

  it('sets a truck lying on top of another truck down on free ground beside it', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 30, y: 30 });
    const d = buildDrive(w);
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

describe('oil patches', () => {
  function oiled(dest: Vec, patches: Vec[], r = 1.25): World {
    const w = setDirect(ordered({ kind: 'through', dest }, 6), true);
    w.fields = patches.map((pos, i) => ({ id: `oil${i}`, kind: 'oil', source: me(w).id, pos, r, turnsLeft: 8, hit: [] }));
    return w;
  }

  function endOfTurn(w: World): { x: number; z: number } {
    const d = buildDrive(w);
    const r = simulateTurn(d, w);
    const { pos } = r.frames[me(w).id].at(-1)!;
    freeDrive(r.next);
    freeDrive(d);
    return { x: pos.x, z: pos.z };
  }

  function slick(x0: number, x1: number, y0: number, y1: number): Vec[] {
    const out: Vec[] = [];
    for (let x = x0; x <= x1; x += 2) for (let y = y0; y <= y1; y += 2) out.push({ x, y });
    return out;
  }

  function spillOf(): OilSpill {
    const def = partDef('oilSpiller');
    if (def.kind !== 'utility' || def.effect.type !== 'oil') throw new Error('The oil spiller spills no oil');
    return def.effect;
  }

  function streakAhead(speed: number, spills: number, gap = 2): World {
    const w = ordered({ kind: 'through', dest: { x: 80, y: 30 } }, speed);
    const spill = spillOf();
    const dropper = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 0, y: 30 });
    dropper.pos = { x: 30 + gap + dropClearance(dropper, spill.behind) + oilSlickLength(), y: 30 };
    for (let i = 0; i < spills; i++) spillOil(w, dropper, spill);
    w.vehicles = w.vehicles.filter((v) => v.id !== dropper.id);
    w.player.visible = [];
    return w;
  }

  function crossing(w: World): { x: number; z: number; heading: number; lowestUp: number; kicks: number } {
    const d = buildDrive(w);
    const r = simulateTurn(d, w);
    const frames = r.frames[me(w).id];
    freeDrive(r.next);
    freeDrive(d);
    const yaw = frames.slice(1).map((f, i) => angleDiff(headingOf(frames[i].rot), headingOf(f.rot)) * PHYSICS.stepsPerSecond);
    const kicks = yaw.slice(1).filter((rate, i) => Math.abs(rate - yaw[i]) > KICK_SEEN).length;
    const end = frames.at(-1)!;
    return { x: end.pos.x, z: end.pos.z, heading: headingOf(end.rot), lowestUp: Math.min(...frames.map((f) => upOf(f.rot))), kicks };
  }

  it('a truck crossing a slick straight at 10 tiles per turn loses its line', () => {
    const dry = crossing(streakAhead(10, 0));

    const wet = crossing(streakAhead(10, 1));

    const turned = Math.abs(angleDiff(dry.heading, wet.heading)) >= 20 * DEG;
    const offset = Math.abs(wet.z - dry.z) >= 2;
    expect(turned || offset).toBe(true);
  });

  it('a truck crossing a slick straight at 3 tiles per turn keeps its line', () => {
    const dry = crossing(streakAhead(3, 0, 0.5));

    const wet = crossing(streakAhead(3, 1, 0.5));

    expect(Math.hypot(wet.x - dry.x, wet.z - dry.z)).toBeLessThan(0.5);
  });

  it('kicks the tail once in a turn, however long the rear wheels stay on oil', () => {
    const dry = crossing(streakAhead(10, 0));

    const wet = crossing(streakAhead(10, 1));

    expect(dry.kicks).toBe(0);
    expect(wet.kicks).toBe(1);
  });

  it('gives no kick to a truck reaching oil at the safe speed', () => {
    expect(crossing(streakAhead(3.5, 1, 0.5)).kicks).toBe(0);
  });

  it('gives the same end pose twice from the same input', () => {
    expect(crossing(streakAhead(10, 1))).toEqual(crossing(streakAhead(10, 1)));
  });

  it('two slicks on one spot act as one', () => {
    expect(crossing(streakAhead(10, 2))).toEqual(crossing(streakAhead(10, 1)));
  });

  it('leaves no truck rolled over after a kick', () => {
    for (const speed of [5, 6, 8, 10, 12]) expect(crossing(streakAhead(speed, 1)).lowestUp).toBeGreaterThan(0.5);
  });

  it('sizes the kick by speed over the safe speed, up to the cap', () => {
    const left = [false, false, true, false];

    expect(Math.abs(tailKick(OIL.safeSpeed, left, 0))).toBe(0);
    expect(Math.abs(tailKick(OIL.safeSpeed * 2, left, 0))).toBeCloseTo(OIL.kick);
    expect(Math.abs(tailKick(1000, left, 0))).toBe(OIL.maxKick);
  });

  it('swings the tail toward the oiled rear wheel, and with both on oil with the yaw rate or else to the left', () => {
    const fast = OIL.safeSpeed * 3;

    expect(tailKick(fast, [false, false, true, false], 0)).toBeLessThan(0);
    expect(tailKick(fast, [false, false, false, true], 0)).toBeGreaterThan(0);
    expect(tailKick(fast, [false, false, true, true], -0.1)).toBeLessThan(0);
    expect(tailKick(fast, [false, false, true, true], 0.1)).toBeGreaterThan(0);
    expect(tailKick(fast, [false, false, true, true], 0)).toBeGreaterThan(0);
  });

  it('refuses a kick with no rear wheel on oil', () => {
    expect(() => tailKick(10, [true, true, false, false], 0)).toThrow();
  });

  it('a truck steering hard on oil slides out of its dry line', () => {
    const dest = { x: 34, y: 40 };
    const dry = endOfTurn(oiled(dest, []));

    const wet = endOfTurn(oiled(dest, slick(28, 46, 24, 44)));

    expect(Math.hypot(wet.x - dry.x, wet.z - dry.z)).toBeGreaterThan(2);
  });

  it('overlapping patches cut grip as much as one patch', () => {
    const dest = { x: 34, y: 40 };
    const dry = endOfTurn(oiled(dest, []));
    const one = endOfTurn(oiled(dest, [{ x: 34, y: 32 }], 2));

    const many = endOfTurn(oiled(dest, [{ x: 34, y: 32 }, { x: 34, y: 32 }, { x: 34.5, y: 32 }], 2));

    expect(one).not.toEqual(dry);
    expect(many).toEqual(one);
  });
});

describe('a truck an emitter pulse shut down', () => {
  function shutDown(order: MoveOrder | null): World {
    const w = order ? ordered(order, 8) : emptyWorld();
    me(w).speed = 8;
    me(w).shutDown = { from: w.turn + 1, until: w.turn + 10 };
    return w;
  }

  it('coasts on with no order, keeping over half its speed after a turn', () => {
    const { w, d } = play(shutDown(null), 1);
    freeDrive(d);

    expect(me(w).speed).toBeGreaterThan(4);
  });

  it('coasts toward a drive-through point instead of braking, and burns no fuel', () => {
    const w0 = shutDown({ kind: 'through', dest: { x: 120, y: 30 } });
    const fuel = w0.player.fuel;
    const { w, d } = play(w0, 1);
    freeDrive(d);

    expect(me(w).speed).toBeGreaterThan(4);
    expect(w.player.fuel).toBe(fuel);
  });

  it('still brakes to a stop on a brake order', () => {
    const { w, d } = play(shutDown({ kind: 'brake' }), 3);
    freeDrive(d);

    expect(me(w).speed).toBeLessThan(0.1);
  });
});

describe('rope frames roll the wheels', () => {
  it('rolls a wheel in the same direction as a truck driving forward', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.order = { kind: 'stopAt', dest: { x: 40, y: 30 } };
    const d = buildDrive(w);
    const result = simulateTurn(d, w);
    const frames = result.frames[me.id];
    expect(frames[frames.length - 1].pos.x).toBeGreaterThan(frames[0].pos.x);
    const drove = frames[frames.length - 1].wheels[2].spin - frames[0].wheels[2].spin;
    const dx = (frames[frames.length - 1].pos.x - frames[0].pos.x) / bodyOf(me.chassisId).wheelRadius;
    freeDrive(d);

    const rope = emptyWorld({ x: 30, y: 30 });
    const towed = rope.vehicles[0];
    towed.trail = [{ x: 30, y: 30, heading: 0 }, { x: 31, y: 30, heading: 0 }];
    const roped = trailFrames(rope, towed, restWheels(towed.chassisId));
    expect(Math.sign(roped[roped.length - 1].wheels[2].spin)).toBe(Math.sign(drove));
    expect(Math.sign(drove)).toBe(Math.sign(dx));
  });

  it('rolls every wheel by the distance driven over its radius, from the given spin', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const v = w.vehicles[0];
    v.trail = [{ x: 30, y: 30, heading: 0 }, { x: 31, y: 30, heading: 0 }];
    const start = restWheels(v.chassisId).map((wheel) => ({ ...wheel, spin: 2 }));
    const frames = trailFrames(w, v, start);
    expect(frames).toHaveLength(TURN_STEPS);
    const roll = PHYSICS.metersPerTile / bodyOf(v.chassisId).wheelRadius;
    for (const wheel of frames[frames.length - 1].wheels) expect(Math.abs(wheel.spin - 2)).toBeCloseTo(roll, 6);
    expect(Math.abs(frames[0].wheels[0].spin - 2)).toBeLessThan(roll / TURN_STEPS + 1e-6);
  });

  it('turns the outer wheels more than the inner ones in a bend', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const v = w.vehicles[0];
    v.trail = [{ x: 30, y: 30, heading: 0 }, { x: 31, y: 31, heading: Math.PI / 2 }];
    const frames = trailFrames(w, v, restWheels(v.chassisId));
    const last = frames[frames.length - 1].wheels;
    expect(Math.abs(last[2].spin - last[3].spin)).toBeGreaterThan(0.1);
  });

  it('throws when the start wheels do not match the chassis', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const v = w.vehicles[0];
    v.trail = [{ x: 30, y: 30, heading: 0 }, { x: 31, y: 30, heading: 0 }];
    expect(() => trailFrames(w, v, [])).toThrow(/wheels/);
  });
});
