// Writes the saved shape and the saved quest names of the current save format to src/three/save-shape.json.
// Usage: npm run save:shape. It refuses a new shape or a lost quest name under the recorded format, since old
// saves of that format would load without migration.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SAVE_FORMAT } from '../src/three/save-migrations.ts';
import { lostQuestNames, newGameShape, questNames } from '../src/test/save-shape.ts';
import { QUESTS } from '../src/sim/quests.ts';

const FILE = 'src/three/save-shape.json';
const format = `${SAVE_FORMAT.major}.${SAVE_FORMAT.minor}`;
const shape = newGameShape();
const quests = questNames(QUESTS);

if (existsSync(FILE)) {
  const recorded = JSON.parse(readFileSync(FILE, 'utf8'));
  if (recorded.format === format && JSON.stringify(recorded.shape) !== JSON.stringify(shape)) {
    throw new Error(`The saved shape changed under save format ${format}. Add a migration step or bump SAVE_MAJOR in src/three/save-migrations.ts first.`);
  }
  const lost = recorded.format === format && recorded.quests ? lostQuestNames(recorded.quests, quests) : [];
  if (lost.length > 0) {
    throw new Error(`Saved quest names changed under save format ${format}: ${lost.join(', ')}. Add a migration step with the quest helpers in src/three/save-migrations.ts first.`);
  }
}
writeFileSync(FILE, `${JSON.stringify({ format, shape, quests }, null, 1)}\n`);
console.log(`Wrote the save format ${format} shape to ${FILE}`);
