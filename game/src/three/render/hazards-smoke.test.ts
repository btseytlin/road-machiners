import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAL } from '../../render/palette';
import { emptyWorld } from '../../sim/testkit';
import type { World } from '../../sim/types';
import { cloneWorld } from '../../sim/world';
import type { Card, FxCards } from './particles/cards';
import type { VehicleView } from './vehicle';

const { HazardViews, puffsOf, SHELL } = await import('./hazards');

const MS = 16;

function stubCanvas(): void {
  const ctx = { createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: '' };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}

function recorder(): { cards: FxCards; lit: Card[] } {
  const lit: Card[] = [];
  const cards = { lit: { push: (c: Card) => lit.push({ ...c }) }, glow: { push: () => {} } };
  return { cards: cards as unknown as FxCards, lit };
}

function truckAt(x: number, z: number): VehicleView {
  return { center: () => ({ x, y: 0, z }) } as unknown as VehicleView;
}

function frame(views: InstanceType<typeof HazardViews>, world: World, trucks: Map<string, VehicleView>, nowMs: number): Card[] {
  const { cards, lit } = recorder();
  views.update(world, world.terrain, trucks, nowMs, null, new THREE.PerspectiveCamera());
  views.draw(cards);
  return lit;
}

describe('smoke clouds as cards', () => {
  beforeEach(stubCanvas);
  afterEach(() => vi.unstubAllGlobals());

  it('pushes the placed puffs of a shown cloud as lit cards', () => {
    const world = emptyWorld();
    world.smoke.push({ id: 's1', source: world.vehicles[0].id, pos: { x: 30, y: 30 }, r: 4, turnsLeft: 5 });
    const views = new HazardViews();

    const lit = frame(views, world, new Map(), 5000);

    expect(lit.length).toBeGreaterThan(10);
    expect(lit.length).toBeLessThanOrEqual(puffsOf(world.smoke[0]).length);
    expect(lit.every((c) => c.alpha > 0 && c.size > 0)).toBe(true);
    expect(new Set(lit.map((c) => c.shape)).size).toBeGreaterThan(1);
  });

  it('dissolves a cloud that is no longer shown instead of dropping it at once', () => {
    const world = emptyWorld();
    world.smoke.push({ id: 's1', source: world.vehicles[0].id, pos: { x: 30, y: 30 }, r: 4, turnsLeft: 5 });
    const views = new HazardViews();
    const shown = frame(views, world, new Map(), 5000);
    world.smoke = [];
    const total = (cards: Card[]) => cards.reduce((sum, c) => sum + c.alpha, 0);

    frame(views, world, new Map(), 5016);
    const fading = frame(views, world, new Map(), 5400);

    expect(total(fading)).toBeGreaterThan(0);
    expect(total(fading)).toBeLessThan(total(shown));
    expect(frame(views, world, new Map(), 7000)).toEqual([]);
  });

  it('brings back a dissolving cloud that is shown again', () => {
    const world = emptyWorld();
    const cloud = { id: 's1', source: world.vehicles[0].id, pos: { x: 30, y: 30 }, r: 4, turnsLeft: 5 };
    world.smoke.push(cloud);
    const views = new HazardViews();
    const shown = frame(views, world, new Map(), 5000);
    world.smoke = [];
    frame(views, world, new Map(), 5016);
    frame(views, world, new Map(), 5400);
    world.smoke = [cloud];

    expect(frame(views, world, new Map(), 5416).length).toBe(shown.length);
  });

  it('keeps every cloud together under the smoke card budget', () => {
    const world = emptyWorld();
    const me = world.vehicles[0].id;
    for (let i = 0; i < 40; i++) world.smoke.push({ id: `s${i}`, source: me, pos: { x: 20 + i, y: 30 }, r: 12, turnsLeft: 5 });
    const views = new HazardViews();

    const lit = frame(views, world, new Map(), 5000);

    expect(lit.length).toBeGreaterThan(0);
    expect(lit.length).toBeLessThanOrEqual(800);
  });

  it('flies a shell as a mesh head with a trail of lit cards that fades out after landing', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const before = cloneWorld(world);
    const pos = { x: me.pos.x + 8, y: me.pos.y };
    world.smoke.push({ id: 's1', source: me.id, pos, r: 4, turnsLeft: 5 });
    world.events = [{ t: 'utility', vehicle: me.id, part: 'p1', effect: 'mortar', point: { ...pos } }];
    const views = new HazardViews();
    const camera = new THREE.PerspectiveCamera();
    const clock = { before, progress: 1, moved: true };
    const fly = (nowMs: number) => {
      const { cards, lit } = recorder();
      views.update(world, world.terrain, new Map(), nowMs, clock, camera);
      views.draw(cards);
      return lit;
    };

    fly(1000);
    const trail = new THREE.Color(PAL.shell.trail);
    const trailOf = (cards: Card[]) => cards.filter((c) => c.r === trail.r && c.g === trail.g && c.b === trail.b);
    const mid = trailOf(fly(1000 + SHELL.flightMs / 2));
    const landed = trailOf(fly(1000 + SHELL.flightMs + 100));
    const gone = trailOf(fly(1000 + SHELL.flightMs + 2000));
    const peak = (cards: Card[]) => Math.max(...cards.map((c) => c.alpha));

    expect(mid.length).toBeGreaterThan(2);
    expect(mid.length).toBeLessThanOrEqual(100);
    expect(landed.length).toBeGreaterThan(0);
    expect(peak(landed)).toBeLessThan(peak(mid));
    expect(gone).toEqual([]);
  });

  it('parts the cloud for a driving truck and lets it settle once the clock stops', () => {
    const world = emptyWorld();
    world.smoke.push({ id: 's1', source: world.vehicles[0].id, pos: { x: 30, y: 30 }, r: 4, turnsLeft: 5 });
    const me = world.vehicles[0].id;
    const driven = new HazardViews();
    const calm = new HazardViews();
    const centerX = 30 * 4;
    const centerZ = 30 * 4;
    let lit: Card[] = [];
    let still: Card[] = [];
    for (let i = 0; i <= 80; i++) {
      const trucks = new Map([[me, truckAt(centerX - 12 + i * 0.3, centerZ)]]);
      lit = frame(driven, world, trucks, 5000 + i * MS * 2);
      still = frame(calm, world, new Map(), 5000 + i * MS * 2);
    }
    const moved = lit.filter((c, i) => Math.hypot(c.x - still[i].x, c.z - still[i].z) > 0.5);
    const hold = frame(driven, world, new Map([[me, truckAt(centerX + 12, centerZ)]]), 5000 + 80 * MS * 2);

    expect(lit.length).toBe(still.length);
    expect(moved.length).toBeGreaterThan(3);
    expect(hold.map((c) => [c.x, c.z])).toEqual(lit.map((c) => [c.x, c.z]));
  });
});
