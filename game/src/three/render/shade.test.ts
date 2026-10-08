import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { HAZE_FROM } from '../../data/wear';
import { shadeCasters, sunAt, sunHeatAt } from '../../sim/sun';
import { emptyWorld } from '../../sim/testkit';
import * as THREE from 'three';
import type { TerrainChunk } from './terrain';
import { cornerLook, ShadeView } from './shade';

function turnFor(hour: number): number {
  return 1 + ((hour - TIME.startHour) * TIME.turnsPerDay) / 24;
}

describe('heat haze', () => {
  const noon = (TIME.sunrise + TIME.sunset) / 2;

  it('shimmers at full strength on open ground at noon in a heat wave', () => {
    const w = emptyWorld();
    w.turn = turnFor(noon);
    w.weather = [{ id: 'hw', kind: 'heatwave', turnsLeft: 10 }];
    const { x, y } = w.vehicles[0].pos;
    expect(cornerLook(w, x, y, sunAt(w.turn)!, w.obstacles).haze).toBe(255);
  });

  it('shimmers harder the hotter the ground', () => {
    const w = emptyWorld();
    const { x, y } = w.vehicles[0].pos;
    const plainNoon = cornerLook(w, x, y, sunAt(turnFor(noon))!, w.obstacles).haze;
    expect(cornerLook(w, x, y, sunAt(turnFor(noon - 2))!, w.obstacles).haze).toBeLessThan(plainNoon);
    w.weather = [{ id: 'hw', kind: 'heatwave', turnsLeft: 10 }];
    expect(cornerLook(w, x, y, sunAt(turnFor(noon))!, w.obstacles).haze).toBeGreaterThan(plainNoon);
  });

  it('does not shimmer in sun too weak to heat a driving engine', () => {
    const w = emptyWorld();
    w.turn = turnFor(TIME.sunrise + 1);
    const { x, y } = w.vehicles[0].pos;
    const sun = sunAt(w.turn)!;
    expect(sunHeatAt(w, { x, y }, sun)).toBeLessThan(HAZE_FROM);
    expect(cornerLook(w, x, y, sun, w.obstacles).haze).toBe(0);
  });

  it('does not shimmer in shade', () => {
    const w = emptyWorld();
    w.turn = turnFor(noon);
    const sun = sunAt(w.turn)!;
    const { x, y } = w.vehicles[0].pos;
    const heights = [...w.terrain.heights];
    const size = w.terrain.size;
    const bx = Math.round(x + sun.dir.x * 3);
    const by = Math.round(y + sun.dir.y * 3);
    for (let j = by - 1; j <= by + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) heights[j * (size + 1) + i] = 50;
    w.terrain = { ...w.terrain, heights };
    expect(cornerLook(w, x, y, sun, w.obstacles).haze).toBe(0);
  });

  it('shades a patch-edge corner behind a rock outside the patch', () => {
    const w = emptyWorld();
    w.turn = turnFor(noon);
    const sun = sunAt(w.turn)!;
    const me = w.vehicles[0].pos;
    const corner = { x: Math.round(me.x + sun.dir.x * 19), y: Math.round(me.y + sun.dir.y * 19) };
    const rock = { x: corner.x + sun.dir.x * 1.5, y: corner.y + sun.dir.y * 1.5 };
    w.obstacles.push({ id: 'rock-edge', kind: 'rock', pos: rock, r: 1 });
    const casters = shadeCasters(w, me, 20);
    expect(casters.map((o) => o.id)).toContain('rock-edge');
    expect(cornerLook(w, corner.x, corner.y, sun, casters).haze).toBe(0);
    expect(cornerLook(w, corner.x, corner.y, sun, []).haze).toBeGreaterThan(0);
  });
});

describe('shade patch over frames', () => {
  const noon = (TIME.sunrise + TIME.sunset) / 2;
  const worldAt = (turn: number) => {
    const w = emptyWorld();
    w.turn = turn;
    return w;
  };
  const build = (w: ReturnType<typeof emptyWorld>) => {
    const ground = [{ mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial()) }] as unknown as TerrainChunk[];
    return new ShadeView(w, ground);
  };
  const dump = (v: ShadeView) => ({
    pos: Array.from(v.mesh.geometry.getAttribute('position').array),
    alpha: Array.from(v.mesh.geometry.getAttribute('alpha').array),
    haze: Array.from((v as unknown as { hazeCells: Uint8Array }).hazeCells),
  });
  const FRAMES = Math.ceil(41 / 4);
  const t1 = turnFor(noon);
  const t2 = turnFor(noon - 2);
  const t3 = turnFor(noon + 2);

  it('keeps the old patch until the new one is complete', () => {
    const view = build(worldAt(t1));
    const before = dump(view);
    view.update(worldAt(t2));
    for (let i = 0; i < FRAMES - 1; i++) {
      view.advance();
      expect(dump(view)).toEqual(before);
    }
    view.advance();
    expect(dump(view)).not.toEqual(before);
  });

  it('ends with the patch a synchronous compute gives', () => {
    const view = build(worldAt(t1));
    view.update(worldAt(t2));
    for (let i = 0; i < FRAMES; i++) view.advance();
    expect(dump(view)).toEqual(dump(build(worldAt(t2))));
  });

  it('finishes the running patch, then the latest queued world', () => {
    const view = build(worldAt(t1));
    view.update(worldAt(t2));
    view.advance();
    view.update(worldAt(t3));
    for (let i = 0; i < FRAMES - 1; i++) view.advance();
    expect(dump(view)).toEqual(dump(build(worldAt(t2))));
    for (let i = 0; i < FRAMES; i++) view.advance();
    expect(dump(view)).toEqual(dump(build(worldAt(t3))));
  });
});
