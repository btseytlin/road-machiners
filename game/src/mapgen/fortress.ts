// The fortress bake layer: each fortress site's layout pieces from src/sim/fortress.ts as baked props, the pit dug
// inside a curtain, and the rock masses of Nose from src/sim/nose.ts.

import { FORTRESS, FORTRESS_SITES, FORTRESS_STYLES, type FortressStyle } from '../data/fortress';
import { REGION } from '../data/region';
import { along, fortProp, fortressOutline, fortressPieces, pitDepth, type FortressPiece } from '../sim/fortress';
import { boxDistance, propBoxes, propObstacle } from '../sim/mapgen';
import { noseRocks } from '../sim/nose';
import type { Site } from '../sim/sites';
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
  const clear = d.props.filter((p) => !rockBoxes.some((b) => boxDistance(b, p.pos) < p.r));
  return { ...d, props: [...clear, ...props, ...rocks] };
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
