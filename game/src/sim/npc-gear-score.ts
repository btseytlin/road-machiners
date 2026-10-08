import { GEAR_SCORE, PRIORITY_TOP, type LoadoutPriorities } from '../data/npcs';
import { PARTS, partDef, type WeaponDef } from '../data/parts';
import { makePart } from './factory';
import { gunsBySide, killRate, targetOf, THREATS } from './fight-odds';
import { baseGrid, freeCells, itemCells, mountedItems, plateSide, type SideLetter } from './grid';
import { vehicleStats } from './stats';
import type { Vehicle, World } from './types';
import { wornDef } from './wear';

// How a spawning driver judges its gear. The score is the template's four priorities, each over PRIORITY_TOP,
// times how well the truck does at it:
// - armor: on each side, the mean quality of the armor over the side's edge cells, a bare cell counting 0, then a
//   curve that rewards the first plates most. The truck's armor is the mean of its four sides.
// - firepower: on each side, the kill rate of the guns that can fire toward it, saturating. The truck's firepower is
//   the mean of its four sides, so a gun that covers a bare side beats a second gun on a covered one.
// - speed: the top speed over the top speed of the chassis with only its engine.
// - cargo: the free cells over the free cells of the chassis with only its engine, on a curve that makes the first
//   cells given up cheap. Flank armor sits on cells that hold no cargo, so it costs no room. Front and rear armor and
//   deck gear like guns do.
// The damage rules come from src/sim/fight-odds.ts.

const SIDE_LETTERS: readonly SideLetter[] = ['F', 'L', 'R', 'B'];
const LETTER_SIDE = { F: 'front', L: 'left', R: 'right', B: 'rear' } as const;

// A piece's quality is 1 minus e to the minus its shield per cell over armorQualityScale. Its shield is the damage it
// keeps off the truck against the mean threat round: HP times armor over pen times armorShare, less the damage its
// own charge deals the truck when it goes off. It depends on the part and its wear alone, so it is cached.
const qualityCache = new Map<string, number>();

export function armorQuality(world: World, defId: string, wear: number): number {
  const key = `${defId}:${wear}`;
  let quality = qualityCache.get(key);
  if (quality === undefined) {
    const worn = wornDef(makePart(world, defId, wear));
    const def = partDef(defId);
    const selfHarm = def.kind === 'armor' && def.claymore ? def.claymore.selfBlast.damage : 0;
    const shield = THREATS.reduce((sum, round) => sum + (worn.hp * worn.armor) / (round.pen * round.armorShare), 0) / THREATS.length - selfHarm;
    quality = 1 - Math.exp(-shield / (def.w * def.h) / GEAR_SCORE.armorQualityScale);
    qualityCache.set(key, quality);
  }
  return quality;
}

// Scores a truck of one chassis. `bare` is that chassis with only its engine: its top speed is the speed to keep,
// and its front, as rounds meet it, is the target the guns are judged against.
export function gearScorer(world: World, p: LoadoutPriorities, bare: Vehicle): (v: Vehicle) => number {
  const edge = Object.fromEntries(SIDE_LETTERS.map((letter) => [letter, baseGrid(bare.chassisId).cells.flat().filter((cell) => cell === letter).length]));
  const target = targetOf(bare);
  const tierOne = Object.values(PARTS).filter((d): d is WeaponDef => d.kind === 'weapon' && d.tier === 1 && d.line === undefined);
  const saturation = (GEAR_SCORE.gunSaturation * tierOne.reduce((sum, def) => sum + killRate(def, target, 'front'), 0)) / tierOne.length;
  const bareSpeed = vehicleStats(world, bare).maxSpeed;
  const bareCells = freeCells(bare);
  // A gun's kill rate depends on its def and wear alone.
  const rates = new Map<string, number>();
  const rateOf = (def: WeaponDef) => {
    const key = `${def.id}:${def.round.damage}`;
    let rate = rates.get(key);
    if (rate === undefined) rates.set(key, (rate = killRate(def, target, 'front')));
    return rate;
  };

  const armorValue = (v: Vehicle) => {
    const sum = { F: 0, L: 0, R: 0, B: 0 };
    for (const item of mountedItems(v, 'armor')) sum[plateSide(v.chassisId, item)] += armorQuality(world, item.part.defId, item.part.wear) * itemCells(item).length;
    const sides = SIDE_LETTERS.map((letter) => {
      const protection = edge[letter] > 0 ? Math.min(1, sum[letter] / edge[letter]) : 1;
      return 1 - (1 - protection) ** GEAR_SCORE.armorCurvePower;
    });
    return sides.reduce((a, b) => a + b, 0) / sides.length;
  };

  const fireValue = (v: Vehicle) => {
    const guns = gunsBySide(v);
    const sides = SIDE_LETTERS.map((letter) => {
      const fire = guns[LETTER_SIDE[letter]].reduce((sum, def) => sum + rateOf(def), 0);
      return 1 - Math.exp(-((fire / saturation) ** GEAR_SCORE.gunCurvePower));
    });
    return sides.reduce((a, b) => a + b, 0) / sides.length;
  };

  return (v) =>
    (p.armor / PRIORITY_TOP) * armorValue(v) +
    (p.firepower / PRIORITY_TOP) * fireValue(v) +
    GEAR_SCORE.speedWeight * (p.speed / PRIORITY_TOP) * (vehicleStats(world, v).maxSpeed / bareSpeed) +
    (p.cargo / PRIORITY_TOP) * (1 - (1 - Math.min(1, freeCells(v) / bareCells)) ** GEAR_SCORE.cargoCurvePower);
}
