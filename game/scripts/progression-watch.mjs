// Plays one recorder run and prints the player truck turn by turn from --from to --to: money, net worth, fuel,
// supplies, goods, free cells, contracts, order, mounted part HP and the events that touch the player. A line prints only when something
// in it changed or an event happened. It writes no trace.
// Usage: npm run progression:watch -- --archetype trader --seed 1 --to 5000 [--from 4500] [--markov-turns <k>]
import { playerVehicle } from '../src/sim/damage.ts';
import { freeCells, goodsCount, mountedParts } from '../src/sim/grid.ts';
import { isArchetype } from '../src/sim/progression/bot.ts';
import { netWorth, recordTurns } from '../src/sim/progression/record.ts';
import { maxHp } from '../src/sim/wear.ts';
import { moneyText } from '../src/ui/units.ts';

const USAGE = 'Usage: npm run progression:watch -- --archetype <a> --seed <n> --to <turn> [--from <turn>] [--markov-turns <k>]';

// Events with no vehicle field are the player's own.
const OWN = new Set(['money', 'contract', 'death', 'knockout', 'wake', 'skillUp', 'supply', 'townPatch', 'scrapPatch', 'searched', 'discover']);
const QUIET = new Set(['practice', 'activity', 'arrived', 'spawn', 'despawn', 'info', 'weather']);

const flags = readFlags(process.argv.slice(2).filter((a) => a !== '--'));
if (!isArchetype(flags.archetype ?? '')) throw new Error(`Unknown archetype ${flags.archetype}. ${USAGE}`);
const seed = wholeNumber(flags.seed, 'seed');
const to = wholeNumber(flags.to, 'to');
const from = flags.from === undefined ? 1 : wholeNumber(flags.from, 'from');
const options = { tolerateStalls: true, ...(flags['markov-turns'] === undefined ? {} : { markovTurns: wholeNumber(flags['markov-turns'], 'markov-turns') }) };

let last = '';
for (const step of recordTurns(seed, flags.archetype, to, options)) {
  const w = step.world;
  if (w.turn < from) continue;
  const v = playerVehicle(w);
  const events = w.events.filter((e) => touchesPlayer(e, v.id)).map((e) => describe(w, e));
  const contracts = w.player.contracts.map((c) => `${c.kind}:${c.good ?? ''}${c.units}>${c.to}`).join(',') || '-';
  const hp = mountedParts(v).map((p) => Math.round((100 * p.hp) / maxHp(p))).join('/');
  const state = `${moneyText(w.player.money)} nw ${moneyText(netWorth(w))} fuel ${Math.round(w.player.fuel)} sup ${Math.round(w.player.supplies)} ${v.chassisId} goods ${JSON.stringify(goodsCount(v))} free ${freeCells(v)} contracts ${contracts} order ${v.order?.kind ?? '-'} hp ${hp}`;
  if (state !== last || events.length > 0) console.log(`${w.turn} at ${Math.round(v.pos.x)},${Math.round(v.pos.y)} ${state}${events.length ? `  | ${events.join('; ')}` : ''}`);
  last = state;
}

function touchesPlayer(e, me) {
  if (QUIET.has(e.t)) return false;
  if (OWN.has(e.t)) return true;
  return JSON.stringify(e).includes(`"${me}"`);
}

// A truck id with its driver template and chassis, such as v76:raider-gunwagon/gunwagon.
function truck(w, id) {
  const v = w.vehicles.find((x) => x.id === id);
  return v ? `${id}:${v.brain?.templateId ?? 'player'}/${v.chassisId}` : id;
}

function describe(w, e) {
  if (e.t === 'say') return `say ${e.speaker}: ${e.text}`;
  if (e.t === 'shot') return `shot ${truck(w, e.shooter)}>${truck(w, e.target)} ${e.weapon} hits ${e.rounds.filter((r) => r.hit).length}/${e.rounds.length}`;
  if (e.t === 'money') return `money ${moneyText(e.amount)} ${e.reason}`;
  if (e.t === 'contract') return `contract ${e.outcome} ${e.contract.kind}`;
  const { t, ...rest } = e;
  return `${t} ${JSON.stringify(rest)}`;
}

function readFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`Bad argument ${argv[i]}. ${USAGE}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function wholeNumber(text, name) {
  const n = Number(text);
  if (text === undefined || !Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive whole number. ${USAGE}`);
  return n;
}
