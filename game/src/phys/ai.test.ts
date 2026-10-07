// NPC driving decisions (src/sim/ai.ts) played through the real physics turn pipeline.

import { beforeAll, describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { RULES } from '../data/rules';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { addGoods } from '../sim/inventory';
import { canUseSite } from '../sim/sites';
import { vehicleStats } from '../sim/stats';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import type { World } from '../sim/types';
import { angleDiff, dist } from '../sim/vec';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';

beforeAll(async () => {
  await initPhysics();
});

// Runs one turn through the real turn pipeline with physics movement, carrying the same Drive
// forward. physicsMove's own syncDrive keeps it in step with spawns, despawns and repositioning,
// so nothing here needs a fresh physics world per turn.
function turn(w: World, d: Drive): { w: World; d: Drive } {
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  return { w, d: next! };
}

describe('NPC driving', () => {
  it('backs off a rock in its path and drives around it', () => {
    let w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    // A goal east through the rock, so the first turn drives instead of rolling an idle choice.
    npc.brain.goals = [{ kind: 'raid', targetId: null, destination: { x: 300, y: 30 }, reason: 'look for prey at known hunting grounds', phase: 'travel' }];
    w.obstacles = [{ id: 'rock', pos: { x: 31.4, y: 30 }, r: 0.8, kind: 'rock' }];
    const startX = npc.pos.x;
    const xs: number[] = [];
    let d = buildDrive(w);
    for (let i = 0; i < RULES.npcStuckTurns + 4; i++) {
      ({ w, d } = turn(w, d));
      xs.push(w.vehicles.find((v) => v.id === npc.id)!.pos.x);
    }
    expect(Math.min(...xs)).toBeLessThan(startX);
    expect(xs.at(-1)).toBeGreaterThan(31.4);
    freeDrive(d);
  });

  it('an NPC whose recovery ended turns around nose first toward a goal behind it', () => {
    let w = emptyWorld({ x: 60, y: 40 });
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 60, y: 30 });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.brain.goals = [{ kind: 'explore', targetId: null, destination: { x: 5, y: 30 }, reason: 'look around', phase: 'travel' }];
    npc.brain.recovery = 2;
    npc.brain.recoveryGoal = { x: 56, y: 30 };
    let d = buildDrive(w);
    for (let i = 0; i < 10; i++) ({ w, d } = turn(w, d));
    const after = w.vehicles.find((v) => v.id === npc.id)!;
    expect(after.brain!.recovery).toBe(0);
    expect(Math.abs(angleDiff(after.heading, Math.PI))).toBeLessThan(Math.PI / 4);
    expect(after.pos.x).toBeLessThan(56);
    freeDrive(d);
  });

  it('travels between towns without entering either site', () => {
    let w = newWorld(1337, START_KITS.standard, TEST_MAP);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    // No spawns, so no raider can end the trip before it reaches Nose.
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const bowl = REGION.towns[0];
    const nose = REGION.towns[1];
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 2, y: bowl.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    // The trader parks on the Nose pad, outside the gate.
    let arrived = false;
    let d = buildDrive(w);
    for (let i = 0; i < w.size && !arrived; i++) {
      ({ w, d } = turn(w, d));
      // NPCs that spawn along the way would pick fights, so only the route is under test.
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player' || v.id === npc.id);
      const actor = w.vehicles.find((v) => v.id === npc.id)!;
      arrived = canUseSite(actor.pos, nose);
      expect(dist(actor.pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.8 - 0.5);
    }
    freeDrive(d);
    expect(arrived).toBe(true);
  }, budget(120_000));

  it('passes the oncoming player without stopping or touching it', () => {
    let w = newWorld(1337, START_KITS.standard, TEST_MAP);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const bowl = REGION.towns[0];
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 2, y: bowl.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    // A delivery to Nose, so the trader does not stop at a Bowl pad beside it.
    const nose = REGION.towns[1];
    addGoods(w, npc, 'scrap', 1);
    npc.brain.goals = [{ kind: 'sell', targetId: nose.id, destination: { ...nose.pos }, phase: 'travel', reason: 'test delivery' }];
    let d = buildDrive(w);
    const trader = () => w.vehicles.find((v) => v.id === npc.id)!;
    // The trader gets up to cruising speed on its way out of Bowl.
    for (let i = 0; i < 30 && trader().speed < 3; i++) ({ w, d } = turn(w, d));
    expect(trader().speed).toBeGreaterThanOrEqual(3);
    const t = trader();
    const me = w.vehicles.find((v) => v.faction === 'player')!;
    // The player drives at the trader head-on from 25 tiles ahead of it.
    me.pos = { x: t.pos.x + Math.cos(t.heading) * 25, y: t.pos.y + Math.sin(t.heading) * 25 };
    me.heading = t.heading + Math.PI;
    freeDrive(d);
    d = buildDrive(w);
    w = setMoveOrder(w, { kind: 'through', dest: { x: t.pos.x - Math.cos(t.heading) * 20, y: t.pos.y - Math.sin(t.heading) * 20 } });
    const gap = vehicleStats(w, me).radius + vehicleStats(w, t).radius;
    let slowest = Infinity;
    let closest = Infinity;
    for (let i = 0; i < 6; i++) {
      ({ w, d } = turn(w, d));
      const player = w.vehicles.find((v) => v.faction === 'player')!;
      slowest = Math.min(slowest, trader().speed);
      closest = Math.min(closest, dist(trader().pos, player.pos));
    }
    freeDrive(d);
    expect(slowest).toBeGreaterThan(RULES.parkedSpeed);
    expect(closest).toBeGreaterThan(gap);
  }, budget(60_000));

  // Two scouts closing head-on on the real road, at the poses of a crash found in all-physics traffic.
  it.each([-3, -1.5].flatMap((dx) => [-3, -1.5, 0, 1.5, 3].map((dy) => [dx, dy])))(
    'two NPCs closing head-on never touch: second goal offset %s,%s',
    (dx, dy) => {
      let w = newWorld(1337, START_KITS.standard, TEST_MAP);
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
      for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
      w.vehicles[0].pos = { x: 300, y: 200 };
      const a = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 264.24, y: 165.07 }, (-48 * Math.PI) / 180);
      const b = addVehicle(w, 'roamers', 'scout', ['mg', 'stockEngine'], { x: 283.01, y: 143.29 }, (129 * Math.PI) / 180);
      // The lower id waits, so which truck swerves follows the ids. Pin them to those of the recorded crash, since the id counter shifts with how many trucks a new world starts with.
      a.id = 'v1062';
      b.id = 'v1081';
      a.speed = 6.46;
      b.speed = 4.08;
      a.brain = npcBrain('scavenger', a.pos, ['scavenger']);
      b.brain = npcBrain('roamer', b.pos, ['roamer']);
      a.brain.goals = [{ kind: 'explore', targetId: null, destination: { x: 317, y: 102.75 }, phase: 'travel', reason: 'test trip' }];
      b.brain.goals = [{ kind: 'explore', targetId: null, destination: { x: 276.07 + dx, y: 157.15 + dy }, phase: 'travel', reason: 'test trip' }];
      let d = buildDrive(w);
      let touches = 0;
      for (let i = 0; i < 10; i++) {
        ({ w, d } = turn(w, d));
        touches += w.events.filter((e) => e.t === 'collision' && [e.a, e.b].includes(a.id) && [e.a, e.b].includes(b.id)).length;
      }
      freeDrive(d);
      expect(touches).toBe(0);
    },
    120_000,
  );
});
