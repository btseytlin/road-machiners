// The shape of the compiled quest bundle. npm run quests:build writes quests.json from the ink sources in quests/,
// and src/sim/quests.ts checks it on load. See docs/architecture/quests.md.

export type QuestValue = string | number | boolean;
export type QuestValueType = 'string' | 'number' | 'boolean';
export type QuestVarDecl = { type: QuestValueType; init: QuestValue };
export type QuestViewKind = 'transcript' | 'page';
export type QuestStat = { name: string; label: string; words: string[] | null };
export type QuestFact = { name: string; text: string };
export type CompiledQuest = { story: string; vars: Record<string, QuestVarDecl>; checkpoints: string[]; view: QuestViewKind; stats: QuestStat[]; facts: QuestFact[] };
export type QuestBundle = { world: Record<string, QuestVarDecl>; externals: string[]; quests: Record<string, CompiledQuest> };

export const CHECKPOINT_TAG = 'checkpoint:';
export const COST_TAG = 'cost:';
export const QUEST_VIEWS: readonly QuestViewKind[] = ['transcript', 'page'];
export const MONEY_STAT = 'money';
