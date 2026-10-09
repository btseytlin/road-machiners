import { describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { HUNT, NPC_BEHAVIOR, NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { START_KITS } from '../data/start';
import { ECONOMY } from '../data/goods';
import { TERRAIN } from '../data/terrain';
import { TEST_MAP } from '../test/map';
import { planNpcOrders } from './ai';
import { inCombat } from './combat';
import { playerVehicle } from './damage';
import { knockOutNpc } from './defeat';
import { chooseOption, currentOptions } from './dialogue';
import { contactsOf } from './detect';
import { campGoodPrice, campPartPrice } from './economy';
import { corePart, goodsCount } from './grid';
import { addGoods, spareParts } from './inventory';
import { CLEARANCE, isTransientWreck, nearCliff, terrainNav } from './nav/layer';
import { decide, fightOddsAgainst, huntingGrounds, judgeDanger, lawmanTowns, raiderGrounds, raiderPatrolPosts, usefulContacts } from './npc-decisions';
import { finishGoal, resolveNpcActivities, topGoal } from './npc-activities';
import { yieldTo } from './parley';
import { route } from './path';
import { getResources } from './resources';
import { siteGates, sitePads, siteUnder, type Site } from './sites';
import { isFree } from './spawn';
import { fuelCap } from './stats';
import { stateOf } from './states';
import { isRoadTile } from './terrain';
import { hazardZones } from './territory';
import { addVehicle, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import { dist, polylineDist, type Vec } from './vec';
import { hasLineOfFire } from './vision';
import { exposureAt, hidesOf, isWatching, watchPost } from './watch-posts';
import { defaultSetup } from './settings';
import { endTurn, newWorld } from './world';

const CAMPS = REGION.locations.filter((l) => l.kind === 'camp');

const RAIDER_RADIUS = Math.max(
  ...Object.values(NPCS).filter((t) => t.traits.includes('raider')).flatMap((t) => t.loadout.chassis.map((c) => chassisDef(c.value).radius)),
);

function mapWorld(): World {
  const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  w.obstacles = w.obstacles.filter((o) => !isTransientWreck(o));
  return w;
}

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

function fuelBill(w: World, id: string): number {
  return fuelCap(vehicle(w, id)) * ECONOMY.supplyPrice.fuel;
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

  it('have the least road exposure among the hides of their ground', () => {
    let posts = 0;
    for (const ground of huntingGrounds()) {
      const post = watchPost(w, ground);
      if (!post) continue;
      posts++;
      const least = Math.min(...hidesOf(w, ground).map((p) => exposureAt(w, p)));
      expect(exposureAt(w, post), `${post.x},${post.y} for ${ground.x},${ground.y}`).toBe(least);
    }
    expect(posts).toBeGreaterThan(0);
  });

  it('hide at least 11 of the 16 road grounds from road traffic', () => {
    const roadGrounds = huntingGrounds().filter((g) => REGION.roads.some((road) => polylineDist(g, road) <= REGION.roadWidth));
    expect(roadGrounds.length).toBe(16);
    const hidden = roadGrounds.filter((g) => watchPost(w, g) !== null && exposureAt(w, watchPost(w, g)!) === 0);
    expect(hidden.length).toBeGreaterThanOrEqual(11);
  });

  it('build for every camp on a fresh terrain within the time budget', () => {
    const fresh = { ...mapWorld(), terrain: { ...TEST_MAP.terrain } };
    terrainNav(fresh.terrain);
    watchPost(fresh, huntingGrounds()[0]);
    const start = performance.now();
    for (const camp of CAMPS) {
      raiderGrounds(fresh, camp);
      raiderPatrolPosts(fresh, camp);
    }
    const ms = performance.now() - start;
    console.log(`posts of all camps on a fresh terrain: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(4000);
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
        const driver = raidingDriver(w, pad, post);
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

function raidingDriver(w: World, home: Vec, post: Vec): Vehicle {
  const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], home);
  v.id = 'raider-route';
  v.brain = npcBrain('buggy', home, ['raider']);
  v.brain.goals = [raidGoal(post)];
  return v;
}

function raidGoal(post: Vec): NpcActivity {
  return { kind: 'raid', targetId: null, destination: { ...post }, phase: 'travel', reason: 'watch the road for prey' };
}

const scrapjaw = CAMPS.find((c) => c.id === 'scrapjaw') as Site;

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

function drawShare(w: World, raider: Vehicle, decision: 'hostileSeen' | 'contactHeard', subject: string, danger: number | null, option: string): number {
  const draws = 400;
  let hits = 0;
  for (let i = 0; i < draws; i++) if (decide(w, raider, decision, subject, danger) === option) hits++;
  return hits / draws;
}

function watchingRaiderSeeing() {
  const { w, raider } = watchingRaider(200);
  const player = playerVehicle(w);
  player.pos = { x: raider.pos.x + 8, y: raider.pos.y };
  return { w, raider, player };
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

  it('makes a watching raider that hears loaded prey beyond sight mostly investigate', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    expect(isWatching(raider)).toBe(true);
    expect(contactsOf(w, raider, Infinity).some((c) => c.vehicleId === trader.id)).toBe(true);
    expect(drawShare(w, raider, 'contactHeard', trader.id, null, 'investigate')).toBeGreaterThanOrEqual(0.8);
  });

  it('attacks the start-kit player about half the time and rarely flees', () => {
    const { w, raider, player } = watchingRaiderSeeing();
    const danger = judgeDanger(w, raider, player);
    const fight = drawShare(w, raider, 'hostileSeen', player.id, danger, 'fight');
    expect(fight).toBeGreaterThanOrEqual(0.35);
    expect(fight).toBeLessThanOrEqual(0.6);
    expect(drawShare(w, raider, 'hostileSeen', player.id, danger, 'flee')).toBeLessThanOrEqual(0.1);
  });

  it('almost always attacks a player carrying six electronics', () => {
    const { w, raider, player } = watchingRaiderSeeing();
    if (addGoods(w, player, 'electronics', 6) < 6) throw new Error('No room for the cargo');
    expect(drawShare(w, raider, 'hostileSeen', player.id, judgeDanger(w, raider, player), 'fight')).toBeGreaterThanOrEqual(0.9);
  });

  it('flees prey that outguns it, when it has a getaway', () => {
    const { w, raider } = watchingRaider(200);
    const brute = addVehicle(w, 'traders', 'hauler', ['mg', 'mg', 'mg', 'mg', 'stockEngine'], { x: raider.pos.x + 8, y: raider.pos.y });
    brute.brain = npcBrain('trader', brute.pos, ['trader']);
    if (addGoods(w, brute, 'electronics', 6) < 6) throw new Error('No room for the cargo');
    const danger = judgeDanger(w, raider, brute);
    expect(danger).toBeGreaterThan(NPC_BEHAVIOR.threatRatio * 1.5);
    expect(drawShare(w, raider, 'hostileSeen', brute.id, danger, 'flee')).toBeGreaterThanOrEqual(0.5);
  });

  it('flees prey when it is weak', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius - 6);
    corePart(raider, 'cab').hp = 1;
    expect(drawShare(w, raider, 'hostileSeen', trader.id, judgeDanger(w, raider, trader), 'flee')).toBeGreaterThanOrEqual(0.5);
  });

  it('weighs a load by the raid curve when it is not hunting', () => {
    const { w, raider, player } = watchingRaiderSeeing();
    const danger = judgeDanger(w, raider, player);
    const hunting = drawShare(w, raider, 'hostileSeen', player.id, danger, 'fight');
    raider.brain!.goals = [{ ...raidGoal(raider.pos), kind: 'sell', destination: null, phase: 'go' }];
    expect(drawShare(w, raider, 'hostileSeen', player.id, danger, 'fight')).toBeLessThan(hunting);
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

  it('names the investigation of a watching raider a spring', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(topGoal(raider)).toMatchObject({ kind: 'investigate', reason: 'spring on prey it heard' });
  });

  it('follows the newest heard centre while the prey drives on, never its true position', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    const first = { ...topGoal(raider)!.destination! };
    trader.pos = { x: trader.pos.x - 2, y: trader.pos.y - 2 };
    w.turn++;
    const newest = usefulContacts(w, raider).find((c) => c.vehicleId === trader.id)!;
    planNpcOrders(w);
    const goal = topGoal(raider)!;
    expect(goal.kind).toBe('investigate');
    expect(goal.destination).toEqual(newest.center);
    expect(goal.destination).not.toEqual(first);
    expect(goal.destination).not.toEqual(trader.pos);
  });

  it('ends at the last centre when the sound stops, and goes back to the hunt', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    const goal = topGoal(raider)!;
    trader.speed = 0;
    trader.pos = { x: trader.pos.x + 80, y: trader.pos.y };
    raider.pos = { ...goal.destination! };
    w.turn++;
    planNpcOrders(w);
    resolveNpcActivities(w);
    expect(topGoal(raider)?.kind).not.toBe('investigate');
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'activity', vehicle: raider.id, previous: 'investigate', reason: 'found nothing at the contact' }));
  });

  it('ends the investigation on sight and rolls the sighting once', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius + 5);
    trader.speed = 4;
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('investigate');
    trader.pos = { x: raider.pos.x + TERRAIN.vision.radius - 6, y: raider.pos.y };
    forceOption('hostileSeen', 'fight');
    w.turn++;
    planNpcOrders(w);
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'activity', vehicle: raider.id, previous: 'investigate', reason: 'spotted the truck it heard' }));
    expect(topGoal(raider)).toMatchObject({ kind: 'fight', targetId: trader.id });
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

  it('ends the watch when a fight pops back onto it, instead of parking away from the post', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius - 6);
    forceOption('hostileSeen', 'fight');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('fight');
    finishGoal(w, raider, 'lost the target');
    expect(raider.brain!.goals.some((g) => g.kind === 'raid' && g.phase === 'act')).toBe(false);
    expect(isWatching(raider)).toBe(false);
    expect(trader.id).toBeDefined();
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

function playUntil(start: World, limit: number, done: (w: World) => boolean, each: (w: World) => void = () => {}): World {
  let w = start;
  for (let i = 0; i < limit; i++) {
    w = endTurn(w, testDrive);
    each(w);
    if (done(w)) return w;
  }
  throw new Error(`Not done within ${limit} turns`);
}

function playTurns(start: World, turns: number, each: (w: World) => void): World {
  let w = start;
  for (let i = 0; i < turns; i++) {
    w = endTurn(w, testDrive);
    each(w);
  }
  return w;
}

function soldCargo(w: World, id: string): boolean {
  return w.events.some((e) => e.t === 'activity' && e.vehicle === id && e.reason === 'sold cargo');
}

function holdings(w: World, ids: string[]): string[] {
  return ids.flatMap((id) => vehicle(w, id).items.map((item) => (item.kind === 'good' ? `good:${item.good}` : `part:${item.part.id}`))).sort();
}

function goodsOn(w: World, id: string, good: string): number {
  return goodsCount(vehicle(w, id))[good] ?? 0;
}

function pileGoods(w: World, good: string): number {
  return w.salvage.filter((s) => s.pile).reduce((sum, s) => sum + (s.goods[good] ?? 0), 0);
}

function campValue(raider: Vehicle): number {
  const goods = Object.entries(goodsCount(raider)).reduce((sum, [good, count]) => sum + count * campGoodPrice(good), 0);
  return goods + spareParts(raider).reduce((sum, part) => sum + campPartPrice(part), 0);
}

function huntsAgain(w: World, raiderId: string, victimId: string): boolean {
  const goals = vehicle(w, raiderId).brain!.goals;
  return goals.some((g) => g.targetId === victimId && g.kind !== 'loot') || stateOf(w, 'combat', raiderId, victimId) !== null;
}

function watchingNearCamp(gap: number) {
  const start = watchingRaider(gap);
  const post = nearestOf(raiderGrounds(start.w, scrapjaw), sitePads(scrapjaw)[0]);
  start.raider.pos = { ...post };
  start.trader.pos = { x: post.x + gap, y: post.y };
  return start;
}

function droppedRaidAfterLoot(w: World, id: string): boolean {
  const events = w.events.filter((e) => e.t === 'activity' && e.vehicle === id);
  return events.some((e) => e.t === 'activity' && e.previous === 'loot') && events.some((e) => e.t === 'activity' && e.previous === 'raid' && e.reason === 'chose something new');
}

describe('going home with loot', () => {
  function resumeShare(w: World, raider: Vehicle): number {
    const draws = 400;
    let resumes = 0;
    for (let i = 0; i < draws; i++) if (decide(w, raider, 'resume', null, null) === 'resume') resumes++;
    return resumes / draws;
  }

  it('makes a raider on a raid or patrol with sale cargo mostly drop its hunt', () => {
    const { w, raider } = watchingRaider(200);
    const empty = resumeShare(w, raider);
    if (addGoods(w, raider, 'electronics', 2) < 2) throw new Error('No room for the raider cargo');
    const raiding = resumeShare(w, raider);
    raider.brain!.goals = [{ kind: 'patrol', targetId: scrapjaw.id, destination: { ...raider.pos }, phase: 'travel', reason: 'patrol' }];
    const patrolling = resumeShare(w, raider);
    expect(empty).toBeGreaterThan(0.8);
    expect(raiding).toBeLessThan(0.15);
    expect(patrolling).toBeLessThan(0.15);
  });

  it('leaves a raider on any other hunt, or any other driver, resuming as before', () => {
    const { w, raider, trader } = watchingRaider(200);
    if (addGoods(w, raider, 'electronics', 2) < 2) throw new Error('No room for the raider cargo');
    raider.brain!.goals = [{ kind: 'prowl', targetId: null, destination: { ...raider.pos }, phase: 'travel', reason: 'prowl' }];
    trader.brain!.goals = [raidGoal(trader.pos)];
    expect(resumeShare(w, raider)).toBeGreaterThan(0.8);
    expect(resumeShare(w, trader)).toBeGreaterThan(0.8);
  });

  it('loots a surrendered pile, drops the raid and sells the cargo at its camp, leaving the victim alone', () => {
    const { w, raider, trader } = watchingNearCamp(8);
    const carried = goodsOn(w, trader.id, 'electronics');
    const money = getResources(w, raider).money;
    yieldTo(w, trader, raider);
    expect(goodsOn(w, trader.id, 'electronics')).toBe(0);
    expect(pileGoods(w, 'electronics')).toBe(carried);
    expect(topGoal(raider)?.kind).toBe('loot');
    let dropped = false;
    let sale: { goals: NpcActivity[]; value: number; looted: number } | null = null;
    const end = playUntil(w, 120, (x) => soldCargo(x, raider.id), (x) => {
      const r = vehicle(x, raider.id);
      dropped ||= droppedRaidAfterLoot(x, raider.id);
      if (!soldCargo(x, raider.id)) expect(goodsOn(x, raider.id, 'electronics') + pileGoods(x, 'electronics') + goodsOn(x, trader.id, 'electronics')).toBe(carried);
      if (stateOf(x, 'truce', raider.id, trader.id)) expect(huntsAgain(x, raider.id, trader.id)).toBe(false);
      if (!sale && topGoal(r)?.kind === 'sell') sale = { goals: [...r.brain!.goals], value: campValue(r), looted: goodsOn(x, raider.id, 'electronics') };
    });
    expect(dropped).toBe(true);
    expect(sale).not.toBeNull();
    const { goals, value, looted } = sale!;
    expect(goals).toEqual([expect.objectContaining({ kind: 'sell', targetId: scrapjaw.id })]);
    expect(looted).toBe(carried);
    expect(value).toBe(carried * campGoodPrice('electronics'));
    const after = getResources(end, vehicle(end, raider.id)).money;
    expect(after).toBeLessThanOrEqual(money + value);
    expect(after).toBeGreaterThan(money + value - fuelBill(end, raider.id));
    expect(goodsOn(end, raider.id, 'electronics')).toBe(0);
  });

  it('takes the cargo the player hands over mid-fight, then drops the raid to sell it', () => {
    const start = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) start.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    if (addGoods(start, playerVehicle(start), 'electronics', 6) < 6) throw new Error('No room for the player cargo');
    const raider = addVehicle(start, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 42, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    raider.brain.goals = [raidGoal(raider.pos)];
    forceOption('hostileSeen', 'fight');
    const demanded = playUntil(start, 4, (x) => x.player.call?.topic === 'demand');
    expect(inCombat(demanded, vehicle(demanded, raider.id))).toBe(true);
    const handed = chooseOption(demanded, currentOptions(demanded).findIndex((o) => o.text === 'Fine. Take it.'));
    expect(inCombat(handed, vehicle(handed, raider.id))).toBe(false);
    expect(topGoal(vehicle(handed, raider.id))?.kind).toBe('loot');
    const end = playUntil(handed, 20, (x) => topGoal(vehicle(x, raider.id))?.kind === 'sell', (x) => {
      expect(goodsOn(x, raider.id, 'electronics') + pileGoods(x, 'electronics')).toBe(6);
    });
    expect(goodsOn(end, raider.id, 'electronics')).toBe(6);
    expect(vehicle(end, raider.id).brain!.goals.map((g) => g.kind)).toEqual(['sell']);
  });

  it('strips a knocked-out victim, drops the raid and sells at its camp, and never attacks the victim again', () => {
    const { w, raider, trader } = watchingNearCamp(3);
    trader.lastHitBy = raider.id;
    trader.brain!.attackers[raider.id] = true;
    const before = holdings(w, [raider.id, trader.id]);
    const money = getResources(w, raider).money;
    knockOutNpc(w, trader);
    expect(topGoal(raider)).toMatchObject({ kind: 'loot', targetId: trader.id });
    let dropped = false;
    let sale: { goals: NpcActivity[]; value: number; holdings: string[]; looted: number } | null = null;
    const end = playUntil(w, 120, (x) => soldCargo(x, raider.id), (x) => {
      const r = vehicle(x, raider.id);
      dropped ||= droppedRaidAfterLoot(x, raider.id);
      expect(huntsAgain(x, raider.id, trader.id)).toBe(false);
      if (!sale && topGoal(r)?.kind === 'sell') {
        sale = { goals: [...r.brain!.goals], value: campValue(r), holdings: holdings(x, [raider.id, trader.id]), looted: goodsOn(x, raider.id, 'electronics') };
      }
    });
    expect(dropped).toBe(true);
    expect(sale).not.toBeNull();
    const { goals, value, looted } = sale!;
    expect(sale!.holdings).toEqual(before);
    expect(looted).toBeGreaterThan(0);
    expect(goals).toEqual([expect.objectContaining({ kind: 'sell', targetId: scrapjaw.id })]);
    const after = getResources(end, vehicle(end, raider.id)).money;
    expect(after).toBeLessThanOrEqual(money + value);
    expect(after).toBeGreaterThan(money + value - fuelBill(end, raider.id));
    expect(goodsOn(end, raider.id, 'electronics')).toBe(0);
  });

  it('sends an outmatched raider off without cargo', () => {
    const { w, raider, trader } = watchingRaider(TERRAIN.vision.radius - 6);
    corePart(raider, 'cab').hp = 1;
    const carried = goodsOn(w, trader.id, 'electronics');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('flee');
    const end = playTurns(w, 10, (x) => {
      expect(goodsOn(x, raider.id, 'electronics')).toBe(0);
      expect(pileGoods(x, 'electronics')).toBe(0);
    });
    expect(goodsOn(end, trader.id, 'electronics')).toBe(carried);
  });

  it('sends a defeated raider home with nothing to sell', () => {
    const { w, raider, trader } = watchingRaider(3);
    raider.lastHitBy = trader.id;
    raider.brain!.attackers[trader.id] = true;
    const carried = goodsOn(w, trader.id, 'electronics');
    const money = getResources(w, raider).money;
    knockOutNpc(w, raider);
    trader.pos = { x: raider.pos.x + 60, y: raider.pos.y };
    const end = playUntil(w, 40, (x) => topGoal(vehicle(x, raider.id))?.kind === 'retreat', (x) => {
      expect(vehicle(x, raider.id).brain!.goals.some((g) => g.kind === 'sell')).toBe(false);
      expect(goodsOn(x, raider.id, 'electronics')).toBe(0);
    });
    expect(topGoal(vehicle(end, raider.id))).toMatchObject({ kind: 'retreat' });
    expect(getResources(end, vehicle(end, raider.id)).money).toBe(money);
    expect(goodsOn(end, trader.id, 'electronics')).toBe(carried);
  });
});
