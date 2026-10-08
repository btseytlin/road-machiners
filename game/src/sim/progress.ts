// XP comes from practice into one shared pool, and the player spends the pool on skill ranks. practice() is the one
// entry point for XP; xpFor() is its pure rule, shared with the progression replay. Each source belongs to an activity
// family, named by its skill, that shares one daily cap. buyRank() is the one way to raise a rank, and every skill

import {
  MAX_RANK, PERK_IDS, PERK_LEVELS, PERKS, type PerkId, type PerkLevel, RANK_COSTS, SKILL_EFFECTS, SKILL_IDS,
  type SkillEffect, XP_RULES, XP_SOURCES,
} from '../data/skills';
import { clockOf } from './sun';
import type { Player, Refusal, Repeat, SkillId, Vehicle, World, XpSource } from './types';
import type { Vec } from './vec';
import { Refused, update } from './world';

export type SkillProgress = Pick<Player, 'xp' | 'xpToday' | 'xpDay' | 'repeats'>;

export function rankCost(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_RANK) throw new Error(`No rank ${rank}; ranks run 1 to ${MAX_RANK}`);
  return RANK_COSTS[rank - 1];
}

export function cumulativeCost(rank: number): number {
  let total = 0;
  for (let r = 1; r <= rank; r++) total += rankCost(r);
  return total;
}

export function ranksCoveredBy(xp: number): number {
  let rank = 0;
  while (rank < MAX_RANK && xp >= cumulativeCost(rank + 1)) rank++;
  return rank;
}

export function skillLevel(world: World, skill: SkillId): number {
  return world.player.ranks[skill];
}

export function skillEffect<S extends SkillId>(world: World, v: Vehicle, skill: S, effect: SkillEffect<S>): number {
  if (v.id !== world.player.vehicleId) return 0;
  const perLevel: number = SKILL_EFFECTS[skill][effect];
  return perLevel * skillLevel(world, skill);
}

export function xpTodayOf(world: World, skill: SkillId): number {
  return world.player.xpDay === clockOf(world.turn).day ? world.player.xpToday[skill] : 0;
}

export function xpFor(p: SkillProgress, source: XpSource, amount: number, difficulty: number | null, target: string, turn: number): number {
  const def = XP_SOURCES[source];
  if (!(amount >= 0)) throw new Error(`Practice amount ${amount} for ${source} is not a non-negative number`);
  const full = def.weight * amount * difficultyMult(source, def.scaled, difficulty) * def.repeat ** repeatsOf(p, source, target, turn);
  const today = p.xpDay === clockOf(turn).day ? p.xpToday[def.skill] : 0;
  const underCap = Math.min(full, Math.max(0, XP_RULES.dailyCap - today));
  return underCap + (full - underCap) * XP_RULES.overCap;
}

function repeatsOf(p: SkillProgress, source: XpSource, target: string, turn: number): number {
  const seen = p.repeats[repeatKey(source, target)];
  return seen ? faded(seen, turn) : 0;
}

function faded(seen: Repeat, turn: number): number {
  if (turn < seen.turn) throw new Error(`Practice on turn ${turn} is before the last one on turn ${seen.turn}`);
  return seen.count * 0.5 ** ((turn - seen.turn) / XP_RULES.repeatHalfLife);
}

export function regionOf(pos: Vec): string {
  return `${Math.floor(pos.x / XP_RULES.regionTiles)},${Math.floor(pos.y / XP_RULES.regionTiles)}`;
}

function repeatKey(source: XpSource, target: string): string {
  if (target === '') throw new Error(`Practice of ${source} names no target`);
  return `${source}:${target}`;
}

function difficultyMult(source: XpSource, scaled: boolean, difficulty: number | null): number {
  if (!scaled) {
    if (difficulty !== null) throw new Error(`Unscaled XP source ${source} got difficulty ${difficulty}`);
    return 1;
  }
  if (difficulty === null || !(difficulty >= 0 && difficulty <= 1)) throw new Error(`XP source ${source} needs a difficulty in [0, 1], got ${difficulty}`);
  return XP_RULES.easy + (XP_RULES.hard - XP_RULES.easy) * difficulty;
}

export function practice(world: World, source: XpSource, amount: number, difficulty: number | null, target: string): void {
  const p = world.player;
  const xp = accrueXp(p, source, amount, difficulty, target, world.turn);
  p.xpBySource[source] += xp;
  world.events.push({ t: 'practice', source, amount, difficulty, target, xp });
}

export function accrueXp(p: SkillProgress, source: XpSource, amount: number, difficulty: number | null, target: string, turn: number): number {
  const family = XP_SOURCES[source].skill;
  const xp = xpFor(p, source, amount, difficulty, target, turn);
  const day = clockOf(turn).day;
  if (p.xpDay !== day) startDay(p, day, turn);
  p.repeats[repeatKey(source, target)] = { count: repeatsOf(p, source, target, turn) + 1, turn };
  p.xpToday[family] += xp;
  p.xp += xp;
  return xp;
}

function startDay(p: SkillProgress, day: number, turn: number): void {
  p.xpDay = day;
  for (const id of Object.keys(p.xpToday) as SkillId[]) p.xpToday[id] = 0;
  p.repeats = Object.fromEntries(Object.entries(p.repeats).filter(([key, seen]) => {
    const source = key.slice(0, key.indexOf(':')) as XpSource;
    return XP_SOURCES[source].repeat === 0 || faded(seen, turn) >= XP_RULES.forgetBelow;
  }));
}

export function grantXp(world: World, xp: number): void {
  world.player.xp += xp;
}

// Why the player cannot buy the next rank of a skill now, or null when they can.
export function canBuyRank(world: World, skill: SkillId): Refusal | null {
  const p = world.player;
  if (p.state !== 'active') return { id: 'notActive', state: p.state };
  const rank = p.ranks[skill];
  if (rank >= MAX_RANK) return { id: 'topRank', skill };
  const cost = rankCost(rank + 1);
  if (p.xp < cost) return { id: 'needsXp', cost, have: Math.floor(p.xp) };
  return null;
}

export function buyRank(world: World, skill: SkillId): World {
  const blocked = canBuyRank(world, skill);
  if (blocked) throw new Refused(blocked);
  return update(world, (w) => {
    const rank = w.player.ranks[skill] + 1;
    w.player.xp -= rankCost(rank);
    w.player.ranks[skill] = rank;
    w.events.push({ t: 'skillUp', skill, level: rank });
  });
}

export function affordableRanks(world: World): SkillId[] {
  return SKILL_IDS.filter((skill) => canBuyRank(world, skill) === null);
}

export function buyCheapestRanks(world: World): World {
  for (;;) {
    const affordable = affordableRanks(world);
    if (affordable.length === 0) return world;
    const cost = (skill: SkillId): number => rankCost(world.player.ranks[skill] + 1);
    const cheapest = affordable.reduce((best, skill) => (cost(skill) < cost(best) ? skill : best));
    world = buyRank(world, cheapest);
  }
}

export type PerkPair = { skill: SkillId; level: PerkLevel; perks: PerkId[] };

export function hasPerk(world: World, perk: PerkId): boolean {
  return world.player.perks.includes(perk);
}

export function vehicleHasPerk(world: World, v: Vehicle, perk: PerkId): boolean {
  return v.id === world.player.vehicleId && hasPerk(world, perk);
}

export function perkPair(skill: SkillId, level: PerkLevel): PerkPair {
  return { skill, level, perks: PERK_IDS.filter((id) => PERKS[id].skill === skill && PERKS[id].level === level) };
}

export function pickedFromPair(world: World, perk: PerkId): PerkId | null {
  const { skill, level } = PERKS[perk];
  return perkPair(skill, level).perks.find((id) => hasPerk(world, id)) ?? null;
}

export function pendingPerkPairs(world: World): PerkPair[] {
  return SKILL_IDS.flatMap((skill) => PERK_LEVELS
    .filter((level) => skillLevel(world, skill) >= level)
    .map((level) => perkPair(skill, level))
    .filter((pair) => pair.perks.every((id) => !hasPerk(world, id))));
}

export function isPerkId(id: string): id is PerkId {
  return (PERK_IDS as readonly string[]).includes(id);
}

export function choosePerk(world: World, perk: PerkId): World {
  if (!isPerkId(perk)) throw new Error(`Unknown perk ${perk}`);
  const def = PERKS[perk];
  if (world.player.state !== 'active') throw new Error(`Player is ${world.player.state}`);
  if (skillLevel(world, def.skill) < def.level) throw new Error(`${perk} needs ${def.skill} rank ${def.level}`);
  const picked = pickedFromPair(world, perk);
  if (picked) throw new Error(`${picked} is already picked from this pair`);
  return update(world, (w) => { w.player.perks.push(perk); });
}
