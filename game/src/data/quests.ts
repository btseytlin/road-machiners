// The shape of the compiled quest bundle. npm run quests:build writes quests.json from the ink sources in quests/,
// and src/sim/quests.ts checks it on load. See docs/architecture/quests.md.

export type QuestValue = string | number | boolean;
export type QuestValueType = 'string' | 'number' | 'boolean';
export type QuestVarDecl = { type: QuestValueType; init: QuestValue };
export type CompiledQuest = { story: string; vars: Record<string, QuestVarDecl>; checkpoints: string[] };
export type QuestBundle = { world: Record<string, QuestVarDecl>; externals: string[]; quests: Record<string, CompiledQuest> };

export const CHECKPOINT_TAG = 'checkpoint:';
