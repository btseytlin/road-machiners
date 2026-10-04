// Aiming a utility that waits for a target: the selected truck or point utility, the click that gives its order, and
// the ground marks that show where it can reach. A point utility shows its range ring around the truck and a marker
// of its effect's size under the pointer, red where the point is out of range. Every point order set this turn keeps
// a small cross. A truck utility, the harpoon, shows its arc and range as a selected gun does, stays selected after
// its order like a gun, and a second click on its target clears the order. Rules stay in src/sim/utility.ts; this
// file only turns clicks into orders.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { partDef, type UtilityDef } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { groundPoint } from '../phys/frames';
import { PAL } from '../render/palette';
import { openSides } from '../sim/armor';
import { playerVehicle } from '../sim/damage';
import { mountedItems } from '../sim/grid';
import type { Terrain } from '../sim/terrain';
import type { Aim, PartInstance, UtilityOrder, Vehicle, World } from '../sim/types';
import { chargedParts, orderKindOf, pointBlock, pointReach, utilityOrderError } from '../sim/utility';
import type { Vec } from '../sim/vec';
import { wornDef } from '../sim/wear';
import { setUtilityOrder } from '../sim/world';
import { aimBlock } from '../ui/weapons';
import { READY_ARC_BIT } from './render/models';
import { WeaponRangeView, type MountPose } from './render/weaponRange';
import { GroundBand } from './render/zones';

const LOOK = {
  ring: { width: 0.1, opacity: 0.8 }, // the range edges, in tiles
  reach: 0.08, // opacity of the ground the point may go to
  marker: { width: 0.12, opacity: 0.9, dot: 0.35 }, // the effect's edge and its center dot, in tiles
  cross: { arm: 0.45, width: 0.1, lift: 0.05 }, // a set point's cross: half its span and its bar width, in tiles
  renderOrder: 812,
};

export type UtilityAimHost = {
  world(): World;
  apply(next: World): void;
  note(text: string): void; // a refused order, shown to the player
};

export class UtilityAim {
  readonly root = new THREE.Group();
  private selected: string | null = null;
  private readonly reach = band(LOOK.reach);
  private readonly inner = band(LOOK.ring.opacity);
  private readonly outer = band(LOOK.ring.opacity);
  private readonly hover = new Marker(this.root);
  private readonly set: THREE.Mesh[] = [];
  private readonly arc = new WeaponRangeView(PAL.select, READY_ARC_BIT);

  constructor(private readonly host: UtilityAimHost) {
    for (const b of [this.reach, this.inner, this.outer]) this.root.add(b.mesh);
    this.root.add(this.arc.root);
  }

  get selectedId(): string | null {
    return this.selected;
  }

  select(id: string | null): void {
    this.selected = id;
  }

  // Whether the selected utility waits for a truck click, so the hovered truck takes the aiming cursor.
  private aimsTruck(w: World): boolean {
    const part = this.selectedPart(w);
    return part !== null && orderKindOf(part) === 'truck';
  }

  // The selected part while it can still aim, or null. A part that left the truck or cannot aim (aimBlock) drops it.
  private selectedPart(w: World): PartInstance | null {
    const part = chargedParts(playerVehicle(w)).find((p) => p.id === this.selected);
    const aiming = part && aimBlock(w, part) === null ? part : null;
    if (!aiming) this.selected = null;
    return aiming;
  }

  // A left click while a utility waits for its target. picked: the truck under the pointer, other than the player's.
  // A click on the truck the order already aims at clears it. Returns false when the click is not for the utility,
  // so it orders the truck as usual.
  click(picked: Vehicle | null, ground: Vec | null): boolean {
    const w = this.host.world();
    const part = this.selectedPart(w);
    if (!part) return false;
    const order = orderFor(orderKindOf(part), picked, ground);
    if (!order) return false;
    if (sameTarget(playerVehicle(w).utilityOrders[part.id], order)) this.host.apply(setUtilityOrder(w, part.id, null));
    else this.order(part, order);
    return true;
  }

  // Gives the canvas the crosshair cursor while the pointer is on a truck the selected truck utility can aim at.
  cursor(canvas: HTMLElement, onTruck: boolean): void {
    canvas.classList.toggle('aim-truck', onTruck && this.aimsTruck(this.host.world()));
  }

  // A part click in the hover panel aims a selected truck utility at that part. False when none waits.
  aimPart(target: Vehicle, aim: Aim): boolean {
    const part = this.selectedPart(this.host.world());
    if (!part || orderKindOf(part) !== 'truck') return false;
    this.order(part, { kind: 'truck', targetId: target.id, aim });
    return true;
  }

  // A truck order keeps the selection, as a gun keeps it after a target click. A point order drops it.
  private order(part: PartInstance, order: UtilityOrder): void {
    const w = this.host.world();
    const error = utilityOrderError(w, playerVehicle(w), part.id, order);
    if (error) return this.host.note(error);
    if (order.kind === 'point') this.selected = null;
    this.host.apply(setUtilityOrder(w, part.id, order));
  }

  // hoverGround: the ground point under the pointer, or null. hide: nothing shows, as while a turn plays.
  draw(w: World, terrain: Terrain, hoverGround: Vec | null, hide: boolean): void {
    this.root.visible = !hide;
    if (hide) return;
    const me = playerVehicle(w);
    const part = this.selectedPart(w);
    const kind = part && orderKindOf(part);
    this.drawReach(terrain, me, kind === 'point' ? part : null, hoverGround);
    this.drawArc(terrain, me, kind === 'truck' ? part : null);
    this.drawSet(terrain, me);
  }

  // The arc and range of the selected truck utility, drawn as a selected gun's, or none.
  private drawArc(terrain: Terrain, me: Vehicle, part: PartInstance | null): void {
    if (part) this.arc.showReach(terrain, mountPose(me, part), shotOf(part));
    else this.arc.hide();
  }

  // The reach band and range rings of the selected point utility, and its effect under the pointer, or none.
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

  // A small cross on each point order set this turn.
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

// Where the harpoon sits on the truck: the truck's pose and the sides its mount can fire to.
function mountPose(me: Vehicle, part: PartInstance): MountPose {
  const item = mountedItems(me).find((it) => it.part.id === part.id);
  if (!item) throw new Error(`${me.name} has no mounted part ${part.id}`);
  return { pos: me.pos, heading: me.heading, sides: openSides(me, item) };
}

// The range and arc of the part's shot. Throws for a part that fires none.
function shotOf(part: PartInstance): { range: number; arc: number } {
  const shot = wornDef<UtilityDef>(part).shot;
  if (!shot) throw new Error(`${partDef(part.defId).name} fires no shot`);
  return { range: shot.range, arc: shot.arc };
}

// Puts the cross on the ground at the point, or hides it without one.
function placeCross(mark: THREE.Mesh, terrain: Terrain, at: Vec | undefined): void {
  mark.visible = at !== undefined;
  if (!at) return;
  const p = groundPoint(terrain, at);
  mark.position.set(p.x, p.y + LOOK.cross.lift * PHYSICS.metersPerTile, p.z);
}

// A flat plus of two bars, in meters, drawn over trucks like the other aim marks.
function cross(): THREE.Mesh {
  const S = PHYSICS.metersPerTile;
  const span = LOOK.cross.arm * 2 * S;
  const width = LOOK.cross.width * S;
  const geometry = mergeGeometries([new THREE.PlaneGeometry(span, width), new THREE.PlaneGeometry(width, span)]).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: PAL.select, transparent: true, opacity: LOOK.marker.opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = LOOK.renderOrder;
  return mesh;
}

// Whether the set order is a truck order at the clicked order's truck.
function sameTarget(set: UtilityOrder | undefined, order: UtilityOrder): boolean {
  return set?.kind === 'truck' && order.kind === 'truck' && set.targetId === order.targetId;
}

function orderFor(kind: UtilityOrder['kind'] | null, picked: Vehicle | null, ground: Vec | null): UtilityOrder | null {
  if (kind === 'truck' && picked) return { kind: 'truck', targetId: picked.id, aim: 'body' };
  if (kind === 'point' && ground) return { kind: 'point', pos: ground };
  return null;
}

// The radius in tiles the utility's effect covers around its point.
function effectRadius(part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || !('radius' in def.effect)) throw new Error(`${def.name} covers no radius`);
  return def.effect.radius;
}

function band(opacity: number): GroundBand {
  return new GroundBand({ color: PAL.select, opacity, renderOrder: LOOK.renderOrder, overTrucks: true });
}

// The edge of an effect's circle and a dot at its center.
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
