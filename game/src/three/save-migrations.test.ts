import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { propPose } from '../sim/mapgen';
import { baseGrid, isMounted, placementError } from '../sim/grid';
import { choosePerk, pendingPerkPairs, skillLevel } from '../sim/progress';
import { emptyWorld } from '../sim/testkit';
import type { Obstacle, Player, Vehicle } from '../sim/types';
import FORMAT_2_0 from './save-fixtures/format-2-0.json';
import FORMAT_2_1 from './save-fixtures/format-2-1.json';
import FORMAT_2_2 from './save-fixtures/format-2-2.json';
import FORMAT_2_3 from './save-fixtures/format-2-3.json';
import FORMAT_2_4 from './save-fixtures/format-2-4.json';
import FORMAT_2_5 from './save-fixtures/format-2-5.json';
import FORMAT_2_6 from './save-fixtures/format-2-6.json';
import FORMAT_2_7 from './save-fixtures/format-2-7.json';
import FORMAT_2_8 from './save-fixtures/format-2-8.json';
import FORMAT_2_9 from './save-fixtures/format-2-9.json';
import FORMAT_2_10 from './save-fixtures/format-2-10.json';
import FORMAT_2_11 from './save-fixtures/format-2-11.json';
import FORMAT_2_12 from './save-fixtures/format-2-12.json';
import FORMAT_2_13 from './save-fixtures/format-2-13.json';
import FORMAT_2_14 from './save-fixtures/format-2-14.json';
import { CORES_2_2, LAYOUTS_2_2 } from './save-layouts-2-2';
import { packExplored } from './save';
import { MIGRATIONS, pooledSkills_9_10 } from './save-migrations';

describe('save migrations', () => {
  it('0 to 1 gives the player townPatched false and keeps every other field', () => {
    const next = MIGRATIONS[0](FORMAT_2_0);

    expect(next).toEqual({ ...FORMAT_2_0, player: { ...FORMAT_2_0.player, townPatched: false } });
  });
});

describe('save migration 1 to 2', () => {
  type Saved = { player: { vehicleId: string; money: number; storage: { id: string; defId: string }[] }; vehicles: Vehicle[]; removed: Vehicle[] };
  const next = MIGRATIONS[1](FORMAT_2_1) as Saved;
  const all = [...next.vehicles, ...next.removed];
  const vehicle = (id: string) => all.find((v) => v.id === id)!;
  const spot = (v: Vehicle, id: string) => {
    const item = v.items.find((it) => it.id === id);
    return item && [item.x, item.y, item.rot];
  };

  it('puts every core of every chassis on its new cells with its new part, keeping ids, hp and wear', () => {
    for (const v of all.filter((it) => it.id.startsWith('c-') || it.id === 'gone-carrier')) {
      for (const c of CORES_2_2[v.chassisId].filter((core) => !core.defId.startsWith('wheel'))) {
        const item = v.items.find((it) => it.kind === 'part' && it.x === c.x && it.y === c.y && it.part.defId === c.defId);
        expect(item, `${v.id} ${c.defId}`).toBeDefined();
        expect(item?.rot, `${v.id} ${c.defId}`).toBe(c.rot ?? 0);
        if (item?.kind === 'part') expect([item.part.hp, item.part.wear]).toEqual([10, 0]);
      }
    }
    expect(vehicle('c-carrier').items.find((it) => it.id === 'c0')).toMatchObject({ id: 'c0', part: { id: 'pc0', defId: 'cabPickup' } });
    expect(vehicle('c-bus').items.find((it) => it.id === 'c0')).toMatchObject({ x: 2, y: 1, rot: 0, part: { defId: 'cabPickup' } });
  });

  it('moves a displaced item to the nearest free deck spot, turning it if needed', () => {
    expect(spot(vehicle('c-van'), 'mg')).toEqual([1, 4, 0]);
    expect(spot(next.vehicles[2], 'rack')).toEqual([5, 4, 0]);
  });

  it('keeps the guns, goods and armor that stood clear of the new cores', () => {
    const scout = next.vehicles[0];
    expect(spot(scout, 'mg')).toEqual([4, 1, 0]);
    expect(spot(scout, 'g6')).toEqual([1, 3, 0]);
    expect(spot(scout, 'front')).toEqual([3, 0, 1]);
    expect(spot(scout, 'cab')).toEqual([2, 3, 0]);
  });

  it('sends the player part with no room to the garage, turns the good into cash, and drops what an NPC had with no room', () => {
    const scout = next.vehicles[0];
    expect(spot(scout, 'mg2')).toBeUndefined();
    expect(spot(scout, 'gr')).toBeUndefined();
    expect(next.player.storage.map((p) => p.defId)).toEqual(['mg']);
    expect(next.player.money).toBe(100 + 21);
    expect(spot(next.vehicles[1], 'cannon')).toBeUndefined();
    expect(spot(vehicle('gone-carrier'), 'gd')).toEqual([5, 1, 0]);
  });

  it('cancels the refit job of every migrated truck', () => {
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[1].job).toBeNull();
  });

  it('leaves other world fields alone', () => {
    expect(next.player.vehicleId).toBe(FORMAT_2_1.player.vehicleId);
    expect(next.vehicles.length).toBe(FORMAT_2_1.vehicles.length);
    expect(next.removed.length).toBe(FORMAT_2_1.removed.length);
  });

  // Delete this test at the next format step: it is the only guard that the step's copies match live data while 2.2 is current.
  it('holds copies of the layouts and cores that equal the live chassis data', () => {
    for (const c of Object.values(CHASSIS).filter((it) => LAYOUTS_2_2[it.id])) {
      expect(LAYOUTS_2_2[c.id], c.id).toEqual(c.layout);
      expect(CORES_2_2[c.id], c.id).toEqual(c.core.filter((k) => !k.defId.startsWith('wheel')).map((k) => ({ defId: k.defId, x: k.x, y: k.y, rot: k.rot ?? 0 })));
    }
  });

  // Guns, racks and cannons may stand on any free cell, so only the other parts must stay mounted.
  it('puts every item of every truck on a free cell, and every non-core part still mounted', () => {
    for (const v of all) {
      const grid = baseGrid(v.chassisId);
      v.items.forEach((item, i) => {
        expect(placementError(grid, v.items.filter((_, j) => j !== i), item, null), `${v.id} ${item.id}`).toBeNull();
        if (item.kind === 'part' && !['mg', 'rack', 'cannon'].includes(item.part.defId)) expect(isMounted(v.chassisId, item), `${v.id} ${item.id}`).toBe(true);
      });
    }
  });
});

describe('save migration 2 to 3', () => {
  it('gives the player aid XP 0 and keeps every other XP source and field', () => {
    const next = MIGRATIONS[2](FORMAT_2_2);

    expect(next).toEqual({
      ...FORMAT_2_2,
      player: { ...FORMAT_2_2.player, xpBySource: { ...FORMAT_2_2.player.xpBySource, aid: 0 } },
    });
  });
});

describe('save migration 3 to 4', () => {
  it('packs explored into the same bitset a new save writes and keeps other fields', () => {
    const next = MIGRATIONS[3](FORMAT_2_3) as { player: Record<string, unknown>; turn: number };

    expect(next.player.explored).toBe(packExplored(Uint8Array.from(FORMAT_2_3.player.explored)));
    expect(next).toEqual({ ...FORMAT_2_3, player: { ...FORMAT_2_3.player, explored: next.player.explored } });
  });

  it('throws on a value other than 0 or 1', () => {
    expect(() => MIGRATIONS[3]({ player: { explored: [0, 2] } })).toThrow();
  });
});

describe('save migration 4 to 5', () => {
  type Saved = { kind: string; window?: number; rush?: boolean };
  const next = MIGRATIONS[4](FORMAT_2_4) as unknown as {
    turn: number;
    player: { money: number; contracts: Saved[] };
    shops: { nose: { contracts: Saved[] } };
  };

  it('gives every held and posted contract a window equal to the time it has left', () => {
    expect(next.player.contracts.map((c) => c.window)).toEqual([400, 1]);
    expect(next.shops.nose.contracts.map((c) => c.window)).toEqual([300, 700]);
  });

  it('marks every haul as no rush and leaves the other kinds without the flag', () => {
    const all = [...next.player.contracts, ...next.shops.nose.contracts] as Saved[];
    for (const c of all) expect('rush' in c).toBe(c.kind === 'haul');
    for (const c of all.filter((c) => c.kind === 'haul')) expect(c.rush).toBe(false);
  });

  it('changes nothing else', () => {
    const strip = (cs: Saved[]) => cs.map(({ window: _w, rush: _r, ...rest }) => rest);
    expect(strip(next.player.contracts)).toEqual(FORMAT_2_4.player.contracts);
    expect(strip(next.shops.nose.contracts)).toEqual(FORMAT_2_4.shops.nose.contracts);
    expect(next.turn).toBe(FORMAT_2_4.turn);
    expect(next.player.money).toBe(FORMAT_2_4.player.money);
  });
});

describe('save migration 5 to 6', () => {
  it('gives every aid state an unstarted one-turn handover and leaves other states alone', () => {
    const next = MIGRATIONS[5](FORMAT_2_5) as { states: { data: object }[] };

    expect(next.states[0].data).toEqual({ ...FORMAT_2_5.states[0].data, started: false, work: 1, workLeft: 1 });
    expect(next.states[1]).toEqual(FORMAT_2_5.states[1]);
  });
});

describe('save migration 6 to 7', () => {
  it('marks a defeat as gave up only for a driver out with a working cab', () => {
    const next = MIGRATIONS[6](FORMAT_2_6) as { vehicles: { defeat?: { gaveUp: boolean } }[] };
    const [gaveUp, knocked, retreating, free] = next.vehicles;

    expect(gaveUp.defeat).toEqual({ ...FORMAT_2_6.vehicles[0].defeat, gaveUp: true });
    expect(knocked.defeat?.gaveUp).toBe(false);
    expect(retreating.defeat?.gaveUp).toBe(false);
    expect(free).toEqual(FORMAT_2_6.vehicles[3]);
  });
});

describe('save migration 7 to 8', () => {
  const next = MIGRATIONS[7](FORMAT_2_7) as { salvage: { id: string }[]; player: { scavenged: string[] }; vehicles: { job: { stockId: string } | null }[] };

  it('drops the Fallen Sun stock and its searched mark, and keeps every other stock', () => {
    expect(next.salvage.map((stock) => stock.id)).toEqual(['wreck3']);
    expect(next.player.scavenged).toEqual(['wreck3']);
  });

  it('ends a search of the old stock and keeps other searches', () => {
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[1]).toEqual(FORMAT_2_7.vehicles[1]);
  });
});

describe('save migration 8 to 9', () => {
  const next = MIGRATIONS[8](FORMAT_2_8) as { salvage: { id: string }[]; player: { scavenged: string[] }; vehicles: { job: { stockId: string } | null }[] };

  it('drops the Old Orchard stock and its searched mark, and keeps every other stock', () => {
    expect(next.salvage.map((stock) => stock.id)).toEqual(['wreck3']);
    expect(next.player.scavenged).toEqual(['wreck3']);
  });

  it('ends a search of the old stock and keeps other searches', () => {
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[1]).toEqual(FORMAT_2_8.vehicles[1]);
  });
});

describe('save migration 9 to 10', () => {
  // Total XP each 2.9 level needed, a copy for the test.
  const reach = [0, 200, 600, 1200, 2000, 3000];
  const migrated = () => MIGRATIONS[9](FORMAT_2_9) as { player: Pick<Player, 'xp' | 'ranks' | 'perks'> & Record<string, unknown> };

  it('turns each old level into the same rank, at 0, mid level, on a threshold and past the top', () => {
    expect(migrated().player.ranks).toEqual({ driving: 0, perception: 1, machining: 2, toughness: 5, social: 3 });
  });

  it('keeps every earned XP: the pool holds what the ranks did not cost', () => {
    const { xp, ranks } = migrated().player;
    const spent = Object.values(ranks).reduce((sum, rank) => sum + reach[rank], 0);
    const earned = Object.values(FORMAT_2_9.player.skills).reduce((sum, n) => sum + n, 0);
    expect(xp).toBe(250 + 500 + 799);
    expect(xp + spent).toBe(earned);
  });

  it('removes skills and leaves perks, daily XP, repeats and XP per source as they were', () => {
    const next = migrated();
    const kept = Object.fromEntries(Object.entries(FORMAT_2_9.player).filter(([key]) => key !== 'skills'));
    expect(next).toEqual({ ...FORMAT_2_9, player: { ...kept, xp: next.player.xp, ranks: next.player.ranks } });
    expect(next.player).not.toHaveProperty('skills');
  });

  it('pools a skill map the same way for the rescue', () => {
    expect(pooledSkills_9_10(FORMAT_2_9.player.skills)).toEqual({ xp: migrated().player.xp, ranks: migrated().player.ranks });
  });

  it('keeps owned perks valid and opens the pairs the old levels reached', () => {
    const w = emptyWorld();
    const { xp, ranks, perks } = migrated().player;
    Object.assign(w.player, { xp, ranks, perks: [...perks] });
    expect(skillLevel(w, 'toughness')).toBe(5);
    expect(pendingPerkPairs(w).map((pair) => `${pair.skill} ${pair.level}`)).toEqual(['toughness 4', 'social 2']);
    expect(() => choosePerk(w, 'cannibal')).toThrow(/already picked/);
    expect(choosePerk(w, 'rumorMill').player.perks).toContain('rumorMill');
  });
});

describe('save migration 10 to 11', () => {
  const next = MIGRATIONS[10](FORMAT_2_10) as { obstacles: Obstacle[] };

  it('keeps the world as it was', () => {
    expect(next).toEqual(FORMAT_2_10);
  });

  it('leaves an old kill wreck without a hulk, so it draws as the generic wreck', () => {
    const kill = next.obstacles.find((o) => o.id === 'wreck-npc7');

    expect(kill).toBeDefined();
    expect(kill && 'hulk' in kill).toBe(false);
    expect(kill && propPose(kill).model).toBe('wreck');
  });
});

describe('save migration 11 to 12', () => {
  type Brain = { lastTown?: string; memories: unknown[] } | null;
  const next = MIGRATIONS[11](FORMAT_2_11) as { vehicles: { brain: Brain }[]; removed: { brain: Brain }[] };
  const noseMemory = { turn: 900, fact: { kind: 'prices', shop: 'nose', pressure: { salt: -0.2, scrap: 0.1 } } };

  it('turns a last town into a memory of its saved prices, on the saved turn', () => {
    expect(next.vehicles[1].brain!.memories).toEqual([noseMemory]);
    expect(next.removed[0].brain!.memories).toEqual([noseMemory]);
  });

  it('copies the saved pressure rather than sharing it', () => {
    const memory = next.vehicles[1].brain!.memories[0] as typeof noseMemory;
    expect(memory.fact.pressure).not.toBe(FORMAT_2_11.shops.nose.pressure);
  });

  it('gives an empty memory to a brain without a last town or with an unknown one', () => {
    expect(next.vehicles[2].brain!.memories).toEqual([]);
    expect(next.vehicles[3].brain!.memories).toEqual([]);
  });

  it('drops lastTown from every brain and leaves a missing brain alone', () => {
    for (const v of [...next.vehicles, ...next.removed]) expect(v.brain && 'lastTown' in v.brain).toBeFalsy();
    expect(next.vehicles[0]).toEqual(FORMAT_2_11.vehicles[0]);
    expect(next.vehicles[2].brain).toEqual({ ...FORMAT_2_11.vehicles[2].brain, memories: [] });
  });
});

describe('save migration 12 to 13', () => {
  it('gives the player the headlight switch off and keeps every other field', () => {
    const next = MIGRATIONS[12](FORMAT_2_12);

    expect(next).toEqual({ ...FORMAT_2_12, player: { ...FORMAT_2_12.player, headlights: false } });
  });
});

describe('save migration 13 to 14', () => {
  const next = MIGRATIONS[13](FORMAT_2_13) as Record<string, unknown> & { vehicles: object[]; player: object; broken: object[] };

  it('drops trails, the visible tiles, the last turn events and removed vehicles', () => {
    expect(next.vehicles).toEqual(FORMAT_2_13.vehicles.map(({ trail: _t, ...rest }) => rest));
    expect('events' in next).toBe(false);
    expect('removed' in next).toBe(false);
    const { visible: _v, ...player } = FORMAT_2_13.player;
    expect(next.player).toEqual(player);
  });

  it('keeps only the id and turn of a broken prop', () => {
    expect(next.broken).toEqual([{ id: 'deadTree-1354', turn: 2559 }]);
  });

  it('keeps dust clouds, contacts and clouds', () => {
    expect(next.dustClouds).toEqual(FORMAT_2_13.dustClouds);
    expect(next.turn).toBe(FORMAT_2_13.turn);
  });
});

describe('save migration 14 to 15', () => {
  it('drops the contacts and seen clouds and keeps the dust clouds', () => {
    const next = MIGRATIONS[14](FORMAT_2_14);
    const { contacts: _c, clouds: _s, ...player } = FORMAT_2_14.player;

    expect(next).toEqual({ ...FORMAT_2_14, player });
  });
});
