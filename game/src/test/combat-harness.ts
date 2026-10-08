// Combat harness: plays fights through the real turn pipeline and Rapier physics on flat open ground. Two sides fight,
// and each truck names its driver and its gear apart, so a run can hold the driver and vary the gear to tune gear, or
// hold the gear and vary the driver to tune behavior. It measures hit rates, damage and outcomes, so a balance change

import { CHASSIS } from '../data/chassis';
import { DECISIONS, GEAR_LEVEL_IDS, NPC_BEHAVIOR, NPCS, TRAITS, type GearLevel } from '../data/npcs';
import { PARTS } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { START_KITS } from '../data/start';
import { TERRAIN } from '../data/terrain';
import { PERF } from '../data/perf';
import { buildDrive, freeDrive, type Drive } from '../phys/drive';
import { physicsMove } from '../phys/turn';
import { isHostile } from '../sim/combat';
import { isDefeated } from '../sim/defeat';
import { makePart } from '../sim/factory';
import { mountPart } from '../sim/inventory';
import { hangUp } from '../sim/dialogue';
import { isMounted, mountedParts } from '../sim/grid';
import { maxHp } from '../sim/wear';
import { generateNpcLoadout, type NpcLoadout } from '../sim/npc-loadout';
import { topGoal } from '../sim/npc-activities';
import { spawnAt } from '../sim/spawn';
import { addState, endState, stateOf } from '../sim/states';
import { vehicleStats } from '../sim/stats';
import type { Obstacle, Vehicle, World } from '../sim/types';
import { bearing, dist, type Vec } from '../sim/vec';
import { refreshVision } from '../sim/vision';
import { cloneWorld, endTurn, newWorld, seedStreams, setAutoFire, setMoveOrder } from '../sim/world';
import { TEST_MAP } from './map';
import { defaultSetup } from '../sim/settings';

export type Policy = 'stand' | 'orbit' | 'charge' | 'kite';
export const POLICIES: Policy[] = ['stand', 'orbit', 'charge', 'kite'];

export type Outfit = { gun: string; armor: string | null; ram?: string };

export type Gear = { kind: 'kit'; id: string } | { kind: 'npc'; template: string; level: GearLevel | null } | { kind: 'outfit'; outfit: Outfit };

export type Truck = { driver: string; gear: Gear; label: string };

export type Fight = {
  a: Truck[];
  b: Truck[];
  seed: number;
  gap: number;
  orbit: number;
  maxTurns: number;
  arena: number | null;
};

export type Side = { rounds: number; hits: number; odds: number; damage: number; speed: number };
export type Outcome = 'won' | 'lost' | 'a fled' | 'b fled' | 'truce' | 'timeout';
const OUTCOMES: Outcome[] = ['won', 'lost', 'a fled', 'b fled', 'truce', 'timeout'];
export type FightReport = { fight: Fight; outcome: Outcome; turns: number; crashes: number; a: Side; b: Side; bHpLeft: number | null };

const CENTER: Vec = { x: TEST_MAP.terrain.size / 2, y: TEST_MAP.terrain.size / 2 };
const FLED_RANGE = 40;
const PARKED: Vec = { x: CENTER.x, y: CENTER.y + TERRAIN.vision.radius + PERF.liveMargin / 2 };
const LINE_SPACING = 3;
const ARENA_ROCK = 1;
const ARENA_STEP = 1.6;

export function parseTruck(spec: string): Truck {
  const [driver, gearText, extra] = spec.split(':');
  if (extra !== undefined) throw new Error(`A truck is driver:gear, got "${spec}"`);
  const scripted = (POLICIES as string[]).includes(driver);
  if (!scripted && !NPCS[driver]) throw new Error(`Unknown driver "${driver}". Drivers are NPC templates or ${POLICIES.join(', ')}`);
  const gear = gearText === undefined ? defaultGear(driver, scripted) : parseGear(gearText);
  return { driver, gear, label: spec };
}

export function parseLineup(text: string): Truck[] {
  return text.split('+').map(parseTruck);
}

function defaultGear(driver: string, scripted: boolean): Gear {
  return scripted ? { kind: 'kit', id: 'standard' } : { kind: 'npc', template: driver, level: null };
}

function parseGear(text: string): Gear {
  if (text.includes('/')) return { kind: 'outfit', outfit: parseOutfit(text) };
  const [template, level] = text.split('@');
  if (START_KITS[template] && NPCS[template]) throw new Error(`Gear "${template}" names both a start kit and an NPC template`);
  if (START_KITS[template] && level === undefined) return { kind: 'kit', id: template };
  if (!NPCS[template]) throw new Error(`Unknown gear "${text}". Gear is a start kit, an NPC template or gun/armor`);
  if (level !== undefined && !(GEAR_LEVEL_IDS as string[]).includes(level)) throw new Error(`Unknown gear level "${level}". Known: ${GEAR_LEVEL_IDS.join(', ')}`);
  return { kind: 'npc', template, level: (level as GearLevel | undefined) ?? null };
}

function parseOutfit(text: string): Outfit {
  const [gun, rest] = text.split('/');
  const [armor, ram] = rest.split('+');
  return { gun, armor: armor === 'bare' ? null : armor, ...(ram ? { ram } : {}) };
}

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

function baseWorld(kit: string, arena: number | null): World {
  const key = `${kit}|${arena}`;
  const cached = BASES.get(key);
  if (cached) return cached;
  const w = newWorld(0, START_KITS[kit] ?? missing('kit', kit), TEST_MAP, defaultSetup('roaming'), false);
  const terrain = { size: w.size, heights: new Array((w.size + 1) * (w.size + 1)).fill(0), types: new Array(w.size * w.size).fill('road') };
  Object.freeze(terrain.heights);
  Object.freeze(terrain.types);
  w.terrain = Object.freeze(terrain);
  w.obstacles = arena === null ? [] : arenaRing(arena);
  w.states = [];
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  const me = w.vehicles[0];
  me.pos = { ...CENTER };
  me.heading = 0;
  me.speed = 0;
  BASES.set(key, w);
  return w;
}

function arenaRing(radius: number): Obstacle[] {
  const count = Math.ceil((2 * Math.PI * radius) / ARENA_STEP);
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return { id: `arena${i}`, pos: { x: CENTER.x + Math.cos(a) * radius, y: CENTER.y + Math.sin(a) * radius }, r: ARENA_ROCK, kind: 'rock' };
  });
}

function missing(what: string, id: string): never {
  throw new Error(`Unknown ${what} "${id}"`);
}

function isScripted(t: Truck): boolean {
  return (POLICIES as string[]).includes(t.driver);
}

function scriptedTruck(fight: Fight): Truck | null {
  if (fight.b.some(isScripted) || (fight.a.length > 1 && fight.a.some(isScripted))) throw new Error('A scripted driver drives the player truck, alone on side a');
  return isScripted(fight.a[0]) ? fight.a[0] : null;
}

function baseKit(t: Truck | null): string {
  if (!t) return 'standard';
  if (t.gear.kind === 'npc') throw new Error(`A scripted driver takes a kit or an outfit, not NPC gear: "${t.label}"`);
  return t.gear.kind === 'kit' ? t.gear.id : 'combat';
}

type Ids = { a: string[]; b: string[] };

function setup(fight: Fight): { w: World; ids: Ids } {
  if (fight.arena !== null && fight.arena <= fight.gap / 2 + LINE_SPACING) throw new Error(`An arena of ${fight.arena} tiles leaves no room for a gap of ${fight.gap}`);
  if (fight.arena !== null && 2 * fight.arena > TERRAIN.vision.radius) throw new Error(`An arena of ${fight.arena} tiles is wider than sight, ${TERRAIN.vision.radius} tiles across`);
  const scripted = scriptedTruck(fight);
  const w = Object.assign(cloneWorld(baseWorld(baseKit(scripted), fight.arena)), seedStreams(fight.seed));
  const player = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  if (scripted?.gear.kind === 'outfit') outfit(w, player, scripted.gear.outfit);
  if (scripted) player.pos = { x: CENTER.x - fight.gap / 2, y: CENTER.y };
  else park(player);
  const npcA = scripted ? [] : fight.a;
  const ids: Ids = { a: scripted ? [player.id] : [], b: [] };
  ids.a.push(...placeSide(w, npcA, CENTER.x - fight.gap / 2, 0));
  ids.b.push(...placeSide(w, fight.b, CENTER.x + fight.gap / 2, Math.PI));
  for (const a of ids.a) for (const b of ids.b) setAgainst(w, a, b);
  refreshVision(w);
  return { w: setAutoFire(w, true), ids };
}

function park(player: Vehicle): void {
  player.pos = { ...PARKED };
  player.items = player.items.filter((it) => it.kind === 'part' && isMounted(player.chassisId, it));
}

function placeSide(w: World, trucks: Truck[], x: number, heading: number): string[] {
  return trucks.map((t, i) => {
    const pos = { x, y: CENTER.y + (i - (trucks.length - 1) / 2) * LINE_SPACING };
    const v = spawnAt(w, NPCS[t.driver], loadoutOf(w, t.gear), pos);
    if (t.gear.kind === 'outfit') outfit(w, v, t.gear.outfit);
    v.heading = heading;
    v.brain!.traits = v.brain!.traits.filter((trait) => trait !== 'coward');
    return v.id;
  });
}

function loadoutOf(w: World, gear: Gear): NpcLoadout {
  if (gear.kind === 'outfit') return BARE_HAULER;
  if (gear.kind === 'npc') return generateNpcLoadout(w, NPCS[gear.template], null, gear.level);
  const kit = START_KITS[gear.id];
  return { chassisId: kit.chassis, level: 'standard', parts: kit.parts.map((defId) => ({ defId, wear: 0 })), spares: [], cargo: {} };
}

function setAgainst(w: World, aId: string, bId: string): void {
  for (const [holder, other] of [[aId, bId], [bId, aId]]) {
    const v = w.vehicles.find((x) => x.id === holder)!;
    if (!v.brain) continue;
    addState(w, 'feud', holder, other, { kind: 'feud', robbery: false });
    v.brain.attackers[other] = true;
    v.lastHitBy = other;
  }
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

const KITE_HOLD = 0.8;

function orders(w: World, policy: Policy, orbit: number, foe: Vehicle): World {
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  if (policy === 'stand') return setMoveOrder(w, { kind: 'brake' });
  if (policy === 'charge') {
    if (dist(me.pos, foe.pos) <= orbit) return setMoveOrder(w, { kind: 'brake' });
    return setMoveOrder(w, { kind: 'through', dest: foe.pos });
  }
  if (policy === 'kite') return kite(w, me, foe);
  return circle(w, me, foe, orbit);
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
  const trucks = w.vehicles.filter((v) => v.id !== w.player.vehicleId || dist(v.pos, PARKED) > 1).map((v) =>
    `${v.id} ${v.pos.x.toFixed(1)},${v.pos.y.toFixed(1)} v${v.speed.toFixed(1)} ${v.brain?.goals.at(-1)?.kind ?? v.order?.kind ?? '-'}${isDefeated(v) ? ' OUT' : ''}`);
  const shots = w.events.flatMap((e) => (e.t === 'shot' ? [`${e.shooter}:${e.rounds.filter((r) => r.hit).length}/${e.rounds.length}@${Math.round(e.chance * 100)}%`] : []));
  return `t${turn} ${trucks.join(' | ')} | ${shots.join(' ')}`;
}

const partHp = (v: Vehicle) => mountedParts(v).reduce((sum, p) => sum + p.hp, 0);
const side = (): Side => ({ rounds: 0, hits: 0, odds: 0, damage: 0, speed: 0 });

type Count = { ids: Ids; a: Side; b: Side; crashes: number; leaver: 'a' | 'b' | null };

function inFight(w: World, ids: string[]): Vehicle[] {
  return w.vehicles.filter((v) => ids.includes(v.id) && !isDefeated(v) && (v.id !== w.player.vehicleId || w.player.state === 'active'));
}

function nearest(from: Vehicle, foes: Vehicle[]): Vehicle {
  return foes.reduce((a, b) => (dist(b.pos, from.pos) < dist(a.pos, from.pos) ? b : a));
}

function sideOf(c: Count, id: string): Side | null {
  if (c.ids.a.includes(id)) return c.a;
  return c.ids.b.includes(id) ? c.b : null;
}

function countShots(w: World, c: Count): void {
  for (const ev of w.events) {
    const s = ev.t === 'shot' ? sideOf(c, ev.shooter) : null;
    if (ev.t !== 'shot' || !s) continue;
    s.rounds += ev.rounds.length;
    s.hits += ev.rounds.filter((r) => r.hit).length;
    s.odds += ev.chance * ev.rounds.length;
  }
}

function meanSpeed(trucks: Vehicle[]): number {
  return trucks.length > 0 ? trucks.reduce((sum, v) => sum + Math.abs(v.speed), 0) / trucks.length : 0;
}

function countMoves(w: World, c: Count): void {
  c.a.speed += meanSpeed(inFight(w, c.ids.a));
  c.b.speed += meanSpeed(inFight(w, c.ids.b));
  const across = (x: string, y: string) => (c.ids.a.includes(x) && c.ids.b.includes(y)) || (c.ids.b.includes(x) && c.ids.a.includes(y));
  c.crashes += w.events.filter((e) => e.t === 'collision' && across(e.a, e.b)).length;
}

function countDamage(w: World, c: Count, before: Map<string, number>): void {
  for (const v of w.vehicles) {
    const lost = Math.max(0, (before.get(v.id) ?? 0) - partHp(v));
    if (c.ids.a.includes(v.id)) c.b.damage += lost;
    else if (c.ids.b.includes(v.id)) c.a.damage += lost;
  }
}

function outcomeOf(w: World, c: Count): Outcome | null {
  const a = inFight(w, c.ids.a);
  const b = inFight(w, c.ids.b);
  if (a.length === 0) return 'lost';
  if (b.length === 0) return 'won';
  if (!a.some((x) => b.some((y) => isHostile(w, x, y) || isHostile(w, y, x)))) return 'truce';
  if (b.every((v) => dist(v.pos, nearest(v, a).pos) > FLED_RANGE)) return fledSide(a, b, c.leaver);
  return null;
}

function staysInFight(v: Vehicle): boolean {
  return !v.brain || topGoal(v)?.kind === 'fight';
}

function noteLeaver(w: World, c: Count): void {
  const aStays = inFight(w, c.ids.a).some(staysInFight);
  const bStays = inFight(w, c.ids.b).some(staysInFight);
  if (aStays !== bStays) c.leaver = aStays ? 'b' : 'a';
}

function fledSide(a: Vehicle[], b: Vehicle[], leaver: 'a' | 'b' | null): Outcome {
  if (leaver) return `${leaver} fled`;
  const away = (side: Vehicle[]) => Math.max(...side.map((v) => dist(v.pos, CENTER)));
  return away(a) > away(b) ? 'a fled' : 'b fled';
}

function playTurn(w: World, d: Drive, c: Count, arena: boolean): { w: World; d: Drive } {
  const before = new Map(w.vehicles.map((v) => [v.id, partHp(v)]));
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  if (arena) keepArenaFight(w, c.ids);
  countShots(w, c);
  countDamage(w, c, before);
  countMoves(w, c);
  noteLeaver(w, c);
  return { w, d: next! };
}

function keepArenaFight(w: World, ids: Ids): void {
  const a = inFight(w, ids.a);
  const b = inFight(w, ids.b);
  for (const x of a) for (const y of b) {
    if (isHostile(w, x, y) || isHostile(w, y, x)) continue;
    for (const [holder, other] of [[x, y], [y, x]]) {
      const truce = stateOf(w, 'truce', holder.id, other.id);
      if (truce) endState(w, truce, 'broken');
    }
    setAgainst(w, x.id, y.id);
  }
}

function steer(w: World, fight: Fight, c: Count): World {
  const policy = scriptedTruck(fight)?.driver as Policy | undefined;
  if (!policy) return w;
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  return orders(w, policy, fight.orbit, nearest(me, inFight(w, c.ids.b)));
}

export function runFight(fight: Fight, watch?: (w: World, turn: number) => void): FightReport {
  const start = setup(fight);
  let w = start.w;
  const c: Count = { ids: start.ids, a: side(), b: side(), crashes: 0, leaver: null };
  let d = buildDrive(w);
  let outcome: Outcome | null = null;
  let turns = 0;
  while (outcome === null && turns < fight.maxTurns) {
    if (w.player.call) w = hangUp(w);
    w = steer(w, fight, c);
    ({ w, d } = playTurn(w, d, c, fight.arena !== null));
    turns++;
    watch?.(w, turns);
    outcome = outcomeOf(w, c);
  }
  freeDrive(d);
  return { fight, outcome: outcome ?? 'timeout', turns, crashes: c.crashes, a: c.a, b: c.b, bHpLeft: outcome === 'won' ? hpLeft(w, c.ids.b) : null };
}

function hpLeft(w: World, ids: string[]): number {
  const parts = [...w.vehicles, ...w.removed].filter((v) => ids.includes(v.id)).flatMap((v) => mountedParts(v));
  return parts.reduce((a, p) => a + p.hp, 0) / parts.reduce((a, p) => a + maxHp(p), 0);
}

export type Group = { a: string; b: string; reports: FightReport[] };

const lineupLabel = (trucks: Truck[]) => trucks.map((t) => t.label).join('+');

export function groups(reports: FightReport[]): Group[] {
  const out = new Map<string, Group>();
  for (const r of reports) {
    const g = { a: lineupLabel(r.fight.a), b: lineupLabel(r.fight.b) };
    const key = `${g.a}|${g.b}`;
    if (!out.has(key)) out.set(key, { ...g, reports: [] });
    out.get(key)!.reports.push(r);
  }
  return [...out.values()];
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '-');

export function formatReport(reports: FightReport[], sets: string[]): string {
  const lines = [
    `# Combat harness`,
    '',
    `${reports.length} fights. Changed numbers: ${sets.length ? sets.join(', ') : 'none'}.`,
    'A truck is driver:gear. Won means every side b truck is out, lost every side a truck. A fled and b fled name the side that left the fight. Truce means no truck is hostile to the other side any more. Speed is tiles per turn. Hit is rounds that hit. Odds is the mean hit chance shown for those rounds. Damage is part HP the side takes off the other per turn. Crashes are per fight. B hp left is the mean share of max part HP the side b trucks keep in won fights.',
    '',
    '| a | b | won | lost | a fled | b fled | truce | timeout | turns | crashes | a speed | a hit | a odds | a dmg/turn | b speed | b hit | b odds | b dmg/turn | b hp left |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
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
  const cells = [g.a, g.b, ...OUTCOMES.map(count), (turns / rs.length).toFixed(1), (sum((r) => r.crashes) / rs.length).toFixed(1), ...sideCells((r) => r.a), ...sideCells((r) => r.b), hpLeftCell(rs)];
  return `| ${cells.join(' | ')} |`;
}

function hpLeftCell(rs: FightReport[]): string {
  const shares = rs.flatMap((r) => (r.bHpLeft === null ? [] : [r.bHpLeft]));
  return shares.length > 0 ? pct(shares.reduce((a, b) => a + b, 0), shares.length) : '-';
}
