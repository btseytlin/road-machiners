// Compiles the ink quest sources into the bundle the game runs. Tools and tests only: the game reads quests.json.
// Every quest includes world.ink, which declares the shared world variables and the external functions.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Compiler, CompilerOptions, type Story } from 'inkjs/full';
import { ErrorType } from 'inkjs/compiler/Parser/ErrorType';
import type { CompiledQuest, QuestBundle, QuestValueType, QuestVarDecl } from '../data/quests';

export type QuestSources = Record<string, string>;
export type CompileResult = { quest: CompiledQuest | null; errors: string[]; warnings: string[] };

type ParsedVar = { listDefinition: unknown };
type ParsedFlow = { isFunction: boolean; subFlowsByName: Map<string, ParsedFlow> };
type Parsed = { story: Story; vars: string[]; externals: string[]; flows: Map<string, ParsedFlow> };

export const WORLD_FILE = 'world.ink';
export const CHECKPOINT_TAG = 'checkpoint:';

export function readQuestSources(dir: string): QuestSources {
  const files = readdirSync(dir).filter((file) => file.endsWith('.ink')).sort();
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(dir, file), 'utf8')]));
}

export function questIds(sources: QuestSources): string[] {
  return Object.keys(sources).filter((file) => file !== WORLD_FILE).map((file) => file.replace(/\.ink$/, ''));
}

export function compileBundle(sources: QuestSources): QuestBundle {
  const world = parseInk(WORLD_FILE, sources);
  if (world.errors.length > 0 || !world.parsed) throw new Error(`${WORLD_FILE} does not compile:\n${world.errors.join('\n')}`);
  const results = questIds(sources).map((id) => [id, compileQuest(id, sources)] as const);
  const failed = results.flatMap(([id, r]) => r.errors.map((e) => `${id}: ${e}`));
  if (failed.length > 0) throw new Error(`Quests do not compile:\n${failed.join('\n')}`);
  return {
    world: declarations(world.parsed.story, world.parsed.vars),
    externals: [...world.parsed.externals].sort(),
    quests: Object.fromEntries(results.map(([id, r]) => [id, r.quest as CompiledQuest])),
  };
}

export function compileQuest(id: string, sources: QuestSources): CompileResult {
  const world = parseInk(WORLD_FILE, sources);
  const own = parseInk(`${id}.ink`, sources);
  if (!own.parsed || !world.parsed) return { quest: null, errors: [...world.errors, ...own.errors], warnings: own.warnings };
  const worldVars = new Set(world.parsed.vars);
  const local = own.parsed.vars.filter((name) => !worldVars.has(name));
  const ruleErrors = [...varErrors(own.parsed), ...checkpointErrors(own.parsed)];
  if (ruleErrors.length > 0) return { quest: null, errors: ruleErrors, warnings: own.warnings };
  const story = own.parsed.story.ToJson();
  if (!story) throw new Error(`Quest ${id} compiled to no story`);
  return { quest: { story, vars: declarations(own.parsed.story, local), checkpoints: checkpointsOf(own.parsed) }, errors: [], warnings: own.warnings };
}

function parseInk(file: string, sources: QuestSources): { parsed: Parsed | null; errors: string[]; warnings: string[] } {
  const source = sources[file];
  if (source === undefined) return { parsed: null, errors: [`No source file ${file}`], warnings: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileHandler = { ResolveInkFilename: (name: string) => name, LoadInkFileContents: (name: string) => includedSource(sources, name) };
  const onError = (message: string, type: ErrorType) => (type === ErrorType.Error ? errors : warnings).push(message);
  const compiler = new Compiler(source, new CompilerOptions(file, [], false, onError, fileHandler));
  const story = compileOrReport(compiler, errors);
  if (!story) return { parsed: null, errors, warnings };
  const parsed = compiler.parsedStory as unknown as { variableDeclarations: Map<string, ParsedVar>; externals: Map<string, unknown>; subFlowsByName: Map<string, ParsedFlow> };
  const lists = [...parsed.variableDeclarations].filter(([, decl]) => decl.listDefinition).map(([name]) => `List ${name} cannot be saved. Use int, float, bool or string variables.`);
  if (lists.length > 0) return { parsed: null, errors: lists, warnings };
  return { parsed: { story, vars: [...parsed.variableDeclarations.keys()], externals: [...parsed.externals.keys()], flows: parsed.subFlowsByName }, errors, warnings };
}

function compileOrReport(compiler: Compiler, errors: readonly string[]): Story | null {
  try {
    return compiler.Compile();
  } catch (err) {
    if (errors.length > 0) return null;
    throw err;
  }
}

function includedSource(sources: QuestSources, name: string): string {
  const source = sources[name];
  if (source === undefined) throw new Error(`INCLUDE names ${name}, which is no quest source`);
  return source;
}

function declarations(story: Story, names: readonly string[]): Record<string, QuestVarDecl> {
  return Object.fromEntries([...names].sort().map((name) => {
    const init = story.variablesState.$(name);
    if (!isSaveable(init)) throw new Error(`Variable ${name} holds a value that cannot be saved`);
    return [name, { type: typeof init as QuestValueType, init }];
  }));
}

function isSaveable(value: unknown): value is QuestVarDecl['init'] {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function varErrors(parsed: Parsed): string[] {
  return parsed.vars.flatMap((name) => {
    return isSaveable(parsed.story.variablesState.$(name)) ? [] : [`Variable ${name} holds a divert or another value that cannot be saved. Use int, float, bool or string.`];
  });
}

export function sectionsOf(flows: Map<string, ParsedFlow>): string[] {
  return [...flows].filter(([, flow]) => !flow.isFunction).flatMap(([knot, flow]) => [knot, ...[...flow.subFlowsByName.keys()].map((stitch) => `${knot}.${stitch}`)]);
}

function checkpointTag(story: Story, path: string): string | null {
  const tag = (story.TagsForContentAtPath(path) ?? []).find((t) => t.startsWith(CHECKPOINT_TAG));
  return tag === undefined ? null : tag.slice(CHECKPOINT_TAG.length).trim();
}

function checkpointsOf(parsed: Parsed): string[] {
  return sectionsOf(parsed.flows).filter((path) => checkpointTag(parsed.story, path) === path);
}

function checkpointErrors(parsed: Parsed): string[] {
  return sectionsOf(parsed.flows).flatMap((path) => {
    const name = checkpointTag(parsed.story, path);
    return name === null || name === path ? [] : [`Section ${path} carries the checkpoint tag of ${name}. A checkpoint tag names its own section.`];
  });
}
