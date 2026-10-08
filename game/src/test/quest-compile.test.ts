import { describe, expect, it } from 'vitest';
import BUNDLE from '../data/quests.json';
import { parseBundle } from '../sim/quests';
import { compileBundle, compileQuest, readQuestSources, type QuestSources } from './quest-compile';

const WORLD = 'VAR heard = false\nEXTERNAL money()\n';

function sources(quest: string): QuestSources {
  return { 'world.ink': WORLD, 'q.ink': `INCLUDE world.ink\n${quest}` };
}

function compile(given: QuestSources): ReturnType<typeof compileQuest> {
  return compileQuest('q', given, false);
}

describe('the quest bundle', () => {
  it('matches the ink sources, so npm run quests:build ran after the last edit', () => {
    expect(compileBundle(readQuestSources('src/data/quests')), 'quests.json is stale. Run npm run quests:build').toEqual(BUNDLE);
  });

  it('parses into the typed bundle the game reads', () => {
    expect(parseBundle(BUNDLE).quests.bowl_hattie.checkpoints).toEqual(['start', 'start.hub']);
  });

  it('rejects a bundle variable whose initial value does not match its type', () => {
    const bad = { world: { heard: { type: 'boolean', init: 1 } }, externals: [], quests: {} };
    expect(() => parseBundle(bad)).toThrow('Variable heard of world has a bad declaration');
  });
});

describe('compileQuest', () => {
  it('splits world variables from the quest own variables', () => {
    const { quest } = compile(sources('VAR trust = 2\nVAR name = "Hattie"\n=== start ===\n# checkpoint: start\nHi.\n-> END\n'));
    expect(quest?.vars).toEqual({ name: { type: 'string', init: 'Hattie' }, trust: { type: 'number', init: 2 } });
  });

  it('lists knots and stitches whose checkpoint tag names them', () => {
    const { quest } = compile(sources('=== start ===\n# checkpoint: start\nHi.\n-> talk\n= talk\n# checkpoint: start.talk\nYo.\n-> END\n= aside\nNo tag.\n-> END\n'));
    expect(quest?.checkpoints).toEqual(['start', 'start.talk']);
  });

  it('fails a checkpoint tag that names another section', () => {
    const { quest, errors } = compile(sources('=== start ===\n# checkpoint: begin\nHi.\n-> END\n'));
    expect(quest).toBeNull();
    expect(errors).toEqual(['Section start carries the checkpoint tag of begin. A checkpoint tag names its own section.']);
  });

  it('fails a list variable, which a save cannot hold', () => {
    const { errors } = compile(sources('LIST moods = calm, angry\n=== start ===\nHi.\n-> END\n'));
    expect(errors).toEqual(['List moods cannot be saved. Use int, float, bool or string variables.']);
  });

  it('fails a once-only choice and a visit count read, which a load resets', () => {
    const { quest, errors } = compile(sources('=== start ===\n# checkpoint: start\n* [Once.] -> start\n+ {start > 1} [Again.] -> END\n+ {TURNS_SINCE(-> start) > 0} [Later.] -> END\n'));
    expect(quest).toBeNull();
    expect(errors).toEqual([
      'Line 4: a once-only * choice comes back after a load. Use a sticky + choice with a variable guard.',
      'Line 5: start reads a visit count, which a load resets. Keep the fact in a variable.',
      'Line 6: TURNS_SINCE reads a visit count, which a load resets. Keep the fact in a variable.',
    ]);
  });

  it('reports an ink error with its file and line', () => {
    const { quest, errors } = compile(sources('=== start ===\nHi.\n-> nowhere\n'));
    expect(quest).toBeNull();
    expect(errors.join('\n')).toMatch(/q\.ink.*line 4.*nowhere/);
  });

  it('fails an include of a file that is no quest source', () => {
    const { errors } = compile({ 'world.ink': WORLD, 'q.ink': 'INCLUDE missing.ink\n=== start ===\nHi.\n-> END\n' });
    expect(errors.join('\n')).toContain('INCLUDE names missing.ink, which is no quest source');
  });
});
