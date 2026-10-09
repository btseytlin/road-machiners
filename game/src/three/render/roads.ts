
import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import { REGION } from "../../data/region";
import { TERRAIN_TYPES } from "../../data/terrain";
import { desertWeight, glassField, lookTypes, ROAD_PLAIN, ROAD_SAND, type PaintCanvas } from "../../render/groundPaint";
import { atlasOf, atlasSites, type Atlas } from "../../sim/atlas";
import { sitePads } from "../../sim/sites";
import type { Terrain } from "../../sim/terrain";
import { mix, PAL } from "../../render/palette";
import { paintRoadDetail, paintRoadMask, paintRoadTone, ROAD_DETAIL_SIDE, ROAD_TONE_PIXELS, ROAD_TONE_SIDE, type RoadImage } from "../../render/roadPaint";

const S = PHYSICS.metersPerTile;
const PIXEL_SPLIT = 3;
const PAD_BORDER = 2;
const SHOULDER_FROM = 0.42;
const ROAD_FRAY = 0.35;
const RIM_SHARE = 0.3;
const RIM_INSIDE = 0.15;
const SHOULDER_STONES = 0.05;
const DIRT_UNDER = TERRAIN_TYPES.track.color;
const DIRT_EDGE = 0.44;
const DIRT_WANDER = 0.2;
const DIRT_SOFT = 0.15;
const DIRT_SHOULDER = 0.9;
const GLASS_PLATE = 2;
const GLASS_TINT = 0.16;
const GLASS_SEAM = 0.25;
const GLASS_SEAM_MIX = 0.45;
const GLASS_WARP = 2.2;
const GLASS_WARP_SCALE = 2.5;
const GLASS_EDGE_WOBBLE = 0.35;
const GLASS_EDGE_SCALE = 1.6;
const GLASS_EDGE_FINE = 0.12;
const GLASS_EDGE_FINE_SCALE = 0.5;
const GLASS_DUST_MIX = 0.35;
const GLASS_BASE = mix(TERRAIN_TYPES.glass.color, PAL.sand[3], 0.07);
const GLASS_DUST = mix(PAL.glass.top, 0xb9a47c, 0.6);
const GLASS_SEAM_COLOR = mix(PAL.glass.top, 0xffffff, 0.45);

export function drawRoads(material: THREE.MeshLambertMaterial, mask: PaintCanvas, t: Terrain): void {
  paintRoadMask(mask, atlasOf(t));
  const pixel = S / mask.res / PIXEL_SPLIT;
  const uniforms = {
    roadMask: { value: maskTexture(mask) },
    roadDetail: { value: imageTexture(paintRoadDetail(), THREE.NearestFilter, THREE.SRGBColorSpace) },
    roadTone: { value: imageTexture(paintRoadTone(), THREE.LinearFilter, THREE.NoColorSpace) },
    roadPixel: { value: pixel },
    roadOrigin: { value: mask.from * S },
    roadMaskMeters: { value: (mask.size / mask.res) * S },
    roadDetailMeters: { value: ROAD_DETAIL_SIDE * pixel },
    roadToneMeters: { value: ROAD_TONE_SIDE * ROAD_TONE_PIXELS * pixel },
    roadPlainLuma: { value: luma(new THREE.Color(ROAD_PLAIN)) },
    roadSandLuma: { value: luma(new THREE.Color(ROAD_SAND)) },
    roadDesert: { value: desertTexture(t) },
    roadDesertMeters: { value: t.size * S },
    shoulderFrom: { value: SHOULDER_FROM },
    roadFray: { value: ROAD_FRAY },
    rimShare: { value: RIM_SHARE },
    rimInside: { value: RIM_INSIDE },
    shoulderStones: { value: SHOULDER_STONES },
    rimColor: { value: new THREE.Color(PAL.roadRim) },
    stoneColor: { value: new THREE.Color(PAL.stoneGrey) },
    dirtGroundLuma: { value: luma(new THREE.Color(DIRT_UNDER)) },
    dirtTint: { value: dirtTint() },
    glassField: { value: glassTexture(t) },
    glassFieldMeters: { value: t.size * S },
    glassBase: { value: new THREE.Color(GLASS_BASE) },
    glassPlate: { value: GLASS_PLATE * S },
    glassTint: { value: GLASS_TINT },
    glassSeam: { value: GLASS_SEAM },
    glassSeamColor: { value: new THREE.Color(GLASS_SEAM_COLOR) },
    glassDust: { value: new THREE.Color(GLASS_DUST) },
    ...padUniforms(atlasOf(t), pixel),
  };
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vRoadXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvRoadXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n#define PAD_COUNT ${uniforms.padCenters.value.length}\n${ROAD_UNIFORMS}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${ROAD_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${key()}|roads`;
  material.needsUpdate = true;
}

const ROAD_UNIFORMS = `varying vec2 vRoadXZ;
uniform sampler2D roadMask;
uniform sampler2D roadDetail;
uniform sampler2D roadTone;
uniform float roadPixel;
uniform float roadOrigin;
uniform float roadMaskMeters;
uniform float roadDetailMeters;
uniform float roadToneMeters;
uniform float roadPlainLuma;
uniform float roadSandLuma;
uniform sampler2D roadDesert;
uniform float roadDesertMeters;
uniform float shoulderFrom;
uniform float roadFray;
uniform float rimShare;
uniform float rimInside;
uniform float shoulderStones;
uniform vec3 rimColor;
uniform vec3 stoneColor;
uniform float dirtGroundLuma;
uniform vec3 dirtTint;
uniform sampler2D glassField;
uniform float glassFieldMeters;
uniform vec3 glassBase;
uniform float glassPlate;
uniform float glassTint;
uniform float glassSeam;
uniform vec3 glassSeamColor;
uniform vec3 glassDust;
#if PAD_COUNT > 0
uniform vec2 padCenters[PAD_COUNT];
uniform vec2 padAxes[PAD_COUNT];
#endif
uniform vec2 padHalf;
uniform float padBorder;
uniform vec3 padDust;
uniform vec3 padMark;
float glassHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float glassNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(glassHash(i), glassHash(i + vec2(1.0, 0.0)), f.x), mix(glassHash(i + vec2(0.0, 1.0)), glassHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

const ROAD_FRAGMENT = `{
  float glassEdge = texture2D(glassField, vRoadXZ / glassFieldMeters).r
    + (glassNoise(vRoadXZ / ${(GLASS_EDGE_SCALE * S).toFixed(2)}) - 0.5) * ${GLASS_EDGE_WOBBLE.toFixed(2)}
    + (glassNoise(vRoadXZ / ${(GLASS_EDGE_FINE_SCALE * S).toFixed(2)} + 53.1) - 0.5) * ${GLASS_EDGE_FINE.toFixed(2)};
  float glassSoft = fwidth(glassEdge) * 0.75;
  float glassCover = smoothstep(0.5 - glassSoft, 0.5 + glassSoft, glassEdge);
  if (glassCover > 0.0) {
    vec3 groundColor = diffuseColor.rgb;
    diffuseColor.rgb = glassBase;
    vec2 glassAt = vRoadXZ + (vec2(glassNoise(vRoadXZ / ${GLASS_WARP_SCALE.toFixed(2)}), glassNoise(vRoadXZ / ${GLASS_WARP_SCALE.toFixed(2)} + 31.7)) - 0.5) * ${GLASS_WARP.toFixed(2)};
    vec2 plateAt = glassAt / glassPlate;
    vec2 plateCell = floor(plateAt);
    vec2 plateIn = plateAt - plateCell;
    float plateFlip = step(0.5, fract(sin(dot(plateCell, vec2(27.17, 91.43))) * 43758.5453));
    float plateU = mix(plateIn.x, 1.0 - plateIn.x, plateFlip);
    float plateHalf = plateU + plateIn.y > 1.0 ? 1.0 : 0.0;
    float plateHash = fract(sin(dot(plateCell + plateHalf * vec2(0.53, 0.29), vec2(12.9898, 78.233))) * 43758.5453);
    float glassBroad = glassNoise(vRoadXZ / 7.0);
    float glassFine = glassNoise(vRoadXZ / 0.8);
    diffuseColor.rgb *= 1.0 + (plateHash - 0.5) * 2.0 * glassTint + (glassBroad - 0.5) * 0.16 + (glassFine - 0.5) * 0.06;
    diffuseColor.rgb = mix(diffuseColor.rgb, glassDust, smoothstep(0.35, 0.8, glassNoise(vRoadXZ / 4.0 + 7.3)) * ${GLASS_DUST_MIX.toFixed(2)});
    float plateEdge = min(min(plateIn.x, 1.0 - plateIn.x), min(plateIn.y, 1.0 - plateIn.y));
    float seamDist = min(plateEdge, abs(plateU + plateIn.y - 1.0) * 0.70710678) * glassPlate;
    float seamSoft = fwidth(seamDist) * 1.5;
    float seam = 1.0 - smoothstep(glassSeam * 0.5 - seamSoft, glassSeam * 0.5 + seamSoft, seamDist);
    seam *= smoothstep(0.4, 0.8, glassNoise(vRoadXZ / 3.0 + 19.1)) * (0.4 + 0.6 * glassFine);
    diffuseColor.rgb = mix(diffuseColor.rgb, glassSeamColor, seam * ${GLASS_SEAM_MIX});
    diffuseColor.rgb = mix(groundColor, diffuseColor.rgb, glassCover);
  }
  vec2 roadAt = roadOrigin + (floor((vRoadXZ - roadOrigin) / roadPixel) + 0.5) * roadPixel;
  vec2 roadMaskAt = texture2D(roadMask, (roadAt - roadOrigin) / roadMaskMeters).rg;
  float roadCover = roadMaskAt.r;
  float dirtCover = roadMaskAt.g;
  vec4 roadLook = texture2D(roadDetail, (roadAt - roadOrigin) / roadDetailMeters);
  float roadWander = texture2D(roadTone, (roadAt - roadOrigin) / roadToneMeters).r;
  float roadSand = texture2D(roadDesert, roadAt / roadDesertMeters).r;
  float groundLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float groundShade = clamp(groundLuma / mix(roadPlainLuma, roadSandLuma, roadSand), 0.7, 1.2);
  vec3 roadColor = roadLook.rgb * (0.94 + 0.12 * roadWander) * groundShade;
  vec3 dirtColor = roadLook.rgb * (0.94 + 0.12 * roadWander) * clamp(groundLuma / dirtGroundLuma, 0.7, 1.2) * dirtTint;
  float roadEdge = 0.5 + (roadWander - 0.5) * 0.4 + (roadLook.a - 0.5) * 0.1;
  float dirtEdge = ${DIRT_EDGE} + (roadWander - 0.5) * ${DIRT_WANDER} + (roadLook.a - 0.5) * 0.02;
  vec3 rimSand = rimColor * groundShade;
  if (roadCover > roadEdge) {
    float inner = 1.0 - smoothstep(roadEdge, roadEdge + 0.1, roadCover);
    float edgeDim = roadCover < roadEdge + 0.1 ? mix(0.92, 1.0, roadSand) : 1.0;
    diffuseColor.rgb = roadLook.a > 1.0 - inner * rimInside * roadSand ? rimSand : roadColor * edgeDim;
  } else if (roadCover > shoulderFrom) {
    float k = smoothstep(shoulderFrom, roadEdge, roadCover) * roadSand;
    if (roadLook.a < k * roadFray) diffuseColor.rgb = roadColor;
    else if (roadLook.a > 1.0 - k * shoulderStones) diffuseColor.rgb = stoneColor * (0.8 + 0.4 * fract(roadLook.a * 13.0)) * groundShade;
    else if (roadLook.a > 1.0 - k * rimShare) diffuseColor.rgb = rimSand;
  } else if (dirtCover > dirtEdge - ${DIRT_SOFT}) {
    float dirtIn = smoothstep(dirtEdge - ${DIRT_SOFT}, dirtEdge, dirtCover);
    float dirtShade = mix(${DIRT_SHOULDER}, 1.0, smoothstep(dirtEdge, dirtEdge + ${DIRT_SOFT}, dirtCover));
    diffuseColor.rgb = mix(diffuseColor.rgb, dirtColor * dirtShade, dirtIn);
  }
#if PAD_COUNT > 0
  for (int i = 0; i < PAD_COUNT; i++) {
    vec2 padOff = roadAt - padCenters[i];
    vec2 padIn = padHalf - abs(vec2(dot(padOff, padAxes[i]), dot(padOff, vec2(-padAxes[i].y, padAxes[i].x))));
    float padDepth = min(padIn.x, padIn.y);
    if (padDepth <= 0.0) continue;
    diffuseColor.rgb = mix(roadColor, padDust * groundShade, 0.35);
    if (padDepth < padBorder && roadLook.a > 0.12) diffuseColor.rgb = padMark * groundShade;
  }
#endif
}`;

function padUniforms(atlas: Atlas, pixel: number) {
  const centers: THREE.Vector2[] = [];
  const axes: THREE.Vector2[] = [];
  for (const site of atlasSites(atlas))
    for (const pad of sitePads(site)) {
      centers.push(new THREE.Vector2(pad.x * S, pad.y * S));
      axes.push(new THREE.Vector2(pad.x - site.pos.x, pad.y - site.pos.y).normalize());
    }
  const { length, width } = REGION.sites.pad;
  return {
    padCenters: { value: centers },
    padAxes: { value: axes },
    padHalf: { value: new THREE.Vector2((length / 2) * S, (width / 2) * S) },
    padBorder: { value: PAD_BORDER * pixel },
    padDust: { value: new THREE.Color(PAL.sand[3]) },
    padMark: { value: new THREE.Color(PAL.padMark) },
  };
}

function maskTexture(c: PaintCanvas): THREE.DataTexture {
  const rgba = c.ctx.getImageData(0, 0, c.size, c.size).data;
  const cover = new Uint8Array(c.size * c.size * 2);
  for (let i = 0; i < c.size * c.size; i++) {
    cover[i * 2] = rgba[i * 4];
    cover[i * 2 + 1] = rgba[i * 4 + 1];
  }
  const texture = new THREE.DataTexture(cover, c.size, c.size, THREE.RGFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function glassTexture(t: Terrain): THREE.DataTexture {
  const texture = new THREE.DataTexture(glassField(t), t.size, t.size, THREE.RedFormat);
  texture.unpackAlignment = 1;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function desertTexture(t: Terrain): THREE.DataTexture {
  const look = lookTypes(t);
  const weight = new Uint8Array(t.size * t.size);
  for (let i = 0; i < weight.length; i++) weight[i] = Math.round(desertWeight(look[i]) * 255);
  const texture = new THREE.DataTexture(weight, t.size, t.size, THREE.RedFormat);
  texture.unpackAlignment = 1;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function imageTexture(image: RoadImage, filter: THREE.MagnificationTextureFilter, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(image.pixels, image.side, image.side, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = filter;
  texture.minFilter = filter === THREE.NearestFilter ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function dirtTint(): THREE.Vector3 {
  const road = new THREE.Color(PAL.road);
  const dirt = new THREE.Color(PAL.dirtRoad);
  return new THREE.Vector3(dirt.r / road.r, dirt.g / road.g, dirt.b / road.b);
}

function luma(c: THREE.Color): number {
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
}
