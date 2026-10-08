// Checks quest sources without the game: compile rules, game hooks both ways, every checkpoint, and a walk over
// every choice through the sim runner that finds ink errors, loops with no way out and sections never reached.

import type { QuestBundle } from '../data/quests';
import { chooseQuestOption, QUEST_EFFECTS, QUEST_QUERIES, questView, startQuest } from '../sim/quests';
import type { World } from '../sim/types';
import { compileSources, type QuestSources } from './quest-compile';

export type QuestReport = { quest: string; states: number; problems: string[] };

type Walk = { key: string; world: World; picks: string[] };
type Seen = { picks: string[]; next: string[]; ended: boolean };
type InkState = { flows: Record<string, { callstack: { threads: { callstack: unknown }[] }; currentChoices: { text: string; targetPath: string }[] }>; currentFlowName: string; variablesState: unknown; visitCounts: Record<string, number>; previousRandom: number };

export const QUEST_STATE_LIMIT = 5000;
export const QUEST_VISIT_CAP = 3;

export function checkQuests(sources: QuestSources, world: World, limit: number): QuestReport[] {
  const { bundle, errors, warnings, sections } = compileSources(sources, true);
  const hooks = hookProblems(bundle);
  const shared: QuestReport = { quest: 'all', states: 0, problems: [...errors, ...warnings, ...hooks] };
  if (hooks.length > 0) return [shared];
  return [shared, ...Object.keys(bundle.quests).map((id) => exploreQuest(world, bundle, id, sections[id] ?? [], limit))];
}

function hookProblems(bundle: QuestBundle): string[] {
  const queries = Object.keys(QUEST_QUERIES);
  const effects = Object.keys(QUEST_EFFECTS);
  const hooks = new Set([...queries, ...effects]);
  return [
    ...bundle.externals.filter((name) => !hooks.has(name)).map((name) => `External function ${name} has no query or effect in src/sim/quests.ts`),
    ...[...hooks].filter((name) => !bundle.externals.includes(name)).map((name) => `Hook ${name} in src/sim/quests.ts has no EXTERNAL in world.ink`),
    ...queries.filter((name) => effects.includes(name)).map((name) => `Hook ${name} is both a query and an effect`),
  ];
}

function exploreQuest(start: World, bundle: QuestBundle, id: string, sections: readonly string[], limit: number): QuestReport {
  const problems: string[] = [];
  const seen = new Map<string, Seen>();
  const visited = new Set<string>();
  const queue = bundle.quests[id].checkpoints.flatMap((checkpoint) => attempt(problems, `${id}: checkpoint ${checkpoint}`, () => walkOf(startQuest(start, bundle, id, checkpoint), [])));
  while (queue.length > 0 && seen.size < limit) {
    const walk = queue.shift() as Walk;
    if (!seen.has(walk.key)) queue.push(...step(walk, bundle, id, seen, visited, problems));
  }
  const report = (more: string[]) => ({ quest: id, states: seen.size, problems: [...problems, ...more] });
  if (queue.length > 0) return report([`${id}: stopped after ${limit} states, so loops and reach are unchecked`]);
  return report([...trapProblems(id, seen), ...sections.filter((s) => !visited.has(s)).map((s) => `${id}: section ${s} is never reached`)]);
}

function step(walk: Walk, bundle: QuestBundle, id: string, seen: Map<string, Seen>, visited: Set<string>, problems: string[]): Walk[] {
  const view = questView(walk.world);
  for (const path of Object.keys(inkOf(walk.world).visitCounts)) visited.add(path);
  const node: Seen = { picks: walk.picks, next: [], ended: view.ended };
  seen.set(walk.key, node);
  return view.choices.flatMap((text, index) => attempt(problems, `${id}: after ${[...walk.picks, text].join(' > ')}`, () => {
    const next = walkOf(chooseQuestOption(walk.world, bundle, index), [...walk.picks, text]);
    node.next.push(next.key);
    return next;
  }));
}

function attempt(problems: string[], where: string, run: () => Walk): Walk[] {
  try {
    return [run()];
  } catch (err) {
    problems.push(`${where}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function trapProblems(id: string, seen: Map<string, Seen>): string[] {
  const ends = new Set([...seen].filter(([, node]) => node.ended).map(([key]) => key));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, node] of seen) {
      if (ends.has(key) || !node.next.some((next) => ends.has(next))) continue;
      ends.add(key);
      grew = true;
    }
  }
  return [...seen].filter(([key]) => !ends.has(key)).map(([, node]) => `${id}: after ${node.picks.join(' > ')}: no choice leads to an end from here`);
}

function walkOf(world: World, picks: string[]): Walk {
  return { key: stateKey(world), world, picks };
}

function inkOf(world: World): InkState {
  const live = world.player.quests.live;
  if (!live) throw new Error('The quest left no live state');
  return JSON.parse(live.ink) as InkState;
}

function stateKey(world: World): string {
  const ink = inkOf(world);
  const flow = ink.flows[ink.currentFlowName];
  const visits = Object.fromEntries(Object.entries(ink.visitCounts).map(([path, count]) => [path, Math.min(count, QUEST_VISIT_CAP)]));
  const choices = flow.currentChoices.map((c) => [c.text, c.targetPath]);
  return JSON.stringify([flow.callstack.threads.map((t) => t.callstack), choices, ink.variablesState, visits, ink.previousRandom, world.player.quests.session, world.player.money]);
}
