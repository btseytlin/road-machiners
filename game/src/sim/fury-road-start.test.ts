import { describe, expect, it } from 'vitest';
import { FURY_ROAD } from '../data/modes';
import { PARTS, partDef } from '../data/parts';
import { GARAGE_STOCK } from '../data/market';
import { RU } from '../text/ru';
import { playerVehicle } from './damage';
import { outpostFactsAt } from './fury-road';
import { furyRoadWorld } from './testkit';

function partsOf(w: ReturnType<typeof furyRoadWorld>) {
  return playerVehicle(w).items.flatMap((it) => (it.kind === 'part' ? [it] : []));
}

describe('Fury Road starter kit', () => {
  it('is a scout with one machine gun and a rebar cage front and back on every seed', () => {
    for (const seed of [1, 3, 99]) {
      const w = furyRoadWorld(seed);
      const truck = playerVehicle(w);
      expect(truck.chassisId).toBe('scout');
      const parts = partsOf(w).filter((it) => partDef(it.part.defId).kind !== 'core');
      expect(parts.filter((it) => partDef(it.part.defId).kind === 'weapon').map((it) => it.part.defId)).toEqual(['mg']);
      const cages = parts.filter((it) => it.part.defId === 'cage');
      expect(cages.map((it) => it.y).sort()).toEqual([0, 7]);
      expect(parts.filter((it) => partDef(it.part.defId).kind === 'armor')).toHaveLength(2);
    }
  });
});

describe('Slug cannon name', () => {
  it('reads as a cannon in Russian, not the old coinage', () => {
    expect(JSON.stringify(RU["part.slugCannon"])).not.toMatch(/жаканомёт/i);
  });
});

describe('Fury Road outpost stock', () => {
  const kinds = [...new Set(GARAGE_STOCK.parts.map((p) => PARTS[p.value].kind))];

  it('holds exactly two parts of every part type', () => {
    for (const seed of [1, 3, 99]) {
      const w = furyRoadWorld(seed);
      for (const j of [1]) {
        const stock = outpostFactsAt(w, j).stock;
        expect(stock).toHaveLength(kinds.length * FURY_ROAD.stockPerKind);
        for (const kind of kinds) expect(stock.filter((p) => partDef(p.defId).kind === kind)).toHaveLength(2);
      }
    }
  });

  it('keeps the same stock through a save and load', () => {
    const w = furyRoadWorld(5);
    const before = outpostFactsAt(w, 1).stock;
    const loaded = JSON.parse(JSON.stringify(w));
    expect(loaded.furyRoad.outposts[0].stock).toEqual(before);
  });
});
