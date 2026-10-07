import { describe, expect, it } from 'vitest';
import { NPCS, type TraitId } from '../data/npcs';
import { NPC_BEHAVIOR } from '../data/npc-behavior';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { advanceFar } from './far';
import { getResources } from './resources';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { endTurn } from './world';
import type { Vec } from './vec';
import { dist } from './vec';
import type { Vehicle, World } from './types';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const camp = REGION.locations.find((l) => l.id === 'scrapjaw')!;
const moveAllFar = (w: World) => {
  for (const v of w.vehicles) advanceFar(w, v);
};

// A fuelless majority: most NPCs broke, dry and a few tiles off the site that serves them. Every one gets fuel again.
// What a driver does with that fuel afterwards, like a long trip to sell loot, is its own goals' business.
describe('a fuelless majority of NPCs', () => {
  it('all recover scrap fuel at their serving sites with no stall', () => {
    let w = emptyWorld({ x: 5, y: 5 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const off = (site: { pos: Vec; radius: number }, dy: number): Vec => ({ x: site.pos.x + site.radius + 6, y: site.pos.y + dy });
    const broke: Vehicle[] = [];
    const spawn = (chassis: string, parts: string[], brainId: string, traits: string[], pos: Vec, healthy: boolean) => {
      const v = addVehicle(w, healthy ? 'traders' : 'scavengers', chassis, parts, pos);
      v.brain = npcBrain(brainId, pos, traits as TraitId[]);
      const r = getResources(w, v);
      r.money = healthy ? 5000 : 0;
      r.fuel = healthy ? 40 : 0;
      if (!healthy) broke.push(v);
      return v;
    };
    spawn('scout', ['stockEngine'], 'scavenger', NPCS.scavenger.traits, off(bowl, 0), false);
    spawn('scout', ['stockEngine'], 'scavenger', NPCS.scavenger.traits, off(bowl, 4), false);
    spawn('hauler', ['stockEngine'], 'trader', NPCS.trader.traits, off(bowl, -4), false);
    spawn('hauler', ['stockEngine'], 'trader', NPCS.trader.traits, off(bowl, 8), false);
    const raider = spawn('buggy', ['stockEngine'], 'buggy', ['raider'], off(camp, 0), false);
    raider.faction = 'raiders';
    spawn('scout', ['stockEngine'], 'scavenger', NPCS.scavenger.traits, off(bowl, -8), true);
    spawn('hauler', ['stockEngine'], 'trader', NPCS.trader.traits, off(bowl, 12), true);

    const farthest = Math.max(...broke.map((v) => dist(v.pos, v === raider ? camp.pos : bowl.pos)));
    const bound = Math.ceil(farthest / RULES.limpSpeed) + NPC_BEHAVIOR.stallTurns;
    const stalls: unknown[] = [];
    // A recovered driver goes back to work and may run dry again before the end, so recovery is any turn with fuel.
    const refuelled = new Set<string>();
    for (let turn = 0; turn < bound; turn++) {
      w = endTurn(w, moveAllFar);
      stalls.push(...w.events.filter((e) => e.t === 'stall'));
      for (const v of broke) if (getResources(w, w.vehicles.find((x) => x.id === v.id)!).fuel > 0) refuelled.add(v.id);
    }

    expect(stalls).toEqual([]);
    expect([...refuelled].sort()).toEqual(broke.map((v) => v.id).sort());
  });
});
