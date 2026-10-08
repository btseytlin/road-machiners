// Plays one quest in the terminal on a new game, compiled fresh from src/data/quests/. Choices are numbered from 1.
// Usage: npm run quest -- <quest> [--checkpoint c] [--picks 1,2] [--set name=value] [--save file] [--load file]
// Without --picks it reads picks from the keyboard. docs/architecture/quests.md describes the flags.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { START_KITS } from '../src/data/start.ts';
import { UNITS } from '../src/data/units.ts';
import { chooseQuestOption, questProblems, questView, restoreQuest, startQuest } from '../src/sim/quests.ts';
import { defaultSetup } from '../src/sim/settings.ts';
import { newWorld } from '../src/sim/world.ts';
import { TEST_MAP } from '../src/test/map.ts';
import { compileSources, readQuestSources } from '../src/test/quest-compile.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { checkpoint: { type: 'string' }, picks: { type: 'string' }, set: { type: 'string', multiple: true }, save: { type: 'string' }, load: { type: 'string' } },
});
const id = positionals[0];
if (!id) throw new Error('Name a quest: npm run quest -- <quest>');
const { bundle, errors } = compileSources(readQuestSources('src/data/quests'), false);
if (errors.length > 0) throw new Error(`Quests do not compile:\n${errors.join('\n')}`);
if (!bundle.quests[id]) throw new Error(`No quest ${id}. Quests: ${Object.keys(bundle.quests).join(', ')}`);

const PARSERS = {
  string: (text) => text,
  boolean: (text) => ({ true: true, false: false })[text],
  number: (text) => (Number.isFinite(Number(text)) && text !== '' ? Number(text) : undefined),
};

const fresh = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'), false);
const startMoney = fresh.player.money;
let world = values.load ? loaded(fresh, values.load) : started(fresh);
show(world);
world = values.picks ? scripted(world, values.picks) : await typed(world);
finish(world);

function loaded(w, file) {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const quests = { world: saved.world, local: saved.local, session: saved.session, live: null };
  const problems = questProblems(quests, bundle);
  if (problems.length > 0) throw new Error(`${file} does not fit the current quests:\n${problems.join('\n')}`);
  if (quests.session?.quest !== id) throw new Error(`${file} holds no open session of ${id}`);
  w.player.quests = quests;
  restoreQuest(w, bundle);
  console.log(`Resumed ${id} at checkpoint ${quests.session.checkpoint}\n`);
  return w;
}

function started(w) {
  for (const assignment of values.set ?? []) setVariable(w, assignment);
  const checkpoint = values.checkpoint ?? bundle.quests[id].checkpoints[0];
  return startQuest(w, bundle, id, checkpoint);
}

function setVariable(w, assignment) {
  const [name, text] = assignment.split('=');
  const local = bundle.quests[id].vars[name];
  const decl = local ?? bundle.world[name];
  if (!decl || text === undefined) throw new Error(`--set ${assignment} names no variable of ${id} or the world`);
  const value = parsedValue(decl.type, text, assignment);
  if (local) w.player.quests.local[id] = { ...w.player.quests.local[id], [name]: value };
  else w.player.quests.world[name] = value;
}

function parsedValue(type, text, assignment) {
  const value = PARSERS[type](text);
  if (value === undefined) throw new Error(`--set ${assignment} needs a ${type}`);
  return value;
}

function pick(w, number) {
  const index = Number(number) - 1;
  const text = questView(w).choices[index];
  if (text === undefined) throw new Error(`No choice ${number}`);
  console.log(`> ${number}. ${text}\n`);
  const next = chooseQuestOption(w, bundle, index);
  show(next);
  return next;
}

function scripted(w, picks) {
  return picks.split(',').reduce((at, number) => pick(at, number.trim()), w);
}

async function typed(w) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  let at = w;
  while (!questView(at).ended) {
    const answer = (await input.question('Pick a number, or q to stop: ')).trim();
    if (answer === 'q') break;
    at = pick(at, answer);
  }
  input.close();
  return at;
}

function show(w) {
  const view = questView(w);
  for (const line of view.lines) console.log(line.tags.length > 0 ? `${line.text}   # ${line.tags.join(' # ')}` : line.text);
  view.choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice}`));
  if (view.ended) console.log('(the quest ended)');
  console.log('');
}

function finish(w) {
  const { live: _live, ...saved } = w.player.quests;
  console.log(`World variables: ${JSON.stringify(saved.world)}`);
  console.log(`Quest variables: ${JSON.stringify(saved.local)}`);
  console.log(saved.session ? `Open at checkpoint ${saved.session.checkpoint}` : 'No quest is open');
  console.log(`Money change: ${(w.player.money - startMoney) / UNITS.centsPerM} M`);
  if (values.save) {
    writeFileSync(values.save, `${JSON.stringify(saved, null, 1)}\n`);
    console.log(`Saved the quest state to ${values.save}`);
  }
}
