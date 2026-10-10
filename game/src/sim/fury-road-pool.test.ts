import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { playerVehicle } from './damage';
import { advanceFar } from './far';
import { spawnGroup, waveOf } from './fury-road';
import { alongOf, toRoad } from './highway';
import { vehicleStats } from './stats';
import { furyRoadWorld } from './testkit';
import { dist } from './vec';
import type { GameEvent, World } from './types';
import { endTurn } from './world';

const TURNS = 120;
const RAM_REACH = 3;
function moveAllFar(w: World): void {
  for (const v of w.vehicles) advanceFar(w, v);
}

function loneGroup(template: string): World {
  const w = furyRoadWorld(5);
  const run = w.furyRoad!;
  const group = { ...run.groups[0], from: 'ahead' as const, templates: [template], level: waveOf(6).level };
  run.groups = [group];
  spawnGroup(w, run, group, alongOf(w.seed, toRoad(0, playerVehicle(w).pos)));
  return w;
}

function meetsPlayer(e: GameEvent, id: string, me: string): boolean {
  if (e.t === 'shot') return e.shooter === id && e.target === me;
  if (e.t === 'collision') return (e.a === id && e.b === me) || (e.a === me && e.b === id);
  return e.t === 'destroyed' && e.vehicle === id;
}

describe('every NPC template as a Fury Road hostile', () => {
  for (const template of Object.keys(NPCS)) {
    it(`closes on the player as a ${template}, and shoots it, rams it or is wrecked, with no flight and no stall`, () => {
      let w = loneGroup(template);
      const id = w.furyRoad!.groups[0].vehicles[0];
      const armed = vehicleStats(w, w.vehicles.find((v) => v.id === id)!).weapons.length > 0;
      const seen: GameEvent[] = [];
      let closest = Infinity;
      for (let t = 0; t < TURNS && w.player.state === 'active'; t++) {
        w = endTurn(w, moveAllFar);
        seen.push(...w.events);
        const v = w.vehicles.find((x) => x.id === id);
        if (v) closest = Math.min(closest, dist(v.pos, playerVehicle(w).pos));
        if (seen.some((e) => meetsPlayer(e, id, w.player.vehicleId)) || (!armed && closest <= RAM_REACH)) break;
      }

      expect(seen.filter((e) => e.t === 'stall')).toEqual([]);
      expect(seen.some((e) => e.t === 'activity' && e.vehicle === id && e.activity === 'flee')).toBe(false);
      expect(seen.some((e) => meetsPlayer(e, id, w.player.vehicleId)) || (!armed && closest <= RAM_REACH), template).toBe(true);
    }, 120_000);
  }
});
