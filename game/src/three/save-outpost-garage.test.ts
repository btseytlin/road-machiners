import { describe, expect, it } from 'vitest';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { storePart, takeFromStorage } from '../sim/inventory';
import { outpostBuyChassis, outpostBuyPart } from '../sim/outposts';
import { advanceFuryRoad, outpostTrucks } from '../sim/fury-road';
import { knockOutNpc } from '../sim/defeat';
import { resolveDestroyed } from '../sim/combat';
import { corePart } from '../sim/grid';
import { getResources } from '../sim/resources';
import { FURY_ROAD } from '../data/modes';
import { furyRoadWorld } from '../sim/testkit';
import { fillCargo, parkedAtOutpost, stockOfKind } from '../sim/testkit';
import type { World } from '../sim/types';
import { endTurn } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { loadWorld, writeSave } from './save';
import { memoryBackend, SaveSlots } from './save-db';

function reload(world: World): World {
  const slots = new SaveSlots(memoryBackend(), new Map());
  writeSave(slots, 'auto', world, 'run-1', 1000);
  const loaded = loadWorld(slots, 'auto', TEST_MAP);
  if (!loaded) throw new Error('Nothing loaded');
  return loaded;
}

function expectSameAndNoAward(world: World): World {
  const loaded = reload(world);
  expect(loaded).toEqual({ ...world, events: [], removed: [] });
  const next = endTurn(loaded, () => {});
  expect(next.player.xp).toBe(world.player.xp);
  expect(next.events.some((e) => e.t === 'money' || e.t === 'practice' || e.t === 'outpostReached')).toBe(false);
  return loaded;
}

describe('a saved outpost garage', () => {
  it('keeps armor bought into storage across a load, and fits it from storage after', () => {
    const w = parkedAtOutpost(21);
    fillCargo(w);
    const armor = stockOfKind(w, 'armor');
    const bought = outpostBuyPart(w, armor.id);

    const loaded = expectSameAndNoAward(bought);

    expect(loaded.player.storage.map((p) => p.id)).toEqual([armor.id]);
    expect(loaded.furyRoad!.outposts[0].stock.map((p) => p.id)).not.toContain(armor.id);
    const fitted = playerVehicle(loaded).items.filter((it) => it.kind === 'part' && mountedParts(playerVehicle(loaded), 'armor').some((p) => p.id === it.part.id));
    const cleared = fitted.reduce((x, it) => storePart(x, it.id), loaded);
    const after = takeFromStorage(cleared, armor.id, { x: fitted[0].x, y: fitted[0].y, rot: fitted[0].rot });
    expect(mountedParts(playerVehicle(after), 'armor').map((p) => p.id)).toContain(armor.id);
    expect(playerVehicle(after).job).toBeNull();
  });

  it('keeps the swapped truck and the outpost offer less the sold truck across a load', () => {
    const w = parkedAtOutpost(21);
    const offer = outpostTrucks(w, w.furyRoad!.outposts[0]);
    const swapped = outpostBuyChassis(w, offer[0]);

    const loaded = expectSameAndNoAward(swapped);

    expect(playerVehicle(loaded).chassisId).toBe(offer[0]);
    expect(outpostTrucks(loaded, loaded.furyRoad!.outposts[0])).toEqual(offer.slice(1));
  });
});

describe('a saved run with a knocked-out truck on the road', () => {
  it('gives back the downed truck and counts it once when it is shot to a wreck after the load', () => {
    const w = furyRoadWorld(21);
    w.turn = w.furyRoad!.quietFrom + FURY_ROAD.pacing.quiet;
    advanceFuryRoad(w);
    const group = w.furyRoad!.groups[0];
    const v = w.vehicles.find((x) => x.id === group.vehicles[0])!;
    corePart(v, 'cab').hp = 0;
    knockOutNpc(w, v);
    advanceFuryRoad(w);
    w.events = [];

    const loaded = expectSameAndNoAward(w);

    const downed = loaded.vehicles.find((x) => x.id === v.id)!;
    expect(downed.defeat?.phase).toBe('out');
    getResources(loaded, downed).health = 0;
    resolveDestroyed(loaded);
    advanceFuryRoad(loaded);
    expect(loaded.furyRoad!.groups[0].wrecked).toBe(1);
  });
});
