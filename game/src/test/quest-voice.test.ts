import { describe, expect, it } from 'vitest';
import { TOPICS } from '../data/dialogue';
import { LOCALS, NOTES, type NoteId } from '../data/locals';
import { QUESTS } from '../sim/quests';
import { readQuestSources } from './quest-compile';

const OUT_OF_CHARACTER = /\b(turns?|quests?|xp|levels?|hp|markers?|waypoints?|maps?|click\w*|players?|games?)\b/i;
const NUMBER = /\d|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundreds?|thousands?|dozens?)\b(?! (days?|o'clock))/i;
const LOGIC = /^(INCLUDE|EXTERNAL|VAR|CONST|~|->|=|#|\{|\}|-\s)/;
const CHOICE = /^[+*]+\s*(?:\{[^}]*\}\s*)?\[([^\]]*)\]/;

const SOURCES = Object.entries(readQuestSources('src/data/quests'));

function spoken(line: string): string | null {
  const text = line.trim();
  const choice = CHOICE.exec(text);
  if (choice) return choice[1];
  if (text === '' || LOGIC.test(text)) return null;
  return text.replace(/#.*$/, '').replace(/->.*$/, '').replace(/<[^>]*>/g, '').trim();
}

function lines(): { where: string; text: string }[] {
  return [
    ...SOURCES.flatMap(([file, source]) => source.split('\n').flatMap((line, k) => {
      const text = spoken(line);
      return text ? [{ where: `${file}:${k + 1}`, text }] : [];
    })),
    ...Object.entries(NOTES).flatMap(([id, n]) => [n.title, n.from, n.text].map((text) => ({ where: `note ${id}`, text }))),
    ...Object.values(TOPICS.armyWagon.nodes).map((n) => ({ where: 'radio armyWagon', text: n.line })),
  ];
}

describe('settlement talk content', () => {
  it('keeps every line in character, with no counts but days and hours', () => {
    const found = lines();
    expect(found.length).toBeGreaterThan(50);
    for (const { where, text } of found) {
      expect(text, where).not.toMatch(OUT_OF_CHARACTER);
      expect(text.replace(/wagon Seven/gi, 'wagon'), where).not.toMatch(NUMBER);
    }
  });

  it('gives every local a quest, and every quest of a town a local', () => {
    const quests = Object.keys(QUESTS.quests);
    for (const local of Object.values(LOCALS)) expect(quests, local.id).toContain(local.quest);
    expect(new Set(Object.values(LOCALS).map((l) => l.quest))).toEqual(new Set(quests.filter((q) => q.startsWith('bowl_') || q.startsWith('nose_'))));
  });

  it('can teach every note from some local or the radio', () => {
    const taught = new Set<NoteId>(['wagonRoad']);
    for (const [, source] of SOURCES) for (const match of source.matchAll(/~\s*note\("([a-zA-Z]+)"\)/g)) taught.add(match[1] as NoteId);

    expect(taught).toEqual(new Set(Object.keys(NOTES)));
  });
});
