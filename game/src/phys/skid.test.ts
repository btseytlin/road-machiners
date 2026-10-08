import { beforeAll, describe, expect, it } from 'vitest';
import { makeVehicle } from '../sim/factory';
import { addGoods } from '../sim/inventory';
import { editableTerrain, emptyWorld } from '../sim/testkit';
import type { MoveOrder, World } from '../sim/types';
import { angleDiff } from '../sim/vec';
import type { TerrainTypeId } from '../data/terrain';
import { endTurn, setDirect, setMoveOrder } from '../sim/world';
import { PHYSICS } from '../data/physics';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';
import type { VehicleFrame } from './frames';
import { budget } from '../test/budget';

beforeAll(async () => { await initPhysics(); });

// A click relative to the truck, in tiles, or a brake order.
type Click = { dx: number; dy: number } | 'brake';
type Chassis = 'scout' | 'loadedHauler' | 'buggy';
type SkidOpts = { ground: TerrainTypeId; speed: number; clicks: Click[]; chassis?: Chassis; from?: TerrainTypeId };
type Skid = { peakSlip: number; meanSlip: number; maxHeadingOff: number; speeds: number[]; headingAfterBrake: number };

const RAD = 180 / Math.PI;
const AHEAD = 10;
const SIDE = 5;
const FAST = 6;
const SLOW = 2;
const FAST_REVERSAL: Click[] = [{ dx: AHEAD, dy: -SIDE }, { dx: AHEAD, dy: SIDE }, { dx: AHEAD, dy: -SIDE }];
// The same left-right-left at half the reach, so a slow truck holds its pace instead of speeding up toward far clicks.
const SLOW_REVERSAL: Click[] = [{ dx: AHEAD / 2, dy: -SIDE / 2 }, { dx: AHEAD / 2, dy: SIDE / 2 }, { dx: AHEAD / 2, dy: -SIDE / 2 }];
const GRADUAL: Click[] = [{ dx: 12, dy: 2 }, { dx: 12, dy: 2 }, { dx: 12, dy: 2 }];
const STRAIGHT: Click[] = [{ dx: 12, dy: 0 }, { dx: 12, dy: 0 }, { dx: 12, dy: 0 }];
const BRAKE: Click[] = ['brake', 'brake', 'brake', 'brake', 'brake', 'brake'];

// Peak slip of a fast reversal on today's numbers, measured before #314 (on 7d834fce).
const BEFORE = { road: 6.6, hardpan: 6.6, mud: 3.3, glass: 15.2 };

function withChassis(w: World, chassis: Chassis): void {
  if (chassis === 'scout') return;
  const id = chassis === 'buggy' ? 'buggy' : 'hauler';
  const parts = chassis === 'buggy' ? ['mg', 'stockEngine'] : ['mg', 'stockEngine', 'plates', 'trailerBox'];
  const v = makeVehicle(w, { name: id, faction: 'player', chassisId: id, parts: parts.map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {}, pos: { x: 20, y: 60 }, heading: 0, brain: null });
  w.vehicles[0] = { ...v, id: w.vehicles[0].id };
  if (chassis === 'loadedHauler') addGoods(w, w.vehicles[0], 'scrap', 999);
  w.player.fuel = 999;
}

function skidRun(o: SkidOpts): Skid {
  let w: World = emptyWorld({ x: 20, y: 60 });
  const types = editableTerrain(w).types;
  types.fill(o.ground);
  if (o.from) {
    const n = w.terrain.size;
    for (let j = 0; j < n; j++) for (let i = 0; i < 28; i++) types[j * n + i] = o.from;
  }
  withChassis(w, o.chassis ?? 'scout');
  w.vehicles[0].speed = o.speed;
  w = setDirect(w, true);
  let d: Drive = buildDrive(w);
  const frames: VehicleFrame[] = [];
  const speeds: number[] = [];
  let headingAfterBrake = 0;
  let braked = false;
  for (const c of o.clicks) {
    const v = w.vehicles[0];
    if (c === 'brake' && !braked) { braked = true; headingAfterBrake = v.heading; }
    const order: MoveOrder = c === 'brake' ? { kind: 'brake' } : { kind: 'through', dest: { x: v.pos.x + c.dx, y: v.pos.y + c.dy }, pace: o.speed };
    w = setMoveOrder(w, order);
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => { next = r.next; frames.push(...r.frames[w.vehicles[0].id]); }));
    freeDrive(d);
    d = next!;
    speeds.push(w.vehicles[0].speed);
    if (c === 'brake' && speeds.length === o.clicks.indexOf('brake') + 1) headingAfterBrake = angleDiff(headingAfterBrake, w.vehicles[0].heading);
  }
  freeDrive(d);
  const slips: number[] = [];
  let maxHeadingOff = 0;
  frames.slice(1).forEach((f, i) => {
    const [a, b, q] = [frames[i].pos, f.pos, f.rot];
    const nose = Math.atan2(2 * (q.x * q.z - q.w * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    maxHeadingOff = Math.max(maxHeadingOff, Math.abs(angleDiff(0, nose)) * RAD);
    if (Math.hypot(b.x - a.x, b.z - a.z) * PHYSICS.stepsPerSecond < 2) return;
    slips.push(Math.abs(angleDiff(Math.atan2(b.z - a.z, b.x - a.x), nose)) * RAD);
  });
  return {
    peakSlip: Math.max(0, ...slips),
    meanSlip: slips.reduce((s, x) => s + x, 0) / Math.max(1, slips.length),
    maxHeadingOff,
    speeds,
    headingAfterBrake: Math.abs(headingAfterBrake) * RAD,
  };
}

const GROUNDS = ['road', 'hardpan', 'mud', 'glass'] as const;
type Table = Record<(typeof GROUNDS)[number], Skid>;
function onGrounds(clicks: Click[], speed: number, chassis?: Chassis): Table {
  return Object.fromEntries(GROUNDS.map((ground) => [ground, skidRun({ ground, speed, clicks, chassis })])) as Table;
}
const stopTurns = (s: Skid, from: number) => s.speeds.slice(from).findIndex((v) => v < 0.5) + 1;

describe('skids', () => {
  describe('straight driving', () => {
    let fast: Table;
    let slow: Table;
    beforeAll(() => { fast = onGrounds(STRAIGHT, FAST); slow = onGrounds(STRAIGHT, SLOW); }, budget(240_000));

    it('never slides on any ground, at speed or slowly', () => {
      for (const g of GROUNDS) {
        expect(fast[g].peakSlip, `${g} fast`).toBeLessThan(0.5);
        expect(slow[g].peakSlip, `${g} slow`).toBeLessThan(0.5);
      }
    });

    it('stays straight crossing from road onto mud and onto glass', () => {
      expect(skidRun({ ground: 'mud', from: 'road', speed: FAST, clicks: STRAIGHT }).peakSlip).toBeLessThan(1);
      expect(skidRun({ ground: 'glass', from: 'road', speed: FAST, clicks: STRAIGHT }).peakSlip).toBeLessThan(1);
    }, budget(120_000));
  });

  describe('fast reversal', () => {
    let fast: Table;
    let slow: Table;
    let braked: Table;
    beforeAll(() => {
      fast = onGrounds(FAST_REVERSAL, FAST);
      slow = onGrounds(SLOW_REVERSAL, SLOW);
      braked = onGrounds([...FAST_REVERSAL, ...BRAKE], FAST);
      if (process.env.SKID_TABLE) console.log(JSON.stringify({ fast: summary(fast), slow: summary(slow), braked: summary(braked) }));
    }, budget(480_000));

    it('slides more on mud and most on glass', () => {
      expect(fast.road.peakSlip).toBeLessThanOrEqual(fast.hardpan.peakSlip + 0.05);
      expect(fast.hardpan.peakSlip).toBeLessThan(fast.mud.peakSlip);
      expect(fast.mud.peakSlip).toBeLessThan(fast.glass.peakSlip);
      expect(fast.road.peakSlip).toBeGreaterThanOrEqual(BEFORE.road * 1.2);
      expect(fast.mud.peakSlip).toBeGreaterThanOrEqual(BEFORE.mud * 2.5);
      expect(fast.mud.peakSlip).toBeGreaterThanOrEqual(fast.hardpan.peakSlip + 3);
    });

    // Slip measured at the truck's center holds a share that steering alone gives at any speed, so slow steering
    // shows large angles on every ground. What tight low-speed steering means is that the ground barely matters.
    it('steers alike on every ground when slow', () => {
      expect(Math.abs(slow.mud.peakSlip - slow.road.peakSlip)).toBeLessThan(3);
      expect(Math.abs(slow.glass.peakSlip - slow.road.peakSlip)).toBeLessThan(4);
      expect(slow.road.peakSlip).toBeLessThan(20);
      for (const g of GROUNDS) expect(slow[g].maxHeadingOff, g).toBeLessThan(60);
    });

    it('keeps glass slippery as in #112', () => {
      expect(fast.glass.peakSlip).toBeGreaterThanOrEqual(BEFORE.glass);
      expect(fast.glass.peakSlip).toBeLessThanOrEqual(BEFORE.glass * 2);
    });

    it('never spins out, and brakes to a stop upright', () => {
      for (const g of GROUNDS) expect(fast[g].maxHeadingOff, g).toBeLessThan(90);
      for (const g of ['road', 'hardpan', 'mud'] as const) {
        expect(stopTurns(braked[g], FAST_REVERSAL.length), `${g} stop`).toBeLessThanOrEqual(3);
        expect(braked[g].headingAfterBrake, `${g} brake turn`).toBeLessThan(45);
      }
      expect(stopTurns(braked.glass, FAST_REVERSAL.length)).toBeLessThanOrEqual(6);
      expect(stopTurns(braked.glass, FAST_REVERSAL.length)).toBeGreaterThan(0);
    });
  });

  describe('gradual turn', () => {
    it('stays near its line on road and hardpan, and a little looser on mud', () => {
      const t = onGrounds(GRADUAL, FAST);
      expect(t.road.meanSlip).toBeLessThan(1);
      expect(t.hardpan.meanSlip).toBeLessThan(1);
      expect(t.mud.meanSlip).toBeLessThan(3);
    }, budget(240_000));
  });

  describe('other chassis', () => {
    it.each(['loadedHauler', 'buggy'] as const)('a %s slides in a mud reversal and keeps its heading', (chassis) => {
      const slide = skidRun({ ground: 'mud', speed: FAST, clicks: FAST_REVERSAL, chassis });
      const straight = skidRun({ ground: 'mud', speed: FAST, clicks: STRAIGHT, chassis });
      expect(slide.peakSlip).toBeGreaterThan(5);
      expect(slide.peakSlip).toBeGreaterThan(straight.peakSlip);
      expect(slide.maxHeadingOff).toBeLessThan(90);
    }, budget(240_000));
  });

  it('the rear tires keep a share of the side grip', () => {
    const share = (PHYSICS.truck as { rearSideGrip?: number }).rearSideGrip;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(1);
  });
});

function summary(t: Table) {
  return Object.fromEntries(GROUNDS.map((g) => [g, { peak: +t[g].peakSlip.toFixed(1), mean: +t[g].meanSlip.toFixed(1), off: +t[g].maxHeadingOff.toFixed(0), brakeTurn: +t[g].headingAfterBrake.toFixed(0), speeds: t[g].speeds.map((s) => +s.toFixed(1)) }]));
}
