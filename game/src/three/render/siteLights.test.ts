import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sunAt } from '../../sim/sun';
import { groundHits, SITE_LIGHT_FADE_S, SITE_LIGHT_POOL, SITE_SHADOW_SLOTS, siteLightOrder, SiteLights, LOOKS, type SiteLight } from './siteLights';

const light = (id: string, x: number, siteId = 'a'): SiteLight => ({ id, siteId, kind: 'flood', at: { x, y: 8, z: 0 }, aim: { x, y: 0, z: -5 }, ground: 0 });
const all = () => true;
const FOCUS = { x: 0, y: 0, z: 0 };

function turnWhere(night: boolean, from = 1): number {
  for (let t = from; t < from + 500; t++) if (!sunAt(t) === night) return t;
  throw new Error('no such turn');
}
const NIGHT = turnWhere(true);
const DAY = turnWhere(false);
function lateNight(): number {
  let t = NIGHT;
  while (!sunAt(t + 3)) t++;
  return t + 1 >= NIGHT ? t : NIGHT;
}

function setup(lights: SiteLight[]) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 1000);
  camera.position.set(0, 50, 50);
  camera.lookAt(0, 0, 0);
  return { scene, camera, pool: new SiteLights(scene, { lights, lamps: [] }, { worldSize: 8, maxTextureSize: 64 }) };
}
const spotsIn = (scene: THREE.Scene) => scene.children.filter((c) => c instanceof THREE.SpotLight);

describe('siteLightOrder', () => {
  it('puts lights in view first, then the nearest, then by id', () => {
    const lights = [light('d', 30), light('c', 1), light('b', 1), light('a', 50)];
    const order = siteLightOrder(lights, (l) => l.id !== 'a', all, FOCUS).map((l) => l.id);
    expect(order).toEqual(['b', 'c', 'd', 'a']);
  });

  it('drops lights outside gray vision', () => {
    const order = siteLightOrder([light('a', 1), light('b', 2)], all, (p) => p.x < 1.5, FOCUS);
    expect(order.map((l) => l.id)).toEqual(['a']);
  });
});

describe('SiteLights', () => {
  const many = Array.from({ length: SITE_LIGHT_POOL + 5 }, (_, i) => light(`l${i}`, i));

  it('holds no light by day and casts shadows only from its shadow slots at night', () => {
    const { scene, camera, pool } = setup(many);
    pool.sync(false, DAY, camera, all, FOCUS, 0);
    expect(spotsIn(scene)).toHaveLength(0);
    pool.sync(true, NIGHT, camera, all, FOCUS, 100);
    expect(spotsIn(scene)).toHaveLength(SITE_LIGHT_POOL);
    expect(spots(pool).map((s) => s.castShadow)).toEqual(Array.from({ length: SITE_LIGHT_POOL }, (_, i) => i < SITE_SHADOW_SLOTS));
    expect(spots(pool).filter((s) => s.castShadow).every((s) => s.shadow.needsUpdate)).toBe(true);
  });

  it('ramps its night level up over the fade time at night and back down by day', () => {
    const { camera, pool } = setup(many);
    let now = 0;
    for (; now <= SITE_LIGHT_FADE_S * 1000; now += 100) pool.sync(true, NIGHT, camera, all, FOCUS, now);
    expect(pool.nightLevel).toBeCloseTo(1);
    for (let i = 1; i <= SITE_LIGHT_FADE_S * 10; i++) pool.sync(false, DAY, camera, all, FOCUS, now + i * 100);
    expect(pool.nightLevel).toBeCloseTo(0);
  });

  it('adds the pool at the night flip, removes it at dawn and changes nothing in between', () => {
    const { scene, camera, pool } = setup(many);
    pool.sync(true, NIGHT, camera, all, FOCUS, 0);
    const first = spotsIn(scene);
    for (let i = 1; i <= 5; i++) pool.sync(true, NIGHT, camera, all, { x: i * 3, y: 0, z: 0 }, i * 100);
    expect(spotsIn(scene)).toEqual(first);
    pool.sync(false, DAY, camera, all, FOCUS, 1000);
    expect(spotsIn(scene)).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });

  it('never drives more than the pool, even with few lights', () => {
    const { camera, pool, scene } = setup([light('only', 0)]);
    pool.sync(true, NIGHT, camera, all, FOCUS, 0);
    expect(spotsIn(scene)).toHaveLength(SITE_LIGHT_POOL);
    expect(spots(pool).filter((s) => s.intensity > 0)).toHaveLength(0);
  });

  it('fades in within the fade time and out when the lamps go off', () => {
    const { camera, pool } = setup([light('only', 0)]);
    const t = lateNight();
    let now = 0;
    pool.sync(true, t, camera, all, FOCUS, now);
    for (; now <= SITE_LIGHT_FADE_S * 1000 + 100; now += 100) pool.sync(true, t, camera, all, FOCUS, now);
    expect(plain(pool).intensity).toBeCloseTo(LOOKS.flood.intensity);
    const dayTurn = DAY;
    for (let i = 0; i <= SITE_LIGHT_FADE_S * 10 + 2; i++) pool.sync(true, dayTurn, camera, all, FOCUS, now + i * 100);
    expect(plain(pool).intensity).toBe(0);
  });

  it('restarts a light handed to a new anchor from zero', () => {
    const { camera, pool } = setup([light('a', 0), light('b', 40)]);
    const t = lateNight();
    let now = 0;
    pool.sync(true, t, camera, all, FOCUS, now);
    for (; now <= 2000; now += 100) pool.sync(true, t, camera, all, FOCUS, now);
    expect(plain(pool).intensity).toBeGreaterThan(0);
    pool.sync(true, t, camera, (p) => p.x > 20, FOCUS, now + 100);
    expect(plain(pool).intensity).toBeLessThan(LOOKS.flood.intensity / 4);
  });
});

const spots = (pool: SiteLights) => pool.spots();
const plain = (pool: SiteLights) => pool.spots()[SITE_SHADOW_SLOTS];

describe('groundHits', () => {
  it('is a circle of radius h tan(angle) under a straight-down cone', () => {
    const l: SiteLight = { id: 'x', siteId: 'a', kind: 'flood', at: { x: 3, y: 6, z: -2 }, aim: { x: 3, y: 0, z: -2 }, ground: 0 };
    const hits = groundHits(l, 16);
    expect(hits).toHaveLength(48);
    const r = 6 * Math.tan(LOOKS.flood.angle);
    for (const h of hits.slice(-16)) expect(Math.hypot(h.x - 3, h.z + 2)).toBeCloseTo(r);
    for (const h of hits) expect(Math.hypot(h.x - 3, h.z + 2)).toBeLessThanOrEqual(r + 1e-9);
  });

  it('drops rays that miss the ground or fall beyond the range', () => {
    const l: SiteLight = { id: 'x', siteId: 'a', kind: 'flood', at: { x: 0, y: 6, z: 0 }, aim: { x: 40, y: 5, z: 0 }, ground: 0 };
    const hits = groundHits(l, 16);
    expect(hits.length).toBeLessThan(48);
    for (const h of hits) expect(Math.hypot(h.x, 6, h.z)).toBeLessThanOrEqual(LOOKS.flood.range + 1e-6);
  });
});
