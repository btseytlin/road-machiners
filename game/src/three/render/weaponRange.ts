// Gun reach on the ground: the selected gun's, and the firing arcs of the hovered truck. A turret with every side open covers a circle. A forward arc or the shadows of tall parts on the truck cut it to sectors. Draped over the terrain, level with a deck beside it where the truck is nearer the deck than the ground and both lie within sight of its sides (markHeightAt).

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { PHYSICS } from '../../data/physics';
import { headingOf, toMap, type VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { FireSpan } from '../../sim/armor';
import { fireBlock } from '../../sim/combat';
import { vehicleStats, type MountedWeapon } from '../../sim/stats';
import { markHeightAt, type Terrain } from '../../sim/terrain';
import type { Vehicle, World } from '../../sim/types';
import { DEG, type Vec } from '../../sim/vec';
import { createIcon } from '../../ui/cards';
import { el } from '../../ui/dom';
import type { CameraRig } from './camera';
import { READY_ARC_BIT, SPENT_ARC_BIT } from './models';
import { num } from '../../text/msg';

const S = PHYSICS.metersPerTile;
const ICON_PX = 26;
const LIFT = 0.15;
const DEG_PER_STEP = 5;
const LINE_WIDTH_PX = 2;
const FILL_ALPHA = 0.075;
const LINE_ALPHA = 0.075;
const ICON_ALPHA = 0.5;

export class WeaponRangeView {
  readonly root = new THREE.Group();
  private fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private edges: Line2[] = [];

  constructor(private readonly color: number, stencilBit: number) {
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: FILL_ALPHA, depthTest: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: stencilBit, stencilFuncMask: stencilBit, stencilWriteMask: stencilBit,
      stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }));
    this.fill.renderOrder = 810;
    this.root.add(this.fill);
    this.root.visible = false;
  }

  set(terrain: Terrain, pos: Vec, heading: number, weapons: MountedWeapon[]): void {
    this.draw(terrain, pos, heading, weapons.map((w) => ({ range: w.def.range, spans: w.spans })));
  }

  hide(): void {
    this.root.visible = false;
  }

  private draw(terrain: Terrain, pos: Vec, heading: number, reaches: { range: number; spans: FireSpan[] }[]): void {
    this.root.visible = reaches.length > 0;
    const at = (x: number, y: number) => new THREE.Vector3(x * S, markHeightAt(terrain, pos, x, y) * S + LIFT, y * S);
    const center = at(pos.x, pos.y);
    const points: THREE.Vector3[] = [center];
    const idx: number[] = [];
    const outlines = reaches.flatMap(({ range, spans }) =>
      spans.map((span) => {
        const rim = rimPoints(span, heading, (a) => at(pos.x + Math.cos(a) * range, pos.y + Math.sin(a) * range));
        const first = points.length;
        points.push(...rim);
        for (let i = 0; i < rim.length - 1; i++) idx.push(0, first + i, first + i + 1);
        return span.to - span.from >= 360 ? rim : [center, ...rim, center];
      }),
    );
    this.fill.geometry.dispose();
    this.fill.geometry = new THREE.BufferGeometry().setFromPoints(points).setIndex(idx);
    this.fill.material.opacity = FILL_ALPHA;
    this.drawEdges(outlines, LINE_ALPHA);
  }

  private drawEdges(outlines: THREE.Vector3[][], opacity: number): void {
    while (this.edges.length < outlines.length) {
      const edge = new Line2(new LineGeometry(), new LineMaterial({ color: this.color, linewidth: LINE_WIDTH_PX, transparent: true, opacity: LINE_ALPHA, depthTest: false }));
      edge.renderOrder = 811;
      this.edges.push(edge);
      this.root.add(edge);
    }
    this.edges.forEach((edge, i) => {
      const outline = outlines[i];
      edge.visible = outline !== undefined;
      if (!outline) return;
      edge.geometry.dispose();
      edge.geometry = new LineGeometry().setPositions(outline.flatMap((p) => [p.x, p.y, p.z]));
      edge.material.resolution.set(window.innerWidth, window.innerHeight);
      edge.material.opacity = opacity;
    });
  }
}

function rimPoints(span: FireSpan, heading: number, point: (angle: number) => THREE.Vector3): THREE.Vector3[] {
  const steps = Math.max(1, Math.ceil((span.to - span.from) / DEG_PER_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => point(heading + (span.from + ((span.to - span.from) * i) / steps) * DEG));
}


export type IconSpot = { angle: number; distance: number };
export type HoverArc = { weapon: MountedWeapon; slot: number; spans: FireSpan[]; spent: boolean; spot: IconSpot };

const ICON_RANGE_SHARE = 0.5;
const ICON_NUDGE_SHARE = 0.15;
const SAME_SPOT_TILES = 1.5;

export function iconSpot(spans: readonly FireSpan[], range: number, taken: readonly IconSpot[]): IconSpot {
  const widest = spans.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  const angle = (widest.from + widest.to) / 2;
  let distance = range * ICON_RANGE_SHARE;
  while (taken.some((t) => Math.hypot(t.distance * Math.cos(t.angle * DEG) - distance * Math.cos(angle * DEG), t.distance * Math.sin(t.angle * DEG) - distance * Math.sin(angle * DEG)) < SAME_SPOT_TILES)) {
    distance += range * ICON_NUDGE_SHARE;
  }
  return { angle, distance };
}

export function hoverArcs(world: World, vehicle: Vehicle, weapons: readonly MountedWeapon[]): HoverArc[] {
  const arcs: HoverArc[] = [];
  for (const [i, weapon] of weapons.entries()) {
    const block = fireBlock(world, vehicle, weapon, null);
    const { spans } = weapon;
    if (block === 'disabled' || spans.length === 0) continue;
    const spot = iconSpot(spans, weapon.def.range, arcs.map((arc) => arc.spot));
    arcs.push({ weapon, slot: i + 1, spans, spent: block === 'empty' || block === 'cooldown', spot });
  }
  return arcs;
}

export class HoverArcsView {
  readonly root = new THREE.Group();
  private readonly ready = new WeaponRangeView(PAL.select, READY_ARC_BIT);
  private readonly spent = new WeaponRangeView(PAL.arcSpent, SPENT_ARC_BIT);
  private readonly icons = new Map<string, HTMLElement>();

  constructor(private readonly overlay: HTMLElement, private readonly rig: CameraRig) {
    this.root.add(this.ready.root, this.spent.root);
    this.hide();
  }

  follow(world: World, hovered: string | null, frames: Record<string, VehicleFrame>, off: boolean): void {
    const vehicle = hovered === null ? undefined : world.vehicles.find((v) => v.id === hovered);
    const frame = vehicle && frames[vehicle.id];
    if (off || !vehicle || !frame) return this.hide();
    this.update(world.terrain, hoverArcs(world, vehicle, vehicleStats(world, vehicle).weapons), frame);
  }

  private update(terrain: Terrain, arcs: HoverArc[], frame: VehicleFrame): void {
    const pos = toMap(frame.pos);
    const heading = headingOf(frame.rot);
    this.ready.set(terrain, pos, heading, arcs.filter((a) => !a.spent).map((a) => a.weapon));
    this.spent.set(terrain, pos, heading, arcs.filter((a) => a.spent).map((a) => a.weapon));
    this.root.visible = true;
    this.syncIcons(arcs);
    for (const arc of arcs) {
      const a = heading + arc.spot.angle * DEG;
      const x = pos.x + Math.cos(a) * arc.spot.distance;
      const y = pos.y + Math.sin(a) * arc.spot.distance;
      const p = this.rig.screenOf({ x: x * S, y: markHeightAt(terrain, pos, x, y) * S, z: y * S });
      const node = this.icons.get(arc.weapon.part.id)!;
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.classList.toggle('spent', arc.spent);
    }
  }

  hide(): void {
    this.root.visible = false;
    for (const node of this.icons.values()) node.remove();
    this.icons.clear();
  }

  private syncIcons(arcs: HoverArc[]): void {
    const ids = new Set(arcs.map((a) => a.weapon.part.id));
    for (const [id, node] of this.icons) {
      if (ids.has(id)) continue;
      node.remove();
      this.icons.delete(id);
    }
    for (const arc of arcs) {
      const id = arc.weapon.part.id;
      if (this.icons.has(id)) continue;
      const number = el('span', { class: 'arc-icon-slot' }, num(arc.slot, 'int'));
      const node = el('div', { class: 'arc-icon' }, createIcon(arc.weapon.def.look), number);
      node.style.width = `${ICON_PX}px`;
      node.style.height = `${ICON_PX}px`;
      node.style.opacity = `${ICON_ALPHA}`;
      this.overlay.appendChild(node);
      this.icons.set(id, node);
    }
  }
}
