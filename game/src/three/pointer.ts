import { playerVehicle, vehicleById } from '../sim/damage';
import type { Vehicle, World } from '../sim/types';
import { isAtRest } from '../sim/world';
import type * as THREE from 'three';
import type { VehicleView } from './render/vehicle';

// The one decision behind the stop click, the stop cue and the ground highlight.
// The player's own truck is picked by its drawn shape (a ray hit), not by the screen radius around its centre.

export type PointerAction = { kind: 'stop' } | { kind: 'own' } | { kind: 'vehicle'; id: string } | { kind: 'ground' };

export type PointerHits = {
  own: number | null; // ray distance to the player truck's model
  nearestNpc: { id: string; distance: number } | null; // nearest visible NPC model on the same ray
  radiusPick: string | null; // vehicle picked by the screen radius
  playerId: string;
  atRest: boolean;
};

function ownTruckAction(h: PointerHits, own: number): PointerAction {
  if (h.nearestNpc !== null && h.nearestNpc.distance < own) return { kind: 'vehicle', id: h.nearestNpc.id };
  return h.atRest ? { kind: 'own' } : { kind: 'stop' };
}

export function resolvePointer(h: PointerHits): PointerAction {
  if (h.own !== null) return ownTruckAction(h, h.own);
  if (h.radiusPick !== null && h.radiusPick !== h.playerId) return { kind: 'vehicle', id: h.radiusPick };
  return { kind: 'ground' };
}

type PickerDeps = {
  world: () => World;
  hit: (x: number, y: number, object: THREE.Object3D | null) => number | null;
  views: Map<string, VehicleView>;
  visible: (v: Vehicle) => boolean;
  radiusPick: (x: number, y: number) => string | null;
};

// Collects the hits under a screen point for resolvePointer() and keeps the stop cursor's state.
export class PointerPicker {
  stopCue = false; // the pointer cursor shows over the player truck
  private at: { x: number; y: number } | null = null; // last pointer position over the canvas

  constructor(private readonly deps: PickerDeps) {}

  moveTo(p: { clientX: number; clientY: number } | null): void {
    this.at = p && { x: p.clientX, y: p.clientY };
  }

  // What a click at this screen point does. The click, the stop sign and the ground highlight all ask here.
  action(x: number, y: number): PointerAction {
    return this.resolve(x, y, true);
  }

  // The radius pick only matters off the truck's shape, so the per-frame checks skip it.
  private resolve(x: number, y: number, withRadius: boolean): PointerAction {
    const me = playerVehicle(this.deps.world());
    const own = this.deps.hit(x, y, this.deps.views.get(me.id)?.root ?? null);
    return resolvePointer({
      own,
      nearestNpc: own === null ? null : this.nearestNpc(x, y, me.id),
      radiusPick: withRadius ? this.deps.radiusPick(x, y) : null,
      playerId: me.id,
      atRest: isAtRest(me),
    });
  }

  // True over the player truck's drawn shape, where the ground highlight stays hidden.
  overOwn(x: number, y: number): boolean {
    const kind = this.resolve(x, y, false).kind;
    return kind === 'stop' || kind === 'own';
  }

  // Shows the cursor exactly when a click at the pointer would stop the truck. True when the cue flipped.
  updateCue(canClick: boolean): boolean {
    const cue = this.at !== null && canClick && !isAtRest(playerVehicle(this.deps.world())) && this.resolve(this.at.x, this.at.y, false).kind === 'stop';
    const flipped = cue !== this.stopCue;
    this.stopCue = cue;
    return flipped;
  }

  // The visible NPC whose drawn model is nearest the camera along the pointer ray.
  private nearestNpc(x: number, y: number, playerId: string): { id: string; distance: number } | null {
    let nearest: { id: string; distance: number } | null = null;
    for (const [id, view] of this.deps.views) {
      const distance = this.npcDistance(x, y, id, view, playerId);
      if (distance !== null && (nearest === null || distance < nearest.distance)) nearest = { id, distance };
    }
    return nearest;
  }

  private npcDistance(x: number, y: number, id: string, view: VehicleView, playerId: string): number | null {
    if (id === playerId || !this.deps.visible(vehicleById(this.deps.world(), id))) return null;
    return this.deps.hit(x, y, view.root);
  }
}
