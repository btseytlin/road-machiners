// The dev-only icons page that npm run icons drives in headless Chromium. It renders every catalog entry in both views,
// then lays out the two unlabeled sprite sheets the game reads, the three labeled atlases (top-down, diagonal and the
// view the game shows), the closest-pairs report and the manifest body. scripts/icons.mjs writes the files.

import { CHASSIS } from '../../data/chassis';
import { GOODS } from '../../data/goods';
import { PARTS } from '../../data/parts';
import { iconCatalog, ICON_SECTIONS, ICON_WEAPON_PICKS, type IconEntry, type IconSection } from '../../render/partLooks';
import { loadModels, type ModelName } from '../render/models';
import { barrelReads, context, hex, iconHash, iconView, ICON_VIEWS, MARGIN, OUTLINE_PX, renderIcon, type BarrelRead, type IconCategory, type IconView } from './render';

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
const DIAGONAL_CAPTION = 'Diagonal: side view, nose right, 20° toward the rear and 20° up';
const GAME_CAPTION = 'As the game shows them: equipment top-down, nose up. Cargo diagonal. Chassis top-down';
const PANEL = 0x272b2e; // the UI panel color, so the small sizes read as they do in game
const PAGE = 0x1b1c1d;
const TEXT = 0xe0d8ca;
const MUTED = 0xaaa69e;

type Sheet = 'items' | 'chassis';
type Rendered = { entry: IconEntry; sheet: Sheet; views: Record<IconView, HTMLCanvasElement> };
type Manifest = {
  cell: Record<Sheet, number>;
  margin: number;
  outline: number;
  portraitWidth: number;
  cols: Record<Sheet, number>;
  views: Record<IconCategory, IconView>;
  items: Record<string, { index: number; hash: string; box: Box }>;
  chassis: Record<string, { index: number; hash: string }>;
};
// A drawn extent as shares of the cell: x, y, w, h.
type Box = [number, number, number, number];
type Orientation = { id: string; ok: boolean; read: BarrelRead };
export type IconBuild = { files: Record<string, string>; manifest: Manifest; orientation: Orientation[]; report: string };

async function build(): Promise<IconBuild> {
  await loadModels();
  const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
  const bytes = await modelBytes(catalog);
  const rendered: Rendered[] = catalog.map((entry) => {
    const sheet: Sheet = entry.section === 'chassis' ? 'chassis' : 'items';
    const views = { top: renderIcon(entry, 'top', CELL[sheet]), diagonal: renderIcon(entry, 'diagonal', CELL[sheet]) };
    return { entry, sheet, views };
  });
  const files: Record<string, string> = {
    'public/icons/items.png': sheetOf(rendered, 'items').toDataURL('image/png'),
    'public/icons/chassis.png': sheetOf(rendered, 'chassis').toDataURL('image/png'),
    'public/icons/atlas/atlas-top.png': atlasOf(rendered, () => 'top', 'Top-down, nose up').toDataURL('image/png'),
    'public/icons/atlas/atlas-diagonal.png': atlasOf(rendered, () => 'diagonal', DIAGONAL_CAPTION).toDataURL('image/png'),
    'public/icons/atlas/atlas-game.png': atlasOf(rendered, iconView, GAME_CAPTION).toDataURL('image/png'),
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

function sheetOf(rendered: readonly Rendered[], sheet: Sheet): HTMLCanvasElement {
  const list = inSheet(rendered, sheet);
  const cell = CELL[sheet];
  const canvas = document.createElement('canvas');
  canvas.width = COLS[sheet] * cell;
  canvas.height = Math.ceil(list.length / COLS[sheet]) * cell;
  const ctx = context(canvas);
  list.forEach((r, i) => ctx.drawImage(r.views[iconView(r.entry)], (i % COLS[sheet]) * cell, Math.floor(i / COLS[sheet]) * cell));
  return canvas;
}

function manifestOf(rendered: readonly Rendered[], bytes: Map<ModelName, Uint8Array>): Manifest {
  const read = (name: ModelName): Uint8Array => {
    const b = bytes.get(name);
    if (!b) throw new Error(`Model ${name} was not read`);
    return b;
  };
  const hashOf = (r: Rendered): string => iconHash(r.entry, iconView(r.entry), read);
  const items = inSheet(rendered, 'items').map((r, index) => [r.entry.id, { index, hash: hashOf(r), box: boxOf(r.views[iconView(r.entry)]) }]);
  const chassis = inSheet(rendered, 'chassis').map((r, index) => [r.entry.id, { index, hash: hashOf(r) }]);
  return {
    cell: CELL,
    margin: MARGIN,
    outline: OUTLINE_PX,
    portraitWidth: portraitWidth(inSheet(rendered, 'chassis')),
    cols: COLS,
    views: ICON_VIEWS,
    items: Object.fromEntries(items),
    chassis: Object.fromEntries(chassis),
  };
}

// Share of a chassis cell's width, centered, that holds every drawn pixel of the widest truck, so the shop's portrait
// crop never cuts a truck off.
function portraitWidth(chassis: readonly Rendered[]): number {
  const cell = CELL.chassis;
  const half = Math.max(
    ...chassis.map((r) => {
      const { data } = context(r.views[ICON_VIEWS.chassis]).getImageData(0, 0, cell, cell);
      let reach = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) continue;
        const x = ((i - 3) / 4) % cell;
        reach = Math.max(reach, cell / 2 - x, x + 1 - cell / 2);
      }
      return reach;
    }),
  );
  return Math.min(1, Math.ceil(((2 * half) / cell) * 100) / 100);
}

// Where an item cell's drawn pixels lie, outline and pips included, so the grid can fit the drawing to its box.
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
  if (x1 <= x0 || y1 <= y0) throw new Error('An item icon drew no pixels');
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

function atlasOf(rendered: readonly Rendered[], viewOf: (entry: IconEntry) => IconView, caption: string): HTMLCanvasElement {
  const sections = ICON_SECTIONS.map((s) => ({ s, list: rendered.filter((r) => r.entry.section === s) })).filter((x) => x.list.length > 0);
  const rows = sections.reduce((n, x) => n + Math.ceil(x.list.length / ATLAS.cols), 0);
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
  for (const { s, list } of sections) {
    ctx.fillStyle = hex(TEXT);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(SECTION_TITLES[s], ATLAS.pad, y + 30);
    y += ATLAS.heading;
    list.forEach((r, i) => tile(ctx, r, viewOf(r.entry), ATLAS.pad + (i % ATLAS.cols) * ATLAS.tileW, y + Math.floor(i / ATLAS.cols) * ATLAS.tileH));
    y += Math.ceil(list.length / ATLAS.cols) * ATLAS.tileH;
  }
  return canvas;
}

function tile(ctx: CanvasRenderingContext2D, r: Rendered, view: IconView, x: number, y: number): void {
  ctx.fillStyle = hex(PANEL);
  ctx.fillRect(x + 2, y + 2, ATLAS.tileW - 4, ATLAS.tileH - 4);
  const icon = r.views[view];
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(icon, x + 8, y + 6, ATLAS.big, ATLAS.big);
  let sx = x + ATLAS.big + 20;
  for (const s of SMALL) {
    ctx.drawImage(icon, sx, y + 6 + (ATLAS.big - s) / 2, s, s);
    sx += s + 14;
  }
  ctx.fillStyle = hex(TEXT);
  ctx.font = '15px sans-serif';
  ctx.fillText(r.entry.label, x + 8, y + ATLAS.big + 24, ATLAS.tileW - 16);
  ctx.fillStyle = hex(MUTED);
  ctx.font = '12px monospace';
  ctx.fillText(r.entry.id, x + 8, y + ATLAS.big + 40, ATLAS.tileW - 16);
}

// The item pairs that differ least at the card size, per view, over the panel color. A diagnostic, not a gate.
function reportOf(rendered: readonly Rendered[]): string {
  const items = inSheet(rendered, 'items');
  const lines: string[] = [`Closest item pairs at ${REPORT_SIZE} px by mean RGB difference (0-255) over the panel color.`];
  for (const view of VIEWS) {
    const px = items.map((r) => smallPixels(r.views[view]));
    const pairs: { a: string; b: string; d: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) pairs.push({ a: items[i].entry.id, b: items[j].entry.id, d: meanDiff(px[i], px[j]) });
    }
    pairs.sort((p, q) => p.d - q.d);
    lines.push('', `${view}:`, ...pairs.slice(0, REPORT_PAIRS).map((p) => `  ${p.d.toFixed(1).padStart(5)}  ${p.a} / ${p.b}`));
  }
  return `${lines.join('\n')}\n`;
}

function smallPixels(icon: HTMLCanvasElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_SIZE;
  canvas.height = REPORT_SIZE;
  const ctx = context(canvas);
  ctx.fillStyle = hex(PANEL);
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
