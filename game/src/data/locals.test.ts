import { describe, expect, it } from 'vitest';
import { TOPICS } from './dialogue';
import { LOCAL_TOPICS, LOCALS, NOTES, type LocalTopic, type NoteId } from './locals';

// Words from outside the world, which no one in it would say.
const OUT_OF_CHARACTER = /\b(turns?|quests?|xp|levels?|hp|markers?|waypoints?|maps?|click\w*|players?|games?)\b/i;
// Counts other than a day count or a clock hour. "Wagon Seven" is a name, and "one" is mostly a pronoun.
const NUMBER = /\d|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundreds?|thousands?|dozens?)\b(?! (days?|o'clock))/i;

const topics = Object.entries(LOCAL_TOPICS) as [string, LocalTopic][];

function lines(): { where: string; text: string }[] {
  return [
    ...Object.values(LOCALS).map((l) => ({ where: `${l.id} greeting`, text: l.greeting })),
    ...topics.flatMap(([id, t]) => [t.ask, t.answer, ...(t.work ? [t.work.offer, t.work.empty, t.work.full] : [])].map((text) => ({ where: id, text }))),
    ...Object.entries(NOTES).flatMap(([id, n]) => [n.title, n.from, n.text].map((text) => ({ where: `note ${id}`, text }))),
    ...Object.values(TOPICS.armyWagon.nodes).map((n) => ({ where: 'radio armyWagon', text: n.line })),
  ];
}

describe('settlement talk content', () => {
  it('keeps every line in character, with no counts but days and hours', () => {
    for (const { where, text } of lines()) {
      expect(text, where).not.toMatch(OUT_OF_CHARACTER);
      expect(text.replace(/wagon Seven/gi, 'wagon'), where).not.toMatch(NUMBER);
    }
  });

  it('gives each local three to five topics, each of their own', () => {
    for (const local of Object.values(LOCALS)) {
      expect(local.topics.length, local.id).toBeGreaterThanOrEqual(3);
      expect(local.topics.length, local.id).toBeLessThanOrEqual(5);
      for (const id of local.topics) expect(id.startsWith(`${local.id}.`), id).toBe(true);
    }
    expect(new Set(Object.values(LOCALS).flatMap((l) => l.topics))).toEqual(new Set(Object.keys(LOCAL_TOPICS)));
  });

  it('answers every topic, with work lines only for work, and offers terms in every work offer', () => {
    for (const [id, t] of topics) {
      if (t.work) {
        expect(t.work.offer, id).toContain('{terms}');
        expect(t.notes, id).toEqual([]);
      } else expect(t.answer.length, id).toBeGreaterThan(0);
    }
  });

  it('can teach every note from some topic or the radio', () => {
    const taught = new Set<NoteId>([...topics.flatMap(([, t]) => t.notes), 'wagonRoad']);

    expect(taught).toEqual(new Set(Object.keys(NOTES)));
  });
});
