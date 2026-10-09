// Multi-turn plan preview: thick lines lying on the ground, first turn in the caller's color, later turns
// fainter in PAL.plan, with a marker at each turn's end. A thin faint line continues along the rest of
// the course to its point. Depth-tested, so trucks drive over them.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { VehicleFrame } from '../../phys/frames';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { MoveOrder, World } from '../../sim/types';
import { bearing, type Vec } from '../../sim/vec';
import { playerVehicle } from '../../sim/damage';
import { playerCanAct } from '../../sim/world';

const S = PHYSICS.metersPerTile;

const LINE_WIDTH_PX = 4;
const LIFT = 0.12;
const COURSE_WIDTH_PX = 2;
const OPACITY = { first: 0.75, later: 0.35, course: 0.3 };
const COURSE_STEP = 0.5;
const MARKER_OUTER = 1.2;
const MARKER_INNER = 0.8;
const ORDER_R = 1.5;
const ORDER_LIFT = LIFT + 0.02;
const ORDER_OPACITY = 0.85;
const ORDER_RING_INNER = 0.85;
const ORDER_SIGN = 0.55;
const SLOPE_STEP = 0.25;
const UP = new THREE.Vector3(0, 1, 0);

function arrowShape(): THREE.Shape {
  const k = ORDER_SIGN * ORDER_R;
  const pts: [number, number][] = [[1, 0], [-0.2, 0.9], [-0.6, 0.9], [0.45, 0], [-0.6, -0.9], [-0.2, -0.9]];
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * k, y * k)));
}

function flatIcon(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry.rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ORDER_OPACITY, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 821;
  return mesh;
}

function waypointOf(world: World): Exclude<MoveOrder, { kind: 'brake' }> | null {
  const me = playerVehicle(world);
  if (me.direct || !playerCanAct(world) || !me.order || me.order.kind === 'brake') return null;
  return me.order;
}

export class PathView {
  readonly root = new THREE.Group();
  readonly preview = new THREE.Group();
  private readonly order = new THREE.Group();
  private readonly through = new THREE.Group();
  private readonly stop = new THREE.Group();
  private readonly arrow = flatIcon(new THREE.ShapeGeometry(arrowShape()), PAL.plan);
  private lines: Line2[] = [];
  private markers: THREE.Mesh[] = [];

  constructor(private readonly terrain: Terrain) {
    this.through.add(flatIcon(new THREE.RingGeometry(ORDER_R * ORDER_RING_INNER, ORDER_R, 32), PAL.plan), this.arrow);
    this.stop.add(
      flatIcon(new THREE.RingGeometry(ORDER_R * ORDER_RING_INNER, ORDER_R, 32), PAL.dest),
      flatIcon(new THREE.CircleGeometry(ORDER_SIGN * ORDER_R, 8, Math.PI / 8), PAL.dest),
    );
    this.order.add(this.through, this.stop);
    this.root.add(this.preview, this.order);
  }

  show(preview: boolean, world: World, orderHidden: boolean): void {
    this.preview.visible = preview;
    const me = playerVehicle(world);
    const order = orderHidden ? null : waypointOf(world);
    this.order.visible = order !== null;
    if (!order) return;
    const { dest } = order;
    this.order.position.set(dest.x * S, heightAt(this.terrain, dest.x, dest.y) * S + ORDER_LIFT, dest.y * S);
    this.order.quaternion.copy(this.tilt(dest.x, dest.y));
    this.through.visible = order.kind === 'through';
    this.stop.visible = order.kind === 'stopAt';
    this.arrow.rotation.y = -bearing(me.pos, dest);
  }

  private ground(p: { x: number; z: number }): [number, number, number] {
    return [p.x, heightAt(this.terrain, p.x / S, p.z / S) * S + LIFT, p.z];
  }

  private tilt(x: number, y: number): THREE.Quaternion {
    const dx = heightAt(this.terrain, x + SLOPE_STEP, y) - heightAt(this.terrain, x - SLOPE_STEP, y);
    const dy = heightAt(this.terrain, x, y + SLOPE_STEP) - heightAt(this.terrain, x, y - SLOPE_STEP);
    const normal = new THREE.Vector3(-dx, 2 * SLOPE_STEP, -dy).normalize();
    return new THREE.Quaternion().setFromUnitVectors(UP, normal);
  }

  private marker(at: { x: number; z: number }, color: number, opacity: number): void {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
    );
    marker.position.set(...this.ground(at));
    marker.quaternion.copy(this.tilt(at.x / S, at.z / S));
    marker.renderOrder = 820;
    this.preview.add(marker);
    this.markers.push(marker);
  }

  set(turns: VehicleFrame[][], firstColor: number, course: Vec[] | null, waypoint: boolean): void {
    this.clear();
    if (course) this.addCourse(course, waypoint);
    turns.forEach((frames, i) => {
      if (frames.length === 0) return;
      const solid = i === 0;
      const color = solid ? firstColor : PAL.plan;
      const line = new Line2(
        new LineGeometry().setPositions(frames.flatMap((f) => this.ground(f.pos))),
        new LineMaterial({ color, linewidth: LINE_WIDTH_PX, transparent: true, opacity: solid ? OPACITY.first : OPACITY.later, depthWrite: false }),
      );
      line.material.resolution.set(window.innerWidth, window.innerHeight);
      line.computeLineDistances();
      line.renderOrder = 820;
      this.preview.add(line);
      this.lines.push(line);

      this.marker(frames[frames.length - 1].pos, color, solid ? OPACITY.first : OPACITY.later);
    });
  }

  private addCourse(points: Vec[], waypoint: boolean): void {
    const positions: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / COURSE_STEP));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) positions.push(...this.ground({ x: (a.x + ((b.x - a.x) * k) / n) * S, z: (a.y + ((b.y - a.y) * k) / n) * S }));
    }
    const line = new Line2(
      new LineGeometry().setPositions(positions),
      new LineMaterial({ color: PAL.plan, linewidth: COURSE_WIDTH_PX, transparent: true, opacity: OPACITY.course, depthWrite: false }),
    );
    line.material.resolution.set(window.innerWidth, window.innerHeight);
    line.computeLineDistances();
    line.renderOrder = 820;
    this.preview.add(line);
    this.lines.push(line);
    if (!waypoint) return;
    const end = points[points.length - 1];
    this.marker({ x: end.x * S, z: end.y * S }, PAL.plan, OPACITY.later);
  }

  clear(): void {
    for (const l of this.lines) {
      this.preview.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    }
    for (const m of this.markers) {
      this.preview.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lines = [];
    this.markers = [];
  }
}
