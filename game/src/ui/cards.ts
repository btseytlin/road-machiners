// Icon artwork, item icons rendered from the game's models, and the cards built from them for shop and inventory
// screens: a part or truck with icon stats and the change against the player's own.
// Stat values are in display units, so a difference reads the same as the value.

import { oilSlickLength } from "../data/utilities";
import { chassisDef } from "../data/chassis";
import { partDef, type PartDef, type PartKind, type WeaponDef, type EngineDef, type ArmorDef, type ScannerDef, type CargoDef, type StoreDef, type UtilityDef, type FieldRepair } from "../data/parts";
import { baseGrid, cellCount, mountedParts, type Cell } from "../sim/grid";
import { maxHp, partValue, wornDef } from "../sim/wear";
import type { GridItem, PartInstance, Vehicle, World } from "../sim/types";
import { GOODS } from "../data/goods";
import { itemTone } from "../render/partLooks";
import { hashStr } from "../render/noise";
import { ITEM_TONES } from "../render/palette";
import ICONS from "../data/item-icons.json";
import { roundDamage } from "../sim/combat";
import { el } from "./dom";
import { conditionStatus, conditionTier, showsCondition, wearLabel } from "./format";
import { fuelLiters, hp, kph, meters, mps2 } from "./units";

const ART = {
  trade: '<ellipse cx="18" cy="9" rx="11" ry="5"/><path d="M7 9v15c0 7 22 7 22 0V9M7 16c0 7 22 7 22 0"/>',
  fuel: '<path d="M8 10h16v23H8zM11 4h10v6M15 15l6 6-9 8M24 12h7v18h5V15l-5-5"/>',
  supplies: '<path d="M5 13h30v22H5zM5 13l6-8h18l6 8M15 6v28M25 6v28"/>',
  driver:
    '<circle cx="20" cy="12" r="7"/><path d="M7 35v-6q13-15 26 0v6M17 27h6M20 24v6"/>',
  truck:
    '<path d="M10 5h20v31H10zM12 10h16v9H12zM12 25h16M12 30h16M6 8v8M34 8v8M6 27v8M34 27v8"/>',
  cannon:
    '<path d="M5 25l10-5h14v12H7zM23 22L34 5l5 3-11 19M11 32v5M23 32v5"/>',
  mg: '<ellipse cx="19" cy="29" rx="14" ry="7"/><path d="M12 28V17h15v11M22 18L36 7M25 21L39 10"/>',
  engine:
    '<path d="M8 8h24v25H8zM4 15h4M32 15h5M13 4v33M20 4v33M27 4v33M7 14h26M7 26h26"/>',
  armor: '<path d="M6 6h28v23L20 37 6 29zM11 11h18v15l-9 5-9-5z"/>',
  cargo: '<path d="M4 10h32v26H4zM4 10l8-6h18l6 6M4 10l32 26M36 10L4 36"/>',
  wheel:
    '<rect x="10" y="3" width="20" height="34" rx="5"/><path d="M12 9h16M12 16h16M12 23h16M12 30h16M20 4v32"/>',
  transmission: '<path d="M7 16h26v10H7zM14 9v24M26 9v24M4 21h32"/>',
  cab: '<path d="M6 9l5-5h18l5 5v26H6zM10 9h20v13H10zM20 9v13M10 28h20"/>',
  salt: '<path d="M12 5h16l-3 7 8 17q1 8-13 8T7 29l8-17zM14 13h12M16 25h8M20 21v8"/>',
  star: '<path d="M20 3l5 11 12 1-9 8 3 12-11-7-11 7 3-12-9-8 12-1z"/>',
  turn: '<path d="M5 14h16V5l16 15-16 15v-9H5z"/>',
  tools:
    '<path d="M12 5l6 7-6 6-7-6q-3 10 10 11l14 14 8-8-14-14q1-13-11-10z"/>',
  parts:
    '<circle cx="20" cy="20" r="8"/><circle cx="20" cy="20" r="3"/><path d="M20 4v6M20 30v6M4 20h6M30 20h6M9 9l4 4M27 27l4 4M31 9l-4 4M9 31l4-4"/>',
  scanner: '<path d="M8 30q-4-16 12-22l6 12zM17 19l9-9M26 10l4-4M20 30v6M12 36h16"/>',
  utility: '<path d="M6 14h28v20H6zM10 14V8h20v6M20 18v12M14 24h12M30 8l5-4"/>',
  damage: '<path d="M20 3l4 10 11-3-7 9 8 8-11-1-1 11-5-9-7 8v-11l-10-3 10-5-4-10 10 5z"/>',
  pen: '<path d="M22 5v30M4 20h28M26 14l7 6-7 6"/>',
  range: '<path d="M4 20h32M4 13v14M36 13v14M12 17v6M20 16v8M28 17v6"/>',
  reload: '<path d="M33 20a13 13 0 1 1-4-9.5M33 5v9h-9"/>',
  cooldown: '<path d="M11 5h18M11 35h18M13 5q0 11 7 15q-7 4-7 15M27 5q0 11-7 15q7 4 7 15"/>',
  magazine: '<path d="M14 6h12v28H14zM14 13h12M14 20h12M14 27h12"/>',
  spread: '<path d="M5 20l30-12M5 20l30 12M5 20h30"/>',
  arc: '<path d="M20 33L7 12M20 33l13-21M9 15q11-9 22 0"/>',
  speed: '<path d="M5 30a15 15 0 1 1 30 0M20 30l9-11M10 30h3M27 30h3"/>',
  accel: '<path d="M7 9l11 11-11 11M20 9l11 11-11 11"/>',
  noise: '<path d="M5 15h6l9-8v26l-9-8H5zM26 14q4 6 0 12M31 9q8 11 0 22"/>',
  ram: '<path d="M4 20h19M17 13l7 7-7 7M30 5v30M35 5v30"/>',
  rows: '<path d="M5 6h30v28H5zM5 15h30M5 25h30M20 25v9"/>',
  hp: '<path d="M20 34L6 20Q0 12 7 7q7-4 13 4 6-8 13-4 7 5 1 13z"/>',
  mass: '<path d="M9 34l4-19h14l4 19zM16 15a4 4 0 1 1 8 0"/>',
  turning: '<path d="M10 35V22q0-12 14-12h6M25 4l7 6-7 6"/>',
  cells: '<path d="M5 5h30v30H5zM5 20h30M20 5v30"/>',
  load: '<path d="M3 27h34v6H3zM9 27V13h22v14M9 33v3M31 33v3"/>',
  power: '<path d="M23 3L9 22h10l-3 15 15-20H21z"/>',
  recoil: '<path d="M16 20h20M16 14v12M4 20l8-6v12z"/>',
  blast: '<path d="M20 4l3 9 9-4-4 9 9 2-9 3 4 9-9-4-3 9-3-9-9 4 4-9-9-3 9-2-4-9 9 4z"/>',
  heat: '<path d="M16 25V7a4 4 0 0 1 8 0v18a7 7 0 1 1-8 0zM20 13v15"/>',
  patch: '<path d="M8 14l14-9 11 17-14 9zM15 15l3 5M20 12l3 5M18 22l3 5"/>',
  tall: '<path d="M14 36V8h12v28M6 36h28M20 8V3"/>',
  clock: '<circle cx="20" cy="20" r="15"/><path d="M20 10v10l7 5"/>',
} as const;

export type IconName = keyof typeof ART;

const ICON_NAMES: Record<IconName, string> = {
  star: "Pristine",
  trade: "Trade",
  fuel: "Fuel",
  supplies: "Supplies",
  driver: "Driver",
  truck: "Truck inventory",
  cannon: "Forward cannon",
  mg: "MG turret",
  engine: "Engine",
  armor: "Armor",
  cargo: "Cargo",
  wheel: "Wheel",
  transmission: "Transmission",
  cab: "Cab",
  salt: "Salt",
  turn: "End turn",
  tools: "Machine tools",
  parts: "Parts",
  scanner: "Radio scanner",
  utility: "Utility",
  damage: "Damage",
  pen: "Penetration",
  range: "Range",
  reload: "Reload",
  cooldown: "Cooldown",
  magazine: "Magazine",
  spread: "Spread",
  arc: "Firing arc",
  speed: "Speed",
  accel: "Acceleration",
  noise: "Noise",
  ram: "Ram",
  rows: "Cargo rows",
  hp: "HP",
  mass: "Mass",
  turning: "Turning",
  cells: "Cargo cells",
  load: "Rated load",
  recoil: "Recoil",
  power: "Power",
  blast: "Blast armor",
  heat: "Heat",
  patch: "Field repair",
  tall: "Tall",
  clock: "Time left",
};

export function createIcon(name: IconName): HTMLElement {
  const icon = el("span", {
    class: `icon icon-${name}`,
    title: ICON_NAMES[name],
    "aria-hidden": "true",
  });
  icon.innerHTML = `<svg viewBox="0 0 40 40" focusable="false">${ART[name]}</svg>`;
  return icon;
}

export function dialShare(speed: number, maxSpeed: number): number {
  if (maxSpeed <= 0) return speed === 0 ? 0 : 1;
  return Math.min(Math.abs(speed) / maxSpeed, 1);
}

export function createSpeedDial(speed: number, maxSpeed: number): HTMLElement {
  const dial = el("span", { class: "speed-dial", "aria-hidden": "true" });
  const angle = -120 + dialShare(speed, maxSpeed) * 240;
  dial.innerHTML = `<svg viewBox="0 0 100 100"><circle class="dial-rim" cx="50" cy="50" r="47"/><circle class="dial-face" cx="50" cy="50" r="41"/><path class="dial-ticks" d="M17 68A38 38 0 1 1 83 68"/><path class="dial-needle" d="M50 50V17" transform="rotate(${angle} 50 50)"/><circle class="dial-pin" cx="50" cy="50" r="4"/></svg>`;
  return dial;
}

type Sheet = "items" | "chassis";
type View = "top" | "diagonal";

export type Box = { x: number; y: number; w: number; h: number };

export type IconCell = {
  sheet: Sheet;
  label: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
  box: Box;
  view: View;
};

type ManifestCell = { index: number; box: number[] };

export function itemIconCell(id: string): IconCell {
  const good = id in GOODS;
  const label = good ? GOODS[id].name : partDef(id).name;
  const icons: Record<string, ManifestCell> = ICONS.items;
  const icon = icons[id];
  if (!icon) throw new Error(`No items icon for ${id}. Run npm run icons.`);
  return { ...sheetCell("items", icon, label), view: viewOf(good ? ICONS.views.good : ICONS.views.part) };
}

export function chassisPortraitCell(chassisId: string): IconCell {
  const icons: Record<string, ManifestCell> = ICONS.chassis;
  const icon = icons[chassisId];
  if (!icon) throw new Error(`No chassis icon for ${chassisId}. Run npm run icons.`);
  return { ...sheetCell("chassis", icon, chassisDef(chassisId).name), view: viewOf(ICONS.views.chassis) };
}

function viewOf(view: string): View {
  if (view !== "top" && view !== "diagonal") throw new Error(`Unknown icon view ${view}. Run npm run icons.`);
  return view;
}

function sheetCell(sheet: Sheet, icon: ManifestCell, label: string): Omit<IconCell, "view"> {
  const cols = ICONS.cols[sheet];
  const rows = Math.ceil(Object.keys(ICONS[sheet]).length / cols);
  const [x, y, w, h] = icon.box;
  return { sheet, label, col: icon.index % cols, row: Math.floor(icon.index / cols), cols, rows, box: { x, y, w, h } };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SHEET_FILES: Record<Sheet, string> = { items: "items.svg", chassis: "chassis.png" };
const SHEET_VERSION = hashStr(JSON.stringify(ICONS)).toString(36);

function sheetIcon(cell: IconCell, cls: string, crop: Box): HTMLElement {
  const icon = el("span", { class: cls, role: "img", "aria-label": cell.label, title: cell.label });
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${crop.w} ${crop.h}`);
  svg.setAttribute("focusable", "false");
  const clip = document.createElementNS(SVG_NS, "svg");
  clip.setAttribute("viewBox", `${cell.col + crop.x} ${cell.row + crop.y} ${crop.w} ${crop.h}`);
  for (const [k, v] of [["width", crop.w], ["height", crop.h]] as const) clip.setAttribute(k, String(v));
  const image = document.createElementNS(SVG_NS, "image");
  image.setAttribute("href", `${import.meta.env.BASE_URL}icons/${SHEET_FILES[cell.sheet]}?v=${SHEET_VERSION}`);
  image.setAttribute("width", String(cell.cols));
  image.setAttribute("height", String(cell.rows));
  image.setAttribute("preserveAspectRatio", "none");
  clip.append(image);
  svg.append(clip);
  icon.append(svg);
  return icon;
}

export function createItemIcon(id: string): HTMLElement {
  const cell = itemIconCell(id);
  const icon = sheetIcon(cell, "icon item-icon", cell.box);
  icon.setAttribute("style", toneStyle(id));
  return icon;
}

export function toneStyle(id: string): string {
  return `--tone:#${ITEM_TONES[itemTone(id)].toString(16).padStart(6, "0")}`;
}

export function partIconEl(part: PartInstance): HTMLElement {
  return createItemIcon(part.defId);
}

export function itemIconEl(item: GridItem): HTMLElement {
  return item.kind === "good" ? createItemIcon(item.good) : partIconEl(item.part);
}

export function gridItemIcon(item: GridItem): HTMLElement {
  const cell = itemIconCell(item.kind === "good" ? item.good : item.part.defId);
  return sheetIcon(cell, "icon item-icon", cell.box);
}

export function chassisPortrait(chassisId: string): HTMLElement {
  const cell = chassisPortraitCell(chassisId);
  return sheetIcon(cell, "chassis-portrait", cell.box);
}

export function statGrid(diffs: StatDiff[]): HTMLElement {
  return el(
    "div",
    { class: "stat-grid" },
    ...diffs.map((d) =>
      el(
        "div",
        { class: "stat", title: d.stat.label },
        createIcon(d.stat.icon),
        el("span", { class: "stat-name" }, ICON_NAMES[d.stat.icon]),
        el("span", { class: "stat-val" }, statValue(d.stat)),
        d.delta === null ? el("span") : el("span", { class: `delta ${d.verdict}` }, d.delta === 0 ? "=" : d.text),
      ),
    ),
  );
}

const TIGHT_UNITS = ["°", "×"];

export function statValue(s: Stat): string {
  if (s.unit === "") return s.text;
  return TIGHT_UNITS.includes(s.unit) ? `${s.text}${s.unit}` : `${s.text} ${s.unit}`;
}

export function footprint(w: number, h: number): HTMLElement {
  return el(
    "div",
    { class: "footprint", title: `${w}×${h} cells`, style: `grid-template-columns:repeat(${w},1fr)` },
    ...Array.from({ length: w * h }, () => el("i")),
  );
}

export function conditionMeter(part: PartInstance): HTMLElement {
  const max = maxHp(part);
  const broken = part.hp === 0;
  return el(
    "div",
    { class: `meter${broken ? " broken" : ""}`, title: `Condition: ${hp(part.hp)} of ${hp(max)} HP` },
    el("div", { style: `width:${(part.hp / max) * 100}%` }),
  );
}

export function conditionTag(part: PartInstance): HTMLElement | null {
  if (!showsCondition(part)) return null;
  const tier = conditionTier(part);
  return el("span", { class: `cond cond-${tier}` }, ...(tier === "pristine" ? [createIcon("star")] : []), wearLabel(part));
}

export function conditionRow(part: PartInstance): HTMLElement | null {
  if (!showsCondition(part)) return null;
  const status = conditionStatus(part);
  return el("div", { class: "card-cond" }, conditionTag(part), el("span", { class: status.tone }, status.text));
}

export function headlineStat(world: World, part: PartInstance, base: PartInstance | null): StatDiff {
  const first = diffStats(partStats(world, part), base ? partStats(world, base) : null)[0];
  if (!first) throw new Error(`${part.defId} has no stats to headline`);
  return first;
}

export function statChip(d: StatDiff): HTMLElement {
  return el(
    "span",
    { class: "stat-chip", title: d.stat.label },
    createIcon(d.stat.icon),
    el("span", { class: "stat-val" }, statValue(d.stat)),
    d.delta === null ? null : el("span", { class: `delta ${d.verdict}` }, d.delta === 0 ? "=" : d.text),
  );
}

export type PartCardOptions = {
  world: World;
  part: PartInstance;
  base: PartInstance | null;
  action: HTMLElement | null;
  onHover?: (on: boolean) => void;
};

export function partCard(o: PartCardOptions): HTMLElement {
  const def = partDef(o.part.defId);
  const diffs = diffStats(partStats(o.world, o.part), o.base ? partStats(o.world, o.base) : null);
  const card = el(
    "div",
    { class: `card tile toned k-${def.kind}`, style: toneStyle(def.id) },
    el(
      "div",
      { class: "card-head" },
      partIconEl(o.part),
      el("div", { class: "card-name" }, el("b", {}, def.name)),
      footprint(def.w, def.h),
    ),
    conditionRow(o.part),
    ...(o.base ? [compareLine(o.base)] : []),
    conditionMeter(o.part),
    statGrid(diffs),
    el("div", { class: "card-foot" }, el("span"), o.action),
  );
  if (o.onHover) {
    const hover = o.onHover;
    card.addEventListener("mouseenter", () => hover(true));
    card.addEventListener("mouseleave", () => hover(false));
  }
  return card;
}

export function partDetail(world: World, part: PartInstance, base: PartInstance | null): HTMLElement[] {
  const rest = diffStats(partStats(world, part), base ? partStats(world, base) : null).slice(1);
  const hpText = hpReadout(part);
  return [
    ...(base ? [compareLine(base)] : []),
    el("div", { class: "part-hp" }, conditionMeter(part), hpText ? el("span", { class: "num dim" }, hpText) : null),
    ...(rest.length ? [statGrid(rest)] : []),
  ];
}

function hpReadout(part: PartInstance): string | null {
  const status = conditionStatus(part);
  return status.tone === "dim" && conditionTier(part) !== "junk" ? status.text : null;
}

export function compareBase(selected: PartInstance | null, part: PartInstance): PartInstance | null {
  return selected && selected.id !== part.id ? selected : null;
}

function compareLine(base: PartInstance): HTMLElement {
  return el("div", { class: "card-compare" }, `Compared with ${partDef(base.defId).name} `, conditionTag(base));
}

export function chassisMap(chassisId: string): HTMLElement {
  const g = baseGrid(chassisId);
  return el(
    "div",
    { class: "chassis-map", title: `${chassisDef(chassisId).name} layout`, style: `grid-template-columns:repeat(${g.w},1fr)` },
    ...g.cells.flat().map((c) => el("i", { class: cellClass(c) })),
  );
}

function cellClass(c: Cell | null): string {
  if (c === null) return "hole";
  return `c-${c === "." ? "plain" : c}`;
}

export type StatIcon =
  | "damage"
  | "pen"
  | "range"
  | "reload"
  | "cooldown"
  | "magazine"
  | "spread"
  | "arc"
  | "speed"
  | "accel"
  | "fuel"
  | "supplies"
  | "noise"
  | "armor"
  | "ram"
  | "rows"
  | "hp"
  | "mass"
  | "turning"
  | "cells"
  | "load"
  | "scanner"
  | "recoil"
  | "power"
  | "blast"
  | "heat"
  | "patch"
  | "tall"
  | "clock";

export type Stat = {
  icon: StatIcon;
  label: string;
  value: number;
  text: string;
  unit: string;
  decimals: number;
  better: "more" | "less" | null;
};

export type Verdict = "better" | "worse" | "same";

export type StatDiff = { stat: Stat; delta: number; text: string; verdict: Verdict } | { stat: Stat; delta: null };

function stat(icon: StatIcon, label: string, value: number, unit: string, better: Stat["better"], decimals = 0): Stat {
  return { icon, label, value, text: formatNumber(value, decimals), unit, decimals, better };
}

function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function signed(value: number, decimals: number): string {
  return `${value < 0 ? "−" : "+"}${formatNumber(Math.abs(value), decimals)}`;
}

export function partStats(world: World, part: PartInstance): Stat[] {
  const def = partDef(part.defId);
  return [...KIND_STATS[def.kind](world, part), stat("mass", "Mass", def.mass, "kg", "less")];
}

const KIND_STATS: Record<PartKind, (world: World, part: PartInstance) => Stat[]> = {
  weapon: weaponStats,
  engine: (_, part) => engineStats(part),
  armor: (_, part) => armorStats(part),
  cargo: (_, part) => cargoStats(part),
  scanner: (_, part) => [stat("scanner", "Detection range", meters(wornDef<ScannerDef>(part).range), "m", "more")],
  store: (_, part) => storeStats(part),
  core: () => [],
  utility: (_, part) => utilityStats(part),
};

function utilityStats(part: PartInstance): Stat[] {
  const d = wornDef<UtilityDef>(part);
  const reload = d.reload === null ? [] : [stat("reload", "Turns to recharge", d.reload, "t", "less")];
  const lasts = "turns" in d.effect ? [stat("clock", "Turns it lasts", d.effect.turns, "t", "more")] : [];
  return [...reload, ...utilityReach(d), ...lasts];
}

function utilityReach(d: UtilityDef): Stat[] {
  const e = d.effect;
  if ("maxRange" in e) return [stat("range", "Range", meters(e.maxRange), "m", "more")];
  if (e.type === "oil") return [stat("range", "Slick length", meters(oilSlickLength()), "m", "more")];
  return "radius" in e ? [stat("range", "Radius", meters(e.radius), "m", "more")] : [];
}

function storeStats(part: PartInstance): Stat[] {
  const d = partDefOf<StoreDef>(part);
  if (d.holds === "fuel") return [{ ...stat("fuel", "Extra fuel", fuelLiters(d.amount), "L", "more"), text: `+${fuelLiters(d.amount)}` }];
  return [{ ...stat("supplies", "Extra supplies", d.amount, "", "more"), text: `+${d.amount}` }];
}

function cargoStats(part: PartInstance): Stat[] {
  const d = partDefOf<CargoDef>(part);
  return [{ ...stat("rows", "Extra cargo rows", d.extraRows, d.extraRows === 1 ? "row" : "rows", "more"), text: `+${d.extraRows}` }, tallStat(d)];
}

function penStat(d: WeaponDef): Stat {
  return { ...stat("pen", "Penetration", d.round.pen, "", "more"), unit: d.round.blast ? "blast" : "" };
}

function tallStat(d: PartDef): Stat {
  return { ...stat("tall", "Height", d.tall ? 1 : 0, "", "less"), text: d.tall ? "tall" : "low" };
}

function partDefOf<T>(part: PartInstance): T {
  return partDef(part.defId) as T;
}

function weaponStats(world: World, part: PartInstance): Stat[] {
  const d = wornDef<WeaponDef>(part);
  const round = roundDamage(world, d);
  const shot = { ...stat("damage", "Damage per shot", d.rounds * round, "", "more", 1) };
  if (d.rounds > 1) shot.text = `${d.rounds}×${formatNumber(round, 1)}`;
  return [
    shot,
    penStat(d),
    stat("range", "Range", meters(d.range), "m", "more"),
    stat("cooldown", "Turns between shots", d.cooldown, "t", "less"),
    stat("magazine", "Shots per magazine", d.magazine, "", "more"),
    stat("reload", "Turns to reload", d.reload, "t", "less"),
    stat("arc", "Firing arc", d.arc, "°", "more"),
    stat("recoil", "Recoil", d.recoil, "°", "less", 1),
    stat("power", "Power draw", d.draw, "", "less", 1),
    ...(d.line ? [stat("clock", "Turns the line holds", d.line.turns, "t", "more")] : []),
  ];
}

function engineStats(part: PartInstance): Stat[] {
  const d = wornDef<EngineDef>(part);
  const speed = stat("speed", "Top speed", kph(d.speedBonus), "km/h", "more");
  const accel = stat("accel", "Acceleration", mps2(d.accelBonus), "m/s²", "more", 1);
  return [
    { ...speed, text: signed(speed.value, 0) },
    { ...accel, text: signed(accel.value, 1) },
    stat("power", "Gun power", d.capacity, "", "more"),
    stat("fuel", "Fuel use", d.fuelMult, "×", "less", 1),
    stat("heat", "Heat", d.heat, "×", "less", 1),
  ];
}

function armorStats(part: PartInstance): Stat[] {
  const d = wornDef<ArmorDef>(part);
  const armor = stat("armor", "Armor", Math.round(d.armor), "", "more");
  const blast = stat("blast", "Blast armor", Math.round(d.blastArmor), "", "more");
  const stats = [armor, blast, fieldRepairStat(d.fieldRepair)];
  return d.ramMult > 1 ? [...stats, stat("ram", "Ram damage", d.ramMult, "×", "more", 1)] : stats;
}

const FIELD_REPAIR: Record<FieldRepair, { rank: number; text: string; label: string }> = {
  none: { rank: 0, text: "shop", label: "Repair: shop only" },
  capped: { rank: 1, text: "cap", label: "Field repair: partial" },
  full: { rank: 2, text: "full", label: "Field repair: full" },
};

function fieldRepairStat(repair: FieldRepair): Stat {
  const r = FIELD_REPAIR[repair];
  return { ...stat("patch", r.label, r.rank, "", "more"), text: r.text };
}

export function chassisStats(chassisId: string): Stat[] {
  const c = chassisDef(chassisId);
  const turning = stat("turning", "Turning",(c.turnFast + c.turnSlow) / 2, "°", "more");
  return [
    stat("speed", "Base top speed", kph(c.maxSpeed), "km/h", "more"),
    stat("accel", "Acceleration", mps2(c.accel), "m/s²", "more", 1),
    { ...turning, text: `${c.turnFast}–${c.turnSlow}` },
    stat("cells", "Cargo cells", cellCount(baseGrid(chassisId)), "", "more"),
    stat("load", "Rated load", c.ratedMass, "kg", "more"),
    stat("mass", "Empty mass", c.mass, "kg", "less"),
    stat("fuel", "Fuel tank", fuelLiters(c.fuelCap), "L", "more"),
  ];
}

export function diffStats(stats: Stat[], base: Stat[] | null): StatDiff[] {
  return stats.map((s) => {
    const b = base?.find((x) => x.icon === s.icon);
    if (!b) return { stat: s, delta: null };
    const delta = Number((s.value - b.value).toFixed(s.decimals));
    return { stat: s, delta, text: signed(delta, s.decimals), verdict: verdictOf(delta, s.better) };
  });
}

function verdictOf(delta: number, better: Stat["better"]): Verdict {
  if (delta === 0 || better === null) return "same";
  return (delta > 0) === (better === "more") ? "better" : "worse";
}

export function baselinePart(v: Vehicle, kind: PartKind): PartInstance | null {
  return [...mountedParts(v, kind)].sort((a, b) => partValue(b) - partValue(a))[0] ?? null;
}
