// Checks every quest in src/data/quests/: compile rules, game hooks, checkpoints, loops, reach and a stale bundle.
// Usage: npm run quests:check. It exits non-zero on any problem.
import { readFileSync } from 'node:fs';
import { START_KITS } from '../src/data/start.ts';
import { defaultSetup } from '../src/sim/settings.ts';
import { newWorld } from '../src/sim/world.ts';
import { TEST_MAP } from '../src/test/map.ts';
import { checkQuests, QUEST_STATE_LIMIT } from '../src/test/quest-check.ts';
import { compileBundle, readQuestSources } from '../src/test/quest-compile.ts';

const DIR = 'src/data/quests';
const BUNDLE_FILE = 'src/data/quests.json';
const sources = readQuestSources(DIR);
const world = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'), false);
const reports = checkQuests(sources, world, QUEST_STATE_LIMIT);
const problems = reports.flatMap((report) => report.problems);
if (problems.length === 0 && JSON.stringify(compileBundle(sources)) !== JSON.stringify(JSON.parse(readFileSync(BUNDLE_FILE, 'utf8')))) {
  problems.push(`${BUNDLE_FILE} is stale. Run npm run quests:build`);
}
for (const report of reports.filter((r) => r.quest !== 'all')) console.log(`${report.quest}: ${report.states} states walked`);
for (const problem of problems) console.error(problem);
console.log(problems.length === 0 ? 'Every quest passed.' : `${problems.length} quest problems.`);
process.exitCode = problems.length === 0 ? 0 : 1;
