import { describe, expect, it } from 'vitest';
import { CONTRACTS, EFFORT, SHOPS } from '../data/market';
import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { playerVehicle } from './damage';
import { makePart } from './factory';
import { corePart, goodsCount, mountedItems } from './grid';
import { stowPart } from './inventory';
import { sitePads } from './sites';
import { addVehicle, emptyWorld, npcBrain, practiceOf, testDrive } from './testkit';
import { vehicleStats } from './stats';
import { fireWeapons, resolveDestroyed } from './combat';
import type { GameEvent, Vehicle, World } from './types';
import { endTurn, update } from './world';
import {
  acceptContract,
  advanceContracts,
  advanceShops,
  bountyReward,
  deliverContract,
  goodValue,
  bountyLapsed,
  contractReward,
  estimateTurns,
  fetchReward,
  contractXp,
  haulPenalty,
  haulWindow,
  initializeShops,
  isExpired,
  playerDefeats,
  partPristineBuyPrice,
  rollContract,
  vehicleValue,
  type Contract,
} from './market';

function addRaider(w: World, templateId: string, pos = { x: 5, y: 5 }): Vehicle {
  const v = addVehicle(w, 'raiders', 'buggy', [], pos);
  v.brain = npcBrain(templateId, pos, ['raider']);
  return v;
}

describe('estimateTurns', () => {
  it('grows with distance', () => {
    const near = estimateTurns({ x: 0, y: 0 }, { x: 10, y: 0 });
    const far = estimateTurns({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(far).toBeGreaterThan(near);
  });
});

describe('contractReward', () => {
  it('scales with turns', () => {
    const short = contractReward(50, 1, 0, false);
    const long = contractReward(200, 1, 0, false);
    expect(long).toBeGreaterThan(short);
  });

  it('scales with tier at the same turns', () => {
    const tier1 = contractReward(100, 1, 0, false);
    const tier3 = contractReward(100, 3, 0, false);
    expect(tier3).toBeGreaterThan(tier1);
  });

  it('adds a cut of cargo value to the reward', () => {
    const plain = contractReward(100, 2, 0, false);
    const withCargo = contractReward(100, 2, 1000, false);
    expect(withCargo).toBeGreaterThan(plain);
  });
});

describe('haul pay and rush', () => {
  it('pays a standard haul at least double salvage over the estimated round trip', () => {
    const towns = [...REGION.towns, ...REGION.locations];
    for (const a of towns) {
      for (const b of towns) {
        if (a === b) continue;
        const turns = estimateTurns(a.pos, b.pos);
        for (const tier of [1, 2, 3] as const) {
          expect(contractReward(turns, tier, 0, false)).toBeGreaterThanOrEqual(Math.floor(4 * EFFORT.wage[tier] * turns));
        }
      }
    }
  });

  it('gives a rush haul a shorter window and a higher reward than a standard one', () => {
    expect(haulWindow(100, true)).toBeLessThan(haulWindow(100, false));
    expect(contractReward(100, 1, 50, true)).toBeGreaterThan(contractReward(100, 1, 50, false));
  });

  it('rolls both rush and standard hauls, and leaves the main rng alone', () => {
    const w = emptyWorld();
    const before = w.rngState;
    const rolled = new Set<boolean>();
    for (let i = 0; i < 100; i++) {
      const c = rollContract(w, { id: 'bowl', pos: { x: 0, y: 0 } }, [{ id: 'nose', pos: { x: 100, y: 0 } }], ['salt'], [], []);
      if (c?.kind === 'haul') {
        rolled.add(c.rush);
        expect(c.window).toBe(haulWindow(estimateTurns({ x: 0, y: 0 }, { x: 100, y: 0 }), c.rush));
      }
    }
    expect(rolled.size).toBe(2);
    expect(w.rngState).toBe(before);
  });
});

describe('vehicleValue', () => {
  it('sums the chassis value and every part it carries', () => {
    const w = emptyWorld();
    const raider = addRaider(w, 'buggy');
    const bare = vehicleValue(raider);
    expect(bare).toBeGreaterThanOrEqual(chassisDef('buggy').value);
    stowPart(w, raider, makePart(w, 'plates', 0));
    expect(vehicleValue(raider)).toBeGreaterThan(bare);
  });
});

describe('bountyReward', () => {
  it('pays turns of tier 1 wage set per raider template, more for a gunwagon than an outrider', () => {
    expect(bountyReward('buggy')).toBe(Math.round(CONTRACTS.bounty.rewardTurns.buggy * EFFORT.wage[1]));
    expect(bountyReward('gunwagon')).toBeGreaterThan(bountyReward('buggy'));
  });

  it('throws for a template with no bounty reward', () => {
    expect(() => bountyReward('trader')).toThrow(/trader/);
  });
});

describe('contractXp', () => {
  it('pays fetch XP for the search fee only, not the part price', () => {
    const cheap: Contract = { id: 'a', shop: 'bowl', kind: 'fetch', defId: 'panniers', reward: fetchReward('panniers', 1), deadline: 500, window: 500, tier: 1 };
    const dear: Contract = { ...cheap, defId: 'cage', reward: fetchReward('cage', 1) };
    expect(contractXp(cheap)).toBe(contractXp(dear));
    expect(contractXp(cheap)).toBe(Math.round(CONTRACTS.fetch.searchFeeTurns * EFFORT.wage[1] * CONTRACTS.fetch.xpPerEffort));
  });
});

describe('fetchReward', () => {
  it('exceeds the part\'s buy price by exactly the search fee', () => {
    for (const defId of ['mg', 'plates', 'stockEngine']) {
      for (const tier of [1, 2, 3] as const) {
        const fee = Math.round(CONTRACTS.fetch.searchFeeTurns * EFFORT.wage[tier]);
        expect(fetchReward(defId, tier)).toBe(partPristineBuyPrice(defId) + fee);
      }
    }
  });

  it('pays more for a pricier part at the same tier', () => {
    expect(PARTS.cage.value).toBeGreaterThan(PARTS.stockEngine.value);
    expect(PARTS.cage.tier).toBe(PARTS.stockEngine.tier);
    const cheap = fetchReward('stockEngine', PARTS.stockEngine.tier);
    const dear = fetchReward('cage', PARTS.cage.tier);
    expect(dear).toBeGreaterThan(cheap);
  });
});

describe('rollContract', () => {
  const shop = { id: 'bowl', pos: { x: 0, y: 0 } };
  const places = [{ id: 'nose', pos: { x: 100, y: 0 } }];
  const goods = ['salt'];
  const partDefIds = ['mg'];

  it('is deterministic for the same rng state', () => {
    const w1 = emptyWorld();
    const w2 = emptyWorld();
    w1.marketRng.rngState = 42;
    w2.marketRng.rngState = 42;
    const raider = addRaider(w1, 'buggy');
    addRaider(w2, 'buggy');
    const c1 = rollContract(w1, shop, places, goods, partDefIds, [raider]);
    const c2 = rollContract(w2, shop, places, goods, partDefIds, [w2.vehicles.find((v) => v.faction === 'raiders')!]);
    expect(c1).toEqual(c2);
  });

  it('returns null when every kind is impossible', () => {
    const w = emptyWorld();
    expect(rollContract(w, shop, [], [], [], [])).toBeNull();
  });

  it('never rolls a bounty when there are no raiders', () => {
    const w = emptyWorld();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, places, goods, partDefIds, []);
      expect(c?.kind).not.toBe('bounty');
    }
  });

  it('never rolls a haul when there are no other places', () => {
    const w = emptyWorld();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, [], goods, partDefIds, []);
      expect(c?.kind).not.toBe('haul');
    }
  });

  it('never rolls a fetch when there are no part defs', () => {
    const w = emptyWorld();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, places, goods, [], []);
      expect(c?.kind).not.toBe('fetch');
    }
  });

  it('sets a haul deadline at the current turn plus its window', () => {
    const w = emptyWorld();
    w.turn = 10;
    let haul: Contract | null = null;
    for (let i = 0; i < 50 && !haul; i++) {
      const c = rollContract(w, shop, places, goods, [], []);
      if (c?.kind === 'haul') haul = c;
    }
    expect(haul).not.toBeNull();
    expect(haul!.deadline).toBe(w.turn + haul!.window);
  });

  it('takes a haul\'s tier from the hauled good, not a random roll', () => {
    const w = emptyWorld();
    const dearGoods = ['tools'];
    let haul: Contract | null = null;
    for (let i = 0; i < 50 && !haul; i++) {
      const c = rollContract(w, shop, places, dearGoods, [], []);
      if (c?.kind === 'haul') haul = c;
    }
    expect(haul).not.toBeNull();
    expect(haul!.tier).toBe(GOODS.tools.tier);
  });

  it('takes a fetch\'s tier from the fetched part, not a random roll', () => {
    const w = emptyWorld();
    let fetchContract: Contract | null = null;
    for (let i = 0; i < 50 && !fetchContract; i++) {
      const c = rollContract(w, shop, [], [], ['workhorseDiesel'], []);
      if (c?.kind === 'fetch') fetchContract = c;
    }
    expect(fetchContract).not.toBeNull();
    expect(fetchContract!.tier).toBe(PARTS.workhorseDiesel.tier);
  });

  it('takes a bounty\'s tier from the highest tier fitted to the target', () => {
    const w = emptyWorld();
    const raider = addRaider(w, 'buggy');
    const stowed = stowPart(w, raider, makePart(w, 'plates', 0));
    expect(stowed).toBe(true);
    let bounty: Contract | null = null;
    for (let i = 0; i < 50 && !bounty; i++) {
      const c = rollContract(w, shop, [], [], [], [raider]);
      if (c?.kind === 'bounty') bounty = c;
    }
    expect(bounty).not.toBeNull();
    expect(bounty!.tier).toBe(PARTS.plates.tier);
  });

  it('pays a bounty the same reward whatever its random deadline window', () => {
    const w = emptyWorld();
    const raider = addRaider(w, 'buggy');
    const rewards = new Set<number>();
    const deadlines = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const c = rollContract(w, shop, [], [], [], [raider]);
      if (c?.kind === 'bounty') {
        rewards.add(c.reward);
        deadlines.add(c.deadline);
      }
    }
    expect(deadlines.size).toBeGreaterThan(1);
    expect(rewards.size).toBe(1);
  });
});

describe('isExpired', () => {
  it('is false at the deadline and true after it', () => {
    const w = emptyWorld();
    const c = { deadline: 20 } as Contract;
    w.turn = 20;
    expect(isExpired(w, c)).toBe(false);
    w.turn = 21;
    expect(isExpired(w, c)).toBe(true);
  });
});

describe('bounty settlement', () => {
  const held = (id: string, template = 'buggy', shop = 'bowl'): Contract =>
    ({ id, shop, kind: 'bounty', template, targetName: 'Raider outrider', reward: 100, deadline: 900, window: 900, tier: 1, fulfilled: false });

  function settle(w: World, contracts: Contract[], events: GameEvent[], removed: Vehicle[] = []): World {
    return update(w, (d) => {
      d.player.contracts = contracts;
      d.removed = removed;
      d.events = events;
      advanceContracts(d);
    });
  }

  const done = (w: World) => w.events.flatMap((e) => (e.t === 'contract' && e.outcome === 'fulfilled' ? [e.contract.id] : []));

  it('counts the player\'s kill of any truck of the template', () => {
    const w = emptyWorld();
    const outrider = addRaider(w, 'buggy');
    const other = addRaider(w, 'warband');
    const kill = (v: Vehicle, by: string) => {
      w.removed = [v];
      w.events = [{ t: 'destroyed', vehicle: v.id, by }];
      return playerDefeats(w);
    };
    expect(kill(outrider, w.player.vehicleId)).toEqual(new Map([['buggy', 1]]));
    expect(kill(outrider, 'other-npc')).toEqual(new Map());
    expect(kill(other, w.player.vehicleId)).toEqual(new Map([['warband', 1]]));
  });

  it('counts the player\'s knockout of a truck of the template, which stays in the world', () => {
    const w = emptyWorld();
    const outrider = addRaider(w, 'buggy');
    w.removed = [];
    w.events = [{ t: 'npcKnockout', vehicle: outrider.id, by: 'other-npc' }];
    expect(playerDefeats(w)).toEqual(new Map());
    w.events = [{ t: 'npcKnockout', vehicle: outrider.id, by: w.player.vehicleId }];
    expect(playerDefeats(w)).toEqual(new Map([['buggy', 1]]));
  });

  it('two knockouts in one turn fulfil two held bounties from two shops, each paid when claimed', () => {
    const w = emptyWorld();
    const a = addRaider(w, 'buggy');
    const b = addRaider(w, 'buggy', { x: 20, y: 5 });
    const me = w.player.vehicleId;
    const after = settle(w, [held('b1', 'buggy', 'bowl'), held('b2', 'buggy', 'nose')], [
      { t: 'npcKnockout', vehicle: a.id, by: me },
      { t: 'npcKnockout', vehicle: b.id, by: me },
    ]);
    expect(done(after)).toEqual(['b1', 'b2']);
    expect(after.player.money).toBe(w.player.money);
    expect(after.player.contracts.map((c) => c.kind === 'bounty' && c.fulfilled)).toEqual([true, true]);
  });

  it('one knockout fulfils only the first held bounty', () => {
    const w = emptyWorld();
    const a = addRaider(w, 'buggy');
    addRaider(w, 'buggy', { x: 20, y: 5 });
    const after = settle(w, [held('b1'), held('b2')], [{ t: 'npcKnockout', vehicle: a.id, by: w.player.vehicleId }]);
    expect(done(after)).toEqual(['b1']);
    expect(after.player.contracts.map((c) => c.kind === 'bounty' && c.fulfilled)).toEqual([true, false]);
  });

  it('a wreck of a truck already lying defeated or heading home finishes nothing, and of one still fighting finishes one', () => {
    for (const phase of ['out', 'retreat'] as const) {
      const w = emptyWorld();
      const a = addRaider(w, 'buggy');
      addRaider(w, 'buggy', { x: 20, y: 5 });
      a.defeat = { phase, turns: 0, unseen: 0, foes: [], gaveUp: false };
      w.vehicles = w.vehicles.filter((v) => v.id !== a.id);
      const after = settle(w, [held('b1')], [{ t: 'destroyed', vehicle: a.id, by: w.player.vehicleId }], [a]);
      expect(done(after)).toEqual([]);
      delete a.defeat;
      expect(done(settle(w, [held('b1')], [{ t: 'destroyed', vehicle: a.id, by: w.player.vehicleId }], [a]))).toEqual(['b1']);
    }
  });

  it('a defeat of another template, or by another truck, finishes nothing', () => {
    const w = emptyWorld();
    const gunwagon = addRaider(w, 'gunwagon');
    const outrider = addRaider(w, 'buggy', { x: 20, y: 5 });
    expect(done(settle(w, [held('b1')], [{ t: 'npcKnockout', vehicle: gunwagon.id, by: w.player.vehicleId }]))).toEqual([]);
    expect(done(settle(w, [held('b1')], [{ t: 'npcKnockout', vehicle: outrider.id, by: 'other-npc' }]))).toEqual([]);
  });

  it('a bounty fulfilled on its deadline turn is met, and one past it fails', () => {
    const w = emptyWorld();
    const outrider = addRaider(w, 'buggy');
    w.turn = 900;
    expect(done(settle(w, [held('b1')], [{ t: 'npcKnockout', vehicle: outrider.id, by: w.player.vehicleId }]))).toEqual(['b1']);
    w.turn = 901;
    const late = settle(w, [held('b1')], []);
    expect(late.events).toContainEqual(expect.objectContaining({ t: 'contract', outcome: 'failed' }));
  });

  it('throws on a defeat of a truck in neither list', () => {
    const w = emptyWorld();
    w.events = [{ t: 'npcKnockout', vehicle: 'ghost', by: w.player.vehicleId }];
    expect(() => playerDefeats(w)).toThrow(/ghost/);
  });
});

describe('bountyLapsed', () => {
  it('is true once no truck of the template is left in the world', () => {
    const w = emptyWorld();
    const first = addRaider(w, 'buggy');
    const second = addRaider(w, 'buggy', { x: 20, y: 5 });
    const c = { kind: 'bounty', template: 'buggy' } as Contract;
    w.vehicles = w.vehicles.filter((v) => v.id !== first.id);
    expect(bountyLapsed(w, c)).toBe(false);
    w.vehicles = w.vehicles.filter((v) => v.id !== second.id);
    expect(bountyLapsed(w, c)).toBe(true);
  });
});

describe('haulPenalty', () => {
  it('owes the full value of the hauled units', () => {
    const c = { kind: 'haul', units: 5 } as Extract<Contract, { kind: 'haul' }>;
    expect(haulPenalty(c, 20)).toBe(100);
  });
});

describe('contract boards and delivery', () => {
  const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
  const nose = REGION.towns.find((t) => t.id === 'nose')!;
  const haul = (to: string, units: number): Contract => ({ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'salt', units, to, reward: 10000, deadline: 500, window: 500, rush: false, tier: 1 });
  const fetch = (): Contract => ({ id: 'ct-fetch', shop: 'bowl', kind: 'fetch', defId: 'mg', reward: fetchReward('mg', 1), deadline: 500, window: 500, tier: 1 });

  function atBowlWithOffer(c: Contract): World {
    const w = emptyWorld(sitePads(bowl)[0]);
    w.shops.bowl.contracts = [c];
    return w;
  }

  it('posts contracts on every shop board at world creation', () => {
    const w = emptyWorld();
    for (const id of Object.keys(SHOPS)) expect(w.shops[id].contracts.length).toBeGreaterThan(0);
  });

  it('never posts a fetch for a part the shop has in stock', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = emptyWorld();
      w.marketRng.rngState = seed;
      initializeShops(w);
      for (const state of Object.values(w.shops)) {
        const stocked = new Set(state.stock.map((p) => p.defId));
        for (const c of state.contracts) if (c.kind === 'fetch') expect(stocked.has(c.defId)).toBe(false);
      }
    }
  });

  it('loads haul cargo on acceptance and pays on delivery at the destination', () => {
    let w = atBowlWithOffer(haul('nose', 3));
    w = acceptContract(w, 'ct-haul');
    expect(goodsCount(playerVehicle(w)).salt).toBe(3);
    expect(w.shops.bowl.contracts).toHaveLength(0);
    w.vehicles[0].pos = { ...sitePads(nose)[0] };
    const money = w.player.money;
    w = deliverContract(w, 'ct-haul');
    expect(w.player.money).toBe(money + 10000);
    expect(goodsCount(playerVehicle(w)).salt ?? 0).toBe(0);
    expect(w.player.contracts).toHaveLength(0);
  });

  it('counts haul cargo as paid at its value, so selling it pays no trade XP', () => {
    const w = atBowlWithOffer(haul('nose', 3));
    w.vehicles[0].items = w.vehicles[0].items.filter((it) => it.kind !== 'good' || it.good !== 'salt');
    const next = acceptContract(w, 'ct-haul');
    expect(next.player.costBasis.salt).toBeCloseTo(goodValue('salt'));
  });

  it('pays the contract XP to the pool, targeting the posting shop', () => {
    let w = acceptContract(atBowlWithOffer(haul('nose', 3)), 'ct-haul');
    w.vehicles[0].pos = { ...sitePads(nose)[0] };
    const pool = w.player.xp;
    w = deliverContract(w, 'ct-haul');
    expect(practiceOf(w, 'contract')).toMatchObject([{ amount: 30, difficulty: null, target: 'bowl', xp: 30 }]);
    expect(w.player.xp).toBeCloseTo(pool + 30);
  });

  it('refuses a haul delivery away from its destination', () => {
    const w = acceptContract(atBowlWithOffer(haul('nose', 3)), 'ct-haul');
    expect(() => deliverContract(w, 'ct-haul')).toThrow(/Not parked at nose/);
  });

  it('refuses a haul that does not fit the grid and leaves the board unchanged', () => {
    const w = atBowlWithOffer(haul('nose', 999));
    expect(() => acceptContract(w, 'ct-haul')).toThrow(/free cells/);
    expect(w.shops.bowl.contracts).toHaveLength(1);
  });

  it('takes a fetch part from garage storage', () => {
    let w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    w = update(w, (d) => { d.player.storage.push(makePart(d, 'mg', 1)); });
    const money = w.player.money;
    w = deliverContract(w, 'ct-fetch');
    expect(w.player.storage).toHaveLength(0);
    expect(w.player.money).toBe(money + fetchReward('mg', 1));
  });

  it('refuses a fetch part worn past CONTRACTS.fetch.maxWear', () => {
    let w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    w = update(w, (d) => { d.player.storage.push(makePart(d, 'mg', CONTRACTS.fetch.maxWear + 1)); });
    expect(() => deliverContract(w, 'ct-fetch')).toThrow(/spare/);
  });

  it('refuses a fetch part at 0 HP', () => {
    let w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    w = update(w, (d) => {
      const part = makePart(d, 'mg', 0);
      part.hp = 0;
      d.player.storage.push(part);
    });
    expect(() => deliverContract(w, 'ct-fetch')).toThrow(/spare/);
  });

  it('refuses a junk fetch part', () => {
    let w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    w = update(w, (d) => {
      const part = { ...makePart(d, 'mg', 0), wear: 99, hp: 0 };
      d.player.storage.push(part);
    });
    expect(() => deliverContract(w, 'ct-fetch')).toThrow(/spare/);
  });

  it('refuses a fetch with no spare part of that type', () => {
    const w = acceptContract(atBowlWithOffer(fetch()), 'ct-fetch');
    expect(() => deliverContract(w, 'ct-fetch')).toThrow(/spare/);
  });

  it('holds at most the active limit', () => {
    let w = atBowlWithOffer(fetch());
    w = update(w, (d) => {
      d.player.contracts = Array.from({ length: CONTRACTS.maxActive }, (_, i) => ({ ...fetch(), id: `held${i}` }));
    });
    expect(() => acceptContract(w, 'ct-fetch')).toThrow(/already hold/);
  });

  it('charges the goods value when a haul expires', () => {
    let w = acceptContract(atBowlWithOffer(haul('nose', 3)), 'ct-haul');
    const money = w.player.money;
    w = update(w, (d) => { d.turn += 501; advanceContracts(d); });
    expect(w.player.contracts).toHaveLength(0);
    expect(w.player.money).toBe(money - haulPenalty(haul('nose', 3) as Extract<Contract, { kind: 'haul' }>, goodValue('salt')));
  });

  it('warns once when a held contract is two game hours from its deadline', () => {
    let w = acceptContract(atBowlWithOffer(haul('nose', 3)), 'ct-haul');
    const warned = (turn: number) =>
      update(w, (d) => { d.turn = turn; d.events = []; advanceContracts(d); }).events.filter((e) => e.t === 'contract' && e.outcome === 'expiring');
    const deadline = w.player.contracts[0].deadline;
    expect(warned(deadline - CONTRACTS.warnTurns - 1)).toHaveLength(0);
    expect(warned(deadline - CONTRACTS.warnTurns)).toHaveLength(1);
    expect(warned(deadline - CONTRACTS.warnTurns + 1)).toHaveLength(0);
  });

  const bounty = (id: string, targetName = 'Target'): Contract =>
    ({ id, shop: 'bowl', kind: 'bounty', template: 'buggy', targetName, reward: 400, deadline: 900, window: 900, tier: 2, fulfilled: false });

  function holding(...held: Contract[]): { w: World; raider: Vehicle } {
    const w = emptyWorld(sitePads(bowl)[0]);
    const raider = addRaider(w, 'buggy', { x: 50, y: 50 });
    w.player.contracts = held;
    return { w, raider };
  }

  const kill = (raider: Vehicle, gone = true) => (d: World) => {
    if (gone) d.vehicles = d.vehicles.filter((v) => v.id !== raider.id);
    d.removed = gone ? [raider] : [];
    d.events = [{ t: 'destroyed', vehicle: raider.id, by: d.player.vehicleId }];
    advanceContracts(d);
  };

  const fulfilledOf = (w: World) => w.player.contracts.map((c) => c.kind === 'bounty' && c.fulfilled);

  it('marks a bounty fulfilled on the player kill, pays nothing yet, and keeps it though the target is gone', () => {
    const { w: base, raider } = holding(bounty('ct-b'));
    const w = update(base, kill(raider));
    expect(w.player.money).toBe(base.player.money);
    expect(practiceOf(w, 'contract')).toEqual([]);
    expect(fulfilledOf(w)).toEqual([true]);
    expect(w.events).toContainEqual({ t: 'contract', contract: { ...bounty('ct-b'), fulfilled: true }, outcome: 'fulfilled' });
  });

  it('lapses an unfulfilled bounty when the target leaves', () => {
    const { w: base, raider } = holding(bounty('ct-b'));
    const lapsed = update(base, (d) => {
      d.vehicles = d.vehicles.filter((v) => v.id !== raider.id);
      advanceContracts(d);
    });
    expect(lapsed.player.money).toBe(base.player.money);
    expect(lapsed.player.contracts).toHaveLength(0);
  });

  it('marks at most one held bounty per kill of the same template', () => {
    const { w: base, raider } = holding(bounty('ct-b1'), bounty('ct-b2'), bounty('ct-b3'));
    const w = update(base, kill(raider));
    expect(w.player.money).toBe(base.player.money);
    expect(w.player.contracts.map((c) => c.id)).toEqual(['ct-b1']);
    expect(fulfilledOf(w)).toEqual([true]);
  });

  it('marks the next same-template bounty on a later kill, never the fulfilled one again', () => {
    const { w: base, raider } = holding(bounty('ct-b1'), bounty('ct-b2'));
    const once = update(base, kill(raider, false));
    expect(fulfilledOf(once)).toEqual([true, false]);
    const twice = update(once, kill(raider, false));
    expect(fulfilledOf(twice)).toEqual([true, true]);
    expect(twice.events.filter((e) => e.t === 'contract' && e.outcome === 'fulfilled')).toHaveLength(1);
  });

  it('pays the reward and contract XP once when a fulfilled bounty is claimed at the shop that posted it', () => {
    const { w: base, raider } = holding(bounty('ct-b'));
    const met = update(base, kill(raider));
    const w = deliverContract(met, 'ct-b');
    expect(w.player.money).toBe(base.player.money + 400);
    expect(practiceOf(w, 'contract')).toMatchObject([{ amount: contractXp(bounty('ct-b')), target: 'bowl' }]);
    expect(w.player.contracts).toHaveLength(0);
    expect(() => deliverContract(w, 'ct-b')).toThrow(/No active contract/);
  });

  it('refuses a claim away from the shop that posted the bounty', () => {
    const { w: base, raider } = holding({ ...bounty('ct-b'), shop: 'nose' });
    const met = update(base, kill(raider));
    expect(() => deliverContract(met, 'ct-b')).toThrow(/Not parked at nose/);
  });

  it('refuses a claim on a bounty not met yet', () => {
    const { w } = holding(bounty('ct-b'));
    expect(() => deliverContract(w, 'ct-b')).toThrow(/not met/);
  });

  it('keeps a bounty fulfilled on its deadline claimable long after, with no warning or failure', () => {
    const { w: base, raider } = holding(bounty('ct-b'));
    let w = update(base, (d) => { d.turn = 900; });
    w = update(w, kill(raider));
    for (const turn of [900 - CONTRACTS.warnTurns, 901, 950]) {
      w = update(w, (d) => { d.turn = turn; d.events = []; advanceContracts(d); });
      expect(w.events.filter((e) => e.t === 'contract')).toEqual([]);
    }
    expect(deliverContract(w, 'ct-b').player.money).toBe(base.player.money + 400);
  });

  it('fails an unfulfilled bounty past its deadline and pays nothing', () => {
    const { w: base } = holding(bounty('ct-b'));
    const w = update(base, (d) => { d.turn = 901; advanceContracts(d); });
    expect(w.player.contracts).toHaveLength(0);
    expect(w.player.money).toBe(base.player.money);
    expect(w.events.some((e) => e.t === 'contract' && e.outcome === 'failed')).toBe(true);
  });

  it('never posts two bounties for the same template on one board', () => {
    const w = emptyWorld();
    addRaider(w, 'buggy', { x: 1, y: 1 });
    addRaider(w, 'buggy', { x: 2, y: 2 });
    addRaider(w, 'buggy', { x: 3, y: 3 });
    for (const seed of [1, 2, 3, 4, 5]) {
      w.marketRng.rngState = seed;
      initializeShops(w);
      for (const state of Object.values(w.shops)) {
        const templates = state.contracts.filter((c) => c.kind === 'bounty').map((c) => c.template);
        expect(new Set(templates).size).toBe(templates.length);
      }
    }
  });

  it('drops an expired offer from the board every turn, before any restock', () => {
    let w = atBowlWithOffer(haul('nose', 3));
    w.shops.bowl.restockAt = 10000;
    w = update(w, (d) => { d.turn = 501; advanceShops(d); });
    expect(w.shops.bowl.contracts.find((c) => c.id === 'ct-haul')).toBeUndefined();
  });

  it('starts the clock at acceptance for every kind', () => {
    const offers: Contract[] = [{ ...haul('nose', 3), deadline: 400, window: 300 }, { ...fetch(), deadline: 400, window: 300 }];
    for (const offer of offers) {
      let w = atBowlWithOffer(offer);
      w = update(w, (d) => { d.turn = 350; });
      w = acceptContract(w, offer.id);
      expect(w.player.contracts[0].deadline).toBe(650);
    }
  });

  it('delivers a rush haul like a standard one', () => {
    let w = acceptContract(atBowlWithOffer({ ...(haul('nose', 3) as Extract<Contract, { kind: 'haul' }>), rush: true }), 'ct-haul');
    w.vehicles[0].pos = { ...sitePads(nose)[0] };
    const money = w.player.money;
    w = deliverContract(w, 'ct-haul');
    expect(w.player.money).toBe(money + 10000);
    expect(goodsCount(playerVehicle(w)).salt ?? 0).toBe(0);
  });

  it('refuses to accept an offer past its deadline', () => {
    let w = atBowlWithOffer(haul('nose', 3));
    w = update(w, (d) => { d.turn = 501; });
    expect(() => acceptContract(w, 'ct-haul')).toThrow(/expired/);
  });
});

describe('bounties in a real fight', () => {
  const bounty = (id: string): Contract => ({ id, shop: 'bowl', kind: 'bounty', template: 'buggy', targetName: 'Raider outrider', reward: 100, deadline: 900, window: 900, tier: 1, fulfilled: false });
  const contractEvents = (w: World) => w.events.filter((e) => e.t === 'contract');

  function sharedFight(seed: number) {
    const w = emptyWorld();
    w.rngState = seed;
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const ally = addVehicle(w, 'bowl', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 33 }, -Math.PI / 2);
    ally.brain = npcBrain('bowlFarmer', ally.pos, ['lawman']);
    for (const it of mountedItems(raider)) if (it.part.id !== corePart(raider, 'cab').id && it.part.defId !== 'stockEngine') it.part.hp = 0;
    corePart(raider, 'cab').hp = 1;
    me.weaponOrders[vehicleStats(w, me).weapons[0].part.id] = { targetId: raider.id, aim: corePart(raider, 'cab').id };
    ally.weaponOrders[vehicleStats(w, ally).weapons[0].part.id] = { targetId: raider.id, aim: 'body' };
    w.player.contracts = [bounty('b1'), bounty('b2')];
    return { w, raider, ally };
  }

  function playerKnockout() {
    for (let seed = 1; seed <= 40; seed++) {
      const { w, raider, ally } = sharedFight(seed * 7919);
      const after = update(w, (d) => {
        fireWeapons(d);
        resolveDestroyed(d);
        advanceContracts(d);
      });
      const allyHit = after.events.some((e) => e.t === 'shot' && e.shooter === ally.id && e.rounds.some((r) => r.struck === raider.id && r.hits.some((h) => h.damage > 0)));
      const ko = after.events.some((e) => e.t === 'npcKnockout' && e.vehicle === raider.id && e.by === w.player.vehicleId);
      if (allyHit && ko) return { w, after, raider };
    }
    throw new Error('No seed gives a shared knockout');
  }

  it('a shared fight the player wins fulfils one held bounty that turn, and the next turn fulfils nothing more', () => {
    const { w, after } = playerKnockout();
    expect(contractEvents(after).map((e) => e.t === 'contract' && [e.contract.id, e.outcome])).toEqual([['b1', 'fulfilled']]);
    expect(after.player.money).toBe(w.player.money);
    const next = endTurn(after, testDrive);
    expect(contractEvents(next)).toEqual([]);
    expect(next.player.money).toBe(after.player.money);
  });

  it('shooting the knocked-out raider into a wreck fulfils no second held bounty', () => {
    const { after: out, raider } = playerKnockout();
    let w = out;
    const money = w.player.money;
    for (let turn = 0; turn < 30 && w.vehicles.some((v) => v.id === raider.id); turn++) {
      w = update(w, (d) => {
        const me = playerVehicle(d);
        me.weaponOrders[vehicleStats(d, me).weapons[0].part.id] = { targetId: raider.id, aim: 'body' };
      });
      w = endTurn(w, testDrive);
      expect(contractEvents(w).filter((e) => e.t === 'contract' && e.outcome === 'fulfilled')).toEqual([]);
    }
    expect(w.vehicles.some((v) => v.id === raider.id)).toBe(false);
    expect(w.player.money).toBe(money);
  });
});
