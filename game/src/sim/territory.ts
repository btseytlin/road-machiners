// Territories: open ground with hull pieces, loot spots, debris and a hazard. Pure queries over REGION and
// TERRITORIES. The bake places the props, src/sim/salvage.ts rolls the stocks and src/sim/hazard.ts applies the
// hazard. This file turns authored layout into map tiles, so the bake, the render and the sim place things alike.

import { REGION, type TerritoryDef } from '../data/region';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRAIN, type Basin } from '../data/terrain';
import { TERRITORIES, type FarmRoad, type FarmRules, type Hazard, type SpotTable, type TerritoryRules, type WreckRules } from '../data/territory';
import { deckById } from './bridge';
import { isTerritory, siteEdgeCrossings, siteGap } from './sites';
import { randInt } from './rng';
import { PROP_KINDS, type PropKind } from './terrain';
import type { LandmarkLook, NpcActivity, Obstacle, SalvageStock, Vehicle, World } from './types';
import { dist, lerp, type Vec } from './vec';

export { isTerritory };

const GROUND_POINTS = 8;

export type HazardZone = Hazard & { id: string; pos: Vec };
export type BakedPiece = { look: LandmarkLook; pos: Vec; yaw: number; r: number; sink: number };

export type LandingStrip = { a: Vec; b: Vec; width: number };

const TERRITORY_DEFS: readonly TerritoryDef[] = REGION.locations.filter(isTerritory);

export function territoryAt(pos: Vec): TerritoryDef | null {
  return TERRITORY_DEFS.find((t) => siteGap(t, pos) < 0) ?? null;
}

function spotTableAt(kind: string, pos: Vec): SpotTable | null {
  const t = territoryAt(pos);
  return t ? tableOfKind(TERRITORIES[t.id], kind) : null;
}

export function tableOfKind(rules: TerritoryRules, kind: string): SpotTable | null {
  const fromWreck = rules.wreck ? wreckTableOfKind(rules.wreck, kind) : null;
  return fromWreck ?? rules.farm?.buildings.find((b) => b.look === kind)?.table ?? null;
}

function wreckTableOfKind(wreck: WreckRules, kind: string): SpotTable | null {
  return cacheOrFieldTable(wreck, kind) ?? wreck.buildings.find((b) => b.look === kind)?.table ?? null;
}

function cacheOrFieldTable(wreck: WreckRules, kind: string): SpotTable | null {
  if (kind === wreck.cacheLook && wreck.caches.length > 0) return wreck.cacheTable;
  if (kind === wreck.spotLook && wreck.patches.some((p) => p.spots > 0)) return wreck.spotTable;
  return null;
}

export function isLootSpot(o: Obstacle): boolean {
  return o.kind === 'landmark' && spotTableAt(o.look, o.pos) !== null;
}

export function spotTable(o: Obstacle): LootTable {
  const table = o.kind === 'landmark' ? spotTableAt(o.look, o.pos) : null;
  if (!table) throw new Error(`Obstacle ${o.id} is not a loot spot`);
  return SALVAGE[table];
}

export function spotLookOf(stock: { id: string }): PropKind | null {
  const kind = stock.id.slice(0, stock.id.lastIndexOf('-'));
  return PROP_KINDS.find((k) => k === kind) ?? null;
}

export function territoryOfStock(stock: SalvageStock): TerritoryDef | null {
  const look = spotLookOf(stock);
  return look && spotTableAt(look, stock.pos) ? territoryAt(stock.pos) : null;
}

export function territorySpots(world: World, id: string): SalvageStock[] {
  return world.salvage.filter((stock) => territoryOfStock(stock)?.id === id);
}

export function territoryEntries(t: TerritoryDef): Vec[] {
  const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => siteEdgeCrossings(t, road[i], b)));
  return crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
}

export function territoryGrounds(t: TerritoryDef): Vec[] {
  const { wreck, farm } = TERRITORIES[t.id];
  const zones = hazardZones().filter((z) => z.id === t.id);
  const points = [...(wreck ? wreck.patches.map((p) => onMap(t, p.at)) : []), ...(farm ? spineGrounds(t, farm) : [])];
  return [...territoryEntries(t), ...points.filter((p) => siteGap(t, p) < 0 && zones.every((z) => dist(p, z.pos) > z.radius))];
}

function spineGrounds(t: TerritoryDef, farm: FarmRules): Vec[] {
  const [lo, hi] = farm.grounds;
  const { from, to, band } = farm.spine;
  const off = (band * (lo + hi)) / 2;
  const length = dist(from, to);
  const across = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  const perSide = GROUND_POINTS / 2;
  return [-1, 1].flatMap((side) =>
    Array.from({ length: perSide }, (_, i) => {
      const share = (i + 0.5) / perSide;
      return { x: t.pos.x + lerp(from.x, to.x, share) + across.x * off * side, y: t.pos.y + lerp(from.y, to.y, share) + across.y * off * side };
    }),
  );
}

export function hazardZones(): HazardZone[] {
  return TERRITORY_DEFS.flatMap((t) => {
    const reactor = TERRITORIES[t.id].reactor;
    return reactor?.hazard ? [{ ...reactor.hazard, id: t.id, pos: reactorPos(t) }] : [];
  });
}

function onMap(t: TerritoryDef, at: Vec): Vec {
  return { x: t.pos.x + at.x, y: t.pos.y + at.y };
}

export function territoryPieces(t: TerritoryDef): BakedPiece[] {
  return (TERRITORIES[t.id].wreck?.pieces ?? []).map((p) => ({ look: p.look, pos: onMap(t, p.at), yaw: p.yaw, r: p.r, sink: p.sink ?? 0 }));
}

export function territoryCaches(t: TerritoryDef): Vec[] {
  return (TERRITORIES[t.id].wreck?.caches ?? []).map((c) => onMap(t, c.at));
}

export function territoryRoads(t: TerritoryDef): { roads: FarmRoad[]; spurs: FarmRoad[] } {
  const wreck = TERRITORIES[t.id].wreck;
  const shift = (road: FarmRoad): FarmRoad => ({ ...road, points: road.points.map((p) => onMap(t, p)) });
  return { roads: (wreck?.roads ?? []).map(shift), spurs: (wreck?.spurs ?? []).map(shift) };
}

export function landingStrips(t: TerritoryDef): LandingStrip[] {
  const wreck = TERRITORIES[t.id].wreck;
  if (!wreck) return [];
  return wreck.decks.flatMap((spec) => {
    const deck = deckById(spec.id);
    return deck.lips.map(([p, q]): LandingStrip => {
      const a = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const ahead = dist(a, deck.to) < dist(a, deck.from) ? 1 : -1;
      return { a, b: { x: a.x + deck.axis.x * ahead * wreck.landing, y: a.y + deck.axis.y * ahead * wreck.landing }, width: deck.width };
    });
  });
}

export function basinUnder(t: TerritoryDef): Basin {
  const b = TERRAIN.features.basins.find((basin) => basin.center.x === t.pos.x && basin.center.y === t.pos.y);
  if (!b) throw new Error(`Territory ${t.id} has no basin centred on it`);
  return b;
}

export function reactorPos(t: TerritoryDef): Vec {
  const reactor = TERRITORIES[t.id].reactor;
  if (!reactor) throw new Error(`Territory ${t.id} has no reactor`);
  return onMap(t, reactor.at);
}

export function spotGoal(world: World, territoryId: string): NpcActivity {
  const spots = territorySpots(world, territoryId);
  if (!spots.length) throw new Error(`Territory ${territoryId} has no baked loot spots`);
  const spot = spots[randInt(world, 0, spots.length - 1)];
  return { kind: 'scavenge', targetId: spot.id, destination: { ...spot.pos }, phase: 'travel', reason: 'searchSpot' };
}

export function tripGoal(vehicle: Vehicle, territory: TerritoryDef): NpcActivity {
  const entry = territoryEntries(territory).reduce((a, b) => (dist(vehicle.pos, a) <= dist(vehicle.pos, b) ? a : b));
  return { kind: 'travel', targetId: territory.id, destination: { ...entry }, phase: 'travel', reason: 'tripToSite' };
}
