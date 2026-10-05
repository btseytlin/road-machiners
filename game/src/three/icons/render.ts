// Draws one item or chassis icon from the game's own models, for npm run icons.
// The style follows the category. An item icon is a vector blueprint from blueprint.ts, in shades of its category tone.
// A chassis portrait is toon: each model keeps its flat colors through a three-step ramp under one key light, with a
// dark outline and darkened creases. Chassis drawn by the same model are told apart by 45° stripes.
// Body space as in vehicle.ts: +x is the nose, +z the truck's right, +y up.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { FACTION_COLORS, ITEM_TONES, PAL } from '../../render/palette';
import { itemTone, renderKey, type IconEntry } from '../../render/partLooks';
import { model, socket, type ModelName } from '../render/models';
import { wheelMounts } from '../../phys/body';
import { bareVehicle } from '../../sim/factory';
import { bodyOf } from '../../sim/body';
import { VehicleView } from '../render/vehicle';
import { weaponHead } from '../render/weaponHead';
import { blueprintOf, blueprintSvg, GLASS_MATERIAL, paintBlueprint, type BlueprintColors } from './blueprint';
import { boundsOf, edgeBand, solidMask, stripes, type Mask, type Pixels, type Rgba } from './lines';

// Bump when a change here alters how icons look, so the manifest test asks for npm run icons.
export const ICON_STYLE_VERSION = 9;

// top: straight down, nose up, like the inventory grid. diagonal: from the right side with the nose to the image's
// right, turned DIAGONAL_YAW_DEG toward the rear and raised DIAGONAL_PITCH_DEG, so a barrel reads lower left to upper right.
export type IconView = 'top' | 'diagonal';
export const DIAGONAL_YAW_DEG = 35;
export const DIAGONAL_PITCH_DEG = 30;

// The view the game shows per category. Every icon is diagonal, since a part seen straight down reads as flat boxes.
// Flip one and rerun npm run icons.
export type IconCategory = 'part' | 'good' | 'chassis';
export const ICON_VIEWS: Record<IconCategory, IconView> = { part: 'diagonal', good: 'diagonal', chassis: 'diagonal' };

// The one owner of how each category is drawn, in either view: items as blueprints, chassis portraits as toon.
export type IconStyle = 'line' | 'toon';
export const ICON_STYLES: Record<IconCategory, IconStyle> = { part: 'line', good: 'line', chassis: 'toon' };

// The one owner of which view the game shows for an entry.
export function iconView(entry: IconEntry): IconView {
  return ICON_VIEWS[iconCategory(entry)];
}

export function iconStyle(entry: IconEntry): IconStyle {
  return ICON_STYLES[iconCategory(entry)];
}

function iconCategory(entry: IconEntry): IconCategory {
  if (entry.section === 'good') return 'good';
  if (entry.section === 'chassis') return 'chassis';
  return 'part';
}

const CELL = PHYSICS.cell;
const SUPERSAMPLE = 4; // drawn at this multiple of the cell, then scaled down
// Share of the cell left empty on each side, room for the outline. The manifest carries it.
export const MARGIN = 0.06;
// Blueprint line widths as a share of one inventory grid row (CELL.along), so every item draws the same weight in the
// grid whatever its footprint: about 1.7 px for the outer contour and 0.9 px inside at 42 px cells.
const OUTER_CELLS = 0.04;
const INNER_CELLS = 0.022;
// Armor is built as a front plate with its outer face at +x. It turns this far about y, so the face looks at the camera.
const ARMOR_YAW = -Math.PI / 2;
const TOON_OUTLINE_PX = 4; // toon silhouette outline width at cell size
const RAMP = [0.45, 0.75, 1]; // toon light steps
// The normal change, as color distance in the normal pass, and the depth step, in 8-bit depth levels, that draw a crease.
const CREASE = { normal: 0.3, depth: 4 };
const CREASE_SHADE = 0.45; // toon crease pixels keep this share of their color
const INK = PAL.outline;
const GLASS_COLOR = 0x6a7a80; // cab windows, which the game tints by daylight
const PAINT = 'paint';
const TRIM = 'trim';

type Vec2 = { x: number; y: number };

// The barrel's head socket and tip as drawn, and the drawn pixel farthest along the barrel, all in cell pixels.
export type BarrelRead = { head: Vec2; tip: Vec2; pixelTip: Vec2 };

let shared: { renderer: THREE.WebGLRenderer; ramp: THREE.DataTexture } | null = null;

function renderer(): { renderer: THREE.WebGLRenderer; ramp: THREE.DataTexture } {
  if (shared) return shared;
  const r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  const ramp = new THREE.DataTexture(new Uint8Array(RAMP.map((v) => Math.round(v * 255))), RAMP.length, 1, THREE.RedFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  shared = { renderer: r, ramp };
  return shared;
}

// The icon at size x size pixels with a transparent background, and for an item its blueprint as one SVG group in
// size x size units.
export function renderIcon(entry: IconEntry, view: IconView, size: number): { icon: HTMLCanvasElement; svg: string | null } {
  const big = size * SUPERSAMPLE;
  const { scene, camera } = stage(entry, view);
  if (iconStyle(entry) === 'line') {
    const perMeter = CELL.along * (big / (camera.right - camera.left));
    const pen = { outer: OUTER_CELLS * perMeter, inner: INNER_CELLS * perMeter };
    const bp = blueprintOf(scene, camera, big, pen, (m) => draw(scene, camera, big, m));
    const colors = blueprintColors(entry);
    const icon = document.createElement('canvas');
    icon.width = size;
    icon.height = size;
    paintBlueprint(context(icon), bp, colors);
    return { icon, svg: `<g transform="scale(${size / big})">${blueprintSvg(bp, colors, `clip-${entry.id}`)}</g>` };
  }
  const color = draw(scene, camera, big, null);
  const normal = draw(scene, camera, big, new THREE.MeshNormalMaterial({ flatShading: true }));
  const depth = draw(scene, camera, big, new THREE.MeshDepthMaterial());
  toonInk(color, creaseMask(color, normal, depth), TOON_OUTLINE_PX * SUPERSAMPLE);
  const solid = solidMask(color);
  if (entry.rank > 1) paint(color, stripes(solid, boundsOf(solid), entry.rank - 1, TOON_OUTLINE_PX * SUPERSAMPLE), [...rgbOf(INK), 255]);
  return { icon: shrink(color, size), svg: null };
}

// The blueprint's colors from the item's tone: a light line, a deep fill and a deeper shadow of the same hue.
export function blueprintColors(entry: IconEntry): BlueprintColors {
  const tone = new THREE.Color(ITEM_TONES[itemTone(entry.id)]);
  const mix = (to: number, t: number): string => `#${tone.clone().lerp(new THREE.Color(to), t).getHexString()}`;
  return { line: mix(0xdcecff, 0.75), fill: mix(0x0a1420, 0.45), shadow: mix(0x050a12, 0.75), glass: mix(0xdcecff, 0.3) };
}

// Where the barrel reads in the drawn icon, for the orientation check. Weapons only.
export function barrelReads(entry: IconEntry, view: IconView, size: number): BarrelRead {
  if (!entry.weapon) throw new Error(`Icon ${entry.id} is not a weapon`);
  const { scene, camera, head, tip } = stage(entry, view);
  const toPx = (p: THREE.Vector3): Vec2 => {
    const ndc = p.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * size, y: ((1 - ndc.y) / 2) * size };
  };
  const at = { head: toPx(head), tip: toPx(tip) };
  const color = draw(scene, camera, size, null);
  return { ...at, pixelTip: farthestAlong(color, at.head, at.tip) };
}

type Stage = { scene: THREE.Scene; camera: THREE.OrthographicCamera; head: THREE.Vector3; tip: THREE.Vector3 };

function stage(entry: IconEntry, view: IconView): Stage {
  const scene = new THREE.Scene();
  const { root, head, tip } = build(entry);
  toon(root, iconStyle(entry));
  scene.add(root);
  const camera = frame(root, view);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  // Lit from the viewer's upper left, the same for every icon in a view.
  key.position.copy(camera.position).add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(40));
  key.position.add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-25));
  scene.add(key, new THREE.AmbientLight(0xffffff, 1.1));
  return { scene, camera, head, tip };
}

// A weapon is its mount stretched to fill the def's footprint, with the head at its authored size on the mount's head
// socket, aimed forward. The stretch shows the footprint, so weapons of one look but different sizes differ. A chassis
// is the game's own view of its bare truck, at rest.
function build(entry: IconEntry): Omit<Stage, 'scene' | 'camera'> & { root: THREE.Group } {
  const root = new THREE.Group();
  if (entry.section === 'chassis') {
    root.add(bareTruck(entry.id));
    return { root, head: new THREE.Vector3(), tip: new THREE.Vector3() };
  }
  if (!entry.weapon) {
    for (const name of entry.models) root.add(model(name));
    if (entry.section === 'armor') root.rotation.y = ARMOR_YAW;
    return { root, head: new THREE.Vector3(), tip: new THREE.Vector3() };
  }
  const look = entry.weapon;
  const mount = model(look.mount);
  const size = new THREE.Box3().setFromObject(mount).getSize(new THREE.Vector3());
  const { w, h } = entry.footprint;
  mount.scale.set((h * CELL.along) / size.x, 1, (w * CELL.across) / size.z);
  mount.updateMatrix();
  root.add(mount);
  const built = weaponHead(look);
  const at = socket(look.mount, 'head').applyMatrix4(mount.matrix);
  built.head.position.copy(at);
  root.add(built.head);
  return { root, head: at.clone(), tip: built.tip.add(at) };
}

// The truck view of a chassis with only its built-in parts, wheels at their rest height.
function bareTruck(chassisId: string): THREE.Object3D {
  const v = bareVehicle({ nextId: 0 }, { name: chassisId, faction: 'player', chassisId, pos: { x: 0, y: 0 }, heading: 0, brain: null });
  const view = new VehicleView(v, false);
  const wheels = wheelMounts(bodyOf(chassisId)).map(() => ({ steer: 0, spin: 0, suspension: PHYSICS.truck.suspensionRest }));
  view.pose({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, acc: { x: 0, y: 0, z: 0 }, wheels }, 0);
  return view.root;
}

// Swaps every material for the style's. Toon keeps the material's color on the light ramp, with faction paint as its
// color. A blueprint reads only the shape and its normals, so it draws unlit.
function toon(root: THREE.Object3D, style: IconStyle): void {
  const { ramp } = renderer();
  const paint = FACTION_COLORS.player;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const old = o.material as THREE.MeshLambertMaterial;
    // The truck view's hidden see-through silhouette and its outline hulls stay hidden: the toon style draws its own ink.
    if (!old.visible || o.userData.outline) {
      o.visible = false;
      return;
    }
    const color = { [PAINT]: paint.top, [TRIM]: paint.cab, [GLASS_MATERIAL]: GLASS_COLOR }[old.name] ?? old.color.getHex();
    o.material = style === 'toon' ? new THREE.MeshToonMaterial({ color, gradientMap: ramp }) : new THREE.MeshBasicMaterial({ color });
    // A blueprint finds the glass by its material name.
    o.material.name = old.name;
    old.dispose();
  });
}

// An orthographic camera that fits the model's vertices to the cell with MARGIN on each side.
function frame(root: THREE.Object3D, view: IconView): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center).add(viewDir(view).multiplyScalar(30));
  if (view === 'top') camera.up.set(1, 0, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const p = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) bounds.expandByPoint(camera.worldToLocal(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)));
  });
  const half = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) / 2 / (1 - 2 * MARGIN);
  const mid = bounds.getCenter(new THREE.Vector3());
  camera.left = mid.x - half;
  camera.right = mid.x + half;
  camera.top = mid.y + half;
  camera.bottom = mid.y - half;
  // Depth runs over the model alone, so the 8-bit depth pass has its full range for creases.
  camera.near = -bounds.max.z - 0.01;
  camera.far = -bounds.min.z + 0.01;
  camera.updateProjectionMatrix();
  return camera;
}

// From the model toward the camera.
function viewDir(view: IconView): THREE.Vector3 {
  if (view === 'top') return new THREE.Vector3(0, 1, 0);
  const yaw = DIAGONAL_YAW_DEG * THREE.MathUtils.DEG2RAD;
  const pitch = DIAGONAL_PITCH_DEG * THREE.MathUtils.DEG2RAD;
  // The side view looks from +z, the truck's right, so +x is the image's right. Yaw moves it toward -x, the rear.
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

function draw(scene: THREE.Scene, camera: THREE.Camera, size: number, override: THREE.Material | null): Pixels {
  const { renderer: r } = renderer();
  r.setSize(size, size, false);
  scene.overrideMaterial = override;
  r.render(scene, camera);
  scene.overrideMaterial = null;
  override?.dispose();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = context(canvas);
  ctx.drawImage(r.domElement, 0, 0);
  return { w: size, h: size, data: ctx.getImageData(0, 0, size, size).data };
}

// Where the normal or depth pass jumps between solid neighbors, by CREASE.
function creaseMask(color: Pixels, normal: Pixels, depth: Pixels): Mask {
  const solid = solidMask(color);
  const { w, h } = color;
  const out = { w, h, bits: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid.bits[y * w + x] && (jumps(normal, depth, x, y, x + 1, y) || jumps(normal, depth, x, y, x, y + 1))) out.bits[y * w + x] = 1;
    }
  }
  return out;
}

// Rings the silhouette in INK and darkens creases toward it. Every other drawn pixel turns opaque.
function toonInk(color: Pixels, creases: Mask, outline: number): void {
  const solid = solidMask(color);
  const ring = edgeBand(solid, outline);
  const ink = rgbOf(INK);
  for (let i = 0; i < solid.bits.length; i++) {
    if (ring.bits[i] && !solid.bits[i]) color.data.set([...ink, 255], i * 4);
    else toonPixel(color.data, i * 4, creases.bits[i] === 1, ink);
  }
}

// A toon pixel inside the ring: a crease darkens toward the ink, and any drawn pixel turns opaque.
function toonPixel(data: Uint8ClampedArray, at: number, crease: boolean, ink: readonly number[]): void {
  if (crease) for (let c = 0; c < 3; c++) data[at + c] = Math.round(data[at + c] * CREASE_SHADE + ink[c] * (1 - CREASE_SHADE));
  else if (data[at + 3] > 0) data[at + 3] = 255;
}

function paint(color: Pixels, mask: Mask, rgba: Rgba): void {
  for (let i = 0; i < mask.bits.length; i++) if (mask.bits[i]) color.data.set(rgba, i * 4);
}

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function jumps(normal: Pixels, depth: Pixels, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 >= normal.w || y1 >= normal.h) return false;
  const a = (y0 * normal.w + x0) * 4;
  const b = (y1 * normal.w + x1) * 4;
  if (normal.data[b + 3] === 0) return false;
  let d = 0;
  for (let c = 0; c < 3; c++) d += ((normal.data[a + c] - normal.data[b + c]) / 255) ** 2;
  return Math.sqrt(d) > CREASE.normal || Math.abs(depth.data[a] - depth.data[b]) > CREASE.depth;
}

function shrink(src: Pixels, size: number): HTMLCanvasElement {
  const full = document.createElement('canvas');
  full.width = src.w;
  full.height = src.h;
  context(full).putImageData(new ImageData(new Uint8ClampedArray(src.data), src.w, src.h), 0, 0);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = context(out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, size, size);
  return out;
}

function farthestAlong(px: Pixels, head: Vec2, tip: Vec2): Vec2 {
  const len = Math.hypot(tip.x - head.x, tip.y - head.y);
  if (len === 0) throw new Error('Barrel tip and head project to one pixel');
  const dir = { x: (tip.x - head.x) / len, y: (tip.y - head.y) / len };
  let best = { x: head.x, y: head.y };
  let far = -Infinity;
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      if (px.data[(y * px.w + x) * 4 + 3] === 0) continue;
      const along = (x - head.x) * dir.x + (y - head.y) * dir.y;
      if (along > far) [far, best] = [along, { x, y }];
    }
  }
  return best;
}

export function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas context');
  return ctx;
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// The same FNV-1a as scripts/shape-lib.mjs.
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// What an icon is drawn from: the style version, its view, its render key and the bytes of every model it draws. The
// manifest stores it so a test can tell when a model or pick changed without npm run icons.
export function iconHash(entry: IconEntry, view: IconView, modelBytes: (name: ModelName) => Uint8Array): string {
  const files = entry.models.map((name) => fnv1a(modelBytes(name))).join(',');
  return fnv1a(new TextEncoder().encode(`${ICON_STYLE_VERSION}|${view}|${renderKey(entry)}|${files}`));
}
