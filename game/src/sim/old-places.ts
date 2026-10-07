// Old-world places and their loot spots: the one owner of which baked old-world props hold a spot. Pure queries over
// the baked map. The bake does not record which rule placed a prop, so places are rebuilt from prop kind and spacing:
// buildings that stand close form one place, and so do tank hulks. A few places hold one spot each, picked by a hash
// of the map seed, off the roads and on ground a truck can reach. src/sim/salvage.ts rolls and renews their stocks.

import { CHASSIS } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import OLD_SPOTS_FILE from '../data/old-spots.json';
import { REGION } from '../data/region';
import { OLD_PLACES, OLD_PLACE_TYPES, type OldPlaceType } from '../data/salvage';
import { clearOfSites, mapObstacles, propReach } from './mapgen';
import { startComponent } from './nav/astar';
import { CELL, CLEARANCE, componentOf, navLayer, type NavLayer } from './nav/layer';
import { hashRandom } from './rng';
import { ROAD_INDEX } from './road-index';
import { territoryAt } from './territory';
import type { BakedMap, PropKind } from './terrain';
import type { Obstacle } from './types';
import { clamp, dist, type Vec } from './vec';

export type OldPlace = { type: OldPlaceType; centroid: Vec; props: Obstacle[] };
// A prop that holds a loot spot, with the type of its place. reach is the prop's reach in tiles.
export type OldSpotPick = { propId: string; type: OldPlaceType; pos: Vec; reach: number };

const BUILDINGS: readonly PropKind[] = ['house', 'ruin', 'silo', 'waterTower', 'gasStation'];
const TOWERS: readonly PropKind[] = ['silo', 'waterTower'];
const RING_DIRECTIONS = 24; // directions tried around a prop for a parking cell
const RING_PAST = 2; // tiles past the parking ring a parking cell may lie

export const MAX_RADIUS = Math.max(...Object.values(CHASSIS).map((c) => c.radius));
const OLD_SPOTS = OLD_SPOTS_FILE as { mapHash: string; picks: OldSpotPick[] };

// Old-world places outside territories and clear of sites, grouped by single linkage. Buildings and hulks never
// share a place.
export function oldPlaces(baked: readonly Obstacle[]): OldPlace[] {
  const candidates = baked.filter((o) => o.kind === 'landmark' && territoryAt(o.pos) === null && clearOfSites(o.pos, o.r));
  const buildings = linked(candidates.filter((o) => o.kind === 'landmark' && BUILDINGS.includes(o.look)), OLD_PLACES.buildingGap);
  const tanks = linked(candidates.filter((o) => o.kind === 'landmark' && o.look === 'tank'), OLD_PLACES.tankGap);
  return [...buildings.map((props) => place(buildingType(props), props)), ...tanks.map((props) => place('hulks', props))];
}

function buildingType(props: Obstacle[]): OldPlaceType {
  if (props.some((o) => o.kind === 'landmark' && TOWERS.includes(o.look))) return 'homestead';
  return props.length > 1 ? 'hamlet' : 'lookout';
}

function place(type: OldPlaceType, props: Obstacle[]): OldPlace {
  const centroid = { x: props.reduce((s, o) => s + o.pos.x, 0) / props.length, y: props.reduce((s, o) => s + o.pos.y, 0) / props.length };
  return { type, centroid, props };
}

// Groups where each member lies within gap tiles of another member of its group, in input order.
function linked(props: Obstacle[], gap: number): Obstacle[][] {
  const groupOf = props.map((_, i) => i);
  const root = (i: number): number => (groupOf[i] === i ? i : (groupOf[i] = root(groupOf[i])));
  for (let i = 0; i < props.length; i++)
    for (let j = i + 1; j < props.length; j++) if (dist(props[i].pos, props[j].pos) <= gap) groupOf[root(j)] = root(i);
  const groups = new Map<number, Obstacle[]>();
  props.forEach((o, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), o]));
  return [...groups.values()];
}

// The props of the map that hold loot spots, at most one per place, as npm run old-spots wrote them for the map.
// Making them builds a nav layer of the baked props, which takes seconds, so the picks are made once per map and
// committed. A test makes them again and fails when the file is stale.
export function oldSpotPicks(map: { hash: string }): OldSpotPick[] {
  if (OLD_SPOTS.mapHash !== map.hash) throw new Error(`Old spots were picked for map ${OLD_SPOTS.mapHash}, not ${map.hash}. Run npm run old-spots.`);
  return OLD_SPOTS.picks;
}

// Makes the picks from the map: its props, terrain and seed. The same map always gives the same picks.
export function makeOldSpotPicks(map: BakedMap): OldSpotPick[] {
  const baked = mapObstacles(map);
  const layer = navLayer(map.terrain, baked, MAX_RADIUS);
  return oldPlaces(baked).flatMap((p) => {
    const key = [Math.round(p.centroid.x), Math.round(p.centroid.y)];
    if (hashRandom(map.seed, OLD_PLACES.seedOffset, ...key) >= OLD_PLACES.chance[p.type]) return [];
    const spot = placeSpot(map, layer, p);
    return spot ? [{ propId: spot.id, type: p.type, pos: { ...spot.pos }, reach: propReach(spot) }] : [];
  });
}

// The place's first prop in hashed order that stands off the road and can be reached, or null when none can.
export function placeSpot(map: BakedMap, layer: NavLayer, p: OldPlace): Obstacle | null {
  const order = [...p.props].sort((a, b) => propHash(map, a) - propHash(map, b));
  return order.find((o) => offRoad(o) && reachable(layer, o)) ?? null;
}

function propHash(map: BakedMap, o: Obstacle): number {
  return hashRandom(map.seed, OLD_PLACES.seedOffset, Math.round(o.pos.x * 16), Math.round(o.pos.y * 16), 1);
}

// Whether the prop's reach lies at least roadGap tiles past every road edge.
export function offRoad(o: Obstacle): boolean {
  return ROAD_INDEX.nearestWithin(o.pos.x, o.pos.y, REGION.roadWidth / 2 + OLD_PLACES.roadGap + propReach(o)) === Infinity;
}

// Whether a free cell on the prop's parking ring, or a little past it, lies in salvage reach of the prop and joins
// the road nearest the prop. The layer is for the widest chassis, so every truck fits.
export function reachable(layer: NavLayer, o: Obstacle): boolean {
  const road = componentAt(layer, nearestRoadPoint(o.pos));
  if (road === 0) return false;
  const ring = propReach(o) + layer.radius + CLEARANCE;
  const inReach = (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
  for (let k = 0; k < RING_DIRECTIONS; k++) {
    const angle = (k / RING_DIRECTIONS) * 2 * Math.PI;
    for (let past = 0; past <= RING_PAST; past++) {
      const at = { x: o.pos.x + Math.cos(angle) * (ring + past), y: o.pos.y + Math.sin(angle) * (ring + past) };
      const cell = cellAt(layer, at);
      if (dist(centreOf(layer, cell), o.pos) <= inReach && componentOf(layer, cell) === road) return true;
    }
  }
  return false;
}

function componentAt(layer: NavLayer, p: Vec): number {
  return startComponent(layer, cellAt(layer, p));
}

function cellAt(layer: NavLayer, p: Vec): number {
  const x = clamp(Math.floor(p.x / CELL), 0, layer.n - 1);
  const y = clamp(Math.floor(p.y / CELL), 0, layer.n - 1);
  return y * layer.n + x;
}

function centreOf(layer: NavLayer, cell: number): Vec {
  return { x: ((cell % layer.n) + 0.5) * CELL, y: (Math.floor(cell / layer.n) + 0.5) * CELL };
}

// The point on today's roads nearest p.
export function nearestRoadPoint(p: Vec): Vec {
  let best = { x: Infinity, y: Infinity };
  for (const road of REGION.roads)
    for (let i = 1; i < road.length; i++) {
      const q = closestOnSegment(p, road[i - 1], road[i]);
      if (dist(p, q) < dist(p, best)) best = q;
    }
  return best;
}

function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function oldStockId(pick: Pick<OldSpotPick, 'type' | 'propId'>): string {
  return `old-${pick.type}-${pick.propId}`;
}

// The place type and prop of an old spot's stock, or null for any other stock. Ids are old-<type>-<propId>.
export function oldSpotOf(stock: { id: string }): { type: OldPlaceType; propId: string } | null {
  if (!stock.id.startsWith('old-')) return null;
  const rest = stock.id.slice('old-'.length);
  const type = OLD_PLACE_TYPES.find((t) => rest.startsWith(`${t}-`));
  if (!type) throw new Error(`Stock ${stock.id} names no old place type`);
  return { type, propId: rest.slice(type.length + 1) };
}

// Picks of the map within range tiles of pos.
export function oldSpotsNear(mapHash: string, pos: Vec, range: number): OldSpotPick[] {
  return oldSpotPicks({ hash: mapHash }).filter((p) => dist(p.pos, pos) <= range);
}
