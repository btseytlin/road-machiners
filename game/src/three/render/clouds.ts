import * as THREE from 'three';
import type { World } from '../../sim/types';
import { DustCloudsView } from './dust';
import { HazardViews, type TurnClock } from './hazards';
import type { FxCards } from './particles/cards';
import type { VehicleView } from './vehicle';

export class CloudViews {
  private readonly dust = new DustCloudsView();
  private readonly hazards = new HazardViews();
  readonly root = new THREE.Group();

  constructor() {
    this.root.add(this.dust.root, this.hazards.root);
  }

  update(world: World, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null, camera: THREE.Camera, cards: FxCards): void {
    this.dust.update(world, world.terrain, nowMs);
    this.hazards.update(world, world.terrain, views, nowMs, clock, camera);
    this.dust.draw(cards);
    this.hazards.draw(cards);
  }
}
