import { describe, expect, it } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { PHYSICS } from '../data/physics';
import { hulkBoxes } from './body';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { WEATHER } from '../data/weather';
import { addVehicle, emptyWorld, practiceOf, settleStorms } from './testkit';
import { contactsOf, soundRange } from './detect';
import { TIME } from '../data/time';
import { sunAt } from './sun';
import { canVehicleSee, exploreFrom, grayRadius, hasLineOfFire, playerVisible, practiceContacts, refreshVision, sightRadius, visibleTiles } from './vision';
import { TEST_MAP } from '../test/map';
import { START_KITS } from '../data/start';
import { DECKS, deckAt } from './bridge';
import type { World } from './types';
import type { Vec } from './vec';
import { newWorld } from './world';
import { defaultSetup } from './settings';
import { ICARUS_DECKS } from './bridge';

describe('vision', () => {
  it('sees an unblocked tile within radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const vis = visibleTiles(w, { x: 30, y: 30 });
    expect(vis.has(31 * w.size + 34)).toBe(true);
  });

  it('is blocked by an obstacle between the viewer and the tile', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1.2, kind: 'rock' }];
    const from = { x: 30, y: 30 };
    const near = visibleTiles(w, from);
    expect(near.has(30 * w.size + 31)).toBe(true);
    expect(near.has(30 * w.size + 36)).toBe(false);
  });

  it('sees behind a rock within the close radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30.5 }, r: 0.6, kind: 'rock' }];
    const vis = visibleTiles(w, { x: 30, y: 30.5 });
    expect(vis.has(30 * w.size + 32)).toBe(true);
    expect(vis.has(30 * w.size + 35)).toBe(false);
  });

  it('lets an NPC see a vehicle behind a rock within the close radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30 }, r: 0.6, kind: 'rock' }];
    const npc = { ...w.vehicles[0], id: 'npc', pos: { x: 30, y: 30 } };
    expect(canVehicleSee(w, npc, { x: 32.5, y: 30 })).toBe(true);
    expect(canVehicleSee(w, npc, { x: 35.5, y: 30 })).toBe(false);
  });

  it('does not block sight past water', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'pond', pos: { x: 33, y: 30 }, r: 1.2, kind: 'water' }];
    const vis = visibleTiles(w, { x: 30, y: 30 });
    expect(vis.has(30 * w.size + 36)).toBe(true);
  });

  it('sees over a fence but not past a shack', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const from = { x: 30, y: 30 };
    w.obstacles = [{ id: 'fence-0', pos: { x: 33, y: 30 }, r: 0.5, kind: 'landmark', look: 'fence', yaw: Math.PI / 2 }];
    const pastFence = visibleTiles(w, from).has(30 * w.size + 36);
    w.obstacles = [{ id: 'shack-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'shack', yaw: 0 }];
    const pastShack = visibleTiles(w, from).has(30 * w.size + 36);

    expect(pastFence).toBe(true);
    expect(pastShack).toBe(false);
  });

  it('lets an NPC see and a gun fire over a fence', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'fence-0', pos: { x: 33, y: 30 }, r: 0.5, kind: 'landmark', look: 'fence', yaw: Math.PI / 2 }];
    const npc = { ...w.vehicles[0], id: 'npc', pos: { x: 30, y: 30 } };

    expect(canVehicleSee(w, npc, { x: 36.5, y: 30 })).toBe(true);
    expect(hasLineOfFire(w, { x: 30, y: 30 }, { x: 36.5, y: 30 })).toBe(true);
  });

  it('is blocked by a kill wreck hulk only where its chassis reaches eye height', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const eye = TERRAIN.vision.eyeHeight * PHYSICS.metersPerTile;
    const line = (chassisId: string) => {
      w.obstacles = [{ id: 'wreck-npc7', pos: { x: 33, y: 30 }, r: 0.9, kind: 'wreck', hulk: { chassisId, yaw: Math.PI / 2 } }];
      return hasLineOfFire(w, { x: 30, y: 30 }, { x: 36.5, y: 30 });
    };
    const reachesEye = (chassisId: string) => hulkBoxes(chassisId).some((b) => b.z0 <= eye && b.z1 >= eye && b.x0 <= 0 && b.x1 >= 0);

    expect(reachesEye('tractor')).toBe(true);
    expect(reachesEye('buggy')).toBe(false);
    expect(line('tractor')).toBe(false);
    expect(line('buggy')).toBe(true);
  });

  it('sees over a junk pile lower than the eye', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'junk-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'junk', yaw: 0 }];

    expect(hasLineOfFire(w, { x: 30, y: 30 }, { x: 36.5, y: 30 })).toBe(true);
  });

  it('sees over the rubble of a ruin but not through its standing wall', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'ruin-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'ruin', yaw: 0 }];
    const line = (modelY: number) => hasLineOfFire(w, { x: 28, y: 30 - modelY / 4 }, { x: 38, y: 30 - modelY / 4 });

    expect(line(-3.7)).toBe(true);
    expect(line(-3)).toBe(false);
    expect(line(0)).toBe(false);
  });

  it('sees a ruin wall that holds the target', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'ruin-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'ruin', yaw: 0 }];
    const eastWall = { x: 33 + 4 / 4, y: 30 };

    expect(hasLineOfFire(w, { x: 40, y: 30 }, eastWall)).toBe(true);
    expect(hasLineOfFire(w, { x: 26, y: 30 }, eastWall)).toBe(false);
  });

  it('explores from a point exactly the tiles seen from there, and keeps tiles explored before', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1.2, kind: 'rock' }];
    const from = { x: 30, y: 30 };
    const before = 5 * w.size + 5;
    w.player.explored.fill(0);
    w.player.explored[before] = 1;
    exploreFrom(w, from);
    const expected = new Set([...visibleTiles(w, from), before]);
    const marked = new Set([...w.player.explored.keys()].filter((i) => w.player.explored[i] === 1));
    expect(marked).toEqual(expected);
  });

  it('respects the vision radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const vis = visibleTiles(w, { x: 30, y: 30 });
    const far = 30 + TERRAIN.vision.radius + 3;
    expect(vis.has(30 * w.size + far)).toBe(false);
  });

  it('keeps explored tiles marked after the player drives away', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    refreshVision(w);
    const idx = 30 * w.size + 30;
    expect(w.player.explored[idx]).toBe(1);
    w.vehicles.find((v) => v.id === w.player.vehicleId)!.pos = { x: 55, y: 55 };
    refreshVision(w);
    expect(playerVisible(w).has(idx)).toBe(false);
    expect(w.player.explored[idx]).toBe(1);
  });
});

describe('terrain line of sight', () => {
  it('a hill between viewer and tile blocks sight', async () => {
    const { heightAt } = await import('./terrain');
    const w = emptyWorld({ x: 30, y: 30 });
    w.terrain = TEST_MAP.terrain;
    const elevationAt = (_seed: number, x: number, y: number) => heightAt(w.terrain, x, y);
    let found: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    for (let x = 6; x < w.size - 6 && !found; x++) {
      for (let y = 2; y < w.size - 2 && !found; y++) {
        const peak = elevationAt(w.seed, x, y);
        const a = { x: x - 4, y }, b = { x: x + 4, y };
        if (peak - Math.max(elevationAt(w.seed, a.x, a.y), elevationAt(w.seed, b.x, b.y)) > TERRAIN.vision.eyeHeight) found = { a, b };
      }
    }
    expect(found, 'no hill found for this seed').not.toBeNull();
    w.obstacles = [];
    const vis = visibleTiles(w, found!.a);
    expect(vis.has(Math.floor(found!.b.y) * w.size + Math.floor(found!.b.x))).toBe(false);
  });

  it('reaches gray vision a fixed number of sight radii out', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;
    expect(grayRadius(w)).toBe(TERRAIN.vision.radius * TERRAIN.vision.grayFactor);
  });

  it('shrinks gray vision at night with sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    expect(grayRadius(w)).toBe(sightRadius(w, w.vehicles[0]) * TERRAIN.vision.grayFactor);
    expect(grayRadius(w)).toBeLessThan(TERRAIN.vision.radius * TERRAIN.vision.grayFactor);
  });
});

describe('contact practice', () => {
  function heardBuggy() {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 45, y: 30 });
    buggy.speed = 6;
    return { w, buggy };
  }

  it('pays the player once for a newly heard truck, harder near the edge of hearing', () => {
    const { w, buggy } = heardBuggy();
    practiceContacts(w, refreshVision(w));
    const [event] = practiceOf(w, 'contact');
    expect(event.amount).toBe(1);
    expect(event.difficulty).toBeCloseTo(15 / soundRange(w, buggy));
    practiceContacts(w, refreshVision(w));
    expect(practiceOf(w, 'contact')).toHaveLength(1);
  });

  it('pays nothing for a truck in sight', () => {
    const { w, buggy } = heardBuggy();
    buggy.pos = { x: 34, y: 30 };
    practiceContacts(w, refreshVision(w));
    expect(practiceOf(w, 'contact')).toEqual([]);
  });

  it('rebuilds the view without paying, so a load awards nothing', () => {
    const { w, buggy } = heardBuggy();
    const xp = w.player.xp;
    expect(refreshVision(w).map((c) => c.vehicleId)).toEqual([buggy.id]);
    expect([practiceOf(w, 'contact'), w.player.xp]).toEqual([[], xp]);
  });

  it('pays nothing when an NPC hears a truck', () => {
    const { w, buggy } = heardBuggy();
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 60, y: 30 });
    expect(contactsOf(w, trader, Infinity).map((c) => c.vehicleId)).toContain(buggy.id);
    expect(practiceOf(w, 'contact')).toEqual([]);
  });
});

describe('perception sight', () => {
  it('reaches farther for the player at rank 5', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const me = w.vehicles[0];
    const base = sightRadius(w, me);
    w.player.ranks.perception = 5;
    expect(sightRadius(w, me)).toBeCloseTo(base * (1 + 5 * SKILL_EFFECTS.perception.sight));
  });

  it('shows the player more tiles at rank 5', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const base = visibleTiles(w, { x: 60, y: 60 }).size;
    w.player.ranks.perception = 5;
    expect(visibleTiles(w, { x: 60, y: 60 }).size).toBeGreaterThan(base);
  });

  it('leaves NPC sight alone', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    const base = sightRadius(w, npc);
    w.player.ranks.perception = 5;
    expect(sightRadius(w, npc)).toBe(base);
  });
});


describe('the night eyes perk', () => {
  const night = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;

  it('keeps the player full sight at night', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const me = w.vehicles[0];
    w.turn = night();
    expect(sightRadius(w, me)).toBeCloseTo(TERRAIN.vision.radius * TIME.nightSight);
    w.player.perks.push('nightEyes');
    expect(sightRadius(w, me)).toBeCloseTo(TERRAIN.vision.radius);
  });

  it('leaves NPC sight halved at night', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    w.turn = night();
    w.player.perks.push('nightEyes');
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    expect(sightRadius(w, npc)).toBeCloseTo(TERRAIN.vision.radius * TIME.nightSight);
  });
});

describe('the storm rider perk', () => {
  const day = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;

  function stormWorld() {
    const w = emptyWorld({ x: 60, y: 60 });
    w.turn = day();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 60, y: 60 }, radius: 60, vel: { x: 0, y: 0 }, turnsLeft: 100, born: w.turn - 100 }];
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 62, y: 60 });
    settleStorms(w);
    return { w, me: w.vehicles[0], npc };
  }

  it('keeps the player full sight in a storm', () => {
    const { w, me } = stormWorld();
    expect(sightRadius(w, me)).toBeCloseTo(TERRAIN.vision.radius * WEATHER.sim.effects.storm.sight);
    w.player.perks.push('stormRider');
    expect(sightRadius(w, me)).toBeCloseTo(TERRAIN.vision.radius);
  });

  it('leaves NPC sight cut in a storm', () => {
    const { w, npc } = stormWorld();
    w.player.perks.push('stormRider');
    expect(sightRadius(w, npc)).toBeCloseTo(TERRAIN.vision.radius * WEATHER.sim.effects.storm.sight);
  });
});

describe('a dust screen', () => {
  function screenWorld(pos: { x: number; y: number }, screen: boolean) {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 20, y: 30 });
    const me = w.vehicles[0];
    w.dustClouds = [{ id: 'dust', source: me.id, pos, vel: { x: 0, y: 0 }, age: 0, range: 50, ...(screen ? { screen: true as const } : {}) }];
    refreshVision(w);
    return { w, npc, me };
  }

  it('hides the player from an NPC behind it', () => {
    const { w, npc, me } = screenWorld({ x: 26, y: 30 + PERK_NUMBERS.dustScreen.radius * 0.9 }, true);
    expect(canVehicleSee(w, npc, me.pos)).toBe(false);
  });

  it('hides nothing as a plain cloud', () => {
    const { w, npc, me } = screenWorld({ x: 26, y: 30 }, false);
    expect(canVehicleSee(w, npc, me.pos)).toBe(true);
  });

  it('hides nothing off the sight line', () => {
    const { w, npc, me } = screenWorld({ x: 26, y: 30 + PERK_NUMBERS.dustScreen.radius * 1.1 }, true);
    expect(canVehicleSee(w, npc, me.pos)).toBe(true);
  });

  it('hides nothing beyond the target', () => {
    const { w, npc, me } = screenWorld({ x: 32, y: 30 }, true);
    expect(canVehicleSee(w, npc, me.pos)).toBe(true);
  });

  it('never blocks the player sight', () => {
    const { w, npc, me } = screenWorld({ x: 26, y: 30 }, true);
    expect(canVehicleSee(w, me, npc.pos)).toBe(true);
  });

  it('leaves the line of fire open', () => {
    const { w, npc, me } = screenWorld({ x: 26, y: 30 }, true);
    expect(hasLineOfFire(w, npc.pos, me.pos)).toBe(true);
  });
});

describe('sight from the wing', () => {
  const span = DECKS.find((d) => d.id === 'fallen-sun-wing')!;
  const [top, end] = [span.stations[1].at, span.stations[2].at];
  const mid = { x: (top.x + end.x) / 2, y: (top.y + end.y) / 2 };
  const across = { x: -span.axis.y, y: span.axis.x };
  const at = (p: Vec, along: number, side: number): Vec => ({ x: p.x + span.axis.x * along + across.x * side, y: p.y + span.axis.y * along + across.y * side });

  function wingWorld(): World {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    w.vehicles[0].pos = at(mid, 0, -5);
    return w;
  }
  const viewer = (w: World, pos: Vec) => addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], pos);

  it('sees a truck 15 tiles out on the furrow bank over a hull plate that hides it from the ground', () => {
    const w = wingWorld();
    const target = at(mid, 0, 15);
    const onSpan = viewer(w, mid);
    const onGround = viewer(w, at(mid, 0, 8));
    expect(deckAt(ICARUS_DECKS, onSpan.pos.x, onSpan.pos.y)?.deck.id).toBe(span.id);
    expect(deckAt(ICARUS_DECKS, onGround.pos.x, onGround.pos.y)).toBeNull();
    expect(canVehicleSee(w, onGround, target)).toBe(true);

    w.obstacles.push({ id: 'plate', pos: at(mid, 0, 11), r: 1.3, kind: 'landmark', look: 'hullChunk', yaw: 0 });

    expect(canVehicleSee(w, onGround, target)).toBe(false);
    expect(canVehicleSee(w, onSpan, target)).toBe(true);
  });

  it('sees and fires along the span over the piers under it', () => {
    const w = wingWorld();
    const piers = w.obstacles.filter((o) => o.kind === 'landmark' && o.look === 'hullDrum' && deckAt(ICARUS_DECKS, o.pos.x, o.pos.y)?.deck.id === span.id);
    expect(piers).toHaveLength(2);
    const from = at(top, 1, 0);
    const to = at(from, 15, 0);
    expect(deckAt(ICARUS_DECKS, to.x, to.y)?.deck.id).toBe(span.id);

    expect(canVehicleSee(w, viewer(w, from), to)).toBe(true);
    expect(hasLineOfFire(w, from, to)).toBe(true);
  });
});
