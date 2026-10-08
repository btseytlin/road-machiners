import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { startKit } from '../../data/start';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { callVehicle, endCallIfOut, hangUp } from '../../sim/dialogue';
import { addVehicle, emptyWorld, npcBrain } from '../../sim/testkit';
import { refreshVision } from '../../sim/vision';
import type { World } from '../../sim/types';
import { newWorld } from '../../sim/world';
import { TEST_MAP } from '../../test/map';
import { loadModels } from './models';
import { RADIO_LIGHT, RadioLights, radioLit, VehicleView, type RadioCue } from './vehicle';


const F = RADIO_LIGHT.flashMs;
const STEP = 25;

function withEvents(base: World, events: World['events']): World {
  const w = structuredClone(base);
  w.events = events;
  return w;
}

// On and off runs of the light, as [lit, length in ms].
function runs(l: RadioLights, id: string, from: number, to: number): [boolean, number][] {
  const out: [boolean, number][] = [];
  for (let t = from; t < to; t += STEP) {
    const on = l.lit(id, t);
    if (out.length > 0 && out[out.length - 1][0] === on) out[out.length - 1][1] += STEP;
    else out.push([on, STEP]);
  }
  return out;
}

function lights(l: RadioLights, id: string, from: number, to: number): boolean[] {
  return runs(l, id, from, to).map(([on]) => on);
}

const FLASHES = [true, false, true, false];

function callWorlds(): { open: World; npcId: string; playerId: string; idle: World } {
  const idle = emptyWorld({ x: 30, y: 30 });
  const npc = addVehicle(idle, 'traders', 'scout', ['stockEngine'], { x: 36, y: 30 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  refreshVision(idle);
  return { idle, open: callVehicle(idle, npc.id), npcId: npc.id, playerId: idle.player.vehicleId };
}

describe('radioLit', () => {
  it('flashes twice, then stays on while open', () => {
    const cue: RadioCue = { start: 0, end: null };
    expect([0, F, 2 * F, 3 * F, 4 * F, 10000].map((t) => radioLit(cue, t + 1))).toEqual([true, false, true, false, true, true]);
    expect(radioLit(cue, -1)).toBe(false);
  });

  it('plays two flashes, one dark gap and one flash even when closed at its own start', () => {
    const l = new RadioLights();
    const cue: RadioCue = { start: 0, end: 0 };
    const seen: boolean[] = [];
    for (let t = 0; t < 3000; t += STEP) {
      const on = radioLit(cue, t);
      if (seen.length === 0 || seen[seen.length - 1] !== on) seen.push(on);
    }
    expect(seen).toEqual([true, false, true, false, true, false]);
    expect(l.lit('x', 0)).toBe(false);
  });

  it('closes a cue after a long open with one flash', () => {
    const cue: RadioCue = { start: 0, end: 5000 };
    expect([4999, 5000 + F - 1, 5000 + F + 1, 5000 + 2 * F + 1, 20000].map((t) => radioLit(cue, t))).toEqual([true, false, true, false, false]);
  });
});

describe('radio lights', () => {
  it('shows both trucks of a call two flashes, steady, one flash on hang-up and then dark', () => {
    const { open, idle, npcId, playerId } = callWorlds();
    const l = new RadioLights();
    l.note(idle, 0);
    l.note(open, 1000);
    for (const id of [playerId, npcId]) expect(lights(l, id, 1000, 1000 + 4 * F)).toEqual(FLASHES);
    for (const id of [playerId, npcId]) expect(lights(l, id, 1000 + 4 * F, 20000)).toEqual([true]);
    const ended = hangUp(open);
    l.note(ended, 20000);
    for (const id of [playerId, npcId]) expect(lights(l, id, 20000, 30000)).toEqual([false, true, false]);
    expect(lights(l, 'bystander', 0, 30000)).toEqual([false]);
  });

  it('closes both trucks with one flash when the other end drops the call', () => {
    const { open, idle, npcId, playerId } = callWorlds();
    const l = new RadioLights();
    l.note(open, 0);
    const gone = structuredClone(open);
    gone.vehicles = gone.vehicles.filter((v) => v.id !== npcId);
    endCallIfOut(gone);
    expect(gone.player.call).toBeNull();
    l.note(gone, 5000);
    for (const id of [playerId, npcId]) expect(lights(l, id, 5000, 8000)).toEqual([false, true, false]);
    expect(idle.player.call).toBeNull();
  });

  it('keeps the light steady through frozen turns and never restarts the flashes', () => {
    const { open, playerId, npcId } = callWorlds();
    const l = new RadioLights();
    l.note(open, 0);
    for (let i = 1; i <= 20; i++) l.note(withEvents(open, []), i * 3000);
    for (const id of [playerId, npcId]) expect(lights(l, id, 4 * F, 60000)).toEqual([true]);
  });

  it('gives both trucks of a call that opened and ended between two worlds one brief talk cue', () => {
    const { idle, npcId, playerId } = callWorlds();
    const l = new RadioLights();
    l.note(idle, 0);
    l.note(withEvents(idle, [{ t: 'call', with: npcId, outcome: 'opened' }, { t: 'call', with: npcId, outcome: 'ended' }, ]), 1000);
    expect(lights(l, npcId, 1000, 10000)).toEqual([true, false, true, false, true, false, true, false]);
    expect(lights(l, playerId, 1000, 10000)).toEqual([true, false, true, false, true, false, true, false]);
  });

  it('plays a restart whole after a closing flash', () => {
    const { open, idle, npcId } = callWorlds();
    const l = new RadioLights();
    l.note(open, 0);
    l.note(idle, 5000);
    l.note(structuredClone(open), 5000 + F + 50);
    expect(runs(l, npcId, 4000, 12000).filter(([on]) => on).length).toBe(1 + 1 + 2 + 1);
    expect(lights(l, npcId, 5000 + 3 * F + 4 * F, 12000)).toEqual([true]);
  });

  it('gives each side of a tow talk two flashes, a glow and one flash, then dark', () => {
    const l = new RadioLights();
    const base = emptyWorld();
    l.note(base, 0);
    l.note(withEvents(base, [{ t: 'towHitched', by: 'a', client: 'b', site: 's' }]), 1000);
    for (const id of ['a', 'b']) expect(lights(l, id, 1000, 1000 + RADIO_LIGHT.talkMs + 6 * F)).toEqual([true, false, true, false, true, false, true, false]);
    expect(lights(l, 'a', 1000 + RADIO_LIGHT.talkMs + 6 * F, 20000)).toEqual([false]);
    expect(lights(l, 'c', 0, 20000)).toEqual([false]);
  });

  it('only extends the glow for talk during a cue, and queues a new cue after the close', () => {
    const l = new RadioLights();
    const base = emptyWorld();
    const talk = (id: string) => withEvents(base, [{ t: 'towOffer', by: id, town: 't', fee: 1 }]);
    l.note(base, 0);
    l.note(talk('a'), 1000);
    l.note(talk('a'), 1900);
    expect(runs(l, 'a', 1000, 6000).filter(([on]) => on).length).toBe(4);
    l.note(talk('a'), 3000 + F);
    expect(runs(l, 'a', 3000 + F, 9000).filter(([on]) => on).length).toBeGreaterThanOrEqual(3);
    expect(lights(l, 'a', 12000, 20000)).toEqual([false]);
  });

  it('does nothing when the same world is noted again, or for a honk', () => {
    const l = new RadioLights();
    const base = emptyWorld();
    const w = withEvents(base, [{ t: 'honk', vehicle: 'a' }]);
    l.note(base, 0);
    l.note(w, 100);
    expect(lights(l, 'a', 100, 5000)).toEqual([false]);
    const t = withEvents(base, [{ t: 'towOffer', by: 'a', town: 't', fee: 1 }]);
    l.note(t, 1000);
    l.note(t, 1500);
    l.note(t, 1900);
    expect(runs(l, 'a', 1000, 8000).filter(([on]) => on).length).toBe(4);
  });

  it('gives the beacon switching on one talk cue and stays dark with it on', () => {
    const l = new RadioLights();
    const off = emptyWorld();
    const on = structuredClone(off);
    on.player.beacon = true;
    const id = off.player.vehicleId;
    l.note(off, 0);
    l.note(on, 1000);
    expect(lights(l, id, 1000, 60000)).toEqual([true, false, true, false, true, false, true, false]);
    l.note(structuredClone(on), 70000);
    l.note(off, 71000);
    expect(lights(l, id, 70000, 90000)).toEqual([false]);
  });

  it('plays no cue for a beacon or events in the first world, and opens an open call', () => {
    const l = new RadioLights();
    const w = emptyWorld();
    w.player.beacon = true;
    w.events = [{ t: 'towOffer', by: 'a', town: 't', fee: 1 }];
    l.note(w, 0);
    expect(lights(l, 'a', 0, 5000)).toEqual([false]);
    expect(lights(l, w.player.vehicleId, 0, 5000)).toEqual([false]);
    const { open, playerId } = callWorlds();
    const m = new RadioLights();
    m.note(open, 0);
    expect(lights(m, playerId, 0, 3000)).toEqual([true, false, true, false, true]);
  });

  it('goes dark after a long mixed run', () => {
    const { open, idle, npcId } = callWorlds();
    const l = new RadioLights();
    const talk = withEvents(idle, [{ t: 'towOffer', by: npcId, town: 't', fee: 1 }]);
    let t = 0;
    for (let i = 0; i < 10; i++) {
      l.note(i % 2 ? open : idle, t);
      l.note(withEvents(talk, talk.events), (t += 100));
      t += 500;
    }
    l.note(idle, t);
    const end = t + RADIO_LIGHT.talkMs + 8 * F;
    expect(lights(l, npcId, end, end + 5000)).toEqual([false]);
    l.note(idle, end + 5000);
    expect(l.lit(npcId, end + 5000)).toBe(false);
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
