import { describe, expect, it } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { PERK_NUMBERS, SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { WEATHER } from '../data/weather';
import { addVehicle, emptyWorld, practiceOf } from './testkit';
import { contactsOf, soundRange } from './detect';
import { TIME } from '../data/time';
import { sunAt } from './sun';
import { canVehicleSee, exploreFrom, grayRadius, hasLineOfFire, playerVisible, practiceContacts, refreshVision, sightRadius, visibleTiles } from './vision';
import { TEST_MAP } from '../test/map';

describe('vision', () => {
  it('sees an unblocked tile within radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const vis = visibleTiles(w, { x: 30, y: 30 });
    expect(vis.has(31 * w.size + 34)).toBe(true); // tile (34, 31), close and clear
  });

  it('is blocked by an obstacle between the viewer and the tile', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1.2, kind: 'rock' }];
    const from = { x: 30, y: 30 };
    const near = visibleTiles(w, from);
    expect(near.has(30 * w.size + 31)).toBe(true); // in front of the rock, still visible
    expect(near.has(30 * w.size + 36)).toBe(false); // behind the rock, blocked
  });

  it('sees behind a rock within the close radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30.5 }, r: 0.6, kind: 'rock' }];
    const vis = visibleTiles(w, { x: 30, y: 30.5 });
    expect(vis.has(30 * w.size + 32)).toBe(true); // 2.5 tiles away, behind the rock
    expect(vis.has(30 * w.size + 35)).toBe(false); // 5.5 tiles away, behind the rock
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

  // A fence segment is one tile long, so its radius is half a tile.
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

  it('sees over a junk pile lower than the eye', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'junk-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'junk', yaw: 0 }];

    expect(hasLineOfFire(w, { x: 30, y: 30 }, { x: 36.5, y: 30 })).toBe(true);
  });

  // The ruin model at scale 1 (radius 1.2 tiles). Its south corner, model y -3.9 to -2.5 m at model x 3.35 to
  // 4.45 m, is rubble below eye height, and its standing south wall ends at model y -3.52 m. Model y runs to map -y.
  it('sees over the rubble of a ruin but not through its standing wall', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'ruin-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'ruin', yaw: 0 }];
    const line = (modelY: number) => hasLineOfFire(w, { x: 28, y: 30 - modelY / 4 }, { x: 38, y: 30 - modelY / 4 });

    expect(line(-3.7)).toBe(true); // 0.9 tiles from the center, inside its 1.2-tile radius
    expect(line(-3)).toBe(false);
    expect(line(0)).toBe(false);
  });

  it('sees a ruin wall that holds the target', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'ruin-0', pos: { x: 33, y: 30 }, r: 1.2, kind: 'landmark', look: 'ruin', yaw: 0 }];
    const eastWall = { x: 33 + 4 / 4, y: 30 }; // model x 3.5 to 4.5 m

    expect(hasLineOfFire(w, { x: 40, y: 30 }, eastWall)).toBe(true);
    expect(hasLineOfFire(w, { x: 26, y: 30 }, eastWall)).toBe(false);
  });

  it('explores from a point exactly the tiles seen from there, and keeps tiles explored before', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1.2, kind: 'rock' }];
    const from = { x: 30, y: 30 };
    const before = 5 * w.size + 5; // far outside sight
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
    expect(w.player.explored[idx]).toBe(1); // stays explored even though no longer visible
  });
});

describe('terrain line of sight', () => {
  it('a hill between viewer and tile blocks sight', async () => {
    const { heightAt } = await import('./terrain');
    const w = emptyWorld({ x: 30, y: 30 });
    w.terrain = TEST_MAP.terrain;
    const elevationAt = (_seed: number, x: number, y: number) => heightAt(w.terrain, x, y);
    let found: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    // A peak above both eye heights blocks the line between the two sides.
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
    expect(grayRadius(w, { x: 30, y: 30 })).toBe(TERRAIN.vision.radius * TERRAIN.vision.grayFactor);
  });

  it('shrinks gray vision at night with sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    expect(grayRadius(w, { x: 30, y: 30 })).toBe(sightRadius(w, w.vehicles[0], { x: 30, y: 30 }) * TERRAIN.vision.grayFactor);
    expect(grayRadius(w, { x: 30, y: 30 })).toBeLessThan(TERRAIN.vision.radius * TERRAIN.vision.grayFactor);
  });
});

describe('contact practice', () => {
  // Night hides dust, so a moving buggy past sight is heard and nothing else.
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
    const xp = structuredClone(w.player.skills);
    expect(refreshVision(w).map((c) => c.vehicleId)).toEqual([buggy.id]);
    expect([practiceOf(w, 'contact'), w.player.skills]).toEqual([[], xp]);
  });

  it('pays nothing when an NPC hears a truck', () => {
    const { w, buggy } = heardBuggy();
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 60, y: 30 });
    expect(contactsOf(w, trader, Infinity).map((c) => c.vehicleId)).toContain(buggy.id);
    expect(practiceOf(w, 'contact')).toEqual([]);
  });
});

describe('perception sight', () => {
  it('reaches farther for the player at level 5', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const me = w.vehicles[0];
    const base = sightRadius(w, me);
    w.player.skills.perception = XP_TO_REACH[5];
    expect(sightRadius(w, me)).toBeCloseTo(base * (1 + 5 * SKILL_EFFECTS.perception.sight));
  });

  it('shows the player more tiles at level 5', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const base = visibleTiles(w, { x: 60, y: 60 }).size;
    w.player.skills.perception = XP_TO_REACH[5];
    expect(visibleTiles(w, { x: 60, y: 60 }).size).toBeGreaterThan(base);
  });

  it('leaves NPC sight alone', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    const base = sightRadius(w, npc);
    w.player.skills.perception = XP_TO_REACH[5];
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

  // A daylight world with a storm over the player truck and an NPC beside it.
  function stormWorld() {
    const w = emptyWorld({ x: 60, y: 60 });
    w.turn = day();
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 60, y: 60 }, radius: 60, vel: { x: 0, y: 0 }, turnsLeft: 10 }];
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 62, y: 60 });
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
  // An NPC at x=20 looking at the player truck at x=30, with a cloud raised at `pos`.
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
