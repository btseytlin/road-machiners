// The people of Bowl and Nose and the journal notes their rumors leave. What each local says lives in their ink
// quest in quests/, which src/sim/quests.ts runs. Lines stay in character, as src/test/quest-voice.test.ts checks.
// docs/lore.md keeps the voices.

export const NOTE_IDS = ['wagonBowl', 'wagonNose', 'wagonRoad', 'wagonFound', 'greenPit', 'glassTank', 'burntConvoy'] as const;
export type NoteId = (typeof NOTE_IDS)[number];

export type LocalId = 'ruben' | 'hattie' | 'dag' | 'kovac' | 'lena' | 'ibo';

export type LocalDef = { id: LocalId; town: 'bowl' | 'nose'; quest: string };

export const LOCALS: Record<LocalId, LocalDef> = {
  ruben: { id: 'ruben', town: 'bowl', quest: 'bowl_ruben' },
  hattie: { id: 'hattie', town: 'bowl', quest: 'bowl_hattie' },
  dag: { id: 'dag', town: 'bowl', quest: 'bowl_dag' },
  kovac: { id: 'kovac', town: 'nose', quest: 'nose_kovac' },
  lena: { id: 'lena', town: 'nose', quest: 'nose_lena' },
  ibo: { id: 'ibo', town: 'nose', quest: 'nose_ibo' },
};
