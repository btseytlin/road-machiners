// A long run of ordinary AI traffic (spawning, driving, fighting) through the real physics turn
// pipeline, checking the invariants physics itself does not enforce for free: no negative resources
// or part HP. Physics guarantees no overlap by construction, so this does not re-check that.

import { beforeAll, describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { hangUp } from '../sim/dialogue';
import { mountedParts } from '../sim/grid';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';

beforeAll(async () => {
  await initPhysics();
});

describe('invariants under AI traffic', () => {
  it('no negative HP, fuel, supplies, health or money over 80 turns', async () => {
    let w = setMoveOrder(newWorld(11, START_KITS.standard, TEST_MAP), { kind: 'stopAt', dest: { x: 45, y: 15 } });
    // One Drive carried across all 80 turns: physicsMove's own syncDrive keeps it in step with
    // spawns, despawns and hangups, so nothing here needs a fresh physics world per turn.
    let d = buildDrive(w);
    for (let i = 0; i < 80; i++) {
      // The player hangs up on drivers who radio in, since an open call holds the turn.
      if (w.player.call) w = hangUp(w);
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      freeDrive(d);
      d = next!;
      // One test of about a minute never returns to the event loop, so the worker's status messages would time out.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (const v of w.vehicles) for (const p of mountedParts(v)) expect(p.hp).toBeGreaterThanOrEqual(0);
      for (const k of ['fuel', 'supplies', 'health', 'money'] as const) expect(w.player[k]).toBeGreaterThanOrEqual(0);
    }
    freeDrive(d);
  }, budget(360_000)); // Eighty turns include long-distance traffic across the 600-tile region. They took over 120 s alone on a loaded machine.
});
