// Draws one item or chassis icon from the game's own models, for npm run icons.
// Each model keeps its flat colors through a three-step toon ramp under one key light. A dark silhouette outline and
// crease lines from a normal and depth pass make the shape read at 22 px. Defs drawn by the same models get pips.
// Body space as in vehicle.ts: +x is the nose, +z the truck's right, +y up.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { FACTION_COLORS, PAL } from '../../render/palette';
import { renderKey, type IconEntry } from '../../render/partLooks';
import { model, socket, type ModelName } from '../render/models';
import { weaponHead } from '../render/weaponHead';

// Bump when a change here alters how icons look, so the manifest test asks for npm run icons.
export const ICON_STYLE_VERSION = 2;

// top: straight down, nose up, like the inventory grid. diagonal: from the right side with the nose to the image's
// right, turned DIAGONAL_YAW_DEG toward the rear and raised DIAGONAL_PITCH_DEG, so a barrel reads lower left to upper right.
export type IconView = 'top' | 'diagonal';
export const DIAGONAL_YAW_DEG = 20;
export const DIAGONAL_PITCH_DEG = 20;

// The view the game shows per category: equipment top-down like the truck grid, cargo goods diagonal, trucks
// top-down beside their grid. Flip one and rerun npm run icons.
export type IconCategory = 'part' | 'good' | 'chassis';
export const ICON_VIEWS: Record<IconCategory, IconView> = { part: 'top', good: 'diagonal', chassis: 'top' };

// The one owner of which view the game shows for an entry.
export function iconView(entry: IconEntry): IconView {
  return ICON_VIEWS[iconCategory(entry)];
}

function iconCategory(entry: IconEntry): IconCategory {
  if (entry.section === 'good') return 'good';
  if (entry.section === 'chassis') return 'chassis';
  return 'part';
}

const CELL = PHYSICS.cell;
const SUPERSAMPLE = 2; // drawn at this multiple of the cell, then scaled down
// Share of the cell left empty on each side, room for the outline and pips. The manifest carries it and OUTLINE_PX,
// so the shop can crop a portrait to the truck.
export const MARGIN = 0.1;
export const OUTLINE_PX = 4; // silhouette outline width at cell size, about 1 px at 36 px
const RAMP = [0.45, 0.75, 1]; // toon light steps
const CREASE_NORMAL = 0.35; // normal change, as color distance in the normal pass, that draws a crease
const CREASE_DEPTH = 6; // depth step, in 8-bit depth levels, that draws a crease
const CREASE_SHADE = 0.45; // crease pixels keep this share of their color
const INK = PAL.outline;
const PIP_FILL = 0xf0d060;
const PIP_SHARE = 0.18; // pip diameter as a share of the cell
const GLASS_COLOR = 0x6a7a80; // cab windows, which the game tints by daylight
const PAINT = 'paint';
const TRIM = 'trim';
const GLASS = 'glass';

type Pixels = { w: number; h: number; data: Uint8ClampedArray };
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

// The icon at size x size pixels, with a transparent background.
export function renderIcon(entry: IconEntry, view: IconView, size: number): HTMLCanvasElement {
  const big = size * SUPERSAMPLE;
  const { scene, camera } = stage(entry, view);
  const color = draw(scene, camera, big, null);
  const normal = draw(scene, camera, big, new THREE.MeshNormalMaterial({ flatShading: true }));
  const depth = draw(scene, camera, big, new THREE.MeshDepthMaterial());
  ink(color, normal, depth, OUTLINE_PX * SUPERSAMPLE);
  const out = shrink(color, size);
  drawPips(out, entry.pips);
  return out;
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
  toon(root);
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
// socket, aimed forward. The stretch shows the footprint, so weapons of one look but different sizes differ.
function build(entry: IconEntry): { root: THREE.Group; head: THREE.Vector3; tip: THREE.Vector3 } {
  const root = new THREE.Group();
  if (!entry.weapon) {
    for (const name of entry.models) root.add(model(name));
    return { root, head: new THREE.Vector3(), tip: new THREE.Vector3() };
  }
  const look = entry.weapon;
  const mount = model(look.mount);
  const size = new THREE.Box3().setFromObject(mount).getSize(new THREE.Vector3());
  mount.scale.set((entry.footprint.h * CELL.along) / size.x, 1, (entry.footprint.w * CELL.across) / size.z);
  mount.updateMatrix();
  root.add(mount);
  const built = weaponHead(look);
  const at = socket(look.mount, 'head').applyMatrix4(mount.matrix);
  built.head.position.copy(at);
  root.add(built.head);
  return { root, head: at.clone(), tip: built.tip.add(at) };
}

function toon(root: THREE.Object3D): void {
  const { ramp } = renderer();
  const paint = FACTION_COLORS.player;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const old = o.material as THREE.MeshLambertMaterial;
    const color = { [PAINT]: paint.top, [TRIM]: paint.cab, [GLASS]: GLASS_COLOR }[old.name] ?? old.color.getHex();
    o.material = new THREE.MeshToonMaterial({ color, gradientMap: ramp });
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

// Darkens creases where the normal or depth pass jumps, then rings the silhouette with INK.
function ink(color: Pixels, normal: Pixels, depth: Pixels, outline: number): void {
  const solid = solidOf(color);
  const crease = maskOf(color, (x, y) => solid(x, y) && (jumps(normal, depth, x, y, x + 1, y) || jumps(normal, depth, x, y, x, y + 1)));
  const ring = maskOf(color, (x, y) => !solid(x, y) && nearSolid(solid, x, y, outline));
  const inkRgb = [(INK >> 16) & 255, (INK >> 8) & 255, INK & 255];
  const { data } = color;
  for (let i = 0; i < ring.length; i++) {
    const at = i * 4;
    if (ring[i]) data.set([...inkRgb, 255], at);
    else if (crease[i]) for (let c = 0; c < 3; c++) data[at + c] = Math.round(data[at + c] * CREASE_SHADE + inkRgb[c] * (1 - CREASE_SHADE));
    else if (data[at + 3] > 0) data[at + 3] = 255;
  }
}

function solidOf({ w, h, data }: Pixels): (x: number, y: number) => boolean {
  return (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 127;
}

function maskOf({ w, h }: Pixels, test: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = test(x, y) ? 1 : 0;
  return mask;
}

function jumps(normal: Pixels, depth: Pixels, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 >= normal.w || y1 >= normal.h) return false;
  const a = (y0 * normal.w + x0) * 4;
  const b = (y1 * normal.w + x1) * 4;
  if (normal.data[b + 3] === 0) return false;
  let d = 0;
  for (let c = 0; c < 3; c++) d += ((normal.data[a + c] - normal.data[b + c]) / 255) ** 2;
  return Math.sqrt(d) > CREASE_NORMAL || Math.abs(depth.data[a] - depth.data[b]) > CREASE_DEPTH;
}

function nearSolid(solid: (x: number, y: number) => boolean, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && solid(x + dx, y + dy)) return true;
  }
  return false;
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

// n pips in a row along the bottom right corner, the first nearest the corner.
function drawPips(canvas: HTMLCanvasElement, n: number): void {
  const ctx = context(canvas);
  const d = canvas.width * PIP_SHARE;
  const edge = Math.max(1, d * 0.2);
  for (let i = 0; i < n; i++) {
    const x = canvas.width - d * 0.7 - i * (d + edge);
    const y = canvas.height - d * 0.7;
    ctx.beginPath();
    ctx.arc(x, y, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = hex(PIP_FILL);
    ctx.fill();
    ctx.lineWidth = edge;
    ctx.strokeStyle = hex(INK);
    ctx.stroke();
  }
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

// What an icon is drawn from: the style version, its view, its render key and the bytes of every model it draws.
// The manifest stores it so a test can tell when a model or pick changed without npm run icons.
export function iconHash(entry: IconEntry, view: IconView, modelBytes: (name: ModelName) => Uint8Array): string {
  const files = entry.models.map((name) => fnv1a(modelBytes(name))).join(',');
  return fnv1a(new TextEncoder().encode(`${ICON_STYLE_VERSION}|${view}|${renderKey(entry)}|${files}`));
}
