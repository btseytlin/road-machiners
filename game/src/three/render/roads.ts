// Roads and site pads are drawn by the ground shader, so they lie exactly on the ground that wheels touch.
// The shader splits the ground into road pixels a third the size of the ground paint pixels. A road pixel
// takes the road look where the road mask covers its center, and the slow tone and a per-pixel dither fray

import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import { REGION } from "../../data/region";
import { TERRAIN_TYPES } from "../../data/terrain";
import type { PaintCanvas } from "../../render/groundPaint";
import { sitePads } from "../../sim/sites";
import { mix, PAL } from "../../render/palette";
import { paintRoadDetail, paintRoadMask, paintRoadTone, ROAD_DETAIL_SIDE, ROAD_TONE_PIXELS, ROAD_TONE_SIDE, type RoadImage } from "../../render/roadPaint";

const S = PHYSICS.metersPerTile;
const PIXEL_SPLIT = 3;
const GROUND_UNDER = mix(TERRAIN_TYPES.hardpan.color, PAL.sand[3], 0.1);
const PAD_BORDER = 2;

export function drawRoads(material: THREE.MeshLambertMaterial, mask: PaintCanvas): void {
  paintRoadMask(mask);
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
    roadGroundLuma: { value: luma(new THREE.Color(GROUND_UNDER)) },
    ...padUniforms(pixel),
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
uniform float roadGroundLuma;
uniform vec2 padCenters[PAD_COUNT];
uniform vec2 padAxes[PAD_COUNT];
uniform vec2 padHalf;
uniform float padBorder;
uniform vec3 padDust;
uniform vec3 padMark;`;

const ROAD_FRAGMENT = `{
  vec2 roadAt = roadOrigin + (floor((vRoadXZ - roadOrigin) / roadPixel) + 0.5) * roadPixel;
  float roadCover = texture2D(roadMask, (roadAt - roadOrigin) / roadMaskMeters).r;
  vec4 roadLook = texture2D(roadDetail, (roadAt - roadOrigin) / roadDetailMeters);
  float roadWander = texture2D(roadTone, (roadAt - roadOrigin) / roadToneMeters).r;
  float groundShade = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / roadGroundLuma, 0.7, 1.2);
  vec3 roadColor = roadLook.rgb * (0.94 + 0.12 * roadWander) * groundShade;
  float roadEdge = 0.5 + (roadWander - 0.5) * 0.4 + (roadLook.a - 0.5) * 0.1;
  if (roadCover > roadEdge) diffuseColor.rgb = roadColor * (roadCover < roadEdge + 0.1 ? 0.92 : 1.0);
  for (int i = 0; i < PAD_COUNT; i++) {
    vec2 padOff = roadAt - padCenters[i];
    vec2 padIn = padHalf - abs(vec2(dot(padOff, padAxes[i]), dot(padOff, vec2(-padAxes[i].y, padAxes[i].x))));
    float padDepth = min(padIn.x, padIn.y);
    if (padDepth <= 0.0) continue;
    diffuseColor.rgb = mix(roadColor, padDust * groundShade, 0.35);
    if (padDepth < padBorder && roadLook.a > 0.12) diffuseColor.rgb = padMark * groundShade;
  }
}`;

function padUniforms(pixel: number) {
  const centers: THREE.Vector2[] = [];
  const axes: THREE.Vector2[] = [];
  for (const site of [...REGION.towns, ...REGION.locations])
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
  const cover = new Uint8Array(c.size * c.size);
  for (let i = 0; i < cover.length; i++) cover[i] = rgba[i * 4];
  const texture = new THREE.DataTexture(cover, c.size, c.size, THREE.RedFormat);
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

function luma(c: THREE.Color): number {
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
}
