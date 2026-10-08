// Trucks drawn as one base model per chassis, with every grid item's model from the shared kit on its own cells.
// Items stand on the model's top surface under their projected footprint. A mounted engine stands at the model's engine anchor.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the collider center. Models share that frame.
// A gun stands on a post that lifts its head over the cab ahead and over every drawn item and body surface its barrel can sweep.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chassisDef } from '../../data/chassis';
import { partDef, type PartDef, type PartKind } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { aimWithin, gunSpans, type FireSpan } from '../../sim/armor';
import { CLIP_TOLERANCE, bodyOf, cellCenter, cellRect, engineAnchor, highestUnder, restOn, surfaceAt, surfaceSamples, type Body, type CellRect, type Rest } from '../../sim/body';
import { headingOf, headingQuat, type V3, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL } from '../../render/palette';
import { BODY_PARTS, baseModel, grayShare, grayed, jagOffset, partModel, weaponLook, wearLookStep } from '../../render/partLooks';
import { baseGrid, facingOf, isMounted, itemCells, itemSize, plateSide, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle, World } from '../../sim/types';
import { angleDiff, DEG } from '../../sim/vec';
import { clearTop, headShape, sweepOf, type Obstacle } from './gunClearance';
import { model, outlineOf, socket, TRUCK_BIT, type ModelName } from './models';
import { hashStr } from '../../render/noise';
import { callTrucks, radioSpeakers } from '../../sim/dialogue';
import { TruckMotion, WHIPS } from './truckMotion';
import { weaponHead } from './weaponHead';

const T = PHYSICS.truck;
const CELL = PHYSICS.cell;


type PartItem = Extract<GridItem, { kind: 'part' }>;

const PAINT = 'paint';
const RADIO = 'radio_light';
const LAMP = 'light';
const GLASS = 'glass';
const TRIM = 'trim';

const BROKEN_TONE: Record<PartKind, number> = { weapon: 0.5, armor: 0.6, engine: 0.6, cargo: 0.6, core: 0.6, scanner: 0.6, store: 0.6, utility: 0.6 };

const ROT_YAW = Math.PI / 2;

const SIDE_YAW: Record<SideLetter, number> = { F: 0, B: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 };

const EDGE_H = 1;
const SIDE_SKIN = 0.1;
const GUN_GAP = 0.03;
const SAMPLE_REACH = 0.1;
const SKIRT = 0.22;

const SILHOUETTE_OPACITY = 0.5;
const SILHOUETTE_ORDER = 810;
const TRUCK_STENCIL = TRUCK_BIT;

type Wheel = { mount: THREE.Group; spin: THREE.Object3D; restY: number };
type Shock = { obj: THREE.Object3D; top: THREE.Vector3; wheel: number; z: number };
type Axle = { obj: THREE.Object3D; a: number; b: number; inset: number };

const SHOCK_R = 0.2;
const UP = new THREE.Vector3(0, 1, 0);
const ANTENNA_INSET = 0.12;
const RADIO_TIP = 1.6;
const RADIO_HALO = 0.6;
const CHAIN_SIDE = 0.4;

type Turret = { head: THREE.Group; tip: THREE.Vector3; spans: FireSpan[]; facing: number };

type Look = { tone: number; step: number; partId: string | null };
const THINNEST_FLOOR = 0.01;
const PRISTINE: Look = { tone: 1, step: 0, partId: null };

type Anchor = { local: THREE.Vector3; parent: THREE.Object3D };

type Placement = { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 };

export function signatureOf(v: Vehicle): string {
  const items = v.items
    .map((it) => {
      const what = it.kind === 'part' ? `${it.part.defId}#${it.part.id}:${wearLookStep(it.part)}` : it.good;
      return `${what}@${it.x},${it.y},${it.rot}`;
    })
    .join(',');
  return `${v.chassisId}|${v.faction}|${items}`;
}

export function viewOf(views: Map<string, VehicleView>, id: string): VehicleView {
  const view = views.get(id);
  if (!view) throw new Error(`Vehicle ${id} has no view`);
  return view;
}

export class VehicleView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();

  private sig = '';
  private wheels: Wheel[] = [];
  private shocks: Shock[] = [];
  private axles: Axle[] = [];
  private motion!: TruckMotion;
  private running = false;
  private turrets = new Map<string, Turret>();
  private anchors = new Map<string, Anchor>();
  private heading = 0;
  private lampMat = new THREE.MeshBasicMaterial({ color: PAL.lamp.off });
  private radioMat = new THREE.MeshBasicMaterial({ color: PAL.radioLight.off });
  private halo: THREE.Sprite | null = null;
  private radioOn = false;
  private glassMat = new THREE.MeshLambertMaterial({ flatShading: true });
  private readonly glassGlow = new THREE.Color(0);
  private silhouetteMat!: THREE.MeshBasicMaterial;
  private darkMat!: THREE.MeshBasicMaterial;
  private dark = false;

  constructor(v: Vehicle, seen: boolean) {
    this.root.add(this.body);
    this.update(v, seen);
  }

  update(v: Vehicle, seen: boolean): void {
    const sig = signatureOf(v);
    if (sig !== this.sig) this.rebuild(v);
    this.sig = sig;
    this.silhouetteMat.visible = seen;
    this.running = engineRuns(v);
  }

  pose(f: VehicleFrame, dt: number): void {
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.quaternion.set(f.rot.x, f.rot.y, f.rot.z, f.rot.w);
    this.heading = headingOf(f.rot);
    f.wheels.forEach((w, i) => {
      const wheel = this.wheels[i];
      if (!wheel) return;
      wheel.mount.position.y = wheel.restY - w.suspension;
      wheel.mount.rotation.y = w.steer;
      wheel.spin.rotation.z = -w.spin;
    });
    this.motion.step(f, dt, this.running);
    this.body.updateMatrix();
    this.poseSuspension();
  }

  private poseSuspension(): void {
    const hub = (i: number, dz: number) => {
      const p = this.wheels[i].mount.position;
      return new THREE.Vector3(p.x, p.y, p.z + dz);
    };
    for (const s of this.shocks) stretch(s.obj, hub(s.wheel, s.z), s.top.clone().applyMatrix4(this.body.matrix), 0);
    for (const a of this.axles) stretch(a.obj, hub(a.a, a.inset), hub(a.b, -a.inset), 0.5);
  }

  lamps(on: boolean): void {
    this.lampMat.color.setHex(on ? PAL.lamp.on : PAL.lamp.off);
  }

  radio(lit: boolean): void {
    this.radioOn = lit;
    this.radioMat.color.setHex(radioColor(lit));
    if (this.halo) this.halo.visible = lit;
  }

  outline(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || this.keepsLook(o)) return;
      if (dark) {
        o.userData.litMat = o.material;
        o.material = this.darkMat;
      } else {
        o.material = o.userData.litMat;
        delete o.userData.litMat;
      }
    });
  }

  private keepsLook(o: THREE.Mesh): boolean {
    const m = o.material;
    return m === this.silhouetteMat || m === this.lampMat || m === this.radioMat || o.userData.outline;
  }

  windows(glow: THREE.Color): void {
    this.glassGlow.copy(glow);
    this.glassMat.emissive.copy(glow);
  }

  aim(yawOf: (partId: string) => number | null): void {
    for (const [id, turret] of this.turrets) {
      const yaw = yawOf(id);
      const want = yaw === null ? turret.facing : angleDiff(this.heading, yaw) / DEG;
      const turn = aimWithin(sweepOf(turret.spans, true, turret.facing), want);
      const q = headingQuat(turn * DEG);
      turret.head.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  muzzle(partId: string): { pos: V3; dir: V3 } {
    const turret = this.turrets.get(partId);
    if (!turret) throw new Error(`Vehicle view has no mounted weapon ${partId}`);
    turret.head.updateWorldMatrix(true, false);
    const pos = turret.tip.clone().applyMatrix4(turret.head.matrixWorld);
    const dir = new THREE.Vector3(1, 0, 0).transformDirection(turret.head.matrixWorld);
    return { pos: { x: pos.x, y: pos.y, z: pos.z }, dir: { x: dir.x, y: dir.y, z: dir.z } };
  }

  dispose(): void {
    disposeChildren(this.root);
  }

  private rebuild(v: Vehicle): void {
    disposeChildren(this.body);
    disposeChildren(this.root);
    this.root.add(this.body);
    this.wheels = [];
    this.shocks = [];
    this.axles = [];
    this.turrets.clear();
    this.anchors.clear();
    const body = bodyOf(v.chassisId);
    this.motion = new TruckMotion(this.body, new THREE.Vector3(0, body.wheelY, 0), hashStr(v.id));
    const paint = FACTION_COLORS[v.faction].top;
    const on = this.lampMat.color.getHex() === PAL.lamp.on;
    this.lampMat = new THREE.MeshBasicMaterial({ color: on ? PAL.lamp.on : PAL.lamp.off });
    this.radioMat = new THREE.MeshBasicMaterial({ color: radioColor(this.radioOn) });
    this.halo = null;
    this.glassMat = new THREE.MeshLambertMaterial({ flatShading: true, emissive: this.glassGlow });

    const still = new THREE.Group();
    const onBody = v.items.filter((item) => onChassis(v, item));
    this.buildBase(v, body, baseModel(v.chassisId), still, paint, FACTION_COLORS[v.faction].cab, bumperlessCells(v, onBody), cabLook(v));
    const wheelItems: PartItem[] = [];
    const guns: PartItem[] = [];
    const obstacles: Obstacle[] = [];
    for (const item of onBody.filter((it) => !hidesInside(v, it) && !wouldFloat(v, it))) {
      if (item.kind === 'good') {
        const good = this.placeItem(v, item, paint, standingY(v, item));
        still.add(good);
        obstacles.push(obstacleOf(good));
        continue;
      }
      this.drawPart(v, body, item, still, paint, wheelItems, guns, obstacles);
    }
    for (const gun of guns) this.buildWeapon(v, gun, isMounted(v.chassisId, gun), still, paint, obstacles);
    this.buildWheels(v, body, wheelItems, paint);
    this.anchorUndrawn(v, body);
    this.buildSuspension(body, paint);
    this.buildLooseParts(v, body, onBody.length === v.items.length);
    this.body.add(mergeStatic(still));
    this.buildSilhouette(paint);
    this.darkMat = new THREE.MeshBasicMaterial({ color: PAL.outline });
    markStencil(this.darkMat);
    this.dark = false;
  }

  private drawPart(v: Vehicle, body: Body, item: PartItem, still: THREE.Group, paint: number, wheelItems: PartItem[], guns: PartItem[], obstacles: Obstacle[]): void {
    const def = partDef(item.part.defId);
    const mounted = isMounted(v.chassisId, item);
    if (BODY_PARTS.has(def.id)) return;
    if (def.kind === 'weapon') guns.push(item);
    else if (isWheel(def) && mounted) wheelItems.push(item);
    else this.drawModel(v, body, item, def, still, paint, obstacles);
  }

  private drawModel(v: Vehicle, body: Body, item: PartItem, def: PartDef, still: THREE.Group, paint: number, obstacles: Obstacle[]): void {
    const obj = this.placedPart(v, body, item, def, paint);
    this.addPart(still, item, obj);
    if (blocksGuns(v, item, def)) obstacles.push(obstacleOf(obj));
  }

  private placedPart(v: Vehicle, body: Body, item: PartItem, def: PartDef, paint: number): THREE.Object3D {
    const mounted = isMounted(v.chassisId, item);
    if (isWheel(def)) return this.spareWheel(v, body, item, paint, standingY(v, item));
    if (def.kind === 'armor') return this.placeArmor(v, body, item, paint, mounted);
    if (def.kind === 'engine' && mounted) return this.placeEngine(v, item, paint);
    return this.placeItem(v, item, paint, standingY(v, item));
  }

  private addPart(still: THREE.Group, item: PartItem, obj: THREE.Object3D): void {
    still.add(obj);
    this.anchors.set(item.part.id, { local: new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()), parent: this.body });
  }

  private anchorUndrawn(v: Vehicle, body: Body): void {
    for (const item of v.items) {
      if (item.kind !== 'part' || this.anchors.has(item.part.id)) continue;
      const local = onChassis(v, item) ? surfacePoint(v, item) : new THREE.Vector3(-body.half.x, body.half.y, 0);
      this.anchors.set(item.part.id, { local, parent: this.body });
    }
  }

  hasPart(partId: string): boolean {
    return this.anchors.has(partId);
  }

  partPoint(partId: string): V3 {
    const anchor = this.anchors.get(partId);
    if (!anchor) throw new Error(`Vehicle view has no part ${partId}`);
    anchor.parent.updateWorldMatrix(true, false);
    const p = anchor.local.clone().applyMatrix4(anchor.parent.matrixWorld);
    return { x: p.x, y: p.y, z: p.z };
  }

  center(): V3 {
    const { x, y, z } = this.root.position;
    return { x, y, z };
  }

  private buildSilhouette(paint: number): void {
    this.silhouetteMat = silhouetteMaterial(paint);
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.outline) meshes.push(o);
    });
    for (const mesh of meshes) {
      markStencil(mesh.material as THREE.Material);
      const twin = new THREE.Mesh(mesh.geometry, this.silhouetteMat);
      twin.position.copy(mesh.position);
      twin.quaternion.copy(mesh.quaternion);
      twin.scale.copy(mesh.scale);
      twin.renderOrder = SILHOUETTE_ORDER;
      mesh.parent!.add(twin);
    }
  }

  private useLamp(obj: THREE.Object3D): void {
    const shared: Record<string, THREE.Material> = { [LAMP]: this.lampMat, [RADIO]: this.radioMat, [GLASS]: this.glassMat };
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = shared[o.material.name];
      if (!mat) return;
      if (mat === this.glassMat) this.glassMat.color.copy(o.material.color);
      o.material.dispose();
      o.material = mat;
      o.userData.lamp = true;
    });
  }

  private buildBase(v: Vehicle, body: Body, name: ModelName, into: THREE.Group, paint: number, trim: number, bumperless: Set<string>, look: Look): void {
    const obj = model(name);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material.name === TRIM) o.material.color.setHex(trim);
    });
    tint(obj, paint, look);
    this.useLamp(obj);
    into.add(obj);
    const grid = baseGrid(v.chassisId);
    const stretch = (2 * body.half.y + SKIRT) / EDGE_H;
    const ends: [number, ModelName, number][] = [[0, 'bumper_front', 0], [grid.h - 1, 'bumper_rear', Math.PI]];
    for (const [y, bumperName, yaw] of ends) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.cells[y][x] === null || bumperless.has(`${x},${y}`)) continue;
        const bumper = model(bumperName);
        place(bumper, bumperPlacement(cellRect(v.chassisId, [{ x, y }]), y === 0, body.half.y, yaw, stretch));
        tint(bumper, paint, look);
        into.add(bumper);
      }
    }
  }

  private placeItem(v: Vehicle, item: GridItem, paint: number, y: number): THREE.Object3D {
    const obj = model(itemModel(item));
    place(obj, footprint(v, item, y));
    lean(obj, restOf(v, item).slope);
    tint(obj, paint, lookOf(item));
    return obj;
  }

  private placeEngine(v: Vehicle, item: PartItem, paint: number): THREE.Object3D {
    const obj = model(itemModel(item));
    const at = footprint(v, item, 0);
    const anchor = engineAnchor(v.chassisId);
    place(obj, { ...at, pos: new THREE.Vector3(anchor.x, anchor.y, anchor.z) });
    tint(obj, paint, lookOf(item));
    return obj;
  }

  private placeArmor(v: Vehicle, body: Body, item: PartItem, paint: number, mounted: boolean): THREE.Object3D {
    const def = partDef(item.part.defId);
    if (def.kind !== 'armor') throw new Error(`Part ${def.id} is not armor`);
    const side = armorSide(v, item);
    const across = side === 'F' || side === 'B';
    const rect = rectOf(v, item);
    const at = mounted ? { pos: new THREE.Vector3((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2) } : footprint(v, item, standingY(v, item));
    const depth = armorDepth(mounted, across);
    const obj = model(partModel(def.id));
    if (mounted) {
      const height = new THREE.Box3().setFromObject(obj).max.y;
      at.pos.y = { plates: body.half.y - height, ram: -body.half.y, cage: body.half.y - height }[def.look];
      seatArmor(at.pos, rect, side, depth);
    }
    const n = Math.max(def.w, def.h);
    place(obj, { pos: at.pos, yaw: SIDE_YAW[side], scale: new THREE.Vector3(depth / CELL.along, 1, armorSpan(item, rect, mounted, across) / (n * CELL.across)) });
    tint(obj, paint, lookOf(item));
    return obj;
  }

  private riser(stand: ReturnType<typeof weaponStand>, item: PartItem, paint: number, into: THREE.Group, top: number): Placement {
    const { at, foot } = stand;
    const bottom = postBottom(foot, top);
    const mount = { ...at, pos: at.pos.clone().setY(top) };
    if (bottom >= top) return mount;
    const post = model('wmount_riser');
    place(post, { pos: at.pos.clone().setY(bottom), yaw: 0, scale: new THREE.Vector3(1, (top - bottom) / socket('wmount_riser', 'top').y, 1) });
    tint(post, paint, lookOf(item));
    into.add(post);
    return mount;
  }

  private buildWeapon(v: Vehicle, item: PartItem, active: boolean, still: THREE.Group, paint: number, obstacles: readonly Obstacle[]): void {
    const look = weaponLook(item.part.id, item.part.defId);
    const wear = lookOf(item);
    const { head: parts, tip } = weaponHead(look);
    for (const p of parts.children) tint(p, paint, wear);
    const head = mergeStatic(parts);

    const stand = weaponStand(v, item);
    const headAt = socket(look.mount, 'head');
    const facing = signedDegrees(facingOf(item));
    const spans = gunSpans(v, item);
    const shape = headShape(head, socket(look.receiver, 'muzzle').x);
    const mount = model(look.mount);
    place(mount, stand.at);
    mount.updateMatrix();
    const pivot = headAt.clone().applyMatrix4(mount.matrix);
    const own = rectOf(v, item);
    const ground = surfaceSamples(v.chassisId, pivot, Math.max(shape.core, shape.reach) + SAMPLE_REACH)
      .filter((s) => !(s.x >= own.x0 && s.x <= own.x1 && s.z >= own.z0 && s.z <= own.z1))
      .map((s): Obstacle => ({ x0: s.x - s.half, x1: s.x + s.half, z0: s.z - s.half, z1: s.z + s.half, top: s.y }));
    const clear = clearTop(pivot, shape, sweepOf(spans, active, facing), [...obstacles, ...ground], GUN_GAP);
    const top = Math.max(stand.top, clear - headAt.y - shape.bottom);
    if (!Number.isFinite(top)) throw new Error(`Gun ${item.part.id} on ${v.chassisId} has a post height of ${top}`);

    const at = this.riser(stand, item, paint, still, top);
    place(mount, at);
    tint(mount, paint, wear);
    still.add(mount);
    mount.updateMatrix();
    head.position.copy(headAt.applyMatrix4(mount.matrix));
    this.anchors.set(item.part.id, { local: head.position.clone(), parent: this.body });
    const turn = headingQuat(facing * DEG);
    head.quaternion.set(turn.x, turn.y, turn.z, turn.w);
    if (!active) {
      still.add(head);
      return;
    }
    this.body.add(head);
    this.turrets.set(item.part.id, { head, tip, spans, facing });
  }

  private buildWheels(v: Vehicle, body: Body, items: PartItem[], paint: number): void {
    const mounts = wheelMounts(body);
    if (items.length !== mounts.length) throw new Error(`${v.id} has ${items.length} mounted wheels, expected ${mounts.length}`);
    const cornered = mounts.map((m) => {
      const inCorner = items.filter((it) => {
        const c = cellCenter(v.chassisId, it.x, it.y);
        return Math.sign(c.x) === Math.sign(m.x) && Math.sign(c.z) === Math.sign(m.z);
      });
      if (inCorner.length !== 1) throw new Error(`${v.id} has ${inCorner.length} wheel items in the corner of the wheel mount ${m.x},${m.z}, expected 1`);
      return inCorner[0];
    });
    mounts.forEach((m, i) => {
      const mount = new THREE.Group();
      mount.position.set(m.x, m.y - T.suspensionRest, m.z);
      const spin = this.wheelModel(body, paint, lookOf(cornered[i]));
      mount.add(spin);
      this.anchors.set(cornered[i].part.id, { local: new THREE.Vector3(), parent: mount });
      this.root.add(mount);
      this.wheels.push({ mount, spin, restY: m.y });
    });
  }

  private buildSuspension(body: Body, paint: number): void {
    const thick = new THREE.Vector3(body.wheelRadius, 1, body.wheelRadius);
    const inset = body.wheelHalfWidth + SHOCK_R * body.wheelRadius;
    wheelMounts(body).forEach((m, wheel) => {
      const z = -Math.sign(m.z) * inset;
      const obj = this.stretchModel('coilover', thick, paint);
      this.shocks.push({ obj, top: new THREE.Vector3(m.x, -body.half.y, m.z + z), wheel, z });
    });
    for (const [a, b] of [[0, 1], [2, 3]]) this.axles.push({ obj: this.stretchModel('axle', thick, paint), a, b, inset: body.wheelHalfWidth });
  }

  private stretchModel(name: ModelName, thick: THREE.Vector3, paint: number): THREE.Object3D {
    const raw = model(name);
    tint(raw, paint, PRISTINE);
    const inner = new THREE.Group();
    inner.add(raw);
    const merged = mergeStatic(inner);
    merged.scale.copy(thick);
    const outer = new THREE.Group();
    outer.add(merged);
    this.root.add(outer);
    return outer;
  }

  private buildLooseParts(v: Vehicle, body: Body, bareRear: boolean): void {
    const cab = cabOf(v);
    if (!cab) throw new Error(`${v.id} has no cab`);
    const row = Math.max(...itemCells(cab).map((c) => c.y));
    const rear = cellRect(v.chassisId, itemCells(cab).filter((c) => c.y === row));
    const tip = wrapped(model('antenna'));
    this.useLamp(tip);
    const antenna = mergeStatic(tip);
    this.halo = radioHalo(this.radioOn);
    antenna.add(this.halo);
    antenna.position.set(rear.x0 + ANTENNA_INSET, surfaceAt(v.chassisId, rear), -body.half.z + ANTENNA_INSET);
    this.body.add(antenna);
    this.motion.addWhip(antenna, WHIPS.antenna);
    if (!bareRear) return;
    const chain = mergeStatic(wrapped(model('tow_chain')));
    chain.position.set(-body.half.x, -body.half.y - SKIRT, body.half.z * CHAIN_SIDE);
    this.body.add(chain);
    this.motion.addWhip(chain, WHIPS.chain);
  }

  private spareWheel(v: Vehicle, body: Body, item: PartItem, paint: number, y: number): THREE.Object3D {
    const wheel = this.wheelModel(body, paint, lookOf(item));
    const at = footprint(v, item, y);
    wheel.position.set(at.pos.x, at.pos.y + body.wheelRadius, at.pos.z);
    return wheel;
  }

  private wheelModel(body: Body, paint: number, look: Look): THREE.Object3D {
    const raw = model('wheel');
    tint(raw, paint, look);
    const wrap = new THREE.Group();
    wrap.add(raw);
    const wheel = mergeStatic(wrap);
    wheel.scale.set(body.wheelRadius, body.wheelRadius, body.wheelHalfWidth * 2);
    return wheel;
  }
}

function engineRuns(v: Vehicle): boolean {
  return v.items.some((it) => it.kind === 'part' && it.part.hp > 0 && partDef(it.part.defId).kind === 'engine' && isMounted(v.chassisId, it));
}

function wrapped(obj: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

function stretch(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, at: number): void {
  const dir = to.clone().sub(from);
  const length = dir.length();
  if (!(length > 0)) throw new Error('Suspension part has zero length');
  obj.position.copy(from).addScaledVector(dir, at);
  obj.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
  obj.scale.set(1, length, 1);
}

function silhouetteMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: SILHOUETTE_OPACITY,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    stencilWrite: true,
    stencilRef: TRUCK_STENCIL,
    stencilFuncMask: TRUCK_STENCIL,
    stencilWriteMask: TRUCK_STENCIL,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
}

function markStencil(mat: THREE.Material): void {
  mat.stencilWrite = true;
  mat.stencilRef = TRUCK_STENCIL;
  mat.stencilWriteMask = TRUCK_STENCIL;
  mat.stencilFunc = THREE.AlwaysStencilFunc;
  mat.stencilZPass = THREE.ReplaceStencilOp;
}

function onChassis(v: Vehicle, item: GridItem): boolean {
  const grid = baseGrid(v.chassisId);
  const cells = itemCells(item);
  const inside = cells.filter((c) => c.y < grid.h).length;
  if (inside !== 0 && inside !== cells.length) throw new Error(`Item ${item.id} lies across the end of the ${v.chassisId} grid`);
  return inside === cells.length;
}

const BUMPER_LOOKS: readonly string[] = ['ram', 'cage'];

function hidesInside(v: Pick<Vehicle, 'chassisId'>, item: GridItem): boolean {
  if (item.kind !== 'part') return false;
  const def = partDef(item.part.defId);
  return def.kind === 'core' && (def.role === 'transmission' || def.role === 'tank') && !chassisDef(v.chassisId).showsCores;
}

function replacesBumper(v: Vehicle, item: GridItem): boolean {
  if (item.kind !== 'part' || !isMounted(v.chassisId, item)) return false;
  const def = partDef(item.part.defId);
  return def.kind === 'armor' && BUMPER_LOOKS.includes(def.look);
}

function bumperlessCells(v: Vehicle, items: GridItem[]): Set<string> {
  const cells = new Set<string>();
  for (const item of items.filter((it) => replacesBumper(v, it))) for (const c of itemCells(item)) cells.add(`${c.x},${c.y}`);
  return cells;
}

export function weaponStand(v: Pick<Vehicle, 'chassisId'>, item: GridItem): { at: Placement; bottom: number; top: number; foot: number } {
  const rest = standingY(v, item);
  const at = footprint(v, item, rest);
  const top = Math.max(rest, highestAhead(v.chassisId, rectOf(v, item)));
  const foot = highestUnder(v.chassisId, postColumn(at.pos));
  if (foot === -Infinity && isMounted(v.chassisId, item)) {
    const cells = itemCells(item).map((c) => `${c.x},${c.y}`).join(' ');
    throw new Error(`The ${v.chassisId} model has no surface under the post of gun ${item.kind === 'part' ? item.part.defId : item.id} mounted on ${cells}`);
  }
  return { at, bottom: postBottom(foot, top), top, foot };
}

export function signedDegrees(deg: number): number {
  const turn = ((deg % 360) + 360) % 360;
  return turn > 180 ? turn - 360 : turn;
}

export function postBottom(foot: number, top: number): number {
  return foot !== -Infinity && top - foot > CLIP_TOLERANCE ? foot : top;
}

export function postColumn(at: THREE.Vector3): CellRect {
  const corner = socket('wmount_riser', 'column');
  const half = { x: Math.abs(corner.x), z: Math.abs(corner.z) };
  return { x0: at.x - half.x, x1: at.x + half.x, z0: at.z - half.z, z1: at.z + half.z };
}

function highestAhead(chassisId: string, rect: CellRect): number {
  const nose = bodyOf(chassisId).half.x;
  if (rect.x1 >= nose) return -Infinity;
  return highestUnder(chassisId, { ...rect, x0: rect.x1, x1: nose });
}

function surfacePoint(v: Pick<Vehicle, 'chassisId'>, item: GridItem): THREE.Vector3 {
  const rect = rectOf(v, item);
  return new THREE.Vector3((rect.x0 + rect.x1) / 2, surfaceAt(v.chassisId, rect), (rect.z0 + rect.z1) / 2);
}

function rectOf(v: Pick<Vehicle, 'chassisId'>, item: GridItem): CellRect {
  return cellRect(v.chassisId, itemCells(item));
}

export function wouldFloat(v: Pick<Vehicle, 'chassisId'>, item: GridItem): boolean {
  return !alwaysDrawn(v, item) && restOf(v, item).perched;
}

function alwaysDrawn(v: Pick<Vehicle, 'chassisId'>, item: GridItem): boolean {
  if (item.kind !== 'part') return false;
  const def = partDef(item.part.defId);
  if (def.kind === 'weapon' || def.kind === 'armor') return true;
  return (def.kind === 'engine' || isWheel(def)) && isMounted(v.chassisId, item);
}

function restOf(v: Pick<Vehicle, 'chassisId'>, item: GridItem): Rest {
  return restOn(v.chassisId, rectOf(v, item));
}

export function standingY(v: Pick<Vehicle, 'chassisId'>, item: GridItem): number {
  return restOf(v, item).y;
}

function armorSide(v: Vehicle, item: PartItem): SideLetter {
  const size = itemSize(item);
  const side = plateSide(v.chassisId, item);
  const depthCells = ['F', 'B'].includes(side) ? size.h : size.w;
  if (depthCells !== 1) throw new Error(`Armor ${item.part.id} is ${depthCells} cells deep on side ${side}, expected 1`);
  return side;
}

function armorSpan(item: PartItem, rect: CellRect, mounted: boolean, across: boolean): number {
  const size = itemSize(item);
  if (!mounted) return across ? size.w * CELL.across : size.h * CELL.along;
  return across ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
}

function seatArmor(pos: THREE.Vector3, rect: CellRect, side: SideLetter, depth: number): void {
  if (side === 'F') pos.x = rect.x1 - depth / 2;
  else if (side === 'B') pos.x = rect.x0 + depth / 2;
  else pos.z += Math.sign(pos.z) * (depth / 2);
}

function bumperPlacement(rect: CellRect, nose: boolean, top: number, yaw: number, stretch: number): Placement {
  const x = nose ? rect.x1 - CELL.along / 2 : rect.x0 + CELL.along / 2;
  const width = rect.z1 > rect.z0 ? (rect.z1 - rect.z0) / CELL.across : 1;
  return { pos: new THREE.Vector3(x, top, (rect.z0 + rect.z1) / 2), yaw, scale: new THREE.Vector3(1, stretch, width) };
}

function armorDepth(mounted: boolean, across: boolean): number {
  if (across) return CELL.along;
  return mounted ? SIDE_SKIN : CELL.across;
}

function itemModel(item: GridItem) {
  return partModel(item.kind === 'part' ? item.part.defId : item.good);
}

function cabOf(v: Vehicle): GridItem | undefined {
  return v.items.find((it) => it.kind === 'part' && BODY_PARTS.has(it.part.defId));
}

function cabLook(v: Vehicle): Look {
  const cab = cabOf(v);
  return cab ? lookOf(cab) : PRISTINE;
}

function lookOf(item: GridItem): Look {
  if (item.kind === 'good') return PRISTINE;
  const step = wearLookStep(item.part);
  return { tone: item.part.hp > 0 ? 1 : BROKEN_TONE[partDef(item.part.defId).kind], step, partId: item.part.id };
}

export function footprint(v: Pick<Vehicle, 'chassisId'>, item: GridItem, y: number): Placement {
  const rect = restOf(v, item).rect;
  const size = itemSize(item);
  const dx = rect.x1 - rect.x0 > 0 ? rect.x1 - rect.x0 : size.h * CELL.along;
  const dz = rect.z1 - rect.z0 > 0 ? rect.z1 - rect.z0 : size.w * CELL.across;
  const own = item.kind === 'part' ? partDef(item.part.defId) : { w: 1, h: 1 };
  const pos = new THREE.Vector3((rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2);
  if (item.rot % 2 === 0) return { pos, yaw: 0, scale: new THREE.Vector3(dx / (own.h * CELL.along), 1, dz / (own.w * CELL.across)) };
  return { pos, yaw: ROT_YAW, scale: new THREE.Vector3(dz / (own.h * CELL.along), 1, dx / (own.w * CELL.across)) };
}

function blocksGuns(v: Vehicle, item: PartItem, def: PartDef): boolean {
  return !(isMounted(v.chassisId, item) && (def.kind === 'armor' || def.kind === 'engine'));
}

function obstacleOf(obj: THREE.Object3D): Obstacle {
  const box = new THREE.Box3().setFromObject(obj);
  return { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, top: box.max.y };
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function lean(obj: THREE.Object3D, slope: Rest['slope']): void {
  if (slope.x === 0 && slope.z === 0) return;
  const pitch = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.atan(slope.x));
  const roll = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.atan(slope.z));
  obj.quaternion.premultiply(pitch.multiply(roll));
}

function place(obj: THREE.Object3D, at: Placement): void {
  obj.position.copy(at.pos);
  obj.rotation.set(0, at.yaw, 0);
  obj.scale.copy(at.scale);
}

function tint(obj: THREE.Object3D, paint: number, look: Look): void {
  const share = grayShare(look.step);
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material;
    if (!(mat instanceof THREE.MeshLambertMaterial)) throw new Error(`Part mesh ${o.name} has material ${mat.type}, expected one Lambert material`);
    if (mat.name === PAINT) mat.color.setHex(paint);
    mat.color.setHex(grayed(mat.color.getHex(), share));
    mat.color.multiplyScalar(look.tone);
  });
  if (look.partId && look.step > 0) jag(obj, look.partId, look.step);
}

export function jag(obj: THREE.Object3D, partId: string, step: number): void {
  obj.updateMatrixWorld(true);
  const toModel = obj.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    box.union((geo.boundingBox as THREE.Box3).clone().applyMatrix4(o.matrixWorld).applyMatrix4(toModel));
  });
  const size = box.getSize(new THREE.Vector3());
  const thinnest = Math.max(THINNEST_FLOOR, Math.min(size.x, size.y, size.z));
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const toMesh = toModel.clone().multiply(o.matrixWorld).invert();
    const p = new THREE.Vector3();
    const offset = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(toModel);
      const d = jagOffset(partId, p.x, p.y, p.z, step, thinnest);
      p.add(offset.set(d.x, d.y, d.z)).applyMatrix4(toMesh);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    if (geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  });
}

function flipWinding(geo: THREE.BufferGeometry): void {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const one = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = one;
      }
    }
    a.needsUpdate = true;
  }
}

function mergeStatic(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const toGroup = group.matrixWorld.clone().invert();
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  const used: THREE.Mesh[] = [];
  const lamps: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.userData.lamp) {
      lamps.push(o);
      return;
    }
    const mat = o.material as THREE.MeshLambertMaterial;
    const toHere = toGroup.clone().multiply(o.matrixWorld);
    let geo = o.geometry.clone().applyMatrix4(toHere);
    if (geo.index) geo = geo.toNonIndexed();
    if (toHere.determinant() < 0) flipWinding(geo);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    geo.morphAttributes = {};
    geo.clearGroups();
    const hex = mat.color.getHex();
    const list = byColor.get(hex) ?? [];
    list.push(geo);
    byColor.set(hex, list);
    used.push(o);
  });
  const out = new THREE.Group();
  out.add(...outlineOf([...byColor.values()].flat()));
  for (const [hex, geos] of byColor) {
    const merged = mergeGeometries(geos);
    if (!merged) throw new Error(`Could not merge ${geos.length} truck meshes of color ${hex.toString(16)}`);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const lamp of lamps) {
    const toHere = toGroup.clone().multiply(lamp.matrixWorld);
    const geo = lamp.geometry.clone().applyMatrix4(toHere);
    if (toHere.determinant() < 0) flipWinding(geo);
    lamp.geometry.dispose();
    out.add(new THREE.Mesh(geo, lamp.material));
  }
  for (const m of used) {
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  return out;
}

function radioColor(lit: boolean): number {
  return lit ? PAL.radioLight.on : PAL.radioLight.off;
}

function radioHalo(lit: boolean): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap(), color: PAL.radioLight.on, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(RADIO_HALO);
  sprite.raycast = () => {};
  sprite.position.set(0, RADIO_TIP, 0);
  sprite.visible = lit;
  return sprite;
}

let haloTexture: THREE.DataTexture | null = null;
function haloMap(): THREE.DataTexture {
  if (haloTexture) return haloTexture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const d = Math.hypot((i % size) - size / 2 + 0.5, Math.floor(i / size) - size / 2 + 0.5) / (size / 2);
    data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d) ** 2)], i * 4);
  }
  haloTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  haloTexture.needsUpdate = true;
  return haloTexture;
}

function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
        o.userData.litMat?.dispose();
      }
    });
  }
}

function isWheel(def: PartDef): boolean {
  return def.kind === 'core' && def.role === 'wheel';
}

export const RADIO_LIGHT = {
  flashMs: 200,
  talkMs: 1200,
};

export type RadioCue = { start: number; end: number | null };

function closeStart(cue: RadioCue): number {
  return cue.end === null ? Infinity : Math.max(cue.end, cue.start + 4 * RADIO_LIGHT.flashMs);
}

function cueEnd(cue: RadioCue): number {
  return closeStart(cue) + 2 * RADIO_LIGHT.flashMs;
}

export function radioLit(cue: RadioCue, now: number): boolean {
  const f = RADIO_LIGHT.flashMs;
  if (now < cue.start) return false;
  const open = now - cue.start;
  if (open < 4 * f) return Math.floor(open / f) % 2 === 0;
  const close = now - closeStart(cue);
  if (close < 0) return true;
  return close >= f && close < 2 * f;
}

export class RadioLights {
  private readonly cues = new Map<string, RadioCue[]>();
  private noted: World | null = null;
  private calling = new Set<string>();
  private beacon = false;

  note(world: World, now: number): void {
    this.prune(now);
    if (world === this.noted) return;
    const first = this.noted === null;
    this.noted = world;
    const call = new Set(callTrucks(world));
    this.noteCall(call, now);
    if (!first) this.noteTalk(world, call, now);
    this.calling = call;
    this.beacon = world.player.beacon;
  }

  private noteCall(call: Set<string>, now: number): void {
    for (const id of call) if (!this.calling.has(id)) this.open(id, now);
    for (const id of this.calling) if (!call.has(id)) this.close(id, now);
  }

  private noteTalk(world: World, call: Set<string>, now: number): void {
    for (const id of radioSpeakers(world.events, world.player.vehicleId)) {
      if (!this.calling.has(id) && !call.has(id)) this.talk(id, now);
    }
    this.noteBeacon(world, call, now);
  }

  private noteBeacon(world: World, call: Set<string>, now: number): void {
    const switchedOn = world.player.beacon && !this.beacon;
    if (switchedOn && call.size === 0) this.talk(world.player.vehicleId, now);
  }

  lit(id: string, now: number): boolean {
    const list = this.cues.get(id);
    if (!list) return false;
    for (const cue of list) if (radioLit(cue, now)) return true;
    return false;
  }

  private open(id: string, now: number): void {
    const joined = this.joinable(id, now);
    if (joined) joined.end = null;
    else this.push(id, now, null);
  }

  private close(id: string, now: number): void {
    const last = this.cues.get(id)?.at(-1);
    if (last && last.end === null) last.end = now;
  }

  private talk(id: string, now: number): void {
    const joined = this.joinable(id, now);
    if (joined) {
      if (joined.end !== null) joined.end = Math.max(joined.end, now + RADIO_LIGHT.talkMs);
    } else this.push(id, now, now + RADIO_LIGHT.talkMs);
  }

  private joinable(id: string, now: number): RadioCue | null {
    const last = this.cues.get(id)?.at(-1);
    return last && now < closeStart(last) ? last : null;
  }

  private push(id: string, now: number, end: number | null): void {
    const list = this.cues.get(id) ?? [];
    const last = list.at(-1);
    const start = last ? Math.max(now, cueEnd(last) + RADIO_LIGHT.flashMs) : now;
    list.push({ start, end: end === null ? null : start + (end - now) });
    this.cues.set(id, list);
  }

  private prune(now: number): void {
    for (const [id, list] of this.cues) {
      while (list.length > 0 && cueEnd(list[0]) <= now) list.shift();
      if (list.length === 0) this.cues.delete(id);
    }
  }
}
