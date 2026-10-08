import { playerVehicle, vehicleById } from '../sim/damage';
import type { Vehicle, World } from '../sim/types';
import { isAtRest } from '../sim/world';
import type * as THREE from 'three';
import type { VehicleView } from './render/vehicle';

export type PointerAction = { kind: 'stop' } | { kind: 'own' } | { kind: 'vehicle'; id: string } | { kind: 'ground' };

export type PointerHits = {
  own: number | null;
  nearestNpc: { id: string; distance: number } | null;
  radiusPick: string | null;
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

export class PointerPicker {
  stopCue = false;
  private at: { x: number; y: number } | null = null;

  constructor(private readonly deps: PickerDeps) {}

  moveTo(p: { clientX: number; clientY: number } | null): void {
    this.at = p && { x: p.clientX, y: p.clientY };
  }

  action(x: number, y: number): PointerAction {
    return this.resolve(x, y, true);
  }

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

  overOwn(x: number, y: number): boolean {
    const kind = this.resolve(x, y, false).kind;
    return kind === 'stop' || kind === 'own';
  }

  updateCue(canClick: boolean): boolean {
    const cue = this.at !== null && canClick && !isAtRest(playerVehicle(this.deps.world())) && this.resolve(this.at.x, this.at.y, false).kind === 'stop';
    const flipped = cue !== this.stopCue;
    this.stopCue = cue;
    return flipped;
  }

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
