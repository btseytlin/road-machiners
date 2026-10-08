// A knocked-out NPC truck played through the real physics turn pipeline.

import { beforeAll, describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { corePart } from '../sim/grid';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateWhere } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { dist } from '../sim/vec';
import { refreshVision } from '../sim/vision';
import { endTurn } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

function turn(w: World, d: Drive): { w: World; d: Drive } {
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  return { w, d: next! };
}

function raider(w: World): Vehicle {
  const v = w.vehicles.find((x) => x.faction === 'raiders');
  if (!v) throw new Error('The raider left the world');
  return v;
}

describe('NPC knockout in physics', () => {
  it('brakes a driving raider whose cab breaks, and keeps it parked while the player watches', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, 0);
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    buggy.brain.attackers[w.player.vehicleId] = true;
    buggy.lastHitBy = w.player.vehicleId;
    buggy.order = { kind: 'through', dest: { x: 70, y: 30 } };
    forceOption('mugging', 'attack');
    refreshVision(w);
    let d = buildDrive(w);
    ({ w, d } = turn(w, d));
    expect(raider(w).speed).toBeGreaterThan(1);
    corePart(raider(w), 'cab').hp = 0;
    w.rngState = rngStateWhere((roll) => roll >= RULES.npcDeathChance);
    ({ w, d } = turn(w, d));
    expect(raider(w).defeat?.phase).toBe('out');
    ({ w, d } = turn(w, d));
    const rest = { ...raider(w).pos };
    for (let i = 0; i < 10; i++) ({ w, d } = turn(w, d));
    expect(raider(w).defeat?.phase).toBe('out');
    expect(dist(raider(w).pos, rest)).toBeLessThan(0.2);
    freeDrive(d);
  });
});
