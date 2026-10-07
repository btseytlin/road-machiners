// The fortress bake layer: each fortress site's layout pieces from src/sim/fortress.ts as baked props, the pit dug
// inside a curtain, and the rock masses of Nose from src/sim/nose.ts.

import { FORTRESS, FORTRESS_SITES, FORTRESS_STYLES, NOSE_APRON, type FortressStyle } from '../data/fortress';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { along, fortProp, fortressOutline, fortressPieces, pitDepth, type FortressPiece } from '../sim/fortress';
import { boxDistance, propBoxes, propObstacle, type PosedBox } from '../sim/mapgen';
import { noseRocks } from '../sim/nose';
import { sitePads, type Site } from '../sim/sites';
import { dist, segmentDist, type Vec } from '../sim/vec';
import type { BakedProp } from '../sim/terrain';
import { typeCode, type MapDraft } from './bake';

// The last layer: each fortress site's pit, then its pieces as baked props, of the kind that names the site's style
// and the piece. Nose's rock masses come last, and clear every earlier prop they would bury.
export function fortressLayer(d: MapDraft): MapDraft {
  const sites = [...REGION.towns, ...REGION.locations].filter((site) => site.id in FORTRESS_SITES);
  for (const site of sites) if (FORTRESS_SITES[site.id].pit !== undefined) digPit(d, site);
  const props = sites.flatMap((site) => fortressPieces(site).map((piece) => bakedPiece(FORTRESS_SITES[site.id].style, piece)));
  const nose = sites.find((site) => site.id === 'nose');
  if (nose === undefined) throw new Error('Nose is no fortress site, and its rock masses stand in its frame');
  const rocks = noseRocks(nose);
  const rockBoxes = rocks.flatMap((p, k) => propBoxes(propObstacle(p, k)));
  raiseApron(d, nose, rockBoxes, Math.max(...rocks.map((p) => p.r)));
  const clear = d.props.filter((p) => !rockBoxes.some((b) => boxDistance(b, p.pos) < p.r));
  return { ...d, props: [...clear, ...props, ...rocks] };
}

// Raises the ground around Nose's mountain by NOSE_APRON, over the corners within the rock's reach and the apron's
// run of the site, and types the raised tiles as scree, past the hardpan margin of the site.
function raiseApron(d: MapDraft, site: Site, boxes: readonly PosedBox[], reach: number): void {
  const far = reach + NOSE_APRON.run;
  const x0 = Math.max(0, Math.floor(site.pos.x - far));
  const y0 = Math.max(0, Math.floor(site.pos.y - far));
  const box: CornerBox = { x0, y0, w: Math.min(d.size, Math.ceil(site.pos.x + far)) - x0 + 1, h: Math.min(d.size, Math.ceil(site.pos.y + far)) - y0 + 1 };
  const lift = apronLift(site, boxes, far);
  const n = d.size + 1;
  const raised = new Float32Array(box.w * box.h);
  for (let j = 0; j < box.h; j++) {
    for (let i = 0; i < box.w; i++) {
      raised[j * box.w + i] = lift({ x: box.x0 + i, y: box.y0 + j });
      d.heights[(box.y0 + j) * n + box.x0 + i] += raised[j * box.w + i];
    }
  }
  typeApron(d, site, box, raised);
}

// The apron's lift at a height corner: full under the rock, falling over the run, and none within the clearance of a
// road or a pad or inside the site circle.
function apronLift(site: Site, boxes: readonly PosedBox[], far: number): (p: Vec) => number {
  const { height, run, clear, ramp } = NOSE_APRON;
  const roads = REGION.roads.flatMap((road) => road.slice(1).map((b, i) => [road[i], b] as const)).filter(([a, b]) => segmentDist(site.pos, a, b) < far + clear + ramp);
  const pads = sitePads(site);
  const share = (t: number): number => Math.min(1, Math.max(0, t));
  return (p) => {
    if (dist(p, site.pos) <= site.radius) return 0;
    const fromRock = Math.min(...boxes.map((b) => boxDistance(b, p)));
    if (fromRock >= run) return 0;
    const fromRoad = Math.min(...roads.map(([a, b]) => segmentDist(p, a, b) - REGION.roadWidth / 2), ...pads.map((pad) => dist(p, pad) - REGION.sites.pad.width / 2));
    return height * share(1 - fromRock / run) * share((fromRoad - clear) / ramp);
  };
}

// A tile whose four corners the apron lifts becomes scree, past the hardpan margin of the site.
function typeApron(d: MapDraft, site: Site, box: CornerBox, raised: Float32Array): void {
  const scree = typeCode('scree');
  for (let y = 0; y < box.h - 1; y++) {
    for (let x = 0; x < box.w - 1; x++) {
      const k = y * box.w + x;
      const lifted = [raised[k], raised[k + 1], raised[k + box.w], raised[k + box.w + 1]].every((h) => h > 0);
      const onMargin = dist({ x: box.x0 + x + 0.5, y: box.y0 + y + 0.5 }, site.pos) < site.radius + TERRAIN.types.siteMargin;
      if (lifted && !onMargin) d.types[(box.y0 + y) * d.size + box.x0 + x] = scree;
    }
  }
}

// Lowers each height corner inside the curtain by its pit depth, over the outline's bounding box only, then types the
// pit tiles.
function digPit(d: MapDraft, site: Site): void {
  const box = outlineBox(site, d.size);
  const n = d.size + 1;
  const depth = new Float32Array(box.w * box.h);
  for (let j = 0; j < box.h; j++) {
    for (let i = 0; i < box.w; i++) {
      depth[j * box.w + i] = pitDepth(site, { x: box.x0 + i, y: box.y0 + j });
      d.heights[(box.y0 + j) * n + box.x0 + i] -= depth[j * box.w + i];
    }
  }
  typePit(d, box, depth);
}

// The height corners around a site's outline, clamped to the map: the first corner and the corner counts.
type CornerBox = { x0: number; y0: number; w: number; h: number };

function outlineBox(site: Site, size: number): CornerBox {
  const outline = fortressOutline(site);
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  return { x0, y0, w: Math.min(size, Math.ceil(Math.max(...xs))) - x0 + 1, h: Math.min(size, Math.ceil(Math.max(...ys))) - y0 + 1 };
}

// A pit tile whose four corners share one depth is a terrace or the floor, and becomes field. Any other pit tile is a
// riser, and becomes scree. Tiles with no corner below the rim keep their type.
function typePit(d: MapDraft, box: CornerBox, depth: Float32Array): void {
  const field = typeCode('field');
  const scree = typeCode('scree');
  for (let y = 0; y < box.h - 1; y++) {
    for (let x = 0; x < box.w - 1; x++) {
      const k = y * box.w + x;
      const corners = [depth[k], depth[k + 1], depth[k + box.w], depth[k + box.w + 1]];
      if (corners.some((c) => c > 0)) d.types[(box.y0 + y) * d.size + box.x0 + x] = corners.every((c) => c === corners[0]) ? field : scree;
    }
  }
}

// A piece's prop. The gate model faces +x with its origin on the outer face, the inner gate and the bastion also
// run along +x across the curtain, and the layout's yaw runs along the wall.
function bakedPiece(style: FortressStyle, piece: FortressPiece): BakedProp {
  const base = { kind: fortProp(style, piece.kind), r: piece.r, group: 0, step: 0 };
  if (piece.kind === 'gate') {
    const yaw = piece.yaw - Math.PI / 2;
    const { gate, gateFlare } = FORTRESS_STYLES[style];
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, gate.depth / 2 - gateFlare), yaw };
  }
  if (piece.kind === 'bastion') {
    const yaw = piece.yaw - Math.PI / 2;
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, -FORTRESS.bastionBack), yaw };
  }
  if (piece.kind === 'inner') return { ...base, pos: piece.pos, yaw: piece.yaw - Math.PI / 2 };
  return { ...base, pos: piece.pos, yaw: piece.yaw };
}
