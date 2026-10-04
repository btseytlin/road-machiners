// Sweeps the turn logs of a recorded batch for every kind of trouble at once, so one batch answers every question
// without a replay. It reads <dir>/*.turns.jsonl from progression:record and prints per run: how the turns were spent,
// each fight, each big loss with the events before it, tows, stalls, debt and dry tanks.
// Usage: npm run progression:analyze -- <dir> [--run trader-1]
import { createReadStream, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { JobTally } from '../src/sim/progression/job-checks.ts';

// A loss of more than this share of net worth within LOSS_TURNS counts as a big loss: about one stolen gun.
const LOSS_SHARE = 0.1;
const LOSS_TURNS = 30;
// Event lines shown before a big loss and at the start of a fight.
const CONTEXT_TURNS = 5;
// Moving less than STALL_TILES in STALL_TURNS outside a shop, a job or a tow is a stall. A truck crawls about a tile a turn.
const STALL_TILES = 5;
const STALL_TURNS = 60;

// A kind of event seen more than FLAP_COUNT times for one truck within FLAP_TURNS turns means a rule flaps.
const FLAP_COUNT = 6;
const FLAP_TURNS = 40;
const FLAP_KINDS = new Set(['towDropped', 'towOffer', 'towHitched', 'stateEnded', 'hostile']);

const argv = process.argv.slice(2).filter((a) => a !== '--');
const dir = argv[0];
if (!dir) throw new Error('Usage: npm run progression:analyze -- <dir> [--run trader-1]');
const runAt = argv.indexOf('--run');
const wanted = runAt < 0 ? null : `${argv[runAt + 1]}.turns.jsonl`;
const files = readdirSync(dir).filter((f) => f.endsWith('.turns.jsonl') && (wanted === null || f === wanted)).sort();
if (files.length === 0) throw new Error(`No turn logs in ${dir}`);
for (const file of files) {
  const name = file.replace('.turns.jsonl', '');
  analyze(name, await readLines(`${dir}/${file}`));
  await analyzeWorld(name, `${dir}/${name}.world.jsonl`);
}

async function readLines(path) {
  const lines = [];
  for await (const text of createInterface({ input: createReadStream(path) })) if (text) lines.push(JSON.parse(text));
  return lines;
}

function analyze(name, turns) {
  const last = turns[turns.length - 1];
  console.log(`\n=== ${name}: turns ${turns[0].t}-${last.t}, net worth ${turns[0].nw} -> ${last.nw}, money ${last.money}, ${last.chassis}`);
  printTime(turns);
  printJob(name.slice(0, name.lastIndexOf('-')), turns);
  printFights(turns);
  printLosses(turns);
  printTows(turns);
  printStalls(turns);
  printEpisodes('debt', turns, (l) => l.money < 0);
  printEpisodes('dry tank', turns, (l) => l.fuel <= 0);
}

// The share of turns with each flag, parked in a shop, on a job, and with no order.
function printTime(turns) {
  const share = (test) => `${Math.round((100 * turns.filter(test).length) / turns.length)}%`;
  const flags = ['combat', 'stranded', 'towed', 'beacon'].map((f) => `${f} ${share((l) => l.flags.includes(f))}`);
  console.log(`time: ${flags.join(', ')}, job ${share((l) => l.job !== null)}, no order ${share((l) => l.order === null)}`);
}

// Whether the bot did its job: the first day end where it fell below its floor in src/sim/progression/job-checks.ts.
function printJob(archetype, turns) {
  const tally = new JobTally();
  for (const line of turns) {
    tally.note(line);
    const failure = tally.failure(archetype);
    if (failure) return console.log(`job: FAIL turn ${line.t}: ${failure}`);
  }
  console.log('job: ok');
}

// Stretches of turns where a test holds, with start, end and length.
function episodes(turns, test) {
  const found = [];
  let from = 0;
  while (from < turns.length) {
    if (!test(turns[from])) {
      from++;
      continue;
    }
    let to = from;
    while (to + 1 < turns.length && test(turns[to + 1])) to++;
    found.push({ from, to });
    from = to + 1;
  }
  return found;
}

function printEpisodes(label, turns, test) {
  const found = episodes(turns, test);
  if (found.length === 0) return;
  const list = found.map((e) => `${turns[e.from].t}-${turns[e.to].t}`).join(' ');
  console.log(`${label}: ${found.length} stretches, ${found.reduce((n, e) => n + e.to - e.from + 1, 0)} turns: ${list}`);
}

// Each combat stretch: who shot first, the foes with the player's odds to win against each and their speed against
// the truck's, how many turns the truck stood still under fire, and the net worth, cargo and parts it came out with.
// A combat stretch with no shot in it is a standoff, such as a refused demand, and prints as one line apart.
function printFights(turns) {
  const stretches = episodes(turns, (l) => l.flags.includes('combat'));
  const hasShot = (e) => turns.slice(e.from, e.to + 1).some((l) => l.ev.some((x) => x.startsWith('shot ')));
  printStandoffs(turns, stretches.filter((e) => !hasShot(e)));
  for (const e of stretches.filter(hasShot)) {
    const span = turns.slice(Math.max(0, e.from - CONTEXT_TURNS), e.to + 1);
    const fight = turns.slice(e.from, e.to + 1);
    const before = turns[Math.max(0, e.from - 1)];
    const after = turns[Math.min(turns.length - 1, e.to + 1)];
    const firstShot = span.flatMap((l) => l.ev.filter((x) => x.startsWith('shot ')).map((x) => `${l.t} ${x}`))[0] ?? 'none';
    const foes = firstSeen(fight);
    const still = fight.filter((l, i) => i > 0 && l.pos[0] === fight[i - 1].pos[0] && l.pos[1] === fight[i - 1].pos[1]).length;
    console.log(`fight ${turns[e.from].t}-${turns[e.to].t}: me speed ${before.speed}, foes ${[...foes.values()].map((f) => `${f.who} win ${f.odds}% s${f.speed}`).join(', ') || 'unseen'}`);
    console.log(`  first shot ${firstShot}; still ${still} turns; nw ${before.nw} -> ${after.nw}; ${outcome(fight, before, after)}`);
  }
}

function printStandoffs(turns, standoffs) {
  if (standoffs.length === 0) return;
  const list = standoffs.map((e) => `${turns[e.from].t}-${turns[e.to].t}`).join(' ');
  console.log(`standoffs, combat with no shots: ${standoffs.length} stretches, ${standoffs.reduce((n, e) => n + e.to - e.from + 1, 0)} turns: ${list}`);
}

// Each foe with the values of the turn it first appears, the same moment as the truck's own.
function firstSeen(fight) {
  const foes = new Map();
  for (const f of fight.flatMap((l) => l.foes)) if (!foes.has(f.id)) foes.set(f.id, f);
  return foes;
}

function outcome(fight, before, after) {
  const notes = fight.flatMap((l) => l.ev.filter((x) => /^(knockout|npcKnockout|say|plea|surrender|death)/.test(x)).map((x) => `${l.t} ${x.slice(0, 90)}`));
  const lost = before.parts.filter((p) => !after.parts.some((q) => q.split(':')[0] === p.split(':')[0])).map((p) => p.split(':')[0]);
  const cargo = `cargo ${count(before.goods)} -> ${count(after.goods)}`;
  return [cargo, lost.length ? `parts gone ${lost.join(' ')}` : '', ...notes].filter(Boolean).join('; ');
}

function count(goods) {
  return Object.values(goods).reduce((a, b) => a + b, 0);
}

// Each turn where net worth fell by more than LOSS_SHARE within LOSS_TURNS, once per loss, with the events before it.
function printLosses(turns) {
  let i = 0;
  while (i < turns.length) {
    const j = lossEnd(turns, i);
    if (j === null) {
      i++;
      continue;
    }
    console.log(`loss ${turns[i].t}-${turns[j].t}: nw ${turns[i].nw} -> ${turns[j].nw}, money ${turns[i].money} -> ${turns[j].money}, at ${turns[j].pos.join(',')}`);
    for (const l of turns.slice(Math.max(0, j - CONTEXT_TURNS), j + 1)) for (const x of l.ev) console.log(`  ${l.t} ${x.slice(0, 160)}`);
    i = j + 1;
  }
}

function lossEnd(turns, i) {
  for (let j = i + 1; j < Math.min(turns.length, i + LOSS_TURNS); j++) if (turns[i].nw - turns[j].nw > turns[i].nw * LOSS_SHARE) return j;
  return null;
}

// Every tow: where it started and ended, its fee, and the money and fuel at arrival.
function printTows(turns) {
  const tows = episodes(turns, (l) => l.flags.includes('towed'));
  if (tows.length === 0) return;
  console.log(`tows: ${tows.length}`);
  for (const e of tows) {
    const end = turns[Math.min(turns.length - 1, e.to + 1)];
    const fee = end.ev.find((x) => x.startsWith('towDone')) ?? 'no towDone';
    console.log(`  ${turns[e.from].t}-${end.t}: ${turns[e.from].pos.join(',')} -> ${end.pos.join(',')}, ${fee.slice(0, 60)}, money ${end.money}, fuel ${end.fuel}, parts ${end.parts.filter((p) => p.endsWith(':0')).join(' ') || 'sound'}`);
  }
}

// Stretches where the truck stays within STALL_TILES for STALL_TURNS while not parked for a reason.
function printStalls(turns) {
  const stalls = [];
  for (let i = 0; i + STALL_TURNS < turns.length; i += STALL_TURNS) {
    const window = turns.slice(i, i + STALL_TURNS);
    const [x, y] = window[0].pos;
    const moved = Math.max(...window.map((l) => Math.hypot(l.pos[0] - x, l.pos[1] - y)));
    const busy = window.every((l) => l.job !== null || l.flags.includes('towed') || l.state !== 'active');
    if (moved < STALL_TILES && !busy) stalls.push(`${window[0].t} at ${x},${y} order ${window[0].order} flags ${window[0].flags.join('+')}`);
  }
  if (stalls.length > 0) console.log(`still ${STALL_TURNS}+ turns: ${stalls.join('; ')}`);
}

// ---- The world log: what every truck did, not only the player.

async function worldLog(path) {
  const lines = [];
  for await (const text of createInterface({ input: createReadStream(path) })) if (text) lines.push(JSON.parse(text));
  return lines;
}

async function analyzeWorld(name, path) {
  const lines = await worldLog(path);
  const events = lines.flatMap((line) => (line.events ?? []).map((e) => ({ e, turn: line.t })));
  console.log(`--- ${name} world: ${eventTotals(events)}`);
  const flaps = flapping(events);
  if (flaps.length > 0) console.log(`flapping: ${flaps.slice(0, 12).join('; ')}`);
  printPopulation(lines);
  printOffRoad(lines);
  printNpcDeaths(lines);
}

function eventTotals(events) {
  const totals = new Map();
  for (const { e } of events) totals.set(e.t, (totals.get(e.t) ?? 0) + 1);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).slice(0, 14).join(', ');
}

// The truck an event is about, by the field that names it.
function actorOf(e) {
  return e.vehicle ?? e.by ?? e.shooter ?? e.state?.holder;
}

function flapping(events) {
  const seen = new Map();
  const flaps = new Set();
  for (const { e, turn } of events.filter(({ e }) => FLAP_KINDS.has(e.t) && actorOf(e))) {
    const key = `${e.t}:${actorOf(e)}`;
    const recent = [...(seen.get(key) ?? []).filter((t) => turn - t <= FLAP_TURNS), turn];
    seen.set(key, recent);
    if (recent.length > FLAP_COUNT) flaps.add(`${key} x${recent.length} by turn ${turn}`);
  }
  return [...flaps];
}

// Trucks per faction and their mean money at the first, middle and last snapshot.
function printPopulation(lines) {
  const snaps = lines.filter((l) => l.trucks);
  if (snaps.length === 0) return;
  for (const snap of [snaps[0], snaps[Math.floor(snaps.length / 2)], snaps[snaps.length - 1]]) {
    const by = new Map();
    for (const v of snap.trucks) by.set(v.faction, [...(by.get(v.faction) ?? []), v]);
    const text = [...by.entries()].map(([f, vs]) => `${f} ${vs.length} ($${Math.round(vs.reduce((s, v) => s + v.money, 0) / vs.length)}, hp ${Math.round(vs.reduce((s, v) => s + v.hp, 0) / vs.length)})`).join(', ');
    console.log(`turn ${snap.t}: ${text}`);
  }
}

// Moving raiders in the snapshots: the share on a road of those that keep off roads, by top goal, against the share of
// healthy raiders. A stranded raider shows as stranded whatever its goal.
function printOffRoad(lines) {
  const moving = lines.flatMap((l) => l.trucks ?? []).filter((v) => v.faction === 'raiders' && v.speed > 0);
  if (moving.length === 0) return;
  const share = (vs) => `${vs.filter((v) => v.onRoad).length}/${vs.length} on road`;
  const by = Map.groupBy(moving.filter((v) => v.offRoad), offRoadReason);
  const off = [...by.entries()].map(([why, vs]) => `${why} ${share(vs)}`).join(', ') || 'none';
  console.log(`raiders keeping off roads: ${off}; healthy raiders ${share(moving.filter((v) => !v.offRoad))}`);
}

function offRoadReason(v) {
  const top = v.goals.at(-1)?.split(':')[0];
  return top === 'retreat' || top === 'flee' ? top : 'stranded';
}

// Every truck lost or knocked out, with the turn and who did it.
function printNpcDeaths(lines) {
  const lost = lines.flatMap((l) => (l.events ?? []).filter((e) => e.t === 'destroyed' || e.t === 'npcKnockout').map((e) => `${l.t} ${e.t} ${e.vehicle}${e.by ? ` by ${e.by}` : ''}`));
  if (lost.length > 0) console.log(`lost trucks: ${lost.length}: ${lost.slice(0, 20).join('; ')}`);
}
