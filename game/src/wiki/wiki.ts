// Game wiki pages in docs/wiki/. A page mixes prose with generated blocks between `<!-- wiki:<id> -->` and
// `<!-- /wiki:<id> -->`. fillPage() rewrites the blocks from code and leaves the prose alone. `npm run wiki` writes
// the pages and src/wiki/wiki.test.ts fails when a committed page differs from the fresh fill.
import { CHASSIS } from '../data/chassis';
import { DETECT } from '../data/detect';
import { GOODS, ECONOMY } from '../data/goods';
import { CONTRACTS, DISTANCE_PREMIUM, EFFORT, PRESSURE_MAX, PRICE_FACTOR, SHOPS } from '../data/market';
import { DECISIONS, GEAR_LEVELS, HUNT, MIN_CHANCE, NPCS, NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, STATE_TURNS, TRAITS } from '../data/npcs';
import type { WeightChange } from '../data/npcs';
import { CHASSIS_PRICE_MODIFIERS } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { PARTS, PART_PRICE_MODIFIERS } from '../data/parts';
import type { PartDef, PartKind } from '../data/parts';
import { BREAKABLE, RULES } from '../data/rules';
import { SALVAGE, STRIP } from '../data/salvage';
import { PERKS, PERK_NUMBERS, SKILL_EFFECTS, SKILL_INFO, XP_RULES, XP_SOURCES, RANK_COSTS } from '../data/skills';
import { SOUNDS } from '../data/sounds';
import { TIME } from '../data/time';
import { TOW } from '../data/tow';
import { UNITS } from '../data/units';
import { oilSlickLength } from '../data/utilities';
import { CONDITION, PATCH, REPAIR, WEAR } from '../data/wear';
import { baseModel, PART_MODELS, WEAPON_POOLS } from '../render/partLooks';
import { STATE_KINDS } from '../sim/states';
import { moneyAmount } from '../ui/units';

export type Cell = string | number | boolean | null | readonly unknown[] | object;
export type WikiTable = { id: string; headers: string[]; rows: () => Cell[][] };

const MECHANICS = ['character', 'truck', 'turns', 'defeat', 'detection', 'world', 'npcs', 'social', 'economy', 'content', 'world-settings'];

export const PAGES: readonly string[] = [
  'README.md', 'items.md', 'combat.md', 'economy.md', 'npcs.md', 'skills.md', 'assets.md',
  ...MECHANICS.map((name) => `mechanics/${name}.md`),
];

const NUMBERS_ID = 'numbers';
const BLOCK = /<!-- wiki:([\w-]+) -->\n?[\s\S]*?<!-- \/wiki:\1 -->/g;
const DATA_REF = /`([A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_]+)+)`/g;
const FILE_REF = /`(src\/[^`\s]+)`/g;

function cellText(cell: Cell): string {
  if (cell === null) return '';
  if (Array.isArray(cell)) return cell.map(cellText).join(', ');
  if (typeof cell === 'object') return JSON.stringify(cell);
  return String(cell).replaceAll('|', '\\|');
}

function row(cells: readonly Cell[]): string {
  return `| ${cells.map(cellText).join(' | ')} |`;
}

export function markdownTable(table: WikiTable): string {
  const lines = [row(table.headers), row(table.headers.map(() => '---')), ...table.rows().map(row)];
  return lines.join('\n');
}

function proseOf(text: string): string {
  return text.replace(BLOCK, '');
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

export function dataRefs(text: string): { data: string[]; files: string[] } {
  const prose = proseOf(text);
  const grab = (pattern: RegExp): string[] => unique([...prose.matchAll(pattern)].map((m) => m[1]));
  return { data: grab(DATA_REF), files: grab(FILE_REF) };
}

function step(value: unknown, key: string, path: string): unknown {
  const isObject = typeof value === 'object' && value !== null;
  if (!isObject || !Object.hasOwn(value, key)) throw new Error(`Wiki path ${path} does not resolve at ${key}`);
  return (value as Record<string, unknown>)[key];
}

export function resolveRef(roots: Record<string, unknown>, path: string): unknown {
  const [rootName, ...keys] = path.split('.');
  if (!Object.hasOwn(roots, rootName)) throw new Error(`Wiki root ${rootName} in ${path} is not registered`);
  return keys.reduce((value, key) => step(value, key, path), roots[rootName]);
}

export function numbersTable(roots: Record<string, unknown>, refs: string[]): string {
  const table: WikiTable = {
    id: NUMBERS_ID,
    headers: ['path', 'value'],
    rows: () => refs.map((ref) => [`\`${ref}\``, resolveRef(roots, ref) as Cell]),
  };
  return markdownTable(table);
}

function checkMarkers(name: string, text: string): string[] {
  const opens = [...text.matchAll(/<!-- wiki:([\w-]+) -->/g)].map((m) => m[1]);
  const closes = [...text.matchAll(/<!-- \/wiki:([\w-]+) -->/g)].map((m) => m[1]);
  const closed = [...text.matchAll(BLOCK)].map((m) => m[1]);
  const unclosed = opens.find((id) => !closed.includes(id));
  if (unclosed) throw new Error(`${name}: block ${unclosed} is not closed`);
  const unopened = closes.find((id) => !opens.includes(id));
  if (unopened) throw new Error(`${name}: block ${unopened} closes without opening`);
  const twice = closed.find((id, i) => closed.indexOf(id) !== i);
  if (twice) throw new Error(`${name}: block ${twice} appears twice`);
  return closed;
}

export function fillPage(name: string, text: string, tables: Record<string, WikiTable>, roots: Record<string, unknown>): string {
  for (const id of checkMarkers(name, text)) {
    if (id !== NUMBERS_ID && !Object.hasOwn(tables, id)) throw new Error(`${name}: block ${id} has no table`);
  }
  const refs = dataRefs(text).data;
  return text.replace(BLOCK, (_block, id: string) => {
    const body = id === NUMBERS_ID ? numbersTable(roots, refs) : markdownTable(tables[id]);
    return `<!-- wiki:${id} -->\n${body}\n<!-- /wiki:${id} -->`;
  });
}

const entries = <T>(record: Record<string, T>): [string, T][] => Object.entries(record);

const partsOf = <K extends PartKind>(kind: K): Extract<PartDef, { kind: K }>[] =>
  Object.values(PARTS).filter((p): p is Extract<PartDef, { kind: K }> => p.kind === kind);

const partTable = <K extends PartKind>(id: string, kind: K, headers: string[], stats: (p: Extract<PartDef, { kind: K }>) => Cell[]): WikiTable => ({
  id,
  headers: ['id', 'name', 'tier', 'value (M)', 'cells (w x h)', 'mass (kg)', 'hp', 'armor', 'tall', ...headers],
  rows: () => partsOf(kind).map((p) => [p.id, p.name, p.tier, moneyAmount(p.value), `${p.w} x ${p.h}`, p.mass, p.hp, p.armor, p.tall, ...stats(p)]),
});

const change = (option: string, c: WeightChange): string => {
  const add = c.add === undefined ? '' : `+${c.add}`;
  const mul = c.mul === undefined ? '' : `x${c.mul}`;
  return `${option} ${add} ${mul}`.trim();
};

type ChangeMap = Record<string, Record<string, WeightChange> | undefined>;

const traitChanges = (weights: ChangeMap): string[] =>
  Object.entries(weights).flatMap(([decision, options]) =>
    Object.entries(options ?? {}).map(([option, c]) => `${decision}.${change(option, c)}`));

const stateKindRows = (): Cell[][] => entries(STATE_KINDS).map(([kind, def]) => [kind, STATE_TURNS[kind as keyof typeof STATE_TURNS], def.binds]);

const TABLES: WikiTable[] = [
  {
    id: 'chassis',
    headers: ['id', 'name', 'tier', 'value (M)', 'max speed (tiles/turn)', 'accel', 'brake', 'mass (kg)', 'rated mass (kg)', 'radius (tiles)', 'fuel cap', 'fuel per tile', 'grid (w x h)', 'core parts'],
    rows: () => Object.values(CHASSIS).map((c) => [
      c.id, c.name, c.tier, moneyAmount(c.value), c.maxSpeed, c.accel, c.brake, c.mass, c.ratedMass, c.radius, c.fuelCap, c.fuelPerTile,
      `${Math.max(...c.layout.map((r) => r.length))} x ${c.layout.length}`,
      c.core.map((k) => k.defId),
    ]),
  },
  partTable('weapons', 'weapon', ['range (tiles)', 'cooldown (turns)', 'magazine (shots)', 'reload (turns)', 'arc (deg)', 'spread (deg)', 'rounds per shot', 'recoil (deg)', 'shake', 'line (turns)'], (p) => [p.range, p.cooldown, p.magazine, p.reload, p.arc, p.spread, p.rounds, p.recoil, p.shake, p.line?.turns ?? null]),
  {
    id: 'weapon-rounds',
    headers: ['id', 'damage', 'pen', 'blast', 'speed (m/s)', 'splash radius (m)', 'splash damage', 'splash pen'],
    rows: () => partsOf('weapon').map((p) => [p.id, p.round.damage, p.round.pen, p.round.blast, p.round.speed, p.round.splashRadius, p.round.splashDamage, p.round.splashPen]),
  },
  partTable('engines', 'engine', ['speed bonus', 'accel bonus', 'fuel mult', 'noise', 'heat'], (p) => [p.speedBonus, p.accelBonus, p.fuelMult, p.noise, p.heat]),
  partTable('armor', 'armor', ['blast armor', 'field repair', 'ram mult', 'claymore'], (p) => [p.blastArmor, p.fieldRepair, p.ramMult, p.claymore ?? null]),
  partTable('cargo', 'cargo', ['extra rows'], (p) => [p.extraRows]),
  partTable('scanners', 'scanner', ['range (tiles)'], (p) => [p.range]),
  partTable('stores', 'store', ['holds', 'amount (units)'], (p) => [p.holds, p.amount]),
  partTable('utilities', 'utility', ['effect', 'reload (turns)', 'effect numbers'], (p) => {
    const { type, ...numbers } = p.effect;
    const shown = type === 'oil' ? { slick: oilSlickLength(), ...numbers } : numbers;
    return [type, p.reload, shown];
  }),
  partTable('core', 'core', ['role'], (p) => [p.role]),
  {
    id: 'goods',
    headers: ['id', 'name', 'tier', 'value (M)', 'mass per unit (kg)'],
    rows: () => Object.values(GOODS).map((g) => [g.id, g.name, g.tier, moneyAmount(g.value), g.mass]),
  },
  {
    id: 'shops',
    headers: ['id', 'kind', 'makes', 'needs', 'goods', 'supplies', 'stock size (parts)', 'restock (turns)', 'pressure per unit', 'drift per turn', 'contract slots'],
    rows: () => Object.values(SHOPS).map((s) => [s.id, s.kind, s.makes, s.needs, s.goods, s.supplies, s.stockSize.join(' to '), s.restockTurns, s.pressurePerUnit, s.driftPerTurn, s.contractSlots]),
  },
  {
    id: 'npc-templates',
    headers: ['id', 'name', 'profession', 'faction', 'traits', 'extra traits (chance)', 'fight style', 'aggro range (tiles)', 'cap', 'spawn interval (turns)', 'spawn place'],
    rows: () => Object.values(NPCS).map((n) => [n.id, n.name, n.profession, n.faction, n.traits, n.extraTraits.map((e) => `${e.trait} (${e.chance})`), n.fightStyle, n.aggroRange, n.cap, n.interval, n.spawn]),
  },
  {
    id: 'traits',
    headers: ['id', 'robs', 'boldness', 'fuel margin', 'weight changes'],
    rows: () => entries(TRAITS).map(([id, t]) => [id, t.robs, t.boldness, t.fuelMargin, traitChanges(t.weights as ChangeMap)]),
  },
  {
    id: 'decisions',
    headers: ['decision', 'option', 'base weight'],
    rows: () => entries(DECISIONS).flatMap(([decision, options]) => Object.entries(options).map(([option, weight]) => [decision, option, weight as number])),
  },
  { id: 'state-kinds', headers: ['kind', 'turns', 'binds a deal'], rows: stateKindRows },
  {
    id: 'gear-levels',
    headers: ['level', 'gear money M', 'wear step odds', 'cargo mult'],
    rows: () => entries(GEAR_LEVELS).map(([level, g]) => [level, moneyAmount(g.money), g.wear.map((w) => `${w.value}:${w.weight}`).join(' '), g.cargo]),
  },
  {
    id: 'loadout-priorities',
    headers: ['template', 'speed', 'firepower', 'armor', 'cargo'],
    rows: () => entries(NPCS).map(([id, t]) => [id, t.loadout.priorities.speed, t.loadout.priorities.firepower, t.loadout.priorities.armor, t.loadout.priorities.cargo]),
  },
  {
    id: 'skills',
    headers: ['id', 'name', 'earns XP from', 'effects per rank'],
    rows: () => entries(SKILL_INFO).map(([id, s]) => [id, s.name, s.grows, SKILL_EFFECTS[id as keyof typeof SKILL_EFFECTS]]),
  },
  { id: 'rank-costs', headers: ['rank', 'xp cost'], rows: () => RANK_COSTS.map((xp, i) => [i + 1, xp]) },
  {
    id: 'xp-sources',
    headers: ['source', 'activity family', 'weight (xp per unit)', 'scaled by difficulty', 'repeat factor'],
    rows: () => entries(XP_SOURCES).map(([id, s]) => [id, s.skill, s.weight, s.scaled, s.repeat]),
  },
  {
    id: 'perks',
    headers: ['id', 'name', 'skill', 'rank', 'rule'],
    rows: () => entries(PERKS).map(([id, p]) => [id, p.name, p.skill, p.level, p.rule]),
  },
  {
    id: 'models',
    headers: ['kind', 'id', 'model'],
    rows: () => [
      ...Object.keys(CHASSIS).map((id): Cell[] => ['chassis', id, baseModel(id)]),
      ...entries(PART_MODELS).map(([id, model]): Cell[] => [id in PARTS ? 'part' : 'good', id, model]),
    ],
  },
  {
    id: 'weapon-pools',
    headers: ['weapon', 'mount', 'receiver', 'barrel', 'extra'],
    rows: () => entries(WEAPON_POOLS).map(([id, p]) => [id, p.mount, p.receiver, p.barrel, p.extra]),
  },
  {
    id: 'sounds',
    headers: ['cue', 'bus', 'loop', 'volume', 'max voices', 'variants'],
    rows: () => entries(SOUNDS).map(([id, c]) => [id, c.bus, c.loop, c.volume, c.maxVoices, c.files.length]),
  },
];

export const WIKI_TABLES: Record<string, WikiTable> = Object.fromEntries(TABLES.map((t) => [t.id, t]));

export const WIKI_ROOTS: Record<string, unknown> = {
  RULES, ECONOMY, EFFORT, CONTRACTS, PRICE_FACTOR, DISTANCE_PREMIUM, PRESSURE_MAX,
  PART_PRICE_MODIFIERS, CHASSIS_PRICE_MODIFIERS, CONDITION, WEAR, REPAIR, PATCH, SALVAGE, STRIP,
  NPC_BEHAVIOR, NPC_UPKEEP, HUNT, SPAWN, MIN_CHANCE, DETECT, TOW, XP_RULES, PERK_NUMBERS,
  UNITS, TIME, PHYSICS, BREAKABLE,
};
