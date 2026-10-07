// Blender-made models from public/models/, built by the scripts in tools/blender/.
// loadModels() runs once at boot. model() hands out clones with their own materials.
// socket() gives the attach points that scripts mark with Kit.socket().
// outlineOf() and outlineProps() give models their dark outline.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL } from '../../render/palette';
import { WEAPON_POOLS } from '../../render/partLooks';

const NAMES = [
  'base_scout',
  'base_van',
  'base_longbed',
  'base_hauler',
  'base_tractor',
  'base_wagon',
  'base_carrier',
  'base_buggy',
  'base_courier',
  'base_jeep',
  'base_convertible',
  'base_bus',
  'base_loader',
  'base_niva',
  'base_bukhanka',
  'base_lincoln',
  'wmount_riser',
  'wreck',
  'rock',
  'pebbles',
  'scrub',
  'desert_stones',
  'desert_scrub',
  'cactus',
  'building',
  'crates',
  'water_tower',
  'palm',
  'dead_tree',
  'bunker',
  'sandbags',
  'tank_trap',
  'silo',
  'ship_hull',
  'ship_nose',
  'reactor',
  'hull_chunk',
  'ship_bow',
  'ship_cage',
  'ship_hub',
  'hull_shell',
  'hull_drum',
  'hull_shard',
  'hull_tower',
  'hull_gantry',
  'rim_rock',
  'bridge',
  'pump_station',
  'lock_gate',
  'glass_flats',
  'power_pole',
  'billboard',
  'crag',
  'tank_hulk',
  'ruin_house',
  'bridge_broken',
  'gas_station',
  'ship_wing',
  'escape_pod',
  'habitat_cylinder',
  'wing_shard',
  'power_cell',
  'wing_deck',
  'ship_wing_deck',
  'ship_flap',
  'shack',
  'fence',
  'junk',
  'farmhouse',
  'barn',
  'drums',
  'woodpile',
  'quonset',
  'guard_post',
  'army_truck',
  'barrier',

  'bumper_front',
  'bumper_rear',
  'wheel',
  'coilover',
  'axle',
  'antenna',
  'tow_chain',
  'transmission',
  'fuel_tank',
  'scanner',
  'store_jerrycans',
  'store_locker',

  'cab_seat',
  'cab_pickup',
  'cab_hardtop',

  'eng_stock',
  'eng_tuned_v8',
  'eng_flat_four',
  'eng_workhorse_diesel',
  'eng_racing_v6',
  'eng_heavy_diesel',
  'eng_turbine',

  'arm_plates',
  'arm_cage',
  'arm_ram',
  'arm_scrap_panels',
  'arm_ceramic_plates',
  'arm_spaced',
  'arm_reinforced_cage',
  'arm_plow_ram',
  'arm_plate',
  'arm_scrap_sheet',
  'arm_ceramic_tile',

  'cargo_rack',
  'cargo_trailer_box',
  'cargo_panniers',
  'cargo_flatbed',
  'cargo_light_frame',
  'cargo_enclosed_frame',
  'cargo_heavy_frame',

  'good_scrap',
  'good_salt',
  'good_meds',
  'good_grain',
  'good_textiles',
  'good_tools',
  'good_batteries',
  'good_electronics',
  'good_parts',
  'good_fuel_drums',
  'good_water',

  'wmount_ring_small',
  'wmount_pintle',
  'wmount_ring_wide',
  'wmount_cradle',

  'wrec_mg_a',
  'wrec_mg_b',
  'wrec_shotgun',
  'wrec_autocannon',
  'wrec_cannon',
  'wrec_tank',
  'wrec_rocket_pod',
  'wrec_sniper',

  'wbar_mg_short',
  'wbar_mg_long',
  'wbar_twin',
  'wbar_shotgun',
  'wbar_autocannon',
  'wbar_cannon',
  'wbar_tank',
  'wbar_sniper',
  'wbar_rocket_tubes',

  'wext_scope',
  'wext_shield',
  'wext_drum',
] as const;
export type ModelName = (typeof NAMES)[number];

const SOCKET_PREFIX = 'socket_';

const loaded = new Map<ModelName, THREE.Object3D>();
const sockets = new Map<ModelName, Map<string, THREE.Vector3>>();

// read returns a model's .glb bytes. The default fetches from public/models/; tests read the files from disk.
export async function loadModels(read: (name: ModelName) => Promise<ArrayBuffer> = fetchModel): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    NAMES.map(async (name) => {
      const gltf = await loader.parseAsync(await read(name), '');
      sockets.set(name, takeSockets(name, gltf.scene));
      loaded.set(name, toLambert(gltf.scene));
    }),
  );
  checkWeaponSockets();
}

// Position of a socket in the model's own space, as authored in Blender.
export function socket(name: ModelName, socketName: string): THREE.Vector3 {
  const own = sockets.get(name);
  if (!own) throw new Error(`Model ${name} is not loaded. Call loadModels() before building views.`);
  const at = own.get(socketName);
  if (!at) throw new Error(`Model ${name} has no socket ${socketName}. It has: ${[...own.keys()].join(', ') || 'none'}.`);
  return at.clone();
}

// Records each socket_* node position and removes the node, so clones carry only meshes.
function takeSockets(name: ModelName, root: THREE.Object3D): Map<string, THREE.Vector3> {
  root.updateMatrixWorld(true);
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name.startsWith(SOCKET_PREFIX)) found.push(o);
  });
  const out = new Map<string, THREE.Vector3>();
  for (const node of found) {
    const key = node.name.slice(SOCKET_PREFIX.length);
    if (out.has(key)) throw new Error(`Model ${name} has socket ${key} twice`);
    if (node.children.length > 0) throw new Error(`Model ${name} socket ${key} has child nodes`);
    out.set(key, root.worldToLocal(node.getWorldPosition(new THREE.Vector3())));
    node.removeFromParent();
  }
  return out;
}

// Mounts carry the head. Receivers carry the barrel and the extra. Barrels mark the tip rounds leave from.
function checkWeaponSockets(): void {
  for (const pool of Object.values(WEAPON_POOLS)) {
    for (const m of pool.mount) socket(m, 'head');
    for (const b of pool.barrel) socket(b, 'tip');
    for (const r of pool.receiver) {
      socket(r, 'muzzle');
      socket(r, 'extra');
    }
  }
}

async function fetchModel(name: ModelName): Promise<ArrayBuffer> {
  const url = `${import.meta.env.BASE_URL}models/${name}.glb`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model ${url} failed to load: HTTP ${res.status}`);
  return res.arrayBuffer();
}

function source(name: ModelName): THREE.Object3D {
  const src = loaded.get(name);
  if (!src) throw new Error(`Model ${name} is not loaded. Call loadModels() before building views.`);
  return src;
}

// A fresh copy. Materials are cloned too, because obstacle views dispose them on removal.
export function model(name: ModelName): THREE.Object3D {
  const copy = source(name).clone(true);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = o.geometry.clone();
      o.material = (o.material as THREE.Material).clone();
    }
  });
  return copy;
}

// Many copies of one model as one InstancedMesh per model mesh. Each placement is a model-to-world
// matrix. tints scale each copy's colors, one gray level per placement. The meshes share the loaded
// geometry and materials, so they must never be disposed.
export function instancedModel(name: ModelName, placements: THREE.Matrix4[], tints: number[]): THREE.Group {
  if (placements.length === 0) throw new Error(`Instanced ${name} needs at least one placement`);
  if (tints.length !== placements.length) throw new Error(`Instanced ${name} has ${placements.length} placements but ${tints.length} tints`);
  const src = source(name);
  src.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const group = new THREE.Group();
  const local = new THREE.Matrix4();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  src.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    local.multiplyMatrices(toRoot, o.matrixWorld);
    const mesh = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
    placements.forEach((placement, i) => {
      mesh.setMatrixAt(i, matrix.multiplyMatrices(placement, local));
      mesh.setColorAt(i, color.setScalar(tints[i]));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  group.matrixAutoUpdate = false;
  return group;
}

// glTF brings PBR materials. The rest of the scene is flat-shaded Lambert, so models match it.
function toLambert(root: THREE.Object3D): THREE.Object3D {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const lambert = mats.map((m) => {
      if (!(m instanceof THREE.MeshStandardMaterial)) throw new Error(`Model mesh ${o.name} has unexpected material ${m.type}`);
      const l = new THREE.MeshLambertMaterial({ color: m.color, flatShading: true, name: m.name });
      m.dispose();
      return l;
    });
    o.material = Array.isArray(o.material) ? lambert : lambert[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}

// A dark outline around trucks, a fixed number of screen pixels wide. It is real geometry, so the renderer's
// antialiasing smooths it. Back faces are pushed outward along smoothed normals in screen space, so the width
// holds at any zoom. The camera is orthographic, so clip w is 1 and an offset in clip units maps straight to pixels.
const OUTLINE = {
  width: { value: 0.5 }, // CSS pixels
  viewport: { value: new THREE.Vector2(1, 1) }, // CSS pixel size of the canvas, read from the renderer before each outline draws
};

function readViewport(renderer: THREE.WebGLRenderer): void {
  renderer.getSize(OUTLINE.viewport.value);
}

// Stencil bits models mark on their pixels. Outlines draw only where neither bit is set, so a pushed back face of a
// thin panel never pokes through a model. Outlines draw after opaque models, so the marks are there by then.
export const TRUCK_BIT = 1;
export const PROP_BIT = 2;
export const READY_ARC_BIT = 4; // ready arcs and the selected gun's reach mark their pixels, so where they overlap a spot is shaded once
export const SPENT_ARC_BIT = 8;
export const OUTLINE_ORDER = 805; // after opaque models mark the stencil, before truck silhouettes

function outlineMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: PAL.outline,
    side: THREE.BackSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFuncMask: TRUCK_BIT | PROP_BIT,
    stencilFunc: THREE.EqualStencilFunc,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = OUTLINE.width;
    shader.uniforms.viewport = OUTLINE.viewport;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;\nuniform vec2 viewport;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 outlineNormal = normal;
        #ifdef USE_INSTANCING
          outlineNormal = mat3(instanceMatrix) * outlineNormal;
        #endif
        vec2 outlineDir = (normalMatrix * outlineNormal).xy;
        if (dot(outlineDir, outlineDir) > 1e-8) gl_Position.xy += normalize(outlineDir) * outlineWidth * 2.0 / viewport * gl_Position.w;`);
  };
  material.customProgramCacheKey = () => 'outline';
  return material;
}

// Trucks and props keep separate materials, because the sight limit patches prop materials to clip at its edge.
const truckOutline = outlineMaterial();
const propOutline = outlineMaterial();

// Faces split at hard edges, so vertices merge by position before normals are smoothed, or the pushed faces would
// open cracks at every corner.
function weld(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const plain = geos.map((g) => {
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', g.getAttribute('position').clone());
    if (g.index) p.setIndex(g.index.clone());
    return p.index ? p.toNonIndexed() : p;
  });
  const merged = mergeGeometries(plain);
  if (!merged) throw new Error(`Could not merge ${geos.length} meshes for an outline`);
  for (const p of plain) p.dispose();
  const welded = mergeVertices(merged, 1e-3);
  merged.dispose();
  welded.computeVertexNormals();
  return welded;
}

// One outline mesh around all truck geos, which share one space.
// A group of lamps alone has no geos and gets no outline, so the result is empty or one mesh.
export function outlineOf(geos: readonly THREE.BufferGeometry[]): THREE.Mesh[] {
  if (geos.length === 0) return [];
  const mesh = new THREE.Mesh(weld(geos), truckOutline);
  mesh.onBeforeRender = readViewport;
  mesh.renderOrder = OUTLINE_ORDER;
  mesh.userData.outline = true;
  return [mesh];
}

// Instanced props share their model's geometry, so their welded outlines are shared too.
const welded = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

// Gives every mesh under obj an outline child, and makes its materials mark their pixels for outlines.
export function outlineProps(obj: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.outline) meshes.push(o);
  });
  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      m.stencilWrite = true;
      m.stencilRef = PROP_BIT;
      m.stencilWriteMask = PROP_BIT;
      m.stencilFunc = THREE.AlwaysStencilFunc;
      m.stencilZPass = THREE.ReplaceStencilOp;
    }
    let geo = welded.get(mesh.geometry);
    if (!geo) {
      geo = weld([mesh.geometry]);
      welded.set(mesh.geometry, geo);
    }
    const outline = mesh instanceof THREE.InstancedMesh ? instancedOutline(mesh, geo) : new THREE.Mesh(geo, propOutline);
    outline.onBeforeRender = readViewport;
    outline.renderOrder = OUTLINE_ORDER;
    outline.userData.outline = true;
    mesh.add(outline);
  }
}

function instancedOutline(mesh: THREE.InstancedMesh, geo: THREE.BufferGeometry): THREE.InstancedMesh {
  const outline = new THREE.InstancedMesh(geo, propOutline, mesh.count);
  outline.instanceMatrix = mesh.instanceMatrix;
  outline.boundingSphere = mesh.boundingSphere;
  outline.boundingBox = mesh.boundingBox;
  outline.matrixAutoUpdate = false;
  return outline;
}
