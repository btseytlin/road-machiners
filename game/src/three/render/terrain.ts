import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import {
  paintGroundCanvas,
  TERRAIN_MARGIN,
  type PaintCanvas,
} from "../../render/groundPaint";
import { DECKS, railOffset, type Deck } from "../../sim/bridge";
import { deckSegments, type DeckSegment, type Terrain } from "../../sim/terrain";
import type { World } from "../../sim/types";
import { drawRoads } from "./roads";
import type { RenderScope } from "./scope";

const S = PHYSICS.metersPerTile;
const TEXTURE_SIDE = 2048; // 16 MiB RGBA before mipmaps, independent of region area.
export const TERRAIN_CHUNK = 32; // Roughly two normal camera widths, allowing offscreen terrain culling.

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

// Terrain chunks register with the scope, so only chunks near the view are drawn. Returned for the fog,
// which greys out the ground per corner. Roads are part of the ground material.
export function terrainMesh(w: World, scope: RenderScope): TerrainChunk[] {
  const chunks: TerrainChunk[] = [];
  const material = new THREE.MeshLambertMaterial({ map: groundTexture(w) });
  drawRoads(material, mapCanvas(w));
  for (let y = 0; y < w.size; y += TERRAIN_CHUNK)
    for (let x = 0; x < w.size; x += TERRAIN_CHUNK) {
      const width = Math.min(TERRAIN_CHUNK, w.size - x);
      const depth = Math.min(TERRAIN_CHUNK, w.size - y);
      const geo = new THREE.PlaneGeometry(
        width * S,
        depth * S,
        width,
        depth,
      ).rotateX(-Math.PI / 2);
      const pos = geo.getAttribute("position");
      const uv = geo.getAttribute("uv");
      for (let j = 0; j <= depth; j++)
        for (let i = 0; i <= width; i++) {
          const k = j * (width + 1) + i;
          pos.setXYZ(
            k,
            (x + i) * S,
            w.terrain.heights[(y + j) * (w.size + 1) + x + i] * S,
            (y + j) * S,
          );
          uv.setXY(
            k,
            (x + i + TERRAIN_MARGIN) / (w.size + TERRAIN_MARGIN * 2),
            (y + j + TERRAIN_MARGIN) / (w.size + TERRAIN_MARGIN * 2),
          );
        }
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
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
