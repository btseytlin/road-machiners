// The fortress bake layer: each fortress site's layout pieces from src/sim/fortress.ts as baked props.

import { FORTRESS, FORTRESS_SITES, type FortressStyle } from '../data/fortress';
import { REGION } from '../data/region';
import { along, FORT_PROPS, fortressPieces, type FortressPiece } from '../sim/fortress';
import type { BakedProp } from '../sim/terrain';
import type { MapDraft } from './bake';

// The last layer: each fortress site's pieces as baked props, of the kind that names the site's style and the piece.
export function fortressLayer(d: MapDraft): MapDraft {
  const sites = [...REGION.towns, ...REGION.locations];
  const props = sites.flatMap((site) => (site.id in FORTRESS_SITES ? fortressPieces(site).map((piece) => bakedPiece(FORTRESS_SITES[site.id].style, piece)) : []));
  return { ...d, props: [...d.props, ...props] };
}

// A piece's prop. The gate model faces +x with its origin on the outer face, the inner gate and the bastion also
// run along +x across the curtain, and the layout's yaw runs along the wall.
function bakedPiece(style: FortressStyle, piece: FortressPiece): BakedProp {
  const base = { kind: FORT_PROPS[style][piece.kind], r: piece.r, group: 0, step: 0 };
  if (piece.kind === 'gate') {
    const yaw = piece.yaw - Math.PI / 2;
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, FORTRESS.gate.depth / 2 - FORTRESS.gateFlare), yaw };
  }
  if (piece.kind === 'bastion') {
    const yaw = piece.yaw - Math.PI / 2;
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, -FORTRESS.bastionBack), yaw };
  }
  if (piece.kind === 'inner') return { ...base, pos: piece.pos, yaw: piece.yaw - Math.PI / 2 };
  return { ...base, pos: piece.pos, yaw: piece.yaw };
}
