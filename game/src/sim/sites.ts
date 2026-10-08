// Which town or location the player is at. Trucks never enter a site: each is used from a pad outside one of its gates.

import { REGION, type LocationDef, type TownDef } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import type { World } from './types';
import { dist, type Vec } from './vec';

export type Site = TownDef | LocationDef;

const SITES: readonly Site[] = [...REGION.towns, ...REGION.locations];
const GATES = new Map<string, Vec[]>();
const PADS = new Map<string, Vec[]>();

export function siteGates(site: Site): Vec[] {
  let gates = GATES.get(site.id);
  if (!gates) {
    const crossings = REGION.roads.flatMap((road) => road.slice(1).flatMap((b, i) => edgeCrossings(road[i], b, site.pos, site.radius)));
    const all = crossings.filter((p, i) => !crossings.slice(0, i).some((q) => dist(q, p) < REGION.sites.gateSpacing));
    if (all.length === 0) throw new Error(`Site ${site.id} has no road into it`);
    gates = hasGatePerRoad(site) ? all : all.slice(0, 1);
    GATES.set(site.id, gates);
  }
  return gates;
}

function hasGatePerRoad(site: Site): boolean {
  return !('kind' in site) || site.radius >= REGION.sites.multiGateRadius;
}

export function sitePads(site: Site): Vec[] {
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
  return sitePads(site).reduce((a, b) => (dist(from, a) <= dist(from, b) ? a : b));
}

export function canUseSite(pos: Vec, site: Site): boolean {
  return sitePads(site).some((pad) => onPad(pos, pad, site.pos));
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
  return SITES.find((s) => dist(pos, s.pos) < s.radius) ?? null;
}

export function townAt(world: World): TownDef | null {
  return playerVehicle(world).speed <= RULES.parkedSpeed ? townNear(world) : null;
}

export function townNear(world: World): TownDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.towns.find((t) => canUseSite(pos, t)) ?? null;
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

function edgeCrossings(a: Vec, b: Vec, c: Vec, r: number): Vec[] {
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
