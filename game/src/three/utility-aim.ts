// Aiming a utility that waits for a ground point: the selected point utility, the click that gives its order, and the
// ground marks that show where it can reach. It shows its range ring around the truck and a marker of its effect's
// size under the pointer, red where the point is out of range. Every point order set this turn keeps a small cross.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { partDef } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { groundPoint } from '../phys/frames';
import { PAL } from '../render/palette';
import { playerVehicle } from '../sim/damage';
import type { Terrain } from '../sim/terrain';
import type { PartInstance, UtilityOrder, Vehicle, World } from '../sim/types';
import { chargedParts, orderKindOf, pointBlock, pointReach, utilityOrderError } from '../sim/utility';
import type { Vec } from '../sim/vec';
import { setUtilityOrder } from '../sim/world';
import { refusalText } from '../text/names';
import type { Msg } from '../text/msg';
import { aimBlock } from '../ui/weapons';
import { GroundBand } from './render/zones';

const LOOK = {
  ring: { width: 0.1, opacity: 0.8 },
  reach: 0.08,
  marker: { width: 0.12, opacity: 0.9, dot: 0.35 },
  cross: { arm: 0.45, width: 0.1, lift: 0.05 },
  renderOrder: 812,
};

export type UtilityAimHost = {
  world(): World;
  apply(next: World): void;
  note(text: Msg): void;
};

export class UtilityAim {
  readonly root = new THREE.Group();
  private selected: string | null = null;
  private readonly reach = band(LOOK.reach);
  private readonly inner = band(LOOK.ring.opacity);
  private readonly outer = band(LOOK.ring.opacity);
  private readonly hover = new Marker(this.root);
  private readonly set: THREE.Mesh[] = [];

  constructor(private readonly host: UtilityAimHost) {
    for (const b of [this.reach, this.inner, this.outer]) this.root.add(b.mesh);
  }

  get selectedId(): string | null {
    return this.selected;
  }

  select(id: string | null): void {
    this.selected = id;
  }

  private selectedPart(w: World): PartInstance | null {
    const part = chargedParts(playerVehicle(w)).find((p) => p.id === this.selected);
    const aiming = part && aimBlock(w, part) === null ? part : null;
    if (!aiming) this.selected = null;
    return aiming;
  }

  click(ground: Vec | null): boolean {
    const part = this.selectedPart(this.host.world());
    if (!part || orderKindOf(part) !== 'point' || !ground) return false;
    this.order(part, { kind: 'point', pos: ground });
    return true;
  }

  private order(part: PartInstance, order: UtilityOrder): void {
    const w = this.host.world();
    const error = utilityOrderError(w, playerVehicle(w), part.id, order);
    if (error) return this.host.note(refusalText(w, error));
    this.selected = null;
    this.host.apply(setUtilityOrder(w, part.id, order));
  }

  draw(w: World, terrain: Terrain, hoverGround: Vec | null, hide: boolean): void {
    this.root.visible = !hide;
    if (hide) return;
    const me = playerVehicle(w);
    const part = this.selectedPart(w);
    this.drawReach(terrain, me, part && orderKindOf(part) === 'point' ? part : null, hoverGround);
    this.drawSet(terrain, me);
  }

  private drawReach(terrain: Terrain, me: Vehicle, part: PartInstance | null, hoverGround: Vec | null): void {
    if (!part) for (const b of [this.reach, this.inner, this.outer, this.hover]) b.hide();
    else this.drawPointReach(terrain, me, part, hoverGround);
  }

  private drawPointReach(terrain: Terrain, me: Vehicle, part: PartInstance, hoverGround: Vec | null): void {
    const { minRange, maxRange } = pointReach(part);
    this.reach.set(terrain, me.pos, minRange, maxRange);
    this.inner.set(terrain, me.pos, minRange - LOOK.ring.width, minRange);
    this.outer.set(terrain, me.pos, maxRange, maxRange + LOOK.ring.width);
    if (!hoverGround) return this.hover.hide();
    this.hover.place(terrain, hoverGround, effectRadius(part), pointBlock(me, part, hoverGround) ? PAL.dest : PAL.select);
  }

  private drawSet(terrain: Terrain, me: Vehicle): void {
    const points = chargedParts(me).flatMap((part) => {
      const order = me.utilityOrders[part.id];
      return order?.kind === 'point' ? [order.pos] : [];
    });
    while (this.set.length < points.length) {
      const mark = cross();
      this.root.add(mark);
      this.set.push(mark);
    }
    this.set.forEach((mark, i) => placeCross(mark, terrain, points[i]));
  }
}

function placeCross(mark: THREE.Mesh, terrain: Terrain, at: Vec | undefined): void {
  mark.visible = at !== undefined;
  if (!at) return;
  const p = groundPoint(terrain, at);
  mark.position.set(p.x, p.y + LOOK.cross.lift * PHYSICS.metersPerTile, p.z);
}

function cross(): THREE.Mesh {
  const S = PHYSICS.metersPerTile;
  const span = LOOK.cross.arm * 2 * S;
  const width = LOOK.cross.width * S;
  const geometry = mergeGeometries([new THREE.PlaneGeometry(span, width), new THREE.PlaneGeometry(width, span)]).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: PAL.select, transparent: true, opacity: LOOK.marker.opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = LOOK.renderOrder;
  return mesh;
}

function effectRadius(part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || !('radius' in def.effect)) throw new Error(`${def.id} covers no radius`);
  return def.effect.radius;
}

function band(opacity: number): GroundBand {
  return new GroundBand({ color: PAL.select, opacity, renderOrder: LOOK.renderOrder, overTrucks: true });
}

class Marker {
  private readonly edge = band(LOOK.marker.opacity);
  private readonly dot = band(LOOK.marker.opacity);

  constructor(root: THREE.Group) {
    root.add(this.edge.mesh, this.dot.mesh);
  }

  place(terrain: Terrain, at: Vec, r: number, color: number): void {
    this.edge.set(terrain, at, r - LOOK.marker.width, r);
    this.dot.set(terrain, at, 0, LOOK.marker.dot);
    this.edge.color(color);
    this.dot.color(color);
  }

  hide(): void {
    this.edge.hide();
    this.dot.hide();
  }
}
