// Runs ink quests and owns the game functions they call, one per EXTERNAL in src/data/quests/world.ink. A save
// keeps only named variables and the session's last checkpoint. ink's own state lives in player.quests.live,
// which saves skip and load rebuilds from the checkpoint. See docs/architecture/quests.md.

import { Story } from 'inkjs';
import { CHECKPOINT_TAG, type CompiledQuest, type QuestBundle, type QuestValue, type QuestValueType, type QuestVarDecl } from '../data/quests';
import BUNDLE from '../data/quests.json';
import { UNITS } from '../data/units';
import { hashRandom } from './rng';
import type { QuestLine, QuestSession, QuestState, QuestVars, World } from './types';
import { update } from './world';

export type QuestView = { lines: QuestLine[]; choices: string[]; ended: boolean };
export type QuestQuery = (world: World, args: readonly unknown[]) => QuestValue;
export type QuestEffect = (world: World, args: readonly unknown[]) => void;

type Runner = { story: Story; world: World | null };

const INK_SEED_RANGE = 2 ** 31;
const runners = new WeakMap<CompiledQuest, Runner>();

export const QUEST_QUERIES: Record<string, QuestQuery> = {
  money: (world) => Math.floor(world.player.money / UNITS.centsPerM),
};

export const QUEST_EFFECTS: Record<string, QuestEffect> = {
  give_money: (world, args) => {
    const amount = wholeArg('give_money', args, 0);
    if (amount < 0) throw new Error(`give_money takes no negative amount, got ${amount}`);
    world.player.money += amount * UNITS.centsPerM;
  },
};

function wholeArg(fn: string, args: readonly unknown[], index: number): number {
  const value = args[index];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${fn} needs a whole number as argument ${index + 1}, got ${String(value)}`);
  return value;
}

export function parseBundle(value: unknown): QuestBundle {
  if (!isRecord(value) || !isRecord(value.world) || !Array.isArray(value.externals) || !isRecord(value.quests)) throw new Error('Quest bundle has no world, externals or quests');
  const quests = Object.fromEntries(Object.entries(value.quests).map(([id, quest]) => [id, parseQuest(id, quest)]));
  return { world: parseVars('world', value.world), externals: value.externals.map(String), quests };
}

function parseQuest(id: string, value: unknown): CompiledQuest {
  if (!isRecord(value) || typeof value.story !== 'string' || !isRecord(value.vars) || !Array.isArray(value.checkpoints)) throw new Error(`Quest ${id} has no story, vars or checkpoints`);
  return { story: value.story, vars: parseVars(id, value.vars), checkpoints: value.checkpoints.map(String) };
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
  return update(world, (w) => {
    const open = w.player.quests.session;
    if (open) throw new Error(`Quest ${open.quest} is open`);
    if (!questOf(bundle, questId).checkpoints.includes(checkpoint)) throw new Error(`Quest ${questId} has no checkpoint ${checkpoint}`);
    w.player.quests.session = { quest: questId, checkpoint, seed: questSeed(w, questId) };
    enterCheckpoint(w, bundle);
  });
}

export function chooseQuestOption(world: World, bundle: QuestBundle, index: number): World {
  return update(world, (w) => {
    const session = openSession(w.player.quests);
    const live = w.player.quests.live;
    if (!live) throw new Error(`Quest ${session.quest} has no live state. Restore it first`);
    if (!Number.isInteger(index) || index < 0 || index >= live.choices.length) throw new Error(`No choice ${index} on offer`);
    runQuest(w, bundle, session.quest, (story) => {
      story.state.LoadJson(live.ink);
      story.ChooseChoiceIndex(index);
    });
  });
}

export function restoreQuest(world: World, bundle: QuestBundle): void {
  if (world.player.quests.session) enterCheckpoint(world, bundle);
}

export function questView(world: World): QuestView {
  const { live, session } = world.player.quests;
  if (!live) throw new Error('No quest is on view');
  return { lines: live.lines, choices: live.choices, ended: session === null };
}

export function questProblems(state: QuestState, bundle: QuestBundle): string[] {
  return [
    ...varProblems(state.world, bundle.world, (name) => `World variable ${name}`),
    ...Object.entries(state.local).flatMap(([id, vars]) => localProblems(id, vars, bundle)),
    ...sessionProblems(state.session, bundle),
  ];
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
  state.live = { ink: story.state.toJson(), lines, choices };
  if (choices.length === 0) state.session = null;
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
  const runner: Runner = { story: new Story(quest.story), world: null };
  for (const name of bundle.externals) bindExternal(runner, name);
  runners.set(quest, runner);
  return runner;
}

function bindExternal(runner: Runner, name: string): void {
  const query = QUEST_QUERIES[name];
  const effect = QUEST_EFFECTS[name];
  if (query) return runner.story.BindExternalFunction(name, (...args: unknown[]) => query(runnerWorld(runner), args), true);
  if (effect) return runner.story.BindExternalFunction(name, (...args: unknown[]) => effect(runnerWorld(runner), args), false);
  throw new Error(`External function ${name} has no query or effect in src/sim/quests.ts`);
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
