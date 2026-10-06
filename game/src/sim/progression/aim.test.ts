import { describe, expect, it } from 'vitest';
import { playerVehicle } from '../damage';
import { corePart, mountedParts } from '../grid';
import { vehicleStats } from '../stats';
import { addVehicle, emptyWorld } from '../testkit';
import { aimFor, isSoftTarget } from './aim';

function duel(foeParts: string[]) {
  const w = emptyWorld({ x: 30, y: 30 });
  const foe = addVehicle(w, 'raiders', 'buggy', foeParts, { x: 50, y: 30 });
  foe.heading = Math.PI;
  return { w, foe, weapon: vehicleStats(w, playerVehicle(w)).weapons[0] };
}

describe('aimFor', () => {
  it('aims at a critical part of an unarmored foe, not at its body', () => {
    const { w, foe, weapon } = duel(['mg', 'stockEngine']);
    const aim = aimFor(w, foe, weapon);
    const critical = [...mountedParts(foe, 'core'), ...mountedParts(foe, 'engine')].map((p) => p.id);

    expect(critical).toContain(aim);
  });

  it('aims at the cab once the foe refused to give up', () => {
    const { w, foe, weapon } = duel(['mg', 'stockEngine']);
    foe.heading = Math.PI / 2;
    w.player.talked[foe.id] = { yieldDemand: 'refused' };

    expect(aimFor(w, foe, weapon)).toBe(corePart(foe, 'cab').id);
  });
});

describe('isSoftTarget', () => {
  it('takes an unarmored foe and leaves one that stops most of the round', () => {
    const bare = duel(['mg', 'stockEngine']);
    const plated = duel(['mg', 'stockEngine', 'plates', 'plates', 'plates', 'plates']);

    expect(isSoftTarget(bare.w, bare.foe)).toBe(true);
    expect(isSoftTarget(plated.w, plated.foe)).toBe(false);
  });
});
