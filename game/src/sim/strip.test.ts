import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { SPARE_LINE } from '../data/dialogue';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { callVehicle, chooseOption, currentOptions, hangUp, raiseCalls } from './dialogue';
import { isHostile } from './combat';
import { corePart, mountedParts } from './grid';
import { addGoods } from './inventory';
import { CONDITIONS } from './dialogue-rules';
import { hasCargo } from './salvage';
import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { advanceNpcKnockouts, isKnockedOut } from './defeat';
import { downedHere } from './locations';
import { takeFromTruck } from './salvage';
import { findSpot, goodsCount, gridOf, isMounted, MOUNT_CELLS } from './grid';
import { aimAt, offeredSurrenderBy, plead } from './parley';
import { addState, stateOf } from './states';
import { topGoal } from './npc-activities';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, testDrive } from './testkit';
import type { GridItem, Vehicle, World } from './types';
import { endTurn } from './world';
import { lineKey } from '../text/names';
import { entryText } from '../text/resolve';

// A line's English words, so the tests read like the talk they check.
const en = (line: Parameters<typeof lineKey>[0]): string => entryText('en', lineKey(line));

// A raider with a machine gun sees a stranded player who carries goods. It always picks the fight.
function strandedAmbush(): { w: World; raider: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  addGoods(w, playerVehicle(w), 'scrap', 2);
  w.player.fuel = 0;
  const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  forceOption('hostileSeen', 'fight');
  return { w, raider };
}

const shotsAtPlayer = (w: World, raider: Vehicle) => w.events.filter((e) => e.t === 'shot' && e.shooter === raider.id && e.target === w.player.vehicleId);

function pick(w: World, text: string): World {
  const index = currentOptions(w).findIndex((o) => en(o.line) === text);
  if (index < 0) throw new Error(`No option "${text}"`);
  return chooseOption(w, index);
}

describe('surrender offer to a stranded player', () => {
  it('a raider alone with a stranded player radios an offer before it shoots, and asks only once', () => {
    const { w: start, raider } = strandedAmbush();
    let w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'surrender' });
    expect(shotsAtPlayer(w, raider)).toEqual([]);
    w = pick(w, 'Come and get it.');
    for (let i = 0; i < 6; i++) {
      w = endTurn(w, testDrive);
      expect(w.player.call).toBeNull();
    }
  });

  it('accepting takes the cargo and the best parts, leaves the truck, and holds a truce', () => {
    const { w: start, raider } = strandedAmbush();
    const me = playerVehicle(start);
    const before = mountedParts(me).length;
    let w = pick(endTurn(start, testDrive), 'Fine. Take it.');
    const after = playerVehicle(w);
    expect(hasCargo(after)).toBe(false);
    expect(mountedParts(after).length).toBe(before - RULES.surrenderParts);
    expect(corePart(after, 'cab')).toBeDefined();
    expect(stateOf(w, 'truce', raider.id, after.id)).not.toBeNull();
    expect(isHostile(w, w.vehicles.find((v) => v.id === raider.id)!, after)).toBe(false);
    expect(topGoal(w.vehicles.find((v) => v.id === raider.id)!)).toMatchObject({ kind: 'loot' });
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(shotsAtPlayer(w, raider)).toEqual([]);
    }
  });

  it('refusing makes every shot aim at the cab', () => {
    const { w: start, raider } = strandedAmbush();
    let w = pick(endTurn(start, testDrive), 'Come and get it.');
    const cab = corePart(playerVehicle(w), 'cab').id;
    const aims = new Set<string>();
    for (let i = 0; i < 4; i++) {
      w = endTurn(w, testDrive);
      for (const e of shotsAtPlayer(w, raider)) if (e.t === 'shot') aims.add(e.aim);
    }
    expect([...aims]).toEqual([cab]);
  });

  it('hanging up counts as refusing', () => {
    const { w: start, raider } = strandedAmbush();
    let w = hangUp(endTurn(start, testDrive));
    w = endTurn(w, testDrive);
    const cab = corePart(playerVehicle(w), 'cab').id;
    const shots = shotsAtPlayer(w, raider);
    expect(shots.length).toBeGreaterThan(0);
    for (const e of shots) if (e.t === 'shot') expect(e.aim).toBe(cab);
  });

  it('a knocked-out player is looted by the raider', () => {
    const { w: start, raider } = strandedAmbush();
    let w = pick(endTurn(start, testDrive), 'Come and get it.');
    for (let i = 0; i < 40 && w.player.state === 'active'; i++) w = endTurn(w, testDrive);
    expect(w.player.state).toBe('knockedOut');
    expect(topGoal(w.vehicles.find((v) => v.id === raider.id)!)).toMatchObject({ kind: 'loot', targetId: w.player.vehicleId });
  });

  it('a second hostile in the raider sight keeps the normal fight: no offer, body aim', () => {
    const { w: start, raider } = strandedAmbush();
    const lawman = addVehicle(start, 'bowl', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 34 });
    lawman.brain = npcBrain('bowlFarmer', lawman.pos, ['lawman', 'brave']);
    const w = endTurn(start, testDrive);
    const me = playerVehicle(w);
    const mugger = w.vehicles.find((v) => v.id === raider.id)!;
    w.player.talked[mugger.id] = { surrender: 'refused' };
    mugger.brain!.goals.push({ kind: 'fight', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'tripToSite', perceived: w.turn });
    expect(w.player.call?.topic).not.toBe('surrender');
    expect(CONDITIONS.demandsSurrender(w, mugger, {})).toBe(false);
    w.vehicles = w.vehicles.filter((v) => v.id !== lawman.id);
    expect(CONDITIONS.demandsSurrender(w, mugger, {})).toBe(true);
    expect(aimAt(w, mugger, me)).toBe(corePart(me, 'cab').id);
    w.vehicles.push(lawman);
    expect(aimAt(w, mugger, me)).toBe('body');
  });
});

// A lawman on patrol with a machine gun fights a stranded player who carries goods. It takes nothing.
function strandedByLawman(judge: 'offer' | 'spare' = 'offer'): { w: World; lawman: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  addGoods(w, playerVehicle(w), 'scrap', 2);
  w.player.fuel = 0;
  const lawman = addVehicle(w, 'bowl', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
  lawman.brain = npcBrain('bowlFarmer', lawman.pos, ['lawman']);
  addState(w, 'feud', lawman.id, w.player.vehicleId, { kind: 'feud', robbery: false });
  forceOption('hostileSeen', 'fight');
  forceOption('strandedFoe', judge);
  return { w, lawman };
}

describe('plain surrender to a stranded player', () => {
  it('a lawman alone with a stranded player radios a plain offer, not a strip demand', () => {
    const { w: start, lawman } = strandedByLawman();
    const w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: lawman.id, topic: 'giveUp' });
    expect(currentOptions(w).map((o) => en(o.line))).toContain('Standing down.');
  });

  it('accepting ends the fight, holds a truce and takes nothing', () => {
    const { w: start, lawman } = strandedByLawman();
    const before = mountedParts(playerVehicle(start)).length;
    let w = pick(endTurn(start, testDrive), 'Standing down.');
    const after = playerVehicle(w);
    expect(hasCargo(after)).toBe(true);
    expect(mountedParts(after).length).toBe(before);
    expect(stateOf(w, 'truce', lawman.id, after.id)).not.toBeNull();
    expect(isHostile(w, w.vehicles.find((v) => v.id === lawman.id)!, after)).toBe(false);
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(shotsAtPlayer(w, lawman)).toEqual([]);
      if (w.player.call?.topic === 'tow' || w.player.call?.topic === 'towFree') w = hangUp(w); // a lawman at peace may offer the stranded player a tow
    }
  });

  it('refusing makes every shot aim at the cab', () => {
    const { w: start, lawman } = strandedByLawman();
    let w = pick(endTurn(start, testDrive), 'Come and get it.');
    const cab = corePart(playerVehicle(w), 'cab').id;
    const aims = new Set<string>();
    for (let i = 0; i < 10; i++) {
      w = endTurn(w, testDrive);
      for (const e of shotsAtPlayer(w, lawman)) if (e.t === 'shot') aims.add(e.aim);
    }
    expect([...aims]).toEqual([cab]);
  });

  it('a second hostile in sight keeps the normal fight: no offer', () => {
    const { w: start, lawman } = strandedByLawman();
    const other = addVehicle(start, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 34 });
    other.brain = npcBrain('buggy', other.pos, ['raider']);
    const w = endTurn(start, testDrive);
    expect(w.player.call?.topic).not.toBe('giveUp');
    expect(CONDITIONS.demandsGiveUp(w, w.vehicles.find((v) => v.id === lawman.id)!, {})).toBe(false);
  });
});

describe('a stranded player not worth the trouble', () => {
  it('a driver that judges the player not worth it says so, makes peace and never offers', () => {
    const { w: start, lawman } = strandedByLawman('spare');
    const w = endTurn(start, testDrive);
    expect(w.events).toContainEqual({ t: 'say', speaker: lawman.id, line: SPARE_LINE, vars: {} });
    expect(w.player.call?.topic).not.toBe('giveUp');
    expect(isHostile(w, w.vehicles.find((v) => v.id === lawman.id)!, playerVehicle(w))).toBe(false);
  });
});

// A raider beside a stranded trader far from the player, feuding over the trader's cargo.
function npcAmbush(answer: 'accept' | 'refuse'): { w: World; raider: Vehicle; trader: Vehicle } {
  const w = emptyWorld({ x: 5, y: 5 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine', 'mg'], { x: 60, y: 60 }, 0);
  trader.brain = npcBrain('trader', trader.pos, ['trader']);
  trader.resources!.fuel = 0;
  addGoods(w, trader, 'scrap', 3);
  const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 66, y: 60 }, Math.PI);
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  addState(w, 'feud', raider.id, trader.id, { kind: 'feud', robbery: true });
  forceOption('hostileSeen', 'fight');
  forceOption('surrenderOffered', answer);
  return { w, raider, trader };
}

describe('surrender between NPCs', () => {
  it('a stranded NPC that gives up to a robber drops its cargo, and the robber goes to take it', () => {
    const { w: start, raider, trader } = npcAmbush('accept');
    const w = endTurn(start, testDrive);
    const t = w.vehicles.find((v) => v.id === trader.id)!;
    const r = w.vehicles.find((v) => v.id === raider.id)!;
    expect(isHostile(w, r, t)).toBe(false);
    expect(hasCargo(t)).toBe(false);
    expect(topGoal(r)?.kind).toBe('loot');
  });

  it('a stranded NPC that holds out draws the robber\'s fire at its cab', () => {
    const { w: start, raider, trader } = npcAmbush('refuse');
    let w = endTurn(start, testDrive);
    const cab = corePart(w.vehicles.find((v) => v.id === trader.id)!, 'cab').id;
    const r = w.vehicles.find((v) => v.id === raider.id)!;
    expect(aimAt(w, r, w.vehicles.find((v) => v.id === trader.id)!)).toBe(cab);
    w = endTurn(w, testDrive);
    const aims = w.events.flatMap((e) => (e.t === 'shot' && e.shooter === raider.id && e.target === trader.id ? [e.aim] : []));
    expect(aims.every((aim) => aim === cab)).toBe(true);
  });
});

describe('the player demands a beaten NPC give up', () => {
  const DEMAND = 'Your truck is finished. Stand down and let me strip it, and you live.';

  // A trader with cargo and spare mounted parts, feuding with the player within sight.
  function beaten(): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine', 'mg', 'mg', 'mg'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    addGoods(w, npc, 'scrap', 3);
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    addState(w, 'feud', w.player.vehicleId, npc.id, { kind: 'feud', robbery: false });
    corePart(npc, 'cab').hp = 1;
    return { w, npc };
  }

  const npcOf = (w: World, npc: Vehicle) => w.vehicles.find((v) => v.id === npc.id)!;
  const asks = (w: World) => currentOptions(w).some((o) => en(o.line) === DEMAND);

  it('is offered only while the foe is weak', () => {
    const { w, npc } = beaten();
    expect(asks(callVehicle(w, npc.id))).toBe(true);
    const healthy = beaten();
    const cab = corePart(healthy.npc, 'cab');
    cab.hp = cab.hp + 1000;
    mountedParts(healthy.npc).forEach((p) => { p.hp = 1000; });
    expect(asks(callVehicle(healthy.w, healthy.npc.id))).toBe(false);
  });

  // Accepts the demand and returns the world and the NPC after it.
  function accepted(start: World, npc: Vehicle): { w: World; after: Vehicle } {
    forceOption('surrenderOffered', 'accept');
    let w = pick(callVehicle(start, npc.id), DEMAND);
    w = pick(w, 'Your call. Last chance.');
    w = pick(w, 'Sit tight.');
    return { w, after: npcOf(w, npc) };
  }

  it('accepting leaves the truck lying with all its gear, and makes peace', () => {
    const { w: start, npc } = beaten();
    addState(start, 'combat', npc.id, start.player.vehicleId, { kind: 'none' });
    const items = npc.items.length;
    const cab = corePart(npc, 'cab').hp;
    const salvage = start.salvage.length;
    const { w, after } = accepted(start, npc);
    expect(isKnockedOut(after)).toBe(true);
    expect(after.items.length).toBe(items);
    expect(corePart(after, 'cab').hp).toBe(cab);
    expect(w.salvage.length).toBe(salvage);
    expect(isHostile(w, after, playerVehicle(w))).toBe(false);
    expect(isHostile(w, playerVehicle(w), after)).toBe(false);
    for (const [a, b] of [[npc.id, w.player.vehicleId], [w.player.vehicleId, npc.id]]) {
      expect(stateOf(w, 'feud', a, b)).toBeNull();
      expect(stateOf(w, 'combat', a, b)).toBeNull();
    }
    expect(stateOf(w, 'revenge', npc.id, w.player.vehicleId)).toBeNull();
    expect(practiceOf(w, 'deal')).toHaveLength(1);
    expect(w.player.call).toBeNull();
  });

  it('a parked player strips the truck that gave up, goods at once and parts by refit', () => {
    const { w: start, npc } = beaten();
    const me = playerVehicle(start);
    npc.pos = { x: me.pos.x + chassisDef(me.chassisId).radius + chassisDef(npc.chassisId).radius + 0.2, y: me.pos.y };
    me.speed = 0;
    const { w, after } = accepted(start, npc);
    expect(downedHere(w)?.id).toBe(npc.id);
    const probe = (from: World, item: GridItem) => {
      const mine = playerVehicle(from);
      const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
      return findSpot(gridOf(mine), mine.items, { ...item, id: 'probe' }, null, avoid)!;
    };
    const gun = after.items.find((it) => it.kind === 'part' && it.part.defId === 'mg' && isMounted(npc.chassisId, it))!;
    const refit = takeFromTruck(w, after.id, gun.id, probe(w, gun));
    const scrap = after.items.find((it) => it.kind === 'good')!;
    const before = goodsCount(playerVehicle(w)).scrap ?? 0;
    const looted = takeFromTruck(w, after.id, scrap.id, probe(w, scrap));
    expect(goodsCount(playerVehicle(looted)).scrap ?? 0).toBeGreaterThan(before);
    expect(playerVehicle(refit).job?.kind).toBe('refit');
  });

  it('the driver comes to and retreats like a knocked-out one', () => {
    const { w: start, npc } = beaten();
    let { w } = accepted(start, npc);
    for (let i = 0; i < RULES.knockoutMaxTurns; i++) advanceNpcKnockouts(w);
    expect(npcOf(w, npc).defeat?.phase).toBe('retreat');
  });

  it('refusing keeps the fight and the demand is not offered again', () => {
    forceOption('surrenderOffered', 'refuse');
    const { w: start, npc } = beaten();
    const parts = mountedParts(npc).length;
    let w = pick(callVehicle(start, npc.id), DEMAND);
    w = pick(w, 'Your call. Last chance.');
    w = pick(w, 'Then we finish this.');
    const after = npcOf(w, npc);
    expect(isHostile(w, after, playerVehicle(w))).toBe(true);
    expect(hasCargo(after)).toBe(true);
    expect(mountedParts(after).length).toBe(parts);
    expect(asks(callVehicle(w, npc.id))).toBe(false);
  });

  it('a foe with a healthy truck but a broken driver counts as weak', () => {
    const { w, npc } = beaten();
    corePart(npc, 'cab').hp = corePart(npc, 'cab').hp + 1000;
    mountedParts(npc).forEach((p) => { p.hp = 1000; });
    npc.resources!.health = 1;
    expect(asks(callVehicle(w, npc.id))).toBe(true);
  });
});

describe('a beggar offers to stand down and be stripped', () => {
  const STRIP = 'Stand down and let me strip your truck.';
  const CARGO = 'Dump your cargo and drive off.';

  // A healthy trader with cargo and spare parts begs the player for mercy, and the player's call opens.
  function begging(): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine', 'mg', 'mg', 'mg'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    addGoods(w, npc, 'scrap', 3);
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    addState(w, 'feud', w.player.vehicleId, npc.id, { kind: 'feud', robbery: false });
    plead(w, npc, playerVehicle(w), 'mercy');
    raiseCalls(w);
    return { w, npc };
  }

  const npcOf = (w: World, npc: Vehicle) => w.vehicles.find((v) => v.id === npc.id)!;
  const pleaEvents = (w: World) => w.events.filter((e) => e.t === 'plea');

  it('offers the strip beside cargo and no mercy', () => {
    const { w } = begging();
    expect(currentOptions(w).map((o) => en(o.line))).toEqual([CARGO, STRIP, 'No mercy.', 'Hang up.']);
  });

  it('is not offered once the driver answered a stand-down demand', () => {
    const { w, npc } = begging();
    w.player.call = null;
    npcOf(w, npc).brain!.noticed[`surrenderOffered:${w.player.vehicleId}`] = 1;
    raiseCalls(w);
    expect(currentOptions(w).map((o) => en(o.line))).toEqual([CARGO, 'No mercy.', 'Hang up.']);
  });

  it('accepting leaves the truck lying with all its gear, and makes peace', () => {
    forceOption('surrenderOffered', 'accept');
    const { w: start, npc } = begging();
    const items = npc.items.length;
    const cab = corePart(npc, 'cab').hp;
    const salvage = start.salvage.length;
    let w = pick(start, STRIP);
    w = pick(w, 'Your call. Last chance.');
    w = pick(w, 'Sit tight.');
    const after = npcOf(w, npc);
    expect(isKnockedOut(after)).toBe(true);
    expect(after.items.length).toBe(items);
    expect(corePart(after, 'cab').hp).toBe(cab);
    expect(w.salvage.length).toBe(salvage);
    for (const [a, b] of [[npc.id, w.player.vehicleId], [w.player.vehicleId, npc.id]]) {
      expect(stateOf(w, 'feud', a, b)).toBeNull();
      expect(stateOf(w, 'combat', a, b)).toBeNull();
    }
    expect(isHostile(w, after, playerVehicle(w))).toBe(false);
    expect(isHostile(w, playerVehicle(w), after)).toBe(false);
    expect(stateOf(w, 'plea', npc.id, w.player.vehicleId)).toBeNull();
    expect(pleaEvents(w)).toContainEqual(expect.objectContaining({ plea: 'mercy', accepted: true }));
    expect(practiceOf(w, 'deal')).toHaveLength(1);
    expect(w.player.call).toBeNull();
  });

  it('refusing keeps the fight and the stand-down demand is not askable', () => {
    forceOption('surrenderOffered', 'refuse');
    const { w: start, npc } = begging();
    const parts = mountedParts(npc).length;
    let w = pick(start, STRIP);
    w = pick(w, 'Your call. Last chance.');
    w = pick(w, 'Then we finish this.');
    const after = npcOf(w, npc);
    expect(isHostile(w, after, playerVehicle(w))).toBe(true);
    expect(hasCargo(after)).toBe(true);
    expect(mountedParts(after).length).toBe(parts);
    expect(pleaEvents(w)).toContainEqual(expect.objectContaining({ plea: 'mercy', accepted: false }));
    corePart(after, 'cab').hp = 1;
    const ask = currentOptions(callVehicle(w, npc.id)).some((o) => en(o.line).startsWith('Your truck is finished'));
    expect(ask).toBe(false);
  });

  it('taking the cargo never notes a stand-down offer', () => {
    const { w: start, npc } = begging();
    const w = pick(start, CARGO);
    expect(offeredSurrenderBy(w, npcOf(w, npc), playerVehicle(w))).toBe(false);
  });
});
