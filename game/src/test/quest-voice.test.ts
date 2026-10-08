import { describe, expect, it } from 'vitest';
import { handoffQuest, TOPICS } from '../data/dialogue';
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
  const words = text.replace(/\{[^{}]*?:([^{}]*)\}/g, (_, options: string) => options.replace(/\|/g, ' ')).replace(/\{[^{}]*\}/g, '');
  return words.replace(/#.*$/, '').replace(/->.*$/, '').replace(/<[^>]*>/g, '').trim();
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

  it('starts every quest from a local, a radio handoff or another quest', () => {
    const fromLocals = Object.values(LOCALS).map((l) => l.quest);
    const fromRadio = Object.values(TOPICS).flatMap((t) => Object.values(t.nodes).flatMap((n) => n.options.flatMap((o) => handoffQuest(o.go) ?? [])));
    const fromQuests = SOURCES.flatMap(([, source]) => [...source.matchAll(/~\s*begin\("([a-z_]+)"\)/g)].map((m) => m[1]));
    const started = new Set([...fromLocals, ...fromRadio, ...fromQuests]);
    expect(started).toEqual(new Set(Object.keys(QUESTS.quests)));
  });

  it('can teach every note from some local or the radio', () => {
    const taught = new Set<NoteId>(['wagonRoad']);
    for (const [, source] of SOURCES) for (const match of source.matchAll(/~\s*note\("([a-zA-Z]+)"\)/g)) taught.add(match[1] as NoteId);

    expect(taught).toEqual(new Set(Object.keys(NOTES)));
  });
});
