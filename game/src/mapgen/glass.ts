// Fused glass of a territory, from its GlassRules: tiles marked glass where value noise passes a cover share that
// grows from the centre to the edge, kept off the dirt roads and the yards round every piece, building and cache, then
// glass spires drawn wholly on the glass. Glass ground is drivable and does no harm; a spire is impassable glass. It

import type { TerritoryDef } from '../data/region';
import type { BuildingGroup, GlassRules, TerritoryRules, WreckRules } from '../data/territory';
import { noiseAt } from '../sim/elevation';
import { randInt, randRange, type Rng } from '../sim/rng';
import { siteGap } from '../sim/sites';
import { tableOfKind, territoryCaches, territoryPieces } from '../sim/territory';
import type { BakedProp } from '../sim/terrain';
import { dist, lerp, type Vec } from '../sim/vec';
import type { MapDraft } from './bake';
import { touchedTiles } from './farm';
import { steep } from './marks';
import { BUILT_GLASS, BUILT_SCRUB } from './newworld';
import { BUILT_NONE, prop, tileCenter, tilesWithin } from './oldworld';
import { clearOf, draw } from './territory';

const NOISE_SEEDS = 2 ** 31 - 1;
const GLAZED = new Set([BUILT_NONE, BUILT_SCRUB]);

export function fillGlass(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, glass: GlassRules, rng: Rng): void {
  checkGlass(t, glass);
  markGlass(d, t, glass, keptProps(d, t, rules), randInt(rng, 0, NOISE_SEEDS));
  placeSpires(d, t, rules, glass, rng);
}

function checkGlass(t: TerritoryDef, glass: GlassRules): void {
  if (!glass.cover.every((c) => c >= 0 && c <= 1)) throw new Error(`${t.id} glass cover ${glass.cover.join(' to ')} is not within 0 to 1`);
  if (!(glass.cell > 0)) throw new Error(`${t.id} glass cell ${glass.cell} is not positive`);
}

export function markGlass(d: MapDraft, t: TerritoryDef, glass: GlassRules, keep: readonly BakedProp[], noiseSeed: number): void {
  for (const tile of tilesWithin(d.size, t.pos, t.radius)) if (glazes(d, t, glass, keep, noiseSeed, tile)) d.built[tile] = BUILT_GLASS;
}

function glazes(d: MapDraft, t: TerritoryDef, glass: GlassRules, keep: readonly BakedProp[], noiseSeed: number, tile: number): boolean {
  const c = tileCenter(d.size, tile);
  if (!GLAZED.has(d.built[tile]) || siteGap(t, c) >= 0 || steep(d, tile)) return false;
  if (keep.some((o) => dist(o.pos, c) <= o.r + glass.clear)) return false;
  return noiseAt(noiseSeed, c.x / glass.cell, c.y / glass.cell) < lerp(glass.cover[0], glass.cover[1], dist(c, t.pos) / t.radius);
}

function keptProps(d: MapDraft, t: TerritoryDef, rules: TerritoryRules): BakedProp[] {
  const looks = new Set(buildingGroups(rules).map((g) => g.look));
  const buildings = d.props.filter((p) => looks.has(p.kind) && siteGap(t, p.pos) < 0);
  return [...(rules.wreck ? wreckKept(t, rules.wreck) : []), ...buildings];
}

function wreckKept(t: TerritoryDef, wreck: WreckRules): BakedProp[] {
  const pieces = territoryPieces(t).map((p) => prop(p.look, p.pos, p.r, p.yaw));
  return [...pieces, ...territoryCaches(t).map((c) => prop(wreck.cacheLook, c.pos, wreck.cacheRadius, c.yaw))];
}

function buildingGroups(rules: TerritoryRules): BuildingGroup[] {
  return [...(rules.wreck?.buildings ?? []), ...(rules.farm?.buildings ?? [])];
}

function placeSpires(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, glass: GlassRules, rng: Rng): void {
  const spots = d.props.filter((p) => tableOfKind(rules, p.kind) !== null && siteGap(t, p.pos) < 0);
  const pick = (): Vec => {
    const a = randRange(rng, 0, Math.PI * 2);
    const r = t.radius * Math.sqrt(randRange(rng, 0, 1));
    return { x: t.pos.x + Math.cos(a) * r, y: t.pos.y + Math.sin(a) * r };
  };
  const onGlass = (pos: Vec, r: number): boolean => touchedTiles(d.size, pos, r).every((tile) => d.built[tile] === BUILT_GLASS);
  const ok = (pos: Vec, r: number): boolean => siteGap(t, pos) < -r && onGlass(pos, r) && clearOf(d.props, pos, r, 0) && clearOf(spots, pos, r, rules.debrisGap);
  for (let i = 0; i < glass.spires.count; i++) d.props.push(draw({ d, t, rules, rng }, glass.spires.look, 'on its glass', pick, glass.spires.radius, ok));
}
