import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { startKit } from '../../data/start';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { emptyWorld } from '../../sim/testkit';
import type { World } from '../../sim/types';
import { newWorld } from '../../sim/world';
import { TEST_MAP } from '../../test/map';
import { loadModels } from './models';
import { RADIO_LIGHT, RadioLights, VehicleView } from './vehicle';


function talking(id: string): World {
  const w = emptyWorld();
  w.events = [{ t: 'towOffer', by: id, town: 't', fee: 1 }];
  return w;
}

function sample(l: RadioLights, w: World, id: string, from: number, to: number): boolean[] {
  const out: boolean[] = [];
  for (let t = from; t < to; t += 50) out.push(l.lit(w, id, t));
  return out;
}

describe('radio lights', () => {
  it('blinks a speaker for the window and then goes dark', () => {
    const l = new RadioLights();
    const w = talking('a');
    l.note(w, 0);
    const first = sample(l, w, 'a', 0, RADIO_LIGHT.periodMs);
    expect(first).toContain(true);
    expect(first).toContain(false);
    l.note(w, RADIO_LIGHT.spokeMs + 1);
    expect(sample(l, w, 'a', RADIO_LIGHT.spokeMs + 1, RADIO_LIGHT.spokeMs + 3000)).not.toContain(true);
  });

  it('does not extend the window when the same world is noted again', () => {
    const l = new RadioLights();
    const w = talking('a');
    l.note(w, 0);
    l.note(w, 2000);
    l.note(w, RADIO_LIGHT.spokeMs + 1);
    expect(sample(l, w, 'a', RADIO_LIGHT.spokeMs + 1, RADIO_LIGHT.spokeMs + 1000)).not.toContain(true);
  });

  it('blinks an id on air with no time limit', () => {
    const l = new RadioLights();
    const w = emptyWorld();
    w.player.beacon = true;
    const id = w.player.vehicleId;
    const late = 100000;
    expect(sample(l, w, id, late, late + RADIO_LIGHT.periodMs)).toContain(true);
    expect(sample(l, w, id, late, late + RADIO_LIGHT.periodMs)).toContain(false);
  });

  it('never lights an id that is not on the radio', () => {
    const l = new RadioLights();
    const w = talking('a');
    l.note(w, 0);
    expect(sample(l, w, 'b', 0, 3000)).not.toContain(true);
  });
});

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

function bulbs(view: VehicleView): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial && [PAL.radioLight.on, PAL.radioLight.off].includes(o.material.color.getHex())) found.push(o);
  });
  return found;
}

function halos(view: VehicleView): THREE.Sprite[] {
  const found: THREE.Sprite[] = [];
  view.root.traverse((o) => {
    if (o instanceof THREE.Sprite) found.push(o);
  });
  return found;
}

describe('antenna radio light', () => {
  it('has one bulb and one halo, and radio() switches both', () => {
    const view = new VehicleView(playerVehicle(newWorld(1337, startKit('standard'), TEST_MAP)), true);
    expect(bulbs(view)).toHaveLength(1);
    expect(halos(view)).toHaveLength(1);
    const color = () => (bulbs(view)[0].material as THREE.MeshBasicMaterial).color.getHex();
    expect(color()).toBe(PAL.radioLight.off);
    expect(halos(view)[0].visible).toBe(false);
    view.radio(true);
    expect(color()).toBe(PAL.radioLight.on);
    expect(halos(view)[0].visible).toBe(true);
    view.radio(false);
    expect(color()).toBe(PAL.radioLight.off);
    expect(halos(view)[0].visible).toBe(false);
  });
});
