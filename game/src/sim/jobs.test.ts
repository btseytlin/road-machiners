import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { STRIP } from '../data/salvage';
import { WORK } from '../data/utilities';
import { CONDITION, REPAIR } from '../data/wear';
import { damagePart, partValue } from './wear';
import { makePart } from './factory';
import { addVehicle, emptyWorld, practiceOf , startCombat } from './testkit';
import { corePart, goodsCount, gridOf, mountedParts } from './grid';
import { addGoods, moveItem, mountPart, removeGoods, stowPart } from './inventory';
import { advanceJobs, cancelRefit, startAutoRepair, startJob, startRepair, startStrip, startWeld } from './jobs';
import { PERK_NUMBERS } from '../data/skills';
import { repairPlan } from './repair';
import { addState } from './states';

function armorPart(v: ReturnType<typeof emptyWorld>['vehicles'][0]) {
  const part = mountedParts(v).find((p) => partDef(p.defId).kind === 'armor')!;
  return part;
}

describe('field repair job', () => {
  it('finishes after its turns and restores HP up to the field cap', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const plan = repairPlan(w, me, cage.id);
    expect(plan.hp).toBeGreaterThan(0);

    const next = startRepair(w, cage.id);
    expect(next.vehicles[0].job).toEqual({ kind: 'repair', partId: cage.id, parts: plan.parts, turnsLeft: plan.turns, total: plan.turns });

    for (let i = 0; i < plan.turns - 1; i++) advanceJobs(next);
    expect(next.vehicles[0].job).not.toBeNull();
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    const fixed = armorPart(next.vehicles[0]);
    expect(fixed.hp).toBe(1 + plan.hp);
    expect(fixed.hp).toBeLessThanOrEqual(partDef(fixed.defId).hp * REPAIR.fieldCapShare + 0.001);
  });

  it('cancels on a turn the truck ends above parked speed, losing the finished turns', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const held = goodsCount(me).parts ?? 0;
    const next = startRepair(w, cage.id);
    advanceJobs(next); // one turn parked, progress made
    next.vehicles[0].speed = 5; // moves before the job finishes
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(armorPart(next.vehicles[0]).hp).toBe(1); // no HP gained, parts untouched
    expect(goodsCount(next.vehicles[0]).parts).toBe(held);
  });

  it('spends parts only when the job finishes', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const held = goodsCount(me).parts ?? 0;
    const plan = repairPlan(w, me, cage.id);
    expect(plan.turns).toBeGreaterThan(1);
    const next = startRepair(w, cage.id);
    for (let i = 0; i < plan.turns - 1; i++) advanceJobs(next);
    expect(goodsCount(next.vehicles[0]).parts).toBe(held); // not yet spent
    advanceJobs(next);
    expect(goodsCount(next.vehicles[0]).parts).toBe(held - plan.parts);
  });

  it('refuses to start once the part is already at the field cap', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = Math.floor(partDef(cage.defId).hp * REPAIR.fieldCapShare);
    addGoods(w, me, 'parts', 20);
    expect(() => startRepair(w, cage.id)).toThrow();
  });

  it('patches partway with the parts held when the full patch needs more', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 0;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    addGoods(w, me, 'parts', 1);
    const plan = repairPlan(w, me, cage.id);
    expect(plan.needed).toBeGreaterThan(1);
    expect(plan.parts).toBe(1);
    expect(plan.hp).toBeCloseTo((partDef(cage.defId).hp * GOODS.parts.value) / partValue(cage), 5);
    let next = startRepair(w, cage.id);
    for (let i = 0; i < plan.turns; i++) advanceJobs(next);
    const after = next.vehicles[0];
    expect(goodsCount(after).parts ?? 0).toBe(0);
    expect(mountedParts(after).find((p) => p.id === cage.id)!.hp).toBeCloseTo(plan.hp, 5);
  });

  it('refuses to start with no parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    expect(() => startRepair(w, cage.id)).toThrow('No parts');
  });

  it('runs the same repair code for an NPC', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'cage'], { x: 50, y: 50 });
    const cage = armorPart(npc);
    cage.hp = 1;
    addGoods(w, npc, 'parts', 20);
    const plan = repairPlan(w, npc, cage.id);
    startJob(w, npc, { kind: 'repair', partId: cage.id, parts: plan.parts, turnsLeft: plan.turns, total: plan.turns });
    for (let i = 0; i < plan.turns; i++) advanceJobs(w);
    expect(npc.job).toBeNull();
    expect(armorPart(npc).hp).toBe(1 + plan.hp);
  });

  it('needs the truck parked to use the oasis, salvage or start a job', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 5;
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    expect(() => startRepair(w, cage.id)).toThrow('Stop the truck first');
  });

  it('a standing player truck drops its leftover drive order to start a job', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    me.order = { kind: 'through', dest: { x: me.pos.x + 20, y: me.pos.y } };
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const next = startRepair(w, cage.id);
    const after = next.vehicles.find((v) => v.id === me.id)!;
    expect(after.job?.kind).toBe('repair');
    expect(after.order).toBeNull();
  });
});

describe('junk parts', () => {
  it('refuses a field repair of a junk part', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 0;
    cage.wear = CONDITION.maxWear + 1;
    addGoods(w, me, 'parts', 20);
    expect(() => startRepair(w, cage.id)).toThrow(/junk/);
  });

  it('cancels a field repair once its part breaks into junk', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    cage.wear = CONDITION.maxWear;
    addGoods(w, me, 'parts', 20);
    const next = startRepair(w, cage.id);
    damagePart(armorPart(next.vehicles[0]), 1, 0);
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(armorPart(next.vehicles[0]).hp).toBe(0);
    expect(next.events.some((e) => e.t === 'job' && e.outcome === 'cancelled')).toBe(true);
  });
});

describe('repair without parts', () => {
  it('cancels once the parts leave the grid mid-job', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 5);
    const next = startRepair(w, armorPart(me).id);
    const truck = next.vehicles[0];
    removeGoods(truck, 'parts', goodsCount(truck).parts ?? 0);
    advanceJobs(next);
    expect(truck.job).toBeNull();
    expect(next.events.some((e) => e.t === 'job' && e.outcome === 'cancelled')).toBe(true);
  });
});

describe('auto patch and promised parts', () => {
  // A damaged, parked player holding exactly `held` parts, and an NPC client a patch deal can name.
  function setup(held: number, deal: 'paid' | 'ownParts', playerIsPatcher: boolean) {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    mountedParts(me).find((p) => partDef(p.defId).kind === 'engine')!.hp = 1;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    addGoods(w, me, 'parts', held);
    const other = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 5, y: 0 }, 0);
    const [holder, client] = playerIsPatcher ? [me, other] : [other, me];
    const data = { kind: 'patch' as const, deal, parts: 2, partIds: [], price: 333, work: 4, workLeft: 4 };
    return { w, me, add: () => addState(w, 'patch', holder.id, client.id, data) };
  }

  it('starts no job when every part is promised to a deal', () => {
    const { w, me, add } = setup(2, 'paid', true);
    add();
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });

  it('spends only the parts above the promise', () => {
    const { w, me, add } = setup(3, 'paid', true);
    add();
    startAutoRepair(w);
    expect(me.job).not.toBeNull();
    for (let i = 0; i < 100 && me.job; i++) advanceJobs(w);
    expect(goodsCount(me).parts).toBe(2);
  });

  it('cancels a running job when a deal promises its parts', () => {
    const { w, me, add } = setup(2, 'paid', true);
    startAutoRepair(w);
    expect(me.job).not.toBeNull();
    add();
    advanceJobs(w);
    expect(me.job).toBeNull();
    expect(goodsCount(me).parts).toBe(2);
  });

  it('keeps the parts a stranded player promises as the client of an own-parts deal', () => {
    const { w, me, add } = setup(2, 'ownParts', false);
    add();
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });

  it('ignores a deal whose payer is the other truck', () => {
    const { w, me, add } = setup(2, 'ownParts', true);
    add();
    startAutoRepair(w);
    expect(me.job).not.toBeNull();
  });

  it('spends only the parts above what a haul contract carries', () => {
    const { w, me } = setup(4, 'paid', true);
    w.player.autoRepair = true;
    w.player.contracts.push({ id: 'ct-haul', shop: 'bowl', kind: 'haul', good: 'parts', units: 3, to: 'nose', reward: 10000, deadline: 500, window: 500, rush: false, tier: 1 });
    for (let i = 0; i < 100; i++) {
      startAutoRepair(w);
      advanceJobs(w);
    }
    expect(goodsCount(me).parts).toBe(3);
  });
});

describe('auto patch', () => {
  it('patches the most damaged part with one unit of parts while parked', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    const cage = armorPart(me);
    const engine = mountedParts(me).find((p) => partDef(p.defId).kind === 'engine')!;
    cage.hp = Math.round(partDef(cage.defId).hp * 0.5);
    engine.hp = 1;
    addGoods(w, me, 'parts', 5);
    const held = goodsCount(me).parts!;
    startAutoRepair(w);
    const plan = repairPlan(w, me, engine.id, 1);
    expect(me.job).toEqual({ kind: 'repair', partId: engine.id, parts: 1, turnsLeft: plan.turns, total: plan.turns, auto: true });
    for (let i = 0; i < plan.turns; i++) advanceJobs(w);
    expect(goodsCount(me).parts).toBe(held - 1);
    expect(engine.hp).toBe(1 + plan.hp);
  });

  it('patches the part that strands the truck before a more damaged one', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    const cage = armorPart(me);
    const transmission = corePart(me, 'transmission');
    cage.hp = 1;
    transmission.hp = 0;
    addGoods(w, me, 'parts', 5);
    startAutoRepair(w);
    expect(me.job).toMatchObject({ kind: 'repair', partId: transmission.id });
  });

  it('cancels when its part leaves the mounts, as when stored at a garage', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    const engine = mountedParts(me).find((p) => partDef(p.defId).kind === 'engine')!;
    engine.hp = 1;
    addGoods(w, me, 'parts', 5);
    startAutoRepair(w);
    me.items = me.items.filter((it) => !(it.kind === 'part' && it.part.id === engine.id));
    w.player.storage.push(engine);

    advanceJobs(w);

    expect(me.job).toBeNull();
    expect(engine.hp).toBe(1);
  });

  it('skips a junk part', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    const cage = armorPart(me);
    cage.hp = 0;
    cage.wear = CONDITION.maxWear + 1;
    addGoods(w, me, 'parts', 5);
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });

  it('waits while off, moving, busy or out of parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 5);
    w.player.autoRepair = false;
    me.speed = 0;
    startAutoRepair(w);
    expect(me.job).toBeNull();
    w.player.autoRepair = true;
    me.speed = 3;
    startAutoRepair(w);
    expect(me.job).toBeNull();
    me.speed = 0;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });
});

describe('drive order', () => {
  it('cancels a running job once the player sets a drive order, before the truck gains speed', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 5);
    startAutoRepair(w);
    expect(me.job).not.toBeNull();
    me.order = { kind: 'through', dest: { x: me.pos.x + 10, y: me.pos.y } };
    advanceJobs(w);
    expect(me.job).toBeNull();
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });

  it('lets an NPC with a leftover order work', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'cage'], { x: 50, y: 50 });
    npc.speed = 0;
    npc.order = { kind: 'stopAt', dest: { x: 60, y: 50 } };
    armorPart(npc).hp = 1;
    addGoods(w, npc, 'parts', 20);
    startJob(w, npc, { kind: 'repair', partId: armorPart(npc).id, parts: 1, turnsLeft: 3, total: 3 });
    advanceJobs(w);
    expect(npc.job).not.toBeNull();
  });
});

describe('strip job', () => {
  it('yields parts good units from the part\'s value, removes the part and adds the goods', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const spare = makePart(w, 'mg', 0);
    stowPart(w, me, spare);
    const held = goodsCount(me).parts ?? 0;
    const units = Math.max(1, Math.round((partValue(spare) * STRIP.yieldShare) / GOODS.parts.value));

    const next = startStrip(w, spare.id);
    for (let i = 0; i < STRIP.turns; i++) advanceJobs(next);

    const truck = next.vehicles[0];
    expect(truck.job).toBeNull();
    expect(truck.items.some((it) => it.kind === 'part' && it.part.id === spare.id)).toBe(false);
    expect((goodsCount(truck).parts ?? 0) - held).toBe(units);
  });

  it("pays the Scraper's knife share of the part's value with a working scraper", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    if (!mountPart(w, me, makePart(w, 'scrapersKnife', 0))) throw new Error('No deck room for the scraper');
    const spare = makePart(w, 'mg', 0);
    if (!stowPart(w, me, spare)) throw new Error('No room for the spare');
    const held = goodsCount(me).parts ?? 0;
    const plain = Math.max(1, Math.round((partValue(spare) * STRIP.yieldShare) / GOODS.parts.value));
    const units = Math.max(1, Math.round((partValue(spare) * WORK.scraperStripShare) / GOODS.parts.value));
    expect(units).toBeGreaterThan(plain);

    const next = startStrip(w, spare.id);
    for (let i = 0; i < STRIP.turns; i++) advanceJobs(next);

    expect((goodsCount(next.vehicles[0]).parts ?? 0) - held).toBe(units);
  });

  it('strips a broken, junk part too', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const spare = makePart(w, 'mg', 0);
    spare.hp = 0;
    spare.wear = CONDITION.maxWear + 1;
    stowPart(w, me, spare);

    const next = startStrip(w, spare.id);
    for (let i = 0; i < STRIP.turns; i++) advanceJobs(next);

    const truck = next.vehicles[0];
    expect(truck.items.some((it) => it.kind === 'part' && it.part.id === spare.id)).toBe(false);
    expect(goodsCount(truck).parts ?? 0).toBeGreaterThan(0);
  });

  it('cancels on a turn the truck ends above parked speed, leaving the part in place', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const spare = makePart(w, 'mg', 0);
    stowPart(w, me, spare);

    const next = startStrip(w, spare.id);
    advanceJobs(next);
    next.vehicles[0].speed = 5;
    advanceJobs(next);

    const truck = next.vehicles[0];
    expect(truck.job).toBeNull();
    expect(truck.items.some((it) => it.kind === 'part' && it.part.id === spare.id)).toBe(true);
    expect(next.events.some((e) => e.t === 'job' && e.outcome === 'cancelled')).toBe(true);
  });

  it('refuses a mounted part and a built-in part', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const mounted = mountedParts(me).find((p) => partDef(p.defId).kind === 'armor')!;
    expect(() => startStrip(w, mounted.id)).toThrow(/spare/);
    const cab = corePart(me, 'cab');
    expect(() => startStrip(w, cab.id)).toThrow(/spare/);
  });
});

describe('field job practice', () => {
  it('pays the player the job turns when a repair finishes', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 20);
    const next = startRepair(w, armorPart(me).id);
    const total = next.vehicles[0].job!.total;
    for (let i = 0; i < total; i++) advanceJobs(next);
    expect(practiceOf(next, 'fieldJob')).toMatchObject([{ amount: total, difficulty: null }]);
  });

  it('pays nothing for a refit that only moves parts the truck has', () => {
    const w = emptyWorld();
    const mg = w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    const next = moveItem(w, mg.id, { x: 1, y: gridOf(w.vehicles[0]).h - 1, rot: 0 });
    while (next.vehicles[0].job) advanceJobs(next);
    expect(practiceOf(next, 'fieldJob')).toEqual([]);
  });

  it('pays nothing for a cancelled repair', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 20);
    const next = startRepair(w, armorPart(me).id);
    next.vehicles[0].speed = 5;
    advanceJobs(next);
    expect(practiceOf(next, 'fieldJob')).toEqual([]);
  });

  it('pays nothing for an NPC repair', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'cage'], { x: 50, y: 50 });
    armorPart(npc).hp = 1;
    addGoods(w, npc, 'parts', 20);
    const plan = repairPlan(w, npc, armorPart(npc).id);
    startJob(w, npc, { kind: 'repair', partId: armorPart(npc).id, parts: plan.parts, turnsLeft: plan.turns, total: plan.turns });
    for (let i = 0; i < plan.turns; i++) advanceJobs(w);
    expect(npc.job).toBeNull();
    expect(practiceOf(w, 'fieldJob')).toEqual([]);
  });
});

describe('jobs in combat', () => {
  // A player with a damaged part, spare parts, and a raider parked in sight that shoots at it unless told not to.
  function underFire(attacking = true) {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.speed = 0;
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 35, y: 30 });
    addState(w, 'feud', raider.id, me.id, { kind: 'feud', robbery: false });
    if (attacking) startCombat(w, raider, me);
    return { w, me, cage, raider };
  }

  it('starts no job in combat', () => {
    const { w, me, cage } = underFire();
    expect(() => startRepair(w, cage.id)).toThrow(/in combat/);
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });

  it('starts a job beside a hostile in sight that has not attacked', () => {
    const { w, me, cage } = underFire(false);
    expect(startRepair(w, cage.id).vehicles[0].job).not.toBeNull();
    expect(me.job).toBeNull();
  });

  it('cancels a running job once combat starts', () => {
    const { w, me, cage, raider } = underFire(false);
    w.vehicles = w.vehicles.filter((v) => v.id !== raider.id);
    const next = startRepair(w, cage.id);
    next.vehicles.push(raider);
    startCombat(next, raider, next.vehicles[0]);
    next.events = [];
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.events).toContainEqual(expect.objectContaining({ t: 'job', vehicle: me.id, outcome: 'cancelled' }));
  });
});

describe('weld job', () => {
  const { scrap, turns, part } = PERK_NUMBERS.welder;

  // Sets the truck's scrap metal to exactly n units.
  function holdScrap(w: ReturnType<typeof emptyWorld>, n: number): void {
    const me = w.vehicles[0];
    removeGoods(me, 'scrap', goodsCount(me).scrap ?? 0);
    addGoods(w, me, 'scrap', n);
  }

  function sheets(v: ReturnType<typeof emptyWorld>['vehicles'][0]): number {
    return v.items.filter((it) => it.kind === 'part' && it.part.defId === part).length;
  }

  it('spends the scrap and stows a pristine scrap sheet after its turns', () => {
    const w = emptyWorld();
    w.player.perks = ['welder'];
    const me = w.vehicles[0];
    holdScrap(w, scrap + 1);
    const before = sheets(me);

    const next = startWeld(w);
    expect(next.vehicles[0].job).toEqual({ kind: 'weld', turnsLeft: turns, total: turns });
    for (let i = 0; i < turns - 1; i++) advanceJobs(next);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(scrap + 1);
    advanceJobs(next);

    const truck = next.vehicles[0];
    expect(truck.job).toBeNull();
    expect(goodsCount(truck).scrap).toBe(1);
    expect(sheets(truck)).toBe(before + 1);
    const sheet = truck.items.find((it) => it.kind === 'part' && it.part.defId === part && it.part.wear === 0);
    expect(sheet?.kind === 'part' && sheet.part.hp).toBe(partDef(part).hp);
  });

  it('refuses without the perk', () => {
    const w = emptyWorld();
    holdScrap(w, scrap);
    expect(() => startWeld(w)).toThrow(/Welder/);
  });

  it('refuses with too little scrap', () => {
    const w = emptyWorld();
    w.player.perks = ['welder'];
    holdScrap(w, scrap - 1);
    expect(() => startWeld(w)).toThrow(/scrap/);
  });

  it('cancels when the scrap leaves the grid mid-job, making nothing', () => {
    const w = emptyWorld();
    w.player.perks = ['welder'];
    holdScrap(w, scrap);
    const next = startWeld(w);
    const before = sheets(next.vehicles[0]);
    advanceJobs(next);
    removeGoods(next.vehicles[0], 'scrap', 1);
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(sheets(next.vehicles[0])).toBe(before);
    expect(next.events.some((e) => e.t === 'job' && e.outcome === 'cancelled')).toBe(true);
  });

  it('teaches no machining', () => {
    const w = emptyWorld();
    w.player.perks = ['welder'];
    holdScrap(w, scrap);
    const next = startWeld(w);
    for (let i = 0; i < turns; i++) advanceJobs(next);
    expect(practiceOf(next, 'fieldJob')).toEqual([]);
  });
});

describe('cancelling a refit', () => {
  it('ends the job and leaves every item where it was', () => {
    const w = emptyWorld();
    const mg = w.vehicles[0].items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    const before = structuredClone(w.vehicles[0].items);
    const started = moveItem(w, mg.id, { x: 1, y: gridOf(w.vehicles[0]).h - 1, rot: 0 });
    advanceJobs(started);
    expect(started.vehicles[0].job).toMatchObject({ kind: 'refit' });

    const next = cancelRefit(started);

    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items).toEqual(before);
    expect(next.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled' }));
  });

  it('throws when no refit runs', () => {
    expect(() => cancelRefit(emptyWorld())).toThrow(/No refit/);
  });

  it('throws for another kind of job', () => {
    const w = emptyWorld();
    armorPart(w.vehicles[0]).hp = 1;
    addGoods(w, w.vehicles[0], 'parts', 20);
    const repairing = startRepair(w, armorPart(w.vehicles[0]).id);
    expect(() => cancelRefit(repairing)).toThrow(/No refit/);
  });
});
