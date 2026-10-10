import { describe, expect, it } from 'vitest';
import { FURY_ROAD, HIGHWAY } from '../data/modes';
import { NPCS } from '../data/npcs';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { defaultSetup } from './settings';
import { inOverdrive, maxSpeedSteps } from './stats';
import { playerVehicle } from './damage';
import { abandonRun, advanceFuryRoad, canAbandonRun, furyRoadReadout, moveWindow, outpostPad, payOf, planStretch, reachedOutpostAt, runEarnings, spawnGroup, stockSizeOf, waveOf, WINDOW_MOVE } from './fury-road';
import { acrossOf, alongOf, highwayHash, milestoneAt, roadPoint, toRoad, WINDOW_SHIFT } from './highway';
import { topGoal } from './npc-activities';
import { optionWeights, tradeOffers } from './npc-decisions';
import { getResources } from './resources';
import { addState, stateOf } from './states';
import { furyRoadWorld } from './testkit';
import type { FuryRoadRun, Vehicle, WaveGroup, World } from './types';
import { heightAt } from './terrain';
import { endTurn, newWorld } from './world';

function runOf(w: World): FuryRoadRun {
  if (!w.furyRoad) throw new Error('No run');
  return w.furyRoad;
}

function moveTo(w: World, n: number): void {
  const me = playerVehicle(w);
  me.pos = roadPoint(w.seed, runOf(w).window, n, HIGHWAY.road.lanes[1]);
  me.speed = 0;
}

function parkOnNext(w: World): void {
  const me = playerVehicle(w);
  me.pos = outpostPad(w, runOf(w).window + 1);
  me.speed = 0;
  me.order = null;
}

function arrive(w: World): World {
  parkOnNext(w);
  return endTurn(w, still);
}

function groupTrucks(w: World): string[] {
  return runOf(w).groups.flatMap((g) => g.vehicles);
}

const still = () => {};

function group(w: World, i = 0): WaveGroup {
  return runOf(w).groups[i];
}

function quietUntilDue(w: World): void {
  w.turn = runOf(w).quietFrom + FURY_ROAD.pacing.quiet;
}

function spawnFirst(w: World): WaveGroup {
  quietUntilDue(w);
  advanceFuryRoad(w);
  const first = group(w);
  if (!first.spawned) throw new Error('The first group did not spawn');
  return first;
}

function trucksOf(w: World, g: WaveGroup): Vehicle[] {
  return w.vehicles.filter((v) => g.vehicles.includes(v.id));
}

function roadSpot(w: World, v: Vehicle): { along: number; across: number } {
  const at = toRoad(runOf(w).window, v.pos);
  return { along: alongOf(w.seed, at), across: acrossOf(w.seed, at) };
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const STRETCHES = Array.from({ length: 10 }, (_, i) => i + 1);

describe('the Fury Road pool', () => {
  it('names every NPC template, and draws each one over twenty runs', () => {
    const named = new Set(FURY_ROAD.pool.flatMap((tier) => Object.keys(tier.weights)));
    const drawn = new Set(SEEDS.flatMap((seed) => STRETCHES.flatMap((j) => planStretch(seed, j).flatMap((g) => g.templates))));

    expect([...named].sort()).toEqual(Object.keys(NPCS).sort());
    expect(Object.keys(FURY_ROAD.pool[FURY_ROAD.pool.length - 1].weights).sort()).toEqual(Object.keys(NPCS).sort());
    expect([...drawn].sort()).toEqual(Object.keys(NPCS).sort());
  });

  it('sends the group sizes of the wave at its gear level, from the tier of the stretch', () => {
    for (const seed of SEEDS) {
      for (const j of STRETCHES) {
        const groups = planStretch(seed, j);
        const tier = FURY_ROAD.pool.find((t) => j <= t.upTo)!;
        expect(groups.map((g) => g.templates.length)).toEqual(waveOf(j).sizes);
        expect(groups.every((g) => g.level === waveOf(j).level)).toBe(true);
        expect(groups.flatMap((g) => g.templates).every((id) => tier.weights[id] > 0), `seed ${seed} stretch ${j}`).toBe(true);
      }
    }
  });

  it('sends light trucks first and army trucks and convoys only later', () => {
    const early = SEEDS.flatMap((seed) => [1, 2].flatMap((j) => planStretch(seed, j).flatMap((g) => g.templates)));

    expect(early.some((id) => ['gunwagon', 'noseArmy', 'convoy', 'convoyGuard'].includes(id))).toBe(false);
  });
});

describe('the sides a group comes from', () => {
  it('never repeats the side of the group before it', () => {
    const sides = new Set<string>();
    for (const seed of SEEDS) {
      for (const j of STRETCHES) {
        const from = planStretch(seed, j).map((g) => g.from);
        from.forEach((side) => sides.add(side));
        from.slice(1).forEach((side, i) => expect(side, `seed ${seed} stretch ${j}`).not.toBe(from[i]));
      }
    }

    expect([...sides].sort()).toEqual(['ahead', 'behind', 'left', 'right']);
  });

  it('spawns ahead of the player, behind it, or out in the badlands on its side, inside the window', () => {
    for (const from of ['ahead', 'behind', 'left', 'right'] as const) {
      const w = furyRoadWorld();
      moveTo(w, milestoneAt(0) + 120);
      const first = group(w);
      first.from = from;
      first.templates = ['buggy', 'trader', 'merc'];
      const progress = alongOf(w.seed, toRoad(0, playerVehicle(w).pos));

      spawnGroup(w, runOf(w), first, progress);

      expect(first.vehicles).toHaveLength(3);
      for (const v of trucksOf(w, first)) {
        const at = roadSpot(w, v);
        expect(Math.min(v.pos.x, v.pos.y)).toBeGreaterThan(0);
        expect(Math.max(v.pos.x, v.pos.y)).toBeLessThan(w.size);
        if (from === 'ahead') expect(at.along).toBeGreaterThan(progress + 10);
        if (from === 'behind') expect(at.along).toBeLessThan(progress - 10);
        if (from === 'left') expect(at.across).toBeLessThanOrEqual(-18);
        if (from === 'right') expect(at.across).toBeGreaterThanOrEqual(18);
      }
    }
  });
});

describe('the pace of encounters', () => {
  it('holds the first group of a level for twenty quiet turns', () => {
    let w = furyRoadWorld();
    for (let i = 1; i < FURY_ROAD.pacing.quiet; i++) {
      w = endTurn(w, still);
      expect(group(w).spawned, `turn ${w.turn}`).toBe(false);
    }
    w = endTurn(w, still);

    expect(group(w).spawned).toBe(true);
  });

  it('spawns hostile groups that hunt the player', () => {
    const w = furyRoadWorld();
    const first = spawnFirst(w);

    for (const v of trucksOf(w, first)) {
      expect(stateOf(w, 'feud', v.id, w.player.vehicleId)).not.toBeNull();
      expect(topGoal(v)).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
    }
  });

  it('spawns no group while one is near, nor in the twenty turns after it leaves', () => {
    let w = furyRoadWorld(4);
    for (let k = 0; k < 4; k++) w = arrive(w);
    const first = spawnFirst(w);
    const me = playerVehicle(w);
    for (let t = 0; t < 40; t++) {
      for (const v of trucksOf(w, first)) v.pos = { x: me.pos.x + 6, y: me.pos.y };
      w.turn++;
      advanceFuryRoad(w);
      expect(group(w, 1).spawned).toBe(false);
    }
    for (const v of trucksOf(w, first)) v.pos = { x: me.pos.x + FURY_ROAD.pacing.near + 5, y: me.pos.y };
    const lastNear = w.turn;
    while (w.turn < lastNear + FURY_ROAD.pacing.quiet - 1) {
      w.turn++;
      advanceFuryRoad(w);
      expect(group(w, 1).spawned, `turn ${w.turn}`).toBe(false);
    }
    w.turn++;
    advanceFuryRoad(w);

    expect(group(w, 1).spawned).toBe(true);
  });

  it('never puts more than the cap of trucks on the road at once', () => {
    let w = furyRoadWorld();
    for (let k = 0; k < 7; k++) w = arrive(w);
    const run = runOf(w);
    for (const g of run.groups) {
      quietUntilDue(w);
      advanceFuryRoad(w);
      for (const v of trucksOf(w, g)) v.pos = { x: v.pos.x, y: v.pos.y + 2 * FURY_ROAD.pacing.near };
      run.quietFrom = -FURY_ROAD.pacing.quiet;
    }
    const late = { ...run.groups[0], id: 'late', spawned: false, vehicles: [], engaged: [], templates: ['buggy'] };
    run.groups.push(late);

    advanceFuryRoad(w);

    expect(groupTrucks(w).length).toBe(FURY_ROAD.maxAlive);
    expect(late.spawned).toBe(false);
  });

  it('keeps a group hunting a player it meets long after it spawns', () => {
    let w = furyRoadWorld();
    spawnFirst(w);
    for (let i = 0; i < 15; i++) w = endTurn(w, still);

    for (const v of trucksOf(w, group(w))) {
      expect(stateOf(w, 'feud', v.id, w.player.vehicleId)).not.toBeNull();
      expect(topGoal(v)?.kind).toBe('fight');
    }
  });
});

describe('a group racing in', () => {
  it('overdrives until it engages the player, and never again after', () => {
    const w = furyRoadWorld();
    const first = spawnFirst(w);
    const [v] = trucksOf(w, first);
    const me = playerVehicle(w);

    expect(inOverdrive(w, v)).toBe(true);
    expect(maxSpeedSteps(w, v).map((s) => s.kind)).toContain('overdrive');

    v.pos = { x: me.pos.x + FURY_ROAD.catchUp.engageAt - 1, y: me.pos.y };
    w.turn++;
    advanceFuryRoad(w);
    expect(first.engaged).toEqual([v.id]);
    expect(inOverdrive(w, v)).toBe(false);

    v.pos = { x: me.pos.x, y: me.pos.y - 100 };
    w.turn++;
    advanceFuryRoad(w);
    expect(inOverdrive(w, v)).toBe(false);
    expect(maxSpeedSteps(w, v).map((s) => s.kind)).not.toContain('overdrive');
  });

  it('engages at any distance once in combat with the player', () => {
    const w = furyRoadWorld();
    const first = spawnFirst(w);
    const [v] = trucksOf(w, first);
    addState(w, 'combat', v.id, w.player.vehicleId, { kind: 'none' });

    advanceFuryRoad(w);

    expect(first.engaged).toEqual([v.id]);
  });

  it('leaves the overdrive of the player to its switch, and no Roaming truck overdrives', () => {
    const w = furyRoadWorld();
    const me = playerVehicle(w);
    w.player.overdrive = false;
    expect(inOverdrive(w, me)).toBe(false);
    w.player.overdrive = true;
    expect(inOverdrive(w, me)).toBe(true);

    const roaming = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    expect(roaming.vehicles.filter((v) => v.id !== roaming.player.vehicleId).some((v) => inOverdrive(roaming, v))).toBe(false);
  });
});

describe('arriving at an outpost', () => {
  it('pays once, moves the window north and keeps the player on the same pad and ground', () => {
    const w = furyRoadWorld();
    const money = w.player.money;
    parkOnNext(w);
    const before = playerVehicle(w).pos;
    const ground = w.terrain.types[Math.floor(before.y) * w.size + Math.floor(before.x)];

    const after = endTurn(w, still);
    const me = playerVehicle(after);

    expect(runOf(after).window).toBe(1);
    expect(after.mapHash).toBe(highwayHash(w.seed, 1));
    expect(after.player.money).toBe(money + payOf(1, 0));
    expect(after.events).toContainEqual({ t: 'outpostReached', milestone: 1, pay: payOf(1, 0), wrecks: 0 });
    expect(me.pos).toEqual({ x: before.x + WINDOW_SHIFT.x, y: before.y + WINDOW_SHIFT.y });
    expect(after.terrain.types[Math.floor(me.pos.y) * after.size + Math.floor(me.pos.x)]).toBe(ground);
    expect(runOf(after).outposts.map((o) => [o.milestone, o.paid])).toEqual([[1, true], [2, false]]);
    expect(runOf(after).groups.every((g) => g.stretch === 2)).toBe(true);
    expect(reachedOutpostAt(after)?.id).toBe('outpost-1');
  });

  it('shifts the player, the ground under it and the explored overlap one stride north', () => {
    const w = furyRoadWorld();
    parkOnNext(w);
    const before = playerVehicle(w).pos;
    w.player.explored[95 * w.size + 5] = 1;

    const after = endTurn(w, still);
    const me = playerVehicle(after);
    const shifted = (95 + WINDOW_SHIFT.y) * after.size + 5 + WINDOW_SHIFT.x;

    expect(heightAt(after.terrain, me.pos.x, me.pos.y)).toBeCloseTo(heightAt(w.terrain, before.x, before.y), 9);
    expect(after.player.explored[shifted]).toBe(1);
    expect(after.vehicles.every((v) => v.pos.x > 0 && v.pos.y > 0 && v.pos.x < after.size && v.pos.y < after.size)).toBe(true);
  });

  it('pays nothing more on the next turns or after moving off and back', () => {
    let w = arrive(furyRoadWorld());
    const money = w.player.money;
    w = endTurn(w, still);
    moveTo(w, milestoneAt(1) + 20);
    w = endTurn(w, still);
    playerVehicle(w).pos = outpostPad(w, 1);
    w = endTurn(w, still);

    expect(w.player.money).toBe(money);
    expect(runOf(w).window).toBe(1);
  });

  it('does not complete on the move, off the pad or in combat', () => {
    const moving = furyRoadWorld();
    parkOnNext(moving);
    playerVehicle(moving).speed = 2;
    const off = furyRoadWorld();
    moveTo(off, milestoneAt(1) - 20);
    const fighting = furyRoadWorld();
    parkOnNext(fighting);
    const foe = { ...playerVehicle(fighting), id: 'v-foe' };
    fighting.vehicles.push(foe);
    addState(fighting, 'combat', foe.id, fighting.player.vehicleId, { kind: 'none' });

    for (const w of [moving, off, fighting]) advanceFuryRoad(w);

    expect([moving, off, fighting].map((w) => runOf(w).window)).toEqual([0, 0, 0]);
  });

  it('pays the base and a bonus for each wreck of the stretch, and keeps the run totals', () => {
    const w = furyRoadWorld();
    runOf(w).groups[0].wrecked = 2;
    const money = w.player.money;

    const after = arrive(w);

    expect(after.player.money).toBe(money + payOf(1, 2));
    expect(runOf(after).earned).toBe(payOf(1, 2));
    expect(runOf(after).wrecks).toBe(2);
    expect(runEarnings(after)).toMatchObject({ pay: payOf(1, 2), wrecks: 2, reached: 1 });
  });

  it('counts a wreck of a group truck toward the stretch', () => {
    const w = furyRoadWorld();
    const group = spawnFirst(w);
    w.events = [{ t: 'destroyed', vehicle: group.vehicles[0], by: w.player.vehicleId }];

    advanceFuryRoad(w);

    expect(group.wrecked).toBe(1);
  });

  it('removes the trucks of a finished stretch and awards no XP for it', () => {
    const w = furyRoadWorld();
    const group = spawnFirst(w);
    for (const v of w.vehicles) if (group.vehicles.includes(v.id)) v.pos = { x: v.pos.x + 100, y: v.pos.y };
    w.states = w.states.filter((s) => s.kind !== 'combat');
    const passing = structuredClone(w);
    moveTo(passing, milestoneAt(1) - 10);

    const after = arrive(w);
    const passed = endTurn(passing, still);

    expect(after.vehicles.map((v) => v.id)).toEqual([after.player.vehicleId]);
    expect(passed.vehicles.some((v) => group.vehicles.includes(v.id))).toBe(true);
    expect(after.player.xp).toBe(passed.player.xp);
  });

  it('refuses to move the window with a group truck alive or the player off the pad', () => {
    const off = furyRoadWorld();
    expect(() => moveWindow(off)).toThrow(/parked/);

    const alive = furyRoadWorld();
    spawnFirst(alive);
    parkOnNext(alive);
    expect(() => moveWindow(alive)).toThrow(/alive/);
  });

  it('discovers the outpost fort as any site, with its line and its XP', () => {
    const w = furyRoadWorld();
    parkOnNext(w);
    const xp = w.player.xp;

    const after = endTurn(w, still);

    expect(after.player.discovered).toContain('outpost-1');
    expect(after.events).toContainEqual({ t: 'discover', location: 'outpost-1' });
    expect(after.player.xp).toBeGreaterThan(xp);
  });

  it('names a move for every world field', () => {
    expect(Object.keys(WINDOW_MOVE).sort()).toEqual(Object.keys(furyRoadWorld()).sort());
  });
});

describe('the endless run', () => {
  it('stays bounded over thirty stretches', () => {
    let w = furyRoadWorld();
    const sizes: number[] = [];
    for (let k = 0; k < 30; k++) {
      w = arrive(w);
      sizes.push(JSON.stringify({ ...w, terrain: null, player: { ...w.player, explored: null } }).length);
    }

    expect(runOf(w).window).toBe(30);
    expect(w.size).toBe(HIGHWAY.size);
    expect(runOf(w).outposts).toHaveLength(2);
    expect(runOf(w).groups).toHaveLength(waveOf(32).sizes.length);
    expect(w.vehicles).toHaveLength(1);
    expect(w.obstacles.every((o) => o.pos.x >= 0 && o.pos.y >= 0 && o.pos.x <= w.size && o.pos.y <= w.size)).toBe(true);
    expect(Math.max(...sizes.slice(10))).toBeLessThan(Math.max(...sizes.slice(0, 10)) * 1.5);
  });

  it('escalates for eight stretches and then holds at the hardest row and the pay caps', () => {
    expect(waveOf(9)).toBe(waveOf(8));
    expect(waveOf(40)).toBe(FURY_ROAD.waves[FURY_ROAD.waves.length - 1]);
    expect(payOf(1, 0)).toBe(FURY_ROAD.pay.base.first);
    expect(payOf(2, 1)).toBe(FURY_ROAD.pay.base.first + FURY_ROAD.pay.base.step + FURY_ROAD.pay.perWreck.first + FURY_ROAD.pay.perWreck.step);
    expect(payOf(100, 0)).toBe(FURY_ROAD.pay.base.max);
    expect(payOf(100, 1) - payOf(100, 0)).toBe(FURY_ROAD.pay.perWreck.max);
    expect(stockSizeOf(1)).toBe(2);
    expect(stockSizeOf(100)).toBe(FURY_ROAD.stock.max);
    expect(() => waveOf(0)).toThrow(/no wave/);
  });

  it('reads the stretch and the distance to the next outpost, with no total', () => {
    const w = furyRoadWorld();
    moveTo(w, milestoneAt(1) - 50);

    const readout = furyRoadReadout(w)!;

    expect(readout).toMatchObject({ stretch: 1, outpostId: 'outpost-1' });
    expect(readout.toOutpost).toBeCloseTo(50, 0);
  });
});

describe('a Fury Road world on the highway', () => {
  it('shows no Icarus place in three hundred turns of the run', () => {
    let w = furyRoadWorld(5);
    const ids = w.obstacles.map((o) => o.id);
    for (let i = 0; i < 300 && w.player.state === 'active'; i++) {
      const me = playerVehicle(w);
      if (me.order === null) me.order = { kind: 'stopAt', dest: outpostPad(w, runOf(w).window + 1) };
      w = endTurn(w, still);
    }

    expect(ids.some((id) => /^(site|pond|cw)-/.test(id))).toBe(false);
    expect(w.player.discovered.every((id) => /^outpost-\d+$/.test(id))).toBe(true);
    expect(w.salvage).toEqual([]);
  }, 120_000);
});

describe('ending a Fury Road run', () => {
  it('lets only a stranded truck end the run', () => {
    const w = furyRoadWorld();

    expect(canAbandonRun(w)).toBe(false);
    expect(() => abandonRun(w)).toThrow(/stranded/);

    w.player.fuel = 0;
    const ended = abandonRun(w);

    expect(ended.player.state).toBe('dead');
    expect(ended.events).toEqual([{ t: 'runLost', stretch: 1, cause: 'abandoned' }]);
  });

  it('runs no more turns once the run is lost', () => {
    const w = furyRoadWorld();
    w.player.fuel = 0;
    const ended = abandonRun(w);

    expect(() => endTurn(ended, still)).toThrow(/dead/);
  });
});

describe('a Fury Road group truck between fights', () => {
  it('weighs its idle options with no shops in the world, and finds no trade', () => {
    const w = furyRoadWorld();
    const group = spawnFirst(w);
    const npc = w.vehicles.find((v) => v.id === group.vehicles[0])!;
    getResources(w, npc).money = 5000;

    expect(tradeOffers(w, npc)).toEqual([]);
    expect(() => optionWeights(w, npc, 'idle', null, null)).not.toThrow();
  });
});
