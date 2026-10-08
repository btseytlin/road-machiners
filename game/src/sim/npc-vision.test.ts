import { expect, it } from 'vitest';
import { addVehicle, emptyWorld } from './testkit';
import { autoOrders, fireWeapons } from './combat';
import { canVehicleSee } from './vision';

it('can see a rock spire itself without seeing through it', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 13, y: 12 });
  w.obstacles.push({ id: 'crag-0', pos: { x: 16, y: 12 }, r: 1.2, kind: 'landmark', look: 'crag', yaw: 0 });
  expect(canVehicleSee(w, npc, { x: 16, y: 12 })).toBe(true);
  expect(canVehicleSee(w, npc, { x: 18, y: 12 })).toBe(false);
});

it('NPCs cannot target or fire through an occluding rock', () => {
  const w = emptyWorld({ x: 10, y: 10 });
  const npc = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
  w.obstacles.push({ id: 'screen', pos: { x: 12, y: 10 }, r: 1, kind: 'rock' });
  autoOrders(w, npc);
  expect(npc.weaponOrders).toEqual({});
  const weapon = npc.items.find((item) => item.kind === 'part' && item.part.defId === 'mg')!;
  if (weapon.kind !== 'part') throw new Error('Missing test weapon');
  npc.weaponOrders[weapon.part.id] = { targetId: w.player.vehicleId, aim: 'body' };
  fireWeapons(w);
  expect(w.events.filter((event) => event.t === 'shot')).toEqual([]);
});
