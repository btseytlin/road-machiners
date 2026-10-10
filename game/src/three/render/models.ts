// Blender-made models from public/models/, built by the scripts in tools/blender/.
// loadModels() runs once at boot. model() hands out clones with their own materials.
// socket() gives the attach points that scripts mark with Kit.socket().

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
  'power_pole',
  'billboard',
  'crag',
  'tank_hulk',
  'ruin_house',
  'bridge_broken',
  'gas_station',
  'ship_wing',
  'escape_pod',
  'hull_bay',
  'cargo_pod',
  'engine_section',
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
  'engine_nozzle',
  'engine_frame',
  'ruin_compound',
  'watchtower',
  'glass_spire',
  'scrap_wall',
  'fort_pumpworks_wall',
  'fort_pumpworks_tower',
  'fort_pumpworks_gate',
  'fort_pumpworks_inner',
  'fort_cistern_wall',
  'fort_cistern_tower',
  'fort_cistern_gate',
  'fort_cistern_inner',
  'fort_ship_wall',
  'fort_ship_tower',
  'fort_ship_gate',
  'fort_scrap_wall',
  'fort_scrap_tower',
  'fort_scrap_gate',
  'fort_scrap_inner',
  'fort_patchwork_wall',
  'fort_patchwork_tower',
  'fort_patchwork_gate',
  'fort_compound_wall',
  'fort_compound_tower',
  'fort_compound_gate',
  'fort_ring_wall',
  'fort_ring_gate',
  'fort_yard_wall',
  'fort_yard_tower',
  'fort_yard_gate',
  'bowl_house_rust',
  'bowl_house_red',
  'bowl_house_grey',
  'windmill_tower',
  'windmill_rotor',
  'stilt_tank',
  'fruit_tree',
  'pumpjack_base',
  'pumpjack_beam',
  'storage_tank',
  'grain_silo',
  'grain_elevator',
  'lean_to',
  'crane_base',
  'crane_upper',
  'crane_grab',
  'ship_hull_ring',
  'ship_hull_ribs',
  'ship_hull_stern',
  'nose_rise',
  'nose_crag',
  'radar_dish',
  'scrap_shelter_flat',
  'scrap_shelter_lean',
  'hull_scaffold',
  'jib_crane',

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

  'util_sprout',
  'util_caltrops',
  'util_oil',
  'util_crane',
  'util_mortar',
  'util_flare',
  'util_scraper',
  'util_emitter',
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
  'arm_claymore_ram',

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
  'wrec_harpoon',

  'wbar_mg_short',
  'wbar_mg_long',
  'wbar_twin',
  'wbar_shotgun',
  'wbar_autocannon',
  'wbar_cannon',
  'wbar_tank',
  'wbar_sniper',
  'wbar_rocket_tubes',
  'wbar_harpoon',

  'wext_scope',
  'wext_shield',
  'wext_drum',
] as const;
export type ModelName = (typeof NAMES)[number];

const SOCKET_PREFIX = 'socket_';

const loaded = new Map<ModelName, THREE.Object3D>();
const sockets = new Map<ModelName, Map<string, THREE.Vector3>>();

// read returns a model's .glb bytes. The default fetches from public/models/; tests read the files from disk.
// progress gets (0, total) first, then (done, total) after each model is parsed.
export async function loadModels(
  read: (name: ModelName) => Promise<ArrayBuffer> = fetchModel,
  progress?: (done: number, total: number) => void,
): Promise<void> {
  const loader = new GLTFLoader();
  let done = 0;
  progress?.(0, NAMES.length);
  await Promise.all(
    NAMES.map(async (name) => {
      const gltf = await loader.parseAsync(await read(name), '');
      sockets.set(name, takeSockets(name, gltf.scene));
      loaded.set(name, toLambert(gltf.scene));
      progress?.(++done, NAMES.length);
    }),
  );
  checkWeaponSockets();
}

export function socket(name: ModelName, socketName: string): THREE.Vector3 {
  const own = sockets.get(name);
  if (!own) throw new Error(`Model ${name} is not loaded. Call loadModels() before building views.`);
  const at = own.get(socketName);
  if (!at) throw new Error(`Model ${name} has no socket ${socketName}. It has: ${[...own.keys()].join(', ') || 'none'}.`);
  return at.clone();
}

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

const GLOW_MATERIAL = 'glow';
const GLOW = { color: new THREE.Color(PAL.lamp.amber), strength: 0.4 };
export const MODEL_GLOW = { color: GLOW.color.getHex(), emissive: GLOW.color.clone().multiplyScalar(GLOW.strength).getHex() };

function toLambert(root: THREE.Object3D): THREE.Object3D {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const lambert = mats.map((m) => {
      if (!(m instanceof THREE.MeshStandardMaterial)) throw new Error(`Model mesh ${o.name} has unexpected material ${m.type}`);
      const l = new THREE.MeshLambertMaterial({ color: m.color, flatShading: true, name: m.name });
      if (m.name === GLOW_MATERIAL) {
        l.color.copy(GLOW.color);
        l.emissive.copy(GLOW.color).multiplyScalar(GLOW.strength);
      }
      m.dispose();
      return l;
    });
    o.material = Array.isArray(o.material) ? lambert : lambert[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}

const OUTLINE = {
  width: { value: 0.5 },
  viewport: { value: new THREE.Vector2(1, 1) },
};

function readViewport(renderer: THREE.WebGLRenderer): void {
  renderer.getSize(OUTLINE.viewport.value);
}

export const TRUCK_BIT = 1;
export const PROP_BIT = 2;
export const READY_ARC_BIT = 4;
export const SPENT_ARC_BIT = 8;
export const OUTLINE_ORDER = 805;

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

const truckOutline = outlineMaterial();
const propOutline = outlineMaterial();

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

export function outlineOf(geos: readonly THREE.BufferGeometry[]): THREE.Mesh[] {
  if (geos.length === 0) return [];
  const mesh = new THREE.Mesh(weld(geos), truckOutline);
  mesh.onBeforeRender = readViewport;
  mesh.renderOrder = OUTLINE_ORDER;
  mesh.userData.outline = true;
  return [mesh];
}

const welded = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

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
