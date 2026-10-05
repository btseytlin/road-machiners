// Fused glass of a territory, from its GlassRules: tiles marked glass where value noise passes a cover share that
// grows from the centre to the edge, kept off the dirt roads and the yards round every piece, building and cache, then
// glass spires drawn wholly on the glass. Glass ground is drivable and does no harm; a spire is impassable glass. It
// runs last in a territory's fill, on the territory's own draws, so it shifts no other territory.

import type { TerritoryDef } from '../data/region';
import type { BuildingGroup, GlassRules, TerritoryRules, WreckRules } from '../data/territory';
import { noiseAt } from '../sim/elevation';
import { randInt, randRange, type Rng } from '../sim/rng';
import { siteGap } from '../sim/sites';
import type { BakedProp, PropKind } from '../sim/terrain';
import { dist, lerp, type Vec } from '../sim/vec';
import type { MapDraft } from './bake';
import { touchedTiles } from './farm';
import { steep } from './marks';
import { BUILT_GLASS, BUILT_SCRUB } from './newworld';
import { BUILT_NONE, prop, tileCenter, tilesWithin } from './oldworld';
import { clearOf, draw } from './territory';

const NOISE_SEEDS = 2 ** 31 - 1; // the largest noise seed drawn, so a seed stays in the int32 range the noise hashes
const GLAZED = new Set([BUILT_NONE, BUILT_SCRUB]); // marks glass may take: bare ground, and scrub the heat burnt off

// Checks the rules, marks the glass from one noise seed drawn from the territory's draws, then draws the spires.
export function fillGlass(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, glass: GlassRules, rng: Rng): void {
  checkGlass(t, glass);
  markGlass(d, t, glass, keptProps(d, t, rules), randInt(rng, 0, NOISE_SEEDS));
  placeSpires(d, t, rules, glass, rng);
}

function checkGlass(t: TerritoryDef, glass: GlassRules): void {
  if (!glass.cover.every((c) => c >= 0 && c <= 1)) throw new Error(`${t.id} glass cover ${glass.cover.join(' to ')} is not within 0 to 1`);
  if (!(glass.cell > 0)) throw new Error(`${t.id} glass cell ${glass.cell} is not positive`);
}

// Marks glass on every tile inside the territory that glazes. keep holds the props whose yards stay sand.
export function markGlass(d: MapDraft, t: TerritoryDef, glass: GlassRules, keep: readonly BakedProp[], noiseSeed: number): void {
  for (const tile of tilesWithin(d.size, t.pos, t.radius)) if (glazes(d, t, glass, keep, noiseSeed, tile)) d.built[tile] = BUILT_GLASS;
}

// Whether a tile turns to glass: bare or scrub ground inside the territory, not too steep to drive, farther than clear
// from every kept prop's footprint, where the noise falls under the cover share at its distance from the centre.
function glazes(d: MapDraft, t: TerritoryDef, glass: GlassRules, keep: readonly BakedProp[], noiseSeed: number, tile: number): boolean {
  const c = tileCenter(d.size, tile);
  if (!GLAZED.has(d.built[tile]) || siteGap(t, c) >= 0 || steep(d, tile)) return false;
  if (keep.some((o) => dist(o.pos, c) <= o.r + glass.clear)) return false;
  return noiseAt(noiseSeed, c.x / glass.cell, c.y / glass.cell) < lerp(glass.cover[0], glass.cover[1], dist(c, t.pos) / t.radius);
}

// The props whose yards stay sand: the wreck's pieces and caches, and the buildings already placed in the territory.
function keptProps(d: MapDraft, t: TerritoryDef, rules: TerritoryRules): BakedProp[] {
  const looks = new Set(buildingGroups(rules).map((g) => g.look));
  const buildings = d.props.filter((p) => looks.has(p.kind) && siteGap(t, p.pos) < 0);
  return [...(rules.wreck ? wreckKept(t, rules.wreck) : []), ...buildings];
}

function wreckKept(t: TerritoryDef, wreck: WreckRules): BakedProp[] {
  const onMap = (at: Vec): Vec => ({ x: t.pos.x + at.x, y: t.pos.y + at.y });
  const pieces = wreck.pieces.map((p) => prop(p.look, onMap(p.at), p.r, p.yaw));
  return [...pieces, ...wreck.caches.map((c) => prop(wreck.cacheLook, onMap(c.at), wreck.cacheRadius, 0))];
}

function buildingGroups(rules: TerritoryRules): BuildingGroup[] {
  return [...(rules.wreck?.buildings ?? []), ...(rules.farm?.buildings ?? [])];
}

// Spires drawn inside the territory, each wholly on glass tiles, clear of every prop, and the debris gap from every
// loot spot so a truck can still park beside one.
function placeSpires(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, glass: GlassRules, rng: Rng): void {
  const looks = spotLooks(rules);
  const spots = d.props.filter((p) => looks.has(p.kind) && siteGap(t, p.pos) < 0);
  const pick = (): Vec => {
    const a = randRange(rng, 0, Math.PI * 2);
    const r = t.radius * Math.sqrt(randRange(rng, 0, 1));
    return { x: t.pos.x + Math.cos(a) * r, y: t.pos.y + Math.sin(a) * r };
  };
  const onGlass = (pos: Vec, r: number): boolean => touchedTiles(d.size, pos, r).every((tile) => d.built[tile] === BUILT_GLASS);
  const ok = (pos: Vec, r: number): boolean => siteGap(t, pos) < -r && onGlass(pos, r) && clearOf(d.props, pos, r, 0) && clearOf(spots, pos, r, rules.debrisGap);
  for (let i = 0; i < glass.spires.count; i++) d.props.push(draw({ d, t, rng }, glass.spires.look, 'on its glass', pick, glass.spires.radius, ok));
}

// The looks whose props inside the territory are its loot spots, as src/sim/territory.ts reads them: a wreck's caches
// and field spots when it has any, and every building group's look.
function spotLooks(rules: TerritoryRules): Set<PropKind> {
  return new Set([...(rules.wreck ? wreckSpotLooks(rules.wreck) : []), ...buildingGroups(rules).map((g) => g.look)]);
}

function wreckSpotLooks(wreck: WreckRules): PropKind[] {
  const caches = wreck.caches.length > 0 ? [wreck.cacheLook] : [];
  return wreck.patches.some((p) => p.spots > 0) ? [...caches, wreck.spotLook] : caches;
}
