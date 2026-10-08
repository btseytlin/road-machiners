import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { inFeud, isHostile } from './combat';
import { playerVehicle } from './damage';
import { chooseOption, currentOptions, raiseCalls } from './dialogue';
import { gridOf, itemCells, mountedParts } from './grid';
import { pushGoal, topGoal } from './npc-activities';
import { warnedOff } from './parley';
import { backedOff, claimantOf, clearPiles } from './salvage';
import { spillDeadRows } from './spill';
import { addState } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls, startCombat } from './testkit';
import type { Faction, GridItem, SalvageStock, Vehicle, World } from './types';
import { lineKey } from '../text/names';
import { entryText } from '../text/resolve';
import { canVehicleSee, refreshVision } from './vision';

const en = (line: Parameters<typeof lineKey>[0]): string => entryText('en', lineKey(line));

const ACCEPT = 'It is yours.';
const REFUSE = 'Over my wreck.';

function quietWorld(): World {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  return w;
}

function npcAt(w: World, faction: Faction, x: number, y = 30): Vehicle {
  const npc = addVehicle(w, faction, 'scout', ['stockEngine', 'mg'], { x, y });
  npc.brain = npcBrain('raider', npc.pos, ['raider']);
  refreshVision(w);
  return npc;
}

function pick(w: World, text: string): World {
  const i = currentOptions(w).findIndex((o) => en(o.line) === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => en(o.line)).join(' | ')}`);
  return chooseOption(w, i);
}

const lastRow = (v: Vehicle) => gridOf(v).h - 1;
const onRow = (v: Vehicle, y: number) => v.items.filter((it) => itemCells(it).some((c) => c.y === y));
const spillPile = (w: World): SalvageStock => w.salvage.find((s) => s.id.startsWith('spill-'))!;

function breakLoadedCargo(w: World, v: Vehicle): void {
  const y = lastRow(v);
  v.items = v.items.filter((it) => !onRow(v, y).includes(it));
  const g = gridOf(v);
  for (let x = 0; x < g.w; x++) if (g.cells[y][x] === '.') v.items.push({ id: `${v.id}-salt-${x}`, x, y, rot: 0, kind: 'good', good: 'salt' });
  for (const p of mountedParts(v, 'cargo')) p.hp = 0;
}

function robbedPlayer(): { w: World; raider: Vehicle; kept: GridItem[] } {
  const w = quietWorld();
  const me = playerVehicle(w);
  const raider = npcAt(w, 'raiders', 36);
  startCombat(w, raider, me);
  w.player.talked[raider.id] = { demand: 'refused' };
  breakLoadedCargo(w, me);
  const kept = me.items.filter((it) => it.y < lastRow(me)).map((it) => ({ ...it }));
  spillDeadRows(w);
  return { w, raider, kept };
}

describe('a robber claims spilled cargo', () => {
  it('claims the pile spilled by the player it robs, and radios a truce for it', () => {
    const { w, raider } = robbedPlayer();
    expect(claimantOf(w, spillPile(w))).toBe(raider);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'spillClaim' });
  });

  it('a robber hunting the player, not yet in combat, goes for the pile and keeps its claim', () => {
    const w = quietWorld();
    const me = playerVehicle(w);
    const raider = npcAt(w, 'raiders', 36);
    breakLoadedCargo(w, me);
    spillDeadRows(w);
    clearPiles(w);
    const pile = spillPile(w);
    expect(claimantOf(w, pile)).toBe(raider);
    expect(topGoal(raider)).toMatchObject({ kind: 'loot', targetId: pile.id });
  });

  it('a robber not yet in combat radios its truce offer, not the plain warning off its claim', () => {
    const w = quietWorld();
    const me = playerVehicle(w);
    const raider = npcAt(w, 'raiders', 36);
    w.player.talked[raider.id] = { demand: 'refused' };
    breakLoadedCargo(w, me);
    spillDeadRows(w);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'spillClaim' });
  });

  it('leaving the pile makes peace, keeps the rest of the cargo and sends the robber to the pile', () => {
    const { w: start, raider, kept } = robbedPlayer();
    raiseCalls(start);
    const w = pick(start, ACCEPT);
    const me = playerVehicle(w);
    const robber = w.vehicles.find((v) => v.id === raider.id)!;
    const pile = spillPile(w);
    expect(isHostile(w, robber, me)).toBe(false);
    expect(isHostile(w, me, robber)).toBe(false);
    expect(inFeud(w, robber, me)).toBe(false);
    expect(me.items).toEqual(kept);
    expect(robber.brain!.goals.some((g) => g.kind === 'loot' && g.targetId === pile.id)).toBe(true);
    expect(backedOff(pile, me.id)).toBe(true);
    expect(w.player.talked[raider.id].spillClaim).toBe('agreed');
  });

  it('refusing keeps the fight, and the robber does not ask again', () => {
    const { w: start, raider } = robbedPlayer();
    raiseCalls(start);
    const w = pick(start, REFUSE);
    const robber = w.vehicles.find((v) => v.id === raider.id)!;
    expect(isHostile(w, robber, playerVehicle(w))).toBe(true);
    expect(claimantOf(w, spillPile(w))).toBe(robber);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });

  it('a foe that is not robbing claims nothing and makes no call', () => {
    const w = quietWorld();
    const me = playerVehicle(w);
    const foe = npcAt(w, 'traders', 36);
    addState(w, 'feud', foe.id, me.id, { kind: 'feud', robbery: false });
    addState(w, 'feud', me.id, foe.id, { kind: 'feud', robbery: false });
    startCombat(w, foe, me);
    breakLoadedCargo(w, me);
    spillDeadRows(w);
    expect(spillPile(w).pile!.claim).toBeUndefined();
    raiseCalls(w);
    expect(w.player.call?.topic).not.toBe('spillClaim');
  });

  it('a robber that cannot see the pile claims nothing', () => {
    const w = quietWorld();
    const me = playerVehicle(w);
    const raider = npcAt(w, 'raiders', 30, 200);
    expect(isHostile(w, raider, me)).toBe(true);
    breakLoadedCargo(w, me);
    spillDeadRows(w);
    expect(canVehicleSee(w, raider, spillPile(w).pos)).toBe(false);
    expect(spillPile(w).pile!.claim).toBeUndefined();
  });

  it('an NPC that complies leaves its spilled cargo to the robber and makes peace', () => {
    forceOption('threatened', 'comply');
    const w = quietWorld();
    const victim = addVehicle(w, 'traders', 'scout', ['stockEngine', 'mg', 'panniers'], { x: 40, y: 40 });
    victim.brain = npcBrain('trader', victim.pos, ['trader']);
    const raider = npcAt(w, 'raiders', 46, 40);
    startCombat(w, raider, victim);
    breakLoadedCargo(w, victim);
    w.rngState = rngStateForForcedRolls(6);
    spillDeadRows(w);
    const pile = spillPile(w);
    expect(isHostile(w, raider, victim)).toBe(false);
    expect(raider.brain!.goals.some((g) => g.kind === 'loot' && g.targetId === pile.id)).toBe(true);
    expect(backedOff(pile, victim.id)).toBe(true);
  });

  it('an NPC that fights back keeps fighting, and the claim holds', () => {
    forceOption('threatened', 'fightBack');
    const w = quietWorld();
    const victim = addVehicle(w, 'traders', 'scout', ['stockEngine', 'mg', 'panniers'], { x: 40, y: 40 });
    victim.brain = npcBrain('trader', victim.pos, ['raider']);
    const raider = npcAt(w, 'raiders', 46, 40);
    startCombat(w, raider, victim);
    breakLoadedCargo(w, victim);
    w.rngState = rngStateForForcedRolls(6);
    spillDeadRows(w);
    expect(isHostile(w, raider, victim)).toBe(true);
    expect(claimantOf(w, spillPile(w))).toBe(raider);
  });

  it('warns a third driver off the claimed pile', () => {
    forceOption('threatened', 'comply');
    const { w } = robbedPlayer();
    const pile = spillPile(w);
    const other = npcAt(w, 'scavengers', pile.pos.x + 1, pile.pos.y);
    pushGoal(w, other, { kind: 'loot', targetId: pile.id, destination: { ...pile.pos }, phase: 'travel', reason: 'lootOnTheWay' });
    w.rngState = rngStateForForcedRolls(6);
    expect(warnedOff(w, other, pile)).toBe(true);
    expect(backedOff(pile, other.id)).toBe(true);
  });
});
