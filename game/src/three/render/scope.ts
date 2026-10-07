// Distance culling for static objects. Objects are bucketed into terrain chunks. Each frame the chunks
// whose bounds meet both the camera view and gray vision stay attached to the root. The rest are
// detached, so scene traversal, matrix updates and the renderer skip them. Every object is also clipped
// at the gray vision edge.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN } from '../../data/terrain';
import type { Vec } from '../../sim/vec';
import type { V3 } from '../../phys/frames';
import { TERRAIN_CHUNK } from './terrain';
import { outlineProps } from './models';

const S = PHYSICS.metersPerTile;
// Meters added around each chunk's bounds, so shadows cast into view from outside it still draw.
// The sun sits 120 m up and 100 m to the side. Models up to 38 m high, like the Nose hull, cast
// shadows under 32 m long. The 71 m Fallen Sun hull casts about 59 m, but its 176 m site radius plus
// this margin still covers the shadow.
const MARGIN = 8 * S;
const IDENTITY = new THREE.Matrix4();

type Chunk = { group: THREE.Group; box: THREE.Box3; shown: boolean };

export class RenderScope {
  private readonly perSide: number;
  private readonly chunks: (Chunk | null)[];
  private readonly owner = new Map<THREE.Object3D, Chunk>();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly test = new THREE.Box3();
  private readonly prepare: (obj: THREE.Object3D) => void;
  private readonly frameHooks: (() => void)[] = [];

  // The root must stay at the world origin: chunk bounds are world boxes.
  // grey: objects out of clear sight drain to grey. The ground greys itself, so its scope passes false.
  // outlined: objects get outlines as they are added, before the sight limit patches their materials, so the
  // outlines are clipped too.
  constructor(private readonly root: THREE.Object3D, private readonly mapSize: number, private readonly limit: SightLimit, private readonly grey: boolean, outlined: boolean) {
    this.prepare = outlined ? outlineProps : () => {};
    this.perSide = Math.ceil(mapSize / TERRAIN_CHUNK);
    this.chunks = new Array<Chunk | null>(this.perSide * this.perSide).fill(null);
  }

  // pos is the object's map point in tiles. radius in tiles covers its footprint around pos. The
  // object's own geometry bounds are added too, so a radius that is too small never hides it.
  add(obj: THREE.Object3D, pos: Vec, radius: number): void {
    if (this.owner.has(obj)) throw new Error(`Object ${obj.name || obj.id} is already in the render scope`);
    if (!(pos.x >= 0 && pos.y >= 0 && pos.x <= this.mapSize && pos.y <= this.mapSize)) throw new Error(`Render scope object at ${pos.x},${pos.y} is outside the ${this.mapSize}-tile map`);
    if (!(radius >= 0 && Number.isFinite(radius))) throw new Error(`Render scope radius must be a finite non-negative number, got ${radius}`);
    const chunk = this.chunkAt(pos);
    const bounds = new THREE.Box3().setFromObject(obj);
    const low = bounds.isEmpty() ? obj.position.y : bounds.min.y;
    const high = bounds.isEmpty() ? obj.position.y : bounds.max.y;
    bounds.expandByPoint(new THREE.Vector3((pos.x - radius) * S, low, (pos.y - radius) * S));
    bounds.expandByPoint(new THREE.Vector3((pos.x + radius) * S, high, (pos.y + radius) * S));
    chunk.box.union(bounds);
    this.prepare(obj);
    chunk.group.add(obj);
    this.owner.set(obj, chunk);
    this.limit.patch(obj, this.grey);
  }

  // The chunk keeps its bounds, which stay a safe superset.
  remove(obj: THREE.Object3D): void {
    const chunk = this.owner.get(obj);
    if (!chunk) throw new Error(`Object ${obj.name || obj.id} is not in the render scope`);
    chunk.group.remove(obj);
    this.owner.delete(obj);
  }

  // Runs fn at the end of every update, once per drawn frame.
  onFrame(fn: () => void): void {
    this.frameHooks.push(fn);
  }

  update(camera: THREE.OrthographicCamera): void {
    this.root.updateWorldMatrix(true, false);
    if (!this.root.matrixWorld.equals(IDENTITY)) throw new Error('Render scope root moved away from the world origin');
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      const show = this.shows(chunk);
      if (show === chunk.shown) continue;
      if (show) this.root.add(chunk.group);
      else this.root.remove(chunk.group);
      chunk.shown = show;
    }
    this.frameHooks.forEach((hook) => hook());
  }

  private shows(chunk: Chunk): boolean {
    return this.limit.meets(chunk.box, MARGIN) && this.frustum.intersectsBox(this.test.copy(chunk.box).expandByScalar(MARGIN));
  }

  private chunkAt(pos: Vec): Chunk {
    const cx = Math.min(Math.floor(pos.x / TERRAIN_CHUNK), this.perSide - 1);
    const cy = Math.min(Math.floor(pos.y / TERRAIN_CHUNK), this.perSide - 1);
    const index = cy * this.perSide + cx;
    let chunk = this.chunks[index];
    if (!chunk) {
      const group = new THREE.Group();
      group.name = `scope-chunk-${cx}-${cy}`;
      group.matrixAutoUpdate = false;
      chunk = { group, box: new THREE.Box3(), shown: true };
      this.chunks[index] = chunk;
      this.root.add(group);
    }
    return chunk;
  }
}

// What the player sees, applied to ground and props. Past the gray radius from the truck nothing is drawn:
// shaders discard every fragment there, so the background shows. Culling uses the same circle, so chunks
// wholly beyond it skip rendering. Inside it, props on tiles out of clear sight drain to grey like the
// ground. The ground greys itself in fog.ts, so only props take the grey here. Shadow casting is not
// clipped, so a hidden prop just past the edge can still shade ground inside it.
type Clipped = THREE.Material & { onBeforeCompile: THREE.Material['onBeforeCompile'] };

export class SightLimit {
  private readonly visible: THREE.DataTexture;
  private readonly uniforms;
  private readonly patched = new WeakSet<THREE.Material>();

  constructor(private readonly mapSize: number) {
    // One texel per tile, 255 where the player sees it now. Row y holds map row y.
    this.visible = new THREE.DataTexture(new Uint8Array(mapSize * mapSize), mapSize, mapSize, THREE.RedFormat, THREE.UnsignedByteType);
    this.visible.magFilter = THREE.NearestFilter;
    this.visible.minFilter = THREE.NearestFilter;
    this.visible.needsUpdate = true;
    this.uniforms = {
      sightCenter: { value: new THREE.Vector2() },
      sightRadius: { value: Number.POSITIVE_INFINITY },
      sightVisible: { value: this.visible },
      sightMapMeters: { value: mapSize * S },
      sightGrey: { value: new THREE.Vector2(TERRAIN.fog.seen.grey, TERRAIN.fog.seen.bright) },
    };
  }

  // center is the truck's point in 3D meters. radius is in meters.
  set(center: V3, radius: number): void {
    if (!(radius > 0 && Number.isFinite(radius))) throw new Error(`Sight limit radius must be a finite positive number, got ${radius}`);
    this.uniforms.sightCenter.value.set(center.x, center.z);
    this.uniforms.sightRadius.value = radius;
  }

  // Whether a point in 3D meters lies within gray vision.
  reaches(at: V3): boolean {
    const c = this.uniforms.sightCenter.value;
    return Math.hypot(at.x - c.x, at.z - c.y) <= this.uniforms.sightRadius.value;
  }

  // Tile indices, y * mapSize + x, the player sees clearly now.
  showVisible(tiles: Iterable<number>): void {
    const data = this.visible.image.data as Uint8Array;
    data.fill(0);
    for (const t of tiles) {
      if (!(t >= 0 && t < data.length)) throw new Error(`Visible tile ${t} is outside the ${this.mapSize}-tile map`);
      data[t] = 255;
    }
    this.visible.needsUpdate = true;
  }

  // Whether a 3D point lies inside the edge, on the ground plane.
  covers(p: V3): boolean {
    const c = this.uniforms.sightCenter.value;
    return Math.hypot(p.x - c.x, p.z - c.y) <= this.uniforms.sightRadius.value;
  }

  // Whether a world box comes within margin meters of the edge, on the ground plane.
  meets(box: THREE.Box3, margin: number): boolean {
    const c = this.uniforms.sightCenter.value;
    const dx = Math.max(box.min.x - c.x, 0, c.x - box.max.x);
    const dz = Math.max(box.min.z - c.y, 0, c.y - box.max.z);
    return Math.hypot(dx, dz) <= this.uniforms.sightRadius.value + margin;
  }

  // Patches every material under obj once. Chains any shader patch the material already has. With grey,
  // fragments on tiles out of clear sight drain to grey.
  patch(obj: THREE.Object3D, grey: boolean): void {
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const materials: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) this.patchMaterial(m, grey);
    });
  }

  private patchMaterial(mat: Clipped, grey: boolean): void {
    if (this.patched.has(mat)) return;
    this.patched.add(mat);
    const before = mat.onBeforeCompile.bind(mat);
    const key = mat.customProgramCacheKey.bind(mat);
    mat.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = inject(shader.vertexShader, '#include <common>', 'varying vec2 vSightXZ;');
      shader.vertexShader = inject(
        shader.vertexShader,
        '#include <project_vertex>',
        `vec4 sightWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        sightWorld = instanceMatrix * sightWorld;
        #endif
        vSightXZ = (modelMatrix * sightWorld).xz;`,
      );
      shader.fragmentShader = inject(
        shader.fragmentShader,
        '#include <common>',
        'varying vec2 vSightXZ;\nuniform vec2 sightCenter;\nuniform float sightRadius;\nuniform sampler2D sightVisible;\nuniform float sightMapMeters;\nuniform vec2 sightGrey;',
      );
      shader.fragmentShader = inject(shader.fragmentShader, '#include <clipping_planes_fragment>', 'if (distance(vSightXZ, sightCenter) > sightRadius) discard;');
      if (grey) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `float sightSeen = texture2D(sightVisible, vSightXZ / sightMapMeters).r;
        float sightLuma = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
        outgoingLight = mix(mix(outgoingLight, vec3(sightLuma), sightGrey.x) * sightGrey.y, outgoingLight, sightSeen);
        #include <opaque_fragment>`);
      if (grey && !shader.fragmentShader.includes('sightSeen')) throw new Error('Sight limit cannot grey a shader without #include <opaque_fragment>');
    };
    // Programs are cached by this key. Without the tag, patched and unpatched materials with the same
    // hook source would share one program.
    mat.customProgramCacheKey = () => `${key()}|sight${grey ? '-grey' : ''}`;
    mat.needsUpdate = true;
  }
}

// Adds code after a shader chunk include. A missing chunk means an unsupported material, so it stops the build.
function inject(source: string, chunk: string, code: string): string {
  if (!source.includes(chunk)) throw new Error(`Sight limit cannot patch a shader without ${chunk}`);
  return source.replace(chunk, `${chunk}\n${code}`);
}
