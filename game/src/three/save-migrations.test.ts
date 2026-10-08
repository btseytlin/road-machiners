import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { propPose } from '../sim/mapgen';
import { baseGrid, isMounted, placementError } from '../sim/grid';
import { choosePerk, pendingPerkPairs, skillLevel } from '../sim/progress';
import { emptyWorld } from '../sim/testkit';
import type { Obstacle, Player, Vehicle, WeatherEvent, World } from '../sim/types';
import { stormStrength, weatherAt, weatherOn } from '../sim/weather';
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
import FORMAT_2_15 from './save-fixtures/format-2-15.json';
import FORMAT_2_16 from './save-fixtures/format-2-16.json';
import FORMAT_2_17 from './save-fixtures/format-2-17.json';
import FORMAT_2_18 from './save-fixtures/format-2-18.json';
import FORMAT_2_19 from './save-fixtures/format-2-19.json';
import FORMAT_2_20 from './save-fixtures/format-2-20.json';
import FORMAT_2_21 from './save-fixtures/format-2-21.json';
import FORMAT_2_22 from './save-fixtures/format-2-22.json';
import FORMAT_2_23 from './save-fixtures/format-2-23.json';
import FORMAT_2_24 from './save-fixtures/format-2-24.json';
import FORMAT_2_25 from './save-fixtures/format-2-25.json';
import FORMAT_2_26 from './save-fixtures/format-2-26.json';
import FORMAT_2_27 from './save-fixtures/format-2-27.json';
import FORMAT_2_28 from './save-fixtures/format-2-28.json';
import FORMAT_2_29 from './save-fixtures/format-2-29.json';
import FORMAT_2_30 from './save-fixtures/format-2-30.json';
import SAVE_SHAPE from './save-shape.json';
import FORMAT_2_31 from './save-fixtures/format-2-31.json';
import FORMAT_2_32 from './save-fixtures/format-2-32.json';
import FORMAT_2_33 from './save-fixtures/format-2-33.json';
import FORMAT_2_34 from './save-fixtures/format-2-34.json';
import { CORES_2_2, LAYOUTS_2_2 } from './save-layouts-2-2';
import { searchStream } from '../sim/search';
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

  it('holds copies of the layouts and cores that equal the live chassis data', () => {
    for (const c of Object.values(CHASSIS).filter((it) => LAYOUTS_2_2[it.id])) {
      expect(LAYOUTS_2_2[c.id], c.id).toEqual(c.layout);
      expect(CORES_2_2[c.id], c.id).toEqual(c.core.filter((k) => !k.defId.startsWith('wheel')).map((k) => ({ defId: k.defId, x: k.x, y: k.y, rot: k.rot ?? 0 })));
    }
  });

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
  const before = structuredClone(FORMAT_2_13);
  const next = MIGRATIONS[13](FORMAT_2_13) as { states: { data: { partIds?: string[] } }[] };

  it('gives a patch the ids of its client parts at 0 HP, in item order', () => {
    expect(next.states[0].data.partIds).toEqual(['p1', 'p2']);
  });

  it('gives a patch whose client is gone an empty list', () => {
    expect(next.states[1].data.partIds).toEqual([]);
  });

  it('leaves other states alone and does not mutate its input', () => {
    expect(next.states[2]).toEqual(FORMAT_2_13.states[2]);
    expect(FORMAT_2_13).toEqual(before);
  });
});

describe('save migration 14 to 15', () => {
  it('keeps a defeated driver on its retreat as it is, so it lies up when it gets home', () => {
    expect(MIGRATIONS[14](structuredClone(FORMAT_2_14))).toEqual(FORMAT_2_14);
  });
});

describe('save migration 15 to 16', () => {
  it('adds no craters and gives every shot and guard round a null burst, changing nothing else', () => {
    const next = MIGRATIONS[15](FORMAT_2_15);
    const [shot, guard, arrived] = FORMAT_2_15.events;
    const burstless = (rounds: object[]) => rounds.map((round) => ({ ...round, burst: null }));

    expect(next).toEqual({
      ...FORMAT_2_15,
      craters: [],
      events: [{ ...shot, rounds: burstless(shot.rounds!) }, { ...guard, rounds: burstless(guard.rounds!) }, arrived],
    });
  });
});

describe('save migration 16 to 17', () => {
  const next = MIGRATIONS[16](FORMAT_2_16) as { turn: number; weather: WeatherEvent[] };

  it('gives a storm a birth turn past its build-up and changes nothing else', () => {
    expect(next).toEqual({ ...FORMAT_2_16, weather: [{ ...FORMAT_2_16.weather[0], born: 470 }, FORMAT_2_16.weather[1]] });
  });

  it('leaves a storm with a long way to go at full strength', () => {
    const storm = next.weather[0];
    if (storm.kind !== 'storm') throw new Error('expected the storm first');
    expect(stormStrength(next as unknown as World, storm)).toBe(1);
  });
});

describe('save migration 17 to 18', () => {
  const next = MIGRATIONS[17](FORMAT_2_17) as unknown as World;
  const shares = (id: string) => next.vehicles.find((v) => v.id === id)!.stormExposure;

  it('gives each truck the share each storm has settled to where it stands, and nothing outside', () => {
    expect(shares('v-centre')).toEqual({ wx1: 1 });
    expect(shares('v-edge').wx1).toBeCloseTo(0.5);
    expect(Object.keys(shares('v-edge'))).toEqual(['wx1']);
    expect(shares('v-building').wx2).toBeCloseTo(11 / 30);
    expect(shares('v-out')).toEqual({});
  });

  it('gives a removed truck no shares and changes nothing else', () => {
    expect(next.removed[0].stormExposure).toEqual({});
    const strip = (vs: Vehicle[]) => vs.map((v) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'stormExposure')));
    expect({ ...next, vehicles: strip(next.vehicles), removed: strip(next.removed) }).toEqual(FORMAT_2_17);
  });

  it('loads every truck feeling exactly the settled weather where it stands', () => {
    for (const v of next.vehicles) expect(weatherOn(next, v), v.id).toEqual(weatherAt(next, v.pos));
  });
});

describe('save migration 18 to 19', () => {
  const next = MIGRATIONS[18](FORMAT_2_18);

  it('marks every far route of a truck in play or removed as planned with roads', () => {
    const route = (v: (typeof FORMAT_2_18.vehicles)[number]) => ({ ...v, brain: { ...v.brain, farRoute: { ...v.brain!.farRoute, offRoad: false } } });
    expect(next).toEqual({
      ...FORMAT_2_18,
      vehicles: [FORMAT_2_18.vehicles[0], route(FORMAT_2_18.vehicles[1]), FORMAT_2_18.vehicles[2]],
      removed: [route(FORMAT_2_18.removed[0])],
    });
  });
});

describe('save migration 19 to 20', () => {
  it('drops guard shots, guard kill credit and the gate a driver was shot by, and keeps every other field', () => {
    const next = MIGRATIONS[19](FORMAT_2_19);

    expect(next).toEqual({
      ...FORMAT_2_19,
      events: [FORMAT_2_19.events[0], FORMAT_2_19.events[2]],
      vehicles: [{ id: 'player', lastHitBy: null }, FORMAT_2_19.vehicles[1], { id: 'npc-4', lastHitBy: null, brain: { goals: [] } }],
      removed: [{ id: 'npc-8', lastHitBy: null }, FORMAT_2_19.removed[1]],
    });
  });
});

describe('save migration 20 to 21', () => {
  it('stamps every flee goal with the save turn and keeps every other field', () => {
    const next = MIGRATIONS[20](FORMAT_2_20);
    const [player, runner, fighter] = FORMAT_2_20.vehicles;
    const fled = (g: { kind: string }) => (g.kind === 'flee' ? { ...g, perceived: 620 } : g);

    expect(next).toEqual({
      ...FORMAT_2_20,
      vehicles: [player, { ...runner, brain: { goals: runner.brain!.goals.map(fled) } }, fighter],
      removed: [{ ...FORMAT_2_20.removed[0], brain: { goals: FORMAT_2_20.removed[0].brain.goals.map(fled) } }],
    });
  });
});

describe('save migration 21 to 22', () => {
  it('gives every fight goal a fresh wear window from the save turn and keeps every other field', () => {
    const next = MIGRATIONS[21](FORMAT_2_21);
    const [player, raider, runner] = FORMAT_2_21.vehicles;
    const worn = (g: { kind: string }) => (g.kind === 'fight' ? { ...g, worn: { turn: 700, condition: 1 } } : g);

    expect(next).toEqual({
      ...FORMAT_2_21,
      vehicles: [player, { ...raider, brain: { goals: raider.brain!.goals.map(worn) } }, runner],
      removed: [{ ...FORMAT_2_21.removed[0], brain: { goals: FORMAT_2_21.removed[0].brain.goals.map(worn) } }],
    });
  });
});

describe('save migration 22 to 23', () => {
  it('turns noted hostiles and fight or flee targets into tracks, and keeps every other field', () => {
    const next = MIGRATIONS[22](FORMAT_2_22) as typeof FORMAT_2_22;
    const [player, raider, runner] = FORMAT_2_22.vehicles;
    const [raid, fight] = raider.brain!.goals;
    const { perceived: _, ...untimedFight } = fight;
    const robbery = FORMAT_2_22.removed[0].brain.goals[0];
    const { perceived: __, ...untimedRobbery } = robbery;

    expect(next).toEqual({
      ...FORMAT_2_22,
      vehicles: [
        player,
        {
          ...raider,
          brain: {
            noticed: { 'preySeen:npc-5': 799 },
            goals: [raid, untimedFight],
            tracks: {
              player: { at: { x: 30, y: 30 }, turn: 797, sighted: true, choice: 'fight', chosenInSight: true },
              'npc-5': { at: { x: 10, y: 12 }, turn: 797, sighted: false, choice: 'keep', chosenInSight: false },
            },
          },
        },
        { ...runner, brain: { ...runner.brain, tracks: { 'npc-2': { at: { x: 40, y: 40 }, turn: 799, sighted: true, choice: 'flee', chosenInSight: true } } } },
      ],
      removed: [
        {
          ...FORMAT_2_22.removed[0],
          brain: { noticed: {}, goals: [untimedRobbery], tracks: { 'npc-5': { at: { x: 10, y: 12 }, turn: 790, sighted: true, choice: 'fight', chosenInSight: true } } },
        },
      ],
    });
  });
});

describe('save migration 23 to 24', () => {
  it('marks every track out of sight and keeps every other field', () => {
    const next = MIGRATIONS[23](FORMAT_2_23) as typeof FORMAT_2_23;
    const [player, runner] = FORMAT_2_23.vehicles;
    const tracks = runner.brain!.tracks;

    expect(next).toEqual({
      ...FORMAT_2_23,
      vehicles: [player, { ...runner, brain: { ...runner.brain, tracks: { player: { ...tracks.player, seenSince: null }, 'npc-5': { ...tracks['npc-5'], seenSince: null } } } }],
    });
  });
});

describe('save migration 24 to 25', () => {
  const before = structuredClone(FORMAT_2_24);

  it('does not mutate its input', () => {
    MIGRATIONS[24](FORMAT_2_24);
    expect(FORMAT_2_24).toEqual(before);
  });

  it('drops the circles of the fortress sites and the Bowl and Nose buildings, and keeps every other obstacle', () => {
    const next = MIGRATIONS[24](FORMAT_2_24) as { obstacles: { id: string }[] };

    expect(next.obstacles.map((o) => o.id)).toEqual(['site-old-mill', 'bld-dustwell-1', 'cw-convoy-0', 'wreck4']);
    expect(next.obstacles[0]).toEqual(FORMAT_2_24.obstacles[5]);
  });

  it('drops both obsolete oasis ponds but keeps water elsewhere', () => {
    const world = { ...FORMAT_2_24, obstacles: [
      { id: 'pond-dustwell' }, { id: 'pond-green-pit' }, { id: 'pond-old-mill' }, { id: 'lake-west' },
    ] };
    const next = MIGRATIONS[24](world) as { obstacles: { id: string }[] };
    expect(next.obstacles.map((o) => o.id)).toEqual(['pond-old-mill', 'lake-west']);
  });

  it('drops the old salvage yard wrecks, which a fortress yard no longer has', () => {
    const world = { ...FORMAT_2_24, obstacles: [{ id: 'cw-salvage-yard-0' }, { id: 'cw-convoy-0' }] };
    const next = MIGRATIONS[24](world) as { obstacles: { id: string }[] };

    expect(next.obstacles.map((o) => o.id)).toEqual(['cw-convoy-0']);
  });
});

describe('save migration 25 to 26', () => {
  type Loot = { goods: Partial<Record<string, number>>; parts: unknown[]; fuel?: number; supplies?: number };
  type Stock = Loot & { id: string; hidden: Loot };
  type Saved = {
    vehicles: { id: string; utilityOrders: object }[];
    removed: { id: string; utilityOrders: object }[];
    smoke: unknown[];
    fields: unknown[];
    flares: unknown[];
    lines: unknown[];
    searchRng: { rngState: number };
    salvage: Stock[];
  };
  const next = MIGRATIONS[25](FORMAT_2_25) as Saved;
  const stock = (id: string) => next.salvage.find((s) => s.id === id)!;
  const before = (id: string) => FORMAT_2_25.salvage.find((s) => s.id === id)!;
  const NO_HIDDEN = { goods: {}, parts: [], fuel: 0, supplies: 0 };

  it('gives the player the freeze switch, off', () => {
    expect((next as unknown as { player: object }).player).toEqual({ ...FORMAT_2_25.player, frozen: false });
  });

  it('gives every vehicle and removed vehicle empty utility orders, keeping its other fields', () => {
    expect(next.vehicles).toEqual(FORMAT_2_25.vehicles.map((v) => ({ ...v, utilityOrders: {} })));
    expect(next.removed).toEqual(FORMAT_2_25.removed.map((v) => ({ ...v, utilityOrders: {} })));
  });

  it('starts empty smoke, fields, flares and lines, and the search stream a new game of the same seed has', () => {
    expect([next.smoke, next.fields, next.flares, next.lines]).toEqual([[], [], [], []]);
    expect(next.searchRng).toEqual(searchStream(FORMAT_2_25.seed));
  });

  it.each(['burnt-convoy', 'barn-759', 'wreck12'])('hides all the loot of the unsearched rolled stock %s', (id) => {
    const old = before(id);
    expect(stock(id)).toEqual({
      ...old,
      goods: {},
      parts: [],
      fuel: 0,
      supplies: 0,
      hidden: { goods: old.goods, parts: old.parts, fuel: old.fuel, supplies: old.supplies },
    });
  });

  it('counts a rolled stock without fuel or supplies fields as none of them', () => {
    expect(stock('deckBay-1450').hidden).toEqual({ goods: { scrap: 4 }, parts: [], fuel: 0, supplies: 0 });
  });

  it.each(['podfield', 'wreck4', 'wreck-v40', 'cargo-v41-30'])('leaves the searched stock, truck wreck or pile %s in the open', (id) => {
    expect(stock(id)).toEqual({ ...before(id), hidden: NO_HIDDEN });
  });

  it('keeps the loot total of every stock', () => {
    const total = (s: Loot) => Object.values(s.goods).reduce((a: number, b) => a + (b ?? 0), 0) + s.parts.length + (s.fuel ?? 0) + (s.supplies ?? 0);
    for (const s of next.salvage) expect(total(s) + total(s.hidden), s.id).toBe(total(before(s.id)));
  });
});

describe('save migration 26 to 27', () => {
  type Contracts = { contracts: Record<string, unknown>[] };
  const next = MIGRATIONS[26](FORMAT_2_26) as { turn: number; player: Contracts & { money: number }; shops: Record<string, Contracts> };

  it('starts every held and posted bounty unfulfilled', () => {
    expect(next.player.contracts[0]).toEqual({ ...FORMAT_2_26.player.contracts[0], fulfilled: false });
    expect(next.shops.bowl.contracts[0]).toEqual({ ...FORMAT_2_26.shops.bowl.contracts[0], fulfilled: false });
  });

  it('keeps every other contract and field', () => {
    expect(next.player.contracts[1]).toEqual(FORMAT_2_26.player.contracts[1]);
    expect(next.shops.bowl.contracts[1]).toEqual(FORMAT_2_26.shops.bowl.contracts[1]);
    expect(next.shops.nose).toEqual(FORMAT_2_26.shops.nose);
    expect({ ...next, player: { ...next.player, contracts: [] }, shops: {} }).toEqual({ ...FORMAT_2_26, player: { ...FORMAT_2_26.player, contracts: [] }, shops: {} });
  });
});

describe('save migration 27 to 28', () => {
  const before = structuredClone(FORMAT_2_27);
  const next = MIGRATIONS[27](FORMAT_2_27) as { salvage: { id: string }[]; player: { scavenged: string[] }; vehicles: { job: { stockId: string } | null }[] };

  it('drops the Glass Flats stock and its searched mark, and keeps every other stock', () => {
    expect(next.salvage.map((stock) => stock.id)).toEqual(FORMAT_2_27.salvage.map((stock) => stock.id).filter((id) => id !== 'glass-flats'));
    expect(next.player.scavenged).toEqual(['podfield', 'wreck4']);
  });

  it('ends a search of the old stock, keeps other searches and does not mutate its input', () => {
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[1]).toEqual(FORMAT_2_27.vehicles[1]);
    expect(FORMAT_2_27).toEqual(before);
  });
});

describe('save migration 28 to 29', () => {
  it('gives the world the default Roaming setup and keeps every other field', () => {
    const next = MIGRATIONS[28](FORMAT_2_28);

    expect(next).toEqual({ ...FORMAT_2_28, setup: { mode: 'roaming', settings: { damage: 1, fuelUse: 1, supplyUse: 1 } } });
  });
});

describe('save migration 29 to 30', () => {
  const next = MIGRATIONS[29](structuredClone(FORMAT_2_29)) as typeof FORMAT_2_29;
  const cents = (money: number) => Math.round((money * 100) / 3);

  it('turns player money, debt included, cost basis and contract rewards into cents', () => {
    expect(next.player.money).toBe(-33333);
    expect(next.player.costBasis).toEqual({ scrap: 350, salt: 700 });
    expect(next.player.contracts[0].reward).toBe(4000);
    expect(next.shops.bowl.contracts[0].reward).toBe(10000);
    expect(next.shops.bowl.pressure).toEqual(FORMAT_2_29.shops.bowl.pressure);
  });

  it('turns the open call\'s money, deal and prices into cents and leaves other vars alone', () => {
    const { vars, line } = next.player.call;
    expect(vars.fee).toEqual({ kind: 'money', amount: 1500 });
    expect(vars.deal).toEqual({ ...FORMAT_2_29.player.call.vars.deal, price: 1000 });
    expect(vars.town).toEqual(FORMAT_2_29.player.call.vars.town);
    expect(line.vars.prices.goods).toEqual([{ good: 'salt', buy: cents(31), sell: 700 }]);
    expect(line.vars.far).toEqual(FORMAT_2_29.player.call.line.vars.far);
    expect(line.text).toBe(FORMAT_2_29.player.call.line.text);
  });

  it('turns driver wallets and pile bases into cents and keeps fuel, memories and stock', () => {
    expect(next.vehicles[0]).toEqual(FORMAT_2_29.vehicles[0]);
    expect(next.vehicles[1]).toEqual({ ...FORMAT_2_29.vehicles[1], resources: { ...FORMAT_2_29.vehicles[1].resources, money: cents(1250) } });
    expect(next.removed[0].resources.money).toBe(233);
    expect(next.salvage[0]).toEqual(FORMAT_2_29.salvage[0]);
    expect(next.salvage[1].pile).toEqual({ ...FORMAT_2_29.salvage[1].pile, basis: { salt: 750 } });
  });

  it('turns every fee and price in a deal state into cents and nothing else', () => {
    const data = next.states.map((s) => s.data as Record<string, unknown>);
    expect(data[0]).toEqual({ ...FORMAT_2_29.states[0].data, fee: cents(55), waived: 0 });
    expect(data[1]).toEqual({ ...FORMAT_2_29.states[1].data, fee: 600 });
    expect(data[2]).toEqual({ ...FORMAT_2_29.states[2].data, fee: 2600 });
    expect(data[3]).toEqual({ ...FORMAT_2_29.states[3].data, price: cents(32) });
    expect(data[4]).toEqual({ ...FORMAT_2_29.states[4].data, price: cents(22) });
    expect(next.states[5]).toEqual(FORMAT_2_29.states[5]);
  });

  it('turns money in events into cents, and scales only money practice amounts', () => {
    const e = next.events as Record<string, unknown>[];
    expect(e[0].amount).toBe(-400);
    expect(e[1].amount).toBeCloseTo(450);
    expect(e[2].amount).toBeCloseTo(1000);
    expect(e[3].amount).toBeCloseTo(300);
    expect(e[4]).toEqual(FORMAT_2_29.events[4]);
    expect((e[5].contract as { reward: number }).reward).toBe(5000);
    expect([e[6].fee, e[7].fee, e[8].fee, e[9].fee]).toEqual([cents(55), 600, 2600, 2600]);
    expect(e[10].paid).toBe(cents(22));
    expect(((e[11].state as { data: { price: number } }).data).price).toBe(500);
    expect(e[12].vars).toEqual({ fee: { kind: 'money', amount: 100 } });
    expect(e[13]).toEqual(FORMAT_2_29.events[13]);
    for (const [i, ev] of e.entries()) if (ev.t === 'practice') expect(ev.xp, `event ${i}`).toBe(FORMAT_2_29.events[i].xp);
  });

  it('keeps the turn and touches nothing outside money', () => {
    expect(next.turn).toBe(FORMAT_2_29.turn);
    expect(next.player.fuel).toBe(FORMAT_2_29.player.fuel);
  });

  it('throws on a money field that is not a number', () => {
    const bad = { ...structuredClone(FORMAT_2_29), player: { ...structuredClone(FORMAT_2_29.player), money: 'x' } };
    expect(() => MIGRATIONS[29](bad)).toThrow(/player money/);
  });

  it('converts every money-named field of the saved shape', () => {
    const MONEY_KEYS = new Set(['money', 'reward', 'fee', 'waived', 'price', 'paid', 'amount', 'buy', 'sell', 'basis', 'costBasis']);
    const CONVERTED = new Set([
      '.player.money', '.player.costBasis', '.player.contracts[].reward', '.shops.*.contracts[].reward',
      '.vehicles[].resources.money', '.removed[].resources.money', '.salvage[].pile.basis',
      '.states[].data.fee', '.states[].data.waived', '.states[].data.price',
    ]);
    const found: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((x) => walk(x, `${path}[]`));
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        const at = path === '.shops' ? `${path}.*` : `${path}.${key}`;
        if (MONEY_KEYS.has(key)) found.push(at);
        walk(value, at);
      }
    };
    walk(SAVE_SHAPE.shape, '');
    expect(found.length).toBeGreaterThan(0);
    for (const at of found) expect(CONVERTED.has(at), at).toBe(true);
  });
});

describe('save migration 30 to 31', () => {
  const next = MIGRATIONS[30](FORMAT_2_30) as typeof FORMAT_2_30;

  it('keeps the world as it was', () => {
    expect(next).toEqual(FORMAT_2_30);
  });

  it('leaves a raid on its way without a watch end, so it watches once it arrives', () => {
    const raid = next.vehicles[1].brain!.goals[0];

    expect(raid.phase).toBe('travel');
    expect('watchUntil' in raid).toBe(false);
  });
});

describe('save migration 31 to 32', () => {
  const next = MIGRATIONS[31](FORMAT_2_31) as Record<string, unknown> & { vehicles: object[]; player: object; broken: object[] };

  it('drops trails, the visible tiles, the last turn events and removed vehicles', () => {
    expect(next.vehicles).toEqual(FORMAT_2_31.vehicles.map(({ trail: _t, ...rest }) => rest));
    expect('events' in next).toBe(false);
    expect('removed' in next).toBe(false);
    const { visible: _v, ...player } = FORMAT_2_31.player;
    expect(next.player).toEqual(player);
  });

  it('keeps only the id and turn of a broken prop', () => {
    expect(next.broken).toEqual([{ id: 'deadTree-1354', turn: 2559 }]);
  });

  it('keeps dust clouds, contacts and clouds', () => {
    expect(next.dustClouds).toEqual(FORMAT_2_31.dustClouds);
    expect(next.turn).toBe(FORMAT_2_31.turn);
  });
});

describe('save migration 32 to 33', () => {
  it('drops the contacts and seen clouds and keeps the dust clouds', () => {
    const next = MIGRATIONS[32](FORMAT_2_32);
    const { contacts: _c, clouds: _s, ...player } = FORMAT_2_32.player;

    expect(next).toEqual({ ...FORMAT_2_32, player });
  });
});

describe('save migration 33 to 34', () => {
  it('keeps a save with only price memories as it is', () => {
    expect(MIGRATIONS[33](structuredClone(FORMAT_2_33))).toEqual(FORMAT_2_33);
  });
});

describe('save migration 34 to 35', () => {
  type Goal = { reason: string };
  type Saved = {
    vehicles: { id: string; name?: string; brain: { goals: Goal[] } | null }[];
    player: { call: { line: unknown } | null; contracts: Record<string, unknown>[] };
    shops: Record<string, { contracts: Record<string, unknown>[] }>;
  };
  const next = MIGRATIONS[34](FORMAT_2_34) as unknown as Saved;
  const reasons = (v: { brain: { goals: Goal[] } | null }) => v.brain?.goals.map((g) => g.reason);

  it('turns known goal reasons into ids, an old phrase into the id that replaced it, and an unknown one into legacy', () => {
    expect(reasons(next.vehicles[1])).toEqual(['buyCargo', 'lowFuel']);
    expect(reasons(next.vehicles[2])).toEqual(['explore', 'legacy']);
    expect(reasons(next.vehicles[3])).toEqual(['raid']);
  });

  it('removes the names of trucks and bounty targets', () => {
    expect(next.vehicles.some((v) => 'name' in v)).toBe(false);
    expect(next.player.contracts.map((c) => 'targetName' in c)).toEqual([false, false]);
    expect('targetName' in next.shops.nose.contracts[0]).toBe(false);
    expect(next.player.contracts[0]).toEqual({ id: 'c1', shop: 'bowl', kind: 'bounty', template: 'buggy', reward: 400, deadline: 990, window: 300, tier: 2 });
  });

  it('keeps an open call on a known line as its id', () => {
    expect(next.player.call?.line).toEqual({ line: 'dealTerms', vars: FORMAT_2_34.player.call.line.vars });
  });

  it('hangs up a call on a line no table knows', () => {
    const unknown = { ...FORMAT_2_34, player: { ...FORMAT_2_34.player, call: { ...FORMAT_2_34.player.call, line: { text: 'Words from a mod', vars: {} } } } };
    expect((MIGRATIONS[34](unknown) as unknown as Saved).player.call).toBeNull();
  });
});
