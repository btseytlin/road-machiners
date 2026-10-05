// Territories: open ground with hull decks, loot spots, debris and a hazard. Pure queries over REGION and TERRITORIES.
// The bake places the props and stamps the decks, src/sim/salvage.ts rolls the stocks and src/sim/hazard.ts applies
// the hazard. This file owns deck geometry, so the bake and the render agree on every deck.

import { REGION, type TerritoryDef } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES, type Hazard, type HullRules, type HullSection, type SpotTable, type TerritoryRules } from '../data/territory';
import { isTerritory, siteEdgeCrossings, siteGap } from './sites';
import { randInt } from './rng';
import { PROP_KINDS, type PropKind } from './terrain';
import type { NpcActivity, Obstacle, SalvageStock, Vehicle, World } from './types';
import { dist, lerp, type Vec } from './vec';

export { isTerritory };

const GROUND_POINTS = 8; // hunting grounds beside a territory's spine, half on each side

export type HazardZone = Hazard & { id: string; pos: Vec };

const TERRITORY_DEFS: readonly TerritoryDef[] = REGION.locations.filter(isTerritory);

export function territoryAt(pos: Vec): TerritoryDef | null {
  return TERRITORY_DEFS.find((t) => siteGap(t, pos) < 0) ?? null;
}

// The prop kind of a loot spot in a deck bay. Field spots and farm buildings take their kinds from TERRITORIES.
export const DECK_BAY: PropKind = 'deckBay';

// The SALVAGE table a prop of this kind at pos rolls as a loot spot of its territory, or null when it is none.
function spotTableAt(kind: string, pos: Vec): SpotTable | null {
  const t = territoryAt(pos);
  return t ? tableOfKind(TERRITORIES[t.id], kind) : null;
}

function tableOfKind(rules: TerritoryRules, kind: string): SpotTable | null {
  if (kind === DECK_BAY) return bayTableOf(rules.hull);
  const spots: readonly { look: PropKind; table: SpotTable }[] = [...(rules.farm ? rules.farm.buildings : []), ...rules.spots];
  return spots.find((s) => s.look === kind)?.table ?? null;
}

function bayTableOf(hull: HullRules | null): SpotTable | null {
  return hull && hull.sections.some((s) => s.bays.length > 0) ? hull.bayTable : null;
}

// A baked prop of a spot kind inside the territory that makes that kind a spot: a deck bay, a farm building or a
// field spot.
export function isLootSpot(o: Obstacle): boolean {
  return o.kind === 'landmark' && spotTableAt(o.look, o.pos) !== null;
}

export function spotTable(o: Obstacle): LootTable {
  const table = o.kind === 'landmark' ? spotTableAt(o.look, o.pos) : null;
  if (!table) throw new Error(`Obstacle ${o.id} is not a loot spot`);
  return SALVAGE[table];
}

// The prop kind in a stock's id, or null when the id names none. Ids of baked props are <kind>-<k>, so the id tells a
// spot's kind.
export function spotLookOf(stock: SalvageStock): PropKind | null {
  const kind = stock.id.slice(0, stock.id.lastIndexOf('-'));
  return PROP_KINDS.find((k) => k === kind) ?? null;
}

// The territory whose loot spot holds this stock.
export function territoryOfStock(stock: SalvageStock): TerritoryDef | null {
  const look = spotLookOf(stock);
  return look && spotTableAt(look, stock.pos) ? territoryAt(stock.pos) : null;
}

export function territorySpots(world: World, id: string): SalvageStock[] {
  return world.salvage.filter((stock) => territoryOfStock(stock)?.id === id);
}

// Where roads meet the territory's edge: the ends of its approach roads, in road order.
export function territoryEntries(t: TerritoryDef): Vec[] {
  const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => siteEdgeCrossings(t, road[i], b)));
  return crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
}

// Open points inside a territory where raiders and vultures wait for scavengers: its entries, and points spread
// along both sides of its spine, through its grounds band, that lie inside it. They lie clear of the hazard.
export function territoryGrounds(t: TerritoryDef): Vec[] {
  const rules = TERRITORIES[t.id];
  const [lo, hi] = rules.grounds;
  const { from, to, band } = rules.spine;
  const off = (band * (lo + hi)) / 2;
  const length = dist(from, to);
  const across = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  const perSide = GROUND_POINTS / 2;
  const sides = [-1, 1].flatMap((side) =>
    Array.from({ length: perSide }, (_, i) => {
      const share = (i + 0.5) / perSide;
      return { x: t.pos.x + lerp(from.x, to.x, share) + across.x * off * side, y: t.pos.y + lerp(from.y, to.y, share) + across.y * off * side };
    }),
  );
  return [...territoryEntries(t), ...sides.filter((p) => siteGap(t, p) < 0)];
}

export function hazardZones(): HazardZone[] {
  return TERRITORY_DEFS.flatMap((t) => {
    const hazard = TERRITORIES[t.id].hazard;
    return hazard ? [{ ...hazard, id: t.id, pos: { ...t.pos } }] : [];
  });
}

// ---- Hull decks: tilted rectangles of ground a truck drives up. The bake stamps them into the heights, and the render
// lays plating on them.

// A deck in map tiles. Corners go low left, high left, high right, low right; low and high are the end mid-points.
export type HullDeck = { section: HullSection; territory: string; corners: [Vec, Vec, Vec, Vec]; low: Vec; high: Vec };
export type RibPose = { pos: Vec; yaw: number; r: number };

function buildDeck(t: TerritoryDef, section: HullSection): HullDeck {
  const along = { x: Math.cos(section.yaw), y: Math.sin(section.yaw) };
  const left = { x: along.y, y: -along.x };
  const mid = { x: t.pos.x + section.at.x, y: t.pos.y + section.at.y };
  const at = (a: number, l: number): Vec => ({ x: mid.x + along.x * a + left.x * l, y: mid.y + along.y * a + left.y * l });
  const [a, l] = [section.length / 2, section.width / 2];
  return { section, territory: t.id, corners: [at(-a, l), at(a, l), at(a, -l), at(-a, -l)], low: at(-a, 0), high: at(a, 0) };
}

// A territory without a hull has no decks.
const HULL_DECKS: readonly HullDeck[] = TERRITORY_DEFS.flatMap((t) => (TERRITORIES[t.id].hull?.sections ?? []).map((s) => buildDeck(t, s)));

export function hullDecks(): readonly HullDeck[] {
  return HULL_DECKS;
}

// The share of the deck's length from its low end (0) to its high end (1) at pos, or null off its footprint.
export function deckAlongAt(deck: HullDeck, pos: Vec): number | null {
  const dx = deck.high.x - deck.low.x;
  const dy = deck.high.y - deck.low.y;
  const len2 = dx * dx + dy * dy;
  const along = ((pos.x - deck.low.x) * dx + (pos.y - deck.low.y) * dy) / len2;
  const across = ((pos.x - deck.low.x) * dy - (pos.y - deck.low.y) * dx) / Math.sqrt(len2);
  return along < 0 || along > 1 || Math.abs(across) > deck.section.width / 2 ? null : along;
}

// Tiles from pos to the nearest point of the deck's footprint, 0 on it.
export function deckGap(deck: HullDeck, pos: Vec): number {
  const { yaw, length, width } = deck.section;
  const mid = { x: (deck.low.x + deck.high.x) / 2, y: (deck.low.y + deck.high.y) / 2 };
  const along = (pos.x - mid.x) * Math.cos(yaw) + (pos.y - mid.y) * Math.sin(yaw);
  const across = (pos.y - mid.y) * Math.cos(yaw) - (pos.x - mid.x) * Math.sin(yaw);
  return Math.hypot(Math.max(0, Math.abs(along) - length / 2), Math.max(0, Math.abs(across) - width / 2));
}

// The deck's height at a share along it, over the ground height at its low end.
export function deckPlane(deck: HullDeck, lowGround: number, along: number): number {
  return lowGround + deck.section.rise * along;
}

// Ribs every ribStep tiles from the low end, short of the torn high end. Each runs across the deck with a leg r tiles
// to each side of the middle line, so both legs stand at one deck height.
export function ribPoses(deck: HullDeck): RibPose[] {
  const step = deck.section.ribStep;
  if (step === null) return [];
  const hull = TERRITORIES[deck.territory].hull;
  if (!hull) throw new Error(`Territory ${deck.territory} has a deck but no hull`);
  const r = deck.section.width / 2 - hull.ribInset;
  const count = Math.floor((deck.section.length - step / 2) / step);
  return Array.from({ length: count }, (_, i) => {
    const share = ((i + 1) * step) / deck.section.length;
    return { pos: { x: lerp(deck.low.x, deck.high.x, share), y: lerp(deck.low.y, deck.high.y, share) }, yaw: deck.section.yaw + Math.PI / 2, r };
  });
}

// Where each loot spot of the deck stands, on its middle line.
export function bayPoints(deck: HullDeck): Vec[] {
  return deck.section.bays.map((share) => ({ x: lerp(deck.low.x, deck.high.x, share), y: lerp(deck.low.y, deck.high.y, share) }));
}

// ---- Goals of NPCs at a territory. It has no pad, so a scavenger works one loot spot at a time and a trip ends where a
// road enters it. src/sim/npc-activities.ts builds and runs the goals.

// Drivers know the fixed spots, and learn one is empty only once they can reach it.
export function spotGoal(world: World, territoryId: string): NpcActivity {
  const spots = territorySpots(world, territoryId);
  if (!spots.length) throw new Error(`Territory ${territoryId} has no baked loot spots`);
  const spot = spots[randInt(world, 0, spots.length - 1)];
  return { kind: 'scavenge', targetId: spot.id, destination: { ...spot.pos }, phase: 'travel', reason: 'search a loot spot' };
}

// A trip to the road end nearest the vehicle.
export function tripGoal(vehicle: Vehicle, territory: TerritoryDef): NpcActivity {
  const entry = territoryEntries(territory).reduce((a, b) => (dist(vehicle.pos, a) <= dist(vehicle.pos, b) ? a : b));
  return { kind: 'travel', targetId: territory.id, destination: { ...entry }, phase: 'travel', reason: 'make a trip to another site' };
}
