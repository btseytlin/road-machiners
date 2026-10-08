import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/npcs';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import { playerVehicle } from '../sim/damage';
import { corePart } from '../sim/grid';
import type { GameEvent } from '../sim/types';
import { addState } from '../sim/states';
import { refreshVision } from '../sim/vision';
import { eventText, formatNpcActivity, formatNpcCargo, formatNpcMark, formatNpcStates, formatNpcTraits } from './format';
import { PERK_NUMBERS } from '../data/skills';
import { makePart } from '../sim/factory';
import { addGoods, stowPart } from '../sim/inventory';

it('shows a visible NPC goal as its reason in a sentence, without naming its target', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const target = addVehicle(w, 'raiders', 'buggy', [], { x: 58, y: 58 });
  target.name = 'Hidden target';
  npc.brain = { ...npcBrain('scavenger', npc.pos, ['scavenger']), goals: [{ kind: 'flee', targetId: target.id, destination: target.pos, phase: 'travel', reason: 'avoid a costly fight' }] };
  refreshVision(w);
  expect(formatNpcActivity(w, npc)).toBe('Avoid a costly fight');
  npc.pos = { x: 58, y: 55 };
  expect(formatNpcActivity(w, npc)).toBeNull();
});

it('shows a knocked-out NPC as knocked out instead of its last goal', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  npc.brain = { ...npcBrain('buggy', npc.pos, ['raider']), goals: [{ kind: 'fight', targetId: w.player.vehicleId, destination: null, phase: 'act', reason: 'rob cargo' }] };
  npc.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };
  corePart(npc, 'cab').hp = 0;
  refreshVision(w);
  expect(formatNpcActivity(w, npc)).toBe('Knocked out');
});

it('shows an NPC that lies out with a working cab as having given up', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  npc.brain = npcBrain('buggy', npc.pos, ['raider']);
  npc.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
  refreshVision(w);
  expect(formatNpcActivity(w, npc)).toBe('Gave up');
});

it('shows a seen NPC goal and its reason, and logs goal changes only with the full log flag', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.brain = { ...npcBrain('scavenger', npc.pos, ['scavenger']), goals: [{ kind: 'flee', targetId: null, destination: null, phase: 'act', reason: 'avoid a costly fight' }] };
  refreshVision(w);
  const event: GameEvent = { t: 'activity', vehicle: npc.id, previous: null, activity: 'flee', reason: 'avoid a costly fight' };
  expect(formatNpcActivity(w, npc)).toBe('Avoid a costly fight');
  expect(eventText(w, event)).toBeNull();
  w.player.fullLog = true;
  expect(eventText(w, event)?.text).toContain('flee — avoid a costly fight');
});

it('shows NPC traits as one line with the read the driver perk', () => {
  const w = emptyWorld();
  w.player.perks.push('readDriver');
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger', 'scumbag']);
  expect(formatNpcTraits(w, npc)).toBe('Traits: scavenger, scumbag');
});

it('hides NPC traits without the read the driver perk', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger', 'scumbag']);
  expect(formatNpcTraits(w, npc)).toBeNull();
});

// A seen hauler carrying two salt, one scrap and a spare machine gun.
function loadedHauler() {
  const w = emptyWorld();
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  expect(addGoods(w, npc, 'salt', 2) + addGoods(w, npc, 'scrap', 1)).toBe(3);
  if (!stowPart(w, npc, makePart(w, 'mg', 0))) throw new Error('No room for the spare gun');
  return { w, npc };
}

it('shows the goods and spare parts of an NPC truck with the cargo eye perk', () => {
  const { w, npc } = loadedHauler();
  w.player.perks.push('cargoEye');
  expect(formatNpcCargo(w, npc)).toBe('Cargo: Salt ×2, Scrap metal ×1. Spares: MG turret');
});

it('shows an empty NPC truck as empty with the cargo eye perk', () => {
  const w = emptyWorld();
  w.player.perks.push('cargoEye');
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
  expect(formatNpcCargo(w, npc)).toBe('Cargo: empty');
});

it('hides NPC cargo without the cargo eye perk', () => {
  const { w, npc } = loadedHauler();
  expect(formatNpcCargo(w, npc)).toBeNull();
});

it('offers the mark key on an unmarked truck with the spotter perk', () => {
  const w = emptyWorld();
  w.player.perks.push('spotter');
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
  expect(formatNpcMark(w, npc)).toBe('[N] Mark');
});

it('shows the turns a mark has left', () => {
  const w = emptyWorld();
  w.player.perks.push('spotter');
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
  w.player.marked = [{ vehicleId: npc.id, until: w.turn + PERK_NUMBERS.spotter.turns }];
  expect(formatNpcMark(w, npc)).toBe(`Marked: ${PERK_NUMBERS.spotter.turns} turns left`);
});

it('shows no mark line without the spotter perk', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
  expect(formatNpcMark(w, npc)).toBeNull();
});

it('fails loudly for a vehicle with no NPC brain', () => {
  const w = emptyWorld();
  expect(() => formatNpcTraits(w, playerVehicle(w))).toThrow('has no NPC brain');
});

it('lists every state toward the player, with turns left', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const other = addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  addState(w, 'feud', npc.id, me.id, { kind: 'feud', robbery: true }).turnsLeft = 7;
  addState(w, 'turnedDown', npc.id, me.id, { kind: 'none' });
  addState(w, 'revenge', npc.id, me.id, { kind: 'none' });
  addState(w, 'truce', npc.id, me.id, { kind: 'none' }).turnsLeft = 3;
  addState(w, 'feud', npc.id, other.id, { kind: 'feud', robbery: false });
  expect(formatNpcStates(w, npc)).toEqual(['Feud with you, 7 turns', 'You turned down its tow', `Wants revenge on you, ${STATE_TURNS.revenge} turns`, 'Truce with you, 3 turns']);
});

it('shows one In combat line for combat held by the NPC toward the player', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  addState(w, 'combat', npc.id, me.id, { kind: 'none' }).turnsLeft = STATE_TURNS.combat;
  expect(formatNpcStates(w, npc)).toEqual([`In combat, ${STATE_TURNS.combat} turns`]);
});

it('shows In combat when only the player holds the combat state', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  addState(w, 'combat', me.id, npc.id, { kind: 'none' }).turnsLeft = 4;
  expect(formatNpcStates(w, npc)).toEqual(['In combat, 4 turns']);
});

it('merges combat in both directions into one line with the most turns left', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  addState(w, 'combat', npc.id, me.id, { kind: 'none' }).turnsLeft = 3;
  addState(w, 'combat', me.id, npc.id, { kind: 'none' }).turnsLeft = 8;
  expect(formatNpcStates(w, npc)).toEqual(['In combat, 8 turns']);
});

it('ignores combat between the NPC and a third truck', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  const other = addVehicle(w, 'traders', 'hauler', [], { x: 40, y: 40 });
  addState(w, 'combat', npc.id, other.id, { kind: 'none' });
  expect(formatNpcStates(w, npc)).toEqual([]);
});

it('reads In combat, 1 turn at one turn left', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'raiders', 'buggy', [], { x: 32, y: 30 });
  addState(w, 'combat', npc.id, me.id, { kind: 'none' }).turnsLeft = 1;
  expect(formatNpcStates(w, npc)).toEqual(['In combat, 1 turn']);
});

it('tells a tow offer from a running tow', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'traders', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  const tow = addState(w, 'tow', npc.id, me.id, { kind: 'tow', site: 'x', fee: 10, waived: 0, hitched: false });
  expect(formatNpcStates(w, npc)).toEqual(['Tow offer to you']);
  tow.data = { kind: 'tow', site: 'x', fee: 10, waived: 0, hitched: true };
  expect(formatNpcStates(w, npc)).toEqual(['Towing you']);
});

it('logs how a feud with the player ends', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.name = 'Scavenger';
  const feud = addState(w, 'feud', npc.id, me.id, { kind: 'feud', robbery: true });
  expect(eventText(w, { t: 'stateEnded', state: feud, ending: 'expired' })).toEqual({ text: 'Scavenger gives up the feud with you.', cls: 'good' });
  expect(eventText(w, { t: 'stateEnded', state: feud, ending: 'fulfilled' })).toEqual({ text: 'Scavenger ends the feud: you are beaten.', cls: 'bad' });
});

it('logs no state ending for tow states or states between NPCs', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const other = addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
  const tow = addState(w, 'tow', npc.id, me.id, { kind: 'tow', site: 'x', fee: 10, waived: 0, hitched: true });
  const feud = addState(w, 'feud', npc.id, other.id, { kind: 'feud', robbery: false });
  expect(eventText(w, { t: 'stateEnded', state: tow, ending: 'fulfilled' })).toBeNull();
  expect(eventText(w, { t: 'stateEnded', state: feud, ending: 'expired' })).toBeNull();
});

describe('events far from the player', () => {
  const setup = () => {
    const w = emptyWorld();
    const a = addVehicle(w, 'scavengers', 'scout', [], { x: 58, y: 55 });
    const b = addVehicle(w, 'raiders', 'buggy', [], { x: 58, y: 57 });
    refreshVision(w);
    w.player.contacts = [];
    const cab = corePart(a, 'cab');
    const events: GameEvent[] = [
      { t: 'partDisabled', vehicle: a.id, part: cab.id },
      { t: 'destroyed', vehicle: a.id, by: b.id },
      { t: 'towHitched', by: a.id, client: b.id, site: 'kiln' },
      { t: 'towDone', by: a.id, client: b.id, fee: 12 },
      { t: 'towDropped', by: a.id, client: b.id, reason: 'danger' },
    ];
    return { w, a, events };
  };

  it('give no line when the player neither sees nor detects them', () => {
    const { w, events } = setup();
    for (const e of events) expect(eventText(w, e)).toBeNull();
  });

  it('give a line when the player detects a vehicle in them', () => {
    const { w, a, events } = setup();
    w.player.contacts = [{ vehicleId: a.id, center: a.pos, radius: 3, sources: ['sound'], loudness: 10 }];
    for (const e of events) expect(eventText(w, e)).not.toBeNull();
  });

  it('give a line when the player sees a vehicle in them', () => {
    const { w, a, events } = setup();
    a.pos = { x: 32, y: 30 };
    for (const e of events) expect(eventText(w, e)).not.toBeNull();
  });

  it('give a line with the full log on', () => {
    const { w, events } = setup();
    w.player.fullLog = true;
    for (const e of events) expect(eventText(w, e)).not.toBeNull();
  });
});

it('says a perk can be picked when a skill reaches a perk level', () => {
  const w = emptyWorld();
  expect(eventText(w, { t: 'skillUp', skill: 'driving', level: 2 })?.text).toBe('Driving rank 2 bought. Perk ready [C].');
  expect(eventText(w, { t: 'skillUp', skill: 'driving', level: 3 })?.text).toBe('Driving rank 3 bought.');
});

it('names both trucks, the destination and the fee in a tow between NPCs', () => {
  const w = emptyWorld();
  const tower = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const client = addVehicle(w, 'traders', 'hauler', [], { x: 34, y: 30 });
  tower.name = 'Tower';
  client.name = 'Client';
  refreshVision(w);
  expect(eventText(w, { t: 'towHitched', by: tower.id, client: client.id, site: 'kiln' })).toEqual({ text: 'Tower takes Client in tow to Kiln Camp.', cls: 'dim' });
  expect(eventText(w, { t: 'towDone', by: tower.id, client: client.id, fee: 1250 })).toEqual({ text: 'Tower tows Client in and takes 13 M.', cls: 'dim' });
  expect(eventText(w, { t: 'towDropped', by: tower.id, client: client.id, reason: 'danger' })).toEqual({ text: 'Tower drops the tow of Client.', cls: 'dim' });
  expect(eventText(w, { t: 'towDone', by: tower.id, client: w.player.vehicleId, fee: 1200 })).toEqual({ text: 'Tower tows you into town and takes 12 M.', cls: 'bad' });
});
