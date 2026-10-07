import { describe, expect, it } from 'vitest';
import { NPCS } from '../../data/npcs';
import { advanceFar } from '../far';
import { playerVehicle } from '../damage';
import { addGoods } from '../inventory';
import { judgeDanger } from '../npc-decisions';
import { isTowed } from '../tow';
import { dist } from '../vec';
import { playerSees } from '../vision';
import { addVehicle, emptyWorld, npcBrain } from '../testkit';
import type { World } from '../types';
import { endTurn } from '../world';
import { botOrders } from './bot';
import { DayTally, netWorth } from './record';

// Every truck drives far, except the pinned raider, which stays where it stands so the fight is certain.
function moveAllFar(w: World): void {
  const towed = isTowed(w);
  for (const v of w.vehicles) if (!(towed && v.id === w.player.vehicleId) && v.name !== 'pinned raider') advanceFar(w, v);
}

describe('the hunter against one weak raider', () => {
  it('wins, counts the win, strips the mounted scanner and the goods, and ends richer', () => {
    let w = emptyWorld({ x: 100, y: 100 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const raider = addVehicle(w, 'raiders', 'buggy', ['scanner'], { x: 118, y: 100 });
    raider.name = 'pinned raider';
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    addGoods(w, raider, 'scrap', 3);
    const start = netWorth(w);
    const tally = new DayTally();

    for (let turn = 0; turn < 40; turn++) {
      const played = botOrders(w, 'hunter');
      const next = endTurn(played.world, moveAllFar);
      tally.note(w, next,[...played.events, ...next.events], played.ledger);
      w = next;
    }

    const row = tally.close(1, w);
    const held = playerVehicle(w).items.flatMap((it) => (it.kind === 'part' ? [it.part.defId] : []));
    expect(row.fightsWon).toBe(1);
    expect(held).toContain('scanner');
    expect(netWorth(w)).toBeGreaterThan(start);
  }, 120000);
});

describe('the hunter against one strong raider', () => {
  it('leaves it alone', () => {
    const start = emptyWorld({ x: 100, y: 100 });
    for (const id of Object.keys(NPCS)) start.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const raider = addVehicle(start, 'raiders', 'jeep', ['autocannon', 'ram', 'ram', 'ram'], { x: 118, y: 100 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const w = endTurn(start, () => {}); // a turn with no movement, so the player has seen the raider
    expect(playerSees(w, raider.pos)).toBe(true);
    // Too strong for the hunter's margin: it hunts only a foe four times weaker than itself.
    expect(judgeDanger(w, playerVehicle(w), raider)).toBeGreaterThan(1 / 4);

    const turn = botOrders(w, 'hunter').world;
    const order = playerVehicle(turn).order;

    // It holds its fire and keeps patrolling toward a shop instead.
    expect(turn.player.autoFire).toBe(false);
    expect(order?.kind).toBe('stopAt');
    expect(order?.kind === 'stopAt' && dist(order.dest, raider.pos)).toBeGreaterThan(50);
  });
});
