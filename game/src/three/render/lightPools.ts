import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { fortressOutline, fortressFootprint, fortressPieces } from '../../sim/fortress';
import type { Site } from '../../sim/sites';
import { pointInPolygon, type Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;

export const POOLS = { texelsPerTile: 4, radius: 2.5, gain: 0.5, push: 0.5, margin: 2 };
const HALO = { size: 1.6, texels: 64 };

export type PoolLamp = { site: Site; x: number; z: number; inside: boolean };
type Side = 'inside' | 'outside' | 'solid';
type Region = { site: Site; i0: number; j0: number; i1: number; j1: number; sides: Side[] };

export function poolTextureSize(worldSize: number, maxTextureSize: number): number {
  const size = worldSize * POOLS.texelsPerTile;
  if (size > maxTextureSize) throw new Error(`Night pool texture needs ${size} texels, the renderer allows ${maxTextureSize}`);
  return size;
}

export function poolSide(site: Site, solids: Vec[][], p: Vec): Side {
  if (solids.some((poly) => pointInPolygon(p, poly))) return 'solid';
  return pointInPolygon(p, fortressOutline(site)) ? 'inside' : 'outside';
}

function texelCentre(i: number): number {
  return (i + 0.5) / POOLS.texelsPerTile;
}

function siteRegion(site: Site, size: number): Region {
  const reach = site.radius + POOLS.radius + POOLS.margin;
  const lo = (v: number) => Math.max(0, Math.floor((v - reach) * POOLS.texelsPerTile));
  const hi = (v: number) => Math.min(size - 1, Math.ceil((v + reach) * POOLS.texelsPerTile));
  const region = { site, i0: lo(site.pos.x), j0: lo(site.pos.y), i1: hi(site.pos.x), j1: hi(site.pos.y), sides: [] as Side[] };
  const solids = fortressPieces(site).map((piece) => fortressFootprint(site, piece));
  for (let j = region.j0; j <= region.j1; j++)
    for (let i = region.i0; i <= region.i1; i++) region.sides.push(poolSide(site, solids, { x: texelCentre(i), y: texelCentre(j) }));
  return region;
}

function sideAt(region: Region, i: number, j: number): Side {
  return region.sides[(j - region.j0) * (region.i1 - region.i0 + 1) + (i - region.i0)];
}

export function poolFalloff(d: number): number {
  const t = Math.min(1, d / POOLS.radius);
  return (1 - t * t) ** 2;
}

function addLamp(light: Float32Array, size: number, region: Region, lamp: PoolLamp): void {
  const side: Side = lamp.inside ? 'inside' : 'outside';
  const span = Math.ceil(POOLS.radius * POOLS.texelsPerTile);
  const ci = Math.floor(lamp.x * POOLS.texelsPerTile);
  const cj = Math.floor(lamp.z * POOLS.texelsPerTile);
  for (let j = Math.max(region.j0, cj - span); j <= Math.min(region.j1, cj + span); j++)
    for (let i = Math.max(region.i0, ci - span); i <= Math.min(region.i1, ci + span); i++) {
      if (sideAt(region, i, j) !== side) continue;
      light[j * size + i] += poolFalloff(Math.hypot(texelCentre(i) - lamp.x, texelCentre(j) - lamp.z));
    }
}

export function bakePools(lamps: PoolLamp[], size: number): Uint8Array {
  const light = new Float32Array(size * size);
  const regions = new Map<Site, Region>();
  for (const lamp of lamps) {
    let region = regions.get(lamp.site);
    if (!region) regions.set(lamp.site, (region = siteRegion(lamp.site, size)));
    addLamp(light, size, region, lamp);
  }
  return Uint8Array.from(light, (v) => Math.round(Math.min(1, v) * 255));
}

export function samplePools(data: Uint8Array, size: number, p: Vec): number {
  const u = p.x * POOLS.texelsPerTile - 0.5;
  const v = p.y * POOLS.texelsPerTile - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const at = (a: number, b: number) => data[b * size + a] / 255;
  const fu = u - i;
  const fv = v - j;
  return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
}

const POOL_VERTEX = `#include <project_vertex>
vec4 poolWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
poolWorld = instanceMatrix * poolWorld;
#endif
vPoolXZ = (modelMatrix * poolWorld).xz;`;

const POOL_FRAGMENT = `vec3 poolNormal = inverseTransformDirection(normal, viewMatrix);
vec2 poolAt = (vPoolXZ + poolNormal.xz * poolPush) / poolSpan;
gl_FragColor.rgb += diffuseColor.rgb * poolColor * (texture2D(poolMap, poolAt).r * poolGain * poolLevel);
#include <tonemapping_fragment>`;

const POOL_UNIFORMS = 'uniform sampler2D poolMap;\nuniform float poolSpan;\nuniform float poolPush;\nuniform float poolGain;\nuniform float poolLevel;\nuniform vec3 poolColor;\nvarying vec2 vPoolXZ;';

function haloTexture(): THREE.DataTexture {
  const n = HALO.texels;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(i + 0.5 - n / 2, j + 0.5 - n / 2) / (n / 2);
      const k = 4 * (j * n + i);
      data.set([255, 255, 255, Math.round(Math.max(0, 1 - d) ** 2 * 255)], k);
    }
  const texture = new THREE.DataTexture(data, n, n);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class NightPools {
  private readonly uniforms = {
    poolMap: { value: null as THREE.DataTexture | null },
    poolSpan: { value: 1 },
    poolPush: { value: POOLS.push * S },
    poolGain: { value: POOLS.gain },
    poolLevel: { value: 0 },
    poolColor: { value: new THREE.Color(PAL.siteLight.sodium) },
  };
  private readonly lit = new WeakSet<THREE.Material>();
  readonly haloMaterial = new THREE.SpriteMaterial({ map: haloTexture(), color: PAL.lamp.amber, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });

  bake(lamps: PoolLamp[], worldSize: number, maxTextureSize: number): void {
    const size = poolTextureSize(worldSize, maxTextureSize);
    const texture = new THREE.DataTexture(bakePools(lamps, size), size, size, THREE.RedFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.uniforms.poolMap.value = texture;
    this.uniforms.poolSpan.value = worldSize * S;
  }

  setLevel(level: number): void {
    if (!this.uniforms.poolMap.value) throw new Error('Night pools were never baked');
    this.uniforms.poolLevel.value = level;
    this.haloMaterial.opacity = level;
  }

  halo(): THREE.Sprite {
    const sprite = new THREE.Sprite(this.haloMaterial);
    sprite.scale.setScalar(HALO.size * S);
    sprite.name = 'halo';
    return sprite;
  }

  light(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error(`Night pools light only Lambert materials, not ${material.type}`);
    if (this.lit.has(material)) return;
    this.lit.add(material);
    const before = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPoolXZ;').replace('#include <project_vertex>', POOL_VERTEX);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${POOL_UNIFORMS}`).replace('#include <tonemapping_fragment>', POOL_FRAGMENT);
    };
    material.customProgramCacheKey = () => `${key()}|pools`;
    material.needsUpdate = true;
  }
}

export const NIGHT_POOLS = new NightPools();
