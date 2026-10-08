// Trucks drawn as one base model per chassis, with every grid item's model from the shared kit on its own cells.
// Items stand on the model's top surface under their projected footprint. A mounted engine stands at the model's engine anchor.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the collider center. Models share that frame.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chassisDef } from '../../data/chassis';
import { partDef, type PartDef, type PartKind } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { bodyOf, cellCenter, cellRect, engineAnchor, highestUnder, restOn, surfaceAt, type Body, type CellRect, type Rest } from '../../sim/body';
import { headingOf, headingQuat, type V3, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL } from '../../render/palette';
import { BODY_PARTS, baseModel, partModel, weaponLook } from '../../render/partLooks';
import { baseGrid, isMounted, itemCells, itemSize, sideOf, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle } from '../../sim/types';
import { model, outlineOf, socket, TRUCK_BIT, type ModelName } from './models';
import { hashStr } from '../../render/noise';
import { TruckMotion, WHIPS } from './truckMotion';

const T = PHYSICS.truck;
const CELL = PHYSICS.cell;


type PartItem = Extract<GridItem, { kind: 'part' }>;

const PAINT = 'paint';
const LAMP = 'light';
const GLASS = 'glass';
const TRIM = 'trim';

const BROKEN_TONE: Record<PartKind, number> = { weapon: 0.5, armor: 0.6, engine: 0.6, cargo: 0.6, core: 0.6, scanner: 0.6, store: 0.6 };

const ROT_YAW = Math.PI / 2;

const SIDE_YAW: Record<SideLetter, number> = { F: 0, B: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 };

const EDGE_H = 1;
const SIDE_SKIN = 0.1;
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
const CHAIN_SIDE = 0.4;

type Turret = { head: THREE.Group; tip: THREE.Vector3 };

type Placement = { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 };

function signatureOf(v: Vehicle): string {
  const items = v.items
    .map((it) => {
      const what = it.kind === 'part' ? `${it.part.defId}#${it.part.id}:${it.part.hp > 0 ? 1 : 0}` : it.good;
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
  private heading = 0;
  private lampMat = new THREE.MeshBasicMaterial({ color: PAL.lamp.off });
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

  outline(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.material === this.silhouetteMat || o.material === this.lampMat || o.userData.outline) return;
      if (dark) {
        o.userData.litMat = o.material;
        o.material = this.darkMat;
      } else {
        o.material = o.userData.litMat;
        delete o.userData.litMat;
      }
    });
  }

  windows(glow: THREE.Color): void {
    this.glassGlow.copy(glow);
    this.glassMat.emissive.copy(glow);
  }

  aim(yawOf: (partId: string) => number | null): void {
    for (const [id, turret] of this.turrets) {
      const yaw = yawOf(id);
      const q = headingQuat(yaw === null ? 0 : yaw - this.heading);
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
    const body = bodyOf(v.chassisId);
    this.motion = new TruckMotion(this.body, new THREE.Vector3(0, body.wheelY, 0), hashStr(v.id));
    const paint = FACTION_COLORS[v.faction].top;
    const on = this.lampMat.color.getHex() === PAL.lamp.on;
    this.lampMat = new THREE.MeshBasicMaterial({ color: on ? PAL.lamp.on : PAL.lamp.off });
    this.glassMat = new THREE.MeshLambertMaterial({ flatShading: true, emissive: this.glassGlow });

    const still = new THREE.Group();
    const onBody = v.items.filter((item) => onChassis(v, item));
    this.buildBase(v, body, baseModel(v.chassisId), still, paint, FACTION_COLORS[v.faction].cab, bumperlessCells(v, onBody));
    const wheelItems: PartItem[] = [];
    for (const item of onBody.filter((it) => !hidesInside(v, it) && !wouldFloat(v, it))) {
      if (item.kind === 'good') {
        still.add(this.placeItem(v, item, paint, standingY(v, item)));
        continue;
      }
      const def = partDef(item.part.defId);
      const mounted = isMounted(v.chassisId, item);
      if (BODY_PARTS.has(def.id)) continue;
      const wheel = isWheel(def);
      if (wheel && mounted) wheelItems.push(item);
      else if (wheel) still.add(this.spareWheel(v, body, item, paint, standingY(v, item)));
      else if (def.kind === 'weapon') this.buildWeapon(v, item, mounted, still, paint, this.riser(v, item, paint, still));
      else if (def.kind === 'armor') still.add(this.placeArmor(v, body, item, paint, mounted));
      else if (def.kind === 'engine' && mounted) still.add(this.placeEngine(v, item, paint));
      else still.add(this.placeItem(v, item, paint, standingY(v, item)));
    }
    this.buildWheels(v, body, wheelItems, paint);
    this.buildSuspension(body, paint);
    this.buildLooseParts(v, body, onBody.length === v.items.length);
    this.body.add(mergeStatic(still));
    this.buildSilhouette(paint);
    this.darkMat = new THREE.MeshBasicMaterial({ color: PAL.outline });
    markStencil(this.darkMat);
    this.dark = false;
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
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.material.name === LAMP) {
        o.material.dispose();
        o.material = this.lampMat;
        o.userData.lamp = true;
      } else if (o.material.name === GLASS) {
        this.glassMat.color.copy(o.material.color);
        o.material.dispose();
        o.material = this.glassMat;
        o.userData.lamp = true;
      }
    });
  }

  private buildBase(v: Vehicle, body: Body, name: ModelName, into: THREE.Group, paint: number, trim: number, bumperless: Set<string>): void {
    const obj = model(name);
    tint(obj, paint, 1);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material.name === TRIM) o.material.color.setHex(trim);
    });
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
        tint(bumper, paint, 1);
        into.add(bumper);
      }
    }
  }

  private placeItem(v: Vehicle, item: GridItem, paint: number, y: number): THREE.Object3D {
    const obj = model(itemModel(item));
    place(obj, footprint(v, item, y));
    lean(obj, restOf(v, item).slope);
    tint(obj, paint, toneOf(item));
    return obj;
  }

  private placeEngine(v: Vehicle, item: PartItem, paint: number): THREE.Object3D {
    const obj = model(itemModel(item));
    const at = footprint(v, item, 0);
    const anchor = engineAnchor(v.chassisId);
    place(obj, { ...at, pos: new THREE.Vector3(anchor.x, anchor.y, anchor.z) });
    tint(obj, paint, toneOf(item));
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
    tint(obj, paint, toneOf(item));
    return obj;
  }

  private riser(v: Vehicle, item: PartItem, paint: number, into: THREE.Group): Placement {
    const { at, bottom, top } = weaponStand(v, item);
    const mount = { ...at, pos: at.pos.clone().setY(top) };
    if (bottom >= top) return mount;
    const post = model('wmount_riser');
    place(post, { pos: at.pos.clone().setY(bottom), yaw: 0, scale: new THREE.Vector3(1, (top - bottom) / socket('wmount_riser', 'top').y, 1) });
    tint(post, paint, toneOf(item));
    into.add(post);
    return mount;
  }

  private buildWeapon(v: Vehicle, item: PartItem, active: boolean, still: THREE.Group, paint: number, at: Placement): void {
    const look = weaponLook(item.part.id, item.part.defId);
    const tone = toneOf(item);
    const mount = model(look.mount);
    place(mount, at);
    tint(mount, paint, tone);
    still.add(mount);

    const parts = new THREE.Group();
    const receiver = model(look.receiver);
    parts.add(receiver);
    const barrel = model(look.barrel);
    barrel.position.copy(socket(look.receiver, 'muzzle'));
    const tip = socket(look.barrel, 'tip').add(barrel.position);
    parts.add(barrel);
    if (look.extra) {
      const extra = model(look.extra);
      extra.position.copy(socket(look.receiver, 'extra'));
      parts.add(extra);
    }
    for (const p of parts.children) tint(p, paint, tone);
    const head = mergeStatic(parts);
    mount.updateMatrix();
    head.position.copy(socket(look.mount, 'head').applyMatrix4(mount.matrix));
    if (!active) {
      still.add(head);
      return;
    }
    this.body.add(head);
    this.turrets.set(item.part.id, { head, tip });
  }

  private buildWheels(v: Vehicle, body: Body, items: PartItem[], paint: number): void {
    const mounts = wheelMounts(body);
    if (items.length !== mounts.length) throw new Error(`${v.id} has ${items.length} mounted wheels, expected ${mounts.length}`);
    const tones = mounts.map((m) => {
      const inCorner = items.filter((it) => {
        const c = cellCenter(v.chassisId, it.x, it.y);
        return Math.sign(c.x) === Math.sign(m.x) && Math.sign(c.z) === Math.sign(m.z);
      });
      if (inCorner.length !== 1) throw new Error(`${v.id} has ${inCorner.length} wheel items in the corner of the wheel mount ${m.x},${m.z}, expected 1`);
      return toneOf(inCorner[0]);
    });
    mounts.forEach((m, i) => {
      const mount = new THREE.Group();
      mount.position.set(m.x, m.y - T.suspensionRest, m.z);
      const spin = this.wheelModel(body, paint, tones[i]);
      mount.add(spin);
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
    tint(raw, paint, 1);
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
    const cab = v.items.find((it) => it.kind === 'part' && BODY_PARTS.has(it.part.defId));
    if (!cab) throw new Error(`${v.id} has no cab`);
    const row = Math.max(...itemCells(cab).map((c) => c.y));
    const rear = cellRect(v.chassisId, itemCells(cab).filter((c) => c.y === row));
    const antenna = mergeStatic(wrapped(model('antenna')));
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
    const wheel = this.wheelModel(body, paint, toneOf(item));
    const at = footprint(v, item, y);
    wheel.position.set(at.pos.x, at.pos.y + body.wheelRadius, at.pos.z);
    return wheel;
  }

  private wheelModel(body: Body, paint: number, tone: number): THREE.Object3D {
    const raw = model('wheel');
    tint(raw, paint, tone);
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

export function weaponStand(v: Pick<Vehicle, 'chassisId'>, item: GridItem): { at: Placement; bottom: number; top: number } {
  const bottom = standingY(v, item);
  return { at: footprint(v, item, bottom), bottom, top: Math.max(bottom, highestAhead(v.chassisId, rectOf(v, item))) };
}

function highestAhead(chassisId: string, rect: CellRect): number {
  const nose = bodyOf(chassisId).half.x;
  if (rect.x1 >= nose) return -Infinity;
  return highestUnder(chassisId, { ...rect, x0: rect.x1, x1: nose });
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
  const side = isMounted(v.chassisId, item) ? sideOf(v, item.part) : size.w >= size.h ? 'F' : 'L';
  if (!side) throw new Error(`Armor ${item.part.id} is mounted off a side letter`);
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

function toneOf(item: GridItem): number {
  if (item.kind === 'good' || item.part.hp > 0) return 1;
  return BROKEN_TONE[partDef(item.part.defId).kind];
}

export function footprint(v: Pick<Vehicle, 'chassisId'>, item: GridItem, y: number): Placement {
  const rect = restOf(v, item).rect;
  const size = itemSize(item);
  const dx = rect.x1 - rect.x0 > 0 ? rect.x1 - rect.x0 : size.h * CELL.along;
  const dz = rect.z1 - rect.z0 > 0 ? rect.z1 - rect.z0 : size.w * CELL.across;
  const own = item.kind === 'part' ? partDef(item.part.defId) : { w: 1, h: 1 };
  const pos = new THREE.Vector3((rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2);
  if (item.rot === 0) return { pos, yaw: 0, scale: new THREE.Vector3(dx / (own.h * CELL.along), 1, dz / (own.w * CELL.across)) };
  return { pos, yaw: ROT_YAW, scale: new THREE.Vector3(dz / (own.h * CELL.along), 1, dx / (own.w * CELL.across)) };
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

function tint(obj: THREE.Object3D, paint: number, tone: number): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material;
    if (!(mat instanceof THREE.MeshLambertMaterial)) throw new Error(`Part mesh ${o.name} has material ${mat.type}, expected one Lambert material`);
    if (mat.name === PAINT) mat.color.setHex(paint);
    mat.color.multiplyScalar(tone);
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

function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
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
