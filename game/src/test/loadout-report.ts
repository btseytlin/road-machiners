// Loadout report: rolls many NPC loadouts per template and averages what they carry. Guns, armor cover, speed kept
// and gear money spent show what the scorer builds for each template's priorities. The game never imports this module.

import { chassisDef } from '../data/chassis';
import { GEAR_LEVEL_IDS, NPCS, type GearLevel } from '../data/npcs';
import { partDef } from '../data/parts';
import { START_KITS } from '../data/start';
import { gridOf, itemCells, mountedItems } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import { generateNpcLoadout } from '../sim/npc-loadout';
import { spawnAt } from '../sim/spawn';
import type { Vehicle, World } from '../sim/types';
import { newWorld } from '../sim/world';
import { TEST_MAP } from './map';
import { defaultSetup } from '../sim/settings';
import { moneyAmount } from '../ui/units';

export type TemplateStats = {
  id: string;
  rolls: number;
  levels: Record<GearLevel, number>; // share of rolls at each level
  guns: number; // per truck
  armor: number; // share of chassis edge cells armored
  speed: number; // top speed as a share of the chassis top speed
  spent: number; // list price of the mounted parts past the chassis and its core parts
};

let base: World | undefined;

// One world to draw ids from, with its randomness reset per roll.
function worldFor(seed: number): World {
  base ??= newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  return { ...base, vehicles: [], rngState: seed * 7919 + 1, marketRng: { rngState: seed * 104729 + 1 } };
}

export function templateStats(id: string, rolls: number, level: GearLevel | null = null): TemplateStats {
  const tpl = NPCS[id];
  if (!tpl) throw new Error(`Unknown template ${id}`);
  const s: TemplateStats = { id, rolls, levels: { poor: 0, light: 0, standard: 0, heavy: 0, loaded: 0 }, guns: 0, armor: 0, speed: 0, spent: 0 };
  for (let seed = 1; seed <= rolls; seed++) {
    const w = worldFor(seed);
    const loadout = generateNpcLoadout(w, tpl, null, level);
    const v = spawnAt(w, tpl, loadout, { x: 40, y: 30 });
    s.levels[loadout.level] += 1 / rolls;
    s.guns += mountedItems(v, 'weapon').length / rolls;
    s.armor += armorShare(v) / rolls;
    s.speed += vehicleStats(w, v).maxSpeed / chassisDef(v.chassisId).maxSpeed / rolls;
    s.spent += gearSpent(v) / rolls;
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

function gearSpent(v: Vehicle): number {
  return mountedItems(v).reduce((sum, item) => {
    const def = partDef(item.part.defId);
    return def.kind === 'core' ? sum : sum + def.value;
  }, 0);
}

const pct = (x: number) => `${Math.round(100 * x)}%`;

export function formatLoadoutReport(stats: TemplateStats[]): string {
  const lines = [
    '# NPC loadouts',
    '',
    `${stats[0]?.rolls ?? 0} rolls per template. Levels are poor, light, standard, heavy, loaded. Guns is the mean per truck. Armor is the share of edge cells armored. Speed kept is the top speed against the chassis top speed. Gear money spent is the list price of the mounted parts past the chassis.`,
    '',
    '| template | levels | guns | armor | speed kept | gear money spent M |',
    '|---|---|---|---|---|---|',
  ];
  for (const s of stats) {
    const levels = GEAR_LEVEL_IDS.map((l) => pct(s.levels[l])).join(' ');
    lines.push(`| ${s.id} | ${levels} | ${s.guns.toFixed(2)} | ${pct(s.armor)} | ${pct(s.speed)} | ${moneyAmount(s.spent)} |`);
  }
  return lines.join('\n') + '\n';
}
