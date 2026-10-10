// Compiles the ink quests in src/data/quests/ into src/data/quests.json, which the game reads.
// Usage: npm run quests:build. A test fails when quests.json is stale.
import { writeFileSync } from 'node:fs';
import { compileBundle, readQuestSources } from '../src/test/quest-compile.ts';

const FILE = 'src/data/quests.json';
const bundle = compileBundle(readQuestSources('src/data/quests'));
writeFileSync(FILE, `${JSON.stringify(bundle, null, 1)}\n`);
console.log(`Wrote ${Object.keys(bundle.quests).length} quests to ${FILE}`);
