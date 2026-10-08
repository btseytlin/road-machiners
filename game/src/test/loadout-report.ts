// Loadout report: rolls many NPC loadouts per template and averages what they carry. Guns, armor cover, gear value,
// mass and cargo show whether the gear levels give some poor trucks, some loaded ones and decent averages. The
// game never imports this module.

import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { GEAR_LEVEL_IDS, NPCS, type GearLevel } from '../data/npcs';
import { partDef, type EngineDef, type UtilityDef } from '../data/parts';
import { START_KITS } from '../data/start';
import { gridOf, itemCells, mountedItems } from '../sim/grid';
import { vehicleMass } from '../sim/mass';
import { gunDrag, vehicleStats } from '../sim/stats';
import { generateNpcLoadout } from '../sim/npc-loadout';
import { spawnAt } from '../sim/spawn';
import type { Vehicle, World } from '../sim/types';
import { partValue } from '../sim/wear';
import { newWorld } from '../sim/world';
import { TEST_MAP } from './map';
import { defaultSetup } from '../sim/settings';
import { moneyAmount } from '../ui/units';

type CabSide = 'front' | 'rear' | 'left' | 'right';
const CAB_SIDES: readonly CabSide[] = ['front', 'rear', 'left', 'right'];

export type TemplateStats = {
  id: string;
  rolls: number;
  levels: Record<GearLevel, number>;
  guns: number;
  armor: number;
  cab: Record<CabSide, number>;
  value: number;
  mass: number;
  drag: number;
  speed: number;
  cargo: number;
  utility: number;
  activeUtility: number;
  emitter: number;
};

let base: World | undefined;

function worldFor(seed: number): World {
  base ??= newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  return { ...base, vehicles: [], rngState: seed * 7919 + 1, marketRng: { rngState: seed * 104729 + 1 } };
}

export function templateStats(id: string, rolls: number, level: GearLevel | null = null): TemplateStats {
  const tpl = NPCS[id];
  if (!tpl) throw new Error(`Unknown template ${id}`);
  const s: TemplateStats = { id, rolls, levels: { poor: 0, light: 0, standard: 0, heavy: 0, loaded: 0 }, guns: 0, armor: 0, cab: { front: 0, rear: 0, left: 0, right: 0 }, value: 0, mass: 0, drag: 0, speed: 0, cargo: 0, utility: 0, activeUtility: 0, emitter: 0 };
  for (let seed = 1; seed <= rolls; seed++) {
    const w = worldFor(seed);
    const loadout = generateNpcLoadout(w, tpl, null, level);
    const v = spawnAt(w, tpl, loadout, { x: 40, y: 30 });
    s.levels[loadout.level] += 1 / rolls;
    s.guns += mountedItems(v, 'weapon').length / rolls;
    s.armor += armorShare(v) / rolls;
    const cab = cabCover(v);
    for (const side of CAB_SIDES) s.cab[side] += cab[side] / rolls;
    s.value += gearValue(v) / rolls;
    s.mass += vehicleMass(v) / chassisDef(v.chassisId).ratedMass / rolls;
    s.drag += (1 - gunDrag(v, (partDef(mountedItems(v, 'engine')[0].part.defId) as EngineDef).capacity)) / rolls;
    s.speed += vehicleStats(w, v).maxSpeed / chassisDef(v.chassisId).maxSpeed / rolls;
    const utilities = mountedItems(v, 'utility').map((item) => partDef(item.part.defId)).filter((def): def is UtilityDef => def.kind === 'utility');
    s.utility += (utilities.length > 0 ? 1 : 0) / rolls;
    s.activeUtility += (utilities.some((def) => def.reload !== null) ? 1 : 0) / rolls;
    s.emitter += (utilities.some((def) => def.id === 'emitter') ? 1 : 0) / rolls;
    s.cargo += (Object.entries(loadout.cargo).reduce((sum, [good, n]) => sum + GOODS[good].value * n, 0) + loadout.spares.reduce((sum, p) => sum + partDef(p.defId).value, 0)) / rolls;
  }
  return s;
}

const EDGE = new Set(['F', 'B', 'L', 'R']);

function armorShare(v: Vehicle): number {
  const g = gridOf(v);
  const edge = g.cells.flat().filter((c) => c !== null && EDGE.has(c)).length;
  const armored = mountedItems(v, 'armor').reduce((sum, item) => sum + itemCells(item).length, 0);
  return armored / edge;
}

function gearValue(v: Vehicle): number {
  return chassisDef(v.chassisId).value + mountedItems(v).reduce((sum, item) => (partDef(item.part.defId).kind === 'core' ? sum : sum + partValue(item.part)), 0);
}

function cabCover(v: Vehicle): Record<CabSide, number> {
  const g = gridOf(v);
  const armor = new Set(mountedItems(v, 'armor').flatMap(itemCells).map((c) => `${c.x},${c.y}`));
  const cab = mountedItems(v, 'core').filter((it) => (partDef(it.part.defId) as { role?: string }).role === 'cab').flatMap(itemCells);
  const cols = [...new Set(cab.map((c) => c.x))];
  const rows = [...new Set(cab.map((c) => c.y))];
  const [minX, maxX] = [Math.min(...cab.map((c) => c.x)), Math.max(...cab.map((c) => c.x))];
  const [minY, maxY] = [Math.min(...cab.map((c) => c.y)), Math.max(...cab.map((c) => c.y))];
  const span = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const shielded = (cells: string[]) => (cells.some((k) => armor.has(k)) ? 1 : 0);
  const share = (lanes: number[], cells: (lane: number) => string[]) => lanes.reduce((sum, lane) => sum + shielded(cells(lane)), 0) / lanes.length;
  return {
    front: share(cols, (x) => span(0, minY).map((y) => `${x},${y}`)),
    rear: share(cols, (x) => span(maxY + 1, g.h).map((y) => `${x},${y}`)),
    left: share(rows, (y) => span(0, minX).map((x) => `${x},${y}`)),
    right: share(rows, (y) => span(maxX + 1, g.w).map((x) => `${x},${y}`)),
  };
}

const pct = (x: number) => `${Math.round(100 * x)}%`;

export function formatLoadoutReport(stats: TemplateStats[]): string {
  const lines = [
    '# NPC loadouts',
    '',
    `${stats[0]?.rolls ?? 0} rolls per template. Levels are poor, light, standard, heavy, loaded. Armor is the share of edge cells armored. Gun drag is the top speed the guns take. Speed is the top speed against the chassis top speed. Cab is the share of cab lanes shielded per side: front, rear, left, right. Utility, active and emitter are the shares of trucks with any utility, a utility that acts on an order and the emitter mounted.`,
    '',
    '| template | levels | guns | armor | cab F/B/L/R | gear value M | mass | gun drag | speed | cargo value M | utility | active | emitter |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of stats) {
    const levels = GEAR_LEVEL_IDS.map((l) => pct(s.levels[l])).join(' ');
    const cab = CAB_SIDES.map((side) => pct(s.cab[side])).join(' ');
    lines.push(`| ${s.id} | ${levels} | ${s.guns.toFixed(2)} | ${pct(s.armor)} | ${cab} | ${moneyAmount(s.value)} | ${pct(s.mass)} | ${pct(s.drag)} | ${pct(s.speed)} | ${moneyAmount(s.cargo)} | ${pct(s.utility)} | ${pct(s.activeUtility)} | ${pct(s.emitter)} |`);
  }
  return lines.join('\n') + '\n';
}
