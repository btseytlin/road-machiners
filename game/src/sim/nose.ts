// Nose's ship frame and its rock masses. The colony ship came down on a mountain, and the town's ring was built up to
// its flanks. The mountain is two baked props, nose_rise and nose_crag, that block trucks and sight by their boxes like
// any rock. Both models and the ship are authored in one frame, derived from the gates, so it follows them wherever
// the site's turn puts them. Map tiles throughout.

import { PHYSICS } from '../data/physics';
import { fortressGates, type FortGate } from './fortress';
import { propShape } from './mapgen';
import type { Site } from './sites';
import type { BakedProp, PropKind } from './terrain';
import type { Vec } from './vec';

// u runs along the ship toward its nose and v back, away from the south gate, both unit vectors in map tiles. yaw is
// the map bearing of u, the turn of a model whose +x runs along u and whose +y looks to the south gate.
export type NoseFrame = { u: Vec; v: Vec; yaw: number; south: FortGate; wnw: FortGate };

const ROCKS = { noseRise: 'nose_rise', noseCrag: 'nose_crag' } as const satisfies Partial<Record<PropKind, string>>;

export function noseFrame(site: Site): NoseFrame {
  const gates = fortressGates(site);
  if (gates.length !== 2) throw new Error(`Nose has ${gates.length} gates, and its frame is laid out for two`);
  const [south, wnw] = gates[0].out.y > gates[1].out.y ? gates : [gates[1], gates[0]];
  const g = south.out;
  return { u: { x: -g.y, y: g.x }, v: { x: -g.x, y: -g.y }, yaw: Math.atan2(g.x, -g.y), south, wnw };
}

// The rock masses at the site center, turned to the frame. r is the reach of each one's boxes.
export function noseRocks(site: Site): BakedProp[] {
  const { yaw } = noseFrame(site);
  return (Object.keys(ROCKS) as (keyof typeof ROCKS)[]).map((kind) => ({ kind, pos: { ...site.pos }, r: boxReach(ROCKS[kind]), yaw, group: 0, step: 0 }));
}

// Tiles from the model origin to the farthest box corner.
function boxReach(model: string): number {
  const far = Math.max(...propShape(model).flatMap((b) => [Math.hypot(b.x0, b.y0), Math.hypot(b.x0, b.y1), Math.hypot(b.x1, b.y0), Math.hypot(b.x1, b.y1)]));
  return far / PHYSICS.metersPerTile;
}
