// Trucks drawn as one base model per chassis, with every grid item's model from the shared kit on its own cells.
// Items stand on the model's top surface under their projected footprint. A mounted engine stands at the model's engine anchor.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the collider center. Models share that frame.
// A gun stands on a post that lifts its head over the cab ahead and over every drawn item and body surface its barrel can sweep.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chassisDef } from '../../data/chassis';
import { partDef, type PartDef, type PartKind, type WeaponDef } from '../../data/parts';
import { PHYSICS } from '../../data/physics';
import { wheelMounts } from '../../phys/body';
import { aimWithin, fireSpans, openSides, type FireSpan } from '../../sim/armor';
import { CLIP_TOLERANCE, bodyOf, cellCenter, cellRect, engineAnchor, highestUnder, restOn, surfaceAt, surfaceSamples, type Body, type CellRect, type Rest } from '../../sim/body';
import { headingOf, headingQuat, type V3, type VehicleFrame } from '../../phys/frames';
import { FACTION_COLORS, PAL } from '../../render/palette';
import { BODY_PARTS, baseModel, grayShare, grayed, jagOffset, partModel, weaponLook, wearLookStep } from '../../render/partLooks';
import { baseGrid, isMounted, itemCells, itemSize, plateSide, type SideLetter } from '../../sim/grid';
import type { GridItem, Vehicle, World } from '../../sim/types';
import { angleDiff, DEG } from '../../sim/vec';
import { clearTop, headShape, sweepOf, type Obstacle } from './gunClearance';
import { model, outlineOf, socket, TRUCK_BIT, type ModelName } from './models';
import { hashStr } from '../../render/noise';
import { onAir, radioSpeakers } from '../../sim/dialogue';
import { TruckMotion, WHIPS } from './truckMotion';
import { weaponHead } from './weaponHead';

const T = PHYSICS.truck;
const CELL = PHYSICS.cell;


type PartItem = Extract<GridItem, { kind: 'part' }>;

// Material name that takes the faction color.
const PAINT = 'paint';
const RADIO = 'radio_light'; // the antenna bulb material, lit while the truck is on the radio
const LAMP = 'light'; // the headlight face material in the nose and base models
const GLASS = 'glass'; // the cab window material in the base models, tinted by the daylight
const TRIM = 'trim'; // base material that takes the faction cab color

// Color factor for every material of a broken part.
const BROKEN_TONE: Record<PartKind, number> = { weapon: 0.5, armor: 0.6, engine: 0.6, cargo: 0.6, core: 0.6, scanner: 0.6, store: 0.6, utility: 0.6 };

// Yaw for rotation 1. Local +x, the model's front, turns to the truck's left.
const ROT_YAW = Math.PI / 2;

// Yaw that turns an armor model's outer face, local +x, to its side. Local +z is the truck's right.
const SIDE_YAW: Record<SideLetter, number> = { F: 0, B: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 };

// Bumpers are authored 1 m tall with their top on the deck top. They stretch to the chassis box height plus the skirt.
const EDGE_H = 1;
const SIDE_SKIN = 0.1; // meters a mounted side plate stands out from the model face
const GUN_GAP = 0.03; // meters a gun head stands above the highest thing it sweeps over
const SAMPLE_REACH = 0.1; // meters past the head's reach where a body sample's center can still have its box under the head
const SKIRT = 0.22; // meters a base hangs below the collider, SKIRT in tools/blender/parts_common_base.py

// A truck behind terrain or props shows through as a flat faction-color silhouette.
const SILHOUETTE_OPACITY = 0.5;
const SILHOUETTE_ORDER = 810; // after opaque ground, props and trucks; below the path (820) and zones (850)
const TRUCK_STENCIL = TRUCK_BIT; // stencil bit marking pixels where a truck or its silhouette is already drawn

type Wheel = { mount: THREE.Group; spin: THREE.Object3D; restY: number };
// A shock stretches from its body mount, which leans with the body, down to its wheel's hub.
type Shock = { obj: THREE.Object3D; top: THREE.Vector3; wheel: number; z: number };
// An axle beam joins the inner faces of two wheels, from wheel a on the left to wheel b on the right.
// inset: meters from a wheel's center to its inner face.
type Axle = { obj: THREE.Object3D; a: number; b: number; inset: number };

// Suspension parts are authored for a 1 m wheel radius and 1 m long along their +y.
const SHOCK_R = 0.2; // coil radius of the coilover model at a 1 m wheel radius
const UP = new THREE.Vector3(0, 1, 0);
const ANTENNA_INSET = 0.12; // meters from the body side and the cab's back edge
const RADIO_TIP = 1.6; // meters up the antenna to the bulb
const RADIO_HALO = 0.6; // meters across the lit bulb's glow
const CHAIN_SIDE = 0.4; // fraction of the half width from the center line to the chain

// A turning weapon head, its barrel tip in head space, and where its gun can fire in degrees off the truck heading.
type Turret = { head: THREE.Group; tip: THREE.Vector3; spans: FireSpan[] };

// How a part draws: the broken tone, its wear look step and the id that seeds its jag. A good has step 0 and no id.
type Look = { tone: number; step: number; partId: string | null };
// A flat model has no thickness, so its jag measures from this extent instead.
const THINNEST_FLOOR = 0.01;
const PRISTINE: Look = { tone: 1, step: 0, partId: null };

// A point on a part, local to a parent that moves with the truck.
type Anchor = { local: THREE.Vector3; parent: THREE.Object3D };

// Where a model goes in body space.
type Placement = { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 };

// A model rebuilds only when this changes: chassis, faction, and every grid item with its place and wear look step.
export function signatureOf(v: Vehicle): string {
  const items = v.items
    .map((it) => {
      const what = it.kind === 'part' ? `${it.part.defId}#${it.part.id}:${wearLookStep(it.part)}` : it.good;
      return `${what}@${it.x},${it.y},${it.rot}`;
    })
    .join(',');
  return `${v.chassisId}|${v.faction}|${items}`;
}

// The view of a vehicle that must be drawn.
export function viewOf(views: Map<string, VehicleView>, id: string): VehicleView {
  const view = views.get(id);
  if (!view) throw new Error(`Vehicle ${id} has no view`);
  return view;
}

export class VehicleView {
  readonly root = new THREE.Group();
  // The leaning part of the truck. Wheels, shocks and axles stay on the root with the physics pose.
  private readonly body = new THREE.Group();

  private sig = '';
  private wheels: Wheel[] = [];
  private shocks: Shock[] = [];
  private axles: Axle[] = [];
  private motion!: TruckMotion; // set by rebuild
  private running = false;
  private turrets = new Map<string, Turret>(); // key: weapon part id
  private anchors = new Map<string, Anchor>(); // key: part id
  private heading = 0;
  private lampMat = new THREE.MeshBasicMaterial({ color: PAL.lamp.off });
  private radioMat = new THREE.MeshBasicMaterial({ color: PAL.radioLight.off });
  private halo: THREE.Sprite | null = null; // the red glow around a lit antenna bulb, set by buildLooseParts
  private radioOn = false;
  private glassMat = new THREE.MeshLambertMaterial({ flatShading: true });
  private readonly glassGlow = new THREE.Color(0); // kept across rebuilds, which replace the glass material
  private silhouetteMat!: THREE.MeshBasicMaterial; // set by rebuild
  private darkMat!: THREE.MeshBasicMaterial; // set by rebuild
  private dark = false;

  constructor(v: Vehicle, seen: boolean) {
    this.root.add(this.body);
    this.update(v, seen);
  }

  // seen: the player sees the vehicle now, so it shows its silhouette where something nearer covers it.
  update(v: Vehicle, seen: boolean): void {
    const sig = signatureOf(v);
    if (sig !== this.sig) this.rebuild(v);
    this.sig = sig;
    this.silhouetteMat.visible = seen;
    this.running = engineRuns(v);
  }

  // dt: seconds since the last pose, for the body's lean and the swinging parts.
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

  // Hubs follow the physics suspension. Shock tops follow the leaning body.
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

  // lit: the antenna bulb glows red with a halo while the truck talks on the radio.
  radio(lit: boolean): void {
    this.radioOn = lit;
    this.radioMat.color.setHex(radioColor(lit));
    if (this.halo) this.halo.visible = lit;
  }

  // dark: the player sees only the headlights, so the truck draws as a black shape around its lit lamps.
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

  // The silhouette twins, outline meshes and lit lamps keep their look in the dark.
  private keepsLook(o: THREE.Mesh): boolean {
    const m = o.material;
    return m === this.silhouetteMat || m === this.lampMat || m === this.radioMat || o.userData.outline;
  }

  // glow: the color cab windows add over their lit color.
  windows(glow: THREE.Color): void {
    this.glassGlow.copy(glow);
    this.glassMat.emissive.copy(glow);
  }

  // yawOf gives each weapon part's map-space heading (radians, 0 = +x). null points its turret forward.
  // A turret turns only within its fire spans, so its barrel shows where it can shoot.
  aim(yawOf: (partId: string) => number | null): void {
    for (const [id, turret] of this.turrets) {
      const yaw = yawOf(id);
      const want = yaw === null ? 0 : angleDiff(this.heading, yaw) / DEG;
      const turn = aimWithin(sweepOf(turret.spans, true), want);
      const q = headingQuat(turn * DEG);
      turret.head.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  // The world point where a mounted weapon's rounds leave its barrel, and the unit direction they leave in.
  // Read it after pose() and aim() for the frame.
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
    // disposeChildren disposed the lamp material, so a new one keeps the lamp state.
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
    // The transmission and the tank of a truck that does not show its cores sit inside the body. A part with no surface
    // to rest on would float, so it is not drawn either.
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

  // One part's model. The cab core has no model: the base draws the cab.
  // Guns wait in guns, so they draw after everything their heads can turn over. Items a gun can hit add to obstacles.
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
    // A mounted plate hangs on the model's outer face, so it rests on no surface.
    if (def.kind === 'armor') return this.placeArmor(v, body, item, paint, mounted);
    // An engine on its mount stands in the engine bay and shows through the cutout.
    if (def.kind === 'engine' && mounted) return this.placeEngine(v, item, paint);
    return this.placeItem(v, item, paint, standingY(v, item));
  }

  // Adds a placed part model and anchors the part at the center of the model, in body space.
  private addPart(still: THREE.Group, item: PartItem, obj: THREE.Object3D): void {
    still.add(obj);
    this.anchors.set(item.part.id, { local: new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()), parent: this.body });
  }

  // Parts with no model of their own sit on the body surface at their cells: a hidden tank, a floating spare and the cab.
  // A part in the cargo rows past the grid rides at the rear, where the cargo model stands for it.
  private anchorUndrawn(v: Vehicle, body: Body): void {
    for (const item of v.items) {
      if (item.kind !== 'part' || this.anchors.has(item.part.id)) continue;
      const local = onChassis(v, item) ? surfacePoint(v, item) : new THREE.Vector3(-body.half.x, body.half.y, 0);
      this.anchors.set(item.part.id, { local, parent: this.body });
    }
  }

  // Whether the view draws the part, so partPoint() knows it.
  hasPart(partId: string): boolean {
    return this.anchors.has(partId);
  }

  // The world point of a part, in meters, valid after pose().
  partPoint(partId: string): V3 {
    const anchor = this.anchors.get(partId);
    if (!anchor) throw new Error(`Vehicle view has no part ${partId}`);
    anchor.parent.updateWorldMatrix(true, false);
    const p = anchor.local.clone().applyMatrix4(anchor.parent.matrixWorld);
    return { x: p.x, y: p.y, z: p.z };
  }

  // The world point of the truck's center.
  center(): V3 {
    const { x, y, z } = this.root.position;
    return { x, y, z };
  }

  // Every truck mesh marks its pixels in the stencil and gets a twin with the silhouette material under the same parent.
  // The twin draws only where it is behind the depth buffer and the stencil is unmarked, so it never covers the visible truck.
  // It marks what it draws, so overlapping parts paint each pixel once.
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

  // Headlight faces share the lamp material, so lamps() switches them all. The antenna bulb shares the radio material.
  // Cab windows share the glass material, so windows() tints them all.
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

  // The chassis base model at the collider center, and kit bumpers on its front and back row cells unless a ram or cage covers them.
  private buildBase(v: Vehicle, body: Body, name: ModelName, into: THREE.Group, paint: number, trim: number, bumperless: Set<string>, look: Look): void {
    const obj = model(name);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material.name === TRIM) o.material.color.setHex(trim);
    });
    tint(obj, paint, look);
    this.useLamp(obj);
    into.add(obj);
    const grid = baseGrid(v.chassisId);
    const stretch = (2 * body.half.y + SKIRT) / EDGE_H; // bumpers hang to the skirt bottom
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

  // A part or good model at the center of its projected footprint at height y, turned for rotation 1 and stretched to the footprint.
  private placeItem(v: Vehicle, item: GridItem, paint: number, y: number): THREE.Object3D {
    const obj = model(itemModel(item));
    place(obj, footprint(v, item, y));
    lean(obj, restOf(v, item).slope);
    tint(obj, paint, lookOf(item));
    return obj;
  }

  // The engine stands at the model's engine anchor, whatever cells it takes in the grid.
  private placeEngine(v: Vehicle, item: PartItem, paint: number): THREE.Object3D {
    const obj = model(itemModel(item));
    const at = footprint(v, item, 0);
    const anchor = engineAnchor(v.chassisId);
    place(obj, { ...at, pos: new THREE.Vector3(anchor.x, anchor.y, anchor.z) });
    tint(obj, paint, lookOf(item));
    return obj;
  }

  // Armor is authored as a front-edge row of N cells with its outer face at +x.
  // It turns to the side its cells lie on and stretches to their span. A spare armor part lies as a front or a left row on its row surface.
  // A mounted plate or cage hangs from the deck top. On a side it is skin: thin, on the model's outer face.
  // A mounted cage or ram takes the bumper's place. A mounted ram hangs from the chassis bottom.
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

  // A gun's post starts on the model's surface under it and rises to top, where the mount stands. A mount within
  // CLIP_TOLERANCE of that surface, or over air, gets no post.
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

  // The mount fills the footprint. The head keeps its authored size, sits at the mount's head socket and turns with aim.
  // The head comes from weaponHead(): the receiver is its origin, the barrel joins at the muzzle socket and the extra at its extra socket.
  // The post lifts the head over the cab ahead and over every obstacle and body surface the head can sweep, see clearTop().
  private buildWeapon(v: Vehicle, item: PartItem, active: boolean, still: THREE.Group, paint: number, obstacles: readonly Obstacle[]): void {
    const look = weaponLook(item.part.id, item.part.defId);
    const wear = lookOf(item);
    const { head: parts, tip } = weaponHead(look);
    for (const p of parts.children) tint(p, paint, wear);
    const head = mergeStatic(parts);

    const stand = weaponStand(v, item);
    const headAt = socket(look.mount, 'head');
    const spans = fireSpans((partDef(item.part.defId) as WeaponDef).arc, openSides(v, item));
    const shape = headShape(head, socket(look.receiver, 'muzzle').x);
    // The head socket turns and stretches with the mount, so its x and z come from the mount's matrix.
    const mount = model(look.mount);
    place(mount, stand.at);
    mount.updateMatrix();
    const pivot = headAt.clone().applyMatrix4(mount.matrix);
    const own = rectOf(v, item);
    const ground = surfaceSamples(v.chassisId, pivot, Math.max(shape.core, shape.reach) + SAMPLE_REACH)
      .filter((s) => !(s.x >= own.x0 && s.x <= own.x1 && s.z >= own.z0 && s.z <= own.z1))
      .map((s): Obstacle => ({ x0: s.x - s.half, x1: s.x + s.half, z0: s.z - s.half, z1: s.z + s.half, top: s.y }));
    const clear = clearTop(pivot, shape, sweepOf(spans, active), [...obstacles, ...ground], GUN_GAP);
    const top = Math.max(stand.top, clear - headAt.y - shape.bottom);
    if (!Number.isFinite(top)) throw new Error(`Gun ${item.part.id} on ${v.chassisId} has a post height of ${top}`);

    const at = this.riser(stand, item, paint, still, top);
    place(mount, at);
    tint(mount, paint, wear);
    still.add(mount);
    mount.updateMatrix();
    head.position.copy(headAt.applyMatrix4(mount.matrix));
    this.anchors.set(item.part.id, { local: head.position.clone(), parent: this.body });
    if (!active) {
      still.add(head);
      return;
    }
    this.body.add(head);
    this.turrets.set(item.part.id, { head, tip, spans });
  }

  // Wheels hang at the physics wheel mounts, scaled from the 1 m model to the look's radius and width.
  private buildWheels(v: Vehicle, body: Body, items: PartItem[], paint: number): void {
    const mounts = wheelMounts(body);
    if (items.length !== mounts.length) throw new Error(`${v.id} has ${items.length} mounted wheels, expected ${mounts.length}`);
    // A grid wheel belongs to the physics wheel of its corner of the truck.
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

  // A coilover inboard of every wheel, from the chassis bottom to the hub, and an axle beam across each wheel pair.
  private buildSuspension(body: Body, paint: number): void {
    const thick = new THREE.Vector3(body.wheelRadius, 1, body.wheelRadius);
    const inset = body.wheelHalfWidth + SHOCK_R * body.wheelRadius;
    wheelMounts(body).forEach((m, wheel) => {
      const z = -Math.sign(m.z) * inset;
      const obj = this.stretchModel('coilover', thick, paint);
      this.shocks.push({ obj, top: new THREE.Vector3(m.x, -body.half.y, m.z + z), wheel, z });
    });
    // wheelMounts lists the front pair, then the rear pair, each left then right.
    for (const [a, b] of [[0, 1], [2, 3]]) this.axles.push({ obj: this.stretchModel('axle', thick, paint), a, b, inset: body.wheelHalfWidth });
  }

  private stretchModel(name: ModelName, thick: THREE.Vector3, paint: number): THREE.Object3D {
    const raw = model(name);
    tint(raw, paint, PRISTINE);
    const inner = new THREE.Group();
    inner.add(raw);
    const merged = mergeStatic(inner);
    merged.scale.copy(thick);
    // The outer group takes the stretch and the turn; the merged model inside keeps its thickness scale.
    const outer = new THREE.Group();
    outer.add(merged);
    this.root.add(outer);
    return outer;
  }

  // A whip antenna at the back corner of the cab roof, and a tow chain under the rear bumper.
  // A truck with cargo rows past its grid has the cargo model at its rear, so it gets no chain.
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

  // A spare wheel stands on its row surface at its cell.
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

// A truck with a working mounted engine shakes at idle.
function engineRuns(v: Vehicle): boolean {
  return v.items.some((it) => it.kind === 'part' && it.part.hp > 0 && partDef(it.part.defId).kind === 'engine' && isMounted(v.chassisId, it));
}

function wrapped(obj: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

// Stands a model authored along +y between two points. at: where along its length the model's origin sits, 0 at from, 1 at to.
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

// Rows past the chassis grid come from mounted cargo parts. The cargo model stands for them, so their items are not drawn.
function onChassis(v: Vehicle, item: GridItem): boolean {
  const grid = baseGrid(v.chassisId);
  const cells = itemCells(item);
  const inside = cells.filter((c) => c.y < grid.h).length;
  if (inside !== 0 && inside !== cells.length) throw new Error(`Item ${item.id} lies across the end of the ${v.chassisId} grid`);
  return inside === cells.length;
}

// Looks of mounted armor that takes the bumper's place.
const BUMPER_LOOKS: readonly string[] = ['ram', 'cage'];

// True for a transmission or a fuel tank on a chassis whose body covers them.
function hidesInside(v: Pick<Vehicle, 'chassisId'>, item: GridItem): boolean {
  if (item.kind !== 'part') return false;
  const def = partDef(item.part.defId);
  return def.kind === 'core' && (def.role === 'transmission' || def.role === 'tank') && !chassisDef(v.chassisId).showsCores;
}

// True for a mounted ram or cage.
function replacesBumper(v: Vehicle, item: GridItem): boolean {
  if (item.kind !== 'part' || !isMounted(v.chassisId, item)) return false;
  const def = partDef(item.part.defId);
  return def.kind === 'armor' && BUMPER_LOOKS.includes(def.look);
}

// Cells of mounted rams and cages, which replace the bumper there.
function bumperlessCells(v: Vehicle, items: GridItem[]): Set<string> {
  const cells = new Set<string>();
  for (const item of items.filter((it) => replacesBumper(v, it))) for (const c of itemCells(item)) cells.add(`${c.x},${c.y}`);
  return cells;
}

// Where a weapon stands. The mount stands at the gun's rest, or higher up to the highest point ahead of it in its own lane,
// so the turret clears the cab in front but not a stack or a tire off to the side. The riser post stands on the highest
// surface under its column, so a mount perched on a cab edge never hangs over the lower bed. A mount within
// CLIP_TOLERANCE of that surface stands on it with no post. A spare over air gets no post. The post and the mount share
// x and z, at the center of the footprint.
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

// Where a post starts under a mount at top, given the surface under the post. No post when the mount touches it or nothing holds one.
export function postBottom(foot: number, top: number): number {
  return foot !== -Infinity && top - foot > CLIP_TOLERANCE ? foot : top;
}

// The riser post's column, in body meters, centered under a gun mount at. The post stands on the highest surface under
// it. Its thin foot plate and gussets may overlap a taller edge next to it, so a post beside a cab wall still stands.
export function postColumn(at: THREE.Vector3): CellRect {
  const corner = socket('wmount_riser', 'column');
  const half = { x: Math.abs(corner.x), z: Math.abs(corner.z) };
  return { x0: at.x - half.x, x1: at.x + half.x, z0: at.z - half.z, z1: at.z + half.z };
}

// The highest model surface between the front of a rect and the nose, over the rect's width, in body meters.
function highestAhead(chassisId: string, rect: CellRect): number {
  const nose = bodyOf(chassisId).half.x;
  if (rect.x1 >= nose) return -Infinity;
  return highestUnder(chassisId, { ...rect, x0: rect.x1, x1: nose });
}

// The center of an item's cells on the body surface, in body meters.
function surfacePoint(v: Pick<Vehicle, 'chassisId'>, item: GridItem): THREE.Vector3 {
  const rect = rectOf(v, item);
  return new THREE.Vector3((rect.x0 + rect.x1) / 2, surfaceAt(v.chassisId, rect), (rect.z0 + rect.z1) / 2);
}

function rectOf(v: Pick<Vehicle, 'chassisId'>, item: GridItem): CellRect {
  return cellRect(v.chassisId, itemCells(item));
}

// A good or loose part that finds no surface to rest on. Guns stand on posts, armor lies on the faces and mounted
// engines and wheels have their own spots, so they always show.
export function wouldFloat(v: Pick<Vehicle, 'chassisId'>, item: GridItem): boolean {
  return !alwaysDrawn(v, item) && restOf(v, item).perched;
}

// Weapons, armor, and engines and wheels on their mounts.
function alwaysDrawn(v: Pick<Vehicle, 'chassisId'>, item: GridItem): boolean {
  if (item.kind !== 'part') return false;
  const def = partDef(item.part.defId);
  if (def.kind === 'weapon' || def.kind === 'armor') return true;
  return (def.kind === 'engine' || isWheel(def)) && isMounted(v.chassisId, item);
}

// Where an item rests on the model, see restOn().
function restOf(v: Pick<Vehicle, 'chassisId'>, item: GridItem): Rest {
  return restOn(v.chassisId, rectOf(v, item));
}

// The model surface an item stands on, in body meters.
export function standingY(v: Pick<Vehicle, 'chassisId'>, item: GridItem): number {
  return restOf(v, item).y;
}

// The side an armor part covers, by plateSide(), checked to be one cell deep.
function armorSide(v: Vehicle, item: PartItem): SideLetter {
  const size = itemSize(item);
  const side = plateSide(v.chassisId, item);
  const depthCells = ['F', 'B'].includes(side) ? size.h : size.w;
  if (depthCells !== 1) throw new Error(`Armor ${item.part.id} is ${depthCells} cells deep on side ${side}, expected 1`);
  return side;
}

// How far a plate reaches along its side: its projected span if mounted, its cells otherwise.
function armorSpan(item: PartItem, rect: CellRect, mounted: boolean, across: boolean): number {
  const size = itemSize(item);
  if (!mounted) return across ? size.w * CELL.across : size.h * CELL.along;
  return across ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
}

// A front or back plate fills the bumper's place behind the face. A side plate is skin outside the face.
function seatArmor(pos: THREE.Vector3, rect: CellRect, side: SideLetter, depth: number): void {
  if (side === 'F') pos.x = rect.x1 - depth / 2;
  else if (side === 'B') pos.x = rect.x0 + depth / 2;
  else pos.z += Math.sign(pos.z) * (depth / 2);
}

// A bumper fills its cell against the model's nose or tail face, as wide as the cell's projected column.
function bumperPlacement(rect: CellRect, nose: boolean, top: number, yaw: number, stretch: number): Placement {
  const x = nose ? rect.x1 - CELL.along / 2 : rect.x0 + CELL.along / 2;
  const width = rect.z1 > rect.z0 ? (rect.z1 - rect.z0) / CELL.across : 1;
  return { pos: new THREE.Vector3(x, top, (rect.z0 + rect.z1) / 2), yaw, scale: new THREE.Vector3(1, stretch, width) };
}

// How deep an armor model stands: a mounted side plate is thin skin, any other armor fills its cell.
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

// The base body and bumpers wear like the cab part. A truck with no cab part keeps the pristine base.
function cabLook(v: Vehicle): Look {
  const cab = cabOf(v);
  return cab ? lookOf(cab) : PRISTINE;
}

function lookOf(item: GridItem): Look {
  if (item.kind === 'good') return PRISTINE;
  const step = wearLookStep(item.part);
  return { tone: item.part.hp > 0 ? 1 : BROKEN_TONE[partDef(item.part.defId).kind], step, partId: item.part.id };
}

// Center of an item's projected footprint at height y, with the turn and stretch that fit the model to the footprint.
// A model is authored for its rotation 0 cells. Rotation 1 turns it, so its length runs across the truck.
// A ring cell projects to a zero-width span. The item then keeps its nominal size along that axis.
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

// A mounted plate is skin on the body, and a mounted engine sits in its bay under the hood cutout. Neither stands in a gun's way.
function blocksGuns(v: Vehicle, item: PartItem, def: PartDef): boolean {
  return !(isMounted(v.chassisId, item) && (def.kind === 'armor' || def.kind === 'engine'));
}

// The upright box a placed model fills, in body space.
function obstacleOf(obj: THREE.Object3D): Obstacle {
  const box = new THREE.Box3().setFromObject(obj);
  return { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, top: box.max.y };
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Tilts a placed part to lie on a slope, rising by slope.x per meter toward the nose and slope.z toward the right.
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

// Paint materials take the faction color. A worn part grays and jags, and a broken part darkens all its materials.
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

// Moves each vertex by an offset seeded by the part id and its position in the model's own space, so it ignores how the
// model is placed. Corners that share a position move together, so faces stay closed. The hulks in obstacles.ts share it.
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

// One mesh per material color for everything under group, in group space. The returned group has an identity transform.
// A mirrored mesh turns its triangles inside out. Swapping two corners of each triangle turns them back.
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
  // Lamp and window meshes keep their shared material, so they stay separate meshes.
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

// A soft red glow at the antenna tip, so a bulb a few centimeters wide still shows at game zoom.
function radioHalo(lit: boolean): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap(), color: PAL.radioLight.on, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(RADIO_HALO);
  sprite.raycast = () => {}; // a glow is not part of the truck, so clicks pass through it
  sprite.position.set(0, RADIO_TIP, 0);
  sprite.visible = lit;
  return sprite;
}

// One soft round falloff shared by every halo, so a rebuild builds no texture.
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
      if (o instanceof THREE.Sprite) o.material.dispose(); // the shared halo map stays
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
        // A dark truck keeps its own materials aside while it draws black.
        o.userData.litMat?.dispose();
      }
    });
  }
}

// Every wheel part, whatever its size, hangs on a wheel mount.
function isWheel(def: PartDef): boolean {
  return def.kind === 'core' && def.role === 'wheel';
}

// Wall-clock timing of the antenna radio light, so a call that freezes turns still blinks.
export const RADIO_LIGHT = {
  periodMs: 700, // one on and off cycle
  spokeMs: 3000, // how long a truck keeps blinking after it talked in a turn
};

// Who blinks: the trucks on air now, and trucks that talked in a recently seen world.
export class RadioLights {
  private readonly until = new Map<string, number>();
  private noted: World | null = null;
  private air: { world: World; ids: Set<string> } | null = null; // onAir of the last world asked, once per world

  note(world: World, now: number): void {
    for (const [id, end] of this.until) if (end <= now) this.until.delete(id);
    if (world === this.noted) return;
    this.noted = world;
    for (const id of radioSpeakers(world.events, world.player.vehicleId)) this.until.set(id, now + RADIO_LIGHT.spokeMs);
  }

  lit(world: World, id: string, now: number): boolean {
    const end = this.until.get(id);
    if (!this.onAir(world).has(id) && (end === undefined || end <= now)) return false;
    const phase = (now / RADIO_LIGHT.periodMs + hashStr(id)) % 1;
    return phase < 0.5;
  }

  private onAir(world: World): Set<string> {
    if (this.air?.world !== world) this.air = { world, ids: new Set(onAir(world)) };
    return this.air.ids;
  }
}
