import { defaultSetup } from '../sim/settings';
import { expect, it } from 'vitest';
import { startKit } from '../data/start';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { openingStockOf } from '../sim/opening';
import { canReachSalvage } from '../sim/salvage';
import { openingStopPoint } from '../sim/testkit';
import { endTurn, newWorld, setMoveOrder } from '../sim/world';
import { budget } from '../test/budget';
import { TEST_MAP } from '../test/map';
import { buildDrive, freeDrive, initPhysics, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';

it('drives the new-game truck on its nearly broken engine to a stop point by the opening wreck, in reach to search', async () => {
  await initPhysics();
  let w = newWorld(1, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  w = setMoveOrder(w, { kind: 'stopAt', dest: openingStopPoint(w) });
  let drive: Drive = buildDrive(w);
  for (let i = 0; i < 12 && playerVehicle(w).order !== null; i++) {
    let result: TurnResult | null = null;
    w = endTurn(w, physicsMove(drive, (next) => (result = next)));
    freeDrive(drive);
    drive = result!.next;
  }
  freeDrive(drive);
  expect(playerVehicle(w).order).toBeNull();
  expect(canReachSalvage(playerVehicle(w), openingStockOf(w)!)).toBe(true);
  expect(mountedParts(playerVehicle(w)).find((p) => p.defId === 'stockEngine')!.hp).toBeGreaterThan(0);
}, budget(120_000));
