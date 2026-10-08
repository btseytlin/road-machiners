// Ground marks of a territory's roads: the farm's old road and dirt roads, and a wreck's dirt road web and its spurs.
// A road marks its tiles in list order, each tile only once, so an earlier road keeps a tile where two cross. A road
// that stays in its territory marks only tiles inside it. A spur leaves its territory onto open land, so it marks

import { REGION, type TerritoryDef } from '../data/region';
import type { FarmRoad } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { siteGap } from '../sim/sites';
import { dist, segmentDist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';
import { BUILT_SCRUB, BUILT_TRACK } from './newworld';
import { BUILT_NONE, BUILT_OLD_ROAD, tileCenter, tileOf, tilesWithin } from './oldworld';

const ROAD_END_SLACK = 1;

export type Touch = (pos: Vec, r: number) => boolean;
export type Line = { points: Vec[]; width: number };
export type Reach = 'inside' | 'spur';

export function markRoads(d: MapDraft, t: TerritoryDef, roads: readonly FarmRoad[], reach: Reach): Touch {
  const lines = roads.map((road) => {
    const line = { points: road.points.map((p) => roadPoint(d, t, p, reach)), width: road.width };
    markLine(d, t, line, road.surface === 'oldRoad' ? BUILT_OLD_ROAD : BUILT_TRACK, reach);
    return line;
  });
  return (pos, r) => lines.some((line) => line.points.slice(1).some((b, k) => segmentDist(pos, line.points[k], b) < line.width / 2 + r));
}

function roadPoint(d: MapDraft, t: TerritoryDef, p: Vec, reach: Reach): Vec {
  const gap = siteGap(t, p);
  if (reach === 'inside' && gap > ROAD_END_SLACK) throw new Error(`${t.id} road point at ${at(p)} lies outside the territory`);
  if ((reach === 'spur' || gap < 0) && steep(d, tileOf(d.size, p))) throw new Error(`${t.id} road point at ${at(p)} lies on a cliff`);
  return p;
}

export function markLine(d: MapDraft, t: TerritoryDef, line: Line, code: number, reach: Reach): void {
  for (let k = 1; k < line.points.length; k++) markLeg(d, t, line.points[k - 1], line.points[k], line.width, code, reach);
}

function markLeg(d: MapDraft, t: TerritoryDef, a: Vec, b: Vec, width: number, code: number, reach: Reach): void {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const tile of tilesWithin(d.size, mid, dist(a, b) / 2 + width)) {
    const c = tileCenter(d.size, tile);
    if (segmentDist(c, a, b) > width / 2) continue;
    if (reach === 'inside') {
      if (siteGap(t, c) < 0) mark(d, tile, code);
      continue;
    }
    spurTile(d, t, tile, c);
    mark(d, tile, code);
  }
}

function spurTile(d: MapDraft, t: TerritoryDef, tile: number, c: Vec): void {
  const where = `${t.id} spur at ${at(c)}`;
  const blocker = landBlocker(d, t, tile, c) ?? builtBlocker(d, tile, c);
  if (blocker) throw new Error(`${where} ${blocker}`);
  if (d.built[tile] === BUILT_SCRUB) d.built[tile] = BUILT_NONE;
}

function landBlocker(d: MapDraft, t: TerritoryDef, tile: number, c: Vec): string | null {
  if (steep(d, tile)) return 'runs over a cliff';
  if (onNewRoad(c, REGION.obstacles.roadClearance)) return 'runs onto a region road';
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id !== t.id && siteGap(s, c) < 0);
  return site ? `runs into ${site.id}` : null;
}

function builtBlocker(d: MapDraft, tile: number, c: Vec): string | null {
  const under = d.props.find((p) => dist(p.pos, c) < p.r);
  if (under) return `runs under a ${under.kind} at ${at(under.pos)}`;
  return [BUILT_NONE, BUILT_SCRUB, BUILT_TRACK].includes(d.built[tile]) ? null : `runs over ground marked ${d.built[tile]}`;
}

export function mark(d: MapDraft, tile: number, code: number): void {
  if (d.built[tile] === BUILT_NONE) d.built[tile] = code;
}

export function onNewRoad(pos: Vec, r: number): boolean {
  const reach = REGION.roadWidth / 2 + r;
  return ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach;
}

export function steep(d: MapDraft, tile: number): boolean {
  return tileSteepness(d.heights, d.size, tile) > TERRAIN.drive.maxSlope;
}

export function at(p: Vec): string {
  return `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
}
