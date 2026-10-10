import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import { FALLEN_SUN_DECKS } from '../data/territory';
import { deckById } from './bridge';
import { resetPerf, perfSnapshot } from '../perf';
import { PHYSICS } from '../data/physics';
import { boxDistance, boxSegmentDistance, isDriveObstacle, propBoxes, propReach } from './mapgen';
import { findCells, nearestFreeCell, stampOverlay } from './nav/astar';
import { COARSE, componentOf, dynamicBlockers, navLayer, offRoadTaste, onRouteRoad, tasteKey, tasteOf, terrainNav, tileIndex } from './nav/layer';
import { continueRoute, keepRoute, route, routeLength, straightClear, type Blocker } from './path';
import { nextRandom } from './rng';
import { isCliff, tileAt, tileSlope, type Terrain } from './terrain';
import type { NpcActivity, Obstacle, Vehicle, World } from './types';
import type { TraitId } from '../data/npcs';
import { siteGap, siteGates, sitePads } from './sites';
import { raiderGrounds, raiderPatrolPosts } from './npc-decisions';
import { ROAD_INDEX } from './road-index';
import { addVehicle, editableTerrain, emptyWorld, npcBrain } from './testkit';
import { dist, polylineDist, segmentDist, type Vec } from './vec';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';
import { defaultSetup } from './settings';

const w1337 = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));

describe("route", () => {
  it("goes straight when nothing is in the way", () => {
    const w = emptyWorld();
    expect(route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, [])).toEqual([
      { x: 40, y: 30 },
    ]);
  });

  it("ends at the map edge when the goal lies beyond it", () => {
    const w = emptyWorld();
    const pts = route(w, { x: 30, y: 10 }, { x: 30, y: -17 }, 0.6, []);
    expect(pts[pts.length - 1]).toEqual({ x: 30, y: 0.6 });
  });

  it("bends around a rock in the way, keeping clear of it", () => {
    const w = emptyWorld();
    w.obstacles = [{ id: "r", pos: { x: 35, y: 30 }, r: 1.2, kind: "rock" }];
    const pts = route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, []);
    expect(pts.length).toBeGreaterThan(1);
    let prev = { x: 30, y: 30 };
    for (const p of pts) {
      expect(segmentDist(w.obstacles[0].pos, prev, p)).toBeGreaterThanOrEqual(
        1.2 + 0.6,
      );
      prev = p;
    }
  });

  const fence = { id: "fence-0", pos: { x: 40, y: 30 }, r: 0.5, kind: "landmark" as const, look: "fence" as const, yaw: Math.PI / 2 };

  it("drives straight along a fence's side, closer to it than its radius would allow", () => {
    const w = emptyWorld();
    w.obstacles = [fence];
    const to = { x: 41.2, y: 40 };

    expect(route(w, { x: 41.2, y: 20 }, to, 0.6, [])).toEqual([to]);
  });

  it("bends around a fence across the way, keeping clear of its rails", () => {
    const w = emptyWorld();
    w.obstacles = [fence];
    const pts = route(w, { x: 35, y: 30 }, { x: 45, y: 30 }, 0.6, []);

    expect(pts.length).toBeGreaterThan(1);
    let prev = { x: 35, y: 30 };
    for (const p of pts) {
      for (const box of propBoxes(fence)) expect(boxSegmentDistance(box, prev, p)).toBeGreaterThanOrEqual(0.6);
      prev = p;
    }
  });

  it("routes to the closest reachable point when the goal is walled in", () => {
    const w = emptyWorld();
    const center = { x: 50, y: 30 };
    w.obstacles = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * 2 * Math.PI;
      return { id: `ring-${i}`, pos: { x: center.x + 6 * Math.cos(a), y: center.y + 6 * Math.sin(a) }, r: 1, kind: "rock" as const };
    });
    const end = route(w, { x: 30, y: 30 }, center, 0.6, []).at(-1)!;
    expect(dist(end, center)).toBeGreaterThan(6 + 1 + 0.6);
    expect(dist(end, center)).toBeLessThan(6 + 1 + 0.6 + 2);
  });

  it("stops short of parked trucks that fence in the goal instead of driving through them", () => {
    const w = emptyWorld();
    const center = { x: 50, y: 30 };
    const parked: Blocker[] = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * 2 * Math.PI;
      return { pos: { x: center.x + 3 * Math.cos(a), y: center.y + 3 * Math.sin(a) }, r: 0.7 };
    });
    const from = { x: 30, y: 30 };
    const pts = route(w, from, center, 0.6, parked);
    expect(dist(pts.at(-1)!, center)).toBeGreaterThan(3 + 0.7 + 0.6);
    let prev = from;
    for (const p of pts) {
      for (const o of parked) expect(segmentDist(o.pos, prev, p)).toBeGreaterThanOrEqual(o.r + 0.6);
      prev = p;
    }
  });

  function pocketWorld(): { w: World; center: Vec } {
    const w = emptyWorld();
    const center = { x: 50, y: 30 };
    w.obstacles = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * 2 * Math.PI;
      return { id: `ring-${i}`, pos: { x: center.x + 3 * Math.cos(a), y: center.y + 3 * Math.sin(a) }, r: 0.2, kind: "rock" as const };
    });
    return { w, center };
  }

  it("a truck on blocked ground next to a closed pocket drives out toward the goal's side", () => {
    const { w, center } = pocketWorld();
    const pts = route(w, { x: center.x + 2.8, y: center.y }, { x: 70, y: 30 }, 0.6, []);
    expect(dist(pts[0], center)).toBeGreaterThan(3);
    expect(dist(pts.at(-1)!, { x: 70, y: 30 })).toBeLessThan(0.01);
  });


  it('player routes on the real map stay direct', () => {
    const w = w1337;
    const size = w.terrain.size;
    let seed = 1337;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const clamp = (v: number) => Math.min(size - 20, Math.max(20, v));
    let waypoints = 0;
    let length = 0;
    let straight = 0;
    for (let k = 0; k < 150; k++) {
      const from = { x: 20 + next() * (size - 40), y: 20 + next() * (size - 40) };
      const heading = next() * Math.PI * 2;
      const span = 15 + next() * 120;
      const to = { x: clamp(from.x + Math.cos(heading) * span), y: clamp(from.y + Math.sin(heading) * span) };
      let pts: Vec[];
      try {
        pts = route(w, from, to, 0.6, []);
      } catch {
        continue;
      }
      waypoints += pts.length;
      length += routeLength(from, pts);
      straight += dist(from, to);
    }
    expect(waypoints).toBeLessThanOrEqual(2000);
    expect(length).toBeLessThanOrEqual(1.28 * straight);
  });
});

describe('raised deck ends', () => {
  const flap = deckById(FALLEN_SUN_DECKS[0].id);
  const on = (along: number, across: number): Vec => ({
    x: flap.from.x + flap.axis.x * along - flap.axis.y * across,
    y: flap.from.y + flap.axis.y * along + flap.axis.x * across,
  });
  const alongOf = (p: Vec) => (p.x - flap.from.x) * flap.axis.x + (p.y - flap.from.y) * flap.axis.y;
  const acrossOf = (p: Vec) => (p.y - flap.from.y) * flap.axis.x - (p.x - flap.from.x) * flap.axis.y;
  const onFlap = (p: Vec) => alongOf(p) >= 0 && alongOf(p) <= flap.length && Math.abs(acrossOf(p)) <= flap.width / 2;

  function samples(points: Vec[]): Vec[] {
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const n = Math.max(1, Math.ceil(dist(points[i - 1], points[i]) * 20));
      for (let k = 1; k <= n; k++) out.push({ x: points[i - 1].x + ((points[i].x - points[i - 1].x) * k) / n, y: points[i - 1].y + ((points[i].y - points[i - 1].y) * k) / n });
    }
    return out;
  }

  function expectOnAndOffOverLowEnd(points: Vec[]): void {
    const path = samples(points);
    for (let i = 1; i < path.length; i++) {
      if (onFlap(path[i]) === onFlap(path[i - 1])) continue;
      expect(alongOf(path[i]), `${path[i].x},${path[i].y}`).toBeLessThan(0.5);
      expect(Math.abs(acrossOf(path[i]))).toBeLessThan(flap.width / 2);
    }
  }

  it('climbs from the landing below the lip onto the flap only round by its low end', () => {
    const radius = 0.5;
    const below = on(flap.length + 4, 0);
    const top = on(flap.length - 1.5, 0);
    const points = [below, ...route(w1337, below, top, radius, [])];

    expect(points.at(-1)).toEqual(top);
    expectOnAndOffOverLowEnd(points);
    expect(routeLength(below, points.slice(1))).toBeGreaterThan(flap.length);
  });

  it('never routes off the flap over its lip, though the landing lies straight ahead', () => {
    const radius = 0.5;
    const top = on(flap.length - 1.5, 0);
    const landing = on(flap.length + 6, 0);
    const points = [top, ...route(w1337, top, landing, radius, [])];

    expect(points.at(-1)).toEqual(landing);
    expectOnAndOffOverLowEnd(points);
  });
});

describe('driver taste', () => {
  const brain = npcBrain('trader', { x: 0, y: 0 }, ['trader']);
  const site = (id: string) => {
    const found = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
    if (found === undefined) throw new Error(`No site ${id}`);
    return found;
  };
  const from = siteGates(site('nose'))[0];
  const to = siteGates(site('dustwell'))[0];
  const w = w1337;
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const trader = (id: string): Vehicle => ({ ...me, id, faction: 'traders', brain });
  const apart = (p: Vec[], q: Vec[]) => Math.max(...p.map((x) => polylineDist(x, q)), ...q.map((x) => polylineDist(x, p)));

  it('sends drivers between the same towns along different ways', () => {
    const routes = Array.from({ length: 10 }, (_, i) => [from, ...route(w, from, to, 0.8, [], trader(`v${100 + i}`))]);
    const ways = routes.filter((r, i) => routes.slice(0, i).every((q) => apart(r, q) > 10));
    expect(ways.length).toBeGreaterThanOrEqual(2);
  });

  it('gives one driver the same route every time', () => {
    const driver = trader('v100');
    expect(route(w, from, to, 0.8, [], driver)).toEqual(route(w, from, to, 0.8, [], { ...driver }));
  });

  it('plans the plain route for the player', () => {
    expect(route(w, from, to, 0.8, [], me)).toEqual(route(w, from, to, 0.8, []));
  });
});

describe('kept routes', () => {
  function bent(): { w: World; from: Vec; to: Vec; points: Vec[] } {
    const w = emptyWorld();
    w.obstacles = [36, 40, 44].map((x) => ({ id: `r${x}`, pos: { x, y: 30 }, r: 1.5, kind: 'rock' as const }));
    const from = { x: 30, y: 30 };
    const to = { x: 50, y: 30 };
    return { w, from, to, points: route(w, from, to, 0.6, []) };
  }

  it('continues from a later position, dropping the corners driven past', () => {
    const { w, from, to, points } = bent();
    expect(points.length).toBeGreaterThan(2);
    const kept = keepRoute(w, to, points, []);
    const again = continueRoute(w, from, kept, to, 0.6, [])!;
    expect(again[0]).toEqual(points[0]);
    for (const p of again) expect(points).toContainEqual(p);
    const past = { x: points[0].x + (points[1].x - points[0].x) * 0.1, y: points[0].y + (points[1].y - points[0].y) * 0.1 };
    const rest = continueRoute(w, past, kept, to, 0.6, [])!;
    expect(rest.length).toBeGreaterThan(0);
    for (const p of rest) expect(points.slice(1)).toContainEqual(p);
    expect(rest.at(-1)).toEqual(to);
  });

  it('straightens only the road ahead and keeps the corners past the lookahead', () => {
    const w = emptyWorld();
    const points = Array.from({ length: 40 }, (_, i) => ({ x: 32 + i * 4, y: i % 2 === 0 ? 30 : 32 }));
    const from = { x: 30, y: 30 };
    const again = continueRoute(w, from, keepRoute(w, points.at(-1)!, points, []), points.at(-1)!, 0.6, [])!;
    const far = points.filter((p) => routeLength(from, points.slice(0, points.indexOf(p) + 1)) > REGION.navigation.lookahead + 8);
    expect(far.length).toBeGreaterThan(10);
    expect(again.slice(-far.length)).toEqual(far);
    expect(again.length).toBeLessThan(points.length);
  });

  it('ends on a destination that moved, and drops the route for a vehicle parked on a later leg', () => {
    const { w, from, to, points } = bent();
    const kept = keepRoute(w, to, points, []);
    const near = { x: to.x, y: to.y + 0.3 };
    expect(continueRoute(w, from, kept, near, 0.6, [])!.at(-1)).toEqual(near);
    const onLeg = { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 };
    expect(continueRoute(w, from, kept, to, 0.6, [{ pos: onLeg, r: 0.8 }])).toBeNull();
    expect(continueRoute(w, from, keepRoute(w, to, points, [{ pos: onLeg, r: 0.8 }]), to, 0.6, [{ pos: onLeg, r: 0.8 }])).not.toBeNull();
  });
});

describe('routes prefer roads', () => {
  function roadWorld(road: Vec[]): World {
    const w = emptyWorld();
    const t = editableTerrain(w);
    for (let y = 0; y < t.size; y++)
      for (let x = 0; x < t.size; x++) t.types[y * t.size + x] = polylineDist({ x: x + 0.5, y: y + 0.5 }, road) < REGION.roadWidth / 2 ? 'road' : 'hardpan';
    return w;
  }

  function roadShare(w: World, from: Vec, points: Vec[]): number {
    let on = 0;
    let all = 0;
    let prev = from;
    for (const p of points) {
      const n = Math.ceil(dist(prev, p) * 4);
      for (let k = 0; k < n; k++) {
        all++;
        if (w.terrain.types[tileAt(w.terrain, { x: prev.x + ((p.x - prev.x) * k) / n, y: prev.y + ((p.y - prev.y) * k) / n })] === 'road') on++;
      }
      prev = p;
    }
    return on / all;
  }

  it('follows a bent road that is 41% longer than the straight line', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 160 };
    const w = roadWorld([a, { x: 160, y: 100 }, b]);
    const pts = route(w, a, b, 0.6, []);
    expect(roadShare(w, a, pts)).toBeGreaterThan(0.9);
  });

  it('joins the road from open ground next to it instead of cutting the bend', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 160 };
    const w = roadWorld([a, { x: 160, y: 100 }, b]);
    const start = { x: 100, y: 106 };
    const pts = route(w, start, b, 0.6, []);
    expect(roadShare(w, start, pts)).toBeGreaterThan(0.85);
  });

  it('a truck pushed deep into a rock clearance routes out of it first', () => {
    const w = emptyWorld();
    const rock = { x: 40, y: 30 };
    w.obstacles = [{ id: 'r', pos: rock, r: 3, kind: 'rock' }];
    const from = { x: 36.8, y: 30 };
    const pts = route(w, from, { x: 44, y: 30 }, 0.6, []);
    expect(pts.length).toBeGreaterThan(1);
    expect(dist(pts[0], rock)).toBeGreaterThan(dist(from, rock));
    for (let i = 1; i < pts.length; i++) for (const box of propBoxes(w.obstacles[0])) expect(boxSegmentDistance(box, pts[i - 1], pts[i])).toBeGreaterThanOrEqual(0.6);
  });

  it('prices the ground within a road width of a site like road', () => {
    const w = emptyWorld();
    editableTerrain(w).types.fill('hardpan');
    const nav = terrainNav(w.terrain);
    const site = REGION.locations.find((l) => l.kind !== 'territory')!;
    const at = (d: number) => nav.tileCost[tileIndex(nav.size, site.pos.x + d, site.pos.y)];
    expect(at(site.radius + REGION.roadWidth - 1)).toBeCloseTo(1 / TERRAIN_TYPES.hardpan.speed, 9);
    expect(at(site.radius + REGION.roadWidth + 1)).toBeCloseTo(REGION.navigation.offRoadCost / TERRAIN_TYPES.hardpan.speed, 9);
  });

  it('goes around a steep hill that it could climb', () => {
    const w = emptyWorld();
    const t = editableTerrain(w);
    const n = t.size + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t.heights[j * n + i] = Math.max(0, 4 - Math.hypot(i - 35, j - 30)) * 0.58;
    const pts = route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, []);
    expect(polylineDist({ x: 35, y: 30 }, [{ x: 30, y: 30 }, ...pts])).toBeGreaterThan(3);
  });

  it('crosses gentle rolling ground in one straight line', () => {
    const w = emptyWorld();
    const t = editableTerrain(w);
    t.types.fill('hardpan');
    const n = t.size + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t.heights[j * n + i] = Math.sin(i / 3) * Math.cos(j / 4) * 0.6;
    const from = { x: 30, y: 30 };
    const pts = route(w, from, { x: 70, y: 30 }, 0.6, []);
    expect(pts.length).toBeLessThanOrEqual(2);
    expect(routeLength(from, pts)).toBeLessThan(1.03 * 40);
  });

  it('crosses open ground when the road detour is three times longer', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 100 };
    const w = roadWorld([a, { x: 100, y: 160 }, { x: 160, y: 160 }, b]);
    const pts = route(w, a, b, 0.6, []);
    expect(routeLength(a, pts)).toBeLessThan(1.2 * dist(a, b));
  });

  describe('hunting raiders', () => {
    function driverOn(w: World, faction: 'raiders' | 'traders', traits: TraitId[], kind: NpcActivity['kind']): Vehicle {
      const v = addVehicle(w, faction, 'buggy', ['mg', 'stockEngine'], { x: 0, y: 0 });
      v.id = 'v7';
      v.brain = npcBrain('buggy', { x: 0, y: 0 }, traits);
      v.brain.goals = [{ kind, targetId: null, destination: null, phase: 'travel', reason: 'idle' }];
      return v;
    }
    function drivers(w: World) {
      return { raider: driverOn(structuredClone(w), 'raiders', ['raider'], 'raid'), trader: driverOn(structuredClone(w), 'traders', ['trader'], 'trade') };
    }
    const straightRoad = () => roadWorld([{ x: 40, y: 100 }, { x: 220, y: 100 }]);
    const onRoadLength = (w: World, from: Vec, pts: Vec[]) => roadShare(w, from, pts) * routeLength(from, pts);

    it('a raider on a raid routes off the road between two open points beside it, while a trader takes it', () => {
      const w = straightRoad();
      const { raider, trader } = drivers(w);
      const a = { x: 100, y: 106 };
      const b = { x: 160, y: 106 };

      const hunting = route(w, a, b, 0.6, [], raider);
      const trading = route(w, a, b, 0.6, [], trader);

      expect(roadShare(w, a, hunting)).toBeLessThan(0.05);
      expect(roadShare(w, a, trading)).toBeGreaterThan(0.7);
    });

    it('a raider on a raid leaves a straight road between two points on it', () => {
      const w = straightRoad();
      const { raider, trader } = drivers(w);
      const a = { x: 100, y: 100 };
      const b = { x: 160, y: 100 };

      const hunting = route(w, a, b, 0.6, [], raider);

      expect(roadShare(w, a, hunting)).toBeLessThan(0.25);
      expect(route(w, a, b, 0.6, [], trader)).toEqual([b]);
    });

    it('a raider crossing a road crosses it rather than following it', () => {
      const w = straightRoad();
      const { raider, trader } = drivers(w);
      const a = { x: 110, y: 85 };
      const b = { x: 170, y: 115 };

      const hunting = route(w, a, b, 0.6, [], raider);
      const trading = route(w, a, b, 0.6, [], trader);

      expect(onRoadLength(w, a, hunting)).toBeLessThan(3 * REGION.roadWidth);
      expect(onRoadLength(w, a, trading)).toBeGreaterThan(3 * REGION.roadWidth);
    });

    it("keeps the trader's taste, cache key and route, and keys the hunting style apart", () => {
      const w = straightRoad();
      const { raider, trader } = drivers(w);
      const a = { x: 100, y: 106 };
      const b = { x: 160, y: 106 };
      const traderTaste = tasteOf(w, trader)!;
      const huntingTaste = offRoadTaste(tasteOf(w, raider)!, terrainNav(w.terrain));

      const hunting = route(w, a, b, 0.6, [], raider);
      const trading = route(w, a, b, 0.6, [], trader);

      expect(traderTaste.shy).toBeNull();
      expect(tasteKey(traderTaste)).toBe(String(traderTaste.seed));
      expect(tasteKey(huntingTaste)).toBe(`${traderTaste.seed}:off`);
      expect(trading).not.toEqual(hunting);
      expect(route(w, a, b, 0.6, [], driverOn(structuredClone(w), 'raiders', ['raider'], 'sell'))).toEqual(trading);
    });

    it('plans off-road legs on the real map that a truck can drive straight', () => {
      const w = w1337;
      const { raider, trader } = drivers(w);
      const gate = (id: string) => siteGates([...REGION.towns, ...REGION.locations].find((s) => s.id === id)!)[0];
      const from = gate('nose');
      const to = gate('dustwell');

      const hunting = route(w, from, to, 0.8, [], raider);

      expect(hunting.length).toBeGreaterThan(2);
      for (let i = 1; i < hunting.length; i++) if (dist(hunting[i - 1], hunting[i]) >= 1) expect(straightClear(w, hunting[i - 1], hunting[i], 0.8, [])).toBe(true);
      expect(roadShare(w, from, hunting)).toBeLessThan(roadShare(w, from, route(w, from, to, 0.8, [], trader)));
    });
  });
});

describe('raiders that keep off roads', () => {
  function roadWorld(...roads: Vec[][]): World {
    const w = emptyWorld();
    const t = editableTerrain(w);
    for (let y = 0; y < t.size; y++)
      for (let x = 0; x < t.size; x++) t.types[y * t.size + x] = roads.some((r) => polylineDist({ x: x + 0.5, y: y + 0.5 }, r) < REGION.roadWidth / 2) ? 'road' : 'hardpan';
    return w;
  }

  function raider(w: World, pos: Vec): Vehicle {
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], pos);
    v.brain = npcBrain('test', pos, []);
    v.brain.goals = [{ kind: 'sell', targetId: null, destination: null, phase: 'travel', reason: 'patrolTown' }];
    return v;
  }
  function flee(v: Vehicle): void {
    v.brain!.goals.push({ kind: 'flee', targetId: null, destination: null, phase: 'travel', reason: 'escapeAttacker' });
  }

  function roadRuns(w: World, from: Vec, points: Vec[]): number[] {
    const nav = terrainNav(w.terrain);
    const runs: number[] = [];
    let run = 0;
    let prev = from;
    for (const p of points) {
      const n = Math.max(1, Math.ceil(dist(prev, p) * 4));
      for (let k = 0; k < n; k++) {
        if (onRouteRoad(nav, prev.x + ((p.x - prev.x) * k) / n, prev.y + ((p.y - prev.y) * k) / n)) run += dist(prev, p) / n;
        else if (run > 0) {
          runs.push(run);
          run = 0;
        }
      }
      prev = p;
    }
    if (run > 0) runs.push(run);
    return runs;
  }
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('drives beside a road that a raider on patrol drives along, to the same end', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 100 };
    const w = roadWorld([{ x: 90, y: 100 }, { x: 170, y: 100 }]);
    const v = raider(w, a);
    const plain = route(w, a, b, 0.6, [], v);
    flee(v);
    const off = route(w, a, b, 0.6, [], v);
    expect(total(roadRuns(w, a, plain))).toBeGreaterThan(50);
    expect(Math.max(0, ...roadRuns(w, a, off).slice(1, -1))).toBe(0);
    expect(total(roadRuns(w, a, off))).toBeLessThan(REGION.roadWidth + 2);
    expect(off.at(-1)).toEqual(plain.at(-1));
  });

  it('crosses a road lying across its way once, straight over', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 100 };
    const w = roadWorld([{ x: 130, y: 20 }, { x: 130, y: 190 }]);
    const v = raider(w, a);
    flee(v);
    const runs = roadRuns(w, a, route(w, a, b, 0.6, [], v));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBeLessThan(REGION.roadWidth + 1.5);
  });

  it('keeps away from a cliff beside the road as a plain route does', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 100 };
    const w = roadWorld([{ x: 90, y: 100 }, { x: 170, y: 100 }]);
    const t = w.terrain;
    const n = t.size + 1;
    for (let j = 104; j < n; j++) for (let i = 0; i < n; i++) t.heights[j * n + i] = -8;
    const v = raider(w, a);
    flee(v);
    const off = route(w, a, b, 0.6, [], v);
    let prev = a;
    for (const p of off) {
      for (let k = 0; k <= 20; k++) expect(isCliff(t, tileAt(t, { x: prev.x + ((p.x - prev.x) * k) / 20, y: prev.y + ((p.y - prev.y) * k) / 20 }))).toBe(false);
      prev = p;
    }
    expect(total(roadRuns(w, a, off))).toBeLessThan(REGION.roadWidth + 2);
  });

  it('turns off the road toward its camp on the real map', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const kiln = REGION.locations.find((l) => l.id === 'kiln')!;
    const pad = siteGates(kiln)[0];
    const start = { x: 354.5, y: 331.5 };
    expect(onRouteRoad(terrainNav(w.terrain), start.x, start.y)).toBe(true);
    const v = raider(w, start);
    const plain = route(w, start, pad, 0.8, [], v);
    flee(v);
    const off = route(w, start, pad, 0.8, [], v);
    const plainRoad = total(roadRuns(w, start, plain)) / routeLength(start, plain);
    const offRuns = roadRuns(w, start, off);
    expect(total(offRuns) / routeLength(start, off)).toBeLessThan(plainRoad / 2);
    expect(Math.max(0, ...offRuns.slice(1))).toBeLessThan(REGION.roadWidth * 2);
    expect(dist(off.at(-1)!, plain.at(-1)!)).toBeLessThan(0.01);
  });

  it('caches routes on and off roads apart, and drops a kept route once the driver strands', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 160, y: 100 };
    const w = roadWorld([{ x: 90, y: 100 }, { x: 170, y: 100 }]);
    const v = raider(w, a);
    const plain = route(w, a, b, 0.6, [], v);
    flee(v);
    const off = route(w, a, b, 0.6, [], v);
    v.brain!.goals.pop();
    expect(route(w, a, b, 0.6, [], v)).toEqual(plain);
    expect(off).not.toEqual(plain);
    const kept = keepRoute(w, b, plain, [], v);
    expect(kept.offRoad).toBe(false);
    expect(continueRoute(w, a, kept, b, 0.6, [], v)).not.toBeNull();
    v.resources!.fuel = 0;
    expect(continueRoute(w, a, kept, b, 0.6, [], v)).toBeNull();
    const keptOff = keepRoute(w, b, off, [], v);
    expect(keptOff.offRoad).toBe(true);
    expect(continueRoute(w, a, keptOff, b, 0.6, [], v)).not.toBeNull();
  });
});

namespace Ref {
  export const CELL = 0.5;
  export const CLEARANCE = 0.4;
  export type Grid = { n: number; blocked: Uint8Array; slow: Float32Array };

  function nearCliff(t: Terrain, p: Vec, reach: number): boolean {
    const probes = [p, { x: p.x + reach, y: p.y }, { x: p.x - reach, y: p.y }, { x: p.x, y: p.y + reach }, { x: p.x, y: p.y - reach }];
    return probes.some((q) => isCliff(t, tileAt(t, q)));
  }

  function tileCost(t: Terrain, p: Vec, flat = false): number {
    const tile = tileAt(t, p);
    const type = t.types[tile];
    const c = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
    const bySite = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')].some((s) => siteGap(s, c) < REGION.roadWidth);
    const s = tileSlope(t, tile);
    const slope = flat ? 1 : 1 + REGION.navigation.slopeCost * (Math.hypot(s.x, s.y) / TERRAIN.drive.maxSlope) ** 2;
    return ((type === 'road' || bySite ? 1 : REGION.navigation.offRoadCost) / TERRAIN_TYPES[type].speed) * slope;
  }

  export function terrainLayer(t: Terrain, radius: number): { n: number; cliff: Uint8Array; slow: Float32Array } {
    const n = Math.ceil(t.size / CELL);
    const cliff = new Uint8Array(n * n);
    const slow = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
        if (nearCliff(t, c, radius + CLEARANCE)) cliff[y * n + x] = 1;
        slow[y * n + x] = tileCost(t, c);
      }
    return { n, cliff, slow };
  }

  export function grid(layer: { n: number; cliff: Uint8Array; slow: Float32Array }, blockers: Blocker[], radius: number): Grid {
    const n = layer.n;
    const blocked = layer.cliff.slice();
    const grow = radius + CLEARANCE;
    const circles = blockers.flatMap((o) => (o.prop ? o.prop.boxes.map((b) => ({ pos: b.center, r: Math.hypot(b.half.x, b.half.y), inside: (p: Vec) => boxDistance(b, p) < grow })) : [{ pos: o.pos, r: o.r, inside: (p: Vec) => dist(p, o.pos) < o.r + grow }]));
    for (const o of circles) {
      const reach = o.r + grow;
      const lo = { x: Math.max(0, Math.floor((o.pos.x - reach) / CELL)), y: Math.max(0, Math.floor((o.pos.y - reach) / CELL)) };
      const hi = { x: Math.min(n - 1, Math.floor((o.pos.x + reach) / CELL)), y: Math.min(n - 1, Math.floor((o.pos.y + reach) / CELL)) };
      for (let x = lo.x; x <= hi.x; x++)
        for (let y = lo.y; y <= hi.y; y++) if (o.inside({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL })) blocked[y * n + x] = 1;
    }
    return { n, blocked, slow: layer.slow };
  }

  function touches(o: Blocker, a: Vec, b: Vec, reach: number): boolean {
    if (segmentDist(o.pos, a, b) >= o.r + reach) return false;
    return !o.prop || o.prop.boxes.some((box) => boxSegmentDistance(box, a, b) < reach);
  }

  export function cellOf(g: Grid, p: Vec): number {
    return Math.min(g.n - 1, Math.max(0, Math.floor(p.y / CELL))) * g.n + Math.min(g.n - 1, Math.max(0, Math.floor(p.x / CELL)));
  }

  export function centerOf(g: Grid, c: number): Vec {
    return { x: ((c % g.n) + 0.5) * CELL, y: (Math.floor(c / g.n) + 0.5) * CELL };
  }

  function neighbors(g: Grid, c: number): number[] {
    const x = c % g.n;
    const y = Math.floor(c / g.n);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx !== 0 || dy !== 0) && nx >= 0 && ny >= 0 && nx < g.n && ny < g.n) out.push(ny * g.n + nx);
      }
    return out;
  }

  export function nearestFree(g: Grid, c: number, allowed: Uint8Array | null = null, maxRing = Infinity): number | null {
    const seen = new Uint8Array(g.n * g.n);
    const queue = [c];
    seen[c] = 1;
    const ring = (a: number) => Math.max(Math.abs((a % g.n) - (c % g.n)), Math.abs(Math.floor(a / g.n) - Math.floor(c / g.n)));
    for (let i = 0; i < queue.length; i++) {
      if (!g.blocked[queue[i]] && (!allowed || allowed[queue[i]])) return queue[i];
      for (const nb of neighbors(g, queue[i]))
        if (!seen[nb] && ring(nb) <= maxRing) {
          seen[nb] = 1;
          queue.push(nb);
        }
    }
    return null;
  }

  export function reachable(g: Grid, start: number): Uint8Array {
    const out = new Uint8Array(g.n * g.n);
    const seed = g.blocked[start] ? neighbors(g, start).find((c) => !g.blocked[c]) : start;
    if (seed === undefined) return out;
    const queue = [seed];
    out[seed] = 1;
    for (let i = 0; i < queue.length; i++)
      for (const nb of neighbors(g, queue[i]))
        if (!out[nb] && !g.blocked[nb]) {
          out[nb] = 1;
          queue.push(nb);
        }
    return out;
  }

  function heuristic(g: Grid, a: number, b: number): number {
    const dx = Math.abs((a % g.n) - (b % g.n));
    const dy = Math.abs(Math.floor(a / g.n) - Math.floor(b / g.n));
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  export function astar(g: Grid, start: number, goal: number): number[] | null {
    const cost = new Float64Array(g.n * g.n).fill(Infinity);
    const from = new Int32Array(g.n * g.n).fill(-1);
    const closed = new Uint8Array(g.n * g.n);
    const heap: [number, number][] = [];
    const push = (item: number, key: number) => {
      heap.push([item, key]);
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1;
        if (heap[p][1] <= heap[i][1]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          if (l >= heap.length) break;
          const c = l + 1 < heap.length && heap[l + 1][1] < heap[l][1] ? l + 1 : l;
          if (heap[c][1] >= heap[i][1]) break;
          [heap[c], heap[i]] = [heap[i], heap[c]];
          i = c;
        }
      }
      return top[0];
    };
    cost[start] = 0;
    push(start, heuristic(g, start, goal) * REGION.navigation.heuristicWeight);
    while (heap.length > 0) {
      const cur = pop();
      if (cur === goal) {
        const path = [goal];
        while (from[path[0]] !== -1) path.unshift(from[path[0]]);
        return path;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const next of neighbors(g, cur)) {
        if (g.blocked[next] || closed[next]) continue;
        const diag = next % g.n !== cur % g.n && Math.floor(next / g.n) !== Math.floor(cur / g.n);
        const c = cost[cur] + (diag ? Math.SQRT2 : 1) * g.slow[next];
        if (c >= cost[next]) continue;
        cost[next] = c;
        from[next] = cur;
        push(next, c + heuristic(g, next, goal) * REGION.navigation.heuristicWeight);
      }
    }
    return null;
  }

  export function pathCost(g: Grid, cells: ArrayLike<number>): number {
    let total = 0;
    for (let i = 1; i < cells.length; i++) {
      const diag = cells[i] % g.n !== cells[i - 1] % g.n && Math.floor(cells[i] / g.n) !== Math.floor(cells[i - 1] / g.n);
      total += (diag ? Math.SQRT2 : 1) * g.slow[cells[i]];
    }
    return total;
  }

  export function lineCost(t: Terrain, obstacles: Blocker[], a: Vec, b: Vec, reach: number | null, maxCost: number, capFull = false): number {
    if (reach !== null && obstacles.some((o) => touches(o, a, b, reach))) return Infinity;
    const n = Math.ceil(dist(a, b) * 4);
    let sum = 0;
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / Math.max(1, n), y: a.y + ((b.y - a.y) * k) / Math.max(1, n) };
      if ((reach !== null && nearCliff(t, p, reach)) || tileCost(t, p, !capFull) > maxCost) return Infinity;
      sum += tileCost(t, p);
    }
    return (dist(a, b) * sum) / (n + 1);
  }

  export function clearLine(t: Terrain, obstacles: Blocker[], a: Vec, b: Vec, reach: number, maxCost: number, capFull = false): boolean {
    return lineCost(t, obstacles, a, b, reach, maxCost, capFull) < Infinity;
  }

  function costliestTile(t: Terrain, pts: Vec[]): number {
    return Math.max(...pts.map((p) => tileCost(t, p, true)));
  }

  function fits(t: Terrain, obstacles: Blocker[], cur: Vec, replaced: Vec[], reach: number): boolean {
    let pathCost = 0;
    let prev = cur;
    for (const p of replaced) {
      pathCost += lineCost(t, [], prev, p, null, Infinity);
      prev = p;
    }
    return lineCost(t, obstacles, cur, replaced[replaced.length - 1], reach, costliestTile(t, [cur, ...replaced])) <= pathCost * (1 + REGION.navigation.straighten + 1e-9);
  }

  function shortcut(t: Terrain, obstacles: Blocker[], from: Vec, points: Vec[], reach: number): Vec[] {
    const out: Vec[] = [];
    let cur = from;
    let i = 0;
    while (i < points.length) {
      let best = i;
      let step = 1;
      let failed = points.length;
      while (best < points.length - 1) {
        const candidate = Math.min(i + step, points.length - 1);
        if (!fits(t, obstacles, cur, points.slice(i, candidate + 1), reach)) {
          failed = candidate;
          break;
        }
        best = candidate;
        step *= 2;
      }
      while (failed - best > 1) {
        const candidate = Math.floor((best + failed) / 2);
        if (fits(t, obstacles, cur, points.slice(i, candidate + 1), reach)) best = candidate;
        else failed = candidate;
      }
      out.push(points[best]);
      cur = points[best];
      i = best + 1;
    }
    return out;
  }

  export function route(w: World, layer: ReturnType<typeof terrainLayer>, from: Vec, to: Vec, radius: number, extra: Blocker[]): Vec[] {
    const all = blockers(w, extra);
    if (clearLine(w.terrain, all, from, to, radius + CLEARANCE, 1, true)) return [to];
    const g = grid(layer, all, radius);
    const start = cellOf(g, from);
    const statics = grid(layer, blockers(w, []), radius);
    let exit: number | null = start;
    let reach = reachable(statics, start);
    if (![start, ...neighbors(g, start)].some((c) => !g.blocked[c])) {
      const ring = Math.ceil((radius + CLEARANCE) / CELL) + 1;
      const targetSide = nearestFree(g, cellOf(g, to));
      const side = targetSide === null ? null : reachable(statics, targetSide);
      exit = (side && nearestFree(g, start, side, ring)) ?? nearestFree(g, start)!;
      reach = reachable(statics, exit);
    }
    const goal = nearestFree(g, cellOf(g, to), reach)!;
    const found = astar(g, exit, goal) ?? astar(g, exit, nearestReachable(g, exit, goal))!;
    const cells = exit === start ? found : [start, ...found];
    const last = found[found.length - 1];
    const end = last === cellOf(g, to) ? to : centerOf(g, last);
    return shortcut(w.terrain, all, from, [...cells.slice(1, -1).map((c) => centerOf(g, c)), end], radius + CLEARANCE);
  }

  function nearestReachable(g: Grid, start: number, goal: number): number {
    const reach = reachable(g, start);
    let best = start;
    for (let c = 0; c < reach.length; c++) if (reach[c] && heuristic(g, c, goal) < heuristic(g, best, goal)) best = c;
    return best;
  }

  export function blockers(w: World, extra: Blocker[]): Blocker[] {
    return [...w.obstacles.filter(isDriveObstacle).map(blocker), ...extra];
  }

  function blocker(o: Obstacle): Blocker {
    if (o.kind === 'site') return o;
    return { pos: o.pos, r: propReach(o), prop: { key: o.id, boxes: propBoxes(o).filter((b) => b.z0 < PHYSICS.truckClearance) } };
  }
}

const LONG_CELLS = 32;

function cellSpan(n: number, a: number, b: number): number {
  const dx = Math.abs((a % n) - (b % n));
  const dy = Math.abs(Math.floor(a / n) - Math.floor(b / n));
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function mulberry(seed: number): () => number {
  const r = { rngState: seed };
  return () => nextRandom(r);
}

describe('nav layers match the old grid rules', () => {
  const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  const rand = mulberry(7);
  const at = (lo: number, hi: number) => lo + (hi - lo) * rand();
  for (let i = 0; i < 4; i++) w.obstacles.push({ id: `wreck-t${i}`, pos: { x: at(40, w.size - 40), y: at(40, w.size - 40) }, r: 1, kind: 'wreck' });
  const pairs = Array.from({ length: 10 }, (_, i) => {
    const from = { x: at(5, w.size - 5), y: at(5, w.size - 5) };
    const reach = i % 2 === 0 ? 30 : w.size;
    const to = { x: Math.min(w.size - 5, Math.max(5, from.x + at(-reach, reach))), y: Math.min(w.size - 5, Math.max(5, from.y + at(-reach, reach))) };
    const extra: Blocker[] = [{ pos: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, r: 0.9 }];
    return { from, to, extra, radius: i % 3 === 0 ? 0.8 : 0.6 };
  });
  const refLayers = new Map<number, ReturnType<typeof Ref.terrainLayer>>();
  const refLayer = (radius: number) => {
    if (!refLayers.has(radius)) refLayers.set(radius, Ref.terrainLayer(w.terrain, radius));
    return refLayers.get(radius)!;
  };

  it('A* cells avoid every blocked cell and cost within 1% of the reference', () => {
    let searched = 0;
    for (const { from, to, extra, radius } of pairs) {
      const g = Ref.grid(refLayer(radius), Ref.blockers(w, extra), radius);
      const start = Ref.cellOf(g, from);
      const goal = Ref.nearestFree(g, Ref.cellOf(g, to));
      const layer = navLayer(w.terrain, w.obstacles, radius);
      expect(layer.n).toBe(g.n);
      const overlay = stampOverlay(layer, dynamicBlockers(w.obstacles, w.terrain, extra), radius);
      expect(nearestFreeCell(layer, overlay, Ref.cellOf(g, to))).toBe(goal);
      if (goal === null) continue;
      const ref = Ref.astar(g, start, goal);
      const got = findCells(layer, overlay, start, goal, null);
      expect(got === null).toBe(ref === null);
      if (!ref || !got) continue;
      searched++;
      expect(got[0]).toBe(start);
      expect(got[got.length - 1]).toBe(goal);
      for (let i = 1; i < got.length; i++) expect(g.blocked[got[i]]).toBe(0);
      const tolerance = cellSpan(g.n, start, goal) > LONG_CELLS ? 0.05 : 0.01;
      expect(Ref.pathCost(g, got) - Ref.pathCost(g, ref)).toBeLessThanOrEqual(tolerance * Ref.pathCost(g, ref));
      if (tolerance === 0.01) expect(Ref.pathCost(g, ref) - Ref.pathCost(g, got)).toBeLessThanOrEqual(0.01 * Ref.pathCost(g, ref));
    }
    expect(searched).toBeGreaterThanOrEqual(4);
  }, budget(180_000));

  it('straightClear equals the reference line check', () => {
    let clear = 0;
    for (const { from, to, extra, radius } of pairs) {
      const expected = Ref.clearLine(w.terrain, Ref.blockers(w, extra), from, to, radius + Ref.CLEARANCE, Infinity);
      expect(straightClear(w, from, to, radius, extra)).toBe(expected);
      const open = Ref.clearLine(w.terrain, Ref.blockers(w, []), from, to, radius + Ref.CLEARANCE, Infinity);
      expect(straightClear(w, from, to, radius, [])).toBe(open);
      if (open) clear++;
    }
    expect(clear).toBeGreaterThan(0);
  });

  it('routes equal the reference and repeat routes come from the cache', () => {
    resetPerf();
    for (const { from, to, extra, radius } of pairs) {
      const ref = Ref.route(w, refLayer(radius), from, to, radius, extra);
      const first = route(w, from, to, radius, extra);
      const again = route(w, from, to, radius, extra);
      expect(again).toEqual(first);
      first[0] = { x: -1, y: -1 };
      expect(route(w, from, to, radius, extra)).toEqual(again);
      const n = refLayer(radius).n;
      const cell = (p: Vec) => Math.min(n - 1, Math.floor(p.y / Ref.CELL)) * n + Math.min(n - 1, Math.floor(p.x / Ref.CELL));
      if (cellSpan(n, cell(from), cell(to)) <= LONG_CELLS) {
        expect(again).toEqual(ref);
        continue;
      }
      expect(again[again.length - 1]).toEqual(ref[ref.length - 1]);
      expect(routeLength(from, again)).toBeLessThanOrEqual(1.1 * routeLength(from, ref));
    }
    expect(perfSnapshot()['route-cache-hit'].calls).toBeGreaterThan(0);
  }, budget(60_000));

  it('a new kill wreck changes the route without rebuilding the static layer', () => {
    const a = { x: 30, y: 30 };
    const b = { x: 50, y: 30 };
    const flat = emptyWorld(a);
    const layer = navLayer(flat.terrain, flat.obstacles, 0.6);
    expect(route(flat, a, b, 0.6, [])).toEqual([b]);
    flat.obstacles = [...flat.obstacles, { id: 'wreck-x', pos: { x: 40, y: 30 }, r: 1.2, kind: 'wreck' }];
    const around = route(flat, a, b, 0.6, []);
    expect(around.length).toBeGreaterThan(1);
    expect(navLayer(flat.terrain, flat.obstacles, 0.6)).toBe(layer);
  });
});

describe('long routes search a coarse corridor', () => {
  const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));

  it('coarse regions are the connected pieces of each block, linked where their cells touch', () => {
    const layer = navLayer(w.terrain, w.obstacles, 0.6);
    const n = layer.n;
    const { n: bn, region, block, slow, edgeStart, edges } = layer.coarse;
    expect(bn).toBe(Math.ceil(n / COARSE));
    const blockOfCell = (x: number, y: number) => Math.floor(y / COARSE) * bn + Math.floor(x / COARSE);
    const linked = (a: number, b: number) => edges.subarray(edgeStart[a], edgeStart[a + 1]).includes(b);
    const slowSum = new Float64Array(block.length);
    const size = new Uint32Array(block.length);
    let wrong = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = y * n + x;
        const r = region[c];
        if ((r === 0) !== (layer.blocked[c] === 1)) wrong++;
        if (r === 0) continue;
        if (block[r] !== blockOfCell(x, y)) wrong++;
        slowSum[r] += layer.slow[c];
        size[r]++;
        for (const [dx, dy] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= n || ny >= n) continue;
          const o = region[ny * n + nx];
          if (o === 0) continue;
          if (blockOfCell(nx, ny) === blockOfCell(x, y)) {
            if (o !== r) wrong++;
          } else if (o !== r && !(linked(r, o) && linked(o, r))) wrong++;
        }
      }
    expect(wrong).toBe(0);
    for (let r = 1; r < block.length; r++) expect(slow[r]).toBeCloseTo(slowSum[r] / size[r], 5);
    expect(block.length - 1).toBeGreaterThan(new Set(block.subarray(1)).size);
  });

  it('free cells share a component exactly when a step path joins them', () => {
    const w = emptyWorld();
    const center = { x: 100, y: 100 };
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      w.obstacles.push({ id: `ring-${i}`, pos: { x: center.x + 10 * Math.cos(a), y: center.y + 10 * Math.sin(a) }, r: 1, kind: 'rock' });
    }
    const layer = navLayer(w.terrain, w.obstacles, 0.6);
    const n = layer.n;
    const cell = (p: Vec) => Math.floor(p.y / 0.5) * n + Math.floor(p.x / 0.5);
    const inside = cell(center);
    const outside = cell({ x: 30, y: 30 });
    const far = cell({ x: 500, y: 400 });
    expect(layer.blocked[inside]).toBe(0);
    expect(componentOf(layer, inside)).not.toBe(componentOf(layer, outside));
    expect(componentOf(layer, outside)).toBe(componentOf(layer, far));
    let blockedWithComponent = 0;
    for (let c = 0; c < n * n; c++) if (layer.blocked[c] && componentOf(layer, c) !== 0) blockedWithComponent++;
    expect(blockedWithComponent).toBe(0);
  });

  it('unreachable goals return null in under 5 ms, like the full search', () => {
    const flatAround = (p: Vec) => {
      for (let y = p.y - 14; y <= p.y + 14; y++) for (let x = p.x - 14; x <= p.x + 14; x++) if (isCliff(w.terrain, tileAt(w.terrain, { x, y }))) return false;
      return true;
    };
    const center = Array.from({ length: 25 * 25 }, (_, i) => ({ x: 60 + (i % 25) * 20, y: 60 + Math.floor(i / 25) * 20 })).find(flatAround)!;
    expect(center).toBeDefined();
    const obstacles = w.obstacles.filter((o) => dist(o.pos, center) > 14);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      obstacles.push({ id: `ring-${i}`, pos: { x: center.x + 10 * Math.cos(a), y: center.y + 10 * Math.sin(a) }, r: 1, kind: 'rock' });
    }
    const local = { ...w, obstacles };
    const radius = 0.6;
    const layer = navLayer(local.terrain, local.obstacles, radius);
    const overlay = stampOverlay(layer, dynamicBlockers(local.obstacles, local.terrain, []), radius);
    const g = Ref.grid(Ref.terrainLayer(local.terrain, radius), Ref.blockers(local, []), radius);
    const goal = Ref.cellOf(g, center);
    const from = { x: 40, y: 40 };
    const start = nearestFreeCell(layer, overlay, Ref.cellOf(g, from))!;
    expect(g.blocked[goal]).toBe(0);
    expect(Ref.astar(g, start, goal)).toBeNull();
    const t = performance.now();
    const got = findCells(layer, overlay, start, goal, null);
    const ms = performance.now() - t;
    expect(got).toBeNull();
    expect(ms).toBeLessThan(5);
  }, budget(60_000));

  it('a corridor cut by a kill wreck wall falls back to the full search', () => {
    const w = emptyWorld();
    for (let y = 16; y < w.size; y += 1.5) w.obstacles.push({ id: `wreck-w${y}`, pos: { x: 80, y }, r: 1, kind: 'wreck' });
    const radius = 0.6;
    const layer = navLayer(w.terrain, w.obstacles, radius);
    const overlay = stampOverlay(layer, dynamicBlockers(w.obstacles, w.terrain, []), radius);
    const n = layer.n;
    const start = 200 * n + 60;
    const goal = 200 * n + 260;
    resetPerf();
    const got = findCells(layer, overlay, start, goal, null);
    expect(perfSnapshot()['route-corridor-miss']?.calls).toBe(1);
    expect(got).not.toBeNull();
    expect(got![got!.length - 1]).toBe(goal);
    for (const c of got!) expect(layer.blocked[c] === 0 && overlay.stamp[c] !== overlay.gen).toBe(true);
    expect(Math.min(...Array.from(got!, (c) => Math.floor(c / n)))).toBeLessThan(32);
  });

  it('long routes with no dynamic blockers never miss the corridor', () => {
    const rand = mulberry(11);
    const radius = 0.8;
    const layer = navLayer(w.terrain, w.obstacles, radius);
    const overlay = stampOverlay(layer, [], radius);
    const n = layer.n;
    resetPerf();
    let found = 0;
    for (let i = 0; i < 20; i++) {
      const a = nearestFreeCell(layer, overlay, Math.floor(rand() * n * n))!;
      const b = nearestFreeCell(layer, overlay, Math.floor(rand() * n * n))!;
      if (componentOf(layer, a) !== componentOf(layer, b) || cellSpan(n, a, b) <= LONG_CELLS) continue;
      expect(findCells(layer, overlay, a, b, null)).not.toBeNull();
      found++;
    }
    expect(found).toBeGreaterThanOrEqual(5);
    expect(perfSnapshot()['route-corridor-miss']).toBeUndefined();
  }, budget(60_000));
});

describe('raider hunting routes on the map', () => {
  const camps = REGION.locations.filter((l) => l.kind === 'camp');

  function legsOf(w: World): [Vec, Vec][] {
    const legs: [Vec, Vec][] = [];
    for (const camp of camps) {
      const raid = raiderGrounds(w, camp);
      const patrol = raiderPatrolPosts(w, camp);
      const pad = sitePads(camp)[0];
      for (const post of raid) legs.push([pad, post]);
      for (const chain of [raid, patrol]) for (let i = 0; i + 1 < chain.length; i++) legs.push([chain[i], chain[i + 1]]);
    }
    return legs;
  }

  // Routes every leg with a hunting raider and measures the route in samples of 0.5 tiles.
  function measure(band: number) {
    const saved = REGION.navigation.roadShyBand;
    REGION.navigation.roadShyBand = band;
    try {
      const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
      w.terrain = { ...TEST_MAP.terrain };
      const driver = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 100, y: 100 });
      driver.brain = npcBrain('buggy', driver.pos, ['raider']);
      driver.brain.goals = [{ kind: 'raid', targetId: null, destination: null, phase: 'travel', reason: 'raid' }];
      let length = 0, road = 0, near6 = 0, near10 = 0, samples = 0;
      const legs = legsOf(w);
      for (const [from, to] of legs) {
        const points = route(w, from, to, 0.8, [], driver);
        length += routeLength(from, points);
        let prev = from;
        for (const p of points) {
          const n = Math.max(1, Math.ceil(dist(prev, p) * 2));
          for (let k = 0; k < n; k++) {
            const x = prev.x + ((p.x - prev.x) * k) / n;
            const y = prev.y + ((p.y - prev.y) * k) / n;
            const edge = ROAD_INDEX.nearestWithin(x, y, 12 + REGION.roadWidth) - REGION.roadWidth / 2;
            samples++;
            if (edge <= 0) road++;
            if (edge <= 6) near6++;
            if (edge <= 10) near10++;
          }
          prev = p;
        }
      }
      return { legs: legs.length, meanLength: length / legs.length, road: road / samples, near6: near6 / samples, near10: near10 / samples };
    } finally {
      REGION.navigation.roadShyBand = saved;
    }
  }

  it('stay off roads and keep a band from them, at a bounded detour', () => {
    const shy = measure(REGION.navigation.roadShyBand);
    const plain = measure(0);
    console.log('hunting routes', JSON.stringify({ shy, plain }));
    expect(shy.road).toBeLessThanOrEqual(0.04);
    expect(shy.near6).toBeLessThanOrEqual(plain.near6 * 0.6);
    expect(shy.near10).toBeLessThanOrEqual(plain.near10 * 0.6);
    expect(shy.meanLength).toBeLessThanOrEqual(plain.meanLength * 1.3);
  });

  it('still cross a road to reach the far side', () => {
    const road = REGION.roads[0];
    const mid = Math.floor(road.length / 2);
    const a = road[mid];
    const b = road[mid + 1];
    const along = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(along.x, along.y);
    const normal = { x: -along.y / len, y: along.x / len };
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const side = (s: number): Vec => ({ x: centre.x + normal.x * 14 * s, y: centre.y + normal.y * 14 * s });
    const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const driver = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], side(-1));
    driver.brain = npcBrain('buggy', driver.pos, ['raider']);
    driver.brain.goals = [{ kind: 'raid', targetId: null, destination: null, phase: 'travel', reason: 'raid' }];
    const points = route(w, side(-1), side(1), 0.8, [], driver);
    expect(dist(points.at(-1)!, side(1))).toBeLessThanOrEqual(4);
    const across = (p: Vec): number => Math.sign((p.x - centre.x) * normal.x + (p.y - centre.y) * normal.y);
    expect(across(side(-1))).not.toBe(across(points.at(-1)!));
  });
});
