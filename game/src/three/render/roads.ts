// Roads and site pads are drawn by the ground shader, so they lie exactly on the ground that wheels touch.
// The shader splits the ground into road pixels a third the size of the ground paint pixels. A road pixel
// takes the road look where the road mask covers its center, and the slow tone and a per-pixel dither fray
// the edge. Past the edge, where the blurred mask is still above SHOULDER_FROM, the edge frays both ways:
// the dither keeps road pixels out on the sand and light rim sand pixels with a few grey stones, more of
// each the closer they lie to the road. Just inside the edge, a few road pixels take the rim sand too. The fray
// and the rim scale with the desert weight of the ground beside the road, read from lookTypes() and blended
// between tile centers like the ground paint, so salt, mud, old asphalt and fields keep the plain edge, a darker
// band just inside the road.
// A pad is a paler floor of the same dirt inside a worn orange outline, where the road ends. A territory's
// dirt roads, the mask's green channel, take the same detail tinted grey-brown, with a darker soft shoulder.

import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import { REGION } from "../../data/region";
import { TERRAIN_TYPES } from "../../data/terrain";
import { desertWeight, lookTypes, ROAD_PLAIN, ROAD_SAND, type PaintCanvas } from "../../render/groundPaint";
import { sitePads } from "../../sim/sites";
import type { Terrain } from "../../sim/terrain";
import { PAL } from "../../render/palette";
import { paintRoadDetail, paintRoadMask, paintRoadTone, ROAD_DETAIL_SIDE, ROAD_TONE_PIXELS, ROAD_TONE_SIDE, type RoadImage } from "../../render/roadPaint";

const S = PHYSICS.metersPerTile;
const PIXEL_SPLIT = 3; // road pixels across one ground paint pixel
const PAD_BORDER = 2; // road pixels across the pad outline
const SHOULDER_FROM = 0.42; // road mask cover where the shoulder starts, out past the road edge near 0.5
const ROAD_FRAY = 0.35; // share of shoulder pixels that take the road color at the road edge
const RIM_SHARE = 0.3; // share of shoulder pixels that take the rim sand at the road edge, stones included
const RIM_INSIDE = 0.15; // share of road pixels that take the rim sand at the road edge
const SHOULDER_STONES = 0.05; // share of shoulder pixels that are grey stones at the road edge
// A dirt road's tiles bake as track ground, which paints darker than hardpan, so a dirt road takes its shade relative
// to the track paint. Measured against the hardpan road reference, it would sit at the 0.7 clamp and draw far darker than its tint.
const DIRT_UNDER = TERRAIN_TYPES.track.color;
// Where the dirt road's edge lies in the blurred green channel. A road is stroked at 0.9 of its width, and its edge
// lies a little under half strength, so it shows as wide as the track tiles it marks. A 2.5-tile road peaks at about
// 0.84 under its 0.8-tile blur and falls to 0.44 at 1.25 tiles out.
const DIRT_EDGE = 0.44;
const DIRT_WANDER = 0.2; // how far the slow tone moves the dirt road's edge, half as far as a region road's
const DIRT_SOFT = 0.15; // mask span over which the shoulder fades in outside the edge and lightens inside it
const DIRT_SHOULDER = 0.9; // shade of the darkest shoulder, at the edge

// Paints the road mask on `mask`, which must map the map like the ground canvas, and draws roads and
// pads on the ground material of terrain `t`.
export function drawRoads(material: THREE.MeshLambertMaterial, mask: PaintCanvas, t: Terrain): void {
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
uniform vec2 padCenters[PAD_COUNT];
uniform vec2 padAxes[PAD_COUNT];
uniform vec2 padHalf;
uniform float padBorder;
uniform vec3 padDust;
uniform vec3 padMark;`;

// Samples everything at the road pixel center, so edges step in whole road pixels like the ground
// paint. Under 0.5 the mask is off the road. The tone moves that line by meters and the dither frays it.
// Between shoulderFrom and the road edge the same dither picks shoulder pixels, fewer away from the road:
// the bottom of its range takes the road color, the top grey stones, and the band below the stones rim
// sand. Within 0.1 of mask cover inside the edge, the top of the range takes rim sand. Both scale with the
// desert weight of the ground beside the road, and the darker inner band fades in as it drops, so zero-weight
// ground keeps the plain edge. The road takes the ground's shade relative to the plain or the desert ground under
// a road, by the same weight, so it keeps its brightness whatever ground it crosses.
// Off a region road, a dirt road fades in over its shoulder and is darkest at its edge. A region road keeps priority
// where the two meet. A pad covers the road under it. Its outline skips a few pixels, like worn paint.
const ROAD_FRAGMENT = `{
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
  for (int i = 0; i < PAD_COUNT; i++) {
    vec2 padOff = roadAt - padCenters[i];
    vec2 padIn = padHalf - abs(vec2(dot(padOff, padAxes[i]), dot(padOff, vec2(-padAxes[i].y, padAxes[i].x))));
    float padDepth = min(padIn.x, padIn.y);
    if (padDepth <= 0.0) continue;
    diffuseColor.rgb = mix(roadColor, padDust * groundShade, 0.35);
    if (padDepth < padBorder && roadLook.a > 0.12) diffuseColor.rgb = padMark * groundShade;
  }
}`;

// Pad centers and their axes out from the site, in meters. Pads are the same size everywhere.
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

// The mask's red (region roads) and green (dirt roads) channels.
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

// Desert weight of each tile's look type, see lookTypes(). It blends between tile centers like the ground paint's
// desertAt(), so a pixel whose four nearest tile centers all have no desert look reads 0 and keeps the plain edge.
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

// Turns the road detail, whose mean color is PAL.road, toward PAL.dirtRoad, channel by channel.
function dirtTint(): THREE.Vector3 {
  const road = new THREE.Color(PAL.road);
  const dirt = new THREE.Color(PAL.dirtRoad);
  return new THREE.Vector3(dirt.r / road.r, dirt.g / road.g, dirt.b / road.b);
}

function luma(c: THREE.Color): number {
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
}
