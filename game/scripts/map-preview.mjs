// Top-down pictures of a map draft for tuning the bake: ground type colors under hillshade, site edges
// as rings and props in a color and shape per kind. An area is a rectangle of the map in tiles, { x, y, w, h } from its
// top-left corner. Pixel (px, py) covers the map point (area.x + (px + 0.5) / pxPerTile, area.y + (py + 0.5) / pxPerTile).

import { REGION } from '../src/data/region.ts';
import { TERRAIN, TERRAIN_TYPES } from '../src/data/terrain.ts';
import { TYPE_IDS } from '../src/sim/terrain.ts';

const OUTSIDE = 0x202020;
const SITE_EDGE = 0x8a1e14;
const PROP_LOOKS = {
  rock: { color: 0x3a3028, shape: 'disc' },
  crag: { color: 0x6a5a48, shape: 'disc' },
  ruin: { color: 0x6e2a1e, shape: 'box' },
  house: { color: 0xc0502a, shape: 'box' },
  gasStation: { color: 0xe8b820, shape: 'box' },
  silo: { color: 0xe8e0c8, shape: 'disc' },
  waterTower: { color: 0x2a6ab8, shape: 'disc' },
  bridgeSpan: { color: 0x8a2aa8, shape: 'long' },
  pole: { color: 0x101010, shape: 'disc' },
  billboard: { color: 0x20b0b0, shape: 'board' },
  tank: { color: 0x3e5a22, shape: 'disc' },
  shack: { color: 0xa8743a, shape: 'box' },
  fence: { color: 0xf4ecd0, shape: 'rail' },
  junk: { color: 0xc03890, shape: 'disc' },
  carWreck: { color: 0x2a2a70, shape: 'long' },
};
const DRAW_ORDER = Object.keys(PROP_LOOKS);
const COLORS = TYPE_IDS.map((id) => TERRAIN_TYPES[id].color);

export function paintMap(d, area, pxPerTile) {
  const pic = { width: Math.round(area.w * pxPerTile), height: Math.round(area.h * pxPerTile), rgba: new Uint8Array(0) };
  pic.rgba = new Uint8Array(pic.width * pic.height * 4);
  for (let py = 0; py < pic.height; py++) for (let px = 0; px < pic.width; px++) {
    const x = area.x + (px + 0.5) / pxPerTile;
    const y = area.y + (py + 0.5) / pxPerTile;
    put(pic, px, py, groundColor(d, x, y));
  }
  for (const site of [...REGION.towns, ...REGION.locations]) paintDisc(pic, area, pxPerTile, site.pos, site.radius, SITE_EDGE, site.radius - 1 / pxPerTile);
  const props = [...d.props].sort((a, b) => DRAW_ORDER.indexOf(a.kind) - DRAW_ORDER.indexOf(b.kind));
  for (const prop of props) paintProp(pic, area, pxPerTile, prop);
  return pic;
}

const BOX_SHAPES = {
  box: (r) => [r * Math.SQRT1_2, r * Math.SQRT1_2],
  long: (r) => [r, r / 2],
  rail: (r, halfPixel) => [r, halfPixel],
  deck: (r) => [r, REGION.roadWidth / 2],
  board: (r, halfPixel) => [Math.max(r / 5, halfPixel), r],
};

function paintProp(pic, area, pxPerTile, prop) {
  const look = PROP_LOOKS[prop.kind];
  if (!look) throw new Error(`No preview look for prop kind ${prop.kind}`);
  const halfPixel = 0.5 / pxPerTile;
  const r = Math.max(prop.r, halfPixel);
  if (look.shape === 'disc') return paintDisc(pic, area, pxPerTile, prop.pos, r, look.color, 0);
  const [halfAlong, halfAcross] = BOX_SHAPES[look.shape](r, halfPixel);
  paintBox(pic, area, pxPerTile, prop.pos, prop.yaw, halfAlong, halfAcross, look.color);
}

function groundColor(d, x, y) {
  if (x < 0 || y < 0 || x >= d.size || y >= d.size) return OUTSIDE;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const w = d.size + 1;
  const a = d.heights[j * w + i];
  const b = d.heights[j * w + i + 1];
  const c = d.heights[(j + 1) * w + i];
  const e = d.heights[(j + 1) * w + i + 1];
  const gx = b - a + (a - b - c + e) * (y - j);
  const gy = c - a + (a - b - c + e) * (x - i);
  const light = 1 + (gx * TERRAIN.light.x + gy * TERRAIN.light.y) * TERRAIN.slopeShade;
  return shade(COLORS[d.types[j * d.size + i]], light);
}

function paintDisc(pic, area, pxPerTile, center, radius, color, inner) {
  const x0 = Math.max(0, Math.floor((center.x - radius - area.x) * pxPerTile));
  const x1 = Math.min(pic.width - 1, Math.ceil((center.x + radius - area.x) * pxPerTile));
  const y0 = Math.max(0, Math.floor((center.y - radius - area.y) * pxPerTile));
  const y1 = Math.min(pic.height - 1, Math.ceil((center.y + radius - area.y) * pxPerTile));
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const r = Math.hypot(area.x + (px + 0.5) / pxPerTile - center.x, area.y + (py + 0.5) / pxPerTile - center.y);
    if (r <= radius && r >= inner) put(pic, px, py, color);
  }
}

function paintBox(pic, area, pxPerTile, center, yaw, halfAlong, halfAcross, color) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const reach = Math.hypot(halfAlong, halfAcross);
  const x0 = Math.max(0, Math.floor((center.x - reach - area.x) * pxPerTile));
  const x1 = Math.min(pic.width - 1, Math.ceil((center.x + reach - area.x) * pxPerTile));
  const y0 = Math.max(0, Math.floor((center.y - reach - area.y) * pxPerTile));
  const y1 = Math.min(pic.height - 1, Math.ceil((center.y + reach - area.y) * pxPerTile));
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const dx = area.x + (px + 0.5) / pxPerTile - center.x;
    const dy = area.y + (py + 0.5) / pxPerTile - center.y;
    if (Math.abs(dx * cos + dy * sin) <= halfAlong && Math.abs(dy * cos - dx * sin) <= halfAcross) put(pic, px, py, color);
  }
}

function shade(color, k) {
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((color >> s) & 0xff) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function put(pic, px, py, color) {
  const at = (py * pic.width + px) * 4;
  pic.rgba[at] = (color >> 16) & 0xff;
  pic.rgba[at + 1] = (color >> 8) & 0xff;
  pic.rgba[at + 2] = color & 0xff;
  pic.rgba[at + 3] = 255;
}
