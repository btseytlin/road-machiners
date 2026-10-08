// Darkens shaded, explored ground near the player, and makes sun-baked ground shimmer in heat haze. Uses
// the same inShade and sun heat the sim reads, so the look never disagrees with the drain or the engine
// heat. The sun moves every turn, so the layer recomputes every turn, a few rows per frame after the turn ends. It is a
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TIME } from '../../data/time';
import { WEATHER } from '../../data/weather';
import { HAZE_FROM } from '../../data/wear';
import { PAL } from '../../render/palette';
import { playerVehicle } from '../../sim/damage';
import { inShade, shadeCasters, sunAt, sunHeatAt, type Sun } from '../../sim/sun';
import { groundUvPerMeter, type TerrainChunk } from './terrain';
import { heightAt } from '../../sim/terrain';
import type { Obstacle, World } from '../../sim/types';

const S = PHYSICS.metersPerTile;
const TAU = 2 * Math.PI;
const LIFT = 0.04;
const REACH = 20;
const SIDE = REACH * 2 + 1;
const SHADE_ROWS_PER_FRAME = 4;
const HAZE_FULL = 1 + (TIME.sunHeat - 1) * WEATHER.sim.effects.heatwave;
const HAZE = {
  shift: 0.5,
  waves: [
    { wave: 4.7, speed: 2.9, heading: 0.4, weight: 1 },
    { wave: 2.6, speed: 4.1, heading: 2.3, weight: 0.6 },
    { wave: 1.4, speed: 6.3, heading: 4.1, weight: 0.35 },
  ],
  warp: { wave: 9, speed: 0.9, depth: 1.6 },
  gust: 22,
  gustSpeed: 0.21,
};

export class ShadeView {
  readonly mesh: THREE.Mesh;
  private lastTurn = -1;
  private job: ShadeJob | null = null;
  private queued: World | null = null;
  private hazeCells = new Uint8Array(SIDE * SIDE);
  private hazeMask = new THREE.DataTexture(this.hazeCells, SIDE, SIDE, THREE.RedFormat);
  private haze = {
    hazeMask: { value: this.hazeMask },
    hazeOrigin: { value: new THREE.Vector2() },
    hazeTime: { value: 0 },
    hazeUvPerMeter: { value: 0 },
  };

  constructor(world: World, ground: TerrainChunk[]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIDE * SIDE * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SIDE * SIDE), 1));
    geo.setIndex(patchIndices());
    const c = new THREE.Color(PAL.shadeTint);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Vector3(c.r, c.g, c.b) } },
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(color, vAlpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 901;
    this.hazeGround(ground[0].mesh.material as THREE.MeshLambertMaterial, groundUvPerMeter(world.size));
    this.mesh.onBeforeRender = () => {
      this.haze.hazeTime.value = performance.now() / 1000;
    };
    this.hazeMask.unpackAlignment = 1;
    this.hazeMask.magFilter = THREE.LinearFilter;
    this.hazeMask.minFilter = THREE.LinearFilter;
    this.update(world);
    while (this.job) this.advance();
  }

  private hazeGround(material: THREE.MeshLambertMaterial, uvPerMeter: number): void {
    this.haze.hazeUvPerMeter.value = uvPerMeter;
    const before = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, this.haze);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHazeXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvHazeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${HAZE_UNIFORMS}`)
        .replace('#include <map_fragment>', `${HAZE_SHIFT}\n#include <map_fragment>`)
        .replace('#include <color_fragment>', '#undef vMapUv\n#undef vRoadXZ\n#include <color_fragment>');
    };
    material.customProgramCacheKey = () => `${key()}|haze`;
    material.needsUpdate = true;
  }


  update(world: World): void {
    if (world.turn === this.lastTurn) return;
    this.lastTurn = world.turn;
    if (this.job) this.queued = world;
    else this.job = newJob(world);
  }

  advance(): void {
    const job = this.job;
    if (!job) return;
    const end = Math.min(SIDE, job.row + SHADE_ROWS_PER_FRAME);
    for (; job.row < end; job.row++) computeRow(job, job.row);
    if (job.row < SIDE) return;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.mesh.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(job.pos);
    (alpha.array as Float32Array).set(job.alpha);
    this.hazeCells.set(job.haze);
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
    this.haze.hazeOrigin.value.set(job.x0 * S, job.y0 * S);
    this.hazeMask.needsUpdate = true;
    this.job = this.queued ? newJob(this.queued) : null;
    this.queued = null;
  }
}

type ShadeJob = { world: World; sun: Sun | null; casters: Obstacle[]; x0: number; y0: number; row: number; pos: Float32Array; alpha: Float32Array; haze: Uint8Array };

function newJob(world: World): ShadeJob {
  const me = playerVehicle(world).pos;
  return {
    world,
    sun: sunAt(world.turn),
    casters: shadeCasters(world, me, REACH),
    x0: Math.floor(me.x) - REACH,
    y0: Math.floor(me.y) - REACH,
    row: 0,
    pos: new Float32Array(SIDE * SIDE * 3),
    alpha: new Float32Array(SIDE * SIDE),
    haze: new Uint8Array(SIDE * SIDE),
  };
}

function computeRow(job: ShadeJob, j: number): void {
  const { world, sun, casters } = job;
  const me = playerVehicle(world).pos;
  for (let i = 0; i < SIDE; i++) {
    const k = j * SIDE + i;
    const x = Math.min(world.size, Math.max(0, job.x0 + i));
    const y = Math.min(world.size, Math.max(0, job.y0 + j));
    job.pos[k * 3] = x * S;
    job.pos[k * 3 + 1] = heightAt(world.terrain, x, y) * S + LIFT;
    job.pos[k * 3 + 2] = y * S;
    const look = Math.hypot(x - me.x, y - me.y) <= REACH && sun ? cornerLook(world, x, y, sun, casters) : { shade: 0, haze: 0 };
    job.alpha[k] = look.shade;
    job.haze[k] = look.haze;
  }
}

export function cornerLook(world: World, x: number, y: number, sun: Sun, casters: Obstacle[]): { shade: number; haze: number } {
  if (inShade(world, { x, y }, sun, casters)) {
    const fade = Math.min(1, sun.elevation / (TIME.shadeFadeElevation * (Math.PI / 180)));
    return { shade: cornerExplored(world, x, y) ? TIME.shadeAlpha * fade : 0, haze: 0 };
  }
  return { shade: 0, haze: hazeOf(sunHeatAt(world, { x, y }, sun)) };
}

function hazeOf(heat: number): number {
  return Math.round(255 * Math.min(1, Math.max(0, (heat - HAZE_FROM) / (HAZE_FULL - HAZE_FROM))));
}

const HAZE_UNIFORMS = `varying vec2 vHazeXZ;
uniform sampler2D hazeMask;
uniform vec2 hazeOrigin;
uniform float hazeTime;
uniform float hazeUvPerMeter;`;

const HAZE_SHIFT = `
  vec2 hazeCell = (vHazeXZ - hazeOrigin) / ${S.toFixed(4)} + 0.5;
  float hazeOn = texture2D(hazeMask, hazeCell / ${SIDE.toFixed(1)}).r;
  vec2 hazeP = vHazeXZ;
  float hazeT = hazeTime;
  vec2 hazeWarp = ${glslFloat(HAZE.warp.depth)} * vec2(
    sin(hazeP.y * ${glslFloat(TAU / HAZE.warp.wave)} + hazeT * ${glslFloat(HAZE.warp.speed)}),
    sin(hazeP.x * ${glslFloat(TAU / HAZE.warp.wave * 0.83)} - hazeT * ${glslFloat(HAZE.warp.speed * 1.37)}));
  vec2 hazeShift = vec2(0.0);
${HAZE.waves.map(waveGlsl).join('\n')}
  float hazeGust = smoothstep(0.35, 0.95, 0.5 + 0.5 * sin(hazeP.x * ${glslFloat(TAU / HAZE.gust)} + hazeT * ${glslFloat(HAZE.gustSpeed)}
    + 1.7 * sin(hazeP.y * ${glslFloat(TAU / HAZE.gust * 0.71)} - hazeT * ${glslFloat(HAZE.gustSpeed * 0.63)}))
    * sin(hazeP.y * ${glslFloat(TAU / HAZE.gust * 0.87)} - hazeT * ${glslFloat(HAZE.gustSpeed * 1.21)}
    + 1.3 * sin(hazeP.x * ${glslFloat(TAU / HAZE.gust * 0.53)} + hazeT * ${glslFloat(HAZE.gustSpeed * 0.77)})));
  // Ground in a cast shadow gets no haze, so shadow edges stay still.
  float hazeLit = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    hazeLit = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, 1.0,
      directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
  #endif
  hazeShift *= hazeOn * hazeLit * hazeGust * ${glslFloat(HAZE.shift / HAZE.waves.reduce((sum, w) => sum + w.weight, 0))};
  #define vMapUv (vMapUv + hazeShift * hazeUvPerMeter)
  #define vRoadXZ (vRoadXZ + hazeShift)`;

function waveGlsl(w: (typeof HAZE.waves)[number]): string {
  const dir = `vec2(${glslFloat(Math.cos(w.heading))}, ${glslFloat(Math.sin(w.heading))})`;
  const phase = `dot(hazeP + hazeWarp, ${dir}) * ${glslFloat(TAU / w.wave)} - hazeT * ${glslFloat(w.speed)}`;
  return `  hazeShift += ${glslFloat(w.weight)} * vec2(sin(${phase}), cos(${phase} * 0.77));`;
}

function glslFloat(x: number): string {
  return x.toFixed(4);
}

function patchIndices(): THREE.BufferAttribute {
  const out: number[] = [];
  for (let j = 0; j < SIDE - 1; j++) {
    for (let i = 0; i < SIDE - 1; i++) {
      const a = j * SIDE + i;
      out.push(a, a + SIDE, a + 1, a + 1, a + SIDE, a + SIDE + 1);
    }
  }
  return new THREE.BufferAttribute(new Uint32Array(out), 1);
}

function cornerExplored(world: World, i: number, j: number): boolean {
  const n = world.size;
  for (const [x, y] of [
    [i - 1, j - 1],
    [i, j - 1],
    [i - 1, j],
    [i, j],
  ]) {
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    if (world.player.explored[y * n + x]) return true;
  }
  return false;
}
