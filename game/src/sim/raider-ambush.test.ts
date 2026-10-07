import { describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { HUNT, NPC_BEHAVIOR, NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { START_KITS } from '../data/start';
import { TERRAIN } from '../data/terrain';
import { TEST_MAP } from '../test/map';
import { planNpcOrders } from './ai';
import { inCombat } from './combat';
import { contactsOf } from './detect';
import { addGoods } from './inventory';
import { CLEARANCE, isTransientWreck, nearCliff, terrainNav } from './nav/layer';
import { decide, huntingGrounds, lawmanTowns, raiderGrounds, raiderPatrolPosts } from './npc-decisions';
import { resolveNpcActivities, topGoal } from './npc-activities';
import { route } from './path';
import { siteGates, sitePads, siteUnder, type Site } from './sites';
import { isFree } from './spawn';
import { isRoadTile } from './terrain';
import { hazardZones } from './territory';
import { addVehicle, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import { dist, polylineDist, type Vec } from './vec';
import { hasLineOfFire } from './vision';
import { isWatching, watchPost } from './watch-posts';
import { endTurn, newWorld } from './world';

const CAMPS = REGION.locations.filter((l) => l.kind === 'camp');

// The largest chassis any raider template rolls: posts must hold it.
const RAIDER_RADIUS = Math.max(
  ...Object.values(NPCS).filter((t) => t.traits.includes('raider')).flatMap((t) => t.loadout.chassis.map((c) => chassisDef(c.value).radius)),
);

// The real map with its fixed props only: no road wrecks, which come and go.
function mapWorld(): World {
  const w = newWorld(1, START_KITS.standard, TEST_MAP);
  w.obstacles = w.obstacles.filter((o) => !isTransientWreck(o));
  return w;
}

// Every rule of IV3 but sight, checked from the map itself.
function expectPostRules(w: World, post: Vec, where: string): void {
  const gates = lawmanTowns().flatMap((town) => siteGates(town));
  expect(isRoadTile(w.terrain, post), where).toBe(false);
  for (const road of REGION.roads) expect(polylineDist(post, road) - REGION.roadWidth / 2, where).toBeGreaterThanOrEqual(HUNT.postRoadGap);
  expect(siteUnder(post), where).toBeNull();
  for (const zone of hazardZones()) expect(dist(post, zone.pos), where).toBeGreaterThan(zone.radius);
  for (const gate of gates) expect(dist(post, gate), where).toBeGreaterThan(HUNT.lawReach);
  expect(nearCliff(terrainNav(w.terrain), post.x, post.y, RAIDER_RADIUS + CLEARANCE), where).toBe(false);
  expect(isFree({ ...w, vehicles: [] }, post, RAIDER_RADIUS, null), where).toBe(true);
}

describe('watch posts on the map', () => {
  const w = mapWorld();

  it('give every camp raid and patrol posts that keep the post rules', () => {
    for (const camp of CAMPS) {
      const raid = raiderGrounds(w, camp);
      const patrol = raiderPatrolPosts(w, camp);
      expect(raid.length, camp.id).toBeGreaterThanOrEqual(2);
      expect(patrol.length, camp.id).toBeGreaterThanOrEqual(2);
      for (const post of [...raid, ...patrol]) expectPostRules(w, post, `${camp.id} ${post.x},${post.y}`);
    }
  });

  it('see the ground each one watches', () => {
    let posts = 0;
    for (const ground of huntingGrounds()) {
      const post = watchPost(w, ground);
      if (!post) continue;
      posts++;
      expect(dist(post, ground)).toBeLessThanOrEqual(TERRAIN.vision.radius);
      expect(hasLineOfFire(w, post, ground), `${post.x},${post.y} to ${ground.x},${ground.y}`).toBe(true);
    }
    expect(posts).toBeGreaterThan(0);
  });

  it('take a ground far from roads as its own post', () => {
    const own = huntingGrounds().filter((g) => REGION.roads.every((road) => polylineDist(g, road) > 20) && watchPost(w, g) !== null);
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((g) => dist(watchPost(w, g)!, g) === 0).length).toBeGreaterThan(0);
  });

  it('are the same for the same terrain, built again', () => {
    const again = { ...mapWorld(), terrain: { ...TEST_MAP.terrain } };
    for (const camp of CAMPS) {
      expect(raiderGrounds(again, camp)).toEqual(raiderGrounds(w, camp));
      expect(raiderPatrolPosts(again, camp)).toEqual(raiderPatrolPosts(w, camp));
    }
  });

  it('can be driven to off the road from the camp, and back', () => {
    for (const camp of CAMPS) {
      for (const post of [...raiderGrounds(w, camp), ...raiderPatrolPosts(w, camp)]) {
        const pad = nearestOf(sitePads(camp), post);
        const driver = raidingDriver(pad, post);
        const there = route(w, pad, post, RAIDER_RADIUS, [], driver).at(-1)!;
        expect(dist(there, post), `${camp.id} to ${post.x},${post.y}`).toBeLessThanOrEqual(RULES.arriveRadius);
        const back = route(w, post, pad, RAIDER_RADIUS, [], driver).at(-1)!;
        expect(dist(back, pad), `${camp.id} from ${post.x},${post.y}`).toBeLessThanOrEqual(RULES.arriveRadius);
      }
    }
  });
});

function nearestOf(points: readonly Vec[], to: Vec): Vec {
  return points.reduce((a, b) => (dist(a, to) <= dist(b, to) ? a : b));
}

function raidingDriver(home: Vec, post: Vec): Pick<Vehicle, 'id' | 'brain'> {
  const brain = npcBrain('buggy', home, ['raider']);
  brain.goals = [raidGoal(post)];
  return { id: 'raider-route', brain };
}

function raidGoal(post: Vec): NpcActivity {
  return { kind: 'raid', targetId: null, destination: { ...post }, phase: 'travel', reason: 'watch the road for prey' };
}

const scrapjaw = CAMPS.find((c) => c.id === 'scrapjaw') as Site;

// A raider of Scrapjaw on flat ground, ten tiles short of one of its posts, with the player parked far away.
function raiderNearPost() {
  const w = emptyWorld({ x: 30, y: 30 });
  const post = raiderGrounds(w, scrapjaw)[0];
  const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: post.x - 10, y: post.y });
  raider.brain = npcBrain('buggy', sitePads(scrapjaw)[0], ['raider']);
  raider.brain.goals = [raidGoal(post)];
  return { w, post, raiderId: raider.id };
}

function vehicle(w: World, id: string): Vehicle {
  const v = w.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`No vehicle ${id}`);
  return v;
}

// A raider of Scrapjaw on flat ground, watching its post, and a trader loaded with cargo worth a raid.
function watchingRaider(traderGap: number) {
  const { w, post, raiderId } = raiderNearPost();
  const raider = vehicle(w, raiderId);
  raider.pos = { ...post };
  raider.brain!.goals = [{ ...raidGoal(post), destination: null, phase: 'act', watchUntil: w.turn + HUNT.watchTurns }];
  const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: post.x + traderGap, y: post.y });
  trader.brain = npcBrain('trader', trader.pos, ['trader']);
  if (addGoods(w, trader, 'electronics', 6) < 6) throw new Error('No room for the trader cargo');
  return { w, raider, trader };
}

describe('the watch', () => {
  it('starts on arrival, keeps the raider parked for the watch turns without a stall, then ends', () => {
    forceOption('idle', 'patrol');
    const start = raiderNearPost();
    const raiderId = start.raiderId;
    let w = start.w;
    const stalls: unknown[] = [];
    let started: number | null = null;
    let ended: number | null = null;
    for (let i = 0; i < 80 && ended === null; i++) {
      w = endTurn(w, testDrive);
      stalls.push(...w.events.filter((e) => e.t === 'stall'));
      const raider = vehicle(w, raiderId);
      const top = topGoal(raider);
      if (started === null && top?.kind === 'raid' && top.phase === 'act') started = w.turn;
      if (started !== null && w.turn - started < 10) expect(raider.speed).toBe(0);
      if (w.events.some((e) => e.t === 'activity' && e.vehicle === raiderId && e.reason === 'watched the road')) ended = w.turn;
    }
    expect(started).not.toBeNull();
    expect(ended! - started!).toBe(HUNT.watchTurns);
    expect(HUNT.watchTurns).toBeLessThan(NPC_BEHAVIOR.stallTurns);
    expect(stalls).toEqual([]);
  });

  it('logs the end of the watch as a watched road', () => {
    const { w, raider } = watchingRaider(200);
    w.turn += HUNT.watchTurns;
    planNpcOrders(w);
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'activity', vehicle: raider.id, previous: 'raid', reason: 'watched the road' }));
  });

  it('is the only goal that may hold a watch end', () => {
    const { w, raider } = watchingRaider(200);
    raider.brain!.goals = [{ kind: 'patrol', targetId: 'scrapjaw', destination: null, phase: 'act', reason: 'patrol', watchUntil: w.turn + 5 }];
    expect(() => planNpcOrders(w)).toThrow(/watch/);
  });

  it('makes a raider that hears loaded prey beyond sight mostly lie low', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    expect(isWatching(raider)).toBe(true);
    expect(contactsOf(w, raider, Infinity).some((c) => c.vehicleId === trader.id)).toBe(true);
    const draws = 400;
    let keeps = 0;
    for (let i = 0; i < draws; i++) if (decide(w, raider, 'contactHeard', trader.id, null) === 'keep') keeps++;
    const watching = keeps / draws;
    raider.brain!.goals = [raidGoal({ x: raider.pos.x + 30, y: raider.pos.y })];
    keeps = 0;
    for (let i = 0; i < draws; i++) if (decide(w, raider, 'contactHeard', trader.id, null) === 'keep') keeps++;
    expect(watching).toBeGreaterThan(0.55);
    expect(watching).toBeLessThan(0.85);
    expect(keeps / draws).toBeLessThan(0.15);
  });

  it('closes on heard prey only as far as its contact circle', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    forceOption('contactHeard', 'investigate');
    const contact = contactsOf(w, raider, Infinity).find((c) => c.vehicleId === trader.id)!;
    planNpcOrders(w);
    const goal = topGoal(raider)!;
    expect(goal.kind).toBe('investigate');
    expect(goal.destination).toEqual(contact.center);
    expect(goal.destination).not.toEqual(trader.pos);
  });

  it('springs on prey that drives into sight, and the fight follows', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius - 6);
    trader.speed = 4;
    forceOption('hostileSeen', 'fight');
    planNpcOrders(w);
    expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: trader.id });
    expect(raider.brain!.goals[0].kind).toBe('raid');
    const next = endTurn(w, testDrive);
    expect(inCombat(next, vehicle(next, raider.id))).toBe(true);
  });

  it('gives up prey that turns away and stays unheard, after the search turns', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius - 6);
    forceOption('hostileSeen', 'fight');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('fight');
    trader.pos = { x: raider.pos.x + TERRAIN.vision.radius + 10, y: raider.pos.y };
    trader.speed = 0;
    for (let i = 0; i < NPC_BEHAVIOR.fightSearchTurns; i++) {
      w.turn++;
      planNpcOrders(w);
      expect(topGoal(raider)?.kind).toBe('fight');
    }
    w.turn++;
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).not.toBe('fight');
  });

  it('ignores a truck it neither sees nor hears', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 0;
    for (let i = 0; i < 5; i++) {
      w.turn++;
      planNpcOrders(w);
      resolveNpcActivities(w);
    }
    expect(contactsOf(w, raider, Infinity).some((c) => c.vehicleId === trader.id)).toBe(false);
    expect(topGoal(raider)).toMatchObject({ kind: 'raid', phase: 'act' });
    expect(Object.keys(raider.brain!.noticed).some((key) => key.endsWith(trader.id))).toBe(false);
    expect(raider.order?.kind ?? 'brake').toBe('brake');
  });
});
