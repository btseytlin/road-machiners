// Runs ink quests and owns the game functions they call, one per EXTERNAL in src/data/quests/world.ink. A save
// keeps only named variables and the session's last checkpoint. ink's own state lives in player.quests.live,
// which saves skip and load rebuilds from the checkpoint. See docs/architecture/quests.md.

import { Story } from 'inkjs';
import {
  CHECKPOINT_TAG,
  COST_TAG,
  MONEY_STAT,
  QUEST_VIEWS,
  type CompiledQuest,
  type QuestBundle,
  type QuestFact,
  type QuestStat,
  type QuestValue,
  type QuestValueType,
  type QuestVarDecl,
  type QuestViewKind,
} from '../data/quests';
import BUNDLE from '../data/quests.json';
import type { NoteId } from '../data/locals';
import { REGION } from '../data/region';
import { UNITS } from '../data/units';
import { boardFull, holdsNote, isNoteId, learnNote, takeTownWork, townOffers, townWork } from './dialogue-rules';
import { hashRandom } from './rng';
import { storyStock } from './salvage';
import type { QuestLine, QuestSession, QuestState, QuestVars, World } from './types';
import { update } from './world';

export type QuestView = {
  quest: string;
  view: QuestViewKind;
  lines: QuestLine[];
  choices: string[];
  costs: (number | null)[];
  locked: boolean[];
  stats: { label: string; value: string }[];
  facts: string[];
  ended: boolean;
};
export type QuestQuery = (world: World, args: readonly unknown[]) => QuestValue;
export type QuestEffect = (world: World, args: readonly unknown[]) => void;

type Runner = { story: Story; world: World | null; restoring: string | null };

const INK_SEED_RANGE = 2 ** 31;
const runners = new WeakMap<CompiledQuest, Runner>();

const begun = new WeakMap<World, string>();
const SITES = new Set([...REGION.towns, ...REGION.locations].map((s) => s.id));

export const QUEST_QUERIES: Record<string, QuestQuery> = {
  money: (world) => Math.floor(world.player.money / UNITS.centsPerM),
  has_note: (world, args) => holdsNote(world, noteArg('has_note', args)),
  found: (world, args) => world.player.discovered.includes(siteArg('found', args)),
  searched: (world, args) => world.player.scavenged.includes(storyStock(world, textArg('searched', args, 0)).id),
  has_work: (world) => townWork(world) !== null,
  has_offers: (world) => townOffers(world).length > 0,
  board_full: (world) => boardFull(world),
};

export const QUEST_EFFECTS: Record<string, QuestEffect> = {
  give_money: (world, args) => {
    const amount = wholeArg('give_money', args, 0);
    if (amount < 0) throw new Error(`give_money takes no negative amount, got ${amount}`);
    world.player.money += amount * UNITS.centsPerM;
  },
  pay: (world, args) => {
    const amount = wholeArg('pay', args, 0);
    if (amount < 0) throw new Error(`pay takes no negative amount, got ${amount}`);
    if (world.player.money < amount * UNITS.centsPerM) throw new Error(`pay(${amount}) needs more money than the player holds. Check money() first`);
    world.player.money -= amount * UNITS.centsPerM;
  },
  note: (world, args) => learnNote(world, noteArg('note', args)),
  take_work: (world) => takeTownWork(world),
  begin: (world, args) => {
    if (begun.has(world)) throw new Error('begin ran twice in one pick');
    begun.set(world, textArg('begin', args, 0));
  },
};

function wholeArg(fn: string, args: readonly unknown[], index: number): number {
  const value = args[index];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${fn} needs a whole number as argument ${index + 1}, got ${String(value)}`);
  return value;
}

function textArg(fn: string, args: readonly unknown[], index: number): string {
  const value = args[index];
  if (typeof value !== 'string') throw new Error(`${fn} needs text as argument ${index + 1}, got ${String(value)}`);
  return value;
}

function noteArg(fn: string, args: readonly unknown[]): NoteId {
  const id = textArg(fn, args, 0);
  if (!isNoteId(id)) throw new Error(`${fn} names no note ${id}`);
  return id;
}

function siteArg(fn: string, args: readonly unknown[]): string {
  const id = textArg(fn, args, 0);
  if (!SITES.has(id)) throw new Error(`${fn} names no town or location ${id}`);
  return id;
}

export function parseBundle(value: unknown): QuestBundle {
  if (!isRecord(value) || !isRecord(value.world) || !Array.isArray(value.externals) || !isRecord(value.quests)) throw new Error('Quest bundle has no world, externals or quests');
  const quests = Object.fromEntries(Object.entries(value.quests).map(([id, quest]) => [id, parseQuest(id, quest)]));
  return { world: parseVars('world', value.world), externals: value.externals.map(String), quests };
}

function parseQuest(id: string, value: unknown): CompiledQuest {
  if (!isRecord(value) || typeof value.story !== 'string' || !isRecord(value.vars) || !Array.isArray(value.checkpoints)) throw new Error(`Quest ${id} has no story, vars or checkpoints`);
  return { story: value.story, vars: parseVars(id, value.vars), checkpoints: value.checkpoints.map(String), ...parseHeader(id, value) };
}

function parseHeader(id: string, value: Record<string, unknown>): Pick<CompiledQuest, 'view' | 'stats' | 'facts'> {
  if (!QUEST_VIEWS.includes(value.view as QuestViewKind) || !Array.isArray(value.stats) || !Array.isArray(value.facts)) throw new Error(`Quest ${id} has no view, stats or facts`);
  return { view: value.view as QuestViewKind, stats: value.stats.map((s) => parseStat(id, s)), facts: value.facts.map((f) => parseFact(id, f)) };
}

function parseStat(id: string, value: unknown): QuestStat {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.label !== 'string') throw new Error(`Quest ${id} has a bad stat`);
  const words = Array.isArray(value.words) ? value.words.map(String) : null;
  return { name: value.name, label: value.label, words };
}

function parseFact(id: string, value: unknown): QuestFact {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.text !== 'string') throw new Error(`Quest ${id} has a bad fact`);
  return { name: value.name, text: value.text };
}

function parseVars(owner: string, value: Record<string, unknown>): Record<string, QuestVarDecl> {
  return Object.fromEntries(Object.entries(value).map(([name, decl]) => {
    if (!isRecord(decl) || !isValueType(decl.type) || typeof decl.init !== decl.type) throw new Error(`Variable ${name} of ${owner} has a bad declaration`);
    return [name, { type: decl.type, init: decl.init as QuestValue }];
  }));
}

function isValueType(value: unknown): value is QuestValueType {
  return value === 'string' || value === 'number' || value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const QUESTS: QuestBundle = parseBundle(BUNDLE);

export function startQuest(world: World, bundle: QuestBundle, questId: string, checkpoint: string): World {
  return update(world, (w) => openQuest(w, bundle, questId, checkpoint));
}

export function openQuest(w: World, bundle: QuestBundle, questId: string, checkpoint: string): void {
  const open = w.player.quests.session;
  if (open) throw new Error(`Quest ${open.quest} is open`);
  if (!questOf(bundle, questId).checkpoints.includes(checkpoint)) throw new Error(`Quest ${questId} has no checkpoint ${checkpoint}`);
  w.player.quests.session = { quest: questId, checkpoint, seed: questSeed(w, questId) };
  enterCheckpoint(w, bundle);
}

export function chooseQuestOption(world: World, bundle: QuestBundle, index: number): World {
  return update(world, (w) => {
    const session = openSession(w.player.quests);
    const live = w.player.quests.live;
    if (!live) throw new Error(`Quest ${session.quest} has no live state. Restore it first`);
    if (!Number.isInteger(index) || index < 0 || index >= live.choices.length) throw new Error(`No choice ${index} on offer`);
    payCost(w, live.costs[index], live.choices[index]);
    runQuest(w, bundle, session.quest, (story) => {
      story.state.LoadJson(live.ink);
      story.ChooseChoiceIndex(index);
    });
  });
}

export function restoreQuest(world: World, bundle: QuestBundle): void {
  const session = world.player.quests.session;
  if (!session) return;
  const saved = JSON.stringify([world.player.quests.world, world.player.quests.local]);
  const runner = runnerOf(bundle, questOf(bundle, session.quest));
  runner.restoring = session.checkpoint;
  try {
    enterCheckpoint(world, bundle);
  } finally {
    runner.restoring = null;
  }
  const loaded = JSON.stringify([world.player.quests.world, world.player.quests.local]);
  if (loaded !== saved) throw new Error(`Loading checkpoint ${session.checkpoint} changed its variables from ${saved} to ${loaded}. A checkpoint may not change variables before its first choice.`);
}

export function leaveQuest(world: World): World {
  return update(world, (w) => {
    if (!w.player.quests.live) throw new Error('No quest is on view');
    w.player.quests.session = null;
    w.player.quests.live = null;
  });
}

function payCost(w: World, cost: number | null, choice: string): void {
  if (cost === null) return;
  if (w.player.money < cost * UNITS.centsPerM) throw new Error(`"${choice}" costs ${cost} M, more than the player holds`);
  w.player.money -= cost * UNITS.centsPerM;
}

export function questView(world: World, bundle: QuestBundle): QuestView {
  const { live, session } = world.player.quests;
  if (!live) throw new Error('No quest is on view');
  const quest = questOf(bundle, live.quest);
  const money = QUEST_QUERIES.money(world, []) as number;
  return {
    quest: live.quest,
    view: quest.view,
    lines: live.lines,
    choices: live.choices,
    costs: live.costs,
    locked: live.costs.map((cost) => cost !== null && cost > money),
    stats: quest.stats.map((stat) => ({ label: stat.label, value: statText(world, bundle, live.quest, stat, money) })),
    facts: quest.facts.filter((fact) => questVar(world, bundle, live.quest, fact.name) === true).map((fact) => fact.text),
    ended: session === null,
  };
}

function statText(world: World, bundle: QuestBundle, questId: string, stat: QuestStat, money: number): string {
  if (stat.name === MONEY_STAT) return `${money} M`;
  const value = questVar(world, bundle, questId, stat.name);
  if (stat.words === null) return String(value);
  const word = stat.words[Math.min(Number(value), stat.words.length - 1)];
  if (word === undefined) throw new Error(`Stat ${stat.name} of ${questId} holds ${String(value)}, which names none of ${stat.words.join(', ')}`);
  return word;
}

function questVar(world: World, bundle: QuestBundle, questId: string, name: string): QuestValue {
  const { world: shared, local } = world.player.quests;
  const own = questOf(bundle, questId).vars[name];
  if (own) return local[questId]?.[name] ?? own.init;
  const decl = bundle.world[name];
  if (!decl) throw new Error(`Quest ${questId} reads no variable ${name}`);
  return shared[name] ?? decl.init;
}

export function questProblems(state: QuestState, bundle: QuestBundle): string[] {
  return [
    ...varProblems(state.world, bundle.world, (name) => `World variable ${name}`),
    ...Object.entries(state.local).flatMap(([id, vars]) => localProblems(id, vars, bundle)),
    ...sessionProblems(state.session, bundle),
  ];
}

export type CarriedQuestVars = { world: Record<string, unknown>; local: Record<string, Record<string, unknown>> };

export function fittingQuestVars(carried: CarriedQuestVars, bundle: QuestBundle): { world: QuestVars; local: Record<string, QuestVars>; lost: string[] } {
  const world = fitting(carried.world, bundle.world, (name) => name);
  const locals = Object.entries(carried.local).map(([id, vars]) => [id, fitting(vars, bundle.quests[id]?.vars ?? {}, (name) => `${id}.${name}`)] as const);
  const local = Object.fromEntries(locals.filter(([, fit]) => Object.keys(fit.kept).length > 0).map(([id, fit]) => [id, fit.kept]));
  return { world: world.kept, local, lost: [...world.lost, ...locals.flatMap(([, fit]) => fit.lost)] };
}

function fitting(vars: Record<string, unknown>, decls: Record<string, QuestVarDecl>, label: (name: string) => string): { kept: QuestVars; lost: string[] } {
  const kept: QuestVars = {};
  const lost: string[] = [];
  for (const [name, value] of Object.entries(vars)) {
    const decl = decls[name];
    if (!decl || typeof value !== decl.type) lost.push(label(name));
    else if (value !== decl.init) kept[name] = value as QuestVars[string];
  }
  return { kept, lost };
}

function localProblems(id: string, vars: QuestVars, bundle: QuestBundle): string[] {
  const quest = bundle.quests[id];
  if (!quest) return [`Quest ${id} does not exist`];
  return varProblems(vars, quest.vars, (name) => `Variable ${name} of quest ${id}`);
}

function varProblems(vars: QuestVars, decls: Record<string, QuestVarDecl>, label: (name: string) => string): string[] {
  return Object.entries(vars).flatMap(([name, value]) => {
    const decl = decls[name];
    if (!decl) return [`${label(name)} is not declared`];
    return typeof value === decl.type ? [] : [`${label(name)} holds a ${typeof value}, not a ${decl.type}`];
  });
}

function sessionProblems(session: QuestSession | null, bundle: QuestBundle): string[] {
  if (!session) return [];
  const quest = bundle.quests[session.quest];
  if (!quest) return [`Quest ${session.quest} does not exist`];
  return quest.checkpoints.includes(session.checkpoint) ? [] : [`Quest ${session.quest} has no checkpoint ${session.checkpoint}`];
}

function enterCheckpoint(w: World, bundle: QuestBundle): void {
  const session = openSession(w.player.quests);
  runQuest(w, bundle, session.quest, (story) => {
    story.ResetState();
    injectVars(story, w.player.quests.world);
    injectVars(story, w.player.quests.local[session.quest] ?? {});
    story.state.storySeed = session.seed;
    story.state.previousRandom = 0;
    story.ChoosePathString(session.checkpoint);
  });
}

function runQuest(w: World, bundle: QuestBundle, questId: string, step: (story: Story) => void): void {
  const quest = questOf(bundle, questId);
  const runner = runnerOf(bundle, quest);
  runner.world = w;
  try {
    step(runner.story);
    const lines = playLines(runner.story, w.player.quests);
    settle(w, bundle, questId, runner.story, lines);
  } finally {
    runner.world = null;
  }
  beginNext(w, bundle, questId);
}

function beginNext(w: World, bundle: QuestBundle, questId: string): void {
  const next = begun.get(w);
  if (next === undefined) return;
  begun.delete(w);
  if (w.player.quests.session) throw new Error(`Quest ${questId} called begin("${next}") but did not end right after it`);
  openQuest(w, bundle, next, 'start');
}

function playLines(story: Story, state: QuestState): QuestLine[] {
  const lines: QuestLine[] = [];
  while (story.canContinue) {
    const text = (story.Continue() ?? '').trim();
    const tags = story.currentTags ?? [];
    noteCheckpoint(state, tags);
    if (text) lines.push({ text, tags: tags.filter((tag) => !tag.startsWith(CHECKPOINT_TAG)) });
  }
  return lines;
}

function noteCheckpoint(state: QuestState, tags: readonly string[]): void {
  const tag = tags.find((t) => t.startsWith(CHECKPOINT_TAG));
  if (tag && state.session) state.session.checkpoint = tag.slice(CHECKPOINT_TAG.length).trim();
}

function settle(w: World, bundle: QuestBundle, questId: string, story: Story, lines: QuestLine[]): void {
  const state = w.player.quests;
  state.world = storedVars(story, bundle.world, 'the world');
  const { [questId]: _old, ...others } = state.local;
  const local = storedVars(story, questOf(bundle, questId).vars, `quest ${questId}`);
  state.local = Object.keys(local).length > 0 ? { ...others, [questId]: local } : others;
  const choices = story.currentChoices.map((choice) => choice.text);
  const costs = story.currentChoices.map((choice) => choiceCost(questId, choice.text, choice.tags ?? []));
  state.live = { quest: questId, ink: story.state.toJson(), lines, choices, costs };
  if (choices.length === 0) state.session = null;
}

function choiceCost(questId: string, text: string, tags: readonly string[]): number | null {
  const tag = tags.find((t) => t.startsWith(COST_TAG));
  const other = tags.find((t) => !t.startsWith(COST_TAG));
  if (other !== undefined) throw new Error(`Choice "${text}" of ${questId} carries # ${other}. A choice takes only # cost.`);
  if (tag === undefined) return null;
  const cost = Number(tag.slice(COST_TAG.length).trim());
  if (!Number.isInteger(cost) || cost <= 0) throw new Error(`Choice "${text}" of ${questId} needs a whole positive cost, got # ${tag}`);
  return cost;
}

function storedVars(story: Story, decls: Record<string, QuestVarDecl>, owner: string): QuestVars {
  const stored: QuestVars = {};
  for (const [name, decl] of Object.entries(decls)) {
    const value: unknown = story.variablesState.$(name);
    if (typeof value !== decl.type) throw new Error(`Variable ${name} of ${owner} became a ${typeof value}, not a ${decl.type}`);
    if (value !== decl.init) stored[name] = value as QuestVars[string];
  }
  return stored;
}

function injectVars(story: Story, vars: QuestVars): void {
  for (const [name, value] of Object.entries(vars)) story.variablesState.$(name, value);
}

function runnerOf(bundle: QuestBundle, quest: CompiledQuest): Runner {
  const known = runners.get(quest);
  if (known) return known;
  const runner: Runner = { story: new Story(quest.story), world: null, restoring: null };
  for (const name of bundle.externals) bindExternal(runner, name);
  runners.set(quest, runner);
  return runner;
}

function bindExternal(runner: Runner, name: string): void {
  const query = QUEST_QUERIES[name];
  const effect = QUEST_EFFECTS[name];
  if (query) return runner.story.BindExternalFunction(name, (...args: unknown[]) => query(runnerWorld(runner), args), true);
  if (effect) return runner.story.BindExternalFunction(name, (...args: unknown[]) => effect(effectWorld(runner, name), args), false);
  throw new Error(`External function ${name} has no query or effect in src/sim/quests.ts`);
}

function effectWorld(runner: Runner, name: string): World {
  if (runner.restoring) throw new Error(`Effect ${name} ran while loading checkpoint ${runner.restoring}, so every load would run it again. Move it after a choice.`);
  return runnerWorld(runner);
}

function runnerWorld(runner: Runner): World {
  if (!runner.world) throw new Error('A quest hook ran outside a quest command');
  return runner.world;
}

function questOf(bundle: QuestBundle, questId: string): CompiledQuest {
  const quest = bundle.quests[questId];
  if (!quest) throw new Error(`No quest ${questId}`);
  return quest;
}

function openSession(state: QuestState): QuestSession {
  if (!state.session) throw new Error('No quest is open');
  return state.session;
}

function questSeed(w: World, questId: string): number {
  const codes = [...questId].map((c) => c.charCodeAt(0));
  return Math.floor(hashRandom(w.seed, w.turn, ...codes) * INK_SEED_RANGE);
}
