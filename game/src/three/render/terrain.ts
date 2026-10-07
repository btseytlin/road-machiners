import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import {
  paintGroundCanvas,
  TERRAIN_MARGIN,
  type PaintCanvas,
} from "../../render/groundPaint";
import { deckAt, DECKS, railOffset, type Deck } from "../../sim/bridge";
import { deckHeight, deckSegments, type DeckSegment, type Terrain } from "../../sim/terrain";
import type { World } from "../../sim/types";
import { drawRoads } from "./roads";
import type { RenderScope } from "./scope";

const S = PHYSICS.metersPerTile;
const TEXTURE_SIDE = 2048; // 16 MiB RGBA before mipmaps, independent of region area.
export const TERRAIN_CHUNK = 32; // Roughly two normal camera widths, allowing offscreen terrain culling.
const FACET_TINT = 0.04; // largest brightness shift of one ground triangle, so flat ground reads as low-poly facets

// A canvas over the whole map and its margin, one per ground layer.
function mapCanvas(w: World): PaintCanvas {
  const from = -TERRAIN_MARGIN;
  const res = TEXTURE_SIDE / (w.size + 2 * TERRAIN_MARGIN);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get terrain canvas context");
  return {
    ctx,
    size: TEXTURE_SIDE,
    res,
    from,
    toPx: (tile) => (tile - from) * res,
  };
}

const groundTextures = new WeakMap<Terrain, THREE.CanvasTexture>();

// The painted ground of a terrain, painted once. main.ts paints it while assets load.
export function groundTexture(w: World): THREE.CanvasTexture {
  let texture = groundTextures.get(w.terrain);
  if (!texture) {
    texture = paintTexture(w);
    groundTextures.set(w.terrain, texture);
  }
  return texture;
}

function paintTexture(w: World): THREE.CanvasTexture {
  const c = mapCanvas(w);
  paintGroundCanvas(c, w.terrain, { hillshade: 0.35 });
  const texture = new THREE.CanvasTexture(c.ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Canvas row 0 is map y at the top edge, and the UVs grow with map y, so the image must not be flipped.
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

// The ground map's uv per meter. The map spans the world plus TERRAIN_MARGIN tiles on each side.
export function groundUvPerMeter(size: number): number {
  return 1 / ((size + 2 * TERRAIN_MARGIN) * S);
}

export type TerrainChunk = {
  x: number;
  y: number;
  width: number;
  depth: number;
  mesh: THREE.Mesh;
};

// Meters the drawn ground stays under a deck inside its outline. Near a deck's ends the abutment lies within
// centimeters of the deck line, and the drawn triangles, split along one diagonal, would poke through the plates.
const DECK_FLOOR_GAP = 0.5;

// Bounding box of each deck's outline, so most corners skip the deck test.
const DECK_BOXES = DECKS.map((deck) => {
  const points = deck.rails.flat();
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
});

// The highest the ground is drawn at a map point inside a deck outline, in tiles, or null off every deck.
// Render only: groundAt, physics, nav and sight keep the baked ground.
export function deckFloorCap(t: Terrain, x: number, y: number): number | null {
  if (!DECK_BOXES.some((b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY)) return null;
  const on = deckAt(x, y);
  return on === null ? null : deckHeight(t, on.deck, on.along) - DECK_FLOOR_GAP / S;
}

// The drawn height of a terrain corner in tiles: its baked height, kept under any deck above it.
function drawnHeight(t: Terrain, x: number, y: number): number {
  const h = t.heights[y * (t.size + 1) + x];
  const cap = deckFloorCap(t, x, y);
  return cap === null ? h : Math.min(h, cap);
}

// The ground mesh geometry of one chunk, in world meters, from map corner (x, y) over width by depth tiles.
export function chunkGeometry(t: Terrain, x: number, y: number, width: number, depth: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width * S, depth * S, width, depth).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  const span = t.size + TERRAIN_MARGIN * 2;
  for (let j = 0; j <= depth; j++)
    for (let i = 0; i <= width; i++) {
      const k = j * (width + 1) + i;
      pos.setXYZ(k, (x + i) * S, drawnHeight(t, x + i, y + j) * S, (y + j) * S);
      uv.setXY(k, (x + i + TERRAIN_MARGIN) / span, (y + j + TERRAIN_MARGIN) / span);
    }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// Terrain chunks register with the scope, so only chunks near the view are drawn. Returned for the fog,
// which greys out the ground per corner. Roads are part of the ground material.
export function terrainMesh(w: World, scope: RenderScope): TerrainChunk[] {
  const chunks: TerrainChunk[] = [];
  // Flat shading lights each ground triangle by its own face, so slopes read as low-poly facets.
  const material = new THREE.MeshLambertMaterial({ map: groundTexture(w), flatShading: true });
  drawRoads(material, mapCanvas(w), w.terrain);
  facetGround(material);
  for (let y = 0; y < w.size; y += TERRAIN_CHUNK)
    for (let x = 0; x < w.size; x += TERRAIN_CHUNK) {
      const width = Math.min(TERRAIN_CHUNK, w.size - x);
      const depth = Math.min(TERRAIN_CHUNK, w.size - y);
      const mesh = new THREE.Mesh(chunkGeometry(w.terrain, x, y, width, depth), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scope.add(
        mesh,
        { x: x + width / 2, y: y + depth / 2 },
        Math.hypot(width, depth) / 2,
      );
      chunks.push({ x, y, width, depth, mesh });
    }
  for (const deck of DECKS) deckPick(w.terrain, deck, scope);
  return chunks;
}

// Tints each ground triangle by a hash of its tile and its half, so flat ground shows facets like slopes do.
// PlaneGeometry splits each tile quad along its anti-diagonal, where the tile fractions sum to 1. It reads the
// world XZ varying vRoadXZ that drawRoads adds, so it runs after drawRoads.
function facetGround(material: THREE.MeshLambertMaterial): void {
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.facetTile = { value: S };
    shader.uniforms.facetTint = { value: FACET_TINT };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float facetTile;\nuniform float facetTint;")
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FACET_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${key()}|facets`;
  material.needsUpdate = true;
}

const FACET_FRAGMENT = `{
  vec2 facetAt = vRoadXZ / facetTile;
  vec2 facetCell = floor(facetAt);
  vec2 facetIn = facetAt - facetCell;
  float facetHalf = facetIn.x + facetIn.y > 1.0 ? 1.0 : 0.0;
  float facetHash = fract(sin(dot(facetCell + facetHalf * vec2(0.37, 0.71), vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb *= 1.0 + (facetHash - 0.5) * 2.0 * facetTint;
}`;

// An unseen flat quad on each straight piece of a deck, so a click on the deck picks the deck, not the ground under
// it. The deck's model draws the deck.
function deckPick(t: Terrain, deck: Deck, scope: RenderScope): void {
  for (const seg of deckSegments(t, deck)) piecePick(deck, seg, scope);
}

function piecePick(deck: Deck, seg: DeckSegment, scope: RenderScope): void {
  const { h0, h1 } = seg;
  const [a0, a1, b0, b1] = [-1, 1].flatMap((side) => {
    const off = railOffset(deck.axis, deck.width, side);
    return [{ x: seg.from.x + off.x, y: seg.from.y + off.y }, { x: seg.to.x + off.x, y: seg.to.y + off.y }];
  });
  const corners = [[a0, h0], [a1, h1], [b1, h1], [b0, h0]] as const;
  const geo = new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap(([p, h]) => [p.x * S, h * S, p.y * S]), 3))
    .setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.visible = false;
  const mid = { x: (a0.x + b1.x) / 2, y: (a0.y + b1.y) / 2 };
  scope.add(mesh, mid, seg.length / 2);
}
