// Limp-speed driving without a working engine (src/sim/stats.ts), played through real physics.

import { beforeAll, describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { checkKnockout } from '../sim/defeat';
import { corePart } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import { emptyWorld } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

function removeEngines(v: Vehicle): void {
  v.items = v.items.filter((it) => it.kind !== 'part' || partDef(it.part.defId).kind !== 'engine');
}

function engineless(): World {
  const w = emptyWorld();
  removeEngines(w.vehicles[0]);
  return w;
}

beforeAll(async () => {
  await initPhysics();
});

function play(w: World, n: number): { w: World } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  return { w };
}

describe('pushing a truck without a working engine', () => {
  it('pushes at full limp speed on a low tank', () => {
    const w = engineless();
    w.player.fuel = 0.5;
    const s = vehicleStats(w, w.vehicles[0]);
    const { w: next } = play(setMoveOrder(w, { kind: 'stopAt', dest: { x: 40, y: 30 } }), 2);
    expect(next.vehicles[0].speed).toBeCloseTo(s.maxSpeed, 0);
    expect(next.player.fuel).toBe(0.5);
  });

  it('a knocked-out player wakes and pushes the stripped truck toward a point', () => {
    let w = emptyWorld();
    corePart(w.vehicles[0], 'cab').hp = 0;
    checkKnockout(w);
    const { w: awake } = play(w, 1);
    expect(awake.player.state).toBe('active');
    const dest = { x: 40, y: 30 };
    const start = dist(awake.vehicles[0].pos, dest);
    const { w: pushed } = play(setMoveOrder(awake, { kind: 'stopAt', dest }), 3);
    expect(dist(pushed.vehicles[0].pos, dest)).toBeLessThan(start - RULES.limpSpeed);
  });
});
