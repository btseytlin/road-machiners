import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { TERRITORIES } from '../data/territory';
import { applyHazards } from './hazard';
import { huntingGrounds } from './npc-decisions';
import { siteGap } from './sites';
import { hazardZones, reactorPos, territoryEntries, territoryGrounds, territoryPieces } from './territory';
import { route } from './path';
import { addVehicle, emptyWorld } from './testkit';
import { getResources } from './resources';
import type { World } from './types';
import { dist, polylineDist } from './vec';

const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const hazard = TERRITORIES['fallen-sun'].reactor!.hazard!;
// The reactor in the bow's breach, the hazard's centre.
const core = reactorPos(sun as never);
const outsidePos = { x: core.x + hazard.radius + 3, y: core.y };

function worldAt(pos: { x: number; y: number }): World {
  const w = emptyWorld(pos);
  w.player.health = 100;
  return w;
}

describe('the reactor hazard', () => {
  it('sits at the reactor inside the bow', () => {
    const bow = territoryPieces(sun as never).find((p) => p.look === 'shipBow')!;
    expect(hazardZones().find((z) => z.id === 'fallen-sun')!.pos).toEqual(core);
    expect(dist(core, bow.pos)).toBeLessThan(bow.r);
  });

  it('costs driver health inside the zone, stops at the floor and spares trucks outside', () => {
    const w = worldAt(core);
    applyHazards(w);
    expect(w.player.health).toBe(100 - hazard.healthPerTurn);
    for (let i = 0; i < 30; i++) applyHazards(w);
    expect(w.player.health).toBe(hazard.floor);
    const out = worldAt(outsidePos);
    applyHazards(out);
    expect(out.player.health).toBe(100);
  });

  it('leaves health already below the floor alone', () => {
    const w = worldAt(core);
    w.player.health = hazard.floor - 10;
    applyHazards(w);
    expect(w.player.health).toBe(hazard.floor - 10);
  });

  it('hurts an NPC truck by the same rule, and spares its parts', () => {
    const w = worldAt(outsidePos);
    const npc = addVehicle(w, 'scavengers', 'scout', [], core);
    npc.resources = { money: 0, fuel: 10, supplies: 10, health: 100 };
    const hp = npc.items.map((i) => (i.kind === 'part' ? i.part.hp : 0));
    applyHazards(w);
    expect(getResources(w, npc).health).toBe(100 - hazard.healthPerTurn);
    expect(npc.items.map((i) => (i.kind === 'part' ? i.part.hp : 0))).toEqual(hp);
    expect(w.player.health).toBe(100);
  });

  it('tells the player once for each entry, and uses no numbers', () => {
    const w = worldAt(core);
    const me = w.vehicles[0];
    me.trail = [{ ...outsidePos, heading: 0 }];
    applyHazards(w);
    const lines = w.events.filter((e) => e.t === 'info');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ t: 'info', note: { id: 'hazard' } });
    me.trail = [{ ...core, heading: 0 }];
    applyHazards(w);
    expect(w.events.filter((e) => e.t === 'info')).toHaveLength(1);
  });

  it('keeps routes out of the zone', () => {
    const w = worldAt(outsidePos);
    const far = { x: core.x - hazard.radius - 3, y: core.y };
    const path = route(w, outsidePos, far, 0.6, []);
    let at = outsidePos;
    for (const p of path) {
      for (let k = 0; k <= 20; k++) {
        const s = { x: at.x + ((p.x - at.x) * k) / 20, y: at.y + ((p.y - at.y) * k) / 20 };
        expect(dist(s, core)).toBeGreaterThanOrEqual(hazard.radius - 0.01);
      }
      at = p;
    }
  });
});

describe('hunting grounds in the Fallen Sun', () => {
  const furrow = TERRAIN.features.furrow;
  const entries = territoryEntries(sun as never);
  const inner = territoryGrounds(sun as never).filter((p) => !entries.some((e) => dist(e, p) < 1e-9));

  it('wait at every patch, each inside the outline and clear of the hazard', () => {
    expect(inner).toHaveLength(TERRITORIES['fallen-sun'].wreck!.patches.length);
    for (const p of inner) {
      const where = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      expect(siteGap(sun, p), where).toBeLessThan(0);
      expect(dist(p, core), where).toBeGreaterThan(hazard.radius);
      expect(huntingGrounds(), where).toContainEqual(p);
    }
  });

  it('reach down the crash furrow', () => {
    expect(inner.filter((p) => polylineDist(p, furrow.path) < furrow.width).length).toBeGreaterThanOrEqual(2);
  });
});
