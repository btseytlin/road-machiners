// The compiled quests the game runs. npm run quests:build writes quests.json from the ink sources in quests/,
// and docs/architecture/quests.md describes the format.

import BUNDLE from './quests.json';

export type QuestValue = string | number | boolean;
export type QuestValueType = 'string' | 'number' | 'boolean';
export type QuestVarDecl = { type: QuestValueType; init: QuestValue };
export type CompiledQuest = { story: string; vars: Record<string, QuestVarDecl>; checkpoints: string[] };
export type QuestBundle = { world: Record<string, QuestVarDecl>; externals: string[]; quests: Record<string, CompiledQuest> };

export const QUESTS: QuestBundle = parseBundle(BUNDLE);

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
