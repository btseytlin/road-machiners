// Which town or location the player is at. Trucks never enter a site: each is used from a pad outside one of its gates.

import { STALL_MARKETS } from '../data/market';
import { REGION, type LocationDef, type TerritoryDef, type TownDef } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import type { World } from './types';
import { dist, pointInPolygon, polygonEdgeDist, type Vec } from './vec';

export type Site = TownDef | LocationDef;

const SITES: readonly Site[] = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
export const OUTPOSTS: readonly LocationDef[] = STALL_MARKETS.map((id) => {
  const site = REGION.locations.find((l) => l.id === id);
  if (!site) throw new Error(`Stall ${id} has no location`);
  return site;
});
const TERRITORIES: readonly LocationDef[] = REGION.locations.filter(isTerritory);
const GATES = new Map<string, Vec[]>();
const PADS = new Map<string, Vec[]>();

export function siteGates(site: Site): Vec[] {
  if (isTerritory(site)) return [];
  let gates = GATES.get(site.id);
  if (!gates) {
    const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => siteEdgeCrossings(site, road[i], b)));
    const all = crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
    if (all.length === 0) throw new Error(`Site ${site.id} has no road into it`);
    gates = hasGatePerRoad(site) ? all : all.slice(0, 1);
    GATES.set(site.id, gates);
  }
  return gates;
}

export function isTerritory(site: Site): site is TerritoryDef {
  return 'kind' in site && site.kind === 'territory';
}

function hasGatePerRoad(site: Site): boolean {
  return !('kind' in site) || site.radius >= REGION.sites.multiGateRadius;
}

export function sitePads(site: Site): Vec[] {
  if (isTerritory(site)) return [];
  let pads = PADS.get(site.id);
  if (!pads) {
    const out = site.radius + REGION.sites.pad.length / 2;
    pads = siteGates(site).map((g) => {
      const a = Math.atan2(g.y - site.pos.y, g.x - site.pos.x);
      return { x: site.pos.x + Math.cos(a) * out, y: site.pos.y + Math.sin(a) * out };
    });
    PADS.set(site.id, pads);
  }
  return pads;
}

export function nearestPad(site: Site, from: Vec): Vec {
  if (isTerritory(site)) throw new Error(`Territory ${site.id} has no pads; use territoryEntries`);
  return sitePads(site).reduce((a, b) => (dist(from, a) <= dist(from, b) ? a : b));
}

export function canUseSite(pos: Vec, site: Site): boolean {
  return sitePads(site).some((pad) => onPad(pos, pad, site.pos));
}

export const GOAL_REACH = RULES.arriveRadius * 2;

export function reachedSite(pos: Vec, site: Site): boolean {
  return isTerritory(site) ? siteGap(site, pos) <= GOAL_REACH : canUseSite(pos, site);
}

function onPad(pos: Vec, pad: Vec, center: Vec): boolean {
  const a = Math.atan2(pad.y - center.y, pad.x - center.x);
  const dx = pos.x - pad.x;
  const dy = pos.y - pad.y;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  const across = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(along) <= REGION.sites.pad.length / 2 && Math.abs(across) <= REGION.sites.pad.width / 2;
}

export function siteUnder(pos: Vec): Site | null {
  return SITES.find((s) => siteGap(s, pos) < 0) ?? null;
}

export function townAt(world: World): TownDef | null {
  return playerVehicle(world).speed <= RULES.parkedSpeed ? townNear(world) : null;
}

export function townNear(world: World): TownDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.towns.find((t) => canUseSite(pos, t)) ?? null;
}

export function isInTerritory(pos: Vec): boolean {
  return TERRITORIES.some((site) => dist(pos, site.pos) <= site.radius && siteGap(site, pos) < 0);
}

export function isNearTown(pos: Vec, reach: number): boolean {
  return REGION.towns.some((site) => siteGates(site).some((gate) => dist(gate, pos) <= reach));
}

export function isNearOutpost(pos: Vec, reach: number): boolean {
  return OUTPOSTS.some((site) => siteGates(site).some((gate) => dist(gate, pos) <= reach));
}

export function locationAt(world: World): LocationDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.locations.find((l) => canUseSite(pos, l)) ?? null;
}

export function requireTown(world: World): TownDef {
  const town = townAt(world);
  if (!town) throw new Error('Not at a town gate');
  return town;
}

export function nearestTown(world: World): TownDef {
  const pos = playerVehicle(world).pos;
  return [...REGION.towns].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}

const OUTLINES = new WeakMap<readonly Vec[], Vec[]>();
function outlineOf(site: Site): Vec[] | null {
  if (!('outline' in site) || !site.outline) return null;
  let poly = OUTLINES.get(site.outline);
  if (!poly) {
    poly = site.outline.map((p) => ({ x: site.pos.x + p.x, y: site.pos.y + p.y }));
    OUTLINES.set(site.outline, poly);
  }
  return poly;
}

export function siteGap(site: Site, pos: Vec): number {
  const poly = outlineOf(site);
  if (!poly) return dist(pos, site.pos) - site.radius;
  const edge = polygonEdgeDist(pos, poly);
  return dist(pos, site.pos) <= site.radius && pointInPolygon(pos, poly) ? -edge : edge;
}

export function siteEdgeCrossings(site: Site, a: Vec, b: Vec): Vec[] {
  const poly = outlineOf(site);
  if (!poly) return edgeCrossings(a, b, site.pos, site.radius);
  const d = { x: b.x - a.x, y: b.y - a.y };
  const ts = poly.flatMap((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const e = { x: q.x - p.x, y: q.y - p.y };
    const den = d.x * e.y - d.y * e.x;
    if (den === 0) return [];
    const t = ((p.x - a.x) * e.y - (p.y - a.y) * e.x) / den;
    const u = ((p.x - a.x) * d.y - (p.y - a.y) * d.x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u < 1 ? [t] : [];
  });
  return ts.sort((x, y) => x - y).map((t) => ({ x: a.x + d.x * t, y: a.y + d.y * t }));
}

export function edgeCrossings(a: Vec, b: Vec, c: Vec, r: number): Vec[] {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: a.x - c.x, y: a.y - c.y };
  const A = d.x * d.x + d.y * d.y;
  const B = 2 * (f.x * d.x + f.y * d.y);
  const C = f.x * f.x + f.y * f.y - r * r;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)]
    .filter((t) => t >= 0 && t <= 1)
    .map((t) => ({ x: a.x + d.x * t, y: a.y + d.y * t }));
}
