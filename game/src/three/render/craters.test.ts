import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CRATER } from '../../data/rules';
import { emptyWorld } from '../../sim/testkit';
import type { Crater, World } from '../../sim/types';
import { CraterViews } from './craters';
import { PROP_BIT, TRUCK_BIT } from './models';
import { SightLimit } from './scope';

const crater = (id: string, x: number, turn: number, radius = 1.5): Crater => ({ id, pos: { x, y: 30 }, radius, turn });

function worldAt(turn: number, craters: Crater[]): World {
  const w = emptyWorld();
  w.turn = turn;
  w.craters = craters;
  return w;
}

function shows(views: CraterViews, id: string): boolean {
  const obj = views.root.getObjectByName(id);
  if (!obj) throw new Error(`No crater view ${id}`);
  return obj.visible;
}

// A view built at turn 4 with no craters, so craters synced later are new to it.
function viewsAt(turn: number): CraterViews {
  const w = worldAt(turn, []);
  return new CraterViews(w, new SightLimit(w.size), new THREE.Group());
}

describe('CraterViews', () => {
  it('shows every crater at once when built, as after a load', () => {
    const w = worldAt(5, [crater('crater-5-0', 20, 5), crater('crater-3-0', 40, 3)]);
    const views = new CraterViews(w, new SightLimit(w.size), new THREE.Group());
    expect(shows(views, 'crater-5-0')).toBe(true);
    expect(shows(views, 'crater-3-0')).toBe(true);
  });

  it('shows a crater from an earlier turn on sync', () => {
    const views = viewsAt(4);
    views.sync(worldAt(5, [crater('crater-3-0', 20, 3)]));
    expect(shows(views, 'crater-3-0')).toBe(true);
  });

  it('hides a crater dug this turn until a blast lands inside it', () => {
    const views = viewsAt(4);
    views.sync(worldAt(5, [crater('crater-5-0', 20, 5)]));
    expect(shows(views, 'crater-5-0')).toBe(false);
    views.reveal({ x: 25, y: 30 });
    expect(shows(views, 'crater-5-0')).toBe(false);
    views.reveal({ x: 20.1, y: 30 });
    expect(shows(views, 'crater-5-0')).toBe(true);
  });

  it('shows every hidden crater when the shot band ends', () => {
    const views = viewsAt(4);
    views.sync(worldAt(5, [crater('crater-5-0', 20, 5), crater('crater-5-1', 40, 5)]));
    views.revealAll(5);
    expect(shows(views, 'crater-5-0')).toBe(true);
    expect(shows(views, 'crater-5-1')).toBe(true);
  });

  it('shows a crater of the band that ended even when it syncs after the band', () => {
    const views = viewsAt(4);
    views.revealAll(5);
    views.sync(worldAt(5, [crater('crater-5-0', 20, 5)]));
    expect(shows(views, 'crater-5-0')).toBe(true);
  });

  it('keeps showing a crater that a new blast inside it replaced', () => {
    const views = viewsAt(4);
    views.sync(worldAt(4, [crater('crater-3-0', 20, 3)]));
    views.sync(worldAt(5, [crater('crater-5-0', 20, 5, 2)]));
    expect(shows(views, 'crater-5-0')).toBe(true);
  });

  it('drops the view of a crater that left the world', () => {
    const views = viewsAt(4);
    views.sync(worldAt(5, [crater('crater-3-0', 20, 3)]));
    views.sync(worldAt(6, []));
    expect(views.root.getObjectByName('crater-3-0')).toBeUndefined();
  });

  it('raises the rim as high as the physics rim on flat ground', () => {
    const w = worldAt(5, [crater('crater-3-0', 20, 3, 1.5)]);
    const views = new CraterViews(w, new SightLimit(w.size), new THREE.Group());
    const rim = views.root.getObjectByName('crater-3-0-rim');
    if (!rim) throw new Error('No rim');
    const top = new THREE.Box3().setFromObject(rim).max.y;
    expect(top).toBeCloseTo(CRATER.rimRatio * 1.5, 2);
  });

  it('writes no truck or prop stencil bit', () => {
    const w = worldAt(5, [crater('crater-3-0', 20, 3)]);
    const views = new CraterViews(w, new SightLimit(w.size), new THREE.Group());
    views.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.Material;
      expect(m.stencilWrite && (m.stencilWriteMask & (TRUCK_BIT | PROP_BIT)) !== 0).toBe(false);
    });
  });
});
