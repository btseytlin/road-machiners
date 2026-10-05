// The dev-only icons page that npm run icons drives in headless Chromium. It renders every catalog entry in both views,
// then lays out the two unlabeled sprite sheets the game reads, the three labeled atlases (top-down, diagonal and the
// view the game shows), the closest-pairs report and the manifest body. The items sheet is an SVG of vector blueprints,
// and the chassis sheet a PNG. Item tiles sit on their category tone. It checks that weapon barrels read the right way.
// scripts/icons.mjs writes the files and fails on the check.

import { CHASSIS } from '../../data/chassis';
import { GOODS } from '../../data/goods';
import { PARTS } from '../../data/parts';
import { ITEM_TONES } from '../../render/palette';
import { iconCatalog, itemTone, ICON_SECTIONS, ICON_WEAPON_PICKS, type IconEntry, type IconSection } from '../../render/partLooks';
import { loadModels, type ModelName } from '../render/models';
import {
  barrelReads,
  context,
  DIAGONAL_PITCH_DEG,
  DIAGONAL_YAW_DEG,
  hex,
  iconHash,
  iconView,
  ICON_VIEWS,
  MARGIN,
  renderIcon,
  type BarrelRead,
  type IconCategory,
  type IconView,
} from './render';

const CELL = { items: 128, chassis: 192 };
const COLS = { items: 16, chassis: 8 };
const VIEWS: readonly IconView[] = ['top', 'diagonal'];
const SMALL = [36, 22]; // the card and chip sizes the atlas shows beside each large icon
const REPORT_SIZE = 36;
const REPORT_PAIRS = 10;

const SECTION_TITLES: Record<IconSection, string> = {
  weapon: 'Weapons',
  engine: 'Engines',
  armor: 'Armor',
  cargo: 'Cargo',
  store: 'Stores and scanner',
  core: 'Built-in parts',
  good: 'Goods',
  chassis: 'Chassis',
};

// Atlas layout in pixels.
const ATLAS = { cols: 6, tileW: 300, tileH: 176, big: 128, pad: 12, heading: 44, title: 56 };
const TOP_CAPTION = 'Top-down, nose up';
const DIAGONAL_CAPTION = `Diagonal: side view, nose right, ${DIAGONAL_YAW_DEG}° toward the rear and ${DIAGONAL_PITCH_DEG}° up`;
const GAME_CAPTION = 'The view the game shows';
const PANEL = 0x272b2e; // the UI panel color, behind chassis portraits as in the truck shop
const PAGE = 0x1b1c1d;
const TEXT = 0xe0d8ca;
const MUTED = 0xaaa69e;

type Sheet = 'items' | 'chassis';
// svg: an item's blueprint in the view the game shows, as an SVG group in cell units. Null for a chassis.
type Rendered = { entry: IconEntry; sheet: Sheet; views: Record<IconView, HTMLCanvasElement>; svg: string | null };
// A drawn extent as shares of the cell: x, y, w, h.
type Box = [number, number, number, number];
type Cell = { index: number; hash: string; box: Box };
type Manifest = {
  cell: Record<Sheet, number>;
  margin: number;
  cols: Record<Sheet, number>;
  views: Record<IconCategory, IconView>;
  items: Record<string, Cell>;
  chassis: Record<string, Cell>;
};
type Orientation = { id: string; ok: boolean; read: BarrelRead };
type AtlasSection = { title: string; tiles: { entry: IconEntry; icon: HTMLCanvasElement }[] };
export type IconBuild = {
  files: Record<string, string>;
  manifest: Manifest;
  orientation: Orientation[];
  report: string;
};

async function build(): Promise<IconBuild> {
  await loadModels();
  const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
  const bytes = await modelBytes(catalog);
  const rendered: Rendered[] = catalog.map((entry) => {
    const sheet: Sheet = entry.section === 'chassis' ? 'chassis' : 'items';
    const top = renderIcon(entry, 'top', CELL[sheet]);
    const diagonal = renderIcon(entry, 'diagonal', CELL[sheet]);
    return { entry, sheet, views: { top: top.icon, diagonal: diagonal.icon }, svg: (iconView(entry) === 'top' ? top : diagonal).svg };
  });
  const files: Record<string, string> = {
    'public/icons/items.svg': `data:image/svg+xml;base64,${btoa(svgSheetOf(rendered))}`,
    'public/icons/chassis.png': sheetOf(rendered, 'chassis').toDataURL('image/png'),
    'public/icons/atlas/atlas-top.png': atlasOf(sectionsOf(rendered, () => 'top'), TOP_CAPTION).toDataURL('image/png'),
    'public/icons/atlas/atlas-diagonal.png': atlasOf(sectionsOf(rendered, () => 'diagonal'), DIAGONAL_CAPTION).toDataURL('image/png'),
    'public/icons/atlas/atlas-game.png': atlasOf(sectionsOf(rendered, iconView), GAME_CAPTION).toDataURL('image/png'),
  };
  return { files, manifest: manifestOf(rendered, bytes), orientation: orientationOf(catalog), report: reportOf(rendered) };
}

async function modelBytes(catalog: readonly IconEntry[]): Promise<Map<ModelName, Uint8Array>> {
  const names = [...new Set(catalog.flatMap((e) => e.models))];
  const out = new Map<ModelName, Uint8Array>();
  await Promise.all(
    names.map(async (name) => {
      const res = await fetch(`${import.meta.env.BASE_URL}models/${name}.glb`);
      if (!res.ok) throw new Error(`Model ${name}.glb failed to load: HTTP ${res.status}`);
      out.set(name, new Uint8Array(await res.arrayBuffer()));
    }),
  );
  return out;
}

function inSheet(rendered: readonly Rendered[], sheet: Sheet): Rendered[] {
  return rendered.filter((r) => r.sheet === sheet);
}

// A sheet's cells in order, each entry in the view the game shows. manifestOf() numbers them the same way.
function cellsOf(rendered: readonly Rendered[], sheet: Sheet): HTMLCanvasElement[] {
  return inSheet(rendered, sheet).map((r) => r.views[iconView(r.entry)]);
}

// The items sheet as one SVG, each blueprint in its cell, in the order manifestOf() numbers them.
function svgSheetOf(rendered: readonly Rendered[]): string {
  const items = inSheet(rendered, 'items');
  const cell = CELL.items;
  const cols = COLS.items;
  const cells = items.map((r, i) => {
    if (r.svg === null) throw new Error(`Item ${r.entry.id} has no blueprint`);
    return `<g transform="translate(${(i % cols) * cell} ${Math.floor(i / cols) * cell})">${r.svg}</g>`;
  });
  const [w, h] = [cols * cell, Math.ceil(items.length / cols) * cell];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${cells.join('')}</svg>\n`;
}

function sheetOf(rendered: readonly Rendered[], sheet: Sheet): HTMLCanvasElement {
  const cells = cellsOf(rendered, sheet);
  const cell = CELL[sheet];
  const canvas = document.createElement('canvas');
  canvas.width = COLS[sheet] * cell;
  canvas.height = Math.ceil(cells.length / COLS[sheet]) * cell;
  const ctx = context(canvas);
  cells.forEach((icon, i) => ctx.drawImage(icon, (i % COLS[sheet]) * cell, Math.floor(i / COLS[sheet]) * cell));
  return canvas;
}

function manifestOf(rendered: readonly Rendered[], bytes: Map<ModelName, Uint8Array>): Manifest {
  const read = (name: ModelName): Uint8Array => {
    const b = bytes.get(name);
    if (!b) throw new Error(`Model ${name} was not read`);
    return b;
  };
  const cellOf = (r: Rendered, index: number): Cell => ({ index, hash: iconHash(r.entry, iconView(r.entry), read), box: boxOf(r.views[iconView(r.entry)]) });
  const items = inSheet(rendered, 'items').map((r, index) => [r.entry.id, cellOf(r, index)]);
  const chassis = inSheet(rendered, 'chassis').map((r, index) => [r.entry.id, cellOf(r, index)]);
  return {
    cell: CELL,
    margin: MARGIN,
    cols: COLS,
    views: ICON_VIEWS,
    items: Object.fromEntries(items),
    chassis: Object.fromEntries(chassis),
  };
}

// Where a cell's drawn pixels lie, outline included, so a slot can fit the drawing to its box.
function boxOf(icon: HTMLCanvasElement): Box {
  const { width: w, height: h } = icon;
  const { data } = context(icon).getImageData(0, 0, w, h);
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error('An icon drew no pixels');
  return [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h];
}

// Every weapon's barrel must read from lower left to upper right in the diagonal view, by its sockets and its pixels.
function orientationOf(catalog: readonly IconEntry[]): Orientation[] {
  return catalog.flatMap((entry) => {
    if (!entry.weapon) return [];
    const read = barrelReads(entry, 'diagonal', CELL.items);
    const upRight = (p: { x: number; y: number }): boolean => p.x > read.head.x && p.y < read.head.y;
    return [{ id: entry.id, ok: upRight(read.tip) && upRight(read.pixelTip), read }];
  });
}

// The atlas sections in ICON_SECTIONS order, each entry in viewOf's view.
function sectionsOf(rendered: readonly Rendered[], viewOf: (entry: IconEntry) => IconView): AtlasSection[] {
  return ICON_SECTIONS.flatMap((s) => {
    const list = rendered.filter((r) => r.entry.section === s);
    return list.length ? [{ title: SECTION_TITLES[s], tiles: list.map((r) => ({ entry: r.entry, icon: r.views[viewOf(r.entry)] })) }] : [];
  });
}

// What an entry's icon sits on: an item's category tone, or the panel behind a chassis portrait.
function backdrop(entry: IconEntry): string {
  return hex(entry.section === 'chassis' ? PANEL : ITEM_TONES[itemTone(entry.id)]);
}

function atlasOf(sections: readonly AtlasSection[], caption: string): HTMLCanvasElement {
  const rows = sections.reduce((n, x) => n + Math.ceil(x.tiles.length / ATLAS.cols), 0);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.cols * ATLAS.tileW + ATLAS.pad * 2;
  canvas.height = ATLAS.title + sections.length * ATLAS.heading + rows * ATLAS.tileH + ATLAS.pad;
  const ctx = context(canvas);
  ctx.fillStyle = hex(PAGE);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex(TEXT);
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`ROAM item icons — ${caption}. Each tile: large, 36 px, 22 px.`, ATLAS.pad, 36);
  let y = ATLAS.title;
  for (const { title, tiles } of sections) {
    ctx.fillStyle = hex(TEXT);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(title, ATLAS.pad, y + 30);
    y += ATLAS.heading;
    tiles.forEach((t, i) => tile(ctx, t.entry, t.icon, ATLAS.pad + (i % ATLAS.cols) * ATLAS.tileW, y + Math.floor(i / ATLAS.cols) * ATLAS.tileH));
    y += Math.ceil(tiles.length / ATLAS.cols) * ATLAS.tileH;
  }
  return canvas;
}

function tile(ctx: CanvasRenderingContext2D, entry: IconEntry, icon: HTMLCanvasElement, x: number, y: number): void {
  ctx.fillStyle = hex(PANEL);
  ctx.fillRect(x + 2, y + 2, ATLAS.tileW - 4, ATLAS.tileH - 4);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = backdrop(entry);
  ctx.fillRect(x + 8, y + 6, ATLAS.big, ATLAS.big);
  ctx.drawImage(icon, x + 8, y + 6, ATLAS.big, ATLAS.big);
  let sx = x + ATLAS.big + 20;
  for (const s of SMALL) {
    const sy = y + 6 + (ATLAS.big - s) / 2;
    ctx.fillStyle = backdrop(entry);
    ctx.fillRect(sx, sy, s, s);
    ctx.drawImage(icon, sx, sy, s, s);
    sx += s + 14;
  }
  ctx.fillStyle = hex(TEXT);
  ctx.font = '15px sans-serif';
  ctx.fillText(entry.label, x + 8, y + ATLAS.big + 24, ATLAS.tileW - 16);
  ctx.fillStyle = hex(MUTED);
  ctx.font = '12px monospace';
  ctx.fillText(entry.id, x + 8, y + ATLAS.big + 40, ATLAS.tileW - 16);
}

// The item pairs that differ least at the card size, per view, each over its tone. A diagnostic, not a gate.
function reportOf(rendered: readonly Rendered[]): string {
  const items = inSheet(rendered, 'items');
  const lines: string[] = [`Closest item pairs at ${REPORT_SIZE} px by mean RGB difference (0-255), each over its tone.`];
  for (const view of VIEWS) {
    const px = items.map((r) => smallPixels(r.views[view], backdrop(r.entry)));
    const pairs: { a: string; b: string; d: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) pairs.push({ a: items[i].entry.id, b: items[j].entry.id, d: meanDiff(px[i], px[j]) });
    }
    pairs.sort((p, q) => p.d - q.d);
    lines.push('', `${view}:`, ...pairs.slice(0, REPORT_PAIRS).map((p) => `  ${p.d.toFixed(1).padStart(5)}  ${p.a} / ${p.b}`));
  }
  return `${lines.join('\n')}\n`;
}

function smallPixels(icon: HTMLCanvasElement, back: string): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_SIZE;
  canvas.height = REPORT_SIZE;
  const ctx = context(canvas);
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, REPORT_SIZE, REPORT_SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(icon, 0, 0, REPORT_SIZE, REPORT_SIZE);
  return ctx.getImageData(0, 0, REPORT_SIZE, REPORT_SIZE).data;
}

function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / ((a.length / 4) * 3);
}

declare global {
  interface Window {
    __ICONS__?: { build: () => Promise<IconBuild> };
  }
}

window.__ICONS__ = { build };
