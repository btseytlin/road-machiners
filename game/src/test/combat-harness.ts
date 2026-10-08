// Combat harness: plays fights through the real turn pipeline and Rapier physics on flat open ground. The player
// truck follows a simple policy with auto fire, and the NPCs run their own brains. It measures hit rates, damage
// and outcomes, so a balance change can be judged before it ships. The game never imports this module.

import { CHASSIS } from '../data/chassis';
import { DECISIONS, NPC_BEHAVIOR, NPCS, TRAITS, type GearLevel } from '../data/npcs';
import { PARTS } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { START_KITS } from '../data/start';
import { buildDrive, freeDrive, type Drive } from '../phys/drive';
import { physicsMove } from '../phys/turn';
import { isDefeated } from '../sim/defeat';
import { makePart } from '../sim/factory';
import { mountPart } from '../sim/inventory';
import { hangUp } from '../sim/dialogue';
import { mountedParts } from '../sim/grid';
import { generateNpcLoadout, type NpcLoadout } from '../sim/npc-loadout';
import { spawnAt } from '../sim/spawn';
import { vehicleStats } from '../sim/stats';
import type { Vehicle, World } from '../sim/types';
import { bearing, dist, type Vec } from '../sim/vec';
import { refreshVision } from '../sim/vision';
import { cloneWorld, endTurn, newWorld, seedStreams, setAutoFire, setMoveOrder } from '../sim/world';
import { TEST_MAP } from './map';

export type Policy = 'stand' | 'orbit' | 'charge' | 'kite';
export const POLICIES: Policy[] = ['stand', 'orbit', 'charge', 'kite'];

export type Fight = {
  kit: string;
  me: Outfit | null;
  enemies: string[];
  level: GearLevel | null;
  foe: Outfit | null;
  policy: Policy;
  seed: number;
  gap: number;
  orbit: number;
  maxTurns: number;
};

export type Outfit = { gun: string; armor: string | null; ram?: string };

export type Side = { rounds: number; hits: number; odds: number; damage: number; speed: number };
export type Outcome = 'won' | 'lost' | 'fled' | 'timeout';
export type FightReport = { fight: Fight; outcome: Outcome; turns: number; crashes: number; me: Side; them: Side };

const CENTER: Vec = { x: TEST_MAP.terrain.size / 2, y: TEST_MAP.terrain.size / 2 };
const FLED_RANGE = 40;

const TABLES: Record<string, object> = { RULES, PHYSICS, NPCS, PARTS, CHASSIS, TRAITS, DECISIONS, NPC_BEHAVIOR, SKILL_EFFECTS };

export function setNumber(assignment: string): void {
  const [path, raw] = assignment.split('=');
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value)) throw new Error(`--set needs path=number, got "${assignment}"`);
  const keys = path.split('.');
  const last = keys.pop()!;
  const owner = keys.slice(1).reduce((obj, key) => subTable(obj, key, path), rootTable(keys[0]));
  if (typeof owner[last] !== 'number') throw new Error(`${path} is not a number`);
  owner[last] = value;
  BASES.clear();
}

type Table = Record<string, unknown>;

function rootTable(name: string): Table {
  const table = TABLES[name];
  if (!table) throw new Error(`Unknown table "${name}". Known: ${Object.keys(TABLES).join(', ')}`);
  return table as Table;
}

function subTable(obj: Table, key: string, path: string): Table {
  const sub = obj[key];
  if (typeof sub !== 'object' || sub === null) throw new Error(`${path}: "${key}" is not a table`);
  return sub as Table;
}

const BASES = new Map<string, World>();

function baseWorld(kit: string): World {
  const cached = BASES.get(kit);
  if (cached) return cached;
  const w = newWorld(0, START_KITS[kit] ?? missing('kit', kit), TEST_MAP, false);
  const terrain = { size: w.size, heights: new Array((w.size + 1) * (w.size + 1)).fill(0), types: new Array(w.size * w.size).fill('road') };
  Object.freeze(terrain.heights);
  Object.freeze(terrain.types);
  w.terrain = Object.freeze(terrain);
  w.obstacles = [];
  w.states = [];
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  const me = w.vehicles[0];
  me.pos = { ...CENTER };
  me.heading = 0;
  me.speed = 0;
  BASES.set(kit, w);
  return w;
}

function openWorld(fight: Fight): World {
  return Object.assign(cloneWorld(baseWorld(fight.kit)), seedStreams(fight.seed));
}

function missing(what: string, id: string): never {
  throw new Error(`Unknown ${what} "${id}"`);
}

function setup(fight: Fight): World {
  const w = openWorld(fight);
  if (fight.me) outfit(w, w.vehicles.find((v) => v.id === w.player.vehicleId)!, fight.me);
  fight.enemies.forEach((id, i) => {
    const tpl = NPCS[id] ?? missing('NPC template', id);
    const pos = { x: CENTER.x + fight.gap, y: CENTER.y + (i - (fight.enemies.length - 1) / 2) * 3 };
    const e = spawnAt(w, tpl, fight.foe ? BARE_HAULER : generateNpcLoadout(w, tpl, null, fight.level), pos);
    if (fight.foe) outfitFoe(w, e, fight.foe);
    e.heading = Math.PI;
    e.brain!.traits = e.brain!.traits.filter((t) => t !== 'coward');
    e.brain!.attackers[w.player.vehicleId] = true;
    e.lastHitBy = w.player.vehicleId;
  });
  refreshVision(w);
  return setAutoFire(w, true);
}

function outfit(w: World, v: Vehicle, o: Outfit): void {
  if (PARTS[o.gun]?.kind !== 'weapon') throw new Error(`Unknown weapon "${o.gun}"`);
  if (o.armor !== null && PARTS[o.armor]?.kind !== 'armor') throw new Error(`Unknown armor "${o.armor}"`);
  if (v.chassisId !== 'hauler') throw new Error(`Outfits go on a hauler, not a ${v.chassisId}`);
  v.items = v.items.filter((it) => it.kind === 'part' && PARTS[it.part.defId].kind === 'core');
  for (const id of ['stockEngine', o.gun]) if (!mountPart(w, v, makePart(w, id, 0))) throw new Error(`${id} does not fit the hauler`);
  if (o.ram && !mountPart(w, v, makePart(w, o.ram, 0))) throw new Error(`${o.ram} does not fit the hauler`);
  if (o.armor) while (mountPart(w, v, makePart(w, o.armor, 0)));
}

const BARE_HAULER: NpcLoadout = { chassisId: 'hauler', level: 'standard', parts: [], spares: [], cargo: {} };

function outfitFoe(w: World, e: Vehicle, o: Outfit): void {
  outfit(w, e, o);
}

const KITE_HOLD = 0.8;

function orders(w: World, fight: Fight, foe: Vehicle): World {
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  if (fight.policy === 'stand') return setMoveOrder(w, { kind: 'brake' });
  if (fight.policy === 'charge') {
    if (dist(me.pos, foe.pos) <= fight.orbit) return setMoveOrder(w, { kind: 'brake' });
    return setMoveOrder(w, { kind: 'through', dest: foe.pos });
  }
  if (fight.policy === 'kite') return kite(w, me, foe);
  return circle(w, me, foe, fight.orbit);
}

function circle(w: World, me: Vehicle, foe: Vehicle, radius: number): World {
  const a = bearing(foe.pos, me.pos) + Math.PI / 2;
  return setMoveOrder(w, { kind: 'through', dest: { x: foe.pos.x + Math.cos(a) * radius, y: foe.pos.y + Math.sin(a) * radius } });
}

function kite(w: World, me: Vehicle, foe: Vehicle): World {
  const reach = Math.max(...vehicleStats(w, me).weapons.map((mw) => mw.def.range));
  const d = dist(me.pos, foe.pos);
  if (d > KITE_HOLD * reach) return setMoveOrder(w, { kind: 'through', dest: foe.pos });
  const away = bearing(foe.pos, me.pos);
  const back = RULES.throttleZones.reach * KITE_HOLD;
  return setMoveOrder(w, { kind: 'through', dest: { x: me.pos.x + Math.cos(away) * back, y: me.pos.y + Math.sin(away) * back } });
}

export function turnLine(w: World, turn: number): string {
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  const foes = w.vehicles.filter((v) => v.id !== me.id).map((v) =>
    `${v.id} d${dist(v.pos, me.pos).toFixed(1)} v${v.speed.toFixed(1)} ${v.brain?.goals.at(-1)?.kind ?? '-'}${isDefeated(v) ? ' OUT' : ''}`);
  const shots = w.events.flatMap((e) => (e.t === 'shot' ? [`${e.shooter}:${e.rounds.filter((r) => r.hit).length}/${e.rounds.length}@${Math.round(e.chance * 100)}%`] : []));
  return `t${turn} me ${me.pos.x.toFixed(1)},${me.pos.y.toFixed(1)} v${me.speed.toFixed(1)} ${me.order?.kind ?? "-"} | ${foes.join(' | ')} | ${shots.join(' ')}`;
}

const partHp = (v: Vehicle) => mountedParts(v).reduce((sum, p) => sum + p.hp, 0);
const side = (): Side => ({ rounds: 0, hits: 0, odds: 0, damage: 0, speed: 0 });

type Count = { meId: string; enemyIds: Set<string>; me: Side; them: Side; crashes: number };

function nearestFoe(w: World, c: Count): Vehicle {
  const me = w.vehicles.find((v) => v.id === c.meId)!;
  const foes = w.vehicles.filter((v) => c.enemyIds.has(v.id) && !isDefeated(v));
  return foes.reduce((a, b) => (dist(b.pos, me.pos) < dist(a.pos, me.pos) ? b : a));
}

function countShots(w: World, c: Count): void {
  for (const ev of w.events) {
    if (ev.t !== 'shot') continue;
    const s = ev.shooter === c.meId ? c.me : c.them;
    if (ev.shooter !== c.meId && !c.enemyIds.has(ev.shooter)) continue;
    s.rounds += ev.rounds.length;
    s.hits += ev.rounds.filter((r) => r.hit).length;
    s.odds += ev.chance * ev.rounds.length;
  }
}

function countMoves(w: World, c: Count): void {
  c.me.speed += Math.abs(w.vehicles.find((v) => v.id === c.meId)!.speed);
  const awake = w.vehicles.filter((v) => c.enemyIds.has(v.id) && !isDefeated(v));
  if (awake.length > 0) c.them.speed += awake.reduce((sum, v) => sum + Math.abs(v.speed), 0) / awake.length;
  const fighters = (id: string) => id === c.meId || c.enemyIds.has(id);
  c.crashes += w.events.filter((e) => e.t === 'collision' && fighters(e.a) && fighters(e.b) && (e.a === c.meId || e.b === c.meId)).length;
}

function countDamage(w: World, c: Count, before: Map<string, number>): void {
  for (const v of w.vehicles) {
    const lost = Math.max(0, before.get(v.id)! - partHp(v));
    if (v.id === c.meId) c.them.damage += lost;
    else if (c.enemyIds.has(v.id)) c.me.damage += lost;
  }
}

function outcomeOf(w: World, c: Count): Outcome | null {
  if (w.player.state !== 'active') return 'lost';
  const left = w.vehicles.filter((v) => c.enemyIds.has(v.id) && !isDefeated(v));
  if (left.length === 0) return 'won';
  const me = w.vehicles.find((v) => v.id === c.meId)!;
  if (left.every((v) => dist(v.pos, me.pos) > FLED_RANGE)) return 'fled';
  return null;
}

function playTurn(w: World, d: Drive, c: Count): { w: World; d: Drive } {
  const before = new Map(w.vehicles.map((v) => [v.id, partHp(v)]));
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  countShots(w, c);
  countDamage(w, c, before);
  countMoves(w, c);
  return { w, d: next! };
}

export function runFight(fight: Fight, watch?: (w: World, turn: number) => void): FightReport {
  let w = setup(fight);
  const c: Count = { meId: w.player.vehicleId, enemyIds: new Set(w.vehicles.slice(1).map((v) => v.id)), me: side(), them: side(), crashes: 0 };
  let d = buildDrive(w);
  let outcome: Outcome | null = null;
  let turns = 0;
  while (outcome === null && turns < fight.maxTurns) {
    if (w.player.call) w = hangUp(w);
    w = orders(w, fight, nearestFoe(w, c));
    ({ w, d } = playTurn(w, d, c));
    turns++;
    watch?.(w, turns);
    outcome = outcomeOf(w, c);
  }
  freeDrive(d);
  return { fight, outcome: outcome ?? 'timeout', turns, crashes: c.crashes, me: c.me, them: c.them };
}

export type Group = { gun: string; enemies: string; level: string; policy: Policy; reports: FightReport[] };

export function groups(reports: FightReport[]): Group[] {
  const out = new Map<string, Group>();
  for (const r of reports) {
    const g = { gun: outfitName(r.fight.me) ?? 'kit', enemies: outfitName(r.fight.foe) ?? r.fight.enemies.join('+'), level: r.fight.level ?? 'rolled', policy: r.fight.policy };
    const key = `${g.gun}|${g.enemies}|${g.level}|${g.policy}`;
    if (!out.has(key)) out.set(key, { ...g, reports: [] });
    out.get(key)!.reports.push(r);
  }
  return [...out.values()];
}

function outfitName(o: Outfit | null): string | null {
  return o && `${o.gun}/${o.armor ?? 'bare'}${o.ram ? `+${o.ram}` : ''}`;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '-');

export function formatReport(reports: FightReport[], sets: string[]): string {
  const kit = reports[0]?.fight.kit;
  const lines = [
    `# Combat harness`,
    '',
    `Kit ${kit}. ${reports.length} fights. Changed numbers: ${sets.length ? sets.join(', ') : 'none'}.`,
    'Speed is tiles per turn. Hit is rounds that hit. Odds is the mean hit chance shown for those rounds. Damage is part HP lost per turn. Crashes are per fight.',
    '',
    '| gun | enemies | level | policy | won | lost | fled | timeout | turns | crashes | my speed | my hit | my odds | my dmg/turn | their speed | their hit | their odds | their dmg/turn |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const g of groups(reports)) lines.push(groupRow(g));
  return lines.join('\n') + '\n';
}

function groupRow(g: Group): string {
  const rs = g.reports;
  const sum = (f: (r: FightReport) => number) => rs.reduce((a, r) => a + f(r), 0);
  const count = (o: Outcome) => rs.filter((r) => r.outcome === o).length;
  const turns = sum((r) => r.turns);
  const sideCells = (pick: (r: FightReport) => Side) => {
    const rounds = sum((r) => pick(r).rounds);
    return [(sum((r) => pick(r).speed) / turns).toFixed(1), pct(sum((r) => pick(r).hits), rounds), pct(sum((r) => pick(r).odds), rounds), (sum((r) => pick(r).damage) / turns).toFixed(1)];
  };
  const cells = [g.gun, g.enemies, g.level, g.policy, ...(['won', 'lost', 'fled', 'timeout'] as Outcome[]).map(count), (turns / rs.length).toFixed(1), (sum((r) => r.crashes) / rs.length).toFixed(1), ...sideCells((r) => r.me), ...sideCells((r) => r.them)];
  return `| ${cells.join(' | ')} |`;
}
