// Replay runs a recorded trace through the XP rules. It takes milliseconds, so XP numbers can be tuned without a new
// recording. Perks and the feedback of skills into behavior are ignored.

import { TIME } from '../../data/time';
import { MAIN_SKILL, MAX_SKILL_LEVEL, SKILL_IDS, TARGET_DAYS, TARGET_TOLERANCE, XP_SOURCES } from '../../data/skills';
import { accrueXp, levelOf, type SkillProgress } from '../progress';
import type { SkillId, XpSource } from '../types';
import { isArchetype, type Archetype } from './bot';
import type { RunEnd, TraceLine } from './record';

export type SkillCurve = { levels: (number | null)[]; total: number; perDay: number };
export type Curve = Record<SkillId, SkillCurve>;

export function replay(trace: readonly TraceLine[], turns: number): Curve {
  requireTurnOrder(trace, turns);
  const progress = freshProgress();
  const levels = Object.fromEntries(SKILL_IDS.map((id) => [id, new Array<number | null>(MAX_SKILL_LEVEL).fill(null)])) as Record<SkillId, (number | null)[]>;
  for (const line of trace) {
    const skill = XP_SOURCES[line.source].skill;
    const before = levelOf(progress.skills[skill]);
    accrueXp(progress, line.source, line.amount, line.difficulty, line.target, line.turn);
    for (let level = before + 1; level <= levelOf(progress.skills[skill]); level++) levels[skill][level - 1] = line.turn;
  }
  const days = turns / TIME.turnsPerDay;
  return Object.fromEntries(SKILL_IDS.map((id) => [id, { levels: levels[id], total: progress.skills[id], perDay: progress.skills[id] / days }])) as Curve;
}

function requireTurnOrder(trace: readonly TraceLine[], turns: number): void {
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`Replay needs a positive whole number of turns, got ${turns}`);
  let lastTurn = 0;
  for (const line of trace) {
    if (line.turn < lastTurn) throw new Error(`Trace line at turn ${line.turn} is out of turn order after turn ${lastTurn}`);
    if (line.turn > turns + 1) throw new Error(`Trace line at turn ${line.turn} is past the end of a ${turns} turn run`);
    lastTurn = line.turn;
  }
}

function freshProgress(): SkillProgress {
  const zero = (): Record<SkillId, number> => ({ driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 });
  return { skills: zero(), xpToday: zero(), xpDay: 1, repeats: {} };
}

export function parseTraceLine(value: unknown): TraceLine {
  const { turn, source, amount, difficulty, target } = asRecord(value);
  if (!Number.isInteger(turn) || !isXpSource(source) || typeof amount !== 'number' || !isDifficulty(difficulty) || typeof target !== 'string') {
    throw new Error(`Bad trace line ${JSON.stringify(value)}`);
  }
  return { turn: turn as number, source, amount, difficulty, target };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`Trace line ${JSON.stringify(value)} is not an object`);
  return value as Record<string, unknown>;
}

function isXpSource(value: unknown): value is XpSource {
  return typeof value === 'string' && Object.hasOwn(XP_SOURCES, value);
}

function isDifficulty(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

export function parseRunEnd(value: unknown): RunEnd | null {
  const entry = asRecord(value);
  if (!('end' in entry)) return null;
  if (entry.end !== 'death' || !Number.isInteger(entry.turn)) throw new Error(`Bad run end ${JSON.stringify(value)}`);
  return { end: 'death', turn: entry.turn as number };
}

export function targetMisses(curve: Curve, archetype: Archetype, turns: number): string[] {
  return SKILL_IDS.flatMap((skill) => {
    const table: Partial<Record<number, number>> = MAIN_SKILL[archetype] === skill ? TARGET_DAYS.main : TARGET_DAYS.off;
    return Object.entries(table).flatMap(([level, day]) => levelMiss(skill, Number(level), day!, curve[skill].levels[Number(level) - 1], turns));
  });
}

function levelMiss(skill: SkillId, level: number, day: number, reached: number | null, turns: number): string[] {
  const at = reached === null ? 'never' : `day ${(reached / TIME.turnsPerDay).toFixed(1)}`;
  const verdict = missVerdict(day * TIME.turnsPerDay, reached, turns);
  return verdict ? [`${skill} level ${level}: ${at}, target day ${day}, ${verdict}`] : [];
}

function missVerdict(target: number, reached: number | null, turns: number): 'too early' | 'too late' | null {
  const late = target * (1 + TARGET_TOLERANCE);
  if (reached === null) return late <= turns ? 'too late' : null;
  if (reached < target * (1 - TARGET_TOLERANCE)) return 'too early';
  return reached > late ? 'too late' : null;
}

export type Run = { archetype: Archetype; seed: number; turns: number; death: number | null; trace: TraceLine[] };

export function parseRun(values: readonly unknown[], label: string): Run {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(`${label} is empty`);
  const header = parseHeader(first, label);
  const end = rest.length > 0 ? parseRunEnd(rest[rest.length - 1]) : null;
  const body = end ? rest.slice(0, -1) : rest;
  const trace = body.map((value) => {
    if (parseRunEnd(value)) throw new Error(`${label} has lines after its death marker`);
    return parseTraceLine(value);
  });
  return { ...header, turns: end ? end.turn : header.turns, death: end ? end.turn : null, trace };
}

function parseHeader(value: unknown, label: string): Pick<Run, 'archetype' | 'seed' | 'turns'> {
  const { archetype, seed, turns } = asRecord(value);
  if (typeof archetype !== 'string' || !isArchetype(archetype) || !Number.isInteger(seed) || !Number.isInteger(turns)) throw new Error(`${label} has a bad header ${JSON.stringify(value)}`);
  return { archetype, seed: seed as number, turns: turns as number };
}
