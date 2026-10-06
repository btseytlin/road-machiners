// Route planning (src/sim/path.ts) driven through the real physics turn pipeline.

import { beforeAll, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { REGION } from '../data/region';
import { dist, polylineDist, type Vec } from '../sim/vec';
import { editableTerrain, emptyWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';
import { TEST_MAP } from '../test/map';

beforeAll(async () => {
  await initPhysics();
});

// Plays up to `max` turns through the real turn pipeline with physics movement, building the physics
// world once and reusing the driver's own synced copy every turn after, exactly as the game does:
// physicsMove() already calls syncDrive() on every turn to add or drop vehicles and obstacles, so
// rebuilding the whole terrain and obstacle colliders from scratch each turn only duplicates that
// sync. `afterTurn` runs after each turn on the drafted world and can stop the loop early.
function play(w: World, max: number, afterTurn: (w: World) => boolean = () => false): World {
  let d = buildDrive(w);
  for (let i = 0; i < max; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
    if (afterTurn(w)) break;
  }
  freeDrive(d);
  return w;
}

it('the player drives from Bowl to Nose without a serious hit on a static obstacle', () => {
  const nose = REGION.towns.find((t) => t.id === 'nose')!;
  let w = setMoveOrder(newWorld(1337, START_KITS.standard, TEST_MAP), { kind: 'stopAt', dest: nose.pos });
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  w.player.fuel = 100;
  const me = w.player.vehicleId;
  let staticDamage = 0;
  w = play(w, w.size, (world) => {
    world.vehicles = world.vehicles.filter((v) => v.faction === 'player');
    world.player.engineHeat = 0; // this drive never stops to cool down
    for (const e of world.events)
      // A route can graze a site's edge, which the game allows, and a cross-country leg can bottom out on a crest of
      // the relief, which is terrain and not an obstacle; a rock or building should not touch it.
      if (e.t === 'collision' && e.a === me && !e.b.startsWith('v') && !e.b.startsWith('site-') && e.b !== 'ground')
        staticDamage += e.hitsA.reduce((sum, h) => sum + h.damage, 0);
    return dist(world.vehicles[0].pos, nose.pos) <= nose.radius + 1.5;
  });
  expect(staticDamage).toBeLessThan(5);
  // Physics brakes for corners a little differently turn to turn than the deleted 2D model did, so
  // give the arrival distance some slack instead of the tight tolerance that model allowed.
  expect(dist(w.vehicles[0].pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.4);
  expect(dist(w.vehicles[0].pos, nose.pos)).toBeLessThanOrEqual(nose.radius + 1.5);
}, 120_000);

// Flat hardpan with one road of the given center line and the map's road width.
function roadWorld(road: Vec[]) {
  const w = emptyWorld();
  const t = editableTerrain(w);
  for (let y = 0; y < t.size; y++)
    for (let x = 0; x < t.size; x++) t.types[y * t.size + x] = polylineDist({ x: x + 0.5, y: y + 0.5 }, road) < REGION.roadWidth / 2 ? 'road' : 'hardpan';
  return w;
}

it('a truck following a road into a blocking rock stops on the corner without a serious hit', () => {
  // Two roads meet at the center of a big rock, like roads meeting at a site.
  const rock = { x: 60, y: 30 };
  let w = roadWorld([{ x: 20, y: 30 }, rock, { x: 60, y: 0 }]);
  w.obstacles = [{ id: 'r', pos: rock, r: 6, kind: 'rock' }];
  w.vehicles[0].pos = { x: 22, y: 30 };
  w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 60, y: 8 } });
  let damage = 0;
  w = play(w, 40, (world) => {
    for (const e of world.events) if (e.t === 'collision') damage += e.hitsA.reduce((sum, h) => sum + h.damage, 0);
    return !world.vehicles[0].order;
  });
  expect(damage).toBeLessThan(5);
  expect(dist(w.vehicles[0].pos, { x: 60, y: 8 })).toBeLessThan(0.5);
}, 90_000); // up to forty physics turns take 40 to 60s alone on a 3-core machine
